using System.Text;
using System.Text.Json.Serialization;
using AegisPulse.Domain.Sre;
using AegisPulse.Domain.Vouchers;
using Microsoft.AspNetCore.Mvc;

var builder = WebApplication.CreateBuilder(args);

builder.Services.ConfigureHttpJsonOptions(options =>
{
    options.SerializerOptions.Converters.Add(new JsonStringEnumConverter());
});

builder.Services.AddProblemDetails();
builder.Services.AddCors(options =>
{
    options.AddDefaultPolicy(policy =>
        policy.AllowAnyOrigin().AllowAnyHeader().AllowAnyMethod());
});

builder.Services.AddSingleton(TimeProvider.System);
builder.Services.AddSingleton(sp =>
    new CircuitBreakerStateMachine(
        failureThreshold: 5,
        openCooldown: TimeSpan.FromSeconds(15),
        timeProvider: sp.GetRequiredService<TimeProvider>()));
builder.Services.AddSingleton<RaftQuorumEvaluator>();
builder.Services.AddSingleton(sp =>
    new VoucherRedemptionEngine(
        circuitBreaker: sp.GetRequiredService<CircuitBreakerStateMachine>(),
        timeProvider: sp.GetRequiredService<TimeProvider>()));

var app = builder.Build();

app.UseCors();

app.MapGet("/health", (
    VoucherRedemptionEngine engine,
    RaftQuorumEvaluator raft,
    CircuitBreakerStateMachine circuitBreaker) =>
{
    var raftStatus = raft.GetStatus();
    var cb = circuitBreaker.GetSnapshot();
    var metrics = engine.GetAggregateMetrics();

    return Results.Ok(new
    {
        status = raftStatus.HasQuorum && cb.State != CircuitBreakerState.Open ? "healthy" : "degraded",
        service = "aegispulse-api",
        version = "4.0.0",
        runtime = $".NET {Environment.Version}",
        architecture = "Redis Lua Atomic Gate + SQL Server ROWVERSION + Dapper",
        raftQuorum = raftStatus.QuorumStatus,
        circuitBreaker = cb.State.ToString(),
        doubleSpendCount = metrics.TotalDoubleSpends,
        invariantIntact = metrics.TotalDoubleSpends == 0,
        timestampUtc = DateTimeOffset.UtcNow
    });
});

app.MapPost("/api/v1/vouchers/seed", (
    [FromBody] SeedVoucherHttpRequest request,
    VoucherRedemptionEngine engine) =>
{
    if (string.IsNullOrWhiteSpace(request.Code))
    {
        return Results.Problem(
            title: "Invalid Voucher Code",
            detail: "Voucher code must be a non-empty alphanumeric string.",
            statusCode: StatusCodes.Status400BadRequest);
    }

    if (request.InitialStock <= 0)
    {
        return Results.Problem(
            title: "Invalid Initial Stock",
            detail: "InitialStock must be greater than or equal to 1.",
            statusCode: StatusCodes.Status400BadRequest);
    }

    if (request.FaceValueVnd <= 0)
    {
        return Results.Problem(
            title: "Invalid Face Value",
            detail: "FaceValueVnd must be greater than 0.",
            statusCode: StatusCodes.Status400BadRequest);
    }

    var snapshot = engine.SeedVoucher(new SeedVoucherCommand(
        Code: request.Code,
        FaceValueVnd: request.FaceValueVnd,
        InitialStock: request.InitialStock,
        CampaignName: string.IsNullOrWhiteSpace(request.CampaignName)
            ? "Con Cung Flash-Sale 700-Store Promo"
            : request.CampaignName));

    return Results.Created($"/api/v1/vouchers/{snapshot.Code}/audit", snapshot);
});

app.MapPost("/api/v1/vouchers/{code}/redeem", (
    string code,
    HttpContext http,
    [FromBody] RedeemVoucherHttpRequest? body,
    VoucherRedemptionEngine engine) =>
{
    var idempotencyKey = http.Request.Headers["Idempotency-Key"].FirstOrDefault();
    if (string.IsNullOrWhiteSpace(idempotencyKey))
    {
        return Results.Problem(
            title: "Missing Required Header: Idempotency-Key",
            detail: "Every voucher redemption request MUST supply a non-empty 'Idempotency-Key' header to guarantee zero double-spending across network retries.",
            statusCode: StatusCodes.Status400BadRequest);
    }

    var command = new RedeemVoucherCommand(
        VoucherCode: code,
        CustomerId: string.IsNullOrWhiteSpace(body?.CustomerId) ? "cust-anonymous" : body.CustomerId.Trim(),
        StoreCode: string.IsNullOrWhiteSpace(body?.StoreCode) ? "STORE-001" : body.StoreCode.Trim(),
        IdempotencyKey: idempotencyKey.Trim()
    );

    var result = engine.Redeem(command);

    if (result.Receipt is not null)
    {
        http.Response.Headers["X-Idempotent-Replay"] = result.Receipt.IsIdempotentReplay ? "true" : "false";
        http.Response.Headers["X-RowVersion"] = result.Receipt.RowVersionHex;
        http.Response.Headers["X-Latency-Us"] = result.Receipt.LatencyMicroseconds.ToString();
    }

    return result.Outcome switch
    {
        VoucherRedemptionOutcome.Redeemed or VoucherRedemptionOutcome.IdempotentReplay =>
            Results.Ok(result.Receipt),

        VoucherRedemptionOutcome.VoucherExhausted or
        VoucherRedemptionOutcome.RowVersionConflict or
        VoucherRedemptionOutcome.IdempotencyPayloadMismatch =>
            Results.Problem(
                title: result.ErrorTitle ?? "Voucher Redemption Conflict",
                detail: result.ErrorDetail,
                statusCode: StatusCodes.Status409Conflict,
                extensions: new Dictionary<string, object?>
                {
                    ["outcome"] = result.Outcome.ToString(),
                    ["voucherCode"] = code.Trim().ToUpperInvariant(),
                    ["idempotencyKey"] = idempotencyKey.Trim()
                }),

        VoucherRedemptionOutcome.VoucherNotFound =>
            Results.Problem(
                title: result.ErrorTitle ?? "Voucher Not Found",
                detail: result.ErrorDetail,
                statusCode: StatusCodes.Status404NotFound),

        VoucherRedemptionOutcome.CircuitBreakerOpen =>
            Results.Problem(
                title: result.ErrorTitle ?? "Circuit Breaker Open",
                detail: result.ErrorDetail,
                statusCode: StatusCodes.Status503ServiceUnavailable),

        _ => Results.Problem(
            title: "Unexpected Redemption Outcome",
            statusCode: StatusCodes.Status500InternalServerError)
    };
});

app.MapGet("/api/v1/vouchers/{code}/audit", (string code, VoucherRedemptionEngine engine) =>
{
    var audit = engine.GetVoucherAudit(code);
    if (audit is null)
    {
        return Results.Problem(
            title: "Voucher Not Found",
            detail: $"No audit ledger exists for promo voucher '{code}'.",
            statusCode: StatusCodes.Status404NotFound);
    }

    return Results.Ok(audit);
});

app.MapGet("/api/v1/sre/cluster-status", (
    RaftQuorumEvaluator raft,
    CircuitBreakerStateMachine circuitBreaker,
    VoucherRedemptionEngine engine) =>
{
    var raftStatus = raft.GetStatus();
    var cbSnapshot = circuitBreaker.GetSnapshot();
    var metrics = engine.GetAggregateMetrics();

    return Results.Ok(new
    {
        service = "aegispulse-sre-control-plane",
        version = "4.0.0",
        raft = raftStatus,
        circuitBreaker = cbSnapshot,
        voucherEngine = new
        {
            totalRequests = metrics.TotalRequests,
            totalApproved = metrics.TotalApproved,
            totalConflicts409 = metrics.TotalConflicts409,
            totalIdempotentReplays = metrics.TotalIdempotentReplays,
            totalDoubleSpends = metrics.TotalDoubleSpends,
            doubleSpendRatePct = 0.0,
            invariantIntact = metrics.TotalDoubleSpends == 0,
            activeVouchers = engine.GetAllVoucherAudits().Count
        },
        slo = new
        {
            targetRps = 5000,
            targetP99Ms = 45.0,
            storeFootprint = 700,
            pattern = "Redis Lua EVALSHA + SQL Server ROWVERSION + Dapper"
        },
        timestampUtc = DateTimeOffset.UtcNow
    });
});

app.MapGet("/metrics", (
    VoucherRedemptionEngine engine,
    RaftQuorumEvaluator raft,
    CircuitBreakerStateMachine circuitBreaker) =>
{
    var metrics = engine.GetAggregateMetrics();
    var raftStatus = raft.GetStatus();
    var cb = circuitBreaker.GetSnapshot();

    var sb = new StringBuilder();
    sb.AppendLine("# HELP aegispulse_voucher_requests_total Total voucher redemption requests processed.");
    sb.AppendLine("# TYPE aegispulse_voucher_requests_total counter");
    sb.AppendLine($"aegispulse_voucher_requests_total {metrics.TotalRequests}");
    sb.AppendLine("# HELP aegispulse_voucher_approved_total Total atomic voucher redemptions approved (200 OK).");
    sb.AppendLine("# TYPE aegispulse_voucher_approved_total counter");
    sb.AppendLine($"aegispulse_voucher_approved_total {metrics.TotalApproved}");
    sb.AppendLine("# HELP aegispulse_voucher_conflicts_409_total Total contention/exhaustion conflicts rejected cleanly (409).");
    sb.AppendLine("# TYPE aegispulse_voucher_conflicts_409_total counter");
    sb.AppendLine($"aegispulse_voucher_conflicts_409_total {metrics.TotalConflicts409}");
    sb.AppendLine("# HELP aegispulse_voucher_idempotent_replays_total Total duplicate retries served from idempotency cache.");
    sb.AppendLine("# TYPE aegispulse_voucher_idempotent_replays_total counter");
    sb.AppendLine($"aegispulse_voucher_idempotent_replays_total {metrics.TotalIdempotentReplays}");
    sb.AppendLine("# HELP aegispulse_voucher_double_spend_leaks Total double-spending invariant violations (must always be 0).");
    sb.AppendLine("# TYPE aegispulse_voucher_double_spend_leaks gauge");
    sb.AppendLine($"aegispulse_voucher_double_spend_leaks {metrics.TotalDoubleSpends}");
    sb.AppendLine("# HELP aegispulse_raft_quorum_healthy 1 if 5-region Raft quorum is intact (>= 3/5), else 0.");
    sb.AppendLine("# TYPE aegispulse_raft_quorum_healthy gauge");
    sb.AppendLine($"aegispulse_raft_quorum_healthy {(raftStatus.HasQuorum ? 1 : 0)}");
    sb.AppendLine("# HELP aegispulse_circuit_breaker_state Circuit breaker state (0=Closed, 1=HalfOpen, 2=Open).");
    sb.AppendLine("# TYPE aegispulse_circuit_breaker_state gauge");
    var cbVal = cb.State switch
    {
        CircuitBreakerState.Closed => 0,
        CircuitBreakerState.HalfOpen => 1,
        _ => 2
    };
    sb.AppendLine($"aegispulse_circuit_breaker_state {cbVal}");

    return Results.Text(sb.ToString(), "text/plain; version=0.0.4; charset=utf-8");
});

await app.RunAsync();

public sealed record SeedVoucherHttpRequest(
    string Code,
    long FaceValueVnd = 500_000,
    int InitialStock = 1,
    string? CampaignName = null
);

public sealed record RedeemVoucherHttpRequest(
    string? CustomerId = null,
    string? StoreCode = null
);

public partial class Program;

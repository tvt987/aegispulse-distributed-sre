using System.Text;
using System.Text.Json.Serialization;
using AegisPulse.Domain.Sql;
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
builder.Services.AddSingleton<QuorumFailoverEvaluator>();
builder.Services.AddSingleton<SqlExecutionPlanAdvisor>();
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
        version = "5.0.0",
        runtime = $".NET {Environment.Version}",
        architecture = "Redis Lua Atomic Gate + SQL Server ROWVERSION + Covering Index Dapper + 5-Region Raft",
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
        version = "5.0.0",
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

app.MapPost("/api/v1/sql/execution-plan", (
    [FromBody] SqlExecutionPlanHttpRequest? request,
    SqlExecutionPlanAdvisor advisor) =>
{
    var tableRowCount = request?.TableRowCount ?? SqlExecutionPlanAdvisor.DefaultTableRowCount;
    var concurrencyRps = request?.ConcurrencyRps ?? SqlExecutionPlanAdvisor.DefaultConcurrencyRps;

    if (tableRowCount <= 0)
    {
        return Results.Problem(
            title: "Invalid Table Row Count",
            detail: "TableRowCount must be a positive integer (e.g., 5000000).",
            statusCode: StatusCodes.Status400BadRequest);
    }

    if (concurrencyRps <= 0)
    {
        return Results.Problem(
            title: "Invalid Concurrency Load",
            detail: "ConcurrencyRps must be a positive integer (e.g., 5000).",
            statusCode: StatusCodes.Status400BadRequest);
    }

    if (!TryParseSqlStage(request?.Stage, out var parsedStage))
    {
        return Results.Problem(
            title: "Invalid Optimization Stage",
            detail: "Stage must be LegacyEfCoreScan (1), CoveringIndexDapperCas (2), or RedisLuaWriteBehind (3).",
            statusCode: StatusCodes.Status400BadRequest);
    }

    var evaluation = advisor.Evaluate(
        stage: parsedStage,
        tableRowCount: tableRowCount,
        concurrencyRps: concurrencyRps,
        voucherCode: request?.VoucherCode);

    return Results.Ok(evaluation);
});

app.MapPost("/api/v1/cluster/quorum-evaluate", (
    [FromBody] ClusterQuorumEvaluateHttpRequest? request,
    QuorumFailoverEvaluator evaluator) =>
{
    var parsedStates = new Dictionary<string, QuorumRegionHealthState>(StringComparer.OrdinalIgnoreCase);
    if (request?.RegionStates is not null)
    {
        foreach (var kv in request.RegionStates)
        {
            if (!TryParseRegionState(kv.Value, out var healthState))
            {
                return Results.Problem(
                    title: "Invalid Region Health State",
                    detail: $"Unsupported state '{kv.Value}' for region '{kv.Key}'. Expected Online, Partitioned, or HardCrash.",
                    statusCode: StatusCodes.Status400BadRequest);
            }

            parsedStates[kv.Key] = healthState;
        }
    }

    try
    {
        var result = evaluator.Evaluate(new QuorumEvaluationRequest(
            CurrentTerm: request?.CurrentTerm ?? 42,
            PreviousLeaderId: request?.PreviousLeaderId ?? "vn-hcm",
            RegionStates: parsedStates
        ));

        return Results.Ok(result);
    }
    catch (ArgumentException ex)
    {
        return Results.Problem(
            title: "Invalid Region Identifier",
            detail: ex.Message,
            statusCode: StatusCodes.Status400BadRequest);
    }
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

public sealed record SqlExecutionPlanHttpRequest(
    string? Stage = null,
    long? TableRowCount = null,
    int? ConcurrencyRps = null,
    string? VoucherCode = null
);

public sealed record ClusterQuorumEvaluateHttpRequest(
    long? CurrentTerm = null,
    string? PreviousLeaderId = null,
    Dictionary<string, string>? RegionStates = null
);

public partial class Program
{
    private static bool TryParseSqlStage(string? raw, out SqlOptimizationStage stage)
    {
        if (string.IsNullOrWhiteSpace(raw))
        {
            stage = SqlOptimizationStage.CoveringIndexDapperCas;
            return true;
        }

        var normalized = raw.Trim().Replace("-", "").Replace("_", "");
        if (normalized is "1" or "stage1" or "legacy" or "legacyefcorescan" or "efcore")
        {
            stage = SqlOptimizationStage.LegacyEfCoreScan;
            return true;
        }

        if (normalized is "2" or "stage2" or "covering" or "coveringindexdappercas" or "dapper")
        {
            stage = SqlOptimizationStage.CoveringIndexDapperCas;
            return true;
        }

        if (normalized is "3" or "stage3" or "redis" or "redisluawritebehind" or "lua")
        {
            stage = SqlOptimizationStage.RedisLuaWriteBehind;
            return true;
        }

        return Enum.TryParse(raw.Trim(), ignoreCase: true, out stage);
    }

    private static bool TryParseRegionState(string? raw, out QuorumRegionHealthState state)
    {
        if (string.IsNullOrWhiteSpace(raw))
        {
            state = QuorumRegionHealthState.Online;
            return true;
        }

        var normalized = raw.Trim().Replace("_", "").Replace("-", "").Replace(" ", "");
        if (normalized.Equals("online", StringComparison.OrdinalIgnoreCase))
        {
            state = QuorumRegionHealthState.Online;
            return true;
        }

        if (normalized.Equals("partitioned", StringComparison.OrdinalIgnoreCase))
        {
            state = QuorumRegionHealthState.Partitioned;
            return true;
        }

        if (normalized.Equals("hardcrash", StringComparison.OrdinalIgnoreCase) ||
            normalized.Equals("crashed", StringComparison.OrdinalIgnoreCase))
        {
            state = QuorumRegionHealthState.HardCrash;
            return true;
        }

        state = default;
        return false;
    }
}

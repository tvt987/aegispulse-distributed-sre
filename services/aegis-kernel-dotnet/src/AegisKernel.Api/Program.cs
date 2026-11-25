using System.Text;
using System.Text.Json.Serialization;
using AegisKernel.Core.Domain;
using AegisKernel.Core.Engine;
using Microsoft.AspNetCore.Mvc;

var app = AegisApiHost.BuildApp(args);
await app.RunAsync();

public sealed record CreateOrderHttpRequest(
    string SkuId = "FLASH-SKU-01",
    string UserId = "user-001",
    int Quantity = 1,
    ConcurrencyMode Mode = ConcurrencyMode.AegisLockFreeChannel
);

public sealed record BurstHttpRequest(
    ConcurrencyMode Mode = ConcurrencyMode.AegisLockFreeChannel,
    int ConcurrentRequests = 2500,
    int InitialStock = 300,
    double DuplicateReplayRatio = 0.20,
    ChaosProfile? Chaos = null
);

public sealed record ResetInventoryHttpRequest(
    string SkuId = "FLASH-SKU-01",
    int InitialStock = 500
);

public static class AegisApiHost
{
    public static WebApplication BuildApp(string[] args, int initialStock = 500, int rateLimitRps = 50_000)
    {
        var builder = WebApplication.CreateBuilder(args);

        builder.Services.ConfigureHttpJsonOptions(opts =>
        {
            opts.SerializerOptions.Converters.Add(new JsonStringEnumConverter());
        });
        builder.Services.AddProblemDetails();
        builder.Services.AddCors(opts =>
        {
            opts.AddDefaultPolicy(p => p.AllowAnyOrigin().AllowAnyHeader().AllowAnyMethod());
        });
        builder.Services.AddSingleton(_ => new AegisTransactionEngine(initialStock, rateLimitRps));

        var app = builder.Build();
        app.UseCors();

        app.MapGet("/health", (AegisTransactionEngine engine) =>
        {
            var snap = engine.GetTelemetrySnapshot();
            return Results.Ok(new
            {
                status = "healthy",
                service = "aegis-kernel-dotnet",
                runtime = Environment.Version.ToString(),
                circuitState = snap.CircuitState.ToString(),
                invariantIntact = snap.InvariantIntact,
                timestampUtc = DateTimeOffset.UtcNow
            });
        });

        app.MapPost("/api/v1/orders", async (
            HttpContext http,
            [FromBody] CreateOrderHttpRequest body,
            AegisTransactionEngine engine,
            CancellationToken ct) =>
        {
            var idemHeader = http.Request.Headers["Idempotency-Key"].FirstOrDefault();
            var idemKey = string.IsNullOrWhiteSpace(idemHeader)
                ? $"auto-{Guid.NewGuid():N}"
                : idemHeader.Trim();

            var cmd = new OrderCommand(
                SkuId: string.IsNullOrWhiteSpace(body.SkuId) ? "FLASH-SKU-01" : body.SkuId,
                UserId: string.IsNullOrWhiteSpace(body.UserId) ? "anonymous" : body.UserId,
                Quantity: Math.Max(1, body.Quantity),
                IdempotencyKey: idemKey,
                Mode: body.Mode
            );

            var receipt = await engine.ExecuteOrderAsync(cmd, ct);
            http.Response.Headers["X-Trace-Id"] = receipt.TraceId;
            http.Response.Headers["X-Latency-Us"] = receipt.LatencyMicroseconds.ToString();
            http.Response.Headers["X-Idempotent-Replay"] = receipt.IsIdempotentReplay ? "true" : "false";

            return receipt.Status switch
            {
                OrderOutcomeStatus.Allocated or OrderOutcomeStatus.IdempotentReplay => Results.Ok(receipt),
                OrderOutcomeStatus.PayloadConflict409 => Results.Problem(
                    title: "Idempotency-Key Payload Conflict",
                    detail: "The supplied Idempotency-Key was already used with a different SKU, user, or quantity.",
                    statusCode: StatusCodes.Status409Conflict,
                    extensions: new Dictionary<string, object?> { ["traceId"] = receipt.TraceId }),
                OrderOutcomeStatus.OutOfStock => Results.Problem(
                    title: "Flash-Sale Inventory Exhausted",
                    detail: $"SKU {receipt.SkuId} has 0 remaining units available.",
                    statusCode: StatusCodes.Status422UnprocessableEntity,
                    extensions: new Dictionary<string, object?> { ["traceId"] = receipt.TraceId }),
                OrderOutcomeStatus.RateLimited429 => Results.Problem(
                    title: "Sliding-Window Rate Limit Exceeded",
                    detail: "Token bucket exhausted; retry with exponential backoff.",
                    statusCode: StatusCodes.Status429TooManyRequests,
                    extensions: new Dictionary<string, object?> { ["traceId"] = receipt.TraceId }),
                OrderOutcomeStatus.CircuitOpen503 => Results.Problem(
                    title: "Adaptive Circuit Breaker Open",
                    detail: "Downstream storage protection active; fast-failing to prevent cascading saturation.",
                    statusCode: StatusCodes.Status503ServiceUnavailable,
                    extensions: new Dictionary<string, object?> { ["traceId"] = receipt.TraceId }),
                _ => Results.Conflict(receipt)
            };
        });

        app.MapPost("/api/v1/simulation/burst", async (
            [FromBody] BurstHttpRequest req,
            AegisTransactionEngine engine,
            CancellationToken ct) =>
        {
            var result = await engine.RunBurstSimulationAsync(
                req.Mode,
                req.ConcurrentRequests,
                req.InitialStock,
                req.DuplicateReplayRatio,
                req.Chaos,
                ct);
            return Results.Ok(result);
        });

        app.MapGet("/api/v1/telemetry/snapshot", (string? skuId, AegisTransactionEngine engine) =>
            Results.Ok(engine.GetTelemetrySnapshot(skuId ?? "FLASH-SKU-01")));

        app.MapGet("/api/v1/traces", (int? count, AegisTransactionEngine engine) =>
            Results.Ok(engine.GetRecentTraces(count ?? 20)));

        app.MapPost("/api/v1/chaos/configure", ([FromBody] ChaosProfile profile, AegisTransactionEngine engine) =>
        {
            engine.ConfigureChaos(profile);
            return Results.Ok(new { updated = true, activeChaos = profile });
        });

        app.MapPost("/api/v1/inventory/reset", ([FromBody] ResetInventoryHttpRequest req, AegisTransactionEngine engine) =>
        {
            engine.ResetInventory(req.SkuId, req.InitialStock);
            return Results.Ok(engine.GetTelemetrySnapshot(req.SkuId));
        });

        app.MapGet("/metrics", (AegisTransactionEngine engine) =>
        {
            var s = engine.GetTelemetrySnapshot();
            var sb = new StringBuilder();
            sb.AppendLine("# HELP aegis_requests_total Total transaction requests processed.");
            sb.AppendLine("# TYPE aegis_requests_total counter");
            sb.AppendLine($"aegis_requests_total {s.TotalRequests}");
            sb.AppendLine("# HELP aegis_allocations_confirmed_total Total atomic inventory allocations.");
            sb.AppendLine("# TYPE aegis_allocations_confirmed_total counter");
            sb.AppendLine($"aegis_allocations_confirmed_total {s.ConfirmedAllocations}");
            sb.AppendLine("# HELP aegis_over_allocated_units Double-spend invariant violation counter (must be 0).");
            sb.AppendLine("# TYPE aegis_over_allocated_units gauge");
            sb.AppendLine($"aegis_over_allocated_units {s.OverAllocatedUnits}");
            sb.AppendLine("# HELP aegis_idempotent_replays_total Duplicate retries safely deduplicated.");
            sb.AppendLine("# TYPE aegis_idempotent_replays_total counter");
            sb.AppendLine($"aegis_idempotent_replays_total {s.IdempotentReplays}");
            sb.AppendLine("# HELP aegis_latency_microseconds Latency percentiles in microseconds.");
            sb.AppendLine("# TYPE aegis_latency_microseconds summary");
            sb.AppendLine($"aegis_latency_microseconds{{quantile=\"0.5\"}} {s.P50LatencyUs}");
            sb.AppendLine($"aegis_latency_microseconds{{quantile=\"0.95\"}} {s.P95LatencyUs}");
            sb.AppendLine($"aegis_latency_microseconds{{quantile=\"0.99\"}} {s.P99LatencyUs}");
            return Results.Text(sb.ToString(), "text/plain; version=0.0.4; charset=utf-8");
        });

        return app;
    }
}

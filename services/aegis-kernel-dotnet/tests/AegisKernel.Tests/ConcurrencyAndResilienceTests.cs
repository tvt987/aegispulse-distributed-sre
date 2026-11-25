using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Serialization;
using AegisKernel.Core.Domain;
using AegisKernel.Core.Engine;
using Microsoft.AspNetCore.Hosting.Server;
using Microsoft.AspNetCore.Hosting.Server.Features;
using Microsoft.Extensions.DependencyInjection;
using Xunit;

namespace AegisKernel.Tests;

public sealed class ConcurrencyAndResilienceTests
{
    private static readonly JsonSerializerOptions JsonOpts = new()
    {
        PropertyNameCaseInsensitive = true,
        Converters = { new JsonStringEnumConverter() }
    };

    [Fact]
    public async Task AegisLockFree_1000ConcurrentContenders_ZeroDoubleSpending_ExactStockInvariant()
    {
        await using var engine = new AegisTransactionEngine(initialStock: 100);
        const int contenders = 1_000;

        var tasks = Enumerable.Range(0, contenders).Select(i => Task.Run(() =>
            engine.ExecuteOrderAsync(new OrderCommand(
                SkuId: "FLASH-SKU-01",
                UserId: $"u-{i}",
                Quantity: 1,
                IdempotencyKey: $"idem-unique-{i}",
                Mode: ConcurrencyMode.AegisLockFreeChannel
            )))).ToArray();

        var receipts = await Task.WhenAll(tasks);
        var snap = engine.GetTelemetrySnapshot("FLASH-SKU-01");

        Assert.Equal(100, receipts.Count(r => r.Status == OrderOutcomeStatus.Allocated));
        Assert.Equal(900, receipts.Count(r => r.Status == OrderOutcomeStatus.OutOfStock));
        Assert.Equal(0, snap.RemainingStock);
        Assert.Equal(0, snap.OverAllocatedUnits);
        Assert.True(snap.InvariantIntact);
    }

    [Fact]
    public async Task OptimisticCas_800ConcurrentContenders_ZeroDoubleSpending_ExactStockInvariant()
    {
        await using var engine = new AegisTransactionEngine(initialStock: 75);
        const int contenders = 800;

        var tasks = Enumerable.Range(0, contenders).Select(i => Task.Run(() =>
            engine.ExecuteOrderAsync(new OrderCommand(
                SkuId: "FLASH-SKU-01",
                UserId: $"u-{i}",
                Quantity: 1,
                IdempotencyKey: $"cas-idem-{i}",
                Mode: ConcurrencyMode.OptimisticCas
            )))).ToArray();

        await Task.WhenAll(tasks);
        var snap = engine.GetTelemetrySnapshot("FLASH-SKU-01");

        Assert.Equal(0, snap.OverAllocatedUnits);
        Assert.True(snap.RemainingStock >= 0);
        Assert.Equal(75 - snap.RemainingStock, snap.TotalUnitsAllocated);
        Assert.True(snap.InvariantIntact);
    }

    [Fact]
    public async Task NaiveUnprotected_ReproducesClassicFlashSaleOversellBugUnderContention()
    {
        await using var engine = new AegisTransactionEngine(initialStock: 10);
        engine.ConfigureChaos(new ChaosProfile(InjectedDbLatencyMs: 8));

        var tasks = Enumerable.Range(0, 120).Select(i => Task.Run(() =>
            engine.ExecuteOrderAsync(new OrderCommand(
                SkuId: "FLASH-SKU-01",
                UserId: $"u-{i}",
                Quantity: 1,
                IdempotencyKey: $"naive-{i}",
                Mode: ConcurrencyMode.NaiveUnprotected
            )))).ToArray();

        await Task.WhenAll(tasks);
        var snap = engine.GetTelemetrySnapshot("FLASH-SKU-01");

        Assert.True(snap.OverAllocatedUnits > 0, "Naive mode should exhibit lost-update/TOCTOU over-allocation under concurrency.");
        Assert.False(snap.InvariantIntact);
    }

    [Fact]
    public async Task IdempotencyKey_IdenticalRetryStorm_ChargesExactlyOnceAndReplaysSameOrderId()
    {
        await using var engine = new AegisTransactionEngine(initialStock: 50);

        // 50 simultaneous network retries carrying the exact same Idempotency-Key
        var tasks = Enumerable.Range(0, 50).Select(_ => Task.Run(() =>
            engine.ExecuteOrderAsync(new OrderCommand(
                SkuId: "FLASH-SKU-01",
                UserId: "vip-buyer-01",
                Quantity: 2,
                IdempotencyKey: "retry-storm-key-999",
                Mode: ConcurrencyMode.AegisLockFreeChannel
            )))).ToArray();

        var results = await Task.WhenAll(tasks);
        var distinctOrderIds = results.Select(r => r.OrderId).Distinct().ToList();
        var snap = engine.GetTelemetrySnapshot("FLASH-SKU-01");

        Assert.Single(distinctOrderIds);
        Assert.Equal(48, snap.RemainingStock);
        Assert.Equal(1, snap.ConfirmedAllocations);
        Assert.Equal(49, snap.IdempotentReplays);
    }

    [Fact]
    public async Task IdempotencyKey_MutatedPayloadReuse_Returns409Conflict()
    {
        await using var engine = new AegisTransactionEngine(initialStock: 50);

        var first = await engine.ExecuteOrderAsync(new OrderCommand("FLASH-SKU-01", "user-1", 1, "shared-key-01"));
        var mutated = await engine.ExecuteOrderAsync(new OrderCommand("FLASH-SKU-01", "user-1", 5, "shared-key-01"));

        Assert.Equal(OrderOutcomeStatus.Allocated, first.Status);
        Assert.Equal(OrderOutcomeStatus.PayloadConflict409, mutated.Status);
    }

    [Fact]
    public async Task AdaptiveCircuitBreaker_TripsOnSustainedFailures_AndRecoversAfterCooldown()
    {
        var cb = new AdaptiveCircuitBreaker(failureThreshold: 3, openCooldown: TimeSpan.FromMilliseconds(120));
        Assert.Equal(CircuitState.Closed, cb.CurrentState);

        cb.RecordFailure();
        cb.RecordFailure();
        cb.RecordFailure();

        Assert.Equal(CircuitState.Open, cb.CurrentState);
        Assert.False(cb.AllowRequest());

        await Task.Delay(150);
        Assert.True(cb.AllowRequest());
        Assert.Equal(CircuitState.HalfOpen, cb.CurrentState);

        cb.RecordSuccess();
        Assert.Equal(CircuitState.Closed, cb.CurrentState);
    }

    [Fact]
    public async Task SlidingWindowRateLimiter_EnforcesQuotaCeiling()
    {
        var limiter = new SlidingWindowRateLimiter(maxRequestsPerSecond: 15);
        int allowed = 0;
        for (int i = 0; i < 40; i++)
        {
            if (limiter.TryAcquire()) allowed++;
        }
        Assert.Equal(15, allowed);
    }

    [Fact]
    public async Task LiveKestrelHttpPipeline_EndToEnd_IdempotencyConflictAndPrometheusMetrics()
    {
        var app = AegisApiHost.BuildApp(["--urls=http://127.0.0.1:0"], initialStock: 25, rateLimitRps: 10_000);
        await app.StartAsync();
        try
        {
            var server = app.Services.GetRequiredService<IServer>();
            var baseUrl = server.Features.Get<IServerAddressesFeature>()!.Addresses.First();
            using var client = new HttpClient { BaseAddress = new Uri(baseUrl) };

            var health = await client.GetAsync("/health");
            Assert.Equal(HttpStatusCode.OK, health.StatusCode);

            // First request with Idempotency-Key
            var req1 = new HttpRequestMessage(HttpMethod.Post, "/api/v1/orders")
            {
                Content = JsonContent.Create(new CreateOrderHttpRequest("FLASH-SKU-01", "alice", 2, ConcurrencyMode.AegisLockFreeChannel))
            };
            req1.Headers.Add("Idempotency-Key", "http-idem-001");
            var resp1 = await client.SendAsync(req1);
            Assert.Equal(HttpStatusCode.OK, resp1.StatusCode);
            Assert.Equal("false", resp1.Headers.GetValues("X-Idempotent-Replay").First());
            var body1 = await resp1.Content.ReadFromJsonAsync<TransactionReceipt>(JsonOpts);
            Assert.NotNull(body1);
            Assert.Equal(23, body1.RemainingStockAfter);

            // Duplicate replay with identical payload -> 200 OK + X-Idempotent-Replay: true + same OrderId
            var req2 = new HttpRequestMessage(HttpMethod.Post, "/api/v1/orders")
            {
                Content = JsonContent.Create(new CreateOrderHttpRequest("FLASH-SKU-01", "alice", 2, ConcurrencyMode.AegisLockFreeChannel))
            };
            req2.Headers.Add("Idempotency-Key", "http-idem-001");
            var resp2 = await client.SendAsync(req2);
            Assert.Equal(HttpStatusCode.OK, resp2.StatusCode);
            Assert.Equal("true", resp2.Headers.GetValues("X-Idempotent-Replay").First());
            var body2 = await resp2.Content.ReadFromJsonAsync<TransactionReceipt>(JsonOpts);
            Assert.Equal(body1.OrderId, body2!.OrderId);

            // Mutated quantity with same Idempotency-Key -> 409 Conflict ProblemDetails
            var req3 = new HttpRequestMessage(HttpMethod.Post, "/api/v1/orders")
            {
                Content = JsonContent.Create(new CreateOrderHttpRequest("FLASH-SKU-01", "alice", 9, ConcurrencyMode.AegisLockFreeChannel))
            };
            req3.Headers.Add("Idempotency-Key", "http-idem-001");
            var resp3 = await client.SendAsync(req3);
            Assert.Equal(HttpStatusCode.Conflict, resp3.StatusCode);

            // Prometheus scrape endpoint
            var metricsTxt = await client.GetStringAsync("/metrics");
            Assert.Contains("aegis_over_allocated_units 0", metricsTxt);
            Assert.Contains("aegis_idempotent_replays_total 1", metricsTxt);
        }
        finally
        {
            await app.StopAsync();
            await app.DisposeAsync();
        }
    }
}

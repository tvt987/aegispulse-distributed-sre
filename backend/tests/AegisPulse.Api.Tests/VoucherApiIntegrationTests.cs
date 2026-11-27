using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Serialization;
using AegisPulse.Domain.Sre;
using AegisPulse.Domain.Vouchers;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.DependencyInjection;
using Xunit;

namespace AegisPulse.Api.Tests;

public sealed class VoucherApiIntegrationTests
{
    private static readonly JsonSerializerOptions JsonOpts = new()
    {
        PropertyNameCaseInsensitive = true,
        Converters = { new JsonStringEnumConverter() }
    };

    private static WebApplicationFactory<Program> CreateIsolatedFactory() => new();

    [Fact]
    public async Task FiftyWayConcurrentHttpRace_SingleVoucher_StrictlyOne200OkAndFortyNine409Conflict_ZeroDoubleSpend()
    {
        using var factory = CreateIsolatedFactory();
        using var client = factory.CreateClient();

        var voucherCode = $"RACE50-{Guid.NewGuid():N}"[..16].ToUpperInvariant();
        var seedResponse = await client.PostAsJsonAsync("/api/v1/vouchers/seed", new
        {
            code = voucherCode,
            faceValueVnd = 500_000,
            initialStock = 1,
            campaignName = "Con Cung 50-Way Flash-Sale Race Test"
        });
        Assert.Equal(HttpStatusCode.Created, seedResponse.StatusCode);

        // Fire 50 simultaneous HTTP POST requests contending for stock = 1
        var tasks = Enumerable.Range(0, 50).Select(i => Task.Run(async () =>
        {
            using var req = new HttpRequestMessage(HttpMethod.Post, $"/api/v1/vouchers/{voucherCode}/redeem")
            {
                Content = JsonContent.Create(new
                {
                    customerId = $"cust-{i:D3}",
                    storeCode = $"STORE-{(i % 700) + 1:D3}"
                })
            };
            req.Headers.Add("Idempotency-Key", $"race50-idem-{voucherCode}-{i:D3}");
            return await client.SendAsync(req);
        })).ToArray();

        var responses = await Task.WhenAll(tasks);

        var okResponses = responses.Where(r => r.StatusCode == HttpStatusCode.OK).ToList();
        var conflictResponses = responses.Where(r => r.StatusCode == HttpStatusCode.Conflict).ToList();

        Assert.Single(okResponses);
        Assert.Equal(49, conflictResponses.Count);

        var winnerReceipt = await okResponses[0].Content.ReadFromJsonAsync<VoucherRedemptionReceipt>(JsonOpts);
        Assert.NotNull(winnerReceipt);
        Assert.Equal(0, winnerReceipt.RemainingStockAfter);
        Assert.Equal(500_000, winnerReceipt.FaceValueVnd);
        Assert.False(winnerReceipt.IsIdempotentReplay);
        Assert.Equal("0x0000000000000002", winnerReceipt.RowVersionHex);

        // Verify immutable audit ledger
        var auditResp = await client.GetAsync($"/api/v1/vouchers/{voucherCode}/audit");
        Assert.Equal(HttpStatusCode.OK, auditResp.StatusCode);
        var audit = await auditResp.Content.ReadFromJsonAsync<VoucherAuditSnapshot>(JsonOpts);
        Assert.NotNull(audit);
        Assert.Equal(1, audit.InitialStock);
        Assert.Equal(0, audit.RemainingStock);
        Assert.Equal(1, audit.ApprovedRedemptions);
        Assert.Equal(49, audit.RejectedConflicts409);
        Assert.Equal(0, audit.DoubleSpendCount);
        Assert.True(audit.InvariantIntact);
    }

    [Fact]
    public async Task HundredWayConcurrentHttpRace_StockFive_StrictlyFiveApprovedAndNinetyFiveConflicts()
    {
        using var factory = CreateIsolatedFactory();
        using var client = factory.CreateClient();

        var voucherCode = $"RACE100-{Guid.NewGuid():N}"[..16].ToUpperInvariant();
        var seedResp = await client.PostAsJsonAsync("/api/v1/vouchers/seed", new
        {
            code = voucherCode,
            faceValueVnd = 500_000,
            initialStock = 5
        });
        Assert.Equal(HttpStatusCode.Created, seedResp.StatusCode);

        var tasks = Enumerable.Range(0, 100).Select(i => Task.Run(async () =>
        {
            using var req = new HttpRequestMessage(HttpMethod.Post, $"/api/v1/vouchers/{voucherCode}/redeem")
            {
                Content = JsonContent.Create(new { customerId = $"buyer-{i}", storeCode = $"STORE-{(i % 700) + 1:D3}" })
            };
            req.Headers.Add("Idempotency-Key", $"race100-{voucherCode}-{i}");
            return await client.SendAsync(req);
        })).ToArray();

        var responses = await Task.WhenAll(tasks);

        Assert.Equal(5, responses.Count(r => r.StatusCode == HttpStatusCode.OK));
        Assert.Equal(95, responses.Count(r => r.StatusCode == HttpStatusCode.Conflict));

        var audit = await client.GetFromJsonAsync<VoucherAuditSnapshot>($"/api/v1/vouchers/{voucherCode}/audit", JsonOpts);
        Assert.NotNull(audit);
        Assert.Equal(5, audit.ApprovedRedemptions);
        Assert.Equal(0, audit.RemainingStock);
        Assert.Equal(0, audit.DoubleSpendCount);
        Assert.True(audit.InvariantIntact);
        Assert.Equal(6UL, audit.CurrentRowVersion);
    }

    [Fact]
    public async Task IdempotentRetry_DuplicateHeaderReturns200CachedReplayWithoutDecrementingTwice()
    {
        using var factory = CreateIsolatedFactory();
        using var client = factory.CreateClient();

        var voucherCode = $"IDEM-{Guid.NewGuid():N}"[..14].ToUpperInvariant();
        await client.PostAsJsonAsync("/api/v1/vouchers/seed", new
        {
            code = voucherCode,
            faceValueVnd = 500_000,
            initialStock = 3
        });

        using var req1 = new HttpRequestMessage(HttpMethod.Post, $"/api/v1/vouchers/{voucherCode}/redeem")
        {
            Content = JsonContent.Create(new { customerId = "vip-mom-001", storeCode = "STORE-088" })
        };
        req1.Headers.Add("Idempotency-Key", "retry-key-001");
        var resp1 = await client.SendAsync(req1);
        Assert.Equal(HttpStatusCode.OK, resp1.StatusCode);
        Assert.Equal("false", resp1.Headers.GetValues("X-Idempotent-Replay").First());
        var receipt1 = await resp1.Content.ReadFromJsonAsync<VoucherRedemptionReceipt>(JsonOpts);
        Assert.NotNull(receipt1);
        Assert.Equal(2, receipt1.RemainingStockAfter);

        // Retry identical request with identical Idempotency-Key
        using var req2 = new HttpRequestMessage(HttpMethod.Post, $"/api/v1/vouchers/{voucherCode}/redeem")
        {
            Content = JsonContent.Create(new { customerId = "vip-mom-001", storeCode = "STORE-088" })
        };
        req2.Headers.Add("Idempotency-Key", "retry-key-001");
        var resp2 = await client.SendAsync(req2);
        Assert.Equal(HttpStatusCode.OK, resp2.StatusCode);
        Assert.Equal("true", resp2.Headers.GetValues("X-Idempotent-Replay").First());
        var receipt2 = await resp2.Content.ReadFromJsonAsync<VoucherRedemptionReceipt>(JsonOpts);
        Assert.NotNull(receipt2);

        Assert.Equal(receipt1.RedemptionId, receipt2.RedemptionId);
        Assert.Equal(receipt1.RowVersion, receipt2.RowVersion);
        Assert.True(receipt2.IsIdempotentReplay);

        var audit = await client.GetFromJsonAsync<VoucherAuditSnapshot>($"/api/v1/vouchers/{voucherCode}/audit", JsonOpts);
        Assert.NotNull(audit);
        Assert.Equal(2, audit.RemainingStock);
        Assert.Equal(1, audit.ApprovedRedemptions);
        Assert.Equal(1, audit.IdempotentReplays);
        Assert.True(audit.InvariantIntact);
    }

    [Fact]
    public async Task ConcurrentIdempotentRetryStorm_25IdenticalRetries_ShareSingleRedemptionIdAndSingleStockDecrement()
    {
        using var factory = CreateIsolatedFactory();
        using var client = factory.CreateClient();

        var voucherCode = $"STORM-{Guid.NewGuid():N}"[..14].ToUpperInvariant();
        await client.PostAsJsonAsync("/api/v1/vouchers/seed", new
        {
            code = voucherCode,
            faceValueVnd = 500_000,
            initialStock = 10
        });

        var tasks = Enumerable.Range(0, 25).Select(_ => Task.Run(async () =>
        {
            using var req = new HttpRequestMessage(HttpMethod.Post, $"/api/v1/vouchers/{voucherCode}/redeem")
            {
                Content = JsonContent.Create(new { customerId = "mobile-retry-user", storeCode = "STORE-312" })
            };
            req.Headers.Add("Idempotency-Key", "storm-idem-key-777");
            var resp = await client.SendAsync(req);
            Assert.Equal(HttpStatusCode.OK, resp.StatusCode);
            return await resp.Content.ReadFromJsonAsync<VoucherRedemptionReceipt>(JsonOpts);
        })).ToArray();

        var receipts = await Task.WhenAll(tasks);
        Assert.Single(receipts.Select(r => r!.RedemptionId).Distinct());
        Assert.Equal(1, receipts.Count(r => !r!.IsIdempotentReplay));
        Assert.Equal(24, receipts.Count(r => r!.IsIdempotentReplay));

        var audit = await client.GetFromJsonAsync<VoucherAuditSnapshot>($"/api/v1/vouchers/{voucherCode}/audit", JsonOpts);
        Assert.NotNull(audit);
        Assert.Equal(9, audit.RemainingStock);
        Assert.Equal(1, audit.ApprovedRedemptions);
        Assert.Equal(24, audit.IdempotentReplays);
    }

    [Fact]
    public async Task IdempotencyKeyReusedWithMutatedPayload_Returns409Conflict()
    {
        using var factory = CreateIsolatedFactory();
        using var client = factory.CreateClient();

        var voucherCode = $"MUT-{Guid.NewGuid():N}"[..14].ToUpperInvariant();
        await client.PostAsJsonAsync("/api/v1/vouchers/seed", new { code = voucherCode, faceValueVnd = 500_000, initialStock = 5 });

        using var req1 = new HttpRequestMessage(HttpMethod.Post, $"/api/v1/vouchers/{voucherCode}/redeem")
        {
            Content = JsonContent.Create(new { customerId = "customer-A", storeCode = "STORE-001" })
        };
        req1.Headers.Add("Idempotency-Key", "shared-mutated-key");
        var resp1 = await client.SendAsync(req1);
        Assert.Equal(HttpStatusCode.OK, resp1.StatusCode);

        // Reuse same Idempotency-Key for a different customer -> 409 Conflict
        using var req2 = new HttpRequestMessage(HttpMethod.Post, $"/api/v1/vouchers/{voucherCode}/redeem")
        {
            Content = JsonContent.Create(new { customerId = "customer-B", storeCode = "STORE-001" })
        };
        req2.Headers.Add("Idempotency-Key", "shared-mutated-key");
        var resp2 = await client.SendAsync(req2);
        Assert.Equal(HttpStatusCode.Conflict, resp2.StatusCode);
    }

    [Fact]
    public async Task MissingIdempotencyKeyHeader_Returns400BadRequestProblemDetails()
    {
        using var factory = CreateIsolatedFactory();
        using var client = factory.CreateClient();

        var resp = await client.PostAsJsonAsync("/api/v1/vouchers/CONCUNG-VIP-500K/redeem", new
        {
            customerId = "cust-no-key",
            storeCode = "STORE-010"
        });

        Assert.Equal(HttpStatusCode.BadRequest, resp.StatusCode);
        var body = await resp.Content.ReadAsStringAsync();
        Assert.Contains("Idempotency-Key", body);
    }

    [Fact]
    public async Task WhitespaceOnlyIdempotencyKeyHeader_Returns400BadRequest()
    {
        using var factory = CreateIsolatedFactory();
        using var client = factory.CreateClient();

        using var req = new HttpRequestMessage(HttpMethod.Post, "/api/v1/vouchers/CONCUNG-VIP-500K/redeem")
        {
            Content = JsonContent.Create(new { customerId = "cust-blank", storeCode = "STORE-010" })
        };
        req.Headers.Add("Idempotency-Key", "   ");
        var resp = await client.SendAsync(req);

        Assert.Equal(HttpStatusCode.BadRequest, resp.StatusCode);
    }

    [Fact]
    public async Task UnknownVoucherCode_Returns404OnRedeemAndAudit()
    {
        using var factory = CreateIsolatedFactory();
        using var client = factory.CreateClient();

        using var req = new HttpRequestMessage(HttpMethod.Post, "/api/v1/vouchers/NON-EXISTENT-999/redeem")
        {
            Content = JsonContent.Create(new { customerId = "cust-1", storeCode = "STORE-001" })
        };
        req.Headers.Add("Idempotency-Key", "unknown-voucher-key");
        var redeemResp = await client.SendAsync(req);
        Assert.Equal(HttpStatusCode.NotFound, redeemResp.StatusCode);

        var auditResp = await client.GetAsync("/api/v1/vouchers/NON-EXISTENT-999/audit");
        Assert.Equal(HttpStatusCode.NotFound, auditResp.StatusCode);
    }

    [Fact]
    public async Task SeedVoucherValidation_RejectsEmptyCodeOrZeroStockWith400()
    {
        using var factory = CreateIsolatedFactory();
        using var client = factory.CreateClient();

        var emptyCodeResp = await client.PostAsJsonAsync("/api/v1/vouchers/seed", new
        {
            code = "",
            faceValueVnd = 500_000,
            initialStock = 1
        });
        Assert.Equal(HttpStatusCode.BadRequest, emptyCodeResp.StatusCode);

        var zeroStockResp = await client.PostAsJsonAsync("/api/v1/vouchers/seed", new
        {
            code = "ZERO-STOCK",
            faceValueVnd = 500_000,
            initialStock = 0
        });
        Assert.Equal(HttpStatusCode.BadRequest, zeroStockResp.StatusCode);
    }

    [Fact]
    public async Task HealthAndPrometheusMetricsEndpoints_ReturnHealthyInvariantTelemetry()
    {
        using var factory = CreateIsolatedFactory();
        using var client = factory.CreateClient();

        var healthResp = await client.GetAsync("/health");
        Assert.Equal(HttpStatusCode.OK, healthResp.StatusCode);
        var healthJson = await healthResp.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("healthy", healthJson.GetProperty("status").GetString());
        Assert.Equal("5.0.0", healthJson.GetProperty("version").GetString());
        Assert.True(healthJson.GetProperty("invariantIntact").GetBoolean());
        Assert.Equal(0, healthJson.GetProperty("doubleSpendCount").GetInt32());

        var metricsText = await client.GetStringAsync("/metrics");
        Assert.Contains("aegispulse_voucher_double_spend_leaks 0", metricsText);
        Assert.Contains("aegispulse_raft_quorum_healthy 1", metricsText);
    }

    [Fact]
    public async Task SreClusterStatusEndpoint_Returns5RegionRaftQuorumAndConCungSloTargets()
    {
        using var factory = CreateIsolatedFactory();
        using var client = factory.CreateClient();

        var resp = await client.GetAsync("/api/v1/sre/cluster-status");
        Assert.Equal(HttpStatusCode.OK, resp.StatusCode);

        var payload = await resp.Content.ReadFromJsonAsync<JsonElement>();
        var raft = payload.GetProperty("raft");
        Assert.Equal("HEALTHY", raft.GetProperty("quorumStatus").GetString());
        Assert.Equal(5, raft.GetProperty("totalNodes").GetInt32());
        Assert.Equal(3, raft.GetProperty("quorumRequired").GetInt32());
        Assert.Equal("ap-southeast-1", raft.GetProperty("leaderRegionId").GetString());
        Assert.Equal(5, raft.GetProperty("regions").GetArrayLength());

        var slo = payload.GetProperty("slo");
        Assert.Equal(5000, slo.GetProperty("targetRps").GetInt32());
        Assert.Equal(700, slo.GetProperty("storeFootprint").GetInt32());
    }

    [Fact]
    public async Task CircuitBreakerOpen_ShedsRedeemTrafficWith503ServiceUnavailable()
    {
        using var factory = CreateIsolatedFactory();
        var cb = factory.Services.GetRequiredService<CircuitBreakerStateMachine>();
        cb.ForceOpen();

        using var client = factory.CreateClient();
        using var req = new HttpRequestMessage(HttpMethod.Post, "/api/v1/vouchers/CONCUNG-VIP-500K/redeem")
        {
            Content = JsonContent.Create(new { customerId = "cust-cb", storeCode = "STORE-700" })
        };
        req.Headers.Add("Idempotency-Key", "cb-open-test-key");

        var resp = await client.SendAsync(req);
        Assert.Equal(HttpStatusCode.ServiceUnavailable, resp.StatusCode);
    }
}

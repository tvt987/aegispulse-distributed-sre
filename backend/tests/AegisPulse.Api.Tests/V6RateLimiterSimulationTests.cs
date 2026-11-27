using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Serialization;
using AegisPulse.Domain.RateLimiting;
using Microsoft.AspNetCore.Mvc.Testing;
using Xunit;

namespace AegisPulse.Api.Tests;

public sealed class V6RateLimiterSimulationTests
{
    private static readonly JsonSerializerOptions JsonOpts = new()
    {
        PropertyNameCaseInsensitive = true,
        Converters = { new JsonStringEnumConverter() }
    };

    private static WebApplicationFactory<Program> CreateFactory() => new();

    [Fact]
    public void BoundaryFlashSpike_ProvesFixedWindow2xOvershootWhileSlidingWindowHoldsZeroOvershoot()
    {
        var simulator = new RateLimiterSimulator();
        var result = simulator.Simulate(new RateLimitSimulationRequest(
            BurstIntensityRps: 600,
            BucketCapacity: 240,
            RefillRatePerSecond: 200,
            Scenario: RateLimitTrafficScenario.BoundaryFlashSpike,
            ShardCount: 25
        ));

        Assert.Equal(20, result.DurationSeconds);
        Assert.Equal(500, result.SlotDurationMs);
        Assert.Equal(40, result.TotalSlots);
        Assert.Equal(5_000, result.ClusterGatewayCapRps);

        // Fixed Window suffers a 2.00x boundary reset leak across [4.5s..5.5s) and [12.5s..13.5s)
        Assert.True(result.FixedWindow.TotalBoundaryOvershoot >= 300);
        Assert.Equal(400, result.FixedWindow.PeakRolling1sAllowed);
        Assert.Equal(2.0, result.FixedWindow.PeakMultiplierVsLimit);
        Assert.False(result.FixedWindow.StrictCapPreserved);
        Assert.Equal(10_000, result.ClusterPeakFixedWindowRps);

        // Redis Sliding-Window Log maintains strict 0 overshoot across all 40 slots
        Assert.Equal(0, result.SlidingWindowLog.TotalBoundaryOvershoot);
        Assert.True(result.SlidingWindowLog.PeakRolling1sAllowed <= 200);
        Assert.True(result.SlidingWindowLog.StrictCapPreserved);
        Assert.Equal(5_000, result.ClusterPeakSlidingWindowRps);

        // Token Bucket absorbs controlled burst smoothly without fixed-window boundary reset bug
        Assert.Equal(0, result.TokenBucket.TotalBoundaryOvershoot);
        Assert.True(result.TokenBucket.BurstAbsorbedCount > 0);
        Assert.True(result.TokenBucket.TotalAllowed200 > 0);
    }

    [Fact]
    public void AllThreeAlgorithms_PreserveStrictRequestConservationPerSlotAndAggregate()
    {
        var simulator = new RateLimiterSimulator();
        var result = simulator.Simulate(new RateLimitSimulationRequest(
            BurstIntensityRps: 850,
            BucketCapacity: 300,
            RefillRatePerSecond: 180,
            Scenario: RateLimitTrafficScenario.BoundaryFlashSpike
        ));

        foreach (var report in new[] { result.FixedWindow, result.TokenBucket, result.SlidingWindowLog })
        {
            Assert.Equal(40, report.Slots.Count);
            Assert.Equal(report.TotalIncoming, report.TotalAllowed200 + report.TotalThrottled429);
            Assert.Equal(report.TotalIncoming, report.Slots.Sum(s => s.IncomingRequests));
            Assert.Equal(report.TotalAllowed200, report.Slots.Sum(s => s.Allowed200));
            Assert.Equal(report.TotalThrottled429, report.Slots.Sum(s => s.Throttled429));
            Assert.Equal(report.TotalBoundaryOvershoot, report.Slots.Sum(s => s.BoundaryOvershoot));

            foreach (var slot in report.Slots)
            {
                Assert.Equal(slot.IncomingRequests, slot.Allowed200 + slot.Throttled429);
                Assert.Equal(slot.Allowed200, slot.AllowedWithinCap + slot.BoundaryOvershoot);
                Assert.True(slot.Allowed200 >= 0 && slot.Throttled429 >= 0 && slot.BoundaryOvershoot >= 0);
            }
        }
    }

    [Theory]
    [InlineData(100, 50, 50)]
    [InlineData(450, 150, 120)]
    [InlineData(750, 280, 200)]
    [InlineData(1000, 400, 300)]
    public void SlidingWindowLog_NeverExceedsRefillRateAcrossAnyConsecutive1sPair(
        int burstRps,
        int bucketCapacity,
        int refillRate)
    {
        var simulator = new RateLimiterSimulator();
        var result = simulator.Simulate(new RateLimitSimulationRequest(
            BurstIntensityRps: burstRps,
            BucketCapacity: bucketCapacity,
            RefillRatePerSecond: refillRate,
            Scenario: RateLimitTrafficScenario.BoundaryFlashSpike
        ));

        var slots = result.SlidingWindowLog.Slots;
        Assert.Equal(0, result.SlidingWindowLog.TotalBoundaryOvershoot);
        Assert.True(result.SlidingWindowLog.PeakRolling1sAllowed <= refillRate);

        for (var i = 0; i < slots.Count; i++)
        {
            var prevAllowed = i == 0 ? 0 : slots[i - 1].Allowed200;
            var rolling = prevAllowed + slots[i].Allowed200;
            Assert.Equal(rolling, slots[i].Rolling1sAllowed);
            Assert.True(rolling <= refillRate, $"Slot {i} breached rolling cap: {rolling} > {refillRate}");
            Assert.Equal(0, slots[i].BoundaryOvershoot);
        }
    }

    [Fact]
    public void TokenBucket_MaintainsTokenBoundsAndScalesBurstAbsorptionWithCapacity()
    {
        var simulator = new RateLimiterSimulator();
        var smallTank = simulator.Simulate(new RateLimitSimulationRequest(
            BurstIntensityRps: 700,
            BucketCapacity: 100,
            RefillRatePerSecond: 150,
            Scenario: RateLimitTrafficScenario.BoundaryFlashSpike
        ));
        var largeTank = simulator.Simulate(new RateLimitSimulationRequest(
            BurstIntensityRps: 700,
            BucketCapacity: 350,
            RefillRatePerSecond: 150,
            Scenario: RateLimitTrafficScenario.BoundaryFlashSpike
        ));

        Assert.All(smallTank.TokenBucket.Slots, s => Assert.InRange(s.TokensRemainingAfter, 0, 100));
        Assert.All(largeTank.TokenBucket.Slots, s => Assert.InRange(s.TokensRemainingAfter, 0, 350));
        Assert.True(largeTank.TokenBucket.BurstAbsorbedCount > smallTank.TokenBucket.BurstAbsorbedCount);
        Assert.True(largeTank.TokenBucket.TotalAllowed200 > smallTank.TokenBucket.TotalAllowed200);
    }

    [Fact]
    public void RetryAfterHeaders_EmittedStrictlyOnThrottled429SlotsOnly()
    {
        var simulator = new RateLimiterSimulator();
        var result = simulator.Simulate(new RateLimitSimulationRequest(
            BurstIntensityRps: 700,
            BucketCapacity: 200,
            RefillRatePerSecond: 200,
            Scenario: RateLimitTrafficScenario.BoundaryFlashSpike
        ));

        foreach (var report in new[] { result.FixedWindow, result.TokenBucket, result.SlidingWindowLog })
        {
            Assert.Contains(report.Slots, s => s.Throttled429 > 0);
            foreach (var slot in report.Slots)
            {
                if (slot.Throttled429 > 0)
                {
                    Assert.True(slot.RetryAfterMs > 0);
                }
                else
                {
                    Assert.Equal(0, slot.RetryAfterMs);
                }
            }
        }
    }

    [Fact]
    public void OrganicPosTraffic_AdmitsCleanlyWithZeroOvershootAcrossAllAlgorithms()
    {
        var simulator = new RateLimiterSimulator();
        var result = simulator.Simulate(new RateLimitSimulationRequest(
            BurstIntensityRps: 500,
            BucketCapacity: 200,
            RefillRatePerSecond: 200,
            Scenario: RateLimitTrafficScenario.OrganicPosTraffic
        ));

        Assert.Equal(0, result.FixedWindow.TotalBoundaryOvershoot);
        Assert.Equal(0, result.TokenBucket.TotalBoundaryOvershoot);
        Assert.Equal(0, result.SlidingWindowLog.TotalBoundaryOvershoot);
        Assert.Equal(100.0, result.SlidingWindowLog.AdmissionRatePct);
        Assert.Equal(100.0, result.TokenBucket.AdmissionRatePct);
    }

    [Fact]
    public void SustainedWaveScenario_EngagesContinuousBackpressureWhileProtectingSlidingCap()
    {
        var simulator = new RateLimiterSimulator();
        var result = simulator.Simulate(new RateLimitSimulationRequest(
            BurstIntensityRps: 800,
            BucketCapacity: 250,
            RefillRatePerSecond: 200,
            Scenario: RateLimitTrafficScenario.SustainedWave
        ));

        Assert.True(result.SlidingWindowLog.TotalThrottled429 > 1_000);
        Assert.Equal(0, result.SlidingWindowLog.TotalBoundaryOvershoot);
        Assert.True(result.TokenBucket.MinTokensObserved <= 10);
        Assert.True(result.FixedWindow.PeakRolling1sAllowed >= result.SlidingWindowLog.PeakRolling1sAllowed);
    }

    [Fact]
    public async Task RateLimitSimulateEndpoint_DefaultBoundarySpike_Returns200WithOvershootProof()
    {
        using var factory = CreateFactory();
        using var client = factory.CreateClient();

        var response = await client.PostAsJsonAsync("/api/v1/ratelimit/simulate", new { });
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);

        var payload = await response.Content.ReadFromJsonAsync<RateLimitSimulationResult>(JsonOpts);
        Assert.NotNull(payload);
        Assert.Equal(20, payload.DurationSeconds);
        Assert.Equal(40, payload.TotalSlots);
        Assert.Equal(RateLimitTrafficScenario.BoundaryFlashSpike, payload.Scenario);
        Assert.Equal(5_000, payload.ClusterGatewayCapRps);
        Assert.True(payload.FixedWindow.TotalBoundaryOvershoot > 0);
        Assert.Equal(0, payload.SlidingWindowLog.TotalBoundaryOvershoot);
        Assert.True(payload.SlidingWindowLog.StrictCapPreserved);
    }

    [Fact]
    public async Task RateLimitSimulateEndpoint_SupportsCustomParametersAndScenarioAliases()
    {
        using var factory = CreateFactory();
        using var client = factory.CreateClient();

        var response = await client.PostAsJsonAsync("/api/v1/ratelimit/simulate", new
        {
            burstIntensityRps = 900,
            bucketCapacity = 320,
            refillRatePerSecond = 250,
            scenario = "2x-spike",
            shardCount = 20
        });

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var payload = await response.Content.ReadFromJsonAsync<RateLimitSimulationResult>(JsonOpts);
        Assert.NotNull(payload);
        Assert.Equal(900, payload.BurstIntensityRps);
        Assert.Equal(320, payload.BucketCapacity);
        Assert.Equal(250, payload.RefillRatePerSecond);
        Assert.Equal(5_000, payload.ClusterGatewayCapRps);
        Assert.Equal(RateLimitTrafficScenario.BoundaryFlashSpike, payload.Scenario);
        Assert.True(payload.FixedWindow.PeakRolling1sAllowed > 250);
        Assert.True(payload.SlidingWindowLog.PeakRolling1sAllowed <= 250);
    }

    [Fact]
    public async Task RateLimitSimulateEndpoint_RejectsOutOfRangeParametersAndUnknownScenarioWith400ProblemDetails()
    {
        using var factory = CreateFactory();
        using var client = factory.CreateClient();

        var invalidPayloads = new object[]
        {
            new { burstIntensityRps = 50, bucketCapacity = 200, refillRatePerSecond = 200 },
            new { burstIntensityRps = 1500, bucketCapacity = 200, refillRatePerSecond = 200 },
            new { burstIntensityRps = 600, bucketCapacity = 20, refillRatePerSecond = 200 },
            new { burstIntensityRps = 600, bucketCapacity = 900, refillRatePerSecond = 200 },
            new { burstIntensityRps = 600, bucketCapacity = 200, refillRatePerSecond = 10 },
            new { burstIntensityRps = 600, bucketCapacity = 200, refillRatePerSecond = 500 },
            new { burstIntensityRps = 600, bucketCapacity = 200, refillRatePerSecond = 200, scenario = "quantum-chaos" }
        };

        foreach (var bad in invalidPayloads)
        {
            var resp = await client.PostAsJsonAsync("/api/v1/ratelimit/simulate", bad);
            Assert.Equal(HttpStatusCode.BadRequest, resp.StatusCode);
            var body = await resp.Content.ReadAsStringAsync();
            Assert.Contains("title", body, StringComparison.OrdinalIgnoreCase);
        }
    }

    [Fact]
    public async Task RateLimitSimulateEndpoint_IsStrictlyDeterministicAcrossRepeatedCalls()
    {
        using var factory = CreateFactory();
        using var client = factory.CreateClient();

        var req = new
        {
            burstIntensityRps = 650,
            bucketCapacity = 220,
            refillRatePerSecond = 180,
            scenario = "BoundaryFlashSpike",
            shardCount = 25
        };

        var r1 = await (await client.PostAsJsonAsync("/api/v1/ratelimit/simulate", req)).Content.ReadAsStringAsync();
        var r2 = await (await client.PostAsJsonAsync("/api/v1/ratelimit/simulate", req)).Content.ReadAsStringAsync();

        Assert.Equal(r1, r2);
    }

    [Fact]
    public async Task HealthAndClusterStatusEndpoints_ExposeV6ArchitectureMetadata()
    {
        using var factory = CreateFactory();
        using var client = factory.CreateClient();

        var health = await client.GetFromJsonAsync<JsonElement>("/health");
        Assert.Equal("6.0.0", health.GetProperty("version").GetString());
        Assert.Contains("Token-Bucket", health.GetProperty("architecture").GetString());

        var status = await client.GetFromJsonAsync<JsonElement>("/api/v1/sre/cluster-status");
        Assert.Equal("6.0.0", status.GetProperty("version").GetString());
    }
}

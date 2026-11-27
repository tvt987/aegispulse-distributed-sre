using System.Diagnostics;
using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Serialization;
using AegisPulse.Domain.Sql;
using AegisPulse.Domain.Sre;
using AegisPulse.Domain.Vouchers;
using Microsoft.AspNetCore.Mvc.Testing;
using Xunit;

namespace AegisPulse.Api.Tests;

public sealed class V5SqlQuorumAndThroughputTests
{
    private static readonly JsonSerializerOptions JsonOpts = new()
    {
        PropertyNameCaseInsensitive = true,
        Converters = { new JsonStringEnumConverter() }
    };

    private static WebApplicationFactory<Program> CreateFactory() => new();

    [Fact]
    public void SqlExecutionPlanAdvisor_Default5MRows5KRps_MatchesConCungThreeStageProfile()
    {
        var advisor = new SqlExecutionPlanAdvisor();

        var stage1 = advisor.Evaluate(SqlOptimizationStage.LegacyEfCoreScan, 5_000_000, 5_000);
        Assert.Equal(28.4, stage1.ExecutionTimeMs);
        Assert.Equal(14_200, stage1.LogicalReads);
        Assert.Equal(125.0, stage1.MemoryFootprintMb);
        Assert.True(stage1.HasLockEscalationWarning);
        Assert.Equal(100, stage1.Operators.Sum(o => o.CostPercent));
        Assert.Equal(14_200, stage1.Operators.Sum(o => o.LogicalReads));

        var stage2 = advisor.Evaluate(SqlOptimizationStage.CoveringIndexDapperCas, 5_000_000, 5_000);
        Assert.Equal(1.8, stage2.ExecutionTimeMs);
        Assert.Equal(14, stage2.LogicalReads);
        Assert.Equal(18.0, stage2.MemoryFootprintMb);
        Assert.Equal(93.7, stage2.LatencyReductionPctVsLegacy);
        Assert.False(stage2.HasLockEscalationWarning);
        Assert.Equal(100, stage2.Operators.Sum(o => o.CostPercent));
        Assert.Equal(14, stage2.Operators.Sum(o => o.LogicalReads));
        Assert.Contains("CREATE NONCLUSTERED INDEX", stage2.RecommendedIndexDdl);
        Assert.Contains("INCLUDE", stage2.RecommendedIndexDdl);
        Assert.Contains("RowVersion", stage2.RecommendedDapperCSharp);

        var stage3 = advisor.Evaluate(SqlOptimizationStage.RedisLuaWriteBehind, 5_000_000, 5_000);
        Assert.Equal(0.42, stage3.ExecutionTimeMs);
        Assert.Equal(0, stage3.LogicalReads);
        Assert.Equal(6.0, stage3.MemoryFootprintMb);
        Assert.Equal(98.5, stage3.LatencyReductionPctVsLegacy);
        Assert.False(stage3.HasLockEscalationWarning);
        Assert.Equal(100, stage3.Operators.Sum(o => o.CostPercent));
        Assert.Equal(3, stage3.AllStagesComparison.Count);
    }

    [Fact]
    public void SqlExecutionPlanAdvisor_ScalesDeterministicallyWithTableSizeAndConcurrency()
    {
        var advisor = new SqlExecutionPlanAdvisor();

        var smallLegacy = advisor.Evaluate(SqlOptimizationStage.LegacyEfCoreScan, 1_000_000, 2_000);
        var largeLegacy = advisor.Evaluate(SqlOptimizationStage.LegacyEfCoreScan, 10_000_000, 10_000);

        Assert.True(largeLegacy.LogicalReads > smallLegacy.LogicalReads * 5);
        Assert.True(largeLegacy.ExecutionTimeMs > smallLegacy.ExecutionTimeMs * 3);
        Assert.True(largeLegacy.P99LatencyMs > smallLegacy.P99LatencyMs * 4);
    }

    [Fact]
    public async Task SqlExecutionPlanEndpoint_ReturnsAllThreeStagesAndValidatesInputs()
    {
        using var factory = CreateFactory();
        using var client = factory.CreateClient();

        var resp1 = await client.PostAsJsonAsync("/api/v1/sql/execution-plan", new
        {
            stage = "LegacyEfCoreScan",
            tableRowCount = 5_000_000,
            concurrencyRps = 5_000,
            voucherCode = "CONCUNG-VIP-500K"
        });
        Assert.Equal(HttpStatusCode.OK, resp1.StatusCode);
        var plan1 = await resp1.Content.ReadFromJsonAsync<SqlExecutionPlanEvaluation>(JsonOpts);
        Assert.NotNull(plan1);
        Assert.Equal(28.4, plan1.ExecutionTimeMs);
        Assert.Equal(14_200, plan1.LogicalReads);

        var resp2 = await client.PostAsJsonAsync("/api/v1/sql/execution-plan", new
        {
            stage = "CoveringIndexDapperCas",
            tableRowCount = 5_000_000,
            concurrencyRps = 5_000
        });
        Assert.Equal(HttpStatusCode.OK, resp2.StatusCode);
        var plan2 = await resp2.Content.ReadFromJsonAsync<SqlExecutionPlanEvaluation>(JsonOpts);
        Assert.NotNull(plan2);
        Assert.Equal(1.8, plan2.ExecutionTimeMs);
        Assert.Equal(14, plan2.LogicalReads);
        Assert.Equal(93.7, plan2.LatencyReductionPctVsLegacy);

        var resp3 = await client.PostAsJsonAsync("/api/v1/sql/execution-plan", new
        {
            stage = "RedisLuaWriteBehind",
            tableRowCount = 5_000_000,
            concurrencyRps = 5_000
        });
        Assert.Equal(HttpStatusCode.OK, resp3.StatusCode);
        var plan3 = await resp3.Content.ReadFromJsonAsync<SqlExecutionPlanEvaluation>(JsonOpts);
        Assert.NotNull(plan3);
        Assert.Equal(0.42, plan3.ExecutionTimeMs);
        Assert.Equal(0, plan3.LogicalReads);

        // Invalid inputs return 400 ProblemDetails
        var badRows = await client.PostAsJsonAsync("/api/v1/sql/execution-plan", new
        {
            stage = "LegacyEfCoreScan",
            tableRowCount = 0,
            concurrencyRps = 5_000
        });
        Assert.Equal(HttpStatusCode.BadRequest, badRows.StatusCode);

        var badStage = await client.PostAsJsonAsync("/api/v1/sql/execution-plan", new
        {
            stage = "UnknownStage999",
            tableRowCount = 5_000_000,
            concurrencyRps = 5_000
        });
        Assert.Equal(HttpStatusCode.BadRequest, badStage.StatusCode);
    }

    [Fact]
    public void QuorumFailoverEvaluator_NominalPrimaryCrashAndSplitBrainReadOnlyFence()
    {
        var evaluator = new QuorumFailoverEvaluator();

        // 1. Nominal 5/5 -> VN-HCM Primary leads, READ_WRITE
        var nominal = evaluator.Evaluate(new QuorumEvaluationRequest(CurrentTerm: 42, PreviousLeaderId: "vn-hcm"));
        Assert.True(nominal.HasQuorum);
        Assert.Equal("READ_WRITE", nominal.ClusterWriteMode);
        Assert.False(nominal.SplitBrainFenceActive);
        Assert.Equal("vn-hcm", nominal.ElectedLeaderRegionId);
        Assert.Equal(42, nominal.RaftTerm);
        Assert.Equal(0.0, nominal.RpoSeconds);
        Assert.Equal(0, nominal.RtoMs);

        // 2. VN-HCM HardCrash -> SG-1 auto-elected, Term 43, RPO 0s, RTO > 0
        var primaryCrash = evaluator.Evaluate(new QuorumEvaluationRequest(
            CurrentTerm: 42,
            PreviousLeaderId: "vn-hcm",
            RegionStates: new Dictionary<string, QuorumRegionHealthState>
            {
                ["vn-hcm"] = QuorumRegionHealthState.HardCrash
            }));
        Assert.True(primaryCrash.HasQuorum);
        Assert.Equal("READ_WRITE", primaryCrash.ClusterWriteMode);
        Assert.Equal("sg-1", primaryCrash.ElectedLeaderRegionId);
        Assert.Equal(43, primaryCrash.RaftTerm);
        Assert.True(primaryCrash.ElectionTriggered);
        Assert.Equal(0.0, primaryCrash.RpoSeconds);
        Assert.True(primaryCrash.RtoMs is > 150 and < 350);

        // 3. Kill 3 regions (< 3 survive) -> automatic READ_ONLY_FENCE prevents dual-writer double-spending
        var splitBrain = evaluator.Evaluate(new QuorumEvaluationRequest(
            CurrentTerm: 43,
            PreviousLeaderId: "sg-1",
            RegionStates: new Dictionary<string, QuorumRegionHealthState>
            {
                ["vn-hcm"] = QuorumRegionHealthState.HardCrash,
                ["sg-1"] = QuorumRegionHealthState.Partitioned,
                ["jp-tokyo"] = QuorumRegionHealthState.Partitioned
            }));
        Assert.False(splitBrain.HasQuorum);
        Assert.Equal(2, splitBrain.OnlineNodes);
        Assert.Equal("READ_ONLY_FENCE", splitBrain.ClusterWriteMode);
        Assert.True(splitBrain.SplitBrainFenceActive);
        Assert.True(splitBrain.DoubleSpendPrevented);
        Assert.Null(splitBrain.ElectedLeaderRegionId);
        Assert.Equal(44, splitBrain.RaftTerm);
        Assert.Equal(2, splitBrain.Nodes.Count(n => n.Role == QuorumNodeRole.Fenced));
        Assert.All(splitBrain.Nodes, n => Assert.False(n.AcceptsWrites));
    }

    [Fact]
    public async Task ClusterQuorumEvaluateEndpoint_HandlesFailoverFenceAndValidation()
    {
        using var factory = CreateFactory();
        using var client = factory.CreateClient();

        // Failover when VN-HCM crashes
        var failoverResp = await client.PostAsJsonAsync("/api/v1/cluster/quorum-evaluate", new
        {
            currentTerm = 50,
            previousLeaderId = "vn-hcm",
            regionStates = new Dictionary<string, string>
            {
                ["vn-hcm"] = "HARD_CRASH",
                ["sg-1"] = "ONLINE",
                ["jp-tokyo"] = "ONLINE",
                ["us-east"] = "ONLINE",
                ["eu-west"] = "ONLINE"
            }
        });
        Assert.Equal(HttpStatusCode.OK, failoverResp.StatusCode);
        var failover = await failoverResp.Content.ReadFromJsonAsync<QuorumEvaluationResult>(JsonOpts);
        Assert.NotNull(failover);
        Assert.Equal("sg-1", failover.ElectedLeaderRegionId);
        Assert.Equal("READ_WRITE", failover.ClusterWriteMode);
        Assert.Equal(51, failover.RaftTerm);

        // Split-brain fence when 3 regions down
        var fenceResp = await client.PostAsJsonAsync("/api/v1/cluster/quorum-evaluate", new
        {
            currentTerm = 51,
            previousLeaderId = "sg-1",
            regionStates = new Dictionary<string, string>
            {
                ["vn-hcm"] = "HARD_CRASH",
                ["sg-1"] = "PARTITIONED",
                ["jp-tokyo"] = "HARD_CRASH",
                ["us-east"] = "ONLINE",
                ["eu-west"] = "ONLINE"
            }
        });
        Assert.Equal(HttpStatusCode.OK, fenceResp.StatusCode);
        var fenced = await fenceResp.Content.ReadFromJsonAsync<QuorumEvaluationResult>(JsonOpts);
        Assert.NotNull(fenced);
        Assert.False(fenced.HasQuorum);
        Assert.Equal("READ_ONLY_FENCE", fenced.ClusterWriteMode);
        Assert.True(fenced.SplitBrainFenceActive);
        Assert.True(fenced.DoubleSpendPrevented);

        // Unknown region -> 400
        var invalidResp = await client.PostAsJsonAsync("/api/v1/cluster/quorum-evaluate", new
        {
            regionStates = new Dictionary<string, string>
            {
                ["mars-base-1"] = "ONLINE"
            }
        });
        Assert.Equal(HttpStatusCode.BadRequest, invalidResp.StatusCode);
    }

    [Fact]
    public void VoucherRedemptionEngine_SustainedThroughputBenchmark_Exceeds5000OpsPerSecWithZeroDoubleSpends()
    {
        var engine = new VoucherRedemptionEngine();

        // Warm-up JIT & SHA-256 pipeline
        engine.SeedVoucher(new SeedVoucherCommand("WARMUP-V5", 500_000, 100));
        for (var i = 0; i < 200; i++)
        {
            engine.Redeem(new RedeemVoucherCommand("WARMUP-V5", $"warm-{i}", "STORE-001", $"warm-key-{i}"));
        }

        const string benchmarkCode = "CONCUNG-5K-BENCH";
        const int totalOps = 10_000;
        const int stockCap = 2_500;
        engine.SeedVoucher(new SeedVoucherCommand(benchmarkCode, 500_000, stockCap, "Con Cung 5,000+ RPS Sustained Proof"));

        var approved = 0;
        var conflicts = 0;

        var sw = Stopwatch.StartNew();
        Parallel.For(0, totalOps, new ParallelOptions { MaxDegreeOfParallelism = Math.Max(4, Environment.ProcessorCount) }, i =>
        {
            var res = engine.Redeem(new RedeemVoucherCommand(
                VoucherCode: benchmarkCode,
                CustomerId: $"cust-{i}",
                StoreCode: $"STORE-{(i % 700) + 1:D3}",
                IdempotencyKey: $"bench-5k-{i}"));

            if (res.Outcome == VoucherRedemptionOutcome.Redeemed)
            {
                Interlocked.Increment(ref approved);
            }
            else if (res.Outcome == VoucherRedemptionOutcome.VoucherExhausted)
            {
                Interlocked.Increment(ref conflicts);
            }
        });
        sw.Stop();

        var elapsedSeconds = Math.Max(0.0001, sw.Elapsed.TotalSeconds);
        var opsPerSec = totalOps / elapsedSeconds;

        var audit = engine.GetVoucherAudit(benchmarkCode);
        Assert.NotNull(audit);
        Assert.Equal(stockCap, approved);
        Assert.Equal(totalOps - stockCap, conflicts);
        Assert.Equal(0, audit.RemainingStock);
        Assert.Equal(0, audit.DoubleSpendCount);
        Assert.True(audit.InvariantIntact);
        Assert.True(
            opsPerSec > 5_000.0,
            $"Expected sustained atomic throughput > 5,000 ops/sec, measured {opsPerSec:N0} ops/sec over {sw.Elapsed.TotalMilliseconds:F2} ms.");
    }
}

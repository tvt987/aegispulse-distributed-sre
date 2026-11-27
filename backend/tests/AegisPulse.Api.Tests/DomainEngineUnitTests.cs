using AegisPulse.Domain.Sre;
using AegisPulse.Domain.Vouchers;
using Xunit;

namespace AegisPulse.Api.Tests;

public sealed class DomainEngineUnitTests
{
    private sealed class FakeTimeProvider(DateTimeOffset initialUtc) : TimeProvider
    {
        private DateTimeOffset _now = initialUtc;
        public override DateTimeOffset GetUtcNow() => _now;
        public void Advance(TimeSpan delta) => _now = _now.Add(delta);
    }

    [Fact]
    public void RowVersionVoucherStore_RejectsStaleRowVersionAndIncrementsVersionOnCommit()
    {
        var store = new RowVersionVoucherStore();
        store.UpsertVoucher(new SeedVoucherCommand("CAS-500K", 500_000, 2));

        var ok1 = store.TryCommitOptimisticDecrement("CAS-500K", expectedRowVersion: 1UL, out var v2, out var rem1, out var ex1);
        Assert.True(ok1);
        Assert.Equal(2UL, v2);
        Assert.Equal(1, rem1);
        Assert.False(ex1);

        // Stale ROWVERSION token (1UL instead of 2UL) MUST fail CAS check
        var staleAttempt = store.TryCommitOptimisticDecrement("CAS-500K", expectedRowVersion: 1UL, out var currentV, out var remAfterStale, out _);
        Assert.False(staleAttempt);
        Assert.Equal(2UL, currentV);
        Assert.Equal(1, remAfterStale);

        var audit = store.BuildAuditSnapshot("CAS-500K");
        Assert.NotNull(audit);
        Assert.Equal(1, audit.RowVersionConflicts);
        Assert.Equal(0, audit.DoubleSpendCount);
        Assert.True(audit.InvariantIntact);
    }

    [Fact]
    public void RowVersionVoucherStore_NeverAllowsNegativeStockWhenExhausted()
    {
        var store = new RowVersionVoucherStore();
        store.UpsertVoucher(new SeedVoucherCommand("SINGLE-500K", 500_000, 1));

        Assert.True(store.TryCommitOptimisticDecrement("SINGLE-500K", 1UL, out var v2, out var rem1, out _));
        Assert.Equal(0, rem1);

        Assert.False(store.TryCommitOptimisticDecrement("SINGLE-500K", v2, out _, out var rem2, out var exhausted));
        Assert.True(exhausted);
        Assert.Equal(0, rem2);
    }

    [Fact]
    public void RedisLuaGateSimulator_PayloadFingerprintIsCaseNormalizedAndDeterministic()
    {
        var h1 = RedisLuaGateSimulator.ComputePayloadFingerprint("concung-vip-500k", "user-42", "store-007");
        var h2 = RedisLuaGateSimulator.ComputePayloadFingerprint("CONCUNG-VIP-500K", "user-42", "STORE-007");
        var h3 = RedisLuaGateSimulator.ComputePayloadFingerprint("CONCUNG-VIP-500K", "user-99", "STORE-007");

        Assert.Equal(h1, h2);
        Assert.NotEqual(h1, h3);
        Assert.Equal(64, h1.Length);
    }

    [Fact]
    public void RaftQuorumEvaluator_CalculatesStrictMajorityForClusterSizes()
    {
        Assert.Equal(1, RaftQuorumEvaluator.CalculateQuorum(1));
        Assert.Equal(2, RaftQuorumEvaluator.CalculateQuorum(3));
        Assert.Equal(3, RaftQuorumEvaluator.CalculateQuorum(5));
        Assert.Equal(4, RaftQuorumEvaluator.CalculateQuorum(7));
    }

    [Fact]
    public void RaftQuorumEvaluator_AutoElectsNewLeaderWhenPrimaryPartitioned()
    {
        var raft = new RaftQuorumEvaluator();
        var init = raft.GetStatus();
        Assert.Equal("ap-southeast-1", init.LeaderRegionId);
        Assert.Equal(42, init.RaftTerm);

        var afterCut = raft.PartitionRegion("ap-southeast-1");
        Assert.True(afterCut.HasQuorum);
        Assert.Equal("DEGRADED", afterCut.QuorumStatus);
        Assert.Equal("ap-northeast-1", afterCut.LeaderRegionId);
        Assert.Equal(43, afterCut.RaftTerm);
        Assert.False(afterCut.SplitBrainWriteFenceActive);
    }

    [Fact]
    public void RaftQuorumEvaluator_ActivatesSplitBrainWriteFenceWhenReachableFallsBelowThree()
    {
        var raft = new RaftQuorumEvaluator();
        raft.PartitionRegion("ap-southeast-1");
        raft.PartitionRegion("ap-northeast-1");
        var quorumLost = raft.PartitionRegion("us-east-1");

        Assert.Equal(2, quorumLost.ReachableNodes);
        Assert.False(quorumLost.HasQuorum);
        Assert.True(quorumLost.SplitBrainWriteFenceActive);
        Assert.Null(quorumLost.LeaderRegionId);
        Assert.Equal("QUORUM_LOST", quorumLost.QuorumStatus);
        Assert.Equal(2, quorumLost.Regions.Count(r => r.Role == RaftNodeRole.Fenced));
    }

    [Fact]
    public void RaftQuorumEvaluator_RestoresQuorumAndElectsLeaderWhenThirdNodeReconnects()
    {
        var raft = new RaftQuorumEvaluator();
        raft.PartitionRegion("ap-southeast-1");
        raft.PartitionRegion("ap-northeast-1");
        raft.PartitionRegion("us-east-1");

        var restored = raft.RestoreRegion("us-east-1");
        Assert.True(restored.HasQuorum);
        Assert.False(restored.SplitBrainWriteFenceActive);
        Assert.Equal("MINIMAL_QUORUM", restored.QuorumStatus);
        Assert.NotNull(restored.LeaderRegionId);
    }

    [Fact]
    public void CircuitBreakerStateMachine_TransitionsClosedToOpenToHalfOpenToClosed()
    {
        var clock = new FakeTimeProvider(new DateTimeOffset(2026, 11, 28, 0, 0, 0, TimeSpan.Zero));
        var cb = new CircuitBreakerStateMachine(failureThreshold: 3, openCooldown: TimeSpan.FromSeconds(10), timeProvider: clock);

        Assert.Equal(CircuitBreakerState.Closed, cb.CurrentState);
        Assert.True(cb.AllowRequest());

        cb.RecordFailure();
        cb.RecordFailure();
        Assert.Equal(CircuitBreakerState.Closed, cb.CurrentState);

        cb.RecordFailure();
        Assert.Equal(CircuitBreakerState.Open, cb.CurrentState);
        Assert.False(cb.AllowRequest());

        // Advance past cooldown -> HalfOpen
        clock.Advance(TimeSpan.FromSeconds(11));
        Assert.Equal(CircuitBreakerState.HalfOpen, cb.CurrentState);
        Assert.True(cb.AllowRequest());

        // Successful probe closes circuit
        cb.RecordSuccess();
        Assert.Equal(CircuitBreakerState.Closed, cb.CurrentState);
    }

    [Fact]
    public void CircuitBreakerStateMachine_ReOpensImmediatelyOnHalfOpenProbeFailure()
    {
        var clock = new FakeTimeProvider(new DateTimeOffset(2026, 11, 28, 0, 0, 0, TimeSpan.Zero));
        var cb = new CircuitBreakerStateMachine(failureThreshold: 2, openCooldown: TimeSpan.FromSeconds(5), timeProvider: clock);

        cb.RecordFailure();
        cb.RecordFailure();
        Assert.Equal(CircuitBreakerState.Open, cb.CurrentState);

        clock.Advance(TimeSpan.FromSeconds(6));
        Assert.Equal(CircuitBreakerState.HalfOpen, cb.CurrentState);

        // Probe fails -> immediately re-opens and starts fresh cooldown
        cb.RecordFailure();
        Assert.Equal(CircuitBreakerState.Open, cb.CurrentState);
        Assert.False(cb.AllowRequest());
    }

    [Fact]
    public void VoucherRedemptionEngine_ReseedResetsStockAndClearsPriorIdempotencyCacheForThatCode()
    {
        var engine = new VoucherRedemptionEngine();
        engine.SeedVoucher(new SeedVoucherCommand("RESET-500K", 500_000, 1));

        var first = engine.Redeem(new RedeemVoucherCommand("RESET-500K", "cust-1", "STORE-001", "reseed-idem-1"));
        Assert.Equal(VoucherRedemptionOutcome.Redeemed, first.Outcome);

        var exhausted = engine.Redeem(new RedeemVoucherCommand("RESET-500K", "cust-2", "STORE-002", "reseed-idem-2"));
        Assert.Equal(VoucherRedemptionOutcome.VoucherExhausted, exhausted.Outcome);

        // Re-seed resets stock back to 1 and clears previous keys for RESET-500K
        var reseededAudit = engine.SeedVoucher(new SeedVoucherCommand("RESET-500K", 500_000, 1));
        Assert.Equal(1, reseededAudit.RemainingStock);
        Assert.Equal(0, reseededAudit.ApprovedRedemptions);

        var freshRedeem = engine.Redeem(new RedeemVoucherCommand("RESET-500K", "cust-3", "STORE-003", "reseed-idem-1"));
        Assert.Equal(VoucherRedemptionOutcome.Redeemed, freshRedeem.Outcome);
        Assert.False(freshRedeem.Receipt!.IsIdempotentReplay);
    }
}

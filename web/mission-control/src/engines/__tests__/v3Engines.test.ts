import { describe, expect, it } from 'vitest';
import {
  calculateQuorumSize,
  computeChaosLoadMultipliers,
  createInitialClusterState,
  cutRegionFiber,
  getPairwiseBaseRtt,
  GLOBAL_REGIONS,
  restoreAllRegions,
  toggleDbConnectionExhaustion,
  toggleRedisCacheStampede,
  toggleTailLatency180Ms,
  transferLeaderManually,
} from '../chaosEngine';
import {
  clampStressRps,
  computePointMetrics,
  extractFlameHotspots,
  findFlameFrameById,
  flattenFlamegraphLayout,
  getFlameBreadcrumbs,
  MAX_STRESS_RPS,
  MIN_STRESS_RPS,
  simulateLoadStressProfile,
  SLO_P99_TARGET_MS,
} from '../loadProfilerEngine';
import {
  canExecuteStep,
  createInitialRunbookState,
  ensureUtf8Bom,
  executeAllRemainingSteps,
  executeNextRunbookStep,
  executeRunbookStep,
  exportRunbookPostMortemJson,
  exportRunbookPostMortemMarkdown,
  getNextPendingStep,
  UTF8_BOM,
} from '../runbookEngine';
import {
  buildEnterpriseTransferMemo,
  buildMbBankVietQrUrl,
  createQuoteReference,
  ENTERPRISE_LICENSE_TIERS,
  formatVnd,
  generateEnterpriseQuoteMarkdown,
  MBBANK_CONFIG,
  sanitizeTransferMemo,
} from '../vietqrEngine';

describe('v3.0 Multi-Region Raft Quorum & Chaos Fault Injector Engine', () => {
  it('initializes a healthy 5-region global cluster with 3/5 minimum quorum and 10 mesh edges', () => {
    const state = createInitialClusterState();
    expect(GLOBAL_REGIONS).toHaveLength(5);
    expect(state.totalNodes).toBe(5);
    expect(state.quorumSize).toBe(3);
    expect(calculateQuorumSize(5)).toBe(3);
    expect(calculateQuorumSize(7)).toBe(4);
    expect(state.reachableCount).toBe(5);
    expect(state.hasQuorum).toBe(true);
    expect(state.quorumStatus).toBe('HEALTHY');
    expect(state.leaderRegionId).toBe('ap-southeast-1');
    expect(state.raftTerm).toBe(42);
    expect(state.circuitBreakerState).toBe('CLOSED');
    expect(state.edges).toHaveLength(10);
    expect(state.splitBrainProtected).toBe(true);
    expect(state.fencedWriteGuardActive).toBe(false);
  });

  it('computes symmetric pairwise RTT across global regions', () => {
    expect(getPairwiseBaseRtt('ap-southeast-1', 'ap-southeast-1')).toBe(0);
    expect(getPairwiseBaseRtt('ap-southeast-1', 'ap-northeast-1')).toBe(
      getPairwiseBaseRtt('ap-northeast-1', 'ap-southeast-1')
    );
    expect(getPairwiseBaseRtt('us-east-1', 'eu-central-1')).toBeGreaterThan(50);
  });

  it('severs 4 mesh edges when cutting a follower region fiber while retaining leader and quorum', () => {
    const init = createInitialClusterState();
    const after = cutRegionFiber(init, 'eu-central-1');
    expect(after.reachableCount).toBe(4);
    expect(after.hasQuorum).toBe(true);
    expect(after.leaderRegionId).toBe('ap-southeast-1');
    expect(after.quorumStatus).toBe('DEGRADED');
    expect(after.edges.filter((e) => e.status === 'SEVERED')).toHaveLength(4);
    const fra = after.regions.find((r) => r.id === 'eu-central-1')!;
    expect(fra.role).toBe('PARTITIONED');
    expect(fra.reachable).toBe(false);
  });

  it('automatically elects a new Raft leader and increments term when leader fiber is cut', () => {
    const init = createInitialClusterState();
    const after = cutRegionFiber(init, 'ap-southeast-1');
    expect(after.hasQuorum).toBe(true);
    expect(after.leaderRegionId).toBe('ap-northeast-1');
    expect(after.raftTerm).toBe(init.raftTerm + 1);
    expect(after.lastFailoverLatencyMs).toBeGreaterThan(100);
    expect(after.events.some((e) => e.code === 'RAFT_LEADER_ELECTED')).toBe(true);
  });

  it('retains minimal 3/5 quorum when 2 regions are partitioned and transitions circuit breaker to HALF_OPEN', () => {
    let state = createInitialClusterState();
    state = cutRegionFiber(state, 'ap-southeast-1');
    state = cutRegionFiber(state, 'ap-northeast-1');
    expect(state.reachableCount).toBe(3);
    expect(state.hasQuorum).toBe(true);
    expect(state.quorumStatus).toBe('MINIMAL_QUORUM');
    expect(state.leaderRegionId).toBe('us-east-1');
    expect(state.circuitBreakerState).toBe('HALF_OPEN');
  });

  it('activates split-brain write fencing when 3 regions are partitioned (< 3/5 quorum)', () => {
    let state = createInitialClusterState();
    state = cutRegionFiber(state, 'ap-southeast-1');
    state = cutRegionFiber(state, 'ap-northeast-1');
    state = cutRegionFiber(state, 'us-east-1');
    expect(state.reachableCount).toBe(2);
    expect(state.hasQuorum).toBe(false);
    expect(state.quorumStatus).toBe('QUORUM_LOST');
    expect(state.leaderRegionId).toBeNull();
    expect(state.fencedWriteGuardActive).toBe(true);
    expect(state.circuitBreakerState).toBe('OPEN');
    expect(state.regions.filter((r) => r.role === 'FENCED')).toHaveLength(2);
    expect(state.events.some((e) => e.code === 'RAFT_QUORUM_LOST')).toBe(true);
  });

  it('re-elects a leader automatically when fiber is restored back to >= 3/5 quorum', () => {
    let state = createInitialClusterState();
    state = cutRegionFiber(state, 'ap-southeast-1');
    state = cutRegionFiber(state, 'ap-northeast-1');
    state = cutRegionFiber(state, 'us-east-1');
    expect(state.leaderRegionId).toBeNull();

    // Reconnect us-east-1 -> back to 3/5
    state = cutRegionFiber(state, 'us-east-1');
    expect(state.reachableCount).toBe(3);
    expect(state.hasQuorum).toBe(true);
    expect(state.leaderRegionId).toBe('us-east-1');
    expect(state.fencedWriteGuardActive).toBe(false);
  });

  it('injects +180ms tail latency across active edges and raises replication lag & error burn rate', () => {
    const init = createInitialClusterState();
    const spiked = toggleTailLatency180Ms(init);
    expect(spiked.faults.tailLatency180Ms).toBe(true);
    expect(spiked.avgCrossRegionRttMs).toBe(init.avgCrossRegionRttMs + 180);
    expect(spiked.maxReplicationLagMs).toBeGreaterThan(init.maxReplicationLagMs + 80);
    expect(spiked.errorBudgetBurnRate).toBeGreaterThan(init.errorBudgetBurnRate);
    expect(spiked.edges.every((e) => e.status === 'DEGRADED')).toBe(true);

    const cleared = toggleTailLatency180Ms(spiked);
    expect(cleared.faults.tailLatency180Ms).toBe(false);
    expect(cleared.avgCrossRegionRttMs).toBe(init.avgCrossRegionRttMs);
  });

  it('triggers Redis cache stampede plunging cache hit ratio and raising DB pool pressure', () => {
    const init = createInitialClusterState();
    const stampeded = toggleRedisCacheStampede(init);
    expect(stampeded.faults.redisCacheStampede).toBe(true);
    expect(stampeded.cacheHitRatioPct).toBeLessThan(40);
    expect(stampeded.dbPoolUtilizationPct).toBeGreaterThan(init.dbPoolUtilizationPct + 30);
    expect(stampeded.circuitBreakerState).toBe('HALF_OPEN');
  });

  it('simulates DB connection exhaustion at 99.2% pool saturation and trips circuit breaker OPEN', () => {
    const init = createInitialClusterState();
    const exhausted = toggleDbConnectionExhaustion(init);
    expect(exhausted.faults.dbConnectionExhaustion).toBe(true);
    expect(exhausted.dbPoolUtilizationPct).toBe(99.2);
    expect(exhausted.circuitBreakerState).toBe('OPEN');
    expect(exhausted.errorBudgetBurnRate).toBeGreaterThanOrEqual(10);
  });

  it('supports manual zero-loss leader transfer to healthy followers and ignores partitioned targets', () => {
    const init = createInitialClusterState();
    const transferred = transferLeaderManually(init, 'eu-central-1');
    expect(transferred.leaderRegionId).toBe('eu-central-1');
    expect(transferred.raftTerm).toBe(init.raftTerm + 1);
    expect(transferred.lastFailoverLatencyMs).toBeGreaterThan(100);

    // Cutting ap-south-1 then trying to transfer to it should be ignored
    const cut = cutRegionFiber(transferred, 'ap-south-1');
    const ignored = transferLeaderManually(cut, 'ap-south-1');
    expect(ignored.leaderRegionId).toBe('eu-central-1');
  });

  it('restores all regions, clears every chaos fault, and resets quorum to 5/5 HEALTHY', () => {
    let state = createInitialClusterState();
    state = cutRegionFiber(state, 'ap-southeast-1');
    state = cutRegionFiber(state, 'us-east-1');
    state = toggleTailLatency180Ms(state);
    state = toggleRedisCacheStampede(state);
    state = toggleDbConnectionExhaustion(state);

    const restored = restoreAllRegions(state);
    expect(restored.reachableCount).toBe(5);
    expect(restored.hasQuorum).toBe(true);
    expect(restored.quorumStatus).toBe('HEALTHY');
    expect(restored.circuitBreakerState).toBe('CLOSED');
    expect(restored.errorBudgetBurnRate).toBe(1.0);
    expect(restored.faults.fiberCutRegions).toHaveLength(0);
    expect(restored.faults.tailLatency180Ms).toBe(false);
    expect(restored.faults.redisCacheStampede).toBe(false);
    expect(restored.faults.dbConnectionExhaustion).toBe(false);
  });

  it('computes amplified chaos load multipliers when multiple faults are active', () => {
    const clean = computeChaosLoadMultipliers(createInitialClusterState());
    expect(clean.latencyAdderMs).toBe(0);
    expect(clean.capacityFactor).toBe(1);

    let chaos = createInitialClusterState();
    chaos = cutRegionFiber(chaos, 'us-east-1');
    chaos = toggleTailLatency180Ms(chaos);
    chaos = toggleDbConnectionExhaustion(chaos);
    const stressed = computeChaosLoadMultipliers(chaos);
    expect(stressed.latencyAdderMs).toBeGreaterThan(250);
    expect(stressed.latencyMultiplier).toBeGreaterThan(2);
    expect(stressed.gcPressureMultiplier).toBeGreaterThan(1.5);
    expect(stressed.capacityFactor).toBe(0.8);
  });
});

describe('v3.0 Live Load-Test Stress Slider (10K -> 250K RPS) & CPU/GC Flamegraph Engine', () => {
  it('clamps RPS inputs safely within [10,000, 250,000]', () => {
    expect(clampStressRps(100)).toBe(MIN_STRESS_RPS);
    expect(clampStressRps(999999)).toBe(MAX_STRESS_RPS);
    expect(clampStressRps(Number.NaN)).toBe(MIN_STRESS_RPS);
    expect(clampStressRps(125000)).toBe(125000);
  });

  it('maintains strict P50 < P95 < P99 ordering and monotonic latency growth across 10K -> 250K RPS', () => {
    const points = [10000, 60000, 140000, 220000, 250000].map((r) =>
      computePointMetrics(r, 'dotnet10')
    );
    for (let i = 0; i < points.length; i++) {
      expect(points[i].p50Ms).toBeLessThan(points[i].p95Ms);
      expect(points[i].p95Ms).toBeLessThan(points[i].p99Ms);
      if (i > 0) {
        expect(points[i].p99Ms).toBeGreaterThan(points[i - 1].p99Ms);
        expect(points[i].hpaPodsDesired).toBeGreaterThanOrEqual(points[i - 1].hpaPodsDesired);
      }
    }
  });

  it('produces a 13-point latency curve spanning exact 10K to 250K RPS bounds', () => {
    const profile = simulateLoadStressProfile(85000, 'dotnet10');
    expect(profile.latencyCurve).toHaveLength(13);
    expect(profile.latencyCurve[0].rps).toBe(10000);
    expect(profile.latencyCurve[12].rps).toBe(250000);
    expect(profile.sloTargetP99Ms).toBe(SLO_P99_TARGET_MS);
    expect(profile.sloBreached).toBe(false);
  });

  it('scales Kubernetes HPA pods appropriately and degrades SLO error budget at 250K surge', () => {
    const low = simulateLoadStressProfile(10000, 'dotnet10');
    const peak = simulateLoadStressProfile(250000, 'dotnet10');
    expect(low.hpaPodsDesired).toBeGreaterThanOrEqual(6);
    expect(peak.hpaPodsDesired).toBeGreaterThan(80);
    expect(peak.hpaPodsDesired).toBeLessThanOrEqual(128);
    expect(peak.sloErrorBudgetRemainingPct).toBeLessThan(low.sloErrorBudgetRemainingPct);
    expect(peak.droppedRps).toBeGreaterThan(0);
    expect(peak.sloBreached).toBe(true);
  });

  it('supports both .NET 10 Kestrel + Dapper and Go 1.24 Fiber + pgx profiler modes', () => {
    const dotnet = simulateLoadStressProfile(90000, 'dotnet10');
    const go = simulateLoadStressProfile(90000, 'go124');
    expect(dotnet.flamegraphRoot.name).toContain('Kestrel HTTP/3');
    expect(go.flamegraphRoot.name).toContain('Go Fiber HTTP/3');
    expect(dotnet.gcProfile.runtimeName).toContain('.NET 10');
    expect(go.gcProfile.runtimeName).toContain('Go 1.24');
  });

  it('propagates live Chaos Engine faults directly into P99 latency, GC pauses, and flamegraph frames', () => {
    const healthyCluster = createInitialClusterState();
    const stressedCluster = toggleDbConnectionExhaustion(toggleTailLatency180Ms(healthyCluster));

    const cleanProfile = simulateLoadStressProfile(80000, 'dotnet10', healthyCluster);
    const chaosProfile = simulateLoadStressProfile(80000, 'dotnet10', stressedCluster);

    expect(chaosProfile.p99Ms).toBeGreaterThan(cleanProfile.p99Ms + 180);
    expect(chaosProfile.gcProfile.p99GcPauseMs).toBeGreaterThan(cleanProfile.gcProfile.p99GcPauseMs);
    expect(chaosProfile.sloBreached).toBe(true);

    const cleanDapper = findFlameFrameById(cleanProfile.flamegraphRoot, 'dapper-query')!;
    const chaosDapper = findFlameFrameById(chaosProfile.flamegraphRoot, 'dapper-query')!;
    expect(chaosDapper.totalMs).toBeGreaterThan(cleanDapper.totalMs);
    expect(chaosDapper.tip).toContain('CRITICAL HOTSPOT');
  });

  it('builds complete flamegraph stack containing Kestrel, Middleware, Dapper QueryAsync, SQL ReadReplica, Redis Lua Lock & GC Pause', () => {
    const profile = simulateLoadStressProfile(100000, 'dotnet10');
    const root = profile.flamegraphRoot;
    expect(findFlameFrameById(root, 'root-ingress')?.name).toContain('Kestrel HTTP/3');
    expect(findFlameFrameById(root, 'middleware')?.name).toContain('Middleware');
    expect(findFlameFrameById(root, 'dapper-query')?.name).toContain('Dapper QueryAsync');
    expect(findFlameFrameById(root, 'sql-replica')?.name).toContain('SQL ReadReplica');
    expect(findFlameFrameById(root, 'redis-lua')?.name).toContain('Redis Lua Lock');
    expect(findFlameFrameById(root, 'gc-pause')).not.toBeNull();
    expect(findFlameFrameById(root, 'non-existent-id')).toBeNull();
  });

  it('computes clickable breadcrumbs and zooms target flamegraph frame cleanly to 100% width', () => {
    const profile = simulateLoadStressProfile(110000, 'dotnet10');
    const crumbs = getFlameBreadcrumbs(profile.flamegraphRoot, 'sql-replica');
    expect(crumbs.map((c) => c.id)).toEqual([
      'root-ingress',
      'controller',
      'dapper-query',
      'sql-replica',
    ]);

    const zoomed = flattenFlamegraphLayout(profile.flamegraphRoot, 'dapper-query');
    expect(zoomed[0].frame.id).toBe('dapper-query');
    expect(zoomed[0].depth).toBe(0);
    expect(zoomed[0].xPct).toBe(0);
    expect(zoomed[0].widthPct).toBe(100);
    expect(zoomed.some((r) => r.frame.id === 'sql-replica' && r.depth === 1)).toBe(true);
    for (const r of zoomed) {
      expect(r.xPct + r.widthPct).toBeLessThanOrEqual(100.1);
    }
  });

  it('extracts top flamegraph hotspots strictly sorted descending by selfMs', () => {
    const profile = simulateLoadStressProfile(150000, 'dotnet10');
    const hotspots = extractFlameHotspots(profile.flamegraphRoot, 6);
    expect(hotspots).toHaveLength(6);
    for (let i = 1; i < hotspots.length; i++) {
      expect(hotspots[i - 1].selfMs).toBeGreaterThanOrEqual(hotspots[i].selfMs);
    }
  });
});

describe('v3.0 Interactive SRE Incident Runbook Executor & UTF-8 BOM Post-Mortem Suite', () => {
  const buildContext = () => {
    const cluster = toggleDbConnectionExhaustion(createInitialClusterState());
    const loadProfile = simulateLoadStressProfile(120000, 'dotnet10', cluster);
    return { cluster, loadProfile };
  };

  it('initializes a 5-step incident runbook gated sequentially starting at detect', () => {
    const rb = createInitialRunbookState('INC-TEST-01');
    expect(rb.incidentId).toBe('INC-TEST-01');
    expect(rb.steps).toHaveLength(5);
    expect(rb.lifecycle).toBe('idle');
    expect(rb.mttrSeconds).toBe(0);
    expect(getNextPendingStep(rb)?.id).toBe('detect');
    expect(canExecuteStep(rb, 'detect')).toBe(true);
    expect(canExecuteStep(rb, 'mitigate')).toBe(false);
    expect(canExecuteStep(rb, 'verify')).toBe(false);
  });

  it('safely ignores out-of-order step execution attempts', () => {
    const rb = createInitialRunbookState();
    const ctx = buildContext();
    const res = executeRunbookStep(rb, 'drain', ctx);
    expect(res.nextState).toBe(rb);
    expect(res.shouldRestoreCluster).toBe(false);
  });

  it('progresses step-by-step through Detect -> Mitigate -> Drain -> Verify -> Export with remediation flags', () => {
    const ctx = buildContext();
    let rb = createInitialRunbookState();

    const r1 = executeRunbookStep(rb, 'detect', ctx);
    expect(r1.nextState.lifecycle).toBe('in_progress');
    expect(r1.shouldRestoreCluster).toBe(false);
    rb = r1.nextState;

    const r2 = executeRunbookStep(rb, 'mitigate', ctx);
    expect(r2.shouldClearDbAndCacheFaults).toBe(true);
    rb = r2.nextState;

    const r3 = executeRunbookStep(rb, 'drain', ctx);
    expect(r3.shouldRestoreCluster).toBe(true);
    rb = r3.nextState;

    const r4 = executeRunbookStep(rb, 'verify', ctx);
    expect(r4.shouldRestoreCluster).toBe(true);
    expect(r4.nextState.currentP99Ms).toBeLessThan(45);
    rb = r4.nextState;

    const r5 = executeRunbookStep(rb, 'export', ctx);
    expect(r5.nextState.lifecycle).toBe('resolved');
    expect(r5.nextState.resolvedAtUtc).not.toBeNull();
    expect(r5.nextState.timeline).toHaveLength(5);
    expect(r5.nextState.mttrSeconds).toBe(18 + 32 + 44 + 26 + 12);
    expect(getNextPendingStep(r5.nextState)).toBeNull();
  });

  it('advances via executeNextRunbookStep and handles completed state idempotently', () => {
    const ctx = buildContext();
    let rb = createInitialRunbookState();
    for (let i = 0; i < 6; i++) {
      rb = executeNextRunbookStep(rb, ctx).nextState;
    }
    expect(rb.lifecycle).toBe('resolved');
    expect(rb.timeline).toHaveLength(5);
  });

  it('auto-remediates all remaining steps atomically via executeAllRemainingSteps', () => {
    const ctx = buildContext();
    const res = executeAllRemainingSteps(createInitialRunbookState(), ctx);
    expect(res.nextState.lifecycle).toBe('resolved');
    expect(res.nextState.timeline).toHaveLength(5);
    expect(res.shouldRestoreCluster).toBe(true);
    expect(res.shouldClearDbAndCacheFaults).toBe(true);
  });

  it('prepends UTF-8 BOM without double-encoding via ensureUtf8Bom', () => {
    const once = ensureUtf8Bom('hello');
    expect(once.startsWith(UTF8_BOM)).toBe(true);
    expect(ensureUtf8Bom(once)).toBe(once);
    expect(once.charCodeAt(0)).toBe(0xfeff);
  });

  it('exports UTF-8 BOM Markdown post-mortem containing Raft quorum, HPA, flamegraph hotspots & timeline', () => {
    const ctx = buildContext();
    const resolved = executeAllRemainingSteps(createInitialRunbookState('INC-BOM-MD'), ctx).nextState;
    const md = exportRunbookPostMortemMarkdown(resolved, ctx);
    expect(md.startsWith(UTF8_BOM)).toBe(true);
    expect(md).toContain('# AegisPulse v3.0 Enterprise SRE Incident Post-Mortem');
    expect(md).toContain('INC-BOM-MD');
    expect(md).toContain('Multi-Region Raft Quorum');
    expect(md).toContain('Top Flamegraph Latency Hotspots');
    expect(md).toContain('RESOLVED');
  });

  it('exports UTF-8 BOM valid JSON post-mortem with schemaVersion 3.0.0 and full telemetry', () => {
    const ctx = buildContext();
    const resolved = executeAllRemainingSteps(createInitialRunbookState('INC-BOM-JSON'), ctx).nextState;
    const rawJson = exportRunbookPostMortemJson(resolved, ctx);
    expect(rawJson.startsWith(UTF8_BOM)).toBe(true);
    const parsed = JSON.parse(rawJson.slice(1)) as Record<string, unknown>;
    expect(parsed.schemaVersion).toBe('3.0.0');
    expect((parsed.incident as { incidentId: string }).incidentId).toBe('INC-BOM-JSON');
    expect((parsed.timeline as unknown[])).toHaveLength(5);
    expect((parsed.loadStress as { targetRps: number }).targetRps).toBe(120000);
  });
});

describe('v3.0 Enterprise License Quote & MBBank VietQR Checkout Engine', () => {
  it('configures exact verified MBBank 970422 account 0325456574 for TRUONG VAN TINH', () => {
    expect(MBBANK_CONFIG.bankBin).toBe('970422');
    expect(MBBANK_CONFIG.accountNumber).toBe('0325456574');
    expect(MBBANK_CONFIG.accountHolder).toBe('TRUONG VAN TINH');
  });

  it('offers 3 enterprise commissioning tiers anchored by Flagship #2 at 22.900.000 VND', () => {
    expect(ENTERPRISE_LICENSE_TIERS).toHaveLength(3);
    const flagship = ENTERPRISE_LICENSE_TIERS[0];
    expect(flagship.id).toBe('enterprise-sre');
    expect(flagship.amountVnd).toBe(22900000);
    expect(formatVnd(flagship.amountVnd)).toBe('22.900.000 VND');
    expect(formatVnd(38500000)).toBe('38.500.000 VND');
    expect(formatVnd(-500)).toBe('0 VND');
  });

  it('sanitizes Vietnamese diacritics and special characters for Napas 24/7 transfer memos', () => {
    expect(sanitizeTransferMemo('Trương Văn Tình @ Corp!')).toBe('TRUONG VAN TINH CORP');
    expect(sanitizeTransferMemo('Công ty Cổ phần Đổi mới', 20).length).toBeLessThanOrEqual(20);
  });

  it('builds a valid img.vietqr.io MBBank URL with exact amount, memo, and accountName', () => {
    const url = buildMbBankVietQrUrl({
      amountVnd: 22900000,
      addInfo: 'AEGISPULSE V3 LICENSE AP3-4821',
    });
    expect(url).toContain('https://img.vietqr.io/image/970422-0325456574-compact2.png?');
    const parsed = new URL(url);
    expect(parsed.searchParams.get('amount')).toBe('22900000');
    expect(parsed.searchParams.get('addInfo')).toBe('AEGISPULSE V3 LICENSE AP3-4821');
    expect(parsed.searchParams.get('accountName')).toBe('TRUONG VAN TINH');
  });

  it('generates deterministic quote references and bounded enterprise transfer memos', () => {
    const ref1 = createQuoteReference('enterprise-sre', 'Con Cung Corp');
    const ref2 = createQuoteReference('enterprise-sre', 'Con Cung Corp');
    expect(ref1).toBe(ref2);
    expect(ref1).toMatch(/^AP3-\d{4}$/);

    const memo = buildEnterpriseTransferMemo(
      ENTERPRISE_LICENSE_TIERS[0],
      'Công ty Siêu Thị Con Cưng Quốc Tế',
      ref1
    );
    expect(memo.length).toBeLessThanOrEqual(50);
    expect(memo).toContain('AEGISPULSE V3 LICENSE');
    expect(memo).toContain(ref1);
  });

  it('exports a UTF-8 BOM enterprise license quote Markdown containing MBBank VietQR settlement details', () => {
    const tier = ENTERPRISE_LICENSE_TIERS[0];
    const ref = createQuoteReference(tier.id, 'ACME Fintech');
    const memo = buildEnterpriseTransferMemo(tier, 'ACME Fintech', ref);
    const qr = buildMbBankVietQrUrl({ amountVnd: tier.amountVnd, addInfo: memo });
    const md = generateEnterpriseQuoteMarkdown({
      tier,
      organizationName: 'ACME Fintech',
      contactEmail: 'cto@acmefintech.io',
      quoteRef: ref,
      transferMemo: memo,
      vietQrUrl: qr,
    });

    expect(md.startsWith(UTF8_BOM)).toBe(true);
    expect(md).toContain('22.900.000 VND');
    expect(md).toContain('970422');
    expect(md).toContain('0325456574');
    expect(md).toContain('TRUONG VAN TINH');
    expect(md).toContain('https://img.vietqr.io/image/970422-0325456574-compact2.png');
  });
});

describe('v3.0 Extended Boundary, Quorum Invariant, HPA, Flamegraph & VietQR Edge Suite', () => {
  it('computes strict Raft majority quorum across odd and even cluster sizes', () => {
    expect(calculateQuorumSize(1)).toBe(1);
    expect(calculateQuorumSize(3)).toBe(2);
    expect(calculateQuorumSize(4)).toBe(3);
    expect(calculateQuorumSize(5)).toBe(3);
    expect(calculateQuorumSize(9)).toBe(5);
  });

  it('tracks exact active leader replication edge count across healthy, degraded, and quorum-lost states', () => {
    const healthy = createInitialClusterState();
    expect(healthy.edges.filter((e) => e.isLeaderReplicationEdge)).toHaveLength(4);

    const oneCut = cutRegionFiber(healthy, 'ap-south-1');
    expect(oneCut.edges.filter((e) => e.isLeaderReplicationEdge)).toHaveLength(3);

    let lost = cutRegionFiber(oneCut, 'eu-central-1');
    lost = cutRegionFiber(lost, 'us-east-1');
    expect(lost.edges.filter((e) => e.isLeaderReplicationEdge)).toHaveLength(0);
  });

  it('caps chaos event audit feed at 24 entries under sustained fault toggling', () => {
    let state = createInitialClusterState();
    for (let i = 0; i < 30; i++) {
      state = toggleTailLatency180Ms(state);
    }
    expect(state.events.length).toBeLessThanOrEqual(24);
  });

  it('advances region fencing tokens monotonically with each Raft leader failover term', () => {
    const s0 = createInitialClusterState();
    const s1 = transferLeaderManually(s0, 'ap-northeast-1');
    const s2 = transferLeaderManually(s1, 'us-east-1');
    const activeNodes = s2.regions.filter((r) => r.reachable);
    for (const node of activeNodes) {
      expect(node.fencingToken).toBe(s0.raftTerm + 2);
    }
  });

  it('caps combined worst-case error budget burn rate cleanly at <= 28.0x', () => {
    let state = createInitialClusterState();
    state = cutRegionFiber(state, 'ap-southeast-1');
    state = cutRegionFiber(state, 'ap-northeast-1');
    state = cutRegionFiber(state, 'us-east-1');
    state = toggleTailLatency180Ms(state);
    state = toggleRedisCacheStampede(state);
    state = toggleDbConnectionExhaustion(state);
    expect(state.errorBudgetBurnRate).toBeLessThanOrEqual(28.0);
    expect(state.errorBudgetBurnRate).toBeGreaterThan(20.0);
  });

  it('keeps dropped RPS at zero below cluster saturation capacity', () => {
    const mid = simulateLoadStressProfile(120000, 'dotnet10');
    expect(mid.droppedRps).toBe(0);
    expect(mid.effectiveThroughputRps).toBe(120000);
    expect(mid.throughputSaturationPct).toBeLessThan(80);
  });

  it('models realistic HPA scale-out lag above 140K RPS while preserving min/max pod bounds', () => {
    const spike = simulateLoadStressProfile(210000, 'dotnet10');
    expect(spike.hpaPodsCurrent).toBeLessThan(spike.hpaPodsDesired);
    expect(spike.hpaPodsCurrent).toBeGreaterThanOrEqual(spike.hpaPodsMin);
    expect(spike.hpaPodsDesired).toBeLessThanOrEqual(spike.hpaPodsMax);
  });

  it('falls back cleanly to root flamegraph layout when given an unknown focus frame ID', () => {
    const profile = simulateLoadStressProfile(80000, 'dotnet10');
    const fallback = flattenFlamegraphLayout(profile.flamegraphRoot, 'unknown-frame-999');
    expect(fallback[0].frame.id).toBe('root-ingress');
    expect(fallback[0].widthPct).toBe(100);
  });

  it('computes Redis cache stampede hotspot guidance inside the Redis Lua flamegraph frame', () => {
    const stampededCluster = toggleRedisCacheStampede(createInitialClusterState());
    const profile = simulateLoadStressProfile(95000, 'dotnet10', stampededCluster);
    const redisFrame = findFlameFrameById(profile.flamegraphRoot, 'redis-lua')!;
    expect(redisFrame.tip).toContain('HOTSPOT');
    expect(redisFrame.totalMs).toBeGreaterThan(0);
  });

  it('elevates Go 1.24 STW GC pause duration and allocation rate under high RPS and chaos', () => {
    const calmGo = simulateLoadStressProfile(25000, 'go124');
    const chaosGo = simulateLoadStressProfile(
      220000,
      'go124',
      toggleRedisCacheStampede(createInitialClusterState())
    );
    expect(chaosGo.gcProfile.p99GcPauseMs).toBeGreaterThan(calmGo.gcProfile.p99GcPauseMs);
    expect(chaosGo.gcProfile.allocRateMbPerSec).toBeGreaterThan(calmGo.gcProfile.allocRateMbPerSec);
  });

  it('prevents re-executing an already completed runbook step', () => {
    const cluster = createInitialClusterState();
    const loadProfile = simulateLoadStressProfile(85000, 'dotnet10', cluster);
    const ctx = { cluster, loadProfile };

    const afterDetect = executeRunbookStep(createInitialRunbookState(), 'detect', ctx).nextState;
    expect(canExecuteStep(afterDetect, 'detect')).toBe(false);
    const duplicate = executeRunbookStep(afterDetect, 'detect', ctx);
    expect(duplicate.nextState).toBe(afterDetect);
    expect(duplicate.nextState.timeline).toHaveLength(1);
  });

  it('reduces projected P99 latency during mitigate and drain steps under active chaos spike', () => {
    const cluster = toggleDbConnectionExhaustion(toggleTailLatency180Ms(createInitialClusterState()));
    const loadProfile = simulateLoadStressProfile(140000, 'dotnet10', cluster);
    const ctx = { cluster, loadProfile };

    let rb = createInitialRunbookState();
    rb = executeRunbookStep(rb, 'detect', ctx).nextState;
    const baseline = rb.baselineP99Ms!;
    rb = executeRunbookStep(rb, 'mitigate', ctx).nextState;
    expect(rb.currentP99Ms!).toBeLessThan(baseline);
    rb = executeRunbookStep(rb, 'drain', ctx).nextState;
    expect(rb.currentP99Ms!).toBeLessThan(45);
  });

  it('generates valid VietQR URLs for all 3 enterprise license tiers with exact VND amounts', () => {
    for (const tier of ENTERPRISE_LICENSE_TIERS) {
      const ref = createQuoteReference(tier.id, 'Enterprise Client');
      const memo = buildEnterpriseTransferMemo(tier, 'Enterprise Client', ref);
      const url = buildMbBankVietQrUrl({ amountVnd: tier.amountVnd, addInfo: memo });
      const parsed = new URL(url);
      expect(parsed.hostname).toBe('img.vietqr.io');
      expect(parsed.pathname).toBe('/image/970422-0325456574-compact2.png');
      expect(parsed.searchParams.get('amount')).toBe(String(tier.amountVnd));
      expect(parsed.searchParams.get('accountName')).toBe('TRUONG VAN TINH');
    }
  });

  it('handles blank organization name cleanly in quote markdown and transfer memo', () => {
    const tier = ENTERPRISE_LICENSE_TIERS[0];
    const ref = createQuoteReference(tier.id, '');
    const memo = buildEnterpriseTransferMemo(tier, '', ref);
    expect(memo).toBe(`${tier.memoPrefix} ${ref}`);

    const md = generateEnterpriseQuoteMarkdown({
      tier,
      organizationName: '',
      contactEmail: '',
      quoteRef: ref,
      transferMemo: memo,
      vietQrUrl: buildMbBankVietQrUrl({ amountVnd: tier.amountVnd, addInfo: memo }),
    });
    expect(md).toContain('Enterprise Evaluation Client');
    expect(md).toContain('Pending confirmation');
  });

  it('keeps transfer memos strictly ASCII uppercase alphanumeric without diacritics or unsafe punctuation', () => {
    const cleaned = sanitizeTransferMemo('Đặt mua gói AegisPulse #3 — Hồ Chí Minh (VN)!');
    expect(cleaned).toMatch(/^[A-Z0-9 -]+$/);
    expect(cleaned.length).toBeLessThanOrEqual(50);
  });
});

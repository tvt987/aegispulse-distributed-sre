import { describe, expect, it } from 'vitest';
import {
  applySplitBrainPreset,
  blastVoucherStorm,
  computeConnectedComponents,
  createInitialDstCluster,
  DEFAULT_DST_SEED,
  DEGRADED_JITTER_MS,
  deriveNextSeed,
  DST_FIXED_STEP_MS,
  DST_REGION_ORDER,
  evaluateLinearizability,
  evaluateQuadraticBezier,
  findClosestLinkAtPoint,
  findLinkBetween,
  findNodeAtPoint,
  formatRowVersionHex,
  getSnapshotAtTick,
  healAllDstFaults,
  nextPrng,
  normalizeSeed,
  replayDstSimulation,
  setDstEngineMode,
  setDstLinkStatus,
  stepDstCluster,
  toggleDstLinkScissors,
  toggleDstNodeCrash,
  type DstClusterState,
  type DstRecordedCommand,
} from '../dstChaosClusterEngine';

function advanceMs(initial: DstClusterState, totalMs: number): DstClusterState {
  let state = initial;
  const steps = Math.ceil(totalMs / DST_FIXED_STEP_MS);
  for (let i = 0; i < steps; i++) {
    state = stepDstCluster(state, DST_FIXED_STEP_MS);
  }
  return state;
}

describe('v7.0 Deterministic Simulation Testing (DST) & Raft + Voucher Chaos Engine', () => {
  it('initializes a 5-region full-mesh cluster with SG-PRIMARY as Term 1 Leader', () => {
    const state = createInitialDstCluster(DEFAULT_DST_SEED);
    expect(state.seed).toBe(48291);
    expect(state.nodes).toHaveLength(5);
    expect(state.nodes.map((n) => n.id).sort()).toEqual([...DST_REGION_ORDER].sort());
    expect(state.links).toHaveLength(10);
    expect(state.leaderId).toBe('SG-PRIMARY');
    expect(state.clusterTerm).toBe(1);
    expect(state.hasQuorum).toBe(true);
    expect(state.majoritySize).toBe(5);
    expect(state.partitionWallActive).toBe(false);
    expect(state.linearizability.verdict).toBe('LINEARIZABLE');
  });

  it('normalizes invalid seeds cleanly and derives deterministic next seeds', () => {
    expect(normalizeSeed(NaN)).toBe(DEFAULT_DST_SEED);
    expect(normalizeSeed(0)).toBe(DEFAULT_DST_SEED);
    expect(normalizeSeed(-98765)).toBe(98765);
    expect(deriveNextSeed(48291)).toBe(deriveNextSeed(48291));
    expect(deriveNextSeed(48291)).not.toBe(48291);
  });

  it('produces identical PRNG sequences for identical seeds', () => {
    let a = 48291;
    let b = 48291;
    for (let i = 0; i < 32; i++) {
      const ra = nextPrng(a);
      const rb = nextPrng(b);
      expect(ra.value).toBe(rb.value);
      expect(ra.value).toBeGreaterThanOrEqual(0);
      expect(ra.value).toBeLessThan(1);
      a = ra.nextState;
      b = rb.nextState;
    }
  });

  it('formats monotonic SQL Server ROWVERSION tokens as 8-digit hex strings', () => {
    expect(formatRowVersionHex(1024)).toBe('0x00000400');
    expect(formatRowVersionHex(1025)).toBe('0x00000401');
  });

  it('computes accurate hit-testing for both regional nodes and curved mesh links', () => {
    const state = createInitialDstCluster(48291);
    const sg = state.nodes.find((n) => n.id === 'SG-PRIMARY')!;
    expect(findNodeAtPoint(state.nodes, sg.x + 8, sg.y - 6)?.id).toBe('SG-PRIMARY');
    expect(findNodeAtPoint(state.nodes, 5, 5)).toBeNull();

    const link = findLinkBetween(state.links, 'SG-PRIMARY', 'JP-EAST')!;
    const jp = state.nodes.find((n) => n.id === 'JP-EAST')!;
    const mid = evaluateQuadraticBezier(sg, { x: link.controlX, y: link.controlY }, jp, 0.5);
    const hit = findClosestLinkAtPoint(state, mid.x, mid.y, 16);
    expect(hit?.id).toBe(link.id);
  });

  it('toggles a single mesh link with Chaos Scissors between SEVERED and HEALTHY with catch-up packets', () => {
    let state = createInitialDstCluster(48291);
    const link = findLinkBetween(state.links, 'SG-PRIMARY', 'JP-EAST')!;

    state = toggleDstLinkScissors(state, link.id);
    expect(state.links.find((l) => l.id === link.id)?.status).toBe('SEVERED');
    expect(state.history.some((h) => h.kind === 'LINK_CUT')).toBe(true);
    // Cluster still has full connectivity via alternate mesh links
    expect(state.hasQuorum).toBe(true);
    expect(state.majoritySize).toBe(5);

    state = toggleDstLinkScissors(state, link.id);
    expect(state.links.find((l) => l.id === link.id)?.status).toBe('HEALTHY');
    expect(state.history.some((h) => h.kind === 'LINK_HEALED')).toBe(true);
    expect(state.packets.some((p) => p.kind === 'LOG_CATCHUP')).toBe(true);
  });

  it('supports DEGRADED (+220ms jitter) link state and logs jitter telemetry', () => {
    let state = createInitialDstCluster(48291);
    const link = findLinkBetween(state.links, 'JP-EAST', 'US-EAST')!;
    state = setDstLinkStatus(state, link.id, 'DEGRADED');

    const updated = state.links.find((l) => l.id === link.id)!;
    expect(updated.status).toBe('DEGRADED');
    expect(updated.effectiveLatencyMs).toBe(link.baseLatencyMs + DEGRADED_JITTER_MS);
    expect(state.history.some((h) => h.kind === 'LINK_DEGRADED')).toBe(true);
  });

  it('computes 2 connected components (2 vs 3) when Split-Brain Preset slices the cluster', () => {
    let state = createInitialDstCluster(48291);
    state = applySplitBrainPreset(state);

    expect(state.partitionWallActive).toBe(true);
    expect(state.links.filter((l) => l.isCrossSplitBrain).every((l) => l.status === 'SEVERED')).toBe(true);
    expect(state.links.filter((l) => !l.isCrossSplitBrain).every((l) => l.status === 'HEALTHY')).toBe(true);

    const comps = computeConnectedComponents(state.nodes, state.links);
    const sizes = comps.map((c) => c.length).sort((a, b) => a - b);
    expect(sizes).toEqual([2, 3]);
    expect(state.hasQuorum).toBe(true);
    expect(state.majoritySize).toBe(3);

    const sg = state.nodes.find((n) => n.id === 'SG-PRIMARY')!;
    expect(sg.status).toBe('PARTITIONED_MINORITY');
    expect(sg.role).toBe('STALE_LEADER_FENCED');
    expect(state.staleLeaderId).toBe('SG-PRIMARY');
  });

  it('triggers real Raft RequestVote -> VoteGranted -> Term 2 Leader Election in the 3-node majority', () => {
    let state = createInitialDstCluster(48291);
    state = applySplitBrainPreset(state);

    let sawRequestVote = false;
    let sawVoteGranted = false;

    for (let i = 0; i < 120; i++) {
      state = stepDstCluster(state, DST_FIXED_STEP_MS);
      if (state.packets.some((p) => p.kind === 'REQUEST_VOTE')) sawRequestVote = true;
      if (state.packets.some((p) => p.kind === 'VOTE_GRANTED')) sawVoteGranted = true;
    }

    expect(sawRequestVote).toBe(true);
    expect(sawVoteGranted).toBe(true);
    expect(state.clusterTerm).toBeGreaterThanOrEqual(2);
    expect(state.fencingEpoch).toBeGreaterThanOrEqual(2);
    expect(['JP-EAST', 'US-EAST', 'EU-WEST']).toContain(state.leaderId);
    expect(state.staleLeaderId).toBe('SG-PRIMARY');
    expect(state.metrics.electionsCompleted).toBeGreaterThanOrEqual(2);
    expect(state.history.some((h) => h.kind === 'LEADER_ELECTED' && h.term >= 2)).toBe(true);
  });

  it('enforces Raft Election Safety (never elects 2 active majority leaders in the same term)', () => {
    let state = createInitialDstCluster(48291);
    state = applySplitBrainPreset(state);
    state = advanceMs(state, 2400);

    const majorityLeaders = state.nodes.filter(
      (n) => n.role === 'LEADER' && n.status === 'HEALTHY'
    );
    expect(majorityLeaders).toHaveLength(1);
    expect(evaluateLinearizability(state.metrics, state.nodes).electionSafetyIntact).toBe(true);
  });

  it('fences stale-leader writes (409 STALE_TERM) with 0 double-spend leaks under Aegis Redis Lua during Split-Brain', () => {
    let state = createInitialDstCluster(48291, 'AEGIS_LUA_WAL');
    state = applySplitBrainPreset(state);
    state = advanceMs(state, 2200); // wait for Term 2 leader election in majority

    state = blastVoucherStorm(state, 500);

    expect(state.metrics.totalVoucherRequests).toBe(500);
    expect(state.metrics.committed200).toBe(1);
    expect(state.metrics.fenced409).toBe(499);
    expect(state.metrics.doubleSpendLeaks).toBe(0);
    expect(state.metrics.staleLeaderFenced).toBeGreaterThan(0);
    expect(state.linearizability.verdict).toBe('LINEARIZABLE');
    expect(state.linearizability.label).toBe('LINEARIZABLE — 0 VIOLATIONS');
  });

  it('preserves 0 leaks under ROWVERSION_CAS with higher CAS contention latency than Aegis Lua', () => {
    const aegis = blastVoucherStorm(createInitialDstCluster(48291, 'AEGIS_LUA_WAL'), 500);
    const cas = blastVoucherStorm(createInitialDstCluster(48291, 'ROWVERSION_CAS'), 500);

    expect(aegis.metrics.committed200).toBe(1);
    expect(aegis.metrics.doubleSpendLeaks).toBe(0);
    expect(cas.metrics.committed200).toBe(1);
    expect(cas.metrics.doubleSpendLeaks).toBe(0);
    expect(cas.linearizability.verdict).toBe('LINEARIZABLE');
    expect(cas.metrics.lastStormLatencyP99Ms).toBeGreaterThan(aegis.metrics.lastStormLatencyP99Ms);
  });

  it('explodes with double-spend violations under NAIVE_RMW on a 500-request voucher storm', () => {
    let state = createInitialDstCluster(48291, 'NAIVE_RMW');
    state = blastVoucherStorm(state, 500);

    expect(state.metrics.committed200).toBe(1);
    expect(state.metrics.doubleSpendLeaks).toBeGreaterThanOrEqual(12);
    expect(state.linearizability.verdict).toBe('VIOLATION');
    expect(state.linearizability.label).toBe('LINEARIZABILITY VIOLATION DETECTED');
    expect(state.linearizability.singleSpendIntact).toBe(false);
    expect(state.history.some((h) => h.kind === 'DOUBLE_SPEND_LEAK')).toBe(true);
    expect(state.packets.some((p) => p.kind === 'DOUBLE_SPEND_LEAK')).toBe(true);
  });

  it('produces additional split-brain leaks on stale minority leader under NAIVE_RMW', () => {
    let state = createInitialDstCluster(48291, 'NAIVE_RMW');
    state = applySplitBrainPreset(state);
    state = advanceMs(state, 2200);
    state = blastVoucherStorm(state, 500);

    expect(state.metrics.doubleSpendLeaks).toBeGreaterThanOrEqual(18);
    const minorityEvents = state.history.filter(
      (h) =>
        h.kind === 'DOUBLE_SPEND_LEAK' &&
        (h.region === 'SG-PRIMARY' || h.region === 'AU-SYD')
    );
    expect(minorityEvents.length).toBeGreaterThan(0);
    expect(state.linearizability.verdict).toBe('VIOLATION');
  });

  it('fails over leadership automatically when SG-PRIMARY Leader is hard-crashed', () => {
    let state = createInitialDstCluster(48291);
    state = toggleDstNodeCrash(state, 'SG-PRIMARY');

    const crashedSg = state.nodes.find((n) => n.id === 'SG-PRIMARY')!;
    expect(crashedSg.status).toBe('CRASHED');
    expect(crashedSg.role).toBe('OFFLINE');
    expect(state.leaderId).toBeNull();
    expect(state.hasQuorum).toBe(true);
    expect(state.majoritySize).toBe(4);
    expect(state.history.some((h) => h.kind === 'NODE_CRASH' && h.region === 'SG-PRIMARY')).toBe(true);

    state = advanceMs(state, 2400);
    expect(state.leaderId).not.toBeNull();
    expect(state.leaderId).not.toBe('SG-PRIMARY');
    expect(state.clusterTerm).toBeGreaterThanOrEqual(2);
  });

  it('resurrects a crashed node cleanly as a FOLLOWER and streams LOG_CATCHUP sync packets', () => {
    let state = createInitialDstCluster(48291);
    state = toggleDstNodeCrash(state, 'SG-PRIMARY');
    state = advanceMs(state, 2200);
    const newLeader = state.leaderId!;
    expect(newLeader).not.toBe('SG-PRIMARY');

    state = toggleDstNodeCrash(state, 'SG-PRIMARY');
    const revivedSg = state.nodes.find((n) => n.id === 'SG-PRIMARY')!;
    expect(revivedSg.status).toBe('HEALTHY');
    expect(revivedSg.role).toBe('FOLLOWER');
    expect(revivedSg.term).toBe(state.clusterTerm);
    expect(state.history.some((h) => h.kind === 'NODE_REVIVE' && h.region === 'SG-PRIMARY')).toBe(true);
    expect(state.packets.some((p) => p.kind === 'LOG_CATCHUP' && p.to === 'SG-PRIMARY')).toBe(true);
  });

  it('loses quorum (<3 alive nodes) when 3 regions crash and fences 100% of writes under Aegis', () => {
    let state = createInitialDstCluster(48291, 'AEGIS_LUA_WAL');
    state = toggleDstNodeCrash(state, 'SG-PRIMARY');
    state = toggleDstNodeCrash(state, 'US-EAST');
    state = toggleDstNodeCrash(state, 'EU-WEST');

    expect(state.hasQuorum).toBe(false);
    expect(state.majoritySize).toBe(0);
    expect(state.leaderId).toBeNull();

    state = blastVoucherStorm(state, 500);
    expect(state.metrics.committed200).toBe(0);
    expect(state.metrics.fenced409).toBe(500);
    expect(state.metrics.doubleSpendLeaks).toBe(0);
    expect(state.linearizability.verdict).toBe('LINEARIZABLE');
  });

  it('heals all partitions, revives crashed nodes, and synchronizes commitIndex on healAllDstFaults', () => {
    let state = createInitialDstCluster(48291);
    state = applySplitBrainPreset(state);
    state = advanceMs(state, 2200);
    state = blastVoucherStorm(state, 500);
    state = toggleDstNodeCrash(state, 'AU-SYD');

    state = healAllDstFaults(state);
    expect(state.partitionWallActive).toBe(false);
    expect(state.hasQuorum).toBe(true);
    expect(state.majoritySize).toBe(5);
    expect(state.nodes.every((n) => n.status === 'HEALTHY')).toBe(true);
    expect(state.links.every((l) => l.status === 'HEALTHY')).toBe(true);
    const commits = new Set(state.nodes.map((n) => n.commitIndex));
    expect(commits.size).toBe(1);
    expect(state.staleLeaderId).toBeNull();
  });

  it('replays complex multi-fault DST scenarios bit-for-bit identically for the same seed', () => {
    const commands: DstRecordedCommand[] = [
      { tickMs: 120, type: 'SPLIT_BRAIN_PRESET' },
      { tickMs: 2000, type: 'BLAST_VOUCHER_STORM', requestCount: 500 },
      { tickMs: 2400, type: 'SET_ENGINE', engine: 'NAIVE_RMW' },
      { tickMs: 2500, type: 'BLAST_VOUCHER_STORM', requestCount: 500 },
      { tickMs: 2800, type: 'HEAL_ALL' },
      { tickMs: 3000, type: 'TOGGLE_NODE_CRASH', regionId: 'JP-EAST' },
    ];

    const run1 = replayDstSimulation(48291, commands, 3600, 'AEGIS_LUA_WAL');
    const run2 = replayDstSimulation(48291, commands, 3600, 'AEGIS_LUA_WAL');

    expect(run1.tickMs).toBe(3600);
    expect(run1.clusterTerm).toBe(run2.clusterTerm);
    expect(run1.leaderId).toBe(run2.leaderId);
    expect(run1.rowVersionSeq).toBe(run2.rowVersionSeq);
    expect(run1.metrics).toEqual(run2.metrics);
    expect(run1.linearizability).toEqual(run2.linearizability);
    expect(run1.history).toEqual(run2.history);
    expect(run1.nodes.map((n) => ({ id: n.id, role: n.role, term: n.term, commit: n.commitIndex }))).toEqual(
      run2.nodes.map((n) => ({ id: n.id, role: n.role, term: n.term, commit: n.commitIndex }))
    );
  });

  it('maintains deterministic time-travel snapshots and retrieves exact past millisecond states', () => {
    let state = createInitialDstCluster(48291, 'AEGIS_LUA_WAL');
    state = advanceMs(state, 300);
    const tickBeforeSplit = state.tickMs;
    state = advanceMs(state, 100);

    state = applySplitBrainPreset(state);
    state = advanceMs(state, 2200);
    const tickDuringSplit = state.tickMs;

    state = advanceMs(state, 120);
    state = setDstEngineMode(state, 'NAIVE_RMW');
    state = blastVoucherStorm(state, 500);
    const tickAfterLeak = state.tickMs;

    const snap0 = getSnapshotAtTick(state.snapshots, tickBeforeSplit)!;
    const snap1 = getSnapshotAtTick(state.snapshots, tickDuringSplit)!;
    const snap2 = getSnapshotAtTick(state.snapshots, tickAfterLeak)!;

    expect(snap0.partitionWallActive).toBe(false);
    expect(snap0.leaderId).toBe('SG-PRIMARY');
    expect(snap0.linearizability.verdict).toBe('LINEARIZABLE');

    expect(snap1.partitionWallActive).toBe(true);
    expect(snap1.term).toBeGreaterThanOrEqual(2);
    expect(snap1.linearizability.verdict).toBe('LINEARIZABLE');

    expect(snap2.linearizability.verdict).toBe('VIOLATION');
    expect(snap2.metrics.doubleSpendLeaks).toBeGreaterThan(0);
  });

  it('records every user chaos action into recordedCommands so interactive runs are always replayable', () => {
    let state = createInitialDstCluster(48291);
    const linkId = state.links[0].id;
    state = advanceMs(state, 100);
    state = toggleDstLinkScissors(state, linkId);
    state = advanceMs(state, 100);
    state = setDstEngineMode(state, 'ROWVERSION_CAS');
    state = blastVoucherStorm(state, 500);

    expect(state.recordedCommands.map((c) => c.type)).toEqual([
      'TOGGLE_LINK',
      'SET_ENGINE',
      'BLAST_VOUCHER_STORM',
    ]);

    const replayed = replayDstSimulation(state.seed, state.recordedCommands, state.tickMs);
    expect(replayed.metrics.committed200).toBe(state.metrics.committed200);
    expect(replayed.metrics.fenced409).toBe(state.metrics.fenced409);
    expect(replayed.engine).toBe('ROWVERSION_CAS');
  });

  it('preserves single-spend linearizability across 12 distinct DST seeds under Aegis Lua + Split-Brain', () => {
    for (let i = 0; i < 12; i++) {
      const seed = 10000 + i * 7919;
      let state = createInitialDstCluster(seed, 'AEGIS_LUA_WAL');
      state = applySplitBrainPreset(state);
      state = advanceMs(state, 2400);
      state = blastVoucherStorm(state, 500);
      state = blastVoucherStorm(state, 500);

      expect(state.metrics.committed200).toBe(2);
      expect(state.metrics.doubleSpendLeaks).toBe(0);
      expect(state.linearizability.verdict).toBe('LINEARIZABLE');
    }
  });

  it('produces reproducible leak counts across distinct seeds under Naive RMW', () => {
    const leakCounts: number[] = [];
    for (const seed of [11111, 22222, 33333, 48291, 99991]) {
      const res = blastVoucherStorm(createInitialDstCluster(seed, 'NAIVE_RMW'), 500);
      expect(res.metrics.doubleSpendLeaks).toBeGreaterThanOrEqual(12);
      expect(res.linearizability.verdict).toBe('VIOLATION');
      leakCounts.push(res.metrics.doubleSpendLeaks);
    }
    expect(new Set(leakCounts).size).toBeGreaterThan(1);
  });

  it('demotes former stale leader to FOLLOWER upon healing cross-partition links via LOG_CATCHUP', () => {
    let state = createInitialDstCluster(48291);
    state = applySplitBrainPreset(state);
    state = advanceMs(state, 2200);
    expect(state.nodes.find((n) => n.id === 'SG-PRIMARY')?.role).toBe('STALE_LEADER_FENCED');

    // Heal just one cross-partition link connecting SG-PRIMARY back to majority
    const bridge = findLinkBetween(state.links, 'SG-PRIMARY', 'JP-EAST')!;
    state = setDstLinkStatus(state, bridge.id, 'HEALTHY');
    state = advanceMs(state, 1000);

    const sg = state.nodes.find((n) => n.id === 'SG-PRIMARY')!;
    expect(sg.status).toBe('HEALTHY');
    expect(sg.role).toBe('FOLLOWER');
    expect(sg.term).toBe(state.clusterTerm);
  });

  it('drops packets cleanly if target node crashes mid-flight without throwing', () => {
    let state = createInitialDstCluster(48291);
    state = blastVoucherStorm(state, 500);
    expect(state.packets.length).toBeGreaterThan(0);

    state = toggleDstNodeCrash(state, 'US-EAST');
    state = advanceMs(state, 1200);
    expect(state.nodes.find((n) => n.id === 'US-EAST')?.status).toBe('CRASHED');
    expect(state.metrics.packetsDropped).toBeGreaterThanOrEqual(0);
  });

  it('handles zero-alive cluster gracefully when all 5 nodes are crashed', () => {
    let state = createInitialDstCluster(48291);
    for (const regionId of DST_REGION_ORDER) {
      state = toggleDstNodeCrash(state, regionId);
    }
    expect(state.hasQuorum).toBe(false);
    expect(state.leaderId).toBeNull();
    state = blastVoucherStorm(state, 500);
    expect(state.metrics.committed200).toBe(0);
    expect(state.metrics.fenced409).toBe(500);
    expect(state.metrics.doubleSpendLeaks).toBe(0);
  });

  it('bounds active packet, shockwave, history, and snapshot arrays under sustained execution', () => {
    let state = createInitialDstCluster(48291);
    for (let wave = 0; wave < 6; wave++) {
      state = blastVoucherStorm(state, 500);
      state = advanceMs(state, 500);
    }
    expect(state.packets.length).toBeLessThanOrEqual(220);
    expect(state.shockwaves.length).toBeLessThanOrEqual(48);
    expect(state.history.length).toBeLessThanOrEqual(320);
    expect(state.snapshots.length).toBeLessThanOrEqual(260);
  });

  it('returns null from getSnapshotAtTick when snapshots array is empty', () => {
    expect(getSnapshotAtTick([], 100)).toBeNull();
  });

  it('advances SQL ROWVERSION sequence and cluster commitIndex on each Aegis wave', () => {
    let state = createInitialDstCluster(48291, 'AEGIS_LUA_WAL');
    const startSeq = state.rowVersionSeq;
    const startCommit = state.nodes.find((n) => n.id === 'SG-PRIMARY')!.commitIndex;

    state = blastVoucherStorm(state, 500);
    state = blastVoucherStorm(state, 500);

    expect(state.rowVersionSeq).toBe(startSeq + 2);
    expect(state.nodes.find((n) => n.id === 'SG-PRIMARY')!.commitIndex).toBe(startCommit + 2);
  });

  it('propagates committed index to healthy majority followers after voucher storm', () => {
    let state = createInitialDstCluster(48291, 'AEGIS_LUA_WAL');
    state = applySplitBrainPreset(state);
    state = advanceMs(state, 2200);
    state = blastVoucherStorm(state, 500);

    const jp = state.nodes.find((n) => n.id === 'JP-EAST')!;
    const us = state.nodes.find((n) => n.id === 'US-EAST')!;
    const eu = state.nodes.find((n) => n.id === 'EU-WEST')!;
    const sg = state.nodes.find((n) => n.id === 'SG-PRIMARY')!;

    expect(jp.commitIndex).toBe(101);
    expect(us.commitIndex).toBe(101);
    expect(eu.commitIndex).toBe(101);
    // Partitioned stale minority leader did NOT advance commitIndex
    expect(sg.commitIndex).toBe(100);
  });
});

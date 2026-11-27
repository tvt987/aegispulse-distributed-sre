import { describe, expect, it } from 'vitest';
import {
  applyQuorumScenario,
  createInitialQuorumLabState,
  cycleRegionHealthState,
  getNextCycledHealthState,
  getQuorumPairwiseRtt,
  QUORUM_REGIONS,
  setRegionHealthState,
} from '../quorumFailoverEngine';

describe('quorumFailoverEngine — 5-Region Raft Quorum & Split-Brain Failover Lab', () => {
  it('initializes all 5 Con Cung global regions ONLINE with VN-HCM Primary as Term 42 Leader', () => {
    const state = createInitialQuorumLabState();
    expect(state.totalNodes).toBe(5);
    expect(state.quorumRequired).toBe(3);
    expect(state.onlineCount).toBe(5);
    expect(state.hasQuorum).toBe(true);
    expect(state.clusterWriteMode).toBe('READ_WRITE');
    expect(state.splitBrainFenceActive).toBe(false);
    expect(state.electedLeaderId).toBe('vn-hcm');
    expect(state.raftTerm).toBe(42);
    expect(state.rpoSeconds).toBe(0);
    expect(state.rtoMs).toBe(0);
    expect(state.edges).toHaveLength(10);
  });

  it('contains exact 5 required region identifiers and display names', () => {
    expect(QUORUM_REGIONS.map((r) => r.displayName)).toEqual([
      'VN-HCM Primary',
      'SG-1',
      'JP-Tokyo',
      'US-East',
      'EU-West',
    ]);
  });

  it('cycles region state deterministically ONLINE -> PARTITIONED -> HARD_CRASH -> ONLINE', () => {
    expect(getNextCycledHealthState('ONLINE')).toBe('PARTITIONED');
    expect(getNextCycledHealthState('PARTITIONED')).toBe('HARD_CRASH');
    expect(getNextCycledHealthState('HARD_CRASH')).toBe('ONLINE');

    let s = createInitialQuorumLabState();
    s = cycleRegionHealthState(s, 'eu-west');
    expect(s.regionStates['eu-west']).toBe('PARTITIONED');
    s = cycleRegionHealthState(s, 'eu-west');
    expect(s.regionStates['eu-west']).toBe('HARD_CRASH');
    s = cycleRegionHealthState(s, 'eu-west');
    expect(s.regionStates['eu-west']).toBe('ONLINE');
  });

  it('elects SG-1 automatically and increments Raft term when VN-HCM Primary crashes', () => {
    const init = createInitialQuorumLabState();
    const afterCrash = setRegionHealthState(init, 'vn-hcm', 'HARD_CRASH');

    expect(afterCrash.hasQuorum).toBe(true);
    expect(afterCrash.onlineCount).toBe(4);
    expect(afterCrash.crashedCount).toBe(1);
    expect(afterCrash.electedLeaderId).toBe('sg-1');
    expect(afterCrash.raftTerm).toBe(43);
    expect(afterCrash.electionTriggered).toBe(true);
    expect(afterCrash.clusterWriteMode).toBe('READ_WRITE');
    expect(afterCrash.rpoSeconds).toBe(0);
    expect(afterCrash.rtoMs).toBeGreaterThan(150);
  });

  it('maintains minimal 3/5 quorum and elects JP-Tokyo when VN-HCM crashes and SG-1 partitions', () => {
    let s = createInitialQuorumLabState();
    s = setRegionHealthState(s, 'vn-hcm', 'HARD_CRASH');
    s = setRegionHealthState(s, 'sg-1', 'PARTITIONED');

    expect(s.onlineCount).toBe(3);
    expect(s.hasQuorum).toBe(true);
    expect(s.electedLeaderId).toBe('jp-tokyo');
    expect(s.raftTerm).toBe(44);
    expect(s.clusterWriteMode).toBe('READ_WRITE');
    expect(s.splitBrainFenceActive).toBe(false);
  });

  it('triggers automatic READ_ONLY_FENCE when 3 regions fail (< 3/5 survive) to prevent double-spending', () => {
    let s = createInitialQuorumLabState();
    s = setRegionHealthState(s, 'vn-hcm', 'HARD_CRASH');
    s = setRegionHealthState(s, 'sg-1', 'PARTITIONED');
    s = setRegionHealthState(s, 'jp-tokyo', 'HARD_CRASH');

    expect(s.onlineCount).toBe(2);
    expect(s.hasQuorum).toBe(false);
    expect(s.clusterWriteMode).toBe('READ_ONLY_FENCE');
    expect(s.splitBrainFenceActive).toBe(true);
    expect(s.doubleSpendPrevented).toBe(true);
    expect(s.electedLeaderId).toBeNull();
    expect(s.rtoMs).toBeNull();
    expect(s.regions.filter((r) => r.role === 'FENCED')).toHaveLength(2);
    expect(s.regions.every((r) => !r.acceptsWrites)).toBe(true);
  });

  it('recovers quorum and elects a leader cleanly when a 3rd region comes back ONLINE', () => {
    let s = applyQuorumScenario(createInitialQuorumLabState(), 'split-brain-fence');
    expect(s.clusterWriteMode).toBe('READ_ONLY_FENCE');

    const termBeforeRecover = s.raftTerm;
    s = setRegionHealthState(s, 'sg-1', 'ONLINE');

    expect(s.onlineCount).toBe(3);
    expect(s.hasQuorum).toBe(true);
    expect(s.clusterWriteMode).toBe('READ_WRITE');
    expect(s.splitBrainFenceActive).toBe(false);
    expect(s.electedLeaderId).toBe('sg-1');
    expect(s.raftTerm).toBe(termBeforeRecover + 1);
  });

  it('computes majority commit RTT using the 2nd-fastest surviving follower from the leader', () => {
    const nominal = createInitialQuorumLabState();
    // VN-HCM -> SG-1 (24ms), JP-Tokyo (68ms), EU-West (176ms), US-East (212ms)
    // Majority of 5 = Leader + 2 fastest followers => 68ms
    expect(nominal.quorumCommitRttMs).toBe(68);

    // If JP-Tokyo partitions, fastest 2 followers are SG-1 (24ms) & EU-West (176ms) => 176ms
    const withoutTokyo = setRegionHealthState(nominal, 'jp-tokyo', 'PARTITIONED');
    expect(withoutTokyo.quorumCommitRttMs).toBe(176);
  });

  it('marks edges incident to PARTITIONED or HARD_CRASH nodes as SEVERED with 0 RTT', () => {
    const s = setRegionHealthState(createInitialQuorumLabState(), 'us-east', 'PARTITIONED');
    const usEdges = s.edges.filter((e) => e.from === 'us-east' || e.to === 'us-east');
    expect(usEdges).toHaveLength(4);
    expect(usEdges.every((e) => e.status === 'SEVERED' && e.rttMs === 0)).toBe(true);
  });

  it('ensures pairwise RTT lookup is symmetric and zero on self-links', () => {
    expect(getQuorumPairwiseRtt('vn-hcm', 'vn-hcm')).toBe(0);
    expect(getQuorumPairwiseRtt('vn-hcm', 'sg-1')).toBe(getQuorumPairwiseRtt('sg-1', 'vn-hcm'));
    expect(getQuorumPairwiseRtt('jp-tokyo', 'us-east')).toBe(getQuorumPairwiseRtt('us-east', 'jp-tokyo'));
  });

  it('increases follower WAL replication lag under network partition pressure while keeping leader lag at 0', () => {
    const nominal = createInitialQuorumLabState();
    const leader = nominal.regions.find((r) => r.role === 'LEADER')!;
    expect(leader.walLagMs).toBe(0);

    const partitioned = setRegionHealthState(nominal, 'us-east', 'PARTITIONED');
    const sgNominal = nominal.regions.find((r) => r.id === 'sg-1')!;
    const sgPart = partitioned.regions.find((r) => r.id === 'sg-1')!;
    expect(sgPart.walLagMs).toBeGreaterThan(sgNominal.walLagMs);
  });

  it('supports all 4 1-click failover scenario presets cleanly', () => {
    const init = createInitialQuorumLabState();

    const pCrash = applyQuorumScenario(init, 'primary-crash');
    expect(pCrash.electedLeaderId).toBe('sg-1');
    expect(pCrash.clusterWriteMode).toBe('READ_WRITE');

    const apacDual = applyQuorumScenario(pCrash, 'apac-dual-outage');
    expect(apacDual.electedLeaderId).toBe('jp-tokyo');
    expect(apacDual.onlineCount).toBe(3);

    const fence = applyQuorumScenario(apacDual, 'split-brain-fence');
    expect(fence.clusterWriteMode).toBe('READ_ONLY_FENCE');
    expect(fence.onlineCount).toBe(2);

    const restored = applyQuorumScenario(fence, 'nominal');
    expect(restored.onlineCount).toBe(5);
    expect(restored.clusterWriteMode).toBe('READ_WRITE');
    expect(restored.electedLeaderId).toBe('vn-hcm');
  });

  it('appends audit entries on every state change and caps log size at 18 entries', () => {
    let s = createInitialQuorumLabState();
    for (let i = 0; i < 25; i++) {
      s = cycleRegionHealthState(s, 'eu-west');
    }
    expect(s.auditLog.length).toBeLessThanOrEqual(18);
    expect(s.auditLog[0].message.length).toBeGreaterThan(10);
  });
});

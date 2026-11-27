export type QuorumRegionId = 'vn-hcm' | 'sg-1' | 'jp-tokyo' | 'us-east' | 'eu-west';

export type QuorumNodeHealthState = 'ONLINE' | 'PARTITIONED' | 'HARD_CRASH';

export type QuorumNodeRole = 'LEADER' | 'FOLLOWER' | 'PARTITIONED' | 'CRASHED' | 'FENCED';

export type ClusterWriteMode = 'READ_WRITE' | 'READ_ONLY_FENCE';

export type QuorumScenarioId =
  | 'nominal'
  | 'primary-crash'
  | 'apac-dual-outage'
  | 'split-brain-fence';

export interface QuorumRegionDef {
  id: QuorumRegionId;
  displayName: string;
  shortCode: string;
  city: string;
  priority: number;
  baseWalLagMs: number;
  x: number;
  y: number;
}

export interface QuorumRegionSnapshot extends QuorumRegionDef {
  state: QuorumNodeHealthState;
  role: QuorumNodeRole;
  rttToLeaderMs: number;
  walLagMs: number;
  walLagKb: number;
  fencingToken: number;
  acceptsWrites: boolean;
}

export interface QuorumMeshEdge {
  id: string;
  from: QuorumRegionId;
  to: QuorumRegionId;
  rttMs: number;
  status: 'ACTIVE_HEARTBEAT' | 'STANDBY_MESH' | 'SEVERED';
  isLeaderLink: boolean;
}

export interface QuorumAuditEvent {
  id: string;
  term: number;
  severity: 'INFO' | 'WARN' | 'CRITICAL' | 'RECOVERY';
  code: string;
  message: string;
}

export interface QuorumLabState {
  totalNodes: number;
  quorumRequired: number;
  onlineCount: number;
  partitionedCount: number;
  crashedCount: number;
  hasQuorum: boolean;
  clusterWriteMode: ClusterWriteMode;
  splitBrainFenceActive: boolean;
  doubleSpendPrevented: boolean;
  electedLeaderId: QuorumRegionId | null;
  electedLeaderName: string | null;
  raftTerm: number;
  electionTriggered: boolean;
  quorumCommitRttMs: number;
  avgHealthyRttMs: number;
  maxWalLagMs: number;
  rpoSeconds: number;
  rtoMs: number | null;
  rtoLabel: string;
  decisionSummary: string;
  regionStates: Record<QuorumRegionId, QuorumNodeHealthState>;
  regions: QuorumRegionSnapshot[];
  edges: QuorumMeshEdge[];
  auditLog: QuorumAuditEvent[];
}

export const QUORUM_REGIONS: QuorumRegionDef[] = [
  {
    id: 'vn-hcm',
    displayName: 'VN-HCM Primary',
    shortCode: 'HCM',
    city: 'Ho Chi Minh City',
    priority: 1,
    baseWalLagMs: 0,
    x: 410,
    y: 162,
  },
  {
    id: 'sg-1',
    displayName: 'SG-1',
    shortCode: 'SIN',
    city: 'Singapore',
    priority: 2,
    baseWalLagMs: 4,
    x: 525,
    y: 268,
  },
  {
    id: 'jp-tokyo',
    displayName: 'JP-Tokyo',
    shortCode: 'NRT',
    city: 'Tokyo',
    priority: 3,
    baseWalLagMs: 12,
    x: 685,
    y: 112,
  },
  {
    id: 'us-east',
    displayName: 'US-East',
    shortCode: 'IAD',
    city: 'Virginia',
    priority: 4,
    baseWalLagMs: 28,
    x: 130,
    y: 230,
  },
  {
    id: 'eu-west',
    displayName: 'EU-West',
    shortCode: 'DUB',
    city: 'Dublin',
    priority: 5,
    baseWalLagMs: 24,
    x: 225,
    y: 78,
  },
];

const PAIRWISE_RTT_MS: Record<string, number> = {
  'vn-hcm|sg-1': 24,
  'vn-hcm|jp-tokyo': 68,
  'vn-hcm|us-east': 212,
  'vn-hcm|eu-west': 176,
  'sg-1|jp-tokyo': 64,
  'sg-1|us-east': 218,
  'sg-1|eu-west': 162,
  'jp-tokyo|us-east': 148,
  'jp-tokyo|eu-west': 215,
  'us-east|eu-west': 74,
};

export function getQuorumPairwiseRtt(a: QuorumRegionId, b: QuorumRegionId): number {
  if (a === b) return 0;
  const direct = PAIRWISE_RTT_MS[`${a}|${b}`];
  if (direct !== undefined) return direct;
  const rev = PAIRWISE_RTT_MS[`${b}|${a}`];
  return rev ?? 120;
}

export function getNextCycledHealthState(current: QuorumNodeHealthState): QuorumNodeHealthState {
  if (current === 'ONLINE') return 'PARTITIONED';
  if (current === 'PARTITIONED') return 'HARD_CRASH';
  return 'ONLINE';
}

let auditSeq = 1;
function makeAudit(
  term: number,
  severity: QuorumAuditEvent['severity'],
  code: string,
  message: string
): QuorumAuditEvent {
  return {
    id: `qevt-${auditSeq++}`,
    term,
    severity,
    code,
    message,
  };
}

export function evaluateQuorumSnapshot(
  regionStates: Record<QuorumRegionId, QuorumNodeHealthState>,
  currentTerm: number,
  previousLeaderId: QuorumRegionId | null,
  priorAuditLog: QuorumAuditEvent[] = [],
  triggerNote?: QuorumAuditEvent
): QuorumLabState {
  const totalNodes = QUORUM_REGIONS.length;
  const quorumRequired = Math.floor(totalNodes / 2) + 1; // 3 / 5

  const onlineDefs = QUORUM_REGIONS.filter((r) => regionStates[r.id] === 'ONLINE').sort(
    (a, b) => a.priority - b.priority
  );
  const onlineCount = onlineDefs.length;
  const partitionedCount = QUORUM_REGIONS.filter((r) => regionStates[r.id] === 'PARTITIONED').length;
  const crashedCount = QUORUM_REGIONS.filter((r) => regionStates[r.id] === 'HARD_CRASH').length;
  const hasQuorum = onlineCount >= quorumRequired;

  let raftTerm = Math.max(1, currentTerm);
  let electedLeaderId: QuorumRegionId | null = null;
  let electedLeaderName: string | null = null;
  let electionTriggered = false;
  let rtoMs: number | null = 0;
  let rtoLabel = '0 ms (Primary Stable)';
  let decisionSummary = '';

  const newAudits: QuorumAuditEvent[] = [];
  if (triggerNote) {
    newAudits.push(triggerNote);
  }

  if (!hasQuorum) {
    if (previousLeaderId !== null) {
      raftTerm += 1;
      electionTriggered = true;
    }
    electedLeaderId = null;
    electedLeaderName = null;
    rtoMs = null;
    rtoLabel = 'FENCED (Writes Halted)';
    decisionSummary = `Quorum lost (${onlineCount}/${totalNodes} online < ${quorumRequired} required). Automatic READ_ONLY_FENCE engaged — dual-writer voucher double-spending blocked.`;
    newAudits.unshift(
      makeAudit(
        raftTerm,
        'CRITICAL',
        'READ_ONLY_FENCE',
        `Quorum fell to ${onlineCount}/5. Term bumped to ${raftTerm}; all surviving nodes fenced to READ-ONLY to guarantee 0 double-spends.`
      )
    );
  } else {
    const prevLeaderOnline =
      previousLeaderId !== null && regionStates[previousLeaderId] === 'ONLINE';

    if (prevLeaderOnline && previousLeaderId !== null) {
      const def = QUORUM_REGIONS.find((r) => r.id === previousLeaderId)!;
      electedLeaderId = def.id;
      electedLeaderName = def.displayName;
      rtoMs = 0;
      rtoLabel = '0 ms (Primary Stable)';
      decisionSummary =
        onlineCount === totalNodes
          ? `Nominal 5/5 quorum led by ${def.displayName} (Term ${raftTerm}). Synchronous Raft majority commit healthy.`
          : `Quorum intact (${onlineCount}/5 online) under ${def.displayName} (Term ${raftTerm}). Degraded replicas fenced from write authority.`;
    } else {
      const nextLeader = onlineDefs[0];
      electedLeaderId = nextLeader.id;
      electedLeaderName = nextLeader.displayName;
      raftTerm += 1;
      electionTriggered = true;
      const electionRtt = previousLeaderId
        ? getQuorumPairwiseRtt(previousLeaderId, nextLeader.id)
        : 45;
      rtoMs = 165 + Math.round(electionRtt * 0.85);
      rtoLabel = `${rtoMs} ms (Auto Election)`;
      decisionSummary = `Leader failover complete: ${nextLeader.displayName} elected for Term ${raftTerm} in ${rtoMs} ms (${onlineCount}/5 votes, RPO = 0s).`;
      newAudits.unshift(
        makeAudit(
          raftTerm,
          'WARN',
          'LEADER_ELECTED',
          `Auto-elected ${nextLeader.displayName} as Raft Leader (Term ${raftTerm}) in ${rtoMs} ms with ${onlineCount}/5 votes and 0s RPO.`
        )
      );
    }
  }

  // Majority commit RTT = fastest (quorumRequired - 1) followers from leader
  const followerRtts =
    hasQuorum && electedLeaderId
      ? onlineDefs
          .filter((r) => r.id !== electedLeaderId)
          .map((r) => getQuorumPairwiseRtt(electedLeaderId!, r.id))
          .sort((a, b) => a - b)
      : [];
  const quorumCommitRttMs =
    hasQuorum && followerRtts.length >= quorumRequired - 1
      ? followerRtts[quorumRequired - 2]
      : 0;

  const regions: QuorumRegionSnapshot[] = QUORUM_REGIONS.map((def) => {
    const state = regionStates[def.id];
    if (state === 'PARTITIONED') {
      return {
        ...def,
        state,
        role: 'PARTITIONED',
        rttToLeaderMs: 9999,
        walLagMs: 9999,
        walLagKb: 1840,
        fencingToken: Math.max(0, raftTerm - 1),
        acceptsWrites: false,
      };
    }

    if (state === 'HARD_CRASH') {
      return {
        ...def,
        state,
        role: 'CRASHED',
        rttToLeaderMs: 0,
        walLagMs: 9999,
        walLagKb: 0,
        fencingToken: 0,
        acceptsWrites: false,
      };
    }

    if (!hasQuorum) {
      return {
        ...def,
        state,
        role: 'FENCED',
        rttToLeaderMs: 0,
        walLagMs: 0,
        walLagKb: 0,
        fencingToken: raftTerm,
        acceptsWrites: false,
      };
    }

    const isLeader = def.id === electedLeaderId;
    const rttToLeaderMs = isLeader ? 0 : getQuorumPairwiseRtt(electedLeaderId!, def.id);
    const walLagMs = isLeader
      ? 0
      : Number((rttToLeaderMs * 0.16 + def.baseWalLagMs + partitionedCount * 3.5).toFixed(1));
    const walLagKb = isLeader ? 0 : Math.round(walLagMs * 4.2);

    return {
      ...def,
      state,
      role: isLeader ? 'LEADER' : 'FOLLOWER',
      rttToLeaderMs,
      walLagMs,
      walLagKb,
      fencingToken: raftTerm,
      acceptsWrites: isLeader,
    };
  });

  const edges: QuorumMeshEdge[] = [];
  for (let i = 0; i < QUORUM_REGIONS.length; i++) {
    for (let j = i + 1; j < QUORUM_REGIONS.length; j++) {
      const from = QUORUM_REGIONS[i].id;
      const to = QUORUM_REGIONS[j].id;
      const rttMs = getQuorumPairwiseRtt(from, to);
      const severed = regionStates[from] !== 'ONLINE' || regionStates[to] !== 'ONLINE';
      const isLeaderLink =
        !severed && hasQuorum && (from === electedLeaderId || to === electedLeaderId);

      edges.push({
        id: `${from}__${to}`,
        from,
        to,
        rttMs: severed ? 0 : rttMs,
        status: severed ? 'SEVERED' : isLeaderLink ? 'ACTIVE_HEARTBEAT' : 'STANDBY_MESH',
        isLeaderLink,
      });
    }
  }

  const healthyEdges = edges.filter((e) => e.status !== 'SEVERED');
  const avgHealthyRttMs =
    healthyEdges.length > 0
      ? Math.round(healthyEdges.reduce((sum, e) => sum + e.rttMs, 0) / healthyEdges.length)
      : 0;

  const activeFollowers = regions.filter((r) => r.role === 'FOLLOWER');
  const maxWalLagMs =
    activeFollowers.length > 0 ? Math.max(...activeFollowers.map((r) => r.walLagMs)) : 0;

  const auditLog = [...newAudits, ...priorAuditLog].slice(0, 18);

  return {
    totalNodes,
    quorumRequired,
    onlineCount,
    partitionedCount,
    crashedCount,
    hasQuorum,
    clusterWriteMode: hasQuorum ? 'READ_WRITE' : 'READ_ONLY_FENCE',
    splitBrainFenceActive: !hasQuorum,
    doubleSpendPrevented: true,
    electedLeaderId,
    electedLeaderName,
    raftTerm,
    electionTriggered,
    quorumCommitRttMs,
    avgHealthyRttMs,
    maxWalLagMs: Number(maxWalLagMs.toFixed(1)),
    rpoSeconds: 0,
    rtoMs,
    rtoLabel,
    decisionSummary,
    regionStates: { ...regionStates },
    regions,
    edges,
    auditLog,
  };
}

export function createInitialQuorumLabState(): QuorumLabState {
  const initialStates: Record<QuorumRegionId, QuorumNodeHealthState> = {
    'vn-hcm': 'ONLINE',
    'sg-1': 'ONLINE',
    'jp-tokyo': 'ONLINE',
    'us-east': 'ONLINE',
    'eu-west': 'ONLINE',
  };

  return evaluateQuorumSnapshot(
    initialStates,
    42,
    'vn-hcm',
    [],
    makeAudit(
      42,
      'INFO',
      'QUORUM_NOMINAL',
      '5-Region Con Cung Raft mesh online (Term 42). Leader: VN-HCM Primary · Quorum 5/5 · Split-brain fence armed.'
    )
  );
}

export function setRegionHealthState(
  prev: QuorumLabState,
  regionId: QuorumRegionId,
  nextState: QuorumNodeHealthState
): QuorumLabState {
  if (prev.regionStates[regionId] === nextState) return prev;
  const def = QUORUM_REGIONS.find((r) => r.id === regionId)!;
  const updatedStates: Record<QuorumRegionId, QuorumNodeHealthState> = {
    ...prev.regionStates,
    [regionId]: nextState,
  };

  const severity: QuorumAuditEvent['severity'] =
    nextState === 'ONLINE' ? 'RECOVERY' : nextState === 'PARTITIONED' ? 'WARN' : 'CRITICAL';
  const code =
    nextState === 'ONLINE'
      ? 'NODE_RECOVERED'
      : nextState === 'PARTITIONED'
        ? 'NODE_PARTITIONED'
        : 'NODE_HARD_CRASH';

  return evaluateQuorumSnapshot(
    updatedStates,
    prev.raftTerm,
    prev.electedLeaderId,
    prev.auditLog,
    makeAudit(
      prev.raftTerm,
      severity,
      code,
      `${def.displayName} transitioned ${prev.regionStates[regionId]} -> ${nextState}.`
    )
  );
}

export function cycleRegionHealthState(
  prev: QuorumLabState,
  regionId: QuorumRegionId
): QuorumLabState {
  const nextState = getNextCycledHealthState(prev.regionStates[regionId]);
  return setRegionHealthState(prev, regionId, nextState);
}

export function applyQuorumScenario(
  prev: QuorumLabState,
  scenario: QuorumScenarioId
): QuorumLabState {
  const mapByScenario: Record<QuorumScenarioId, Record<QuorumRegionId, QuorumNodeHealthState>> = {
    nominal: {
      'vn-hcm': 'ONLINE',
      'sg-1': 'ONLINE',
      'jp-tokyo': 'ONLINE',
      'us-east': 'ONLINE',
      'eu-west': 'ONLINE',
    },
    'primary-crash': {
      'vn-hcm': 'HARD_CRASH',
      'sg-1': 'ONLINE',
      'jp-tokyo': 'ONLINE',
      'us-east': 'ONLINE',
      'eu-west': 'ONLINE',
    },
    'apac-dual-outage': {
      'vn-hcm': 'HARD_CRASH',
      'sg-1': 'PARTITIONED',
      'jp-tokyo': 'ONLINE',
      'us-east': 'ONLINE',
      'eu-west': 'ONLINE',
    },
    'split-brain-fence': {
      'vn-hcm': 'HARD_CRASH',
      'sg-1': 'PARTITIONED',
      'jp-tokyo': 'HARD_CRASH',
      'us-east': 'ONLINE',
      'eu-west': 'ONLINE',
    },
  };

  const labels: Record<QuorumScenarioId, string> = {
    nominal: 'Restored all 5 regions to ONLINE (5/5 Quorum).',
    'primary-crash': 'Injected VN-HCM Primary HARD CRASH -> automated Raft failover to SG-1.',
    'apac-dual-outage': 'Injected VN-HCM crash + SG-1 partition -> minimal 3/5 quorum led by JP-Tokyo.',
    'split-brain-fence': 'Killed 3/5 regions (VN-HCM, SG-1, JP-Tokyo) -> READ_ONLY_FENCE triggered.',
  };

  const severity: QuorumAuditEvent['severity'] =
    scenario === 'nominal' ? 'RECOVERY' : scenario === 'split-brain-fence' ? 'CRITICAL' : 'WARN';

  return evaluateQuorumSnapshot(
    mapByScenario[scenario],
    prev.raftTerm,
    scenario === 'nominal' ? prev.electedLeaderId ?? 'vn-hcm' : prev.electedLeaderId,
    prev.auditLog,
    makeAudit(prev.raftTerm, severity, `SCENARIO_${scenario.toUpperCase().replace(/-/g, '_')}`, labels[scenario])
  );
}

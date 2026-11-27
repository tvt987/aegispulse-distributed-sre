export type RegionId =
  | 'ap-southeast-1'
  | 'ap-northeast-1'
  | 'us-east-1'
  | 'eu-central-1'
  | 'ap-south-1';

export type RaftRole = 'LEADER' | 'FOLLOWER' | 'PARTITIONED' | 'FENCED';
export type RegionHealthStatus = 'HEALTHY' | 'DEGRADED' | 'ISOLATED' | 'CRITICAL';
export type QuorumStatus = 'HEALTHY' | 'DEGRADED' | 'MINIMAL_QUORUM' | 'QUORUM_LOST';
export type ClusterCircuitState = 'CLOSED' | 'HALF_OPEN' | 'OPEN';
export type EdgeLinkStatus = 'HEALTHY' | 'DEGRADED' | 'SEVERED';

export interface RegionDefinition {
  id: RegionId;
  shortCode: string;
  label: string;
  city: string;
  zone: string;
  priority: number;
  x: number;
  y: number;
  capacityRps: number;
}

export interface RegionNodeState extends RegionDefinition {
  role: RaftRole;
  status: RegionHealthStatus;
  reachable: boolean;
  rttToLeaderMs: number;
  replicationLagMs: number;
  fencingToken: number;
  dbPoolPct: number;
  errorRatePct: number;
}

export interface TopologyEdgeState {
  id: string;
  from: RegionId;
  to: RegionId;
  baseRttMs: number;
  currentRttMs: number;
  packetLossPct: number;
  status: EdgeLinkStatus;
  isLeaderReplicationEdge: boolean;
}

export interface ActiveChaosFaults {
  fiberCutRegions: RegionId[];
  tailLatency180Ms: boolean;
  redisCacheStampede: boolean;
  dbConnectionExhaustion: boolean;
}

export interface ChaosEventLog {
  id: string;
  timestampUtc: string;
  severity: 'INFO' | 'WARN' | 'CRITICAL' | 'RECOVERY';
  code: string;
  message: string;
}

export interface ClusterTopologyState {
  raftTerm: number;
  commitIndex: number;
  leaderRegionId: RegionId | null;
  quorumSize: number;
  totalNodes: number;
  reachableCount: number;
  hasQuorum: boolean;
  quorumStatus: QuorumStatus;
  splitBrainProtected: boolean;
  fencedWriteGuardActive: boolean;
  lastFailoverLatencyMs: number;
  maxReplicationLagMs: number;
  avgCrossRegionRttMs: number;
  errorBudgetBurnRate: number;
  circuitBreakerState: ClusterCircuitState;
  cacheHitRatioPct: number;
  dbPoolUtilizationPct: number;
  faults: ActiveChaosFaults;
  regions: RegionNodeState[];
  edges: TopologyEdgeState[];
  events: ChaosEventLog[];
}

export interface ChaosLoadMultipliers {
  latencyAdderMs: number;
  latencyMultiplier: number;
  gcPressureMultiplier: number;
  errorRateAdderPct: number;
  capacityFactor: number;
}

export const GLOBAL_REGIONS: RegionDefinition[] = [
  {
    id: 'ap-southeast-1',
    shortCode: 'SG',
    label: 'ap-southeast-1 SG',
    city: 'Singapore',
    zone: 'APAC-South',
    priority: 1,
    x: 576,
    y: 220,
    capacityRps: 65000,
  },
  {
    id: 'ap-northeast-1',
    shortCode: 'TYO',
    label: 'ap-northeast-1 Tokyo',
    city: 'Tokyo',
    zone: 'APAC-East',
    priority: 2,
    x: 708,
    y: 96,
    capacityRps: 60000,
  },
  {
    id: 'us-east-1',
    shortCode: 'IAD',
    label: 'us-east-1 Virginia',
    city: 'Virginia',
    zone: 'US-East',
    priority: 3,
    x: 122,
    y: 122,
    capacityRps: 75000,
  },
  {
    id: 'eu-central-1',
    shortCode: 'FRA',
    label: 'eu-central-1 Frankfurt',
    city: 'Frankfurt',
    zone: 'EU-Central',
    priority: 4,
    x: 342,
    y: 74,
    capacityRps: 65000,
  },
  {
    id: 'ap-south-1',
    shortCode: 'BOM',
    label: 'ap-south-1 Mumbai',
    city: 'Mumbai',
    zone: 'APAC-West',
    priority: 5,
    x: 382,
    y: 222,
    capacityRps: 55000,
  },
];

const PAIRWISE_BASE_RTT: Record<string, number> = {
  'ap-southeast-1|ap-northeast-1': 68,
  'ap-southeast-1|us-east-1': 214,
  'ap-southeast-1|eu-central-1': 158,
  'ap-southeast-1|ap-south-1': 54,
  'ap-northeast-1|us-east-1': 152,
  'ap-northeast-1|eu-central-1': 224,
  'ap-northeast-1|ap-south-1': 118,
  'us-east-1|eu-central-1': 88,
  'us-east-1|ap-south-1': 196,
  'eu-central-1|ap-south-1': 116,
};

export function getPairwiseBaseRtt(a: RegionId, b: RegionId): number {
  if (a === b) return 0;
  const direct = PAIRWISE_BASE_RTT[`${a}|${b}`];
  if (direct !== undefined) return direct;
  const reverse = PAIRWISE_BASE_RTT[`${b}|${a}`];
  return reverse ?? 120;
}

export function calculateQuorumSize(totalNodes: number): number {
  return Math.floor(totalNodes / 2) + 1;
}

let eventCounter = 1;
function makeEvent(
  severity: ChaosEventLog['severity'],
  code: string,
  message: string
): ChaosEventLog {
  const id = `evt-${eventCounter++}`;
  return {
    id,
    timestampUtc: new Date().toISOString().slice(11, 23) + 'Z',
    severity,
    code,
    message,
  };
}

function deriveTopology(
  prev: {
    raftTerm: number;
    commitIndex: number;
    leaderRegionId: RegionId | null;
    lastFailoverLatencyMs: number;
    events: ChaosEventLog[];
  },
  faults: ActiveChaosFaults,
  newEvents: ChaosEventLog[],
  preferredLeader?: RegionId
): ClusterTopologyState {
  const totalNodes = GLOBAL_REGIONS.length;
  const quorumSize = calculateQuorumSize(totalNodes);
  const cutSet = new Set<RegionId>(faults.fiberCutRegions);
  const healthyRegions = GLOBAL_REGIONS.filter((r) => !cutSet.has(r.id)).sort(
    (a, b) => a.priority - b.priority
  );
  const reachableCount = healthyRegions.length;
  const hasQuorum = reachableCount >= quorumSize;

  let raftTerm = prev.raftTerm;
  let commitIndex = prev.commitIndex;
  let leaderRegionId: RegionId | null = prev.leaderRegionId;
  let lastFailoverLatencyMs = prev.lastFailoverLatencyMs;
  const appendedEvents = [...newEvents];

  if (!hasQuorum) {
    if (leaderRegionId !== null) {
      raftTerm += 1;
      leaderRegionId = null;
      lastFailoverLatencyMs = 0;
      appendedEvents.unshift(
        makeEvent(
          'CRITICAL',
          'RAFT_QUORUM_LOST',
          `Split-brain guard activated: only ${reachableCount}/${totalNodes} regions reachable (< ${quorumSize} quorum). Cluster fenced to READ-ONLY.`
        )
      );
    }
  } else {
    const canKeepPreferred =
      preferredLeader && !cutSet.has(preferredLeader) && preferredLeader !== leaderRegionId;
    const currentLeaderDead = !leaderRegionId || cutSet.has(leaderRegionId);

    if (canKeepPreferred) {
      const nextLeader = preferredLeader;
      const baseTransferRtt = leaderRegionId
        ? getPairwiseBaseRtt(leaderRegionId, nextLeader)
        : 95;
      raftTerm += 1;
      lastFailoverLatencyMs = Math.round(
        110 + baseTransferRtt * 0.65 + (faults.tailLatency180Ms ? 180 : 0)
      );
      leaderRegionId = nextLeader;
      commitIndex += 14;
      appendedEvents.unshift(
        makeEvent(
          'INFO',
          'RAFT_LEADER_TRANSFER',
          `Leadership transferred to ${nextLeader} (Term ${raftTerm}) in ${lastFailoverLatencyMs}ms with 0 uncommitted log loss.`
        )
      );
    } else if (currentLeaderDead) {
      const elected = healthyRegions[0];
      const electionRtt = prev.leaderRegionId
        ? getPairwiseBaseRtt(prev.leaderRegionId, elected.id)
        : 105;
      raftTerm += 1;
      lastFailoverLatencyMs = Math.round(
        145 + electionRtt * 0.72 + (faults.tailLatency180Ms ? 180 : 0)
      );
      leaderRegionId = elected.id;
      commitIndex += 28;
      appendedEvents.unshift(
        makeEvent(
          'WARN',
          'RAFT_LEADER_ELECTED',
          `Auto-failover elected ${elected.label} as Raft Leader (Term ${raftTerm}) in ${lastFailoverLatencyMs}ms (${reachableCount}/${totalNodes} votes).`
        )
      );
    } else {
      commitIndex += 12;
    }
  }

  let quorumStatus: QuorumStatus = 'HEALTHY';
  if (!hasQuorum) {
    quorumStatus = 'QUORUM_LOST';
  } else if (reachableCount === quorumSize) {
    quorumStatus = 'MINIMAL_QUORUM';
  } else if (
    reachableCount < totalNodes ||
    faults.tailLatency180Ms ||
    faults.redisCacheStampede ||
    faults.dbConnectionExhaustion
  ) {
    quorumStatus = 'DEGRADED';
  }

  // Circuit breaker derivation
  let circuitBreakerState: ClusterCircuitState = 'CLOSED';
  if (!hasQuorum || faults.dbConnectionExhaustion) {
    circuitBreakerState = 'OPEN';
  } else if (
    faults.redisCacheStampede ||
    (faults.tailLatency180Ms && reachableCount <= 4) ||
    reachableCount === quorumSize
  ) {
    circuitBreakerState = 'HALF_OPEN';
  }

  // Error budget burn rate (multi-window SLO 99.99% => 1.0x nominal)
  let burnRate = 1.0;
  if (!hasQuorum) burnRate += 18.5;
  else burnRate += faults.fiberCutRegions.length * 2.4;
  if (faults.tailLatency180Ms) burnRate += 4.6;
  if (faults.redisCacheStampede) burnRate += 5.2;
  if (faults.dbConnectionExhaustion) burnRate += 9.8;
  burnRate = Number(Math.min(28.0, burnRate).toFixed(1));

  // Cache hit ratio & DB connection pool
  let cacheHitRatioPct = 99.4;
  if (faults.redisCacheStampede) cacheHitRatioPct -= 64.8;
  if (faults.tailLatency180Ms) cacheHitRatioPct -= 2.6;
  if (!hasQuorum) cacheHitRatioPct -= 12.0;
  cacheHitRatioPct = Number(Math.max(12.0, cacheHitRatioPct).toFixed(1));

  let dbPoolUtilizationPct = 28.5;
  if (faults.dbConnectionExhaustion) dbPoolUtilizationPct = 99.2;
  else {
    if (faults.redisCacheStampede) dbPoolUtilizationPct += 44.0;
    if (faults.tailLatency180Ms) dbPoolUtilizationPct += 14.5;
    dbPoolUtilizationPct += faults.fiberCutRegions.length * 7.5;
    dbPoolUtilizationPct = Number(Math.min(96.0, dbPoolUtilizationPct).toFixed(1));
  }

  const tailSpike = faults.tailLatency180Ms ? 180 : 0;

  const regions: RegionNodeState[] = GLOBAL_REGIONS.map((def) => {
    const isCut = cutSet.has(def.id);
    if (isCut) {
      return {
        ...def,
        role: 'PARTITIONED',
        status: 'ISOLATED',
        reachable: false,
        rttToLeaderMs: 9999,
        replicationLagMs: 9999,
        fencingToken: raftTerm - 1,
        dbPoolPct: 0,
        errorRatePct: 100,
      };
    }

    if (!hasQuorum) {
      return {
        ...def,
        role: 'FENCED',
        status: 'CRITICAL',
        reachable: true,
        rttToLeaderMs: 0,
        replicationLagMs: 4200,
        fencingToken: raftTerm,
        dbPoolPct: dbPoolUtilizationPct,
        errorRatePct: 48.5,
      };
    }

    const isLeader = def.id === leaderRegionId;
    const baseRtt = leaderRegionId ? getPairwiseBaseRtt(def.id, leaderRegionId) : 0;
    const rttToLeaderMs = isLeader ? 0 : baseRtt + tailSpike;
    const replicationLagMs = isLeader
      ? 0
      : Number(
          (
            baseRtt * 0.14 +
            (faults.tailLatency180Ms ? 92 : 0) +
            (faults.dbConnectionExhaustion ? 145 : 0) +
            (faults.redisCacheStampede ? 28 : 0)
          ).toFixed(1)
        );

    let status: RegionHealthStatus = 'HEALTHY';
    if (faults.dbConnectionExhaustion) status = 'CRITICAL';
    else if (faults.tailLatency180Ms || faults.redisCacheStampede) status = 'DEGRADED';

    let errorRatePct = 0.01;
    if (faults.dbConnectionExhaustion) errorRatePct += 11.4;
    if (faults.redisCacheStampede) errorRatePct += 2.8;
    if (faults.tailLatency180Ms) errorRatePct += 1.25;

    return {
      ...def,
      role: isLeader ? 'LEADER' : 'FOLLOWER',
      status,
      reachable: true,
      rttToLeaderMs,
      replicationLagMs,
      fencingToken: raftTerm,
      dbPoolPct: Math.min(100, Number((dbPoolUtilizationPct + (isLeader ? 6 : 0)).toFixed(1))),
      errorRatePct: Number(errorRatePct.toFixed(2)),
    };
  });

  // Build all 10 unique mesh edges
  const edges: TopologyEdgeState[] = [];
  for (let i = 0; i < GLOBAL_REGIONS.length; i++) {
    for (let j = i + 1; j < GLOBAL_REGIONS.length; j++) {
      const a = GLOBAL_REGIONS[i].id;
      const b = GLOBAL_REGIONS[j].id;
      const baseRttMs = getPairwiseBaseRtt(a, b);
      const severed = cutSet.has(a) || cutSet.has(b);
      const isLeaderReplicationEdge =
        !severed && hasQuorum && (a === leaderRegionId || b === leaderRegionId);

      let status: EdgeLinkStatus = 'HEALTHY';
      if (severed) status = 'SEVERED';
      else if (faults.tailLatency180Ms || faults.dbConnectionExhaustion) status = 'DEGRADED';

      const currentRttMs = severed
        ? 0
        : baseRttMs + tailSpike + (faults.dbConnectionExhaustion ? 35 : 0);
      const packetLossPct = severed
        ? 100
        : faults.tailLatency180Ms
          ? 2.4
          : faults.redisCacheStampede
            ? 0.6
            : 0;

      edges.push({
        id: `${a}__${b}`,
        from: a,
        to: b,
        baseRttMs,
        currentRttMs,
        packetLossPct,
        status,
        isLeaderReplicationEdge,
      });
    }
  }

  const healthyFollowers = regions.filter((r) => r.role === 'FOLLOWER');
  const maxReplicationLagMs =
    !hasQuorum
      ? 4200
      : healthyFollowers.length === 0
        ? 0
        : Math.max(...healthyFollowers.map((r) => r.replicationLagMs));

  const healthyEdges = edges.filter((e) => e.status !== 'SEVERED');
  const avgCrossRegionRttMs =
    healthyEdges.length === 0
      ? 0
      : Math.round(
          healthyEdges.reduce((sum, e) => sum + e.currentRttMs, 0) / healthyEdges.length
        );

  const combinedEvents = [...appendedEvents, ...prev.events].slice(0, 24);

  return {
    raftTerm,
    commitIndex,
    leaderRegionId,
    quorumSize,
    totalNodes,
    reachableCount,
    hasQuorum,
    quorumStatus,
    splitBrainProtected: true,
    fencedWriteGuardActive: !hasQuorum,
    lastFailoverLatencyMs,
    maxReplicationLagMs: Number(maxReplicationLagMs.toFixed(1)),
    avgCrossRegionRttMs,
    errorBudgetBurnRate: burnRate,
    circuitBreakerState,
    cacheHitRatioPct,
    dbPoolUtilizationPct,
    faults,
    regions,
    edges,
    events: combinedEvents,
  };
}

export function createInitialClusterState(): ClusterTopologyState {
  const initialFaults: ActiveChaosFaults = {
    fiberCutRegions: [],
    tailLatency180Ms: false,
    redisCacheStampede: false,
    dbConnectionExhaustion: false,
  };
  return deriveTopology(
    {
      raftTerm: 42,
      commitIndex: 1842910,
      leaderRegionId: 'ap-southeast-1',
      lastFailoverLatencyMs: 0,
      events: [],
    },
    initialFaults,
    [
      makeEvent(
        'INFO',
        'CLUSTER_NOMINAL',
        '5-Region Raft cluster online (Term 42). Leader: ap-southeast-1 SG · Quorum 5/5 · Split-brain fencing armed.'
      ),
    ]
  );
}

export function cutRegionFiber(
  state: ClusterTopologyState,
  regionId: RegionId
): ClusterTopologyState {
  if (state.faults.fiberCutRegions.includes(regionId)) {
    // Reconnect this specific region fiber if already cut
    const nextCuts = state.faults.fiberCutRegions.filter((id) => id !== regionId);
    const regionLabel = GLOBAL_REGIONS.find((r) => r.id === regionId)?.label ?? regionId;
    return deriveTopology(
      state,
      { ...state.faults, fiberCutRegions: nextCuts },
      [
        makeEvent(
          'RECOVERY',
          'FIBER_RESTORED',
          `Subsea fiber restored for ${regionLabel}. Catch-up AppendEntries snapshot streaming.`
        ),
      ]
    );
  }

  const nextCuts = [...state.faults.fiberCutRegions, regionId];
  const regionLabel = GLOBAL_REGIONS.find((r) => r.id === regionId)?.label ?? regionId;
  return deriveTopology(
    state,
    { ...state.faults, fiberCutRegions: nextCuts },
    [
      makeEvent(
        'CRITICAL',
        'FIBER_SEVERED',
        `Network partition injected: subsea fiber cut to ${regionLabel}. BGP route withdrawn.`
      ),
    ]
  );
}

export function toggleTailLatency180Ms(state: ClusterTopologyState): ClusterTopologyState {
  const nextVal = !state.faults.tailLatency180Ms;
  return deriveTopology(
    state,
    { ...state.faults, tailLatency180Ms: nextVal },
    [
      makeEvent(
        nextVal ? 'WARN' : 'RECOVERY',
        nextVal ? 'TAIL_LATENCY_180MS' : 'TAIL_LATENCY_CLEARED',
        nextVal
          ? 'Injected +180ms p99 cross-region tail latency jitter across global Envoy mesh.'
          : 'Cleared +180ms tail latency fault. Cross-region RTT returned to baseline.'
      ),
    ]
  );
}

export function toggleRedisCacheStampede(state: ClusterTopologyState): ClusterTopologyState {
  const nextVal = !state.faults.redisCacheStampede;
  return deriveTopology(
    state,
    { ...state.faults, redisCacheStampede: nextVal },
    [
      makeEvent(
        nextVal ? 'WARN' : 'RECOVERY',
        nextVal ? 'REDIS_STAMPEDE' : 'REDIS_STAMPEDE_CLEARED',
        nextVal
          ? 'Hot-SKU Redis cache stampede triggered: L2 hit ratio plunged to 34.6%, singleflight coalescing stressed.'
          : 'Redis cluster warmed with probabilistic early expiration (XFetch); hit ratio restored.'
      ),
    ]
  );
}

export function toggleDbConnectionExhaustion(state: ClusterTopologyState): ClusterTopologyState {
  const nextVal = !state.faults.dbConnectionExhaustion;
  return deriveTopology(
    state,
    { ...state.faults, dbConnectionExhaustion: nextVal },
    [
      makeEvent(
        nextVal ? 'CRITICAL' : 'RECOVERY',
        nextVal ? 'DB_POOL_EXHAUSTED' : 'DB_POOL_RECOVERED',
        nextVal
          ? 'PgBouncer/SQL pool reached 99.2% saturation (496/500). Adaptive circuit breaker tripped OPEN (503 fast-fail).'
          : 'Database connection pool drained & reset. Circuit breaker returning to CLOSED.'
      ),
    ]
  );
}

export function transferLeaderManually(
  state: ClusterTopologyState,
  targetRegionId: RegionId
): ClusterTopologyState {
  if (!state.hasQuorum || state.faults.fiberCutRegions.includes(targetRegionId)) {
    return state;
  }
  if (state.leaderRegionId === targetRegionId) {
    return state;
  }
  return deriveTopology(state, state.faults, [], targetRegionId);
}

export function restoreAllRegions(state: ClusterTopologyState): ClusterTopologyState {
  const cleanFaults: ActiveChaosFaults = {
    fiberCutRegions: [],
    tailLatency180Ms: false,
    redisCacheStampede: false,
    dbConnectionExhaustion: false,
  };
  return deriveTopology(
    {
      ...state,
      lastFailoverLatencyMs: 0,
    },
    cleanFaults,
    [
      makeEvent(
        'RECOVERY',
        'CLUSTER_RESTORED',
        'All 5 global regions restored to 5/5 Raft quorum. Circuit breaker CLOSED · Burn rate normalized to 1.0x.'
      ),
    ],
    state.leaderRegionId ?? 'ap-southeast-1'
  );
}

export function computeChaosLoadMultipliers(
  state: ClusterTopologyState
): ChaosLoadMultipliers {
  const cutCount = state.faults.fiberCutRegions.length;
  const capacityFactor = Math.max(0.25, (state.totalNodes - cutCount) / state.totalNodes);
  const latencyAdderMs =
    (state.faults.tailLatency180Ms ? 180 : 0) +
    (state.faults.dbConnectionExhaustion ? 95 : 0) +
    (state.faults.redisCacheStampede ? 38 : 0) +
    (!state.hasQuorum ? 260 : cutCount * 14);

  const latencyMultiplier =
    1 +
    (state.faults.redisCacheStampede ? 0.55 : 0) +
    (state.faults.dbConnectionExhaustion ? 1.15 : 0) +
    (!state.hasQuorum ? 1.4 : cutCount * 0.18);

  const gcPressureMultiplier =
    1 +
    (state.faults.redisCacheStampede ? 0.45 : 0) +
    (state.faults.dbConnectionExhaustion ? 0.65 : 0) +
    (state.faults.tailLatency180Ms ? 0.25 : 0);

  const errorRateAdderPct =
    (!state.hasQuorum ? 42.0 : 0) +
    (state.faults.dbConnectionExhaustion ? 11.4 : 0) +
    (state.faults.redisCacheStampede ? 2.8 : 0) +
    (state.faults.tailLatency180Ms ? 1.2 : 0);

  return {
    latencyAdderMs,
    latencyMultiplier: Number(latencyMultiplier.toFixed(2)),
    gcPressureMultiplier: Number(gcPressureMultiplier.toFixed(2)),
    errorRateAdderPct: Number(errorRateAdderPct.toFixed(2)),
    capacityFactor: Number(capacityFactor.toFixed(2)),
  };
}

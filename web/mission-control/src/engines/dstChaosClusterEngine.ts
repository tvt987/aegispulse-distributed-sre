// Pure Deterministic Simulation Testing (DST) & Raft + Voucher Chaos Engine
// Inspired by TigerBeetle / FoundationDB DST, Jepsen Linearizability Verification, and Raft Consensus.
// 100% deterministic seeded PRNG (Mulberry32) — zero Math.random(), zero DOM dependencies.

export type DstRegionId = 'SG-PRIMARY' | 'US-EAST' | 'EU-WEST' | 'JP-EAST' | 'AU-SYD';

export type DstEngineMode = 'AEGIS_LUA_WAL' | 'ROWVERSION_CAS' | 'NAIVE_RMW';

export type DstLinkStatus = 'HEALTHY' | 'DEGRADED' | 'SEVERED';

export type DstNodeStatus = 'HEALTHY' | 'PARTITIONED_MINORITY' | 'CRASHED';

export type DstRaftRole =
  | 'LEADER'
  | 'FOLLOWER'
  | 'CANDIDATE'
  | 'STALE_LEADER_FENCED'
  | 'OFFLINE';

export type DstPacketKind =
  | 'HEARTBEAT'
  | 'REQUEST_VOTE'
  | 'VOTE_GRANTED'
  | 'VOUCHER_COMMITTED_200'
  | 'VOUCHER_FENCED_409'
  | 'DOUBLE_SPEND_LEAK'
  | 'LOG_CATCHUP';

export type DstHistoryKind =
  | 'COMMITTED_200'
  | 'FENCED_409'
  | 'DOUBLE_SPEND_LEAK'
  | 'LEADER_ELECTED'
  | 'LINK_CUT'
  | 'LINK_HEALED'
  | 'LINK_DEGRADED'
  | 'NODE_CRASH'
  | 'NODE_REVIVE'
  | 'PARTITION_WALL';

export interface DstPoint {
  x: number;
  y: number;
}

export interface DstRegionNode {
  id: DstRegionId;
  shortCode: string;
  city: string;
  x: number;
  y: number;
  status: DstNodeStatus;
  role: DstRaftRole;
  term: number;
  commitIndex: number;
  votedFor: DstRegionId | null;
  votesReceived: DstRegionId[];
  electionTimeoutMs: number;
  electionElapsedMs: number;
  heartbeatElapsedMs: number;
  partitionGroup: 'MAJORITY' | 'MINORITY' | 'OFFLINE';
  committedCount: number;
  fencedCount: number;
  leakCount: number;
  lastPulseMs: number;
}

export interface DstMeshLink {
  id: string;
  from: DstRegionId;
  to: DstRegionId;
  baseLatencyMs: number;
  effectiveLatencyMs: number;
  status: DstLinkStatus;
  controlX: number;
  controlY: number;
  isCrossSplitBrain: boolean;
  lastCutTickMs: number | null;
}

export interface DstRpcPacket {
  id: number;
  kind: DstPacketKind;
  from: DstRegionId | 'REDIS_FENCE' | 'SQL_ROWVERSION';
  to: DstRegionId | 'REDIS_FENCE' | 'SQL_ROWVERSION';
  linkId: string | null;
  term: number;
  progress: number; // 0..1
  speedPerSec: number;
  startX: number;
  startY: number;
  ctrlX: number;
  ctrlY: number;
  endX: number;
  endY: number;
  jitterOffset: number;
  payloadLabel: string;
  deflectAtMidpoint: boolean;
  resolved: boolean;
}

export interface DstShockwave {
  id: number;
  x: number;
  y: number;
  kind: 'COMMIT' | 'FENCE' | 'LEAK' | 'CUT' | 'ELECTION' | 'CRASH' | 'HEAL';
  progress: number; // 0..1
  maxRadius: number;
}

export interface DstHistoryEvent {
  id: number;
  tickMs: number;
  region: DstRegionId;
  engine: DstEngineMode;
  kind: DstHistoryKind;
  term: number;
  latencyMs: number;
  detail: string;
  waveId: number | null;
}

export interface DstLinearizabilityReport {
  verdict: 'LINEARIZABLE' | 'VIOLATION';
  label: string;
  violationCount: number;
  singleSpendIntact: boolean;
  electionSafetyIntact: boolean;
  summary: string;
}

export interface DstClusterMetrics {
  totalVoucherRequests: number;
  committed200: number;
  fenced409: number;
  doubleSpendLeaks: number;
  staleLeaderFenced: number;
  electionsCompleted: number;
  packetsDispatched: number;
  packetsDropped: number;
  stormWavesFired: number;
  lastStormLatencyP99Ms: number;
}

export type DstRecordedCommand =
  | { tickMs: number; type: 'TOGGLE_LINK'; linkId: string }
  | { tickMs: number; type: 'SET_LINK_STATUS'; linkId: string; status: DstLinkStatus }
  | { tickMs: number; type: 'TOGGLE_NODE_CRASH'; regionId: DstRegionId }
  | { tickMs: number; type: 'SPLIT_BRAIN_PRESET' }
  | { tickMs: number; type: 'HEAL_ALL' }
  | { tickMs: number; type: 'SET_ENGINE'; engine: DstEngineMode }
  | { tickMs: number; type: 'BLAST_VOUCHER_STORM'; requestCount: number };

export interface DstClusterSnapshot {
  tickMs: number;
  term: number;
  fencingEpoch: number;
  rowVersionSeq: number;
  leaderId: DstRegionId | null;
  staleLeaderId: DstRegionId | null;
  hasQuorum: boolean;
  partitionWallActive: boolean;
  engine: DstEngineMode;
  nodes: Array<{
    id: DstRegionId;
    status: DstNodeStatus;
    role: DstRaftRole;
    term: number;
    commitIndex: number;
    partitionGroup: 'MAJORITY' | 'MINORITY' | 'OFFLINE';
    committedCount: number;
    fencedCount: number;
    leakCount: number;
  }>;
  links: Array<{
    id: string;
    status: DstLinkStatus;
    effectiveLatencyMs: number;
  }>;
  metrics: DstClusterMetrics;
  linearizability: DstLinearizabilityReport;
  historyCount: number;
}

export interface DstClusterState {
  seed: number;
  rngState: number;
  tickMs: number;
  engine: DstEngineMode;
  clusterTerm: number;
  fencingEpoch: number;
  rowVersionSeq: number;
  leaderId: DstRegionId | null;
  staleLeaderId: DstRegionId | null;
  hasQuorum: boolean;
  majoritySize: number;
  partitionWallActive: boolean;
  nodes: DstRegionNode[];
  links: DstMeshLink[];
  packets: DstRpcPacket[];
  shockwaves: DstShockwave[];
  history: DstHistoryEvent[];
  snapshots: DstClusterSnapshot[];
  recordedCommands: DstRecordedCommand[];
  metrics: DstClusterMetrics;
  linearizability: DstLinearizabilityReport;
  nextPacketId: number;
  nextEventId: number;
  nextShockwaveId: number;
  lastSnapshotTickMs: number;
}

export const DST_CANVAS_W = 1280;
export const DST_CANVAS_H = 416;
export const DEFAULT_DST_SEED = 48291;
export const DST_FIXED_STEP_MS = 20;
export const QUORUM_SIZE = 3;
export const DEGRADED_JITTER_MS = 220;
export const PARTITION_WALL_X = 515;
export const REDIS_FENCE_ANCHOR: DstPoint = { x: 515, y: 34 };
export const SQL_ROWVERSION_ANCHOR: DstPoint = { x: 515, y: 382 };

const MINORITY_SPLIT_SET: ReadonlySet<DstRegionId> = new Set(['SG-PRIMARY', 'AU-SYD']);

export const DST_REGION_ORDER: readonly DstRegionId[] = [
  'SG-PRIMARY',
  'US-EAST',
  'EU-WEST',
  'JP-EAST',
  'AU-SYD',
];

interface NodeBlueprint {
  id: DstRegionId;
  shortCode: string;
  city: string;
  x: number;
  y: number;
}

const NODE_BLUEPRINTS: readonly NodeBlueprint[] = [
  { id: 'SG-PRIMARY', shortCode: 'SG', city: 'Singapore Primary', x: 220, y: 134 },
  { id: 'AU-SYD', shortCode: 'AU', city: 'Sydney APAC', x: 230, y: 294 },
  { id: 'JP-EAST', shortCode: 'JP', city: 'Tokyo East', x: 805, y: 112 },
  { id: 'EU-WEST', shortCode: 'EU', city: 'Frankfurt West', x: 815, y: 310 },
  { id: 'US-EAST', shortCode: 'US', city: 'Virginia East', x: 1095, y: 208 },
];

interface LinkBlueprint {
  from: DstRegionId;
  to: DstRegionId;
  baseLatencyMs: number;
  controlX: number;
  controlY: number;
}

const LINK_BLUEPRINTS: readonly LinkBlueprint[] = [
  // Minority internal link
  { from: 'SG-PRIMARY', to: 'AU-SYD', baseLatencyMs: 62, controlX: 144, controlY: 214 },
  // Majority internal triangle
  { from: 'JP-EAST', to: 'EU-WEST', baseLatencyMs: 142, controlX: 866, controlY: 211 },
  { from: 'JP-EAST', to: 'US-EAST', baseLatencyMs: 118, controlX: 985, controlY: 132 },
  { from: 'EU-WEST', to: 'US-EAST', baseLatencyMs: 74, controlX: 990, controlY: 286 },
  // 6 Cross-partition links (all midpoints cleanly spaced away from Partition Wall center pill y=208!)
  { from: 'SG-PRIMARY', to: 'JP-EAST', baseLatencyMs: 42, controlX: 512, controlY: 74 },
  { from: 'SG-PRIMARY', to: 'US-EAST', baseLatencyMs: 158, controlX: 660, controlY: 122 },
  { from: 'AU-SYD', to: 'JP-EAST', baseLatencyMs: 92, controlX: 465, controlY: 142 },
  { from: 'SG-PRIMARY', to: 'EU-WEST', baseLatencyMs: 134, controlX: 465, controlY: 278 },
  { from: 'AU-SYD', to: 'US-EAST', baseLatencyMs: 166, controlX: 665, controlY: 290 },
  { from: 'AU-SYD', to: 'EU-WEST', baseLatencyMs: 178, controlX: 520, controlY: 344 },
];

// --- Deterministic Seeded PRNG (Mulberry32) ---

export function normalizeSeed(seed: number): number {
  const n = Math.floor(Math.abs(Number.isFinite(seed) ? seed : DEFAULT_DST_SEED));
  return (n % 999999) || DEFAULT_DST_SEED;
}

export function nextPrng(state: number): { value: number; nextState: number } {
  const s = (state + 0x6d2b79f5) >>> 0;
  let t = Math.imul(s ^ (s >>> 15), 1 | s);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  const value = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  return { value, nextState: s };
}

function drawUnit(state: DstClusterState): number {
  const r = nextPrng(state.rngState);
  state.rngState = r.nextState;
  return r.value;
}

function drawInt(state: DstClusterState, minInclusive: number, maxInclusive: number): number {
  const u = drawUnit(state);
  return minInclusive + Math.floor(u * (maxInclusive - minInclusive + 1));
}

export function formatRowVersionHex(seq: number): string {
  return `0x${Math.max(1, seq).toString(16).toUpperCase().padStart(8, '0')}`;
}

export function getLinkId(a: DstRegionId, b: DstRegionId): string {
  return `${a}__${b}`;
}

export function evaluateQuadraticBezier(
  p0: DstPoint,
  ctrl: DstPoint,
  p2: DstPoint,
  t: number
): DstPoint {
  const inv = 1 - t;
  return {
    x: inv * inv * p0.x + 2 * inv * t * ctrl.x + t * t * p2.x,
    y: inv * inv * p0.y + 2 * inv * t * ctrl.y + t * t * p2.y,
  };
}

export function findLinkBetween(
  links: readonly DstMeshLink[],
  a: DstRegionId,
  b: DstRegionId
): DstMeshLink | undefined {
  return links.find(
    (l) => (l.from === a && l.to === b) || (l.from === b && l.to === a)
  );
}

export function findClosestLinkAtPoint(
  state: Pick<DstClusterState, 'nodes' | 'links'>,
  x: number,
  y: number,
  thresholdPx = 15
): DstMeshLink | null {
  const nodeMap = new Map<DstRegionId, DstRegionNode>(state.nodes.map((n) => [n.id, n]));
  let bestLink: DstMeshLink | null = null;
  let bestDistSq = thresholdPx * thresholdPx;

  for (const link of state.links) {
    const a = nodeMap.get(link.from);
    const b = nodeMap.get(link.to);
    if (!a || !b) continue;
    const ctrl = { x: link.controlX, y: link.controlY };
    // Sample 24 segments along curve (avoiding endpoints inside node radius)
    for (let i = 3; i <= 21; i++) {
      const t = i / 24;
      const pt = evaluateQuadraticBezier(a, ctrl, b, t);
      const dx = pt.x - x;
      const dy = pt.y - y;
      const distSq = dx * dx + dy * dy;
      if (distSq < bestDistSq) {
        bestDistSq = distSq;
        bestLink = link;
      }
    }
  }
  return bestLink;
}

export function findNodeAtPoint(
  nodes: readonly DstRegionNode[],
  x: number,
  y: number,
  radiusPx = 46
): DstRegionNode | null {
  const rSq = radiusPx * radiusPx;
  for (const node of nodes) {
    const dx = node.x - x;
    const dy = node.y - y;
    if (dx * dx + dy * dy <= rSq) {
      return node;
    }
  }
  return null;
}

// --- Graph Connectivity & Quorum Topology ---

export function computeConnectedComponents(
  nodes: readonly DstRegionNode[],
  links: readonly DstMeshLink[]
): DstRegionId[][] {
  const aliveIds = new Set<DstRegionId>(
    nodes.filter((n) => n.status !== 'CRASHED').map((n) => n.id)
  );
  const adjacency = new Map<DstRegionId, DstRegionId[]>();
  for (const id of aliveIds) {
    adjacency.set(id, []);
  }
  for (const link of links) {
    if (link.status === 'SEVERED') continue;
    if (aliveIds.has(link.from) && aliveIds.has(link.to)) {
      adjacency.get(link.from)?.push(link.to);
      adjacency.get(link.to)?.push(link.from);
    }
  }

  const visited = new Set<DstRegionId>();
  const components: DstRegionId[][] = [];

  for (const id of aliveIds) {
    if (visited.has(id)) continue;
    const comp: DstRegionId[] = [];
    const queue: DstRegionId[] = [id];
    visited.add(id);
    while (queue.length > 0) {
      const curr = queue.shift()!;
      comp.push(curr);
      for (const next of adjacency.get(curr) ?? []) {
        if (!visited.has(next)) {
          visited.add(next);
          queue.push(next);
        }
      }
    }
    components.push(comp);
  }
  return components;
}

export function evaluateLinearizability(
  metrics: DstClusterMetrics,
  nodes: readonly DstRegionNode[]
): DstLinearizabilityReport {
  // Election safety: at most 1 active majority LEADER per term
  const leadersByTerm = new Map<number, number>();
  for (const n of nodes) {
    if (n.role === 'LEADER' && n.status === 'HEALTHY') {
      leadersByTerm.set(n.term, (leadersByTerm.get(n.term) ?? 0) + 1);
    }
  }
  let electionSafetyIntact = true;
  for (const count of leadersByTerm.values()) {
    if (count > 1) electionSafetyIntact = false;
  }

  const singleSpendIntact = metrics.doubleSpendLeaks === 0;
  const violationCount = metrics.doubleSpendLeaks + (electionSafetyIntact ? 0 : 1);

  if (violationCount === 0) {
    return {
      verdict: 'LINEARIZABLE',
      label: 'LINEARIZABLE — 0 VIOLATIONS',
      violationCount: 0,
      singleSpendIntact: true,
      electionSafetyIntact: true,
      summary:
        metrics.staleLeaderFenced > 0
          ? `Strict serializability preserved: ${metrics.staleLeaderFenced} stale-term minority writes fenced by Lua Epoch + Raft Quorum.`
          : 'Single-spend & Raft election safety invariants verified across all 5 global regions.',
    };
  }

  return {
    verdict: 'VIOLATION',
    label: 'LINEARIZABILITY VIOLATION DETECTED',
    violationCount,
    singleSpendIntact,
    electionSafetyIntact,
    summary: `CRITICAL: ${metrics.doubleSpendLeaks} concurrent voucher double-spend leak${metrics.doubleSpendLeaks === 1 ? '' : 's'} breached linearizability under unprotected RMW.`,
  };
}

function captureSnapshot(state: DstClusterState): DstClusterSnapshot {
  return {
    tickMs: state.tickMs,
    term: state.clusterTerm,
    fencingEpoch: state.fencingEpoch,
    rowVersionSeq: state.rowVersionSeq,
    leaderId: state.leaderId,
    staleLeaderId: state.staleLeaderId,
    hasQuorum: state.hasQuorum,
    partitionWallActive: state.partitionWallActive,
    engine: state.engine,
    nodes: state.nodes.map((n) => ({
      id: n.id,
      status: n.status,
      role: n.role,
      term: n.term,
      commitIndex: n.commitIndex,
      partitionGroup: n.partitionGroup,
      committedCount: n.committedCount,
      fencedCount: n.fencedCount,
      leakCount: n.leakCount,
    })),
    links: state.links.map((l) => ({
      id: l.id,
      status: l.status,
      effectiveLatencyMs: l.effectiveLatencyMs,
    })),
    metrics: { ...state.metrics },
    linearizability: { ...state.linearizability },
    historyCount: state.history.length,
  };
}

function recordSnapshot(state: DstClusterState, force = false): void {
  if (!force && state.tickMs - state.lastSnapshotTickMs < 100) return;
  const snap = captureSnapshot(state);
  const last = state.snapshots[state.snapshots.length - 1];
  if (last && last.tickMs === snap.tickMs) {
    state.snapshots[state.snapshots.length - 1] = snap;
  } else {
    state.snapshots.push(snap);
    if (state.snapshots.length > 260) {
      state.snapshots.shift();
    }
  }
  state.lastSnapshotTickMs = state.tickMs;
}

function pushHistory(
  state: DstClusterState,
  event: Omit<DstHistoryEvent, 'id' | 'tickMs' | 'engine'>
): void {
  state.history.push({
    ...event,
    id: state.nextEventId++,
    tickMs: state.tickMs,
    engine: state.engine,
  });
  if (state.history.length > 320) {
    state.history.shift();
  }
}

function pushShockwave(
  state: DstClusterState,
  x: number,
  y: number,
  kind: DstShockwave['kind'],
  maxRadius = 72
): void {
  state.shockwaves.push({
    id: state.nextShockwaveId++,
    x,
    y,
    kind,
    progress: 0,
    maxRadius,
  });
  if (state.shockwaves.length > 48) {
    state.shockwaves.shift();
  }
}

function getEndpointCoords(
  state: DstClusterState,
  endpoint: DstRegionId | 'REDIS_FENCE' | 'SQL_ROWVERSION'
): DstPoint {
  if (endpoint === 'REDIS_FENCE') return REDIS_FENCE_ANCHOR;
  if (endpoint === 'SQL_ROWVERSION') return SQL_ROWVERSION_ANCHOR;
  const node = state.nodes.find((n) => n.id === endpoint);
  return node ? { x: node.x, y: node.y } : { x: DST_CANVAS_W / 2, y: DST_CANVAS_H / 2 };
}

function spawnPacket(
  state: DstClusterState,
  params: {
    kind: DstPacketKind;
    from: DstRegionId | 'REDIS_FENCE' | 'SQL_ROWVERSION';
    to: DstRegionId | 'REDIS_FENCE' | 'SQL_ROWVERSION';
    term: number;
    payloadLabel: string;
    speedMultiplier?: number;
    deflectAtMidpoint?: boolean;
    initialProgress?: number;
  }
): void {
  const start = getEndpointCoords(state, params.from);
  const end = getEndpointCoords(state, params.to);
  let link: DstMeshLink | undefined;
  let ctrlX = (start.x + end.x) / 2;
  let ctrlY = (start.y + end.y) / 2 - 22;

  if (
    params.from !== 'REDIS_FENCE' &&
    params.from !== 'SQL_ROWVERSION' &&
    params.to !== 'REDIS_FENCE' &&
    params.to !== 'SQL_ROWVERSION'
  ) {
    link = findLinkBetween(state.links, params.from, params.to);
    if (link) {
      ctrlX = link.controlX;
      ctrlY = link.controlY;
    }
  } else {
    // Gentle arc toward center data fabric
    ctrlX = (start.x + end.x) / 2 + (drawUnit(state) - 0.5) * 44;
    ctrlY = (start.y + end.y) / 2 + (drawUnit(state) - 0.5) * 32;
  }

  const latencyFactor = link ? (link.status === 'DEGRADED' ? 0.45 : 1.0) : 1.05;
  const jitter = (drawUnit(state) - 0.5) * 14;
  const baseSpeed =
    params.kind === 'HEARTBEAT'
      ? 1.55
      : params.kind === 'REQUEST_VOTE' || params.kind === 'VOTE_GRANTED'
        ? 3.8
        : params.kind === 'LOG_CATCHUP'
          ? 2.0
          : 1.45;

  state.packets.push({
    id: state.nextPacketId++,
    kind: params.kind,
    from: params.from,
    to: params.to,
    linkId: link?.id ?? null,
    term: params.term,
    progress: params.initialProgress ?? 0,
    speedPerSec: baseSpeed * latencyFactor * (params.speedMultiplier ?? 1),
    startX: start.x,
    startY: start.y,
    ctrlX: ctrlX + jitter,
    ctrlY: ctrlY + jitter,
    endX: end.x,
    endY: end.y,
    jitterOffset: jitter,
    payloadLabel: params.payloadLabel,
    deflectAtMidpoint: params.deflectAtMidpoint ?? false,
    resolved: false,
  });
  state.metrics.packetsDispatched += 1;

  if (state.packets.length > 220) {
    state.packets.shift();
  }
}

function cloneState(state: DstClusterState): DstClusterState {
  return {
    ...state,
    nodes: state.nodes.map((n) => ({ ...n, votesReceived: [...n.votesReceived] })),
    links: state.links.map((l) => ({ ...l })),
    packets: state.packets.map((p) => ({ ...p })),
    shockwaves: state.shockwaves.map((s) => ({ ...s })),
    history: [...state.history],
    snapshots: [...state.snapshots],
    recordedCommands: [...state.recordedCommands],
    metrics: { ...state.metrics },
    linearizability: { ...state.linearizability },
  };
}

// --- Core State Factory ---

export function createInitialDstCluster(
  seed = DEFAULT_DST_SEED,
  engine: DstEngineMode = 'AEGIS_LUA_WAL'
): DstClusterState {
  const normalizedSeed = normalizeSeed(seed);
  const state: DstClusterState = {
    seed: normalizedSeed,
    rngState: normalizedSeed >>> 0,
    tickMs: 0,
    engine,
    clusterTerm: 1,
    fencingEpoch: 1,
    rowVersionSeq: 1024,
    leaderId: 'SG-PRIMARY',
    staleLeaderId: null,
    hasQuorum: true,
    majoritySize: 5,
    partitionWallActive: false,
    nodes: [],
    links: [],
    packets: [],
    shockwaves: [],
    history: [],
    snapshots: [],
    recordedCommands: [],
    metrics: {
      totalVoucherRequests: 0,
      committed200: 0,
      fenced409: 0,
      doubleSpendLeaks: 0,
      staleLeaderFenced: 0,
      electionsCompleted: 1,
      packetsDispatched: 0,
      packetsDropped: 0,
      stormWavesFired: 0,
      lastStormLatencyP99Ms: 2.8,
    },
    linearizability: {
      verdict: 'LINEARIZABLE',
      label: 'LINEARIZABLE — 0 VIOLATIONS',
      violationCount: 0,
      singleSpendIntact: true,
      electionSafetyIntact: true,
      summary: 'Single-spend & Raft election safety invariants verified across all 5 global regions.',
    },
    nextPacketId: 1,
    nextEventId: 1,
    nextShockwaveId: 1,
    lastSnapshotTickMs: -1000,
  };

  state.nodes = NODE_BLUEPRINTS.map((bp, idx) => {
    // Staggered Raft Section 5.2 election timeouts so one peer campaigns cleanly first
    const timeout = 640 + idx * 240 + drawInt(state, 0, 110);
    return {
      id: bp.id,
      shortCode: bp.shortCode,
      city: bp.city,
      x: bp.x,
      y: bp.y,
      status: 'HEALTHY',
      role: bp.id === 'SG-PRIMARY' ? 'LEADER' : 'FOLLOWER',
      term: 1,
      commitIndex: 100,
      votedFor: 'SG-PRIMARY',
      votesReceived: bp.id === 'SG-PRIMARY' ? [...DST_REGION_ORDER] : [],
      electionTimeoutMs: timeout,
      electionElapsedMs: 0,
      heartbeatElapsedMs: 0,
      partitionGroup: 'MAJORITY',
      committedCount: 0,
      fencedCount: 0,
      leakCount: 0,
      lastPulseMs: 0,
    };
  });

  state.links = LINK_BLUEPRINTS.map((bp) => {
    const fromMinority = MINORITY_SPLIT_SET.has(bp.from);
    const toMinority = MINORITY_SPLIT_SET.has(bp.to);
    return {
      id: getLinkId(bp.from, bp.to),
      from: bp.from,
      to: bp.to,
      baseLatencyMs: bp.baseLatencyMs,
      effectiveLatencyMs: bp.baseLatencyMs,
      status: 'HEALTHY',
      controlX: bp.controlX,
      controlY: bp.controlY,
      isCrossSplitBrain: fromMinority !== toMinority,
      lastCutTickMs: null,
    };
  });

  pushHistory(state, {
    region: 'SG-PRIMARY',
    kind: 'LEADER_ELECTED',
    term: 1,
    latencyMs: 14,
    detail: 'Bootstrap Term 1 Leader elected (5/5 quorum healthy)',
    waveId: null,
  });

  // Seed initial heartbeat wave so frame 0 already feels alive
  for (const node of state.nodes) {
    if (node.id !== 'SG-PRIMARY') {
      spawnPacket(state, {
        kind: 'HEARTBEAT',
        from: 'SG-PRIMARY',
        to: node.id,
        term: 1,
        payloadLabel: 'AE T1',
      });
    }
  }

  recordSnapshot(state, true);
  return state;
}

// --- Topology Reconciliation ---

function reconcilePartitions(state: DstClusterState): void {
  const components = computeConnectedComponents(state.nodes, state.links);
  const majorityComp = components.find((c) => c.length >= QUORUM_SIZE) ?? null;
  const majoritySet = new Set<DstRegionId>(majorityComp ?? []);

  state.hasQuorum = majorityComp !== null;
  state.majoritySize = majorityComp ? majorityComp.length : 0;

  // Determine whether the classic 2-vs-3 Split-Brain Partition Wall is visually active
  const crossLinks = state.links.filter((l) => l.isCrossSplitBrain);
  const allCrossSevered = crossLinks.length > 0 && crossLinks.every((l) => l.status === 'SEVERED');
  state.partitionWallActive = allCrossSevered;

  let activeMajorityLeader: DstRegionId | null = null;
  let staleMinorityLeader: DstRegionId | null = null;

  for (const node of state.nodes) {
    if (node.status === 'CRASHED') {
      node.role = 'OFFLINE';
      node.partitionGroup = 'OFFLINE';
      continue;
    }

    if (majoritySet.has(node.id)) {
      node.status = 'HEALTHY';
      node.partitionGroup = 'MAJORITY';
      if (node.role === 'STALE_LEADER_FENCED') {
        // Rejoined majority: step down if cluster term moved ahead
        if (node.term < state.clusterTerm) {
          node.role = 'FOLLOWER';
          node.term = state.clusterTerm;
        } else {
          node.role = 'LEADER';
        }
      }
      if (node.role === 'LEADER') {
        if (activeMajorityLeader === null) {
          activeMajorityLeader = node.id;
        } else {
          // Enforce Raft Election Safety: older term steps down
          const existing = state.nodes.find((x) => x.id === activeMajorityLeader)!;
          if (node.term > existing.term) {
            existing.role = 'FOLLOWER';
            existing.term = node.term;
            activeMajorityLeader = node.id;
          } else {
            node.role = 'FOLLOWER';
            node.term = existing.term;
          }
        }
      }
    } else {
      node.status = 'PARTITIONED_MINORITY';
      node.partitionGroup = 'MINORITY';
      if (node.role === 'LEADER' || node.role === 'STALE_LEADER_FENCED') {
        node.role = 'STALE_LEADER_FENCED';
        staleMinorityLeader = node.id;
      }
    }
  }

  state.leaderId = activeMajorityLeader;
  state.staleLeaderId = staleMinorityLeader;
  state.linearizability = evaluateLinearizability(state.metrics, state.nodes);
}

function getReachablePeers(state: DstClusterState, fromId: DstRegionId): DstRegionNode[] {
  const fromNode = state.nodes.find((n) => n.id === fromId);
  if (!fromNode || fromNode.status === 'CRASHED') return [];
  const peers: DstRegionNode[] = [];
  for (const link of state.links) {
    if (link.status === 'SEVERED') continue;
    const otherId = link.from === fromId ? link.to : link.to === fromId ? link.from : null;
    if (!otherId) continue;
    const other = state.nodes.find((n) => n.id === otherId);
    if (other && other.status !== 'CRASHED') {
      peers.push(other);
    }
  }
  return peers;
}

// --- Deterministic Simulation Stepping ---

function handlePacketArrival(state: DstClusterState, pkt: DstRpcPacket): void {
  if (pkt.to === 'REDIS_FENCE' || pkt.to === 'SQL_ROWVERSION') {
    return;
  }
  const target = state.nodes.find((n) => n.id === pkt.to);
  if (!target || target.status === 'CRASHED') {
    state.metrics.packetsDropped += 1;
    return;
  }

  // Verify link wasn't severed mid-flight
  if (pkt.linkId) {
    const link = state.links.find((l) => l.id === pkt.linkId);
    if (link && link.status === 'SEVERED') {
      state.metrics.packetsDropped += 1;
      return;
    }
  }

  if (pkt.kind === 'HEARTBEAT' || pkt.kind === 'LOG_CATCHUP') {
    const senderNode =
      pkt.from !== 'REDIS_FENCE' && pkt.from !== 'SQL_ROWVERSION'
        ? state.nodes.find((n) => n.id === pkt.from) ?? null
        : null;
    // Ignore stale in-flight heartbeats from a node that has already crashed
    if (senderNode && senderNode.status === 'CRASHED') {
      state.metrics.packetsDropped += 1;
      return;
    }
    if (pkt.term >= target.term) {
      const wasStale = target.role === 'STALE_LEADER_FENCED' || target.role === 'CANDIDATE';
      target.term = pkt.term;
      target.electionElapsedMs = 0;
      if (target.role !== 'LEADER') {
        target.role = 'FOLLOWER';
      }
      if (wasStale && target.partitionGroup === 'MAJORITY') {
        target.status = 'HEALTHY';
        pushShockwave(state, target.x, target.y, 'HEAL', 56);
      }
      if (senderNode && target.commitIndex < senderNode.commitIndex) {
        target.commitIndex = senderNode.commitIndex;
      }
      target.lastPulseMs = state.tickMs;
    }
    return;
  }

  if (pkt.kind === 'REQUEST_VOTE') {
    const candidateId = pkt.from;
    if (candidateId === 'REDIS_FENCE' || candidateId === 'SQL_ROWVERSION') return;
    if (pkt.term > target.term) {
      target.term = pkt.term;
      target.votedFor = candidateId;
      if (target.role !== 'OFFLINE') {
        target.role = target.partitionGroup === 'MAJORITY' ? 'FOLLOWER' : target.role;
      }
      target.electionElapsedMs = 0;
      spawnPacket(state, {
        kind: 'VOTE_GRANTED',
        from: target.id,
        to: candidateId,
        term: pkt.term,
        payloadLabel: `VOTE T${pkt.term}`,
      });
    } else if (pkt.term === target.term && (target.votedFor === null || target.votedFor === candidateId)) {
      target.votedFor = candidateId;
      target.electionElapsedMs = 0;
      spawnPacket(state, {
        kind: 'VOTE_GRANTED',
        from: target.id,
        to: candidateId,
        term: pkt.term,
        payloadLabel: `VOTE T${pkt.term}`,
      });
    }
    return;
  }

  if (pkt.kind === 'VOTE_GRANTED') {
    const voterId = pkt.from;
    if (voterId === 'REDIS_FENCE' || voterId === 'SQL_ROWVERSION') return;
    if (
      target.role === 'CANDIDATE' &&
      target.term === pkt.term &&
      target.partitionGroup === 'MAJORITY'
    ) {
      if (!target.votesReceived.includes(voterId)) {
        target.votesReceived.push(voterId);
      }
      if (target.votesReceived.length >= QUORUM_SIZE) {
        // Majority reached — elect new Leader!
        target.role = 'LEADER';
        target.heartbeatElapsedMs = 0;
        target.lastPulseMs = state.tickMs;
        state.leaderId = target.id;
        state.clusterTerm = Math.max(state.clusterTerm, target.term);
        state.fencingEpoch = Math.max(state.fencingEpoch, target.term);
        state.metrics.electionsCompleted += 1;

        pushShockwave(state, target.x, target.y, 'ELECTION', 88);
        pushHistory(state, {
          region: target.id,
          kind: 'LEADER_ELECTED',
          term: target.term,
          latencyMs: Math.round(target.electionTimeoutMs * 0.24),
          detail: `${target.id} won Raft majority (${target.votesReceived.length}/5 votes) at Term ${target.term}`,
          waveId: null,
        });

        // Immediately broadcast authority heartbeats to reachable peers
        for (const peer of getReachablePeers(state, target.id)) {
          if (peer.role === 'CANDIDATE' || peer.role === 'LEADER') {
            peer.role = 'FOLLOWER';
            peer.term = target.term;
          }
          spawnPacket(state, {
            kind: 'HEARTBEAT',
            from: target.id,
            to: peer.id,
            term: target.term,
            payloadLabel: `AE T${target.term}`,
          });
        }
        recordSnapshot(state, true);
      }
    }
  }
}

export function stepDstCluster(
  prevState: DstClusterState,
  deltaMs = DST_FIXED_STEP_MS
): DstClusterState {
  const state = cloneState(prevState);
  const clampedDelta = Math.max(1, Math.min(200, deltaMs));
  state.tickMs += clampedDelta;

  reconcilePartitions(state);

  // 1. Advance active RPC packets
  const survivingPackets: DstRpcPacket[] = [];
  for (const pkt of state.packets) {
    const prevProgress = pkt.progress;
    pkt.progress += (pkt.speedPerSec * clampedDelta) / 1000;

    // Deflect blocked packets at the partition midpoint with amber/crimson sparks
    if (pkt.deflectAtMidpoint && prevProgress < 0.5 && pkt.progress >= 0.5) {
      const mid = evaluateQuadraticBezier(
        { x: pkt.startX, y: pkt.startY },
        { x: pkt.ctrlX, y: pkt.ctrlY },
        { x: pkt.endX, y: pkt.endY },
        0.5
      );
      pushShockwave(state, mid.x, mid.y, pkt.kind === 'DOUBLE_SPEND_LEAK' ? 'LEAK' : 'FENCE', 34);
      state.metrics.packetsDropped += 1;
      continue;
    }

    if (pkt.progress >= 1) {
      if (!pkt.resolved) {
        pkt.resolved = true;
        handlePacketArrival(state, pkt);
      }
      continue;
    }
    survivingPackets.push(pkt);
  }
  state.packets = survivingPackets;

  // 2. Advance shockwaves (longer dramatic lifetime on LEAK / ELECTION / CRASH)
  state.shockwaves = state.shockwaves
    .map((sw) => ({
      ...sw,
      progress:
        sw.progress +
        clampedDelta / (sw.kind === 'LEAK' || sw.kind === 'ELECTION' || sw.kind === 'CRASH' ? 1150 : 720),
    }))
    .filter((sw) => sw.progress < 1);

  // 3. Leader heartbeats & Follower election timers
  const HEARTBEAT_INTERVAL_MS = 460;
  for (const node of state.nodes) {
    if (node.status === 'CRASHED') continue;

    if (node.role === 'LEADER' && node.partitionGroup === 'MAJORITY') {
      node.heartbeatElapsedMs += clampedDelta;
      if (node.heartbeatElapsedMs >= HEARTBEAT_INTERVAL_MS) {
        node.heartbeatElapsedMs = 0;
        node.lastPulseMs = state.tickMs;
        const peers = getReachablePeers(state, node.id);
        for (const peer of peers) {
          spawnPacket(state, {
            kind: 'HEARTBEAT',
            from: node.id,
            to: peer.id,
            term: node.term,
            payloadLabel: `AE T${node.term}`,
          });
        }
      }
      continue;
    }

    if (node.role === 'STALE_LEADER_FENCED') {
      // Stale minority leader keeps attempting heartbeats that hit severed links / minority peer
      node.heartbeatElapsedMs += clampedDelta;
      if (node.heartbeatElapsedMs >= HEARTBEAT_INTERVAL_MS * 1.35) {
        node.heartbeatElapsedMs = 0;
        for (const link of state.links) {
          const other = link.from === node.id ? link.to : link.to === node.id ? link.from : null;
          if (!other) continue;
          if (link.status === 'SEVERED') {
            spawnPacket(state, {
              kind: 'VOUCHER_FENCED_409',
              from: node.id,
              to: other,
              term: node.term,
              payloadLabel: `FENCED T${node.term}`,
              deflectAtMidpoint: true,
            });
          } else {
            const peer = state.nodes.find((x) => x.id === other);
            if (peer && peer.status !== 'CRASHED') {
              spawnPacket(state, {
                kind: 'HEARTBEAT',
                from: node.id,
                to: peer.id,
                term: node.term,
                payloadLabel: `STALE T${node.term}`,
              });
            }
          }
        }
      }
      continue;
    }

    // Followers & Candidates track election timeout when no majority leader heartbeats arrive
    node.electionElapsedMs += clampedDelta;
    if (
      node.partitionGroup === 'MAJORITY' &&
      state.leaderId === null &&
      node.electionElapsedMs >= node.electionTimeoutMs
    ) {
      // Start real Raft election!
      const nextTerm = Math.max(state.clusterTerm, node.term) + 1;
      state.clusterTerm = nextTerm;
      node.role = 'CANDIDATE';
      node.term = nextTerm;
      node.votedFor = node.id;
      node.votesReceived = [node.id];
      node.electionElapsedMs = 0;
      node.electionTimeoutMs = 950 + drawInt(state, 80, 520);

      pushShockwave(state, node.x, node.y, 'ELECTION', 64);

      const peers = getReachablePeers(state, node.id);
      for (const peer of peers) {
        spawnPacket(state, {
          kind: 'REQUEST_VOTE',
          from: node.id,
          to: peer.id,
          term: nextTerm,
          payloadLabel: `RV T${nextTerm}`,
        });
      }
    }
  }

  reconcilePartitions(state);
  recordSnapshot(state, false);
  return state;
}

// --- Direct-Manipulation Chaos Actions ---

export function setDstEngineMode(
  prevState: DstClusterState,
  engine: DstEngineMode,
  recordCommand = true
): DstClusterState {
  const state = cloneState(prevState);
  state.engine = engine;
  if (recordCommand) {
    state.recordedCommands.push({ tickMs: state.tickMs, type: 'SET_ENGINE', engine });
  }
  recordSnapshot(state, true);
  return state;
}

export function setDstLinkStatus(
  prevState: DstClusterState,
  linkId: string,
  nextStatus: DstLinkStatus,
  recordCommand = true
): DstClusterState {
  const state = cloneState(prevState);
  const link = state.links.find((l) => l.id === linkId);
  if (!link) return state;

  const prevStatus = link.status;
  link.status = nextStatus;
  link.effectiveLatencyMs =
    nextStatus === 'DEGRADED'
      ? link.baseLatencyMs + DEGRADED_JITTER_MS
      : nextStatus === 'HEALTHY'
        ? link.baseLatencyMs
        : 0;
  link.lastCutTickMs = nextStatus === 'SEVERED' ? state.tickMs : null;

  if (recordCommand) {
    state.recordedCommands.push({
      tickMs: state.tickMs,
      type: 'SET_LINK_STATUS',
      linkId,
      status: nextStatus,
    });
  }

  const fromNode = state.nodes.find((n) => n.id === link.from);
  const toNode = state.nodes.find((n) => n.id === link.to);
  if (fromNode && toNode) {
    const mid = evaluateQuadraticBezier(
      fromNode,
      { x: link.controlX, y: link.controlY },
      toNode,
      0.5
    );
    if (nextStatus === 'SEVERED') {
      pushShockwave(state, mid.x, mid.y, 'CUT', 54);
      pushHistory(state, {
        region: link.from,
        kind: 'LINK_CUT',
        term: state.clusterTerm,
        latencyMs: 0,
        detail: `Scissors severed link ${link.from} <-> ${link.to}`,
        waveId: null,
      });
    } else if (nextStatus === 'DEGRADED') {
      pushShockwave(state, mid.x, mid.y, 'FENCE', 48);
      pushHistory(state, {
        region: link.from,
        kind: 'LINK_DEGRADED',
        term: state.clusterTerm,
        latencyMs: link.effectiveLatencyMs,
        detail: `Injected +${DEGRADED_JITTER_MS}ms jitter on ${link.from} <-> ${link.to} (${link.effectiveLatencyMs}ms)`,
        waveId: null,
      });
    } else if (prevStatus !== 'HEALTHY') {
      pushShockwave(state, mid.x, mid.y, 'HEAL', 56);
      pushHistory(state, {
        region: link.from,
        kind: 'LINK_HEALED',
        term: state.clusterTerm,
        latencyMs: link.baseLatencyMs,
        detail: `Healed link ${link.from} <-> ${link.to} (${link.baseLatencyMs}ms) — Log Catch-Up started`,
        waveId: null,
      });
      // Send emerald LOG_CATCHUP packets across healed link
      spawnPacket(state, {
        kind: 'LOG_CATCHUP',
        from: link.from,
        to: link.to,
        term: state.clusterTerm,
        payloadLabel: `SYNC T${state.clusterTerm}`,
      });
      spawnPacket(state, {
        kind: 'LOG_CATCHUP',
        from: link.to,
        to: link.from,
        term: state.clusterTerm,
        payloadLabel: `SYNC T${state.clusterTerm}`,
      });
    }
  }

  reconcilePartitions(state);
  recordSnapshot(state, true);
  return state;
}

export function toggleDstLinkScissors(
  prevState: DstClusterState,
  linkId: string,
  recordCommand = true
): DstClusterState {
  const link = prevState.links.find((l) => l.id === linkId);
  if (!link) return prevState;
  const nextStatus: DstLinkStatus = link.status === 'SEVERED' ? 'HEALTHY' : 'SEVERED';
  const next = setDstLinkStatus(prevState, linkId, nextStatus, false);
  if (recordCommand) {
    next.recordedCommands.push({ tickMs: prevState.tickMs, type: 'TOGGLE_LINK', linkId });
  }
  return next;
}

export function toggleDstNodeCrash(
  prevState: DstClusterState,
  regionId: DstRegionId,
  recordCommand = true
): DstClusterState {
  const state = cloneState(prevState);
  const node = state.nodes.find((n) => n.id === regionId);
  if (!node) return state;

  if (recordCommand) {
    state.recordedCommands.push({ tickMs: state.tickMs, type: 'TOGGLE_NODE_CRASH', regionId });
  }

  if (node.status === 'CRASHED') {
    // Revive node as follower catching up to current leader
    node.status = 'HEALTHY';
    node.role = 'FOLLOWER';
    node.electionElapsedMs = 0;
    node.term = state.clusterTerm;
    pushShockwave(state, node.x, node.y, 'HEAL', 74);
    pushHistory(state, {
      region: node.id,
      kind: 'NODE_REVIVE',
      term: state.clusterTerm,
      latencyMs: 18,
      detail: `${node.id} resurrected — streaming WAL log catch-up`,
      waveId: null,
    });
    if (state.leaderId && state.leaderId !== node.id) {
      spawnPacket(state, {
        kind: 'LOG_CATCHUP',
        from: state.leaderId,
        to: node.id,
        term: state.clusterTerm,
        payloadLabel: `CATCHUP T${state.clusterTerm}`,
      });
    }
  } else {
    const wasLeader = node.role === 'LEADER';
    node.status = 'CRASHED';
    node.role = 'OFFLINE';
    node.partitionGroup = 'OFFLINE';
    if (state.leaderId === node.id) {
      state.leaderId = null;
    }
    pushShockwave(state, node.x, node.y, 'CRASH', 84);
    pushHistory(state, {
      region: node.id,
      kind: 'NODE_CRASH',
      term: state.clusterTerm,
      latencyMs: 0,
      detail: wasLeader
        ? `${node.id} (LEADER) hard-crashed — Raft failover triggered in majority`
        : `${node.id} crashed (OFFLINE) — traffic rerouted`,
      waveId: null,
    });

    // Advance surviving followers uniformly so staggered Raft election offsets remain intact
    if (wasLeader) {
      const candidates = state.nodes.filter((peer) => peer.status !== 'CRASHED');
      if (candidates.length > 0) {
        const minRem = Math.min(
          ...candidates.map((peer) => Math.max(0, peer.electionTimeoutMs - peer.electionElapsedMs))
        );
        const boost = Math.max(0, minRem - 160);
        for (const peer of candidates) {
          peer.electionElapsedMs += boost;
        }
      }
    }
  }

  reconcilePartitions(state);
  recordSnapshot(state, true);
  return state;
}

export function applySplitBrainPreset(
  prevState: DstClusterState,
  recordCommand = true
): DstClusterState {
  const state = cloneState(prevState);

  if (recordCommand) {
    state.recordedCommands.push({ tickMs: state.tickMs, type: 'SPLIT_BRAIN_PRESET' });
  }

  // Ensure all 5 nodes are alive for crisp 2 vs 3 split-brain demonstration
  for (const node of state.nodes) {
    if (node.status === 'CRASHED') {
      node.status = 'HEALTHY';
      node.role = 'FOLLOWER';
      node.term = state.clusterTerm;
    }
  }

  // Keep intra-partition links healthy, sever all 6 cross-partition links
  for (const link of state.links) {
    if (link.isCrossSplitBrain) {
      link.status = 'SEVERED';
      link.effectiveLatencyMs = 0;
      link.lastCutTickMs = state.tickMs;
      const fromNode = state.nodes.find((n) => n.id === link.from);
      const toNode = state.nodes.find((n) => n.id === link.to);
      if (fromNode && toNode) {
        const mid = evaluateQuadraticBezier(
          fromNode,
          { x: link.controlX, y: link.controlY },
          toNode,
          0.5
        );
        pushShockwave(state, mid.x, mid.y, 'CUT', 52);
      }
    } else {
      link.status = 'HEALTHY';
      link.effectiveLatencyMs = link.baseLatencyMs;
      link.lastCutTickMs = null;
    }
  }

  // Ensure SG-PRIMARY is stale minority leader if no minority leader existed yet
  const sg = state.nodes.find((n) => n.id === 'SG-PRIMARY');
  if (sg && (sg.role === 'LEADER' || state.leaderId === 'SG-PRIMARY')) {
    sg.role = 'STALE_LEADER_FENCED';
  } else if (sg) {
    // If leader was already on right side, demote right side momentarily? No — keep authentic Raft!
    // If leader was SG-PRIMARY (initial state), SG-PRIMARY is now fenced minority leader and right 3 nodes elect new Leader!
  }

  // Advance majority followers uniformly so their staggered Raft election timeouts trigger cleanly without split-vote collision
  const majorityFollowers = state.nodes.filter(
    (n) => !MINORITY_SPLIT_SET.has(n.id) && n.role !== 'LEADER'
  );
  if (majorityFollowers.length > 0) {
    const minRem = Math.min(
      ...majorityFollowers.map((n) => Math.max(0, n.electionTimeoutMs - n.electionElapsedMs))
    );
    const boost = Math.max(0, minRem - 140);
    for (const node of majorityFollowers) {
      node.electionElapsedMs += boost;
    }
  }

  pushHistory(state, {
    region: 'SG-PRIMARY',
    kind: 'PARTITION_WALL',
    term: state.clusterTerm,
    latencyMs: 0,
    detail: '2-vs-3 Split-Brain Partition Wall sliced [SG-PRIMARY, AU-SYD] from [JP-EAST, US-EAST, EU-WEST]',
    waveId: null,
  });

  reconcilePartitions(state);
  recordSnapshot(state, true);
  return state;
}

export function healAllDstFaults(
  prevState: DstClusterState,
  recordCommand = true
): DstClusterState {
  const state = cloneState(prevState);

  if (recordCommand) {
    state.recordedCommands.push({ tickMs: state.tickMs, type: 'HEAL_ALL' });
  }

  for (const node of state.nodes) {
    if (node.status === 'CRASHED' || node.status === 'PARTITIONED_MINORITY') {
      node.status = 'HEALTHY';
      if (node.role === 'OFFLINE' || node.role === 'STALE_LEADER_FENCED') {
        node.role = 'FOLLOWER';
      }
      node.term = state.clusterTerm;
      node.electionElapsedMs = 0;
      pushShockwave(state, node.x, node.y, 'HEAL', 62);
    }
  }

  for (const link of state.links) {
    const wasBroken = link.status !== 'HEALTHY';
    link.status = 'HEALTHY';
    link.effectiveLatencyMs = link.baseLatencyMs;
    link.lastCutTickMs = null;
    if (wasBroken) {
      spawnPacket(state, {
        kind: 'LOG_CATCHUP',
        from: link.from,
        to: link.to,
        term: state.clusterTerm,
        payloadLabel: `SYNC T${state.clusterTerm}`,
      });
    }
  }

  // Ensure a healthy leader exists
  const hasLeader = state.nodes.some((n) => n.role === 'LEADER');
  if (!hasLeader) {
    const sg = state.nodes.find((n) => n.id === 'SG-PRIMARY')!;
    sg.role = 'LEADER';
    state.leaderId = sg.id;
  }

  // Sync commit index across all 5 regions
  const maxCommit = Math.max(...state.nodes.map((n) => n.commitIndex));
  for (const node of state.nodes) {
    node.commitIndex = maxCommit;
  }

  pushHistory(state, {
    region: state.leaderId ?? 'SG-PRIMARY',
    kind: 'LINK_HEALED',
    term: state.clusterTerm,
    latencyMs: 12,
    detail: `All 5 regions & 10 mesh links healed — WAL catch-up synced to idx #${maxCommit}`,
    waveId: null,
  });

  reconcilePartitions(state);
  recordSnapshot(state, true);
  return state;
}

// --- 500-Request Concurrent Voucher Storm Engine ---

export function blastVoucherStorm(
  prevState: DstClusterState,
  requestCount = 500,
  recordCommand = true
): DstClusterState {
  const state = cloneState(prevState);
  const count = Math.max(50, Math.min(2000, Math.round(requestCount)));
  const waveId = state.metrics.stormWavesFired + 1;
  state.metrics.stormWavesFired = waveId;

  if (recordCommand) {
    state.recordedCommands.push({
      tickMs: state.tickMs,
      type: 'BLAST_VOUCHER_STORM',
      requestCount: count,
    });
  }

  reconcilePartitions(state);

  const aliveNodes = state.nodes.filter((n) => n.status !== 'CRASHED');
  if (aliveNodes.length === 0) {
    state.metrics.totalVoucherRequests += count;
    state.metrics.fenced409 += count;
    recordSnapshot(state, true);
    return state;
  }

  const majorityLeader = state.leaderId
    ? state.nodes.find((n) => n.id === state.leaderId) ?? null
    : null;
  const staleLeader = state.staleLeaderId
    ? state.nodes.find((n) => n.id === state.staleLeaderId) ?? null
    : null;

  // Deterministic per-region request split across all alive regions
  const regionWeights = aliveNodes.map((n) => ({
    node: n,
    weight: 0.75 + drawUnit(state) * 0.5,
  }));
  const weightSum = regionWeights.reduce((acc, r) => acc + r.weight, 0);
  const regionCounts = new Map<DstRegionId, number>();
  let assigned = 0;
  regionWeights.forEach((rw, idx) => {
    const share =
      idx === regionWeights.length - 1
        ? count - assigned
        : Math.max(1, Math.round((rw.weight / weightSum) * count));
    regionCounts.set(rw.node.id, share);
    assigned += share;
  });

  const engine = state.engine;
  let waveCommitted = 0;
  let waveFenced = 0;
  let waveLeaks = 0;
  let waveStaleFenced = 0;

  // Compute degraded link penalty on cluster
  const degradedLinksCount = state.links.filter((l) => l.status === 'DEGRADED').length;
  const jitterPenaltyMs = degradedLinksCount * 14;

  if (engine === 'AEGIS_LUA_WAL' || engine === 'ROWVERSION_CAS') {
    // STRICT LINEARIZABILITY: at most 1 commit per voucher wave, ONLY when majority quorum leader exists!
    const baseLatencyMs =
      engine === 'AEGIS_LUA_WAL'
        ? 1.4 + drawUnit(state) * 2.2 + jitterPenaltyMs * 0.15
        : 18.5 + drawUnit(state) * 26.0 + jitterPenaltyMs * 0.65;

    if (state.hasQuorum && majorityLeader) {
      // Pick winning origin region among majority nodes deterministically
      const majorityNodes = aliveNodes.filter((n) => n.partitionGroup === 'MAJORITY');
      const winnerOrigin =
        majorityNodes[drawInt(state, 0, majorityNodes.length - 1)] ?? majorityLeader;

      waveCommitted = 1;
      majorityLeader.committedCount += 1;
      majorityLeader.commitIndex += 1;
      for (const peer of majorityNodes) {
        if (peer.id !== majorityLeader.id) {
          peer.commitIndex = majorityLeader.commitIndex;
        }
      }
      state.rowVersionSeq += 1;
      state.fencingEpoch = Math.max(state.fencingEpoch, majorityLeader.term);

      const commitLatency = Number(baseLatencyMs.toFixed(1));
      pushHistory(state, {
        region: winnerOrigin.id,
        kind: 'COMMITTED_200',
        term: majorityLeader.term,
        latencyMs: commitLatency,
        detail:
          engine === 'AEGIS_LUA_WAL'
            ? `Wave #${waveId}: 1/1 voucher committed via Redis Lua Epoch T${state.fencingEpoch} (${commitLatency}ms)`
            : `Wave #${waveId}: 1/1 voucher committed via SQL ROWVERSION ${formatRowVersionHex(state.rowVersionSeq)} (${commitLatency}ms)`,
        waveId,
      });

      // Launch emerald winning packet chain: Origin -> Majority Leader -> Redis Lua Fence / SQL RowVersion
      spawnPacket(state, {
        kind: 'VOUCHER_COMMITTED_200',
        from: winnerOrigin.id,
        to: engine === 'AEGIS_LUA_WAL' ? 'REDIS_FENCE' : 'SQL_ROWVERSION',
        term: majorityLeader.term,
        payloadLabel: '200 OK',
        speedMultiplier: 1.15,
      });
      if (winnerOrigin.id !== majorityLeader.id) {
        spawnPacket(state, {
          kind: 'VOUCHER_COMMITTED_200',
          from: winnerOrigin.id,
          to: majorityLeader.id,
          term: majorityLeader.term,
          payloadLabel: '200 COMMIT',
        });
      }
      pushShockwave(state, majorityLeader.x, majorityLeader.y, 'COMMIT', 82);
    }

    // All remaining requests are fenced cleanly (409 FENCED / 409 STALE_TERM)
    waveFenced = count - waveCommitted;
    for (const node of aliveNodes) {
      const share = regionCounts.get(node.id) ?? 0;
      const isMinority = node.partitionGroup === 'MINORITY';
      const nodeFenced = Math.max(0, share - (node.id === majorityLeader?.id ? waveCommitted : 0));
      node.fencedCount += nodeFenced;

      if (isMinority) {
        waveStaleFenced += share;
        pushHistory(state, {
          region: node.id,
          kind: 'FENCED_409',
          term: node.term,
          latencyMs: Number((1.1 + drawUnit(state) * 1.4).toFixed(1)),
          detail: `FENCED 409 STALE_TERM (node T${node.term} < epoch T${state.fencingEpoch}) — ${share} minority reqs blocked`,
          waveId,
        });
        pushShockwave(state, node.x, node.y, 'FENCE', 62);
      } else if (nodeFenced > 0) {
        const fenceLat =
          engine === 'AEGIS_LUA_WAL'
            ? Number((0.8 + drawUnit(state) * 1.6).toFixed(1))
            : Number((12.4 + drawUnit(state) * 24.5).toFixed(1));
        pushHistory(state, {
          region: node.id,
          kind: 'FENCED_409',
          term: node.term,
          latencyMs: fenceLat,
          detail:
            engine === 'AEGIS_LUA_WAL'
              ? `409 FENCED (Lua quota=0): ${nodeFenced} duplicate concurrent reqs shed`
              : `409 CAS CONFLICT (ROWVERSION mismatch): ${nodeFenced} colliding reqs rejected`,
          waveId,
        });
      }

      // Spawn rich staggered visual storm wave packets (flowing continuously across 1.1s!)
      const visualBurstCount = Math.min(18, Math.max(8, Math.round((share / count) * 72)));
      for (let i = 0; i < visualBurstCount; i++) {
        const target = isMinority
          ? 'REDIS_FENCE'
          : majorityLeader && majorityLeader.id !== node.id && i % 2 === 0
            ? majorityLeader.id
            : engine === 'AEGIS_LUA_WAL'
              ? 'REDIS_FENCE'
              : 'SQL_ROWVERSION';
        spawnPacket(state, {
          kind: 'VOUCHER_FENCED_409',
          from: node.id,
          to: target,
          term: node.term,
          payloadLabel: isMinority ? '409 STALE' : '409 FENCED',
          speedMultiplier: 0.78 + drawUnit(state) * 0.55,
          deflectAtMidpoint: isMinority && i % 2 === 0,
          initialProgress: -(i * 0.055),
        });
      }
    }

    state.metrics.lastStormLatencyP99Ms =
      engine === 'AEGIS_LUA_WAL'
        ? Number((3.4 + drawUnit(state) * 2.1 + jitterPenaltyMs * 0.1).toFixed(1))
        : Number((42.0 + drawUnit(state) * 18.5 + jitterPenaltyMs * 0.5).toFixed(1));
  } else {
    // NAIVE_RMW: Unprotected Read-Modify-Write explodes into concurrent TOCTOU + Split-Brain double-spend leaks!
    const majorityLeaks = drawInt(state, 12, 22);
    const splitBrainExtraLeaks = staleLeader ? drawInt(state, 6, 12) : 0;
    waveCommitted = 1;
    waveLeaks = majorityLeaks + splitBrainExtraLeaks;
    waveFenced = Math.max(0, count - waveCommitted - waveLeaks);

    const anchorLeader = majorityLeader ?? aliveNodes[0];
    anchorLeader.committedCount += 1;
    anchorLeader.commitIndex += 1 + waveLeaks;
    state.rowVersionSeq += 1 + waveLeaks;

    pushHistory(state, {
      region: anchorLeader.id,
      kind: 'COMMITTED_200',
      term: anchorLeader.term,
      latencyMs: Number((14.2 + drawUnit(state) * 9.5).toFixed(1)),
      detail: `Wave #${waveId}: First RMW commit succeeded before TOCTOU race window opened`,
      waveId,
    });

    // Distribute leaks across alive regions (heavily hitting stale leader during split-brain!)
    let remainingLeaks = waveLeaks;
    for (let idx = 0; idx < aliveNodes.length; idx++) {
      const node = aliveNodes[idx];
      const isMinority = node.partitionGroup === 'MINORITY';
      const nodeLeaks =
        idx === aliveNodes.length - 1
          ? remainingLeaks
          : Math.min(
              remainingLeaks,
              isMinority
                ? Math.max(2, Math.round(splitBrainExtraLeaks * 0.65))
                : drawInt(state, 2, 6)
            );
      remainingLeaks -= nodeLeaks;
      node.leakCount += nodeLeaks;
      node.fencedCount += Math.max(0, (regionCounts.get(node.id) ?? 0) - nodeLeaks);

      if (nodeLeaks > 0) {
        const leakLatency = Number((22.0 + drawUnit(state) * 48.0 + jitterPenaltyMs).toFixed(1));
        pushHistory(state, {
          region: node.id,
          kind: 'DOUBLE_SPEND_LEAK',
          term: node.term,
          latencyMs: leakLatency,
          detail: isMinority
            ? `SPLIT-BRAIN DOUBLE-SPEND! Stale ${node.id} (T${node.term}) illegally committed +${nodeLeaks} oversold vouchers`
            : `TOCTOU DOUBLE-SPEND LEAK! ${node.id} oversold +${nodeLeaks} duplicate vouchers (no Lua/CAS lock)`,
          waveId,
        });
        pushShockwave(state, node.x, node.y, 'LEAK', 96);
      }

      // Launch staggered blazing crimson leak packets + shockwaves across the arena
      const crimsonPackets = Math.min(20, Math.max(10, nodeLeaks * 2));
      for (let i = 0; i < crimsonPackets; i++) {
        spawnPacket(state, {
          kind: 'DOUBLE_SPEND_LEAK',
          from: node.id,
          to: i % 2 === 0 ? 'SQL_ROWVERSION' : anchorLeader.id === node.id ? 'REDIS_FENCE' : anchorLeader.id,
          term: node.term,
          payloadLabel: 'LEAK!',
          speedMultiplier: 0.76 + drawUnit(state) * 0.58,
          initialProgress: -(i * 0.048),
        });
      }
    }

    pushShockwave(state, SQL_ROWVERSION_ANCHOR.x, SQL_ROWVERSION_ANCHOR.y, 'LEAK', 105);
    state.metrics.lastStormLatencyP99Ms = Number((88.5 + drawUnit(state) * 42.0 + jitterPenaltyMs).toFixed(1));
  }

  state.metrics.totalVoucherRequests += count;
  state.metrics.committed200 += waveCommitted;
  state.metrics.fenced409 += waveFenced;
  state.metrics.doubleSpendLeaks += waveLeaks;
  state.metrics.staleLeaderFenced += waveStaleFenced;
  state.linearizability = evaluateLinearizability(state.metrics, state.nodes);
  recordSnapshot(state, true);
  return state;
}

// --- Deterministic Seed Replay & Time-Travel Scrubber ---

export function applyRecordedCommand(
  state: DstClusterState,
  cmd: DstRecordedCommand
): DstClusterState {
  switch (cmd.type) {
    case 'TOGGLE_LINK':
      return toggleDstLinkScissors(state, cmd.linkId, true);
    case 'SET_LINK_STATUS':
      return setDstLinkStatus(state, cmd.linkId, cmd.status, true);
    case 'TOGGLE_NODE_CRASH':
      return toggleDstNodeCrash(state, cmd.regionId, true);
    case 'SPLIT_BRAIN_PRESET':
      return applySplitBrainPreset(state, true);
    case 'HEAL_ALL':
      return healAllDstFaults(state, true);
    case 'SET_ENGINE':
      return setDstEngineMode(state, cmd.engine, true);
    case 'BLAST_VOUCHER_STORM':
      return blastVoucherStorm(state, cmd.requestCount, true);
  }
}

export function replayDstSimulation(
  seed: number,
  commands: readonly DstRecordedCommand[],
  targetTickMs: number,
  initialEngine: DstEngineMode = 'AEGIS_LUA_WAL'
): DstClusterState {
  let state = createInitialDstCluster(seed, initialEngine);
  const sorted = [...commands].sort((a, b) => a.tickMs - b.tickMs);
  let cmdIdx = 0;

  // Apply any commands recorded at tick 0
  while (cmdIdx < sorted.length && sorted[cmdIdx].tickMs <= 0) {
    state = applyRecordedCommand(state, sorted[cmdIdx]);
    cmdIdx++;
  }

  const endTick = Math.max(0, Math.round(targetTickMs));
  while (state.tickMs < endTick) {
    const step = Math.min(DST_FIXED_STEP_MS, endTick - state.tickMs);
    state = stepDstCluster(state, step);
    while (cmdIdx < sorted.length && sorted[cmdIdx].tickMs <= state.tickMs) {
      state = applyRecordedCommand(state, sorted[cmdIdx]);
      cmdIdx++;
    }
  }
  return state;
}

export function getSnapshotAtTick(
  snapshots: readonly DstClusterSnapshot[],
  targetTickMs: number
): DstClusterSnapshot | null {
  if (snapshots.length === 0) return null;
  let chosen = snapshots[0];
  for (const snap of snapshots) {
    if (snap.tickMs <= targetTickMs) {
      chosen = snap;
    } else {
      break;
    }
  }
  return chosen;
}

export function deriveNextSeed(currentSeed: number): number {
  const { nextState } = nextPrng(normalizeSeed(currentSeed) ^ 0x9e3779b9);
  return 10000 + (nextState % 89999);
}

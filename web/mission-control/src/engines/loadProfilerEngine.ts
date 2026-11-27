import type { ChaosLoadMultipliers, ClusterTopologyState } from './chaosEngine';
import { computeChaosLoadMultipliers } from './chaosEngine';

export const MIN_STRESS_RPS = 10000;
export const MAX_STRESS_RPS = 250000;
export const SLO_P99_TARGET_MS = 45;

export type RuntimeProfilerMode = 'dotnet10' | 'go124';
export type FlameLayer = 'ingress' | 'middleware' | 'cache' | 'data' | 'gc' | 'wal';

export interface FlameFrame {
  id: string;
  name: string;
  runtimeLabel: string;
  layer: FlameLayer;
  totalMs: number;
  selfMs: number;
  pctOfTotal: number;
  allocKb: number;
  tip: string;
  children: FlameFrame[];
}

export interface FlattenedFlameRect {
  frame: FlameFrame;
  depth: number;
  xPct: number;
  widthPct: number;
  isFocused: boolean;
}

export interface LatencyCurvePoint {
  rps: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  saturationPct: number;
  hpaPods: number;
}

export interface GcPauseProfile {
  runtimeName: string;
  minorPauseMs: number;
  majorStwPauseMs: number;
  p99GcPauseMs: number;
  allocRateMbPerSec: number;
  pauseFrequencyPerMin: number;
  heapUtilizationPct: number;
}

export interface LoadStressTelemetry {
  targetRps: number;
  effectiveThroughputRps: number;
  droppedRps: number;
  runtime: RuntimeProfilerMode;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  sloTargetP99Ms: number;
  sloBreached: boolean;
  throughputSaturationPct: number;
  hpaPodsMin: number;
  hpaPodsMax: number;
  hpaPodsCurrent: number;
  hpaPodsDesired: number;
  cpuUtilizationPct: number;
  sloErrorBudgetRemainingPct: number;
  monthlyBudgetMinutesLeft: number;
  gcProfile: GcPauseProfile;
  latencyCurve: LatencyCurvePoint[];
  flamegraphRoot: FlameFrame;
  topHotspots: FlameFrame[];
}

export function clampStressRps(rps: number): number {
  if (!Number.isFinite(rps)) return MIN_STRESS_RPS;
  return Math.max(MIN_STRESS_RPS, Math.min(MAX_STRESS_RPS, Math.round(rps)));
}

const NOMINAL_MULTIPLIERS: ChaosLoadMultipliers = {
  latencyAdderMs: 0,
  latencyMultiplier: 1,
  gcPressureMultiplier: 1,
  errorRateAdderPct: 0,
  capacityFactor: 1,
};

export function computePointMetrics(
  rawRps: number,
  runtime: RuntimeProfilerMode,
  multipliers: ChaosLoadMultipliers = NOMINAL_MULTIPLIERS
): {
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  saturationPct: number;
  effectiveThroughputRps: number;
  droppedRps: number;
  hpaPodsCurrent: number;
  hpaPodsDesired: number;
  cpuUtilizationPct: number;
} {
  const rps = clampStressRps(rawRps);
  const baseClusterCapacity = runtime === 'dotnet10' ? 235000 : 228000;
  const effectiveCapacity = Math.max(45000, baseClusterCapacity * multipliers.capacityFactor);
  const loadRatio = rps / effectiveCapacity;
  const saturationPct = Number(Math.min(100, loadRatio * 100).toFixed(1));

  // Queuing-theory knee curve (sub-linear under 70% load, sharp exponential tail past 85%)
  const queueFactor =
    loadRatio < 0.72
      ? 1 + loadRatio * 0.65
      : 1.468 + Math.pow(loadRatio - 0.72, 1.85) * 14.5;

  const runtimeBaseP50 = runtime === 'dotnet10' ? 2.4 : 2.7;
  const runtimeBaseP95 = runtime === 'dotnet10' ? 6.2 : 6.8;
  const runtimeBaseP99 = runtime === 'dotnet10' ? 9.8 : 10.6;

  const p50Ms = Number(
    (runtimeBaseP50 * queueFactor * multipliers.latencyMultiplier + multipliers.latencyAdderMs * 0.35).toFixed(2)
  );
  const p95Ms = Number(
    (runtimeBaseP95 * Math.pow(queueFactor, 1.15) * multipliers.latencyMultiplier + multipliers.latencyAdderMs * 0.72).toFixed(2)
  );
  const p99Ms = Number(
    (runtimeBaseP99 * Math.pow(queueFactor, 1.28) * multipliers.latencyMultiplier + multipliers.latencyAdderMs).toFixed(2)
  );

  // Throughput capping past 96% cluster saturation
  const maxDeliverable = Math.round(effectiveCapacity * 0.985);
  const effectiveThroughputRps = rps <= maxDeliverable ? rps : maxDeliverable;
  const droppedRps = Math.max(0, rps - effectiveThroughputRps);

  // K8s HPA Pod Autoscaling (target 65% CPU, ~2,400 RPS/pod nominal)
  const hpaPodsMin = 6;
  const hpaPodsMax = 128;
  const rpsPerPod = (runtime === 'dotnet10' ? 2450 : 2380) / Math.sqrt(multipliers.latencyMultiplier);
  const hpaPodsDesired = Math.max(
    hpaPodsMin,
    Math.min(hpaPodsMax, Math.ceil(rps / rpsPerPod))
  );
  // Current pods trail slightly during sudden spikes above 140K RPS
  const scaleLag = rps > 140000 ? Math.min(8, Math.floor((rps - 140000) / 18000)) : 0;
  const hpaPodsCurrent = Math.max(hpaPodsMin, hpaPodsDesired - scaleLag);

  const cpuUtilizationPct = Number(
    Math.min(
      99.4,
      Math.max(18, (rps / (hpaPodsCurrent * rpsPerPod)) * 65 + (multipliers.gcPressureMultiplier - 1) * 18)
    ).toFixed(1)
  );

  return {
    p50Ms,
    p95Ms,
    p99Ms,
    saturationPct,
    effectiveThroughputRps,
    droppedRps,
    hpaPodsCurrent,
    hpaPodsDesired,
    cpuUtilizationPct,
  };
}

function roundMs(n: number): number {
  return Number(Math.max(0.05, n).toFixed(2));
}

function buildFlamegraphTree(
  totalMs: number,
  runtime: RuntimeProfilerMode,
  loadRatio: number,
  multipliers: ChaosLoadMultipliers,
  gcStwMs: number,
  chaosState?: ClusterTopologyState
): FlameFrame {
  const stampedeBoost = chaosState?.faults.redisCacheStampede ? 1.85 : 1.0;
  const dbExhaustBoost = chaosState?.faults.dbConnectionExhaustion ? 2.4 : 1.0;
  const tailBoost = chaosState?.faults.tailLatency180Ms ? 1.45 : 1.0;

  // Allocate frame budgets cleanly so children sum <= parent totalMs
  const gcBranchMs = Math.min(totalMs * 0.24, Math.max(0.45, gcStwMs * 0.85));
  const middlewareMs = roundMs(totalMs * 0.17);
  const ingressSelfMs = roundMs(totalMs * 0.06);
  const controllerTotalMs = roundMs(Math.max(1.0, totalMs - middlewareMs - gcBranchMs - ingressSelfMs));

  // Middleware children
  const jwtMs = roundMs(middlewareMs * 0.42);
  const limiterMs = roundMs(middlewareMs * 0.24);
  const otelMs = roundMs(middlewareMs * 0.2);
  const middlewareSelfMs = roundMs(Math.max(0.08, middlewareMs - jwtMs - limiterMs - otelMs));

  // Controller children weights adjusted by chaos profile
  const wIdem = 0.08;
  const wRedis = 0.28 * stampedeBoost;
  const wDapper = 0.46 * dbExhaustBoost * tailBoost;
  const wWal = 0.1;
  const wSum = wIdem + wRedis + wDapper + wWal;

  const availCtrl = controllerTotalMs * 0.92;
  const idemMs = roundMs(availCtrl * (wIdem / wSum));
  const redisTotalMs = roundMs(availCtrl * (wRedis / wSum));
  const dapperTotalMs = roundMs(availCtrl * (wDapper / wSum));
  const walMs = roundMs(availCtrl * (wWal / wSum));
  const ctrlSelfMs = roundMs(Math.max(0.1, controllerTotalMs - idemMs - redisTotalMs - dapperTotalMs - walMs));

  // Redis Lua Lock children
  const luaEvalMs = roundMs(redisTotalMs * 0.56);
  const respFlushMs = roundMs(redisTotalMs * 0.34);
  const redisSelfMs = roundMs(Math.max(0.05, redisTotalMs - luaEvalMs - respFlushMs));

  // Dapper QueryAsync children
  const sqlReplicaMs = roundMs(dapperTotalMs * 0.54);
  const casCheckMs = roundMs(dapperTotalMs * 0.26);
  const tdsMatMs = roundMs(dapperTotalMs * 0.12);
  const dapperSelfMs = roundMs(Math.max(0.06, dapperTotalMs - sqlReplicaMs - casCheckMs - tdsMatMs));

  // GC Pause children
  const gcSweepMs = roundMs(gcBranchMs * 0.58);
  const gcSafepointMs = roundMs(gcBranchMs * 0.34);
  const gcSelfMs = roundMs(Math.max(0.05, gcBranchMs - gcSweepMs - gcSafepointMs));

  const pct = (ms: number) => Number(((ms / Math.max(0.1, totalMs)) * 100).toFixed(1));
  const allocScale = Number((1 + loadRatio * 0.9 * multipliers.gcPressureMultiplier).toFixed(2));

  const isDotnet = runtime === 'dotnet10';

  const root: FlameFrame = {
    id: 'root-ingress',
    name: isDotnet ? 'Kestrel HTTP/3 Ingress' : 'Go Fiber HTTP/3 Ingress',
    runtimeLabel: isDotnet ? '.NET 10 Kestrel QUIC' : 'Go 1.24 net/http3',
    layer: 'ingress',
    totalMs: roundMs(totalMs),
    selfMs: ingressSelfMs,
    pctOfTotal: 100,
    allocKb: Number((1.4 * allocScale).toFixed(1)),
    tip: 'Zero-allocation HTTP/3 QUIC frame parser with pooled PipeReader buffers.',
    children: [
      {
        id: 'middleware',
        name: 'Middleware Pipeline',
        runtimeLabel: 'Auth + RateLimit + OTel',
        layer: 'middleware',
        totalMs: middlewareMs,
        selfMs: middlewareSelfMs,
        pctOfTotal: pct(middlewareMs),
        allocKb: Number((2.2 * allocScale).toFixed(1)),
        tip: 'Short-circuits unauthenticated and rate-limited bursts before allocating downstream sockets.',
        children: [
          {
            id: 'mw-jwt',
            name: 'Keycloak Ed25519 Verify',
            runtimeLabel: 'JWKS Cached KeyRing',
            layer: 'middleware',
            totalMs: jwtMs,
            selfMs: jwtMs,
            pctOfTotal: pct(jwtMs),
            allocKb: Number((0.8 * allocScale).toFixed(1)),
            tip: 'Signature verified in-memory via cached JWKS public key (0 network hops).',
            children: [],
          },
          {
            id: 'mw-limiter',
            name: 'Token-Bucket Guard',
            runtimeLabel: 'Lock-Free Interlocked',
            layer: 'middleware',
            totalMs: limiterMs,
            selfMs: limiterMs,
            pctOfTotal: pct(limiterMs),
            allocKb: 0.2,
            tip: 'Atomic token bucket enforces per-tenant burst ceiling with sub-50us overhead.',
            children: [],
          },
          {
            id: 'mw-otel',
            name: 'W3C TraceContext Span',
            runtimeLabel: 'OpenTelemetry Tail-Sample',
            layer: 'middleware',
            totalMs: otelMs,
            selfMs: otelMs,
            pctOfTotal: pct(otelMs),
            allocKb: 0.5,
            tip: 'Zero-alloc ActivitySource spans retained 100% on >P95 tail or HTTP >=400.',
            children: [],
          },
        ],
      },
      {
        id: 'controller',
        name: isDotnet ? 'Dapper QueryAsync + Lock Flow' : 'pgx QueryRow + Lock Flow',
        runtimeLabel: isDotnet ? 'AegisCheckoutKernel.AllocateAsync' : 'aegis.Kernel.AllocateCtx',
        layer: 'data',
        totalMs: controllerTotalMs,
        selfMs: ctrlSelfMs,
        pctOfTotal: pct(controllerTotalMs),
        allocKb: Number((6.8 * allocScale).toFixed(1)),
        tip: 'Core hot-path orchestrating SHA-256 idempotency, Redis Lua atomic quota, and Dapper ReadReplica.',
        children: [
          {
            id: 'ctrl-idem',
            name: 'Idempotency SHA-256 Guard',
            runtimeLabel: 'RFC Payload Hash',
            layer: 'cache',
            totalMs: idemMs,
            selfMs: idemMs,
            pctOfTotal: pct(idemMs),
            allocKb: 0.6,
            tip: 'Rejects mutated replay payloads with HTTP 409 Conflict before touching inventory.',
            children: [],
          },
          {
            id: 'redis-lua',
            name: 'Redis Lua Lock (EVALSHA)',
            runtimeLabel: 'Single-Threaded Atomic Script',
            layer: 'cache',
            totalMs: redisTotalMs,
            selfMs: redisSelfMs,
            pctOfTotal: pct(redisTotalMs),
            allocKb: Number((1.9 * allocScale).toFixed(1)),
            tip: chaosState?.faults.redisCacheStampede
              ? 'HOTSPOT: Cache stampede elevated Redis Lua queue depth. Enable XFetch early refresh + singleflight.'
              : 'Atomic Lua script checks stock & decrements quota in 1 RTT without distributed lock races.',
            children: [
              {
                id: 'redis-evalsha',
                name: 'Atomic Quota Check',
                runtimeLabel: 'Lua VM Register Exec',
                layer: 'cache',
                totalMs: luaEvalMs,
                selfMs: luaEvalMs,
                pctOfTotal: pct(luaEvalMs),
                allocKb: 0.4,
                tip: 'Guarantees mathematically zero double-spend under 250K RPS flash-sale contention.',
                children: [],
              },
              {
                id: 'redis-resp3',
                name: 'RESP3 Multiplex Socket',
                runtimeLabel: 'Pipelined Ring Buffer',
                layer: 'cache',
                totalMs: respFlushMs,
                selfMs: respFlushMs,
                pctOfTotal: pct(respFlushMs),
                allocKb: 0.7,
                tip: 'Batched socket flush amortizes kernel syscall cost across concurrent callers.',
                children: [],
              },
            ],
          },
          {
            id: 'dapper-query',
            name: isDotnet ? 'Dapper QueryAsync' : 'pgx Pool QueryAsync',
            runtimeLabel: isDotnet ? 'Micro-ORM Zero-Tracker' : 'Binary Wire Protocol',
            layer: 'data',
            totalMs: dapperTotalMs,
            selfMs: dapperSelfMs,
            pctOfTotal: pct(dapperTotalMs),
            allocKb: Number((3.4 * allocScale).toFixed(1)),
            tip: chaosState?.faults.dbConnectionExhaustion
              ? 'CRITICAL HOTSPOT: SQL connection pool saturated (99.2%). Circuit breaker shedding 503 fast-fail.'
              : 'Dapper bypasses EF Core ChangeTracker (-85% RAM, 5x faster row materialization).',
            children: [
              {
                id: 'sql-replica',
                name: 'SQL ReadReplica Pool',
                runtimeLabel: 'Keyset Seek + NOLOCK',
                layer: 'data',
                totalMs: sqlReplicaMs,
                selfMs: sqlReplicaMs,
                pctOfTotal: pct(sqlReplicaMs),
                allocKb: Number((1.8 * allocScale).toFixed(1)),
                tip: 'Routes read-heavy SKU lookups to local-region ReadReplica with covering index seek.',
                children: [],
              },
              {
                id: 'sql-cas',
                name: 'RowVersion CAS Guard',
                runtimeLabel: 'Optimistic Concurrency',
                layer: 'data',
                totalMs: casCheckMs,
                selfMs: casCheckMs,
                pctOfTotal: pct(casCheckMs),
                allocKb: 0.5,
                tip: 'Verifies rowversion token without acquiring long-held pessimistic table locks.',
                children: [],
              },
              {
                id: 'sql-tds',
                name: 'TDS DTO Materializer',
                runtimeLabel: 'IL Emit Struct Reader',
                layer: 'data',
                totalMs: tdsMatMs,
                selfMs: tdsMatMs,
                pctOfTotal: pct(tdsMatMs),
                allocKb: 0.9,
                tip: 'Pre-compiled IL delegate hydrates flat C# record DTOs directly from IDataReader.',
                children: [],
              },
            ],
          },
          {
            id: 'wal-channel',
            name: isDotnet ? 'Channel<T> WAL Enqueue' : 'Buffered Chan WAL',
            runtimeLabel: 'Bounded Write-Behind',
            layer: 'wal',
            totalMs: walMs,
            selfMs: walMs,
            pctOfTotal: pct(walMs),
            allocKb: 0.3,
            tip: 'Decouples checkout P99 from async ledger flush using backpressured lock-free ring queue.',
            children: [],
          },
        ],
      },
      {
        id: 'gc-pause',
        name: isDotnet ? '.NET Server GC Pause' : 'Go STW GC Mark Assist',
        runtimeLabel: isDotnet ? 'DATAS Gen2 / Ephemeral' : 'Concurrent Tri-Color Sweep',
        layer: 'gc',
        totalMs: roundMs(gcBranchMs),
        selfMs: gcSelfMs,
        pctOfTotal: pct(gcBranchMs),
        allocKb: 0,
        tip: 'Reduce LOH allocations via ArrayPool<byte>.Shared and stackalloc spans to keep STW pauses sub-3ms.',
        children: [
          {
            id: 'gc-sweep',
            name: isDotnet ? 'Gen2 Background Sweep' : 'Heap Mark Termination',
            runtimeLabel: 'Memory Reclamation',
            layer: 'gc',
            totalMs: gcSweepMs,
            selfMs: gcSweepMs,
            pctOfTotal: pct(gcSweepMs),
            allocKb: 0,
            tip: 'Tracks survivor promotion pressure under elevated RPS and cache miss bursts.',
            children: [],
          },
          {
            id: 'gc-safepoint',
            name: 'Thread Safepoint Suspend',
            runtimeLabel: 'STW Barrier Sync',
            layer: 'gc',
            totalMs: gcSafepointMs,
            selfMs: gcSafepointMs,
            pctOfTotal: pct(gcSafepointMs),
            allocKb: 0,
            tip: 'Stop-the-world suspension directly adds to P99 tail spikes if allocation rate exceeds 1.8 GB/s.',
            children: [],
          },
        ],
      },
    ],
  };

  return root;
}

export function findFlameFrameById(root: FlameFrame, id: string): FlameFrame | null {
  if (root.id === id) return root;
  for (const child of root.children) {
    const hit = findFlameFrameById(child, id);
    if (hit) return hit;
  }
  return null;
}

export function getFlameBreadcrumbs(root: FlameFrame, targetId: string): FlameFrame[] {
  if (root.id === targetId) return [root];
  for (const child of root.children) {
    const subPath = getFlameBreadcrumbs(child, targetId);
    if (subPath.length > 0) {
      return [root, ...subPath];
    }
  }
  return [];
}

export function flattenFlamegraphLayout(
  root: FlameFrame,
  focusId?: string
): FlattenedFlameRect[] {
  const target = focusId ? findFlameFrameById(root, focusId) ?? root : root;
  const baseTotal = Math.max(0.01, target.totalMs);
  const rects: FlattenedFlameRect[] = [];

  function walk(node: FlameFrame, depth: number, xPct: number, parentWidthPct: number) {
    const widthPct = Math.max(2.5, Math.min(100 - xPct, parentWidthPct));
    rects.push({
      frame: node,
      depth,
      xPct: Number(xPct.toFixed(2)),
      widthPct: Number(widthPct.toFixed(2)),
      isFocused: node.id === target.id,
    });

    if (node.children.length === 0) return;
    const childSum = node.children.reduce((s, c) => s + c.totalMs, 0);
    const scaleBase = Math.max(node.totalMs, childSum, 0.01);
    let cursorX = xPct;
    for (const child of node.children) {
      const childW = (child.totalMs / scaleBase) * widthPct;
      if (childW >= 1.2) {
        walk(child, depth + 1, cursorX, childW);
        cursorX += childW;
      }
    }
  }

  walk(target, 0, 0, (target.totalMs / baseTotal) * 100);
  return rects;
}

export function extractFlameHotspots(root: FlameFrame, limit = 6): FlameFrame[] {
  const all: FlameFrame[] = [];
  function collect(node: FlameFrame) {
    all.push(node);
    for (const c of node.children) collect(c);
  }
  collect(root);
  return all.sort((a, b) => b.selfMs - a.selfMs).slice(0, limit);
}

export function simulateLoadStressProfile(
  rawRps: number,
  runtime: RuntimeProfilerMode = 'dotnet10',
  chaosState?: ClusterTopologyState
): LoadStressTelemetry {
  const targetRps = clampStressRps(rawRps);
  const multipliers = chaosState
    ? computeChaosLoadMultipliers(chaosState)
    : NOMINAL_MULTIPLIERS;

  const point = computePointMetrics(targetRps, runtime, multipliers);

  // Build 13-point curve from 10K to 250K RPS (every 20K step)
  const latencyCurve: LatencyCurvePoint[] = [];
  for (let r = MIN_STRESS_RPS; r <= MAX_STRESS_RPS; r += 20000) {
    const m = computePointMetrics(r, runtime, multipliers);
    latencyCurve.push({
      rps: r,
      p50Ms: m.p50Ms,
      p95Ms: m.p95Ms,
      p99Ms: m.p99Ms,
      saturationPct: m.saturationPct,
      hpaPods: m.hpaPodsDesired,
    });
  }

  // GC Pause profiler math
  const loadRatio = targetRps / MAX_STRESS_RPS;
  const isDotnet = runtime === 'dotnet10';
  const minorPauseMs = Number(
    ((isDotnet ? 0.42 : 0.36) * (1 + loadRatio * 1.4) * multipliers.gcPressureMultiplier).toFixed(2)
  );
  const majorStwPauseMs = Number(
    ((isDotnet ? 1.85 : 2.25) * (1 + Math.pow(loadRatio, 1.6) * 3.8) * multipliers.gcPressureMultiplier).toFixed(2)
  );
  const p99GcPauseMs = Number((majorStwPauseMs * 1.38).toFixed(2));
  const allocRateMbPerSec = Math.round(
    (targetRps / 1000) * (isDotnet ? 6.4 : 7.1) * multipliers.gcPressureMultiplier
  );
  const pauseFrequencyPerMin = Math.round(
    (isDotnet ? 6 : 9) + loadRatio * 34 * multipliers.gcPressureMultiplier
  );
  const heapUtilizationPct = Number(
    Math.min(96.5, 32 + loadRatio * 46 * multipliers.gcPressureMultiplier).toFixed(1)
  );

  // SLO Error Budget Remaining (99.99% 30-day = 4.32 min allowance)
  const latencyPenalty = point.p99Ms > SLO_P99_TARGET_MS ? (point.p99Ms - SLO_P99_TARGET_MS) * 0.42 : 0;
  const dropPenalty = (point.droppedRps / Math.max(1, targetRps)) * 140;
  const chaosPenalty = multipliers.errorRateAdderPct * 1.65;
  const sloErrorBudgetRemainingPct = Number(
    Math.max(0, Math.min(100, 99.6 - latencyPenalty - dropPenalty - chaosPenalty)).toFixed(1)
  );
  const monthlyBudgetMinutesLeft = Number(((sloErrorBudgetRemainingPct / 100) * 4.32).toFixed(2));

  const flamegraphRoot = buildFlamegraphTree(
    point.p99Ms,
    runtime,
    loadRatio,
    multipliers,
    p99GcPauseMs,
    chaosState
  );
  const topHotspots = extractFlameHotspots(flamegraphRoot, 6);

  return {
    targetRps,
    effectiveThroughputRps: point.effectiveThroughputRps,
    droppedRps: point.droppedRps,
    runtime,
    p50Ms: point.p50Ms,
    p95Ms: point.p95Ms,
    p99Ms: point.p99Ms,
    sloTargetP99Ms: SLO_P99_TARGET_MS,
    sloBreached: point.p99Ms > SLO_P99_TARGET_MS || point.droppedRps > 0,
    throughputSaturationPct: point.saturationPct,
    hpaPodsMin: 6,
    hpaPodsMax: 128,
    hpaPodsCurrent: point.hpaPodsCurrent,
    hpaPodsDesired: point.hpaPodsDesired,
    cpuUtilizationPct: point.cpuUtilizationPct,
    sloErrorBudgetRemainingPct,
    monthlyBudgetMinutesLeft,
    gcProfile: {
      runtimeName: isDotnet ? '.NET 10 Server GC (DATAS)' : 'Go 1.24 Concurrent GC',
      minorPauseMs,
      majorStwPauseMs,
      p99GcPauseMs,
      allocRateMbPerSec,
      pauseFrequencyPerMin,
      heapUtilizationPct,
    },
    latencyCurve,
    flamegraphRoot,
    topHotspots,
  };
}

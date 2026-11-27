export type VoucherArchitectureMode =
  | 'naive'
  | 'pessimistic'
  | 'concung-lua-rowversion';

export type VoucherLaneOutcome = 'APPROVED' | 'DOUBLE_SPEND_LEAK' | 'REJECTED_409';

export interface VoucherRaceConfig {
  mode: VoucherArchitectureMode;
  concurrentRequests?: number;
  voucherStock?: number;
  voucherFaceValueVnd?: number;
  retailStoreCount?: number;
  voucherCode?: string;
  seed?: number;
}

export interface VoucherArchitectureMeta {
  mode: VoucherArchitectureMode;
  shortName: string;
  title: string;
  badge: string;
  sqlPattern: string;
  summary: string;
  summaryVi: string;
  tone: 'rose' | 'amber' | 'emerald';
}

export interface VoucherRequestLane {
  laneIndex: number;
  requestNumber: number;
  requestId: string;
  storeCode: string;
  idempotencyKey: string;
  startOffsetMs: number;
  redisGateMs: number;
  lockWaitMs: number;
  sqlWriteMs: number;
  totalMs: number;
  httpStatus: 200 | 409;
  outcome: VoucherLaneOutcome;
  rowVersionToken: string;
}

export interface VoucherLatencyBin {
  bucketIndex: number;
  minMs: number;
  maxMs: number;
  label: string;
  count: number;
  percentage: number;
  hasP50: boolean;
  hasP95: boolean;
  hasP99: boolean;
}

export interface VoucherFinancialImpact {
  voucherFaceValueVnd: number;
  retailStoreCount: number;
  singleVoucherLeakVnd: number;
  projected700StoreExposureVnd: number;
  leakageSavedVsNaiveVnd: number;
}

export interface VoucherRaceResult {
  mode: VoucherArchitectureMode;
  architecture: VoucherArchitectureMeta;
  voucherCode: string;
  voucherStock: number;
  totalRequests: number;
  seed: number;
  legitimateApprovedCount: number;
  doubleSpentCount: number;
  totalApproved200Count: number;
  rejected409Count: number;
  doubleSpendRatePct: number;
  invariantIntact: boolean;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  avgMs: number;
  maxMs: number;
  throughputRps: number;
  dbCpuPct: number;
  sqlQueriesExecuted: number;
  redisEdgeRejections: number;
  peakLockQueueDepth: number;
  financial: VoucherFinancialImpact;
  histogram: VoucherLatencyBin[];
  lanes: VoucherRequestLane[];
}

export interface VoucherThreeWayComparison {
  naive: VoucherRaceResult;
  pessimistic: VoucherRaceResult;
  concung: VoucherRaceResult;
  financialSavedSingleCampaignVnd: number;
  financialSaved700StoresVnd: number;
  p99SpeedupVsPessimistic: number;
  throughputMultiplierVsPessimistic: number;
}

export const DEFAULT_VOUCHER_CODE = 'CONCUNG-VIP-500K';
export const DEFAULT_CONCURRENT_REQUESTS = 500;
export const DEFAULT_VOUCHER_STOCK = 1;
export const DEFAULT_VOUCHER_FACE_VALUE_VND = 500_000;
export const DEFAULT_RETAIL_STORE_COUNT = 700;
export const DEFAULT_SIMULATION_SEED = 20261128;

export const VOUCHER_ARCHITECTURES: Record<VoucherArchitectureMode, VoucherArchitectureMeta> = {
  naive: {
    mode: 'naive',
    shortName: 'Naive Read-Check-Write',
    title: 'Naive Read-Check-Write (No Lock)',
    badge: 'TOCTOU LEAK',
    sqlPattern: 'SELECT Stock FROM Vouchers -> app check -> UPDATE Vouchers SET Stock = Stock - 1',
    summary:
      'Classic TOCTOU anti-pattern: parallel checkout threads read Stock = 1 simultaneously before any write commits, leaking 14-38 double-spent vouchers.',
    summaryVi:
      'Phan mau TOCTOU dien hinh: nhieu luong doc Stock = 1 cung luc truoc khi ghi commit, ro ri 14-38 luot doi voucher trung lap.',
    tone: 'rose',
  },
  pessimistic: {
    mode: 'pessimistic',
    shortName: 'SQL Pessimistic UPDLOCK',
    title: 'SQL Pessimistic Row Lock (UPDLOCK)',
    badge: 'LOCK CONTENTION',
    sqlPattern: 'BEGIN TRAN; SELECT Stock FROM Vouchers WITH (UPDLOCK, ROWLOCK, HOLDLOCK); UPDATE ...; COMMIT;',
    summary:
      'Eliminates double-spending via serialized row locking, but queues 499 waiting SPIDs on SQL Server: p99 spikes to ~640ms and DB CPU saturates at 94%.',
    summaryVi:
      'Triet tieu doi trung bang khoa dong tuan tu, nhung xep hang 499 ket noi tren SQL Server: p99 tang len ~640ms va CPU DB cham 94%.',
    tone: 'amber',
  },
  'concung-lua-rowversion': {
    mode: 'concung-lua-rowversion',
    shortName: 'Con Cung Production Pattern',
    title: 'Con Cung Pattern (Redis Lua + ROWVERSION + Dapper)',
    badge: '5,200+ RPS · 0% LEAK',
    sqlPattern: 'Redis EVALSHA atomic gate + Dapper UPDATE ... WHERE Remaining >= 1 AND RowVer = @Ver',
    summary:
      'Single-threaded Redis Lua gate sheds 499 losing requests in sub-millisecond memory while SQL Server ROWVERSION + Dapper commits the sole winner: 0.00% leak, p99 38ms, 5,200+ RPS.',
    summaryVi:
      'Cong Redis Lua don luong chan 499 request thua ngay tren RAM (<1ms) trong khi SQL Server ROWVERSION + Dapper ghi duy nhat 1 giao dich hop le: 0.00% ro ri, p99 38ms, 5.200+ RPS.',
    tone: 'emerald',
  },
};

function createSeededRng(seed: number): () => number {
  let state = (seed >>> 0) || 1;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function round1(val: number): number {
  return Math.round(val * 10) / 10;
}

function round2(val: number): number {
  return Math.round(val * 100) / 100;
}

function clampInt(val: number | undefined, fallback: number, min: number, max: number): number {
  if (typeof val !== 'number' || !Number.isFinite(val)) return fallback;
  return Math.min(max, Math.max(min, Math.round(val)));
}

function percentileFromSorted(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * p) - 1));
  return sorted[idx];
}

export function formatVndCurrency(amountVnd: number): string {
  const safe = Math.max(0, Math.round(Number.isFinite(amountVnd) ? amountVnd : 0));
  return `${safe.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.')} VND`;
}

export function formatVndCompact(amountVnd: number): string {
  const safe = Math.max(0, Math.round(Number.isFinite(amountVnd) ? amountVnd : 0));
  if (safe >= 1_000_000_000) {
    return `${(safe / 1_000_000_000).toFixed(2)}B VND`;
  }
  if (safe >= 1_000_000) {
    return `${(safe / 1_000_000).toFixed(1)}M VND`;
  }
  return formatVndCurrency(safe);
}

export function buildVoucherLatencyHistogram(
  latenciesMs: number[],
  p50Ms: number,
  p95Ms: number,
  p99Ms: number,
  bucketCount = 12
): VoucherLatencyBin[] {
  if (latenciesMs.length === 0) return [];

  let minVal = latenciesMs[0];
  let maxVal = latenciesMs[0];
  for (let i = 1; i < latenciesMs.length; i++) {
    if (latenciesMs[i] < minVal) minVal = latenciesMs[i];
    if (latenciesMs[i] > maxVal) maxVal = latenciesMs[i];
  }

  const span = Math.max(1, maxVal - minVal);
  const step = span / bucketCount;
  const counts = new Array<number>(bucketCount).fill(0);

  for (const val of latenciesMs) {
    const rawIdx = Math.floor((val - minVal) / step);
    const idx = Math.min(bucketCount - 1, Math.max(0, rawIdx));
    counts[idx]++;
  }

  const total = latenciesMs.length;
  const clampBucket = (val: number) =>
    Math.min(bucketCount - 1, Math.max(0, Math.floor((val - minVal) / step)));

  const p50Idx = clampBucket(p50Ms);
  const p95Idx = clampBucket(p95Ms);
  const p99Idx = clampBucket(p99Ms);

  return counts.map((count, i) => {
    const bMin = round1(minVal + i * step);
    const bMax = round1(minVal + (i + 1) * step);
    return {
      bucketIndex: i,
      minMs: bMin,
      maxMs: bMax,
      label: `${bMin.toFixed(0)}-${bMax.toFixed(0)}ms`,
      count,
      percentage: round1((count / total) * 100),
      hasP50: i === p50Idx,
      hasP95: i === p95Idx,
      hasP99: i === p99Idx,
    };
  });
}

function computeNaiveBaselineLeak(
  totalRequests: number,
  voucherStock: number,
  voucherFaceValueVnd: number,
  retailStoreCount: number,
  seed: number
): { doubleSpentCount: number; singleVoucherLeakVnd: number; projected700StoreExposureVnd: number } {
  const rng = createSeededRng(seed ^ 0x9e3779b9);
  // Scales cleanly so at 500 concurrent requests & stock=1, double-spend is guaranteed in [14, 38]
  const baseMin = Math.min(totalRequests - voucherStock, Math.max(1, Math.round(totalRequests * 0.032)));
  const baseMax = Math.min(totalRequests - voucherStock, Math.max(baseMin, Math.round(totalRequests * 0.072)));
  const scaledMin = totalRequests === 500 && voucherStock === 1 ? 14 : baseMin;
  const scaledMax = totalRequests === 500 && voucherStock === 1 ? 38 : baseMax;
  const doubleSpentCount = Math.min(
    Math.max(0, totalRequests - voucherStock),
    scaledMin + Math.floor(rng() * (scaledMax - scaledMin + 1))
  );
  const singleVoucherLeakVnd = doubleSpentCount * voucherFaceValueVnd;
  const projected700StoreExposureVnd = singleVoucherLeakVnd * retailStoreCount;
  return { doubleSpentCount, singleVoucherLeakVnd, projected700StoreExposureVnd };
}

export function runVoucherRaceSimulation(config: VoucherRaceConfig): VoucherRaceResult {
  const mode = config.mode;
  const totalRequests = clampInt(config.concurrentRequests, DEFAULT_CONCURRENT_REQUESTS, 50, 2000);
  const voucherStock = clampInt(config.voucherStock, DEFAULT_VOUCHER_STOCK, 1, Math.max(1, totalRequests - 1));
  const voucherFaceValueVnd = clampInt(config.voucherFaceValueVnd, DEFAULT_VOUCHER_FACE_VALUE_VND, 50_000, 5_000_000);
  const retailStoreCount = clampInt(config.retailStoreCount, DEFAULT_RETAIL_STORE_COUNT, 10, 2000);
  const voucherCode = (config.voucherCode?.trim() || DEFAULT_VOUCHER_CODE).toUpperCase();
  const seed = clampInt(config.seed, DEFAULT_SIMULATION_SEED, 1, 2_147_483_647);

  const rng = createSeededRng(seed + (mode === 'naive' ? 11 : mode === 'pessimistic' ? 29 : 53));
  const naiveRef = computeNaiveBaselineLeak(totalRequests, voucherStock, voucherFaceValueVnd, retailStoreCount, seed);

  const legitimateApprovedCount = Math.min(voucherStock, totalRequests);
  const doubleSpentCount = mode === 'naive' ? naiveRef.doubleSpentCount : 0;
  const totalApproved200Count = legitimateApprovedCount + doubleSpentCount;
  const rejected409Count = Math.max(0, totalRequests - totalApproved200Count);
  const doubleSpendRatePct = round2((doubleSpentCount / totalRequests) * 100);
  const invariantIntact = doubleSpentCount === 0 && totalApproved200Count === legitimateApprovedCount;

  // Generate realistic per-request latencies across all N concurrent contenders
  const latenciesMs: number[] = new Array<number>(totalRequests);
  for (let i = 0; i < totalRequests; i++) {
    const u = (i + 0.5) / totalRequests;
    const jitter = (rng() - 0.5) * 0.12;

    if (mode === 'naive') {
      // Unprotected DB read+write bursts: fast reads then write pileup
      const base = 9 + Math.pow(u, 1.9) * 106;
      latenciesMs[i] = round1(Math.max(4.2, base * (1 + jitter)));
    } else if (mode === 'pessimistic') {
      // Serialized SQL Server UPDLOCK queue: linear lock convoy -> p50 ~270ms, p95 ~560ms, p99 ~640ms
      const queueDelay = 16 + Math.pow(u, 1.15) * 628;
      latenciesMs[i] = round1(Math.max(12.0, queueDelay * (1 + jitter * 0.45)));
    } else {
      // Con Cung Pattern: 99.8% rejected in Redis Lua (< 1.5ms-18ms), winning + tail requests <= 38ms p99
      const tailShape = u < 0.85 ? 2.4 + Math.pow(u / 0.85, 1.35) * 14.5 : 17 + Math.pow((u - 0.85) / 0.15, 1.4) * 21.8;
      latenciesMs[i] = round1(Math.max(1.8, tailShape * (1 + jitter * 0.4)));
    }
  }

  const sorted = [...latenciesMs].sort((a, b) => a - b);
  const p50Ms = round1(percentileFromSorted(sorted, 0.5));
  const p95Ms = round1(percentileFromSorted(sorted, 0.95));
  const p99Ms = round1(percentileFromSorted(sorted, 0.99));
  const maxMs = round1(sorted[sorted.length - 1] ?? 0);
  const avgMs = round1(sorted.reduce((sum, v) => sum + v, 0) / sorted.length);

  // Architecture-specific throughput, CPU & DB load telemetry
  let throughputRps: number;
  let dbCpuPct: number;
  let sqlQueriesExecuted: number;
  let redisEdgeRejections: number;
  let peakLockQueueDepth: number;

  if (mode === 'naive') {
    throughputRps = Math.round(1780 + rng() * 190);
    dbCpuPct = round1(76 + rng() * 6);
    sqlQueriesExecuted = totalRequests * 2; // SELECT + blind UPDATE attempts
    redisEdgeRejections = 0;
    peakLockQueueDepth = Math.round(totalRequests * 0.18);
  } else if (mode === 'pessimistic') {
    throughputRps = Math.round(740 + rng() * 85);
    dbCpuPct = round1(93.4 + rng() * 1.4); // ~94% DB CPU saturation
    sqlQueriesExecuted = totalRequests * 2; // Locked SELECT + UPDATE/ROLLBACK per SPID
    redisEdgeRejections = 0;
    peakLockQueueDepth = Math.max(1, totalRequests - 1);
  } else {
    throughputRps = Math.round(5240 + rng() * 260); // 5,200+ RPS Con Cung production benchmark
    dbCpuPct = round1(13.2 + rng() * 2.4);
    sqlQueriesExecuted = legitimateApprovedCount; // Strictly 1 SQL Dapper ROWVERSION UPDATE!
    redisEdgeRejections = rejected409Count;
    peakLockQueueDepth = 0;
  }

  const singleVoucherLeakVnd = doubleSpentCount * voucherFaceValueVnd;
  const projected700StoreExposureVnd = singleVoucherLeakVnd * retailStoreCount;
  const leakageSavedVsNaiveVnd =
    mode === 'naive' ? 0 : Math.max(0, naiveRef.projected700StoreExposureVnd - projected700StoreExposureVnd);

  const histogram = buildVoucherLatencyHistogram(latenciesMs, p50Ms, p95Ms, p99Ms, 12);

  // Build 24 representative animated request-lane waterfall rows spanning the 500 concurrent requests
  const laneCount = 24;
  const lanes: VoucherRequestLane[] = [];
  const leakLanesToShow = mode === 'naive' ? Math.min(8, doubleSpentCount) : 0;

  for (let idx = 0; idx < laneCount; idx++) {
    const reqNum = idx === 0 ? 1 : Math.min(totalRequests, Math.round(((idx + 1) / laneCount) * totalRequests));
    const storeIdNum = ((reqNum * 29 + idx * 17) % retailStoreCount) + 1;
    const storeCode = `STORE-${String(storeIdNum).padStart(3, '0')}`;
    const requestId = `REQ-${String(reqNum).padStart(3, '0')}`;
    const idempotencyKey = `cc-${voucherCode.slice(0, 6).toLowerCase()}-${String(reqNum).padStart(3, '0')}`;

    let outcome: VoucherLaneOutcome;
    let httpStatus: 200 | 409;
    let rowVersionToken: string;

    if (idx === 0) {
      outcome = 'APPROVED';
      httpStatus = 200;
      rowVersionToken = mode === 'naive' ? 'NO_VERSION_CHECK' : '0x0000000000000002';
    } else if (mode === 'naive' && idx <= leakLanesToShow) {
      outcome = 'DOUBLE_SPEND_LEAK';
      httpStatus = 200;
      rowVersionToken = 'STALE_READ_OVERWRITE';
    } else {
      outcome = 'REJECTED_409';
      httpStatus = 409;
      rowVersionToken =
        mode === 'concung-lua-rowversion'
          ? 'REDIS_LUA_EDGE_409'
          : mode === 'pessimistic'
            ? 'POST_UPDLOCK_EMPTY'
            : 'STOCK_DEPLETED';
    }

    const startOffsetMs = round1((idx / laneCount) * (mode === 'concung-lua-rowversion' ? 6.5 : 14));
    let redisGateMs: number;
    let lockWaitMs: number;
    let sqlWriteMs: number;

    if (mode === 'naive') {
      redisGateMs = 0;
      lockWaitMs = round1(idx === 0 ? 2.1 : 6 + (idx / laneCount) * 44);
      sqlWriteMs = round1(outcome === 'REJECTED_409' ? 8.5 : 16 + rng() * 14);
    } else if (mode === 'pessimistic') {
      redisGateMs = 0;
      lockWaitMs = round1(idx === 0 ? 3.2 : 24 + (idx / laneCount) * 585);
      sqlWriteMs = round1(idx === 0 ? 18.4 : 11.2 + rng() * 7);
    } else {
      redisGateMs = round1(0.7 + rng() * 1.1);
      lockWaitMs = 0;
      sqlWriteMs = outcome === 'APPROVED' ? round1(11.4 + rng() * 4.2) : 0;
    }

    const totalMs = round1(redisGateMs + lockWaitMs + sqlWriteMs + (mode === 'concung-lua-rowversion' ? 2.1 + (idx / laneCount) * 14 : 3.4));

    lanes.push({
      laneIndex: idx,
      requestNumber: reqNum,
      requestId,
      storeCode,
      idempotencyKey,
      startOffsetMs,
      redisGateMs,
      lockWaitMs,
      sqlWriteMs,
      totalMs,
      httpStatus,
      outcome,
      rowVersionToken,
    });
  }

  return {
    mode,
    architecture: VOUCHER_ARCHITECTURES[mode],
    voucherCode,
    voucherStock,
    totalRequests,
    seed,
    legitimateApprovedCount,
    doubleSpentCount,
    totalApproved200Count,
    rejected409Count,
    doubleSpendRatePct,
    invariantIntact,
    p50Ms,
    p95Ms,
    p99Ms,
    avgMs,
    maxMs,
    throughputRps,
    dbCpuPct,
    sqlQueriesExecuted,
    redisEdgeRejections,
    peakLockQueueDepth,
    financial: {
      voucherFaceValueVnd,
      retailStoreCount,
      singleVoucherLeakVnd,
      projected700StoreExposureVnd,
      leakageSavedVsNaiveVnd,
    },
    histogram,
    lanes,
  };
}

export function runAllThreeVoucherArchitectures(
  baseConfig: Omit<VoucherRaceConfig, 'mode'> = {}
): VoucherThreeWayComparison {
  const naive = runVoucherRaceSimulation({ ...baseConfig, mode: 'naive' });
  const pessimistic = runVoucherRaceSimulation({ ...baseConfig, mode: 'pessimistic' });
  const concung = runVoucherRaceSimulation({ ...baseConfig, mode: 'concung-lua-rowversion' });

  return {
    naive,
    pessimistic,
    concung,
    financialSavedSingleCampaignVnd: naive.financial.singleVoucherLeakVnd,
    financialSaved700StoresVnd: naive.financial.projected700StoreExposureVnd,
    p99SpeedupVsPessimistic: round1(pessimistic.p99Ms / Math.max(1, concung.p99Ms)),
    throughputMultiplierVsPessimistic: round1(concung.throughputRps / Math.max(1, pessimistic.throughputRps)),
  };
}

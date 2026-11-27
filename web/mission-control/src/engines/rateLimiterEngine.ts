export type RateLimitAlgorithmId = 'fixed-window' | 'token-bucket' | 'sliding-window-log';

export type RateLimitScenarioId = 'boundary-flash-spike' | 'sustained-wave' | 'organic-pos';

export interface RateLimitSimulationParams {
  burstIntensityRps: number; // 100 - 1,000 req/s per gateway shard
  bucketCapacity: number; // 50 - 400 tokens
  refillRatePerSec: number; // 50 - 300 tokens/s per shard (x25 shards = up to 7,500 RPS; default 200 x 25 = 5,000 RPS)
  scenario: RateLimitScenarioId;
  shardCount?: number;
}

export interface RateLimitSlotMetric {
  slotIndex: number;
  startSec: number;
  endSec: number;
  label: string;
  fixedWindowId: number;
  isBoundaryCrossing: boolean;
  isFlashSpikeSlot: boolean;
  incoming: number;
  allowed200: number;
  allowedWithinCap: number;
  throttled429: number;
  boundaryOvershoot: number;
  rolling1sAllowed: number;
  tokensRemainingAfter: number;
  retryAfterMs: number;
}

export interface RateLimitAlgorithmSummary {
  id: RateLimitAlgorithmId;
  title: string;
  shortTitle: string;
  badge: string;
  tone: 'rose' | 'cyan' | 'emerald';
  description: string;
  descriptionVi: string;
  totalIncoming: number;
  totalAllowed200: number;
  totalThrottled429: number;
  totalBoundaryOvershoot: number;
  peakRolling1sAllowed: number;
  peakMultiplierVsLimit: number;
  admissionRatePct: number;
  throttleRatePct: number;
  burstAbsorbedCount: number;
  minTokensObserved: number;
  finalTokensRemaining: number;
  maxRetryAfterMs: number;
  strictCapPreserved: boolean;
  verdict: string;
  verdictVi: string;
  slots: RateLimitSlotMetric[];
}

export interface RateLimitComparisonResult {
  durationSeconds: number;
  slotDurationMs: number;
  totalSlots: number;
  params: Required<RateLimitSimulationParams>;
  clusterGatewayCapRps: number;
  clusterPeakFixedWindowRps: number;
  clusterPeakTokenBucketRps: number;
  clusterPeakSlidingWindowRps: number;
  clusterOvershootLeakedRequests: number;
  maxSlotIncoming: number;
  algorithms: Record<RateLimitAlgorithmId, RateLimitAlgorithmSummary>;
  dotnetCode: string;
  redisSlidingLua: string;
  redisTokenBucketLua: string;
  executiveSummary: string;
  executiveSummaryVi: string;
}

export const RATE_LIMIT_BOUNDS = {
  durationSeconds: 20,
  slotDurationMs: 500,
  totalSlots: 40,
  minBurstIntensityRps: 100,
  maxBurstIntensityRps: 1000,
  defaultBurstIntensityRps: 600,
  minBucketCapacity: 50,
  maxBucketCapacity: 400,
  defaultBucketCapacity: 240,
  minRefillRatePerSec: 50,
  maxRefillRatePerSec: 300,
  defaultRefillRatePerSec: 200,
  defaultShardCount: 25,
} as const;

export const DEFAULT_RATE_LIMIT_PARAMS: Required<RateLimitSimulationParams> = {
  burstIntensityRps: RATE_LIMIT_BOUNDS.defaultBurstIntensityRps,
  bucketCapacity: RATE_LIMIT_BOUNDS.defaultBucketCapacity,
  refillRatePerSec: RATE_LIMIT_BOUNDS.defaultRefillRatePerSec,
  scenario: 'boundary-flash-spike',
  shardCount: RATE_LIMIT_BOUNDS.defaultShardCount,
};

export const RATE_LIMIT_ALGORITHM_ORDER: RateLimitAlgorithmId[] = [
  'fixed-window',
  'token-bucket',
  'sliding-window-log',
];

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

function roundTo(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

export function normalizeRateLimitParams(
  input?: Partial<RateLimitSimulationParams>
): Required<RateLimitSimulationParams> {
  return {
    burstIntensityRps: Math.round(
      clamp(
        input?.burstIntensityRps ?? DEFAULT_RATE_LIMIT_PARAMS.burstIntensityRps,
        RATE_LIMIT_BOUNDS.minBurstIntensityRps,
        RATE_LIMIT_BOUNDS.maxBurstIntensityRps
      )
    ),
    bucketCapacity: Math.round(
      clamp(
        input?.bucketCapacity ?? DEFAULT_RATE_LIMIT_PARAMS.bucketCapacity,
        RATE_LIMIT_BOUNDS.minBucketCapacity,
        RATE_LIMIT_BOUNDS.maxBucketCapacity
      )
    ),
    refillRatePerSec: Math.round(
      clamp(
        input?.refillRatePerSec ?? DEFAULT_RATE_LIMIT_PARAMS.refillRatePerSec,
        RATE_LIMIT_BOUNDS.minRefillRatePerSec,
        RATE_LIMIT_BOUNDS.maxRefillRatePerSec
      )
    ),
    scenario: input?.scenario ?? DEFAULT_RATE_LIMIT_PARAMS.scenario,
    shardCount: Math.round(clamp(input?.shardCount ?? DEFAULT_RATE_LIMIT_PARAMS.shardCount, 1, 100)),
  };
}

export function generateTrafficProfile(
  scenario: RateLimitScenarioId,
  burstIntensityRps: number,
  refillRatePerSec: number
): { arrivals: number[]; spikeFlags: boolean[] } {
  const arrivals: number[] = [];
  const spikeFlags: boolean[] = [];

  for (let i = 0; i < RATE_LIMIT_BOUNDS.totalSlots; i += 1) {
    if (scenario === 'boundary-flash-spike') {
      // Pre-boundary countdown lull before t=5.0s and t=13.0s
      if (i === 8 || i === 24) {
        arrivals.push(0);
        spikeFlags.push(false);
        continue;
      }

      // Primary 2x boundary spike straddling [4.5s, 5.0s) and [5.0s, 5.5s)
      if (i === 9 || i === 10) {
        arrivals.push(Math.max(1, Math.round(burstIntensityRps * 0.5)));
        spikeFlags.push(true);
        continue;
      }

      // Cooldown tail
      if (i === 11) {
        arrivals.push(Math.max(1, Math.round(burstIntensityRps * 0.22)));
        spikeFlags.push(false);
        continue;
      }

      // Secondary 2x boundary spike straddling [12.5s, 13.0s) and [13.0s, 13.5s)
      if (i === 25 || i === 26) {
        arrivals.push(Math.max(1, Math.round(burstIntensityRps * 0.45)));
        spikeFlags.push(true);
        continue;
      }

      if (i === 27) {
        arrivals.push(Math.max(1, Math.round(burstIntensityRps * 0.18)));
        spikeFlags.push(false);
        continue;
      }

      const calmWave = 0.22 + 0.06 * Math.sin(i * 0.65);
      arrivals.push(Math.max(8, Math.round(refillRatePerSec * calmWave)));
      spikeFlags.push(false);
    } else if (scenario === 'sustained-wave') {
      if (i >= 10 && i <= 25) {
        const envelope = 0.42 + 0.08 * Math.sin((i - 10) * 0.42);
        arrivals.push(Math.max(1, Math.round(burstIntensityRps * envelope)));
        spikeFlags.push(true);
      } else if (i === 9 || i === 26) {
        arrivals.push(Math.max(1, Math.round(burstIntensityRps * 0.28)));
        spikeFlags.push(false);
      } else {
        const baseline = 0.24 + 0.05 * Math.cos(i * 0.5);
        arrivals.push(Math.max(10, Math.round(refillRatePerSec * baseline)));
        spikeFlags.push(false);
      }
    } else {
      // Organic 700-store POS traffic staying within safe limits
      const organicWave = 0.28 + 0.1 * Math.sin(i * 0.45);
      if (i === 19 || i === 20) {
        arrivals.push(Math.max(10, Math.round(refillRatePerSec * 0.42)));
      } else {
        arrivals.push(Math.max(8, Math.round(refillRatePerSec * organicWave)));
      }
      spikeFlags.push(false);
    }
  }

  return { arrivals, spikeFlags };
}

function simulateFixedWindow(
  arrivals: number[],
  spikeFlags: boolean[],
  limitPerSec: number
): RateLimitAlgorithmSummary {
  const slots: RateLimitSlotMetric[] = [];
  let windowUsed = 0;
  let prevAllowed = 0;

  let totalIncoming = 0;
  let totalAllowed = 0;
  let totalThrottled = 0;
  let totalOvershoot = 0;
  let peakRolling = 0;
  let maxRetryAfterMs = 0;

  for (let i = 0; i < arrivals.length; i += 1) {
    const isBoundaryCrossing = i > 0 && i % 2 === 0;
    if (i % 2 === 0) {
      windowUsed = 0;
    }

    const incoming = arrivals[i];
    const remaining = Math.max(0, limitPerSec - windowUsed);
    const allowed = Math.min(incoming, remaining);
    windowUsed += allowed;
    const throttled = incoming - allowed;

    const rolling1s = (i === 0 ? 0 : prevAllowed) + allowed;
    const overshoot = Math.max(0, rolling1s - limitPerSec);
    const allowedWithinCap = Math.max(0, allowed - overshoot);
    const retryAfterMs = throttled > 0 ? (i % 2 === 0 ? 1000 : 500) : 0;

    slots.push({
      slotIndex: i,
      startSec: i * 0.5,
      endSec: (i + 1) * 0.5,
      label: `${(i * 0.5).toFixed(1)}s`,
      fixedWindowId: Math.floor(i / 2),
      isBoundaryCrossing,
      isFlashSpikeSlot: spikeFlags[i],
      incoming,
      allowed200: allowed,
      allowedWithinCap,
      throttled429: throttled,
      boundaryOvershoot: overshoot,
      rolling1sAllowed: rolling1s,
      tokensRemainingAfter: Math.max(0, limitPerSec - windowUsed),
      retryAfterMs,
    });

    totalIncoming += incoming;
    totalAllowed += allowed;
    totalThrottled += throttled;
    totalOvershoot += overshoot;
    peakRolling = Math.max(peakRolling, rolling1s);
    maxRetryAfterMs = Math.max(maxRetryAfterMs, retryAfterMs);
    prevAllowed = allowed;
  }

  const peakMultiplier = roundTo(peakRolling / limitPerSec, 2);
  const admissionRatePct = totalIncoming === 0 ? 100 : roundTo((totalAllowed * 100) / totalIncoming, 1);
  const throttleRatePct = totalIncoming === 0 ? 0 : roundTo((totalThrottled * 100) / totalIncoming, 1);

  return {
    id: 'fixed-window',
    title: 'Fixed Window Counter',
    shortTitle: 'Fixed Window',
    badge: totalOvershoot > 0 ? '2X BOUNDARY LEAK' : 'SIMPLE COUNTER',
    tone: 'rose',
    description:
      'Resets quota to 0 at every integer second boundary — vulnerable to 2x burst spikes straddling window edges.',
    descriptionVi:
      'Dat lai bo dem ve 0 o moc giay co dinh — de bi lo hong tran 2x luu luong tai ranh gioi cua so.',
    totalIncoming,
    totalAllowed200: totalAllowed,
    totalThrottled429: totalThrottled,
    totalBoundaryOvershoot: totalOvershoot,
    peakRolling1sAllowed: peakRolling,
    peakMultiplierVsLimit: peakMultiplier,
    admissionRatePct,
    throttleRatePct,
    burstAbsorbedCount: 0,
    minTokensObserved: 0,
    finalTokensRemaining: slots[slots.length - 1]?.tokensRemainingAfter ?? 0,
    maxRetryAfterMs,
    strictCapPreserved: totalOvershoot === 0,
    verdict:
      totalOvershoot > 0
        ? `Boundary reset leaked +${totalOvershoot.toLocaleString()} extra requests (peak ${peakRolling} req/s = ${peakMultiplier.toFixed(2)}x limit).`
        : 'No fixed-window boundary breach detected under current traffic.',
    verdictVi:
      totalOvershoot > 0
        ? `Reset ranh gioi lam lot +${totalOvershoot.toLocaleString()} request vuot nguong (dinh ${peakRolling} req/s = ${peakMultiplier.toFixed(2)}x han muc).`
        : 'Chua phat hien tran ranh gioi o muc tai hien tai.',
    slots,
  };
}

function simulateTokenBucket(
  arrivals: number[],
  spikeFlags: boolean[],
  bucketCapacity: number,
  refillRatePerSec: number
): RateLimitAlgorithmSummary {
  const slots: RateLimitSlotMetric[] = [];
  let tokens = bucketCapacity;
  let prevAllowed = 0;

  let totalIncoming = 0;
  let totalAllowed = 0;
  let totalThrottled = 0;
  let peakRolling = 0;
  let burstAbsorbedTotal = 0;
  let minTokens = bucketCapacity;
  let maxRetryAfterMs = 0;
  const steadyHalfSecondAllowance = Math.floor(refillRatePerSec * 0.5);

  for (let i = 0; i < arrivals.length; i += 1) {
    if (i > 0) {
      tokens = Math.min(bucketCapacity, tokens + refillRatePerSec * 0.5);
    }

    const incoming = arrivals[i];
    const available = Math.floor(tokens);
    const allowed = Math.min(incoming, available);
    tokens = Math.max(0, tokens - allowed);
    const throttled = incoming - allowed;

    const rolling1s = (i === 0 ? 0 : prevAllowed) + allowed;
    const burstAbsorbed = Math.max(0, allowed - steadyHalfSecondAllowance);
    burstAbsorbedTotal += burstAbsorbed;

    const retryAfterMs =
      throttled > 0
        ? Math.max(
            50,
            Math.ceil((1000 * Math.min(throttled, Math.max(1, Math.floor(refillRatePerSec / 4)))) / refillRatePerSec)
          )
        : 0;

    const roundedTokens = roundTo(tokens, 1);

    slots.push({
      slotIndex: i,
      startSec: i * 0.5,
      endSec: (i + 1) * 0.5,
      label: `${(i * 0.5).toFixed(1)}s`,
      fixedWindowId: Math.floor(i / 2),
      isBoundaryCrossing: i > 0 && i % 2 === 0,
      isFlashSpikeSlot: spikeFlags[i],
      incoming,
      allowed200: allowed,
      allowedWithinCap: allowed,
      throttled429: throttled,
      boundaryOvershoot: 0,
      rolling1sAllowed: rolling1s,
      tokensRemainingAfter: roundedTokens,
      retryAfterMs,
    });

    totalIncoming += incoming;
    totalAllowed += allowed;
    totalThrottled += throttled;
    peakRolling = Math.max(peakRolling, rolling1s);
    minTokens = Math.min(minTokens, roundedTokens);
    maxRetryAfterMs = Math.max(maxRetryAfterMs, retryAfterMs);
    prevAllowed = allowed;
  }

  const peakMultiplier = roundTo(peakRolling / refillRatePerSec, 2);
  const admissionRatePct = totalIncoming === 0 ? 100 : roundTo((totalAllowed * 100) / totalIncoming, 1);
  const throttleRatePct = totalIncoming === 0 ? 0 : roundTo((totalThrottled * 100) / totalIncoming, 1);

  return {
    id: 'token-bucket',
    title: 'Token Bucket',
    shortTitle: 'Token Bucket',
    badge: 'SMOOTH BURST',
    tone: 'cyan',
    description:
      'Pre-accumulates bounded token headroom to absorb legitimate flash-sale bursts, then paces smoothly at refill rate.',
    descriptionVi:
      'Tich luy token co gioi han de hap thu nhip tang dot bien muot ma, sau do dieu tiet deu theo toc do nap.',
    totalIncoming,
    totalAllowed200: totalAllowed,
    totalThrottled429: totalThrottled,
    totalBoundaryOvershoot: 0,
    peakRolling1sAllowed: peakRolling,
    peakMultiplierVsLimit: peakMultiplier,
    admissionRatePct,
    throttleRatePct,
    burstAbsorbedCount: burstAbsorbedTotal,
    minTokensObserved: minTokens,
    finalTokensRemaining: slots[slots.length - 1]?.tokensRemainingAfter ?? 0,
    maxRetryAfterMs,
    strictCapPreserved: true,
    verdict: `Absorbed ${burstAbsorbedTotal.toLocaleString()} burst requests via ${bucketCapacity}-token tank, then paced cleanly at ${refillRatePerSec}/s with 0 boundary reset leaks.`,
    verdictVi: `Hap thu muot ${burstAbsorbedTotal.toLocaleString()} request dot bien bang binh ${bucketCapacity} token, giu nhip ${refillRatePerSec}/s va 0 lo hong ranh gioi.`,
    slots,
  };
}

function simulateSlidingWindowLog(
  arrivals: number[],
  spikeFlags: boolean[],
  limitPerSec: number
): RateLimitAlgorithmSummary {
  const slots: RateLimitSlotMetric[] = [];
  let prevAllowed = 0;

  let totalIncoming = 0;
  let totalAllowed = 0;
  let totalThrottled = 0;
  let peakRolling = 0;
  let maxRetryAfterMs = 0;

  for (let i = 0; i < arrivals.length; i += 1) {
    const incoming = arrivals[i];
    const usedInRolling1s = i === 0 ? 0 : prevAllowed;
    const remainingBudget = Math.max(0, limitPerSec - usedInRolling1s);
    const allowed = Math.min(incoming, remainingBudget);
    const throttled = incoming - allowed;
    const rolling1s = usedInRolling1s + allowed;
    const retryAfterMs = throttled > 0 ? RATE_LIMIT_BOUNDS.slotDurationMs : 0;

    slots.push({
      slotIndex: i,
      startSec: i * 0.5,
      endSec: (i + 1) * 0.5,
      label: `${(i * 0.5).toFixed(1)}s`,
      fixedWindowId: Math.floor(i / 2),
      isBoundaryCrossing: i > 0 && i % 2 === 0,
      isFlashSpikeSlot: spikeFlags[i],
      incoming,
      allowed200: allowed,
      allowedWithinCap: allowed,
      throttled429: throttled,
      boundaryOvershoot: 0,
      rolling1sAllowed: rolling1s,
      tokensRemainingAfter: Math.max(0, limitPerSec - rolling1s),
      retryAfterMs,
    });

    totalIncoming += incoming;
    totalAllowed += allowed;
    totalThrottled += throttled;
    peakRolling = Math.max(peakRolling, rolling1s);
    maxRetryAfterMs = Math.max(maxRetryAfterMs, retryAfterMs);
    prevAllowed = allowed;
  }

  const peakMultiplier = roundTo(peakRolling / limitPerSec, 2);
  const admissionRatePct = totalIncoming === 0 ? 100 : roundTo((totalAllowed * 100) / totalIncoming, 1);
  const throttleRatePct = totalIncoming === 0 ? 0 : roundTo((totalThrottled * 100) / totalIncoming, 1);

  return {
    id: 'sliding-window-log',
    title: 'Redis Sliding-Window Log',
    shortTitle: 'Sliding Window',
    badge: '0 OVERSHOOT',
    tone: 'emerald',
    description:
      'Atomic Redis ZSET log over a rolling 1,000ms window enforces strict per-second ceiling with RFC Retry-After headers.',
    descriptionVi:
      'Nhat ky Redis ZSET truot 1.000ms nguyen tu khoa chat tran moi giay, khong bao gio vuot nguong kem header Retry-After.',
    totalIncoming,
    totalAllowed200: totalAllowed,
    totalThrottled429: totalThrottled,
    totalBoundaryOvershoot: 0,
    peakRolling1sAllowed: peakRolling,
    peakMultiplierVsLimit: peakMultiplier,
    admissionRatePct,
    throttleRatePct,
    burstAbsorbedCount: 0,
    minTokensObserved: 0,
    finalTokensRemaining: slots[slots.length - 1]?.tokensRemainingAfter ?? 0,
    maxRetryAfterMs,
    strictCapPreserved: true,
    verdict: `Strict rolling 1,000ms ceiling: 0 overshoot across all 40 ticks (peak ${peakRolling} <= ${limitPerSec} req/s) + Retry-After backpressure.`,
    verdictVi: `Gioi han truot 1.000ms tuyet doi: 0 request vuot nguong tren ca 40 moc (dinh ${peakRolling} <= ${limitPerSec} req/s) + Retry-After.`,
    slots,
  };
}

export function buildDotnetRateLimiterCode(params: Required<RateLimitSimulationParams>): string {
  const clusterRps = params.refillRatePerSec * params.shardCount;
  return `// Program.cs — .NET 10 ASP.NET Core Native Rate Limiter (${clusterRps.toLocaleString()} RPS across ${params.shardCount} shards)
using System.Globalization;
using System.Threading.RateLimiting;
using Microsoft.AspNetCore.RateLimiting;

builder.Services.AddRateLimiter(options =>
{
    options.RejectionStatusCode = StatusCodes.Status429TooManyRequests;

    // 1. Token Bucket — Smooth flash-sale burst absorption (${params.bucketCapacity} capacity, ${params.refillRatePerSec}/s refill)
    options.AddTokenBucketLimiter("concung-voucher-token-bucket", opt =>
    {
        opt.TokenLimit = ${params.bucketCapacity};
        opt.TokensPerPeriod = ${Math.max(1, Math.round(params.refillRatePerSec / 2))};
        opt.ReplenishmentPeriod = TimeSpan.FromMilliseconds(500);
        opt.AutoReplenishment = true;
        opt.QueueProcessingOrder = QueueProcessingOrder.OldestFirst;
        opt.QueueLimit = 0; // Fail-fast 429 to protect SQL Server threadpool
    });

    // 2. Sliding Window — Eliminates 2x Fixed-Window boundary spike (${params.refillRatePerSec} req/s per shard)
    options.AddSlidingWindowLimiter("concung-voucher-sliding-window", opt =>
    {
        opt.PermitLimit = ${params.refillRatePerSec};
        opt.Window = TimeSpan.FromSeconds(1);
        opt.SegmentsPerWindow = 4; // 250ms sub-window granularity
        opt.QueueLimit = 0;
    });

    options.OnRejected = async (context, ct) =>
    {
        var retryMs = context.Lease.TryGetMetadata(MetadataName.RetryAfter, out var retryAfter)
            ? Math.Max(250, (int)retryAfter.TotalMilliseconds)
            : 500;
        context.HttpContext.Response.Headers.RetryAfter =
            Math.Ceiling(retryMs / 1000.0).ToString(CultureInfo.InvariantCulture);
        context.HttpContext.Response.Headers["X-RateLimit-Policy"] = "concung-backpressure-v6";

        await Results.Problem(
            title: "Gateway Rate Limit Exceeded",
            detail: $"Voucher flash-sale shard cap ({params.refillRatePerSec} req/s) reached. Retry after {retryMs}ms with jitter.",
            statusCode: StatusCodes.Status429TooManyRequests
        ).ExecuteAsync(context.HttpContext);
    };
});`;
}

export function buildRedisSlidingWindowLua(params: Required<RateLimitSimulationParams>): string {
  return `-- Redis Sliding-Window Log (EVALSHA) — Strict 0-Overshoot Guarantee
-- KEYS[1] = "rl:voucher:shard:{id}" | ARGV[1] = now_ms | ARGV[2] = window_ms (1000)
-- ARGV[3] = limit (${params.refillRatePerSec}) | ARGV[4] = unique_req_id
local key       = KEYS[1]
local now_ms    = tonumber(ARGV[1])
local window_ms = tonumber(ARGV[2]) -- 1000 ms
local limit     = tonumber(ARGV[3]) -- ${params.refillRatePerSec} req/s per shard (${(params.refillRatePerSec * params.shardCount).toLocaleString()} RPS cluster)
local req_id    = ARGV[4]

-- 1. Evict expired timestamps outside rolling [now - 1000ms, now]
redis.call("ZREMRANGEBYSCORE", key, 0, now_ms - window_ms)

-- 2. Check exact cardinality inside rolling window
local current = redis.call("ZCARD", key)
if current >= limit then
    local oldest = redis.call("ZRANGE", key, 0, 0, "WITHSCORES")
    local oldest_ts = oldest[2] and tonumber(oldest[2]) or now_ms
    local retry_after_ms = math.max(50, window_ms - (now_ms - oldest_ts))
    return { 0, 0, retry_after_ms } -- HTTP 429 + exact Retry-After
end

-- 3. Record admitted request atomically & refresh TTL
redis.call("ZADD", key, now_ms, req_id)
redis.call("PEXPIRE", key, window_ms + 250)
return { 1, limit - current - 1, 0 } -- HTTP 200 Allowed`;
}

export function buildRedisTokenBucketLua(params: Required<RateLimitSimulationParams>): string {
  return `-- Redis Distributed Token Bucket (EVALSHA) — Smooth Burst Absorption
-- KEYS[1] = "tb:voucher:shard:{id}" | ARGV[1] = now_ms | ARGV[2] = capacity (${params.bucketCapacity})
-- ARGV[3] = refill_per_sec (${params.refillRatePerSec}) | ARGV[4] = requested (1)
local key      = KEYS[1]
local now_ms   = tonumber(ARGV[1])
local capacity = tonumber(ARGV[2]) -- ${params.bucketCapacity} tokens
local rate     = tonumber(ARGV[3]) -- ${params.refillRatePerSec} tokens/sec
local cost     = tonumber(ARGV[4])

local data = redis.call("HMGET", key, "tokens", "ts")
local tokens  = tonumber(data[1]) or capacity
local last_ts = tonumber(data[2]) or now_ms

-- Monotonic continuous token replenishment
local elapsed_sec = math.max(0, (now_ms - last_ts) / 1000.0)
tokens = math.min(capacity, tokens + (elapsed_sec * rate))

if tokens < cost then
    local deficit = cost - tokens
    local retry_after_ms = math.ceil((deficit / rate) * 1000)
    redis.call("HMSET", key, "tokens", tokens, "ts", now_ms)
    redis.call("PEXPIRE", key, 5000)
    return { 0, math.floor(tokens), retry_after_ms } -- HTTP 429
end

tokens = tokens - cost
redis.call("HMSET", key, "tokens", tokens, "ts", now_ms)
redis.call("PEXPIRE", key, 5000)
return { 1, math.floor(tokens), 0 } -- HTTP 200`;
}

export function simulateRateLimitComparison(
  input?: Partial<RateLimitSimulationParams>
): RateLimitComparisonResult {
  const params = normalizeRateLimitParams(input);
  const { arrivals, spikeFlags } = generateTrafficProfile(
    params.scenario,
    params.burstIntensityRps,
    params.refillRatePerSec
  );

  const fixedWindow = simulateFixedWindow(arrivals, spikeFlags, params.refillRatePerSec);
  const tokenBucket = simulateTokenBucket(
    arrivals,
    spikeFlags,
    params.bucketCapacity,
    params.refillRatePerSec
  );
  const slidingWindow = simulateSlidingWindowLog(arrivals, spikeFlags, params.refillRatePerSec);

  const clusterGatewayCapRps = params.refillRatePerSec * params.shardCount;
  const clusterPeakFixedWindowRps = fixedWindow.peakRolling1sAllowed * params.shardCount;
  const clusterPeakTokenBucketRps = tokenBucket.peakRolling1sAllowed * params.shardCount;
  const clusterPeakSlidingWindowRps = slidingWindow.peakRolling1sAllowed * params.shardCount;
  const clusterOvershootLeakedRequests = fixedWindow.totalBoundaryOvershoot * params.shardCount;
  const maxSlotIncoming = Math.max(1, ...arrivals);

  const executiveSummary =
    fixedWindow.totalBoundaryOvershoot > 0
      ? `Fixed Window leaked +${fixedWindow.totalBoundaryOvershoot.toLocaleString()} boundary overshoot reqs/shard (${clusterOvershootLeakedRequests.toLocaleString()} cluster-wide; peak ${clusterPeakFixedWindowRps.toLocaleString()} RPS = ${fixedWindow.peakMultiplierVsLimit.toFixed(2)}x gateway cap). Token Bucket smoothly absorbed ${tokenBucket.burstAbsorbedCount.toLocaleString()} burst reqs, while Redis Sliding-Window Log enforced 0 overshoot (${clusterPeakSlidingWindowRps.toLocaleString()} <= ${clusterGatewayCapRps.toLocaleString()} RPS).`
      : `All three algorithms held 0 boundary overshoot within the ${clusterGatewayCapRps.toLocaleString()} RPS Con Cung gateway ceiling.`;

  const executiveSummaryVi =
    fixedWindow.totalBoundaryOvershoot > 0
      ? `Fixed Window lam lot +${fixedWindow.totalBoundaryOvershoot.toLocaleString()} request vuot ranh gioi/shard (${clusterOvershootLeakedRequests.toLocaleString()} toan cum; dinh ${clusterPeakFixedWindowRps.toLocaleString()} RPS = ${fixedWindow.peakMultiplierVsLimit.toFixed(2)}x han muc). Token Bucket hap thu muot ${tokenBucket.burstAbsorbedCount.toLocaleString()} request dot bien, con Redis Sliding-Window Log giu 0 request vuot nguong (${clusterPeakSlidingWindowRps.toLocaleString()} <= ${clusterGatewayCapRps.toLocaleString()} RPS).`
      : `Ca 3 thuat toan deu giu 0 request vuot ranh gioi trong nguong ${clusterGatewayCapRps.toLocaleString()} RPS cua cong thanh toan Con Cung.`;

  return {
    durationSeconds: RATE_LIMIT_BOUNDS.durationSeconds,
    slotDurationMs: RATE_LIMIT_BOUNDS.slotDurationMs,
    totalSlots: RATE_LIMIT_BOUNDS.totalSlots,
    params,
    clusterGatewayCapRps,
    clusterPeakFixedWindowRps,
    clusterPeakTokenBucketRps,
    clusterPeakSlidingWindowRps,
    clusterOvershootLeakedRequests,
    maxSlotIncoming,
    algorithms: {
      'fixed-window': fixedWindow,
      'token-bucket': tokenBucket,
      'sliding-window-log': slidingWindow,
    },
    dotnetCode: buildDotnetRateLimiterCode(params),
    redisSlidingLua: buildRedisSlidingWindowLua(params),
    redisTokenBucketLua: buildRedisTokenBucketLua(params),
    executiveSummary,
    executiveSummaryVi,
  };
}

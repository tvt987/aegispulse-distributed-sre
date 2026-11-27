import { describe, expect, it } from 'vitest';
import {
  buildDotnetRateLimiterCode,
  buildRedisSlidingWindowLua,
  buildRedisTokenBucketLua,
  DEFAULT_RATE_LIMIT_PARAMS,
  generateTrafficProfile,
  normalizeRateLimitParams,
  RATE_LIMIT_ALGORITHM_ORDER,
  RATE_LIMIT_BOUNDS,
  simulateRateLimitComparison,
} from '../rateLimiterEngine';

describe('v6.0 Token-Bucket vs Sliding-Window Burst Rate-Limiter Engine', () => {
  it('simulates a 20-second timeline discretized into 40 x 500ms slots with 5,000 RPS cluster cap by default', () => {
    const res = simulateRateLimitComparison();
    expect(res.durationSeconds).toBe(20);
    expect(res.slotDurationMs).toBe(500);
    expect(res.totalSlots).toBe(40);
    expect(res.clusterGatewayCapRps).toBe(5000);
    expect(res.algorithms['fixed-window'].slots).toHaveLength(40);
    expect(res.algorithms['token-bucket'].slots).toHaveLength(40);
    expect(res.algorithms['sliding-window-log'].slots).toHaveLength(40);
  });

  it('proves Fixed Window Counter leaks a 2.00x boundary overshoot under the 2x Flash-Sale Spike', () => {
    const res = simulateRateLimitComparison({
      burstIntensityRps: 600,
      bucketCapacity: 240,
      refillRatePerSec: 200,
      scenario: 'boundary-flash-spike',
    });

    const fw = res.algorithms['fixed-window'];
    expect(fw.totalBoundaryOvershoot).toBeGreaterThanOrEqual(300);
    expect(fw.peakRolling1sAllowed).toBe(400);
    expect(fw.peakMultiplierVsLimit).toBe(2);
    expect(fw.strictCapPreserved).toBe(false);
    expect(res.clusterPeakFixedWindowRps).toBe(10000);
    expect(res.clusterOvershootLeakedRequests).toBe(fw.totalBoundaryOvershoot * 25);
  });

  it('proves Redis Sliding-Window Log holds strictly 0 boundary overshoot across all 40 slots', () => {
    const res = simulateRateLimitComparison({
      burstIntensityRps: 900,
      bucketCapacity: 300,
      refillRatePerSec: 200,
      scenario: 'boundary-flash-spike',
    });

    const sw = res.algorithms['sliding-window-log'];
    expect(sw.totalBoundaryOvershoot).toBe(0);
    expect(sw.strictCapPreserved).toBe(true);
    expect(sw.peakRolling1sAllowed).toBeLessThanOrEqual(200);
    expect(res.clusterPeakSlidingWindowRps).toBeLessThanOrEqual(5000);

    for (let i = 0; i < sw.slots.length; i += 1) {
      const prev = i === 0 ? 0 : sw.slots[i - 1].allowed200;
      expect(prev + sw.slots[i].allowed200).toBeLessThanOrEqual(200);
      expect(sw.slots[i].boundaryOvershoot).toBe(0);
    }
  });

  it('proves Fixed Window overshoot only happens on window boundary crossings (even slot indices)', () => {
    const res = simulateRateLimitComparison({
      burstIntensityRps: 800,
      bucketCapacity: 200,
      refillRatePerSec: 200,
      scenario: 'boundary-flash-spike',
    });

    for (const slot of res.algorithms['fixed-window'].slots) {
      if (slot.boundaryOvershoot > 0) {
        expect(slot.isBoundaryCrossing).toBe(true);
        expect(slot.slotIndex % 2).toBe(0);
      }
    }
  });

  it('maintains strict request conservation (allowed200 + throttled429 === incoming) across every slot and algorithm', () => {
    const res = simulateRateLimitComparison({
      burstIntensityRps: 775,
      bucketCapacity: 260,
      refillRatePerSec: 170,
      scenario: 'boundary-flash-spike',
    });

    for (const id of RATE_LIMIT_ALGORITHM_ORDER) {
      const alg = res.algorithms[id];
      expect(alg.totalAllowed200 + alg.totalThrottled429).toBe(alg.totalIncoming);
      expect(alg.slots.reduce((acc, s) => acc + s.incoming, 0)).toBe(alg.totalIncoming);
      expect(alg.slots.reduce((acc, s) => acc + s.allowed200, 0)).toBe(alg.totalAllowed200);
      expect(alg.slots.reduce((acc, s) => acc + s.throttled429, 0)).toBe(alg.totalThrottled429);
      expect(alg.slots.reduce((acc, s) => acc + s.boundaryOvershoot, 0)).toBe(
        alg.totalBoundaryOvershoot
      );

      for (const slot of alg.slots) {
        expect(slot.allowed200 + slot.throttled429).toBe(slot.incoming);
        expect(slot.allowedWithinCap + slot.boundaryOvershoot).toBe(slot.allowed200);
        expect(slot.allowed200).toBeGreaterThanOrEqual(0);
        expect(slot.throttled429).toBeGreaterThanOrEqual(0);
        expect(slot.boundaryOvershoot).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('proves Token Bucket smoothly absorbs initial spike using pre-filled tank and never leaks fixed-window resets', () => {
    const res = simulateRateLimitComparison({
      burstIntensityRps: 600,
      bucketCapacity: 240,
      refillRatePerSec: 200,
      scenario: 'boundary-flash-spike',
    });

    const tb = res.algorithms['token-bucket'];
    expect(tb.totalBoundaryOvershoot).toBe(0);
    expect(tb.burstAbsorbedCount).toBeGreaterThan(0);
    // Slot 9 (t=4.5s) absorbs full 240 tokens from tank against 300 incoming
    expect(tb.slots[9].allowed200).toBe(240);
    expect(tb.slots[9].throttled429).toBe(60);
    expect(tb.slots[9].tokensRemainingAfter).toBe(0);
    // Slot 10 (t=5.0s) smoothly paces to half-second refill (100 tokens)
    expect(tb.slots[10].allowed200).toBe(100);
    expect(tb.slots[10].throttled429).toBe(200);
  });

  it('scales Token Bucket burst absorption monotonically with Bucket Capacity', () => {
    const small = simulateRateLimitComparison({
      burstIntensityRps: 750,
      bucketCapacity: 80,
      refillRatePerSec: 150,
      scenario: 'boundary-flash-spike',
    });
    const medium = simulateRateLimitComparison({
      burstIntensityRps: 750,
      bucketCapacity: 200,
      refillRatePerSec: 150,
      scenario: 'boundary-flash-spike',
    });
    const large = simulateRateLimitComparison({
      burstIntensityRps: 750,
      bucketCapacity: 380,
      refillRatePerSec: 150,
      scenario: 'boundary-flash-spike',
    });

    expect(medium.algorithms['token-bucket'].burstAbsorbedCount).toBeGreaterThan(
      small.algorithms['token-bucket'].burstAbsorbedCount
    );
    expect(large.algorithms['token-bucket'].burstAbsorbedCount).toBeGreaterThan(
      medium.algorithms['token-bucket'].burstAbsorbedCount
    );
    expect(large.algorithms['token-bucket'].totalAllowed200).toBeGreaterThan(
      small.algorithms['token-bucket'].totalAllowed200
    );
  });

  it('keeps Token Bucket tank level strictly inside [0, bucketCapacity] across every tick', () => {
    const res = simulateRateLimitComparison({
      burstIntensityRps: 1000,
      bucketCapacity: 310,
      refillRatePerSec: 270,
      scenario: 'sustained-wave',
    });

    for (const slot of res.algorithms['token-bucket'].slots) {
      expect(slot.tokensRemainingAfter).toBeGreaterThanOrEqual(0);
      expect(slot.tokensRemainingAfter).toBeLessThanOrEqual(310);
    }
    expect(res.algorithms['token-bucket'].minTokensObserved).toBeGreaterThanOrEqual(0);
    expect(res.algorithms['token-bucket'].finalTokensRemaining).toBeLessThanOrEqual(310);
  });

  it('replenishes Token Bucket tank back toward full capacity during post-spike recovery slots', () => {
    const res = simulateRateLimitComparison({
      burstIntensityRps: 600,
      bucketCapacity: 240,
      refillRatePerSec: 200,
      scenario: 'boundary-flash-spike',
    });

    const tb = res.algorithms['token-bucket'];
    expect(tb.slots[10].tokensRemainingAfter).toBe(0);
    expect(tb.slots[20].tokensRemainingAfter).toBeGreaterThan(150);
    expect(tb.slots[24].tokensRemainingAfter).toBe(240);
    expect(tb.finalTokensRemaining).toBeGreaterThan(180);
  });

  it('emits positive Retry-After milliseconds strictly when HTTP 429 throttling occurs', () => {
    const res = simulateRateLimitComparison({
      burstIntensityRps: 700,
      bucketCapacity: 200,
      refillRatePerSec: 200,
      scenario: 'boundary-flash-spike',
    });

    for (const id of RATE_LIMIT_ALGORITHM_ORDER) {
      const alg = res.algorithms[id];
      expect(alg.maxRetryAfterMs).toBeGreaterThan(0);
      for (const slot of alg.slots) {
        if (slot.throttled429 > 0) {
          expect(slot.retryAfterMs).toBeGreaterThan(0);
        } else {
          expect(slot.retryAfterMs).toBe(0);
        }
      }
    }
  });

  it('emits exact 500ms Retry-After on Redis Sliding-Window Log throttled half-second ticks', () => {
    const res = simulateRateLimitComparison({
      burstIntensityRps: 600,
      bucketCapacity: 240,
      refillRatePerSec: 200,
      scenario: 'boundary-flash-spike',
    });

    const sw = res.algorithms['sliding-window-log'];
    const throttledSlots = sw.slots.filter((s) => s.throttled429 > 0);
    expect(throttledSlots.length).toBeGreaterThan(0);
    for (const s of throttledSlots) {
      expect(s.retryAfterMs).toBe(500);
    }
  });

  it('produces 100% admission and 0 overshoot across all algorithms on Organic POS Traffic', () => {
    const res = simulateRateLimitComparison({
      burstIntensityRps: 600,
      bucketCapacity: 240,
      refillRatePerSec: 200,
      scenario: 'organic-pos',
    });

    for (const id of RATE_LIMIT_ALGORITHM_ORDER) {
      expect(res.algorithms[id].totalBoundaryOvershoot).toBe(0);
      expect(res.algorithms[id].totalThrottled429).toBe(0);
      expect(res.algorithms[id].admissionRatePct).toBe(100);
      expect(res.algorithms[id].throttleRatePct).toBe(0);
    }
  });

  it('applies sustained backpressure during Sustained Flash-Sale Wave while protecting Sliding-Window cap', () => {
    const res = simulateRateLimitComparison({
      burstIntensityRps: 850,
      bucketCapacity: 250,
      refillRatePerSec: 180,
      scenario: 'sustained-wave',
    });

    expect(res.algorithms['sliding-window-log'].totalThrottled429).toBeGreaterThan(1500);
    expect(res.algorithms['sliding-window-log'].totalBoundaryOvershoot).toBe(0);
    expect(res.algorithms['sliding-window-log'].peakRolling1sAllowed).toBeLessThanOrEqual(180);
    expect(res.algorithms['token-bucket'].minTokensObserved).toBeLessThanOrEqual(10);
  });

  it('clamps out-of-range parameters safely inside supported slider bounds', () => {
    const low = normalizeRateLimitParams({
      burstIntensityRps: -50,
      bucketCapacity: 5,
      refillRatePerSec: 1,
      shardCount: 0,
    });
    expect(low.burstIntensityRps).toBe(RATE_LIMIT_BOUNDS.minBurstIntensityRps);
    expect(low.bucketCapacity).toBe(RATE_LIMIT_BOUNDS.minBucketCapacity);
    expect(low.refillRatePerSec).toBe(RATE_LIMIT_BOUNDS.minRefillRatePerSec);
    expect(low.shardCount).toBe(1);

    const high = normalizeRateLimitParams({
      burstIntensityRps: 99999,
      bucketCapacity: 5000,
      refillRatePerSec: 9999,
      shardCount: 500,
    });
    expect(high.burstIntensityRps).toBe(RATE_LIMIT_BOUNDS.maxBurstIntensityRps);
    expect(high.bucketCapacity).toBe(RATE_LIMIT_BOUNDS.maxBucketCapacity);
    expect(high.refillRatePerSec).toBe(RATE_LIMIT_BOUNDS.maxRefillRatePerSec);
    expect(high.shardCount).toBe(100);
  });

  it('handles NaN and Infinity parameter values gracefully without producing NaN metrics', () => {
    const normalized = normalizeRateLimitParams({
      burstIntensityRps: Number.NaN,
      bucketCapacity: Number.POSITIVE_INFINITY,
      refillRatePerSec: Number.NEGATIVE_INFINITY,
    });
    const res = simulateRateLimitComparison(normalized);
    expect(Number.isFinite(res.clusterGatewayCapRps)).toBe(true);
    expect(Number.isFinite(res.algorithms['token-bucket'].admissionRatePct)).toBe(true);
    expect(Number.isFinite(res.algorithms['sliding-window-log'].peakMultiplierVsLimit)).toBe(true);
  });

  it('verifies Sliding-Window rolling 1s cap holds across all boundary slider extremes', () => {
    const combos = [
      { burstIntensityRps: 100, bucketCapacity: 50, refillRatePerSec: 50 },
      { burstIntensityRps: 1000, bucketCapacity: 50, refillRatePerSec: 50 },
      { burstIntensityRps: 1000, bucketCapacity: 400, refillRatePerSec: 300 },
      { burstIntensityRps: 450, bucketCapacity: 120, refillRatePerSec: 110 },
    ] as const;

    for (const c of combos) {
      const res = simulateRateLimitComparison({ ...c, scenario: 'boundary-flash-spike' });
      const sw = res.algorithms['sliding-window-log'];
      expect(sw.totalBoundaryOvershoot).toBe(0);
      expect(sw.peakRolling1sAllowed).toBeLessThanOrEqual(c.refillRatePerSec);
    }
  });

  it('scales Refill Rate proportionally to cluster gateway RPS and Sliding-Window admission', () => {
    const lowCap = simulateRateLimitComparison({
      burstIntensityRps: 600,
      bucketCapacity: 200,
      refillRatePerSec: 100,
      scenario: 'boundary-flash-spike',
    });
    const highCap = simulateRateLimitComparison({
      burstIntensityRps: 600,
      bucketCapacity: 200,
      refillRatePerSec: 280,
      scenario: 'boundary-flash-spike',
    });

    expect(lowCap.clusterGatewayCapRps).toBe(2500);
    expect(highCap.clusterGatewayCapRps).toBe(7000);
    expect(highCap.algorithms['sliding-window-log'].totalAllowed200).toBeGreaterThan(
      lowCap.algorithms['sliding-window-log'].totalAllowed200
    );
  });

  it('marks pre-boundary countdown lulls at slots 8 and 24 and boundary spikes at slots 9-10 and 25-26', () => {
    const { arrivals, spikeFlags } = generateTrafficProfile('boundary-flash-spike', 600, 200);
    expect(arrivals).toHaveLength(40);
    expect(arrivals[8]).toBe(0);
    expect(arrivals[24]).toBe(0);
    expect(arrivals[9]).toBe(300);
    expect(arrivals[10]).toBe(300);
    expect(spikeFlags[9]).toBe(true);
    expect(spikeFlags[10]).toBe(true);
    expect(spikeFlags[25]).toBe(true);
    expect(spikeFlags[26]).toBe(true);
  });

  it('keeps admissionRatePct + throttleRatePct within rounding tolerance of 100%', () => {
    const res = simulateRateLimitComparison({
      burstIntensityRps: 650,
      bucketCapacity: 210,
      refillRatePerSec: 190,
      scenario: 'boundary-flash-spike',
    });

    for (const id of RATE_LIMIT_ALGORITHM_ORDER) {
      const alg = res.algorithms[id];
      const sum = alg.admissionRatePct + alg.throttleRatePct;
      expect(sum).toBeGreaterThanOrEqual(99.8);
      expect(sum).toBeLessThanOrEqual(100.2);
    }
  });

  it('is 100% deterministic across repeated identical invocations', () => {
    const a = simulateRateLimitComparison(DEFAULT_RATE_LIMIT_PARAMS);
    const b = simulateRateLimitComparison(DEFAULT_RATE_LIMIT_PARAMS);
    expect(a).toEqual(b);
  });

  it('generates valid .NET 10 AddRateLimiter code reflecting live TokenLimit and PermitLimit', () => {
    const params = normalizeRateLimitParams({
      burstIntensityRps: 700,
      bucketCapacity: 320,
      refillRatePerSec: 220,
      scenario: 'boundary-flash-spike',
      shardCount: 25,
    });
    const code = buildDotnetRateLimiterCode(params);
    expect(code).toContain('builder.Services.AddRateLimiter');
    expect(code).toContain('AddTokenBucketLimiter');
    expect(code).toContain('AddSlidingWindowLimiter');
    expect(code).toContain('opt.TokenLimit = 320;');
    expect(code).toContain('opt.PermitLimit = 220;');
    expect(code).toContain('Status429TooManyRequests');
    expect(code).toContain('RetryAfter');
  });

  it('generates valid atomic Redis Sliding-Window Log Lua script with ZREMRANGEBYSCORE & ZCARD', () => {
    const params = normalizeRateLimitParams({ refillRatePerSec: 210, shardCount: 25 });
    const lua = buildRedisSlidingWindowLua(params);
    expect(lua).toContain('ZREMRANGEBYSCORE');
    expect(lua).toContain('ZCARD');
    expect(lua).toContain('ZADD');
    expect(lua).toContain('PEXPIRE');
    expect(lua).toContain('210 req/s');
    expect(lua).toContain('retry_after_ms');
  });

  it('generates valid atomic Redis Token-Bucket Lua script with live capacity and refill rate', () => {
    const params = normalizeRateLimitParams({ bucketCapacity: 290, refillRatePerSec: 175 });
    const lua = buildRedisTokenBucketLua(params);
    expect(lua).toContain('HMGET');
    expect(lua).toContain('HMSET');
    expect(lua).toContain('290 tokens');
    expect(lua).toContain('175 tokens/sec');
  });

  it('provides non-empty bilingual EN and VI executive summaries and verdicts', () => {
    const res = simulateRateLimitComparison();
    expect(res.executiveSummary).toContain('Fixed Window leaked');
    expect(res.executiveSummary).toContain('0 overshoot');
    expect(res.executiveSummaryVi.length).toBeGreaterThan(30);
    for (const id of RATE_LIMIT_ALGORITHM_ORDER) {
      expect(res.algorithms[id].verdict.length).toBeGreaterThan(10);
      expect(res.algorithms[id].verdictVi.length).toBeGreaterThan(10);
    }
  });
});

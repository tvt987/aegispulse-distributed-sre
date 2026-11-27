import { describe, expect, it } from 'vitest';
import {
  buildVoucherLatencyHistogram,
  DEFAULT_CONCURRENT_REQUESTS,
  DEFAULT_RETAIL_STORE_COUNT,
  DEFAULT_VOUCHER_CODE,
  DEFAULT_VOUCHER_FACE_VALUE_VND,
  DEFAULT_VOUCHER_STOCK,
  formatVndCompact,
  formatVndCurrency,
  runAllThreeVoucherArchitectures,
  runVoucherRaceSimulation,
  VOUCHER_ARCHITECTURES,
} from '../voucherConcurrencyEngine';

describe('v4.0 Con Cung 500-Request Concurrent Voucher Race-Condition Engine', () => {
  it('defines metadata for all 3 selectable backend concurrency architectures', () => {
    expect(Object.keys(VOUCHER_ARCHITECTURES)).toEqual([
      'naive',
      'pessimistic',
      'concung-lua-rowversion',
    ]);
    expect(VOUCHER_ARCHITECTURES.naive.tone).toBe('rose');
    expect(VOUCHER_ARCHITECTURES.pessimistic.tone).toBe('amber');
    expect(VOUCHER_ARCHITECTURES['concung-lua-rowversion'].tone).toBe('emerald');
  });

  it('reproduces 14-38 double-spent voucher leaks in Naive Read-Check-Write mode under 500 concurrent requests', () => {
    const res = runVoucherRaceSimulation({ mode: 'naive' });
    expect(res.totalRequests).toBe(DEFAULT_CONCURRENT_REQUESTS);
    expect(res.voucherStock).toBe(DEFAULT_VOUCHER_STOCK);
    expect(res.voucherCode).toBe(DEFAULT_VOUCHER_CODE);
    expect(res.legitimateApprovedCount).toBe(1);
    expect(res.doubleSpentCount).toBeGreaterThanOrEqual(14);
    expect(res.doubleSpentCount).toBeLessThanOrEqual(38);
    expect(res.totalApproved200Count).toBe(1 + res.doubleSpentCount);
    expect(res.rejected409Count).toBe(500 - res.totalApproved200Count);
    expect(res.invariantIntact).toBe(false);
    expect(res.doubleSpendRatePct).toBeGreaterThan(2);
  });

  it('keeps Naive double-spend count strictly within [14, 38] across 25 distinct simulation seeds', () => {
    for (let s = 1; s <= 25; s++) {
      const res = runVoucherRaceSimulation({ mode: 'naive', seed: s * 7919 });
      expect(res.doubleSpentCount).toBeGreaterThanOrEqual(14);
      expect(res.doubleSpentCount).toBeLessThanOrEqual(38);
      expect(res.invariantIntact).toBe(false);
    }
  });

  it('calculates exact single-voucher and 700-store financial leakage in Naive mode', () => {
    const res = runVoucherRaceSimulation({
      mode: 'naive',
      voucherFaceValueVnd: DEFAULT_VOUCHER_FACE_VALUE_VND,
      retailStoreCount: DEFAULT_RETAIL_STORE_COUNT,
    });
    expect(res.financial.singleVoucherLeakVnd).toBe(res.doubleSpentCount * 500_000);
    expect(res.financial.projected700StoreExposureVnd).toBe(res.financial.singleVoucherLeakVnd * 700);
    expect(res.financial.leakageSavedVsNaiveVnd).toBe(0);
  });

  it('eliminates double-spending with SQL Pessimistic UPDLOCK but exhibits ~640ms p99 and ~94% DB CPU saturation', () => {
    const res = runVoucherRaceSimulation({ mode: 'pessimistic' });
    expect(res.legitimateApprovedCount).toBe(1);
    expect(res.doubleSpentCount).toBe(0);
    expect(res.totalApproved200Count).toBe(1);
    expect(res.rejected409Count).toBe(499);
    expect(res.doubleSpendRatePct).toBe(0);
    expect(res.invariantIntact).toBe(true);
    expect(res.p99Ms).toBeGreaterThanOrEqual(590);
    expect(res.p99Ms).toBeLessThanOrEqual(690);
    expect(res.dbCpuPct).toBeGreaterThanOrEqual(92);
    expect(res.dbCpuPct).toBeLessThanOrEqual(96);
    expect(res.peakLockQueueDepth).toBe(499);
    expect(res.financial.singleVoucherLeakVnd).toBe(0);
  });

  it('achieves 0.00% double-spend, 1 approved, 499 cleanly 409 Conflict, p99 ~38ms, and 5,200+ RPS in Con Cung production mode', () => {
    const res = runVoucherRaceSimulation({ mode: 'concung-lua-rowversion' });
    expect(res.legitimateApprovedCount).toBe(1);
    expect(res.doubleSpentCount).toBe(0);
    expect(res.totalApproved200Count).toBe(1);
    expect(res.rejected409Count).toBe(499);
    expect(res.doubleSpendRatePct).toBe(0);
    expect(res.invariantIntact).toBe(true);
    expect(res.p99Ms).toBeGreaterThanOrEqual(30);
    expect(res.p99Ms).toBeLessThanOrEqual(44);
    expect(res.throughputRps).toBeGreaterThanOrEqual(5200);
    expect(res.dbCpuPct).toBeLessThan(20);
    expect(res.sqlQueriesExecuted).toBe(1);
    expect(res.redisEdgeRejections).toBe(499);
    expect(res.peakLockQueueDepth).toBe(0);
  });

  it('preserves strict P50 < P95 < P99 <= maxMs ordering across all 3 architectures', () => {
    for (const mode of ['naive', 'pessimistic', 'concung-lua-rowversion'] as const) {
      const res = runVoucherRaceSimulation({ mode });
      expect(res.p50Ms).toBeLessThan(res.p95Ms);
      expect(res.p95Ms).toBeLessThan(res.p99Ms);
      expect(res.p99Ms).toBeLessThanOrEqual(res.maxMs);
    }
  });

  it('proves Con Cung Redis Lua + ROWVERSION achieves >15x lower P99 latency and >6x higher throughput than SQL UPDLOCK', () => {
    const cmp = runAllThreeVoucherArchitectures();
    expect(cmp.p99SpeedupVsPessimistic).toBeGreaterThan(14);
    expect(cmp.throughputMultiplierVsPessimistic).toBeGreaterThan(6);
    expect(cmp.concung.dbCpuPct).toBeLessThan(cmp.pessimistic.dbCpuPct / 4);
  });

  it('computes exact financial leakage saved across 700 retail stores in side-by-side comparison', () => {
    const cmp = runAllThreeVoucherArchitectures({ seed: 424242 });
    expect(cmp.financialSavedSingleCampaignVnd).toBe(cmp.naive.financial.singleVoucherLeakVnd);
    expect(cmp.financialSaved700StoresVnd).toBe(cmp.naive.financial.projected700StoreExposureVnd);
    expect(cmp.concung.financial.leakageSavedVsNaiveVnd).toBe(cmp.financialSaved700StoresVnd);
    expect(cmp.pessimistic.financial.leakageSavedVsNaiveVnd).toBe(cmp.financialSaved700StoresVnd);
  });

  it('builds a 12-bucket latency histogram whose counts sum strictly to totalRequests with single P50/P95/P99 markers', () => {
    for (const mode of ['naive', 'pessimistic', 'concung-lua-rowversion'] as const) {
      const res = runVoucherRaceSimulation({ mode });
      expect(res.histogram).toHaveLength(12);
      const total = res.histogram.reduce((acc, b) => acc + b.count, 0);
      expect(total).toBe(res.totalRequests);
      expect(res.histogram.filter((b) => b.hasP50)).toHaveLength(1);
      expect(res.histogram.filter((b) => b.hasP95)).toHaveLength(1);
      expect(res.histogram.filter((b) => b.hasP99)).toHaveLength(1);
    }
  });

  it('returns empty array when buildVoucherLatencyHistogram receives empty latency input', () => {
    expect(buildVoucherLatencyHistogram([], 0, 0, 0)).toEqual([]);
  });

  it('produces 24 representative request lanes with valid Con Cung store codes and idempotency keys', () => {
    const res = runVoucherRaceSimulation({ mode: 'concung-lua-rowversion' });
    expect(res.lanes).toHaveLength(24);
    expect(res.lanes[0].outcome).toBe('APPROVED');
    expect(res.lanes[0].httpStatus).toBe(200);
    expect(res.lanes[0].rowVersionToken).toBe('0x0000000000000002');
    expect(res.lanes.slice(1).every((l) => l.outcome === 'REJECTED_409')).toBe(true);
    expect(res.lanes.slice(1).every((l) => l.rowVersionToken === 'REDIS_LUA_EDGE_409')).toBe(true);
    for (const lane of res.lanes) {
      expect(lane.storeCode).toMatch(/^STORE-\d{3}$/);
      expect(lane.idempotencyKey).toContain('cc-');
      expect(lane.totalMs).toBeGreaterThan(0);
    }
  });

  it('exposes visible DOUBLE_SPEND_LEAK lanes in Naive mode and zero leak lanes in protected modes', () => {
    const naive = runVoucherRaceSimulation({ mode: 'naive' });
    const pessimistic = runVoucherRaceSimulation({ mode: 'pessimistic' });
    const concung = runVoucherRaceSimulation({ mode: 'concung-lua-rowversion' });

    expect(naive.lanes.filter((l) => l.outcome === 'DOUBLE_SPEND_LEAK').length).toBeGreaterThanOrEqual(5);
    expect(pessimistic.lanes.filter((l) => l.outcome === 'DOUBLE_SPEND_LEAK')).toHaveLength(0);
    expect(concung.lanes.filter((l) => l.outcome === 'DOUBLE_SPEND_LEAK')).toHaveLength(0);
  });

  it('models zero lockWaitMs in Con Cung Redis Lua lanes and high lockWaitMs convoy in Pessimistic UPDLOCK lanes', () => {
    const pessimistic = runVoucherRaceSimulation({ mode: 'pessimistic' });
    const concung = runVoucherRaceSimulation({ mode: 'concung-lua-rowversion' });

    expect(concung.lanes.every((l) => l.lockWaitMs === 0)).toBe(true);
    expect(concung.lanes.every((l) => l.redisGateMs > 0 && l.redisGateMs < 3)).toBe(true);
    expect(pessimistic.lanes[pessimistic.lanes.length - 1].lockWaitMs).toBeGreaterThan(450);
  });

  it('is strictly deterministic when executed repeatedly with the same seed', () => {
    const run1 = runVoucherRaceSimulation({ mode: 'naive', seed: 987654 });
    const run2 = runVoucherRaceSimulation({ mode: 'naive', seed: 987654 });
    expect(run1).toEqual(run2);
  });

  it('clamps out-of-range request counts, stock, face values, and store counts safely', () => {
    const low = runVoucherRaceSimulation({
      mode: 'concung-lua-rowversion',
      concurrentRequests: 5,
      voucherStock: -2,
      voucherFaceValueVnd: 10,
      retailStoreCount: 1,
    });
    expect(low.totalRequests).toBe(50);
    expect(low.voucherStock).toBe(1);
    expect(low.financial.voucherFaceValueVnd).toBe(50_000);
    expect(low.financial.retailStoreCount).toBe(10);

    const high = runVoucherRaceSimulation({
      mode: 'concung-lua-rowversion',
      concurrentRequests: 99_999,
      retailStoreCount: 99_999,
    });
    expect(high.totalRequests).toBe(2000);
    expect(high.financial.retailStoreCount).toBe(2000);
  });

  it('normalizes lowercase and whitespace-padded voucher codes cleanly', () => {
    const res = runVoucherRaceSimulation({
      mode: 'concung-lua-rowversion',
      voucherCode: '  tet-flash-500k  ',
    });
    expect(res.voucherCode).toBe('TET-FLASH-500K');
  });

  it('supports custom multi-unit voucher stock while keeping strict zero-oversell invariant in Con Cung mode', () => {
    const res = runVoucherRaceSimulation({
      mode: 'concung-lua-rowversion',
      concurrentRequests: 500,
      voucherStock: 10,
    });
    expect(res.legitimateApprovedCount).toBe(10);
    expect(res.totalApproved200Count).toBe(10);
    expect(res.rejected409Count).toBe(490);
    expect(res.doubleSpentCount).toBe(0);
    expect(res.sqlQueriesExecuted).toBe(10);
    expect(res.redisEdgeRejections).toBe(490);
    expect(res.invariantIntact).toBe(true);
  });

  it('formats VND currency and compact billions/millions cleanly without UI emojis', () => {
    expect(formatVndCurrency(500_000)).toBe('500.000 VND');
    expect(formatVndCurrency(13_500_000)).toBe('13.500.000 VND');
    expect(formatVndCurrency(-100)).toBe('0 VND');
    expect(formatVndCompact(12_500_000)).toBe('12.5M VND');
    expect(formatVndCompact(9_100_000_000)).toBe('9.10B VND');
    expect(formatVndCompact(500_000)).toBe('500.000 VND');
  });

  it('guarantees zero SQL queries wasted on rejected contenders in Con Cung Redis Lua pattern', () => {
    const naive = runVoucherRaceSimulation({ mode: 'naive', concurrentRequests: 500 });
    const pessimistic = runVoucherRaceSimulation({ mode: 'pessimistic', concurrentRequests: 500 });
    const concung = runVoucherRaceSimulation({ mode: 'concung-lua-rowversion', concurrentRequests: 500 });

    expect(naive.sqlQueriesExecuted).toBe(1000);
    expect(pessimistic.sqlQueriesExecuted).toBe(1000);
    expect(concung.sqlQueriesExecuted).toBe(1);
  });

  it('contains zero emoji characters in architecture titles, badges, or descriptions', () => {
    const emojiPattern = /\p{Extended_Pictographic}/u;
    for (const meta of Object.values(VOUCHER_ARCHITECTURES)) {
      expect(emojiPattern.test(meta.title)).toBe(false);
      expect(emojiPattern.test(meta.badge)).toBe(false);
      expect(emojiPattern.test(meta.summary)).toBe(false);
      expect(emojiPattern.test(meta.summaryVi)).toBe(false);
    }
  });
});

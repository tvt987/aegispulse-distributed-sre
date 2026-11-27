import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SQL_CONCURRENCY_RPS,
  DEFAULT_SQL_ROW_COUNT,
  evaluateAllSqlStages,
  evaluateSqlExecutionPlan,
  formatLogicalReadsMb,
  generateRecommendedDapperCSharp,
  generateRecommendedIndexDdl,
  generateRecommendedRedisLua,
} from '../sqlPlanAdvisorEngine';

describe('sqlPlanAdvisorEngine — Con Cung 5M-Row SQL Server & Dapper Index Advisor', () => {
  it('models Stage 1 Legacy EF Core Scan at 5M rows / 5K RPS with exact 28.4ms, 14,200 logical reads & 125MB heap', () => {
    const res = evaluateSqlExecutionPlan('legacy-ef-scan', DEFAULT_SQL_ROW_COUNT, DEFAULT_SQL_CONCURRENCY_RPS);
    expect(res.stageNumber).toBe(1);
    expect(res.executionTimeMs).toBe(28.4);
    expect(res.logicalReads).toBe(14200);
    expect(res.memoryFootprintMb).toBe(125);
    expect(res.hasLockEscalationWarning).toBe(true);
    expect(res.lockEscalationRisk).toBe('CRITICAL_TABLE_LOCK_ESCALATION');
    expect(res.latencyReductionPctVsLegacy).toBe(0);
  });

  it('models Stage 2 Covering Non-Clustered Index + Dapper + ROWVERSION CAS at 1.8ms, 14 reads, 18MB (-93.7% latency)', () => {
    const res = evaluateSqlExecutionPlan('covering-dapper-cas', DEFAULT_SQL_ROW_COUNT, DEFAULT_SQL_CONCURRENCY_RPS);
    expect(res.stageNumber).toBe(2);
    expect(res.executionTimeMs).toBe(1.8);
    expect(res.logicalReads).toBe(14);
    expect(res.memoryFootprintMb).toBe(18);
    expect(res.latencyReductionPctVsLegacy).toBe(93.7);
    expect(res.logicalReadReductionPctVsLegacy).toBe(99.9);
    expect(res.memoryReductionPctVsLegacy).toBe(85.6);
    expect(res.hasLockEscalationWarning).toBe(false);
    expect(res.lockEscalationRisk).toBe('LOW_ROW_CAS_ONLY');
  });

  it('models Stage 3 Redis Atomic Lua Guard + Async Write-Behind at 0.42ms and 0 SQL contention reads', () => {
    const res = evaluateSqlExecutionPlan('redis-lua-write-behind', DEFAULT_SQL_ROW_COUNT, DEFAULT_SQL_CONCURRENCY_RPS);
    expect(res.stageNumber).toBe(3);
    expect(res.executionTimeMs).toBe(0.42);
    expect(res.logicalReads).toBe(0);
    expect(res.memoryFootprintMb).toBe(6);
    expect(res.latencyReductionPctVsLegacy).toBe(98.5);
    expect(res.logicalReadReductionPctVsLegacy).toBe(100);
    expect(res.hasLockEscalationWarning).toBe(false);
    expect(res.lockEscalationRisk).toBe('NONE_ZERO_SQL_CONTENTION');
  });

  it('operator cost percentages sum to exactly 100% across all 3 stages', () => {
    const all = evaluateAllSqlStages();
    for (const plan of Object.values(all)) {
      const totalPct = plan.operators.reduce((sum, op) => sum + op.costPercent, 0);
      expect(totalPct).toBe(100);
    }
  });

  it('operator logical reads reconcile exactly to total logicalReads across all 3 stages', () => {
    const all = evaluateAllSqlStages();
    for (const plan of Object.values(all)) {
      const opReads = plan.operators.reduce((sum, op) => sum + op.logicalReads, 0);
      expect(opReads).toBe(plan.logicalReads);
    }
  });

  it('operator CPU milliseconds reconcile cleanly to total executionTimeMs', () => {
    const all = evaluateAllSqlStages();
    for (const plan of Object.values(all)) {
      const opCpu = plan.operators.reduce((sum, op) => sum + op.cpuMs, 0);
      expect(opCpu).toBeCloseTo(plan.executionTimeMs, 1);
    }
  });

  it('scales Stage 1 linearly with table size while Stage 2 scales logarithmically (B-Tree)', () => {
    const legacy1M = evaluateSqlExecutionPlan('legacy-ef-scan', 1_000_000, 5_000);
    const legacy10M = evaluateSqlExecutionPlan('legacy-ef-scan', 10_000_000, 5_000);
    expect(legacy10M.logicalReads).toBeGreaterThan(legacy1M.logicalReads * 9);

    const covering1M = evaluateSqlExecutionPlan('covering-dapper-cas', 1_000_000, 5_000);
    const covering10M = evaluateSqlExecutionPlan('covering-dapper-cas', 10_000_000, 5_000);
    expect(covering10M.logicalReads).toBeLessThanOrEqual(20);
    expect(covering10M.logicalReads - covering1M.logicalReads).toBeLessThanOrEqual(5);
  });

  it('scales p99 latency upward when concurrency RPS increases', () => {
    const lowLoad = evaluateSqlExecutionPlan('legacy-ef-scan', 5_000_000, 1_000);
    const highLoad = evaluateSqlExecutionPlan('legacy-ef-scan', 5_000_000, 12_000);
    expect(highLoad.p99LatencyMs).toBeGreaterThan(lowLoad.p99LatencyMs * 2);
  });

  it('clamps extreme low inputs safely without producing NaN or negative values', () => {
    const clamped = evaluateSqlExecutionPlan('covering-dapper-cas', 10, 5, '  ');
    expect(clamped.tableRowCount).toBe(10_000);
    expect(clamped.concurrencyRps).toBe(100);
    expect(clamped.voucherCode).toBe('CONCUNG-VIP-500K');
    expect(clamped.executionTimeMs).toBeGreaterThan(0);
  });

  it('converts 8KB SQL Server logical read pages into megabytes accurately', () => {
    expect(formatLogicalReadsMb(14200)).toBeCloseTo(110.94, 2);
    expect(formatLogicalReadsMb(14)).toBeCloseTo(0.11, 2);
    expect(formatLogicalReadsMb(0)).toBe(0);
  });

  it('generates valid T-SQL CREATE NONCLUSTERED INDEX with INCLUDE & filtered WHERE clause', () => {
    const ddl = generateRecommendedIndexDdl();
    expect(ddl).toContain('CREATE NONCLUSTERED INDEX IX_Vouchers_Code_Active_Covering');
    expect(ddl).toContain('INCLUDE (RemainingStock, FaceValueVnd, CampaignId, RowVersion)');
    expect(ddl).toContain('WHERE (RemainingStock > 0 AND IsActive = 1)');
    expect(ddl).toContain('UX_VoucherRedemptions_IdempotencyKey');
  });

  it('generates C# .NET 10 Dapper ROWVERSION CAS snippet and Redis Lua EVALSHA guard', () => {
    const dapper = generateRecommendedDapperCSharp('VIP-TEST-500K');
    expect(dapper).toContain('QuerySingleOrDefaultAsync');
    expect(dapper).toContain('v.RowVersion     = @ExpectedRowVersion');
    expect(dapper).toContain('VIP-TEST-500K');

    const lua = generateRecommendedRedisLua();
    expect(lua).toContain("redis.call('DECR', stockKey)");
    expect(lua).toContain('EXHAUSTED_409');
  });

  it('includes a 3-stage comparison summary ordered Stage 1 -> Stage 2 -> Stage 3', () => {
    const res = evaluateSqlExecutionPlan('redis-lua-write-behind');
    expect(res.allStagesComparison).toHaveLength(3);
    expect(res.allStagesComparison.map((s) => s.stageNumber)).toEqual([1, 2, 3]);
    expect(res.allStagesComparison[0].executionTimeMs).toBeGreaterThan(res.allStagesComparison[1].executionTimeMs);
    expect(res.allStagesComparison[1].executionTimeMs).toBeGreaterThan(res.allStagesComparison[2].executionTimeMs);
  });
});

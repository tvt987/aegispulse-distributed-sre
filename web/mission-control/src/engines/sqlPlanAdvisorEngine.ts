export type SqlOptimizationStage =
  | 'legacy-ef-scan'
  | 'covering-dapper-cas'
  | 'redis-lua-write-behind';

export interface SqlPlanOperator {
  id: string;
  name: string;
  physicalOp: string;
  costPercent: number;
  logicalReads: number;
  cpuMs: number;
  estimatedRows: number;
  lockGranularity: string;
  waitType: string;
  warning: string | null;
  summary: string;
}

export interface SqlStageSummary {
  stage: SqlOptimizationStage;
  stageNumber: 1 | 2 | 3;
  shortLabel: string;
  title: string;
  executionTimeMs: number;
  p99LatencyMs: number;
  logicalReads: number;
  memoryFootprintMb: number;
  latencyReductionPctVsLegacy: number;
  lockEscalationRisk: 'CRITICAL_TABLE_LOCK_ESCALATION' | 'LOW_ROW_CAS_ONLY' | 'NONE_ZERO_SQL_CONTENTION';
}

export interface SqlExecutionPlanResult {
  stage: SqlOptimizationStage;
  stageNumber: 1 | 2 | 3;
  stageCode: string;
  title: string;
  subtitle: string;
  tableRowCount: number;
  concurrencyRps: number;
  voucherCode: string;
  executionTimeMs: number;
  p99LatencyMs: number;
  logicalReads: number;
  pagesScannedMb: number;
  memoryFootprintMb: number;
  latencyReductionPctVsLegacy: number;
  logicalReadReductionPctVsLegacy: number;
  memoryReductionPctVsLegacy: number;
  lockGranularity: string;
  lockEscalationRisk: 'CRITICAL_TABLE_LOCK_ESCALATION' | 'LOW_ROW_CAS_ONLY' | 'NONE_ZERO_SQL_CONTENTION';
  hasLockEscalationWarning: boolean;
  operators: SqlPlanOperator[];
  recommendedIndexDdl: string;
  recommendedDapperCSharp: string;
  recommendedRedisLua: string;
  allStagesComparison: SqlStageSummary[];
}

export const DEFAULT_SQL_ROW_COUNT = 5_000_000;
export const DEFAULT_SQL_CONCURRENCY_RPS = 5_000;
export const DEFAULT_SQL_VOUCHER_CODE = 'CONCUNG-VIP-500K';

export const SQL_STAGE_ORDER: SqlOptimizationStage[] = [
  'legacy-ef-scan',
  'covering-dapper-cas',
  'redis-lua-write-behind',
];

export function generateRecommendedIndexDdl(
  vouchersTable = 'dbo.Vouchers',
  redemptionsTable = 'dbo.VoucherRedemptions'
): string {
  return `-- Con Cung 700-Store Covering Filtered Index (5M Rows -> 14 Logical Reads, 0 Key Lookups)
CREATE NONCLUSTERED INDEX IX_Vouchers_Code_Active_Covering
ON ${vouchersTable} (VoucherCode ASC, IsActive ASC, ExpiresAtUtc ASC)
INCLUDE (RemainingStock, FaceValueVnd, CampaignId, RowVersion)
WHERE (RemainingStock > 0 AND IsActive = 1)
WITH (ONLINE = ON, FILLFACTOR = 90, DATA_COMPRESSION = PAGE);

-- Companion Unique Idempotency Guard on VoucherRedemptions
CREATE UNIQUE NONCLUSTERED INDEX UX_VoucherRedemptions_IdempotencyKey
ON ${redemptionsTable} (VoucherCode ASC, IdempotencyKey ASC)
INCLUDE (CustomerId, StoreCode, RedeemedAtUtc)
WITH (ONLINE = ON, DATA_COMPRESSION = PAGE);`;
}

export function generateRecommendedDapperCSharp(voucherCode = DEFAULT_SQL_VOUCHER_CODE): string {
  return `// .NET 10 Dapper Zero-ChangeTracker + SQL Server ROWVERSION Optimistic CAS
public async Task<VoucherCasResult> RedeemWithCoveringIndexAsync(
    SqlConnection db, string voucherCode, byte[] expectedRowVersion, CancellationToken ct)
{
    const string sql = @"
        UPDATE v WITH (ROWLOCK)
        SET    v.RemainingStock = v.RemainingStock - 1,
               v.UpdatedAtUtc   = SYSUTCDATETIME()
        OUTPUT INSERTED.RemainingStock, INSERTED.RowVersion
        FROM   dbo.Vouchers AS v
        WHERE  v.VoucherCode    = @VoucherCode
          AND  v.IsActive       = 1
          AND  v.RemainingStock > 0
          AND  v.RowVersion     = @ExpectedRowVersion;";

    var receipt = await db.QuerySingleOrDefaultAsync<VoucherCasReceipt>(
        new CommandDefinition(
            sql,
            new { VoucherCode = voucherCode /* e.g. "${voucherCode}" */, ExpectedRowVersion = expectedRowVersion },
            commandTimeout: 2,
            cancellationToken: ct));

    return receipt is null
        ? VoucherCasResult.Conflict409("ROWVERSION stale or stock exhausted")
        : VoucherCasResult.Committed200(receipt);
}`;
}

export function generateRecommendedRedisLua(): string {
  return `-- Stage 3: Single-Threaded Redis Lua EVALSHA Gate (0.42 ms · 0 SQL Contention Reads)
local idemKey  = KEYS[1] -- voucher:idem:{code}:{idempotencyKey}
local stockKey = KEYS[2] -- voucher:stock:{code}

local cached = redis.call('GET', idemKey)
if cached then
    return { 2, cached } -- 200 OK Idempotent Replay (0 SQL hits)
end

local stock = tonumber(redis.call('GET', stockKey) or '0')
if stock <= 0 then
    return { 0, 'EXHAUSTED_409' } -- Shed 499 losing bursts in < 0.5 ms
end

local nextStock = redis.call('DECR', stockKey)
redis.call('SET', idemKey, ARGV[1], 'EX', 86400)
return { 1, tostring(nextStock) } -- Sole winner dispatched to Channel<T> async WAL`;
}

function roundTo(value: number, decimals: number): number {
  const factor = Math.pow(10, decimals);
  return Math.round(value * factor) / factor;
}

export function formatLogicalReadsMb(logicalReads: number): number {
  return roundTo((logicalReads * 8) / 1024, 2);
}

interface InternalStageMetrics {
  stage: SqlOptimizationStage;
  stageNumber: 1 | 2 | 3;
  stageCode: string;
  shortLabel: string;
  title: string;
  subtitle: string;
  executionTimeMs: number;
  p99LatencyMs: number;
  logicalReads: number;
  memoryFootprintMb: number;
  lockGranularity: string;
  lockEscalationRisk: 'CRITICAL_TABLE_LOCK_ESCALATION' | 'LOW_ROW_CAS_ONLY' | 'NONE_ZERO_SQL_CONTENTION';
  operators: SqlPlanOperator[];
}

function computeInternalStage(
  stage: SqlOptimizationStage,
  tableRowCount: number,
  concurrencyRps: number
): InternalStageMetrics {
  const safeRows = Math.max(10_000, Math.round(tableRowCount));
  const safeRps = Math.max(100, Math.round(concurrencyRps));

  const scaleRows = safeRows / DEFAULT_SQL_ROW_COUNT;
  const scaleLoad = safeRps / DEFAULT_SQL_CONCURRENCY_RPS;
  const btreeFactor = Math.log10(Math.max(1_000, safeRows)) / Math.log10(DEFAULT_SQL_ROW_COUNT);

  if (stage === 'legacy-ef-scan') {
    const logicalReads = Math.max(64, Math.round(14_200 * scaleRows));
    const scanReads = Math.round(logicalReads * 0.8338);
    const lookupReads = Math.max(0, logicalReads - scanReads);

    const execMs = roundTo(28.4 * (0.65 * scaleRows + 0.35 * Math.pow(scaleLoad, 1.15)), 2);
    const p99Ms = roundTo(execMs * (2.4 + 0.8 * scaleLoad), 2);
    const memMb = roundTo(125.0 * (0.45 + 0.55 * scaleLoad), 1);
    const lookupRows = Math.max(100, Math.round(safeRows * 0.00964));

    const op1Cpu = roundTo(execMs * 0.64, 2);
    const op2Cpu = roundTo(execMs * 0.19, 2);
    const op3Cpu = roundTo(execMs * 0.09, 2);
    const op4Cpu = roundTo(execMs * 0.06, 2);
    const op5Cpu = roundTo(Math.max(0.01, execMs - (op1Cpu + op2Cpu + op3Cpu + op4Cpu)), 2);

    return {
      stage,
      stageNumber: 1,
      stageCode: 'STAGE_1_LEGACY_EF_SCAN',
      shortLabel: 'Stage 1 · Legacy EF Core Scan',
      title: 'Stage 1 — Legacy EF Core + Clustered Index Scan',
      subtitle:
        'Full 5M-row clustered table scan, bookmark key-lookup lock escalation & 125 MB ChangeTracker managed heap.',
      executionTimeMs: execMs,
      p99LatencyMs: p99Ms,
      logicalReads,
      memoryFootprintMb: memMb,
      lockGranularity: 'TABLE (IX -> X Escalation > 5,000 Rows)',
      lockEscalationRisk: 'CRITICAL_TABLE_LOCK_ESCALATION',
      operators: [
        {
          id: 'op-scan',
          name: 'Clustered Index Scan',
          physicalOp: 'PK_Vouchers (Full Table Scan)',
          costPercent: 64,
          logicalReads: scanReads,
          cpuMs: op1Cpu,
          estimatedRows: safeRows,
          lockGranularity: 'TABLE (S -> IX Lock Escalation)',
          waitType: 'PAGEIOLATCH_SH',
          warning: 'Full clustered index scan reads ~111 MB of 8KB data pages per voucher lookup.',
          summary: 'Non-SARGable EF Core LINQ predicate prevents B-Tree seek across Vouchers.',
        },
        {
          id: 'op-lookup',
          name: 'Key Lookup (Clustered)',
          physicalOp: 'VoucherRedemptions Bookmark Lookup',
          costPercent: 19,
          logicalReads: lookupReads,
          cpuMs: op2Cpu,
          estimatedRows: lookupRows,
          lockGranularity: 'PAGE / KEY (U Lock Convoy)',
          waitType: 'LCK_M_U',
          warning: 'Exceeding 5,000 row locks triggers SQL Server TABLE lock escalation.',
          summary: 'Missing INCLUDE columns force random bookmark probes back into the clustered B-Tree.',
        },
        {
          id: 'op-hash',
          name: 'Hash Match (Inner Join)',
          physicalOp: 'Vouchers ⋈ VoucherRedemptions',
          costPercent: 9,
          logicalReads: 0,
          cpuMs: op3Cpu,
          estimatedRows: lookupRows,
          lockGranularity: 'MEMORY GRANT (42 MB TempDB Spill)',
          waitType: 'CXPACKET',
          warning: 'High-concurrency flash-sale bursts spill hash buckets into TempDB.',
          summary: 'Large intermediate rowset requires multi-megabyte workspace memory grants.',
        },
        {
          id: 'op-ef',
          name: 'EF Core ChangeTracker',
          physicalOp: 'AsTracking() Graph Materialization',
          costPercent: 6,
          logicalReads: 0,
          cpuMs: op4Cpu,
          estimatedRows: 1,
          lockGranularity: `MANAGED HEAP (${memMb.toFixed(1)} MB Gen2 GC)`,
          waitType: 'GC_PAUSE',
          warning: 'ChangeTracker snapshot proxies induce Gen2 GC stop-the-world stalls.',
          summary: 'Entity Framework allocates tracked entity wrappers + original-value dictionaries per request.',
        },
        {
          id: 'op-upd',
          name: 'Clustered Index Update',
          physicalOp: 'Unchecked Read-Then-Write',
          costPercent: 2,
          logicalReads: 0,
          cpuMs: op5Cpu,
          estimatedRows: 1,
          lockGranularity: 'TABLE (X Escalated)',
          waitType: 'LCK_M_X',
          warning: 'No ROWVERSION CAS guard exposes Con Cung vouchers to TOCTOU double-spending.',
          summary: 'Blind UPDATE after stale SELECT allows parallel checkouts to oversell stock = 1.',
        },
      ],
    };
  }

  if (stage === 'covering-dapper-cas') {
    const logicalReads = Math.max(4, Math.round(14 * btreeFactor));
    const seekReads = Math.round(logicalReads * 0.643);
    const updateReads = Math.max(1, logicalReads - seekReads);

    const execMs = roundTo(1.8 * (0.7 * btreeFactor + 0.3 * Math.pow(scaleLoad, 0.45)), 2);
    const p99Ms = roundTo(execMs * (1.85 + 0.35 * scaleLoad), 2);
    const memMb = roundTo(18.0 * (0.75 + 0.25 * scaleLoad), 1);

    const op1Cpu = roundTo(execMs * 0.48, 2);
    const op2Cpu = roundTo(execMs * 0.12, 2);
    const op3Cpu = roundTo(execMs * 0.32, 2);
    const op4Cpu = roundTo(Math.max(0.01, execMs - (op1Cpu + op2Cpu + op3Cpu)), 2);

    return {
      stage,
      stageNumber: 2,
      stageCode: 'STAGE_2_COVERING_DAPPER_CAS',
      shortLabel: 'Stage 2 · Covering Index + Dapper CAS',
      title: 'Stage 2 — Covering Non-Clustered Index + Dapper + ROWVERSION CAS',
      subtitle:
        'Filtered covering index cuts logical reads 99.9% (14,200 -> 14), eliminates key lookups & drops latency -93.7%.',
      executionTimeMs: execMs,
      p99LatencyMs: p99Ms,
      logicalReads,
      memoryFootprintMb: memMb,
      lockGranularity: 'ROW (Single-Key U/X + ROWVERSION CAS)',
      lockEscalationRisk: 'LOW_ROW_CAS_ONLY',
      operators: [
        {
          id: 'op-seek',
          name: 'Index Seek (Covering)',
          physicalOp: 'IX_Vouchers_Code_Active_Covering',
          costPercent: 48,
          logicalReads: seekReads,
          cpuMs: op1Cpu,
          estimatedRows: 1,
          lockGranularity: 'ROW (Single-Key S Lock)',
          waitType: 'NONE',
          warning: null,
          summary: 'Direct 4-level B-Tree seek resolves VoucherCode + INCLUDE columns with zero bookmark lookups.',
        },
        {
          id: 'op-scalar',
          name: 'Compute Scalar',
          physicalOp: 'ROWVERSION CAS Predicate Check',
          costPercent: 12,
          logicalReads: 0,
          cpuMs: op2Cpu,
          estimatedRows: 1,
          lockGranularity: 'NONE (CPU Register)',
          waitType: 'NONE',
          warning: null,
          summary: 'Evaluates RemainingStock > 0 AND RowVersion = @ExpectedRowVersion inline.',
        },
        {
          id: 'op-cas-upd',
          name: 'Clustered Index Update',
          physicalOp: 'Dapper ROWLOCK + ROWVERSION CAS',
          costPercent: 32,
          logicalReads: updateReads,
          cpuMs: op3Cpu,
          estimatedRows: 1,
          lockGranularity: 'ROW (U -> X Optimistic CAS)',
          waitType: 'NONE',
          warning: null,
          summary: 'Single-row atomic decrement with OUTPUT INSERTED.RowVersion prevents table lock escalation.',
        },
        {
          id: 'op-dapper',
          name: 'Dapper Zero-Tracker DTO',
          physicalOp: 'Direct IDataReader IL Emit',
          costPercent: 8,
          logicalReads: 0,
          cpuMs: op4Cpu,
          estimatedRows: 1,
          lockGranularity: `POOLED HEAP (${memMb.toFixed(1)} MB RAM)`,
          waitType: 'NONE',
          warning: null,
          summary: 'Bypasses EF Core ChangeTracker completely — cutting managed heap allocation by 85.6%.',
        },
      ],
    };
  }

  // Stage 3: Redis Atomic Lua Guard + Async Write-Behind
  const execMs = roundTo(0.42 * (0.85 + 0.15 * Math.pow(scaleLoad, 0.25)), 2);
  const p99Ms = roundTo(execMs * (1.7 + 0.25 * scaleLoad), 2);
  const memMb = roundTo(6.0 * (0.8 + 0.2 * scaleLoad), 1);

  const op1Cpu = roundTo(execMs * 0.55, 2);
  const op2Cpu = roundTo(execMs * 0.24, 2);
  const op3Cpu = roundTo(execMs * 0.14, 2);
  const op4Cpu = roundTo(Math.max(0.01, execMs - (op1Cpu + op2Cpu + op3Cpu)), 2);

  return {
    stage,
    stageNumber: 3,
    stageCode: 'STAGE_3_REDIS_LUA_WRITE_BEHIND',
    shortLabel: 'Stage 3 · Redis Lua + Write-Behind',
    title: 'Stage 3 — Redis Atomic Lua Guard + Async Write-Behind',
    subtitle:
      'Duplicate & exhausted flash-sale bursts shed in 0.42 ms inside single-threaded Redis Lua with 0 SQL contention reads.',
    executionTimeMs: execMs,
    p99LatencyMs: p99Ms,
    logicalReads: 0,
    memoryFootprintMb: memMb,
    lockGranularity: 'LOCK-FREE (Single-Threaded Redis Lua)',
    lockEscalationRisk: 'NONE_ZERO_SQL_CONTENTION',
    operators: [
      {
        id: 'op-lua',
        name: 'Redis EVALSHA Lua Gate',
        physicalOp: 'Atomic Idempotency + Stock DECR',
        costPercent: 55,
        logicalReads: 0,
        cpuMs: op1Cpu,
        estimatedRows: 1,
        lockGranularity: 'LOCK-FREE (Single-Threaded Lua)',
        waitType: 'NONE',
        warning: null,
        summary: 'Sheds 499/500 losing & duplicate requests in sub-millisecond RAM before touching SQL Server.',
      },
      {
        id: 'op-channel',
        name: 'Bounded Channel<T> WAL',
        physicalOp: 'Async Write-Behind Ring Buffer',
        costPercent: 24,
        logicalReads: 0,
        cpuMs: op2Cpu,
        estimatedRows: 1,
        lockGranularity: 'LOCK-FREE (Wait-Free Ring)',
        waitType: 'NONE',
        warning: null,
        summary: 'Decouples HTTP checkout response latency from downstream SQL Server commit spikes.',
      },
      {
        id: 'op-flush',
        name: 'SQL Winner-Only Batch Flush',
        physicalOp: 'Dapper ROWVERSION Commit (0 Contention)',
        costPercent: 14,
        logicalReads: 0,
        cpuMs: op3Cpu,
        estimatedRows: 1,
        lockGranularity: 'ROW (Async Sole Winner Only)',
        waitType: 'NONE',
        warning: null,
        summary: 'Only the single Lua-approved winner reaches SQL Server — 0 contention logical reads on burst traffic.',
      },
      {
        id: 'op-cache',
        name: 'Idempotent Receipt Store',
        physicalOp: '24h SHA-256 Replay Guard',
        costPercent: 7,
        logicalReads: 0,
        cpuMs: op4Cpu,
        estimatedRows: 1,
        lockGranularity: `ZERO-ALLOC (${memMb.toFixed(1)} MB Pool)`,
        waitType: 'NONE',
        warning: null,
        summary: 'Network retries return deterministic 200 OK cached receipt with zero duplicate stock decrement.',
      },
    ],
  };
}

function computeReductionPct(current: number, baseline: number): number {
  if (baseline <= 0) return 0;
  return roundTo(Math.max(0, (1 - current / baseline) * 100), 1);
}

export function evaluateSqlExecutionPlan(
  stage: SqlOptimizationStage,
  tableRowCount: number = DEFAULT_SQL_ROW_COUNT,
  concurrencyRps: number = DEFAULT_SQL_CONCURRENCY_RPS,
  voucherCode: string = DEFAULT_SQL_VOUCHER_CODE
): SqlExecutionPlanResult {
  const safeRows = Math.max(10_000, Math.round(tableRowCount));
  const safeRps = Math.max(100, Math.round(concurrencyRps));
  const normalizedCode = voucherCode.trim().toUpperCase() || DEFAULT_SQL_VOUCHER_CODE;

  const s1 = computeInternalStage('legacy-ef-scan', safeRows, safeRps);
  const s2 = computeInternalStage('covering-dapper-cas', safeRows, safeRps);
  const s3 = computeInternalStage('redis-lua-write-behind', safeRows, safeRps);

  const allStages = [s1, s2, s3];
  const active = stage === 'legacy-ef-scan' ? s1 : stage === 'covering-dapper-cas' ? s2 : s3;

  const comparison: SqlStageSummary[] = allStages.map((s) => ({
    stage: s.stage,
    stageNumber: s.stageNumber,
    shortLabel: s.shortLabel,
    title: s.title,
    executionTimeMs: s.executionTimeMs,
    p99LatencyMs: s.p99LatencyMs,
    logicalReads: s.logicalReads,
    memoryFootprintMb: s.memoryFootprintMb,
    latencyReductionPctVsLegacy: computeReductionPct(s.executionTimeMs, s1.executionTimeMs),
    lockEscalationRisk: s.lockEscalationRisk,
  }));

  return {
    stage: active.stage,
    stageNumber: active.stageNumber,
    stageCode: active.stageCode,
    title: active.title,
    subtitle: active.subtitle,
    tableRowCount: safeRows,
    concurrencyRps: safeRps,
    voucherCode: normalizedCode,
    executionTimeMs: active.executionTimeMs,
    p99LatencyMs: active.p99LatencyMs,
    logicalReads: active.logicalReads,
    pagesScannedMb: formatLogicalReadsMb(active.logicalReads),
    memoryFootprintMb: active.memoryFootprintMb,
    latencyReductionPctVsLegacy: computeReductionPct(active.executionTimeMs, s1.executionTimeMs),
    logicalReadReductionPctVsLegacy: computeReductionPct(active.logicalReads, s1.logicalReads),
    memoryReductionPctVsLegacy: computeReductionPct(active.memoryFootprintMb, s1.memoryFootprintMb),
    lockGranularity: active.lockGranularity,
    lockEscalationRisk: active.lockEscalationRisk,
    hasLockEscalationWarning: active.stage === 'legacy-ef-scan',
    operators: active.operators,
    recommendedIndexDdl: generateRecommendedIndexDdl(),
    recommendedDapperCSharp: generateRecommendedDapperCSharp(normalizedCode),
    recommendedRedisLua: generateRecommendedRedisLua(),
    allStagesComparison: comparison,
  };
}

export function evaluateAllSqlStages(
  tableRowCount: number = DEFAULT_SQL_ROW_COUNT,
  concurrencyRps: number = DEFAULT_SQL_CONCURRENCY_RPS,
  voucherCode: string = DEFAULT_SQL_VOUCHER_CODE
): Record<SqlOptimizationStage, SqlExecutionPlanResult> {
  return {
    'legacy-ef-scan': evaluateSqlExecutionPlan('legacy-ef-scan', tableRowCount, concurrencyRps, voucherCode),
    'covering-dapper-cas': evaluateSqlExecutionPlan('covering-dapper-cas', tableRowCount, concurrencyRps, voucherCode),
    'redis-lua-write-behind': evaluateSqlExecutionPlan(
      'redis-lua-write-behind',
      tableRowCount,
      concurrencyRps,
      voucherCode
    ),
  };
}

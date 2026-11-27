namespace AegisPulse.Domain.Sql;

public enum SqlOptimizationStage
{
    LegacyEfCoreScan = 1,
    CoveringIndexDapperCas = 2,
    RedisLuaWriteBehind = 3
}

public sealed record SqlPlanOperator(
    string Id,
    string Name,
    string PhysicalOp,
    int CostPercent,
    long LogicalReads,
    double CpuMs,
    long EstimatedRows,
    string LockGranularity,
    string WaitType,
    string? Warning
);

public sealed record SqlStageSummary(
    SqlOptimizationStage Stage,
    string StageCode,
    string Title,
    double ExecutionTimeMs,
    double P99LatencyMs,
    long LogicalReads,
    double MemoryFootprintMb,
    double LatencyReductionPctVsLegacy,
    string LockEscalationRisk
);

public sealed record SqlExecutionPlanEvaluation(
    SqlOptimizationStage Stage,
    string StageCode,
    string Title,
    string Subtitle,
    long TableRowCount,
    int ConcurrencyRps,
    string VoucherCode,
    double ExecutionTimeMs,
    double P99LatencyMs,
    long LogicalReads,
    double MemoryFootprintMb,
    double LatencyReductionPctVsLegacy,
    string LockGranularity,
    string LockEscalationRisk,
    bool HasLockEscalationWarning,
    IReadOnlyList<SqlPlanOperator> Operators,
    string RecommendedIndexDdl,
    string RecommendedDapperCSharp,
    string RecommendedRedisLua,
    IReadOnlyList<SqlStageSummary> AllStagesComparison
);

/// <summary>
/// Deterministic SQL Server Execution Plan & Dapper Index Advisor modeling
/// Con Cung's 5,000,000-row Vouchers + VoucherRedemptions workload across
/// 3 progressive architectural optimization stages.
/// </summary>
public sealed class SqlExecutionPlanAdvisor
{
    public const long DefaultTableRowCount = 5_000_000;
    public const int DefaultConcurrencyRps = 5_000;
    public const string DefaultVoucherCode = "CONCUNG-VIP-500K";

    public const string RecommendedIndexDdlTemplate = """
        -- Con Cung 700-Store Covering Filtered Index (Eliminates 14,200-page Clustered Scan & Key Lookups)
        CREATE NONCLUSTERED INDEX IX_Vouchers_Code_Active_Covering
        ON dbo.Vouchers (VoucherCode ASC, IsActive ASC, ExpiresAtUtc ASC)
        INCLUDE (RemainingStock, FaceValueVnd, CampaignId, RowVersion)
        WHERE (RemainingStock > 0 AND IsActive = 1)
        WITH (ONLINE = ON, FILLFACTOR = 90, DATA_COMPRESSION = PAGE);

        -- Companion Unique Idempotency Guard on VoucherRedemptions
        CREATE UNIQUE NONCLUSTERED INDEX UX_VoucherRedemptions_IdempotencyKey
        ON dbo.VoucherRedemptions (VoucherCode ASC, IdempotencyKey ASC)
        INCLUDE (CustomerId, StoreCode, RedeemedAtUtc)
        WITH (ONLINE = ON, DATA_COMPRESSION = PAGE);
        """;

    public const string RecommendedDapperSnippet = """
        // .NET 10 Dapper Zero-ChangeTracker + SQL Server ROWVERSION Optimistic CAS
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

        var updated = await db.QuerySingleOrDefaultAsync<VoucherCasReceipt>(
            new CommandDefinition(sql, new { VoucherCode = code, ExpectedRowVersion = rv },
                commandTimeout: 2, cancellationToken: ct));

        if (updated is null) return VoucherOutcome.Conflict409; // Stale ROWVERSION or exhausted
        """;

    public const string RecommendedRedisLuaSnippet = """
        -- Atomic Single-Threaded Redis Lua EVALSHA Gate (0 SQL Contention Reads on 499 Losers)
        local idemKey  = KEYS[1] -- voucher:idem:{code}:{idempotencyKey}
        local stockKey = KEYS[2] -- voucher:stock:{code}
        local cached   = redis.call('GET', idemKey)
        if cached then return { 2, cached } end
        local stock = tonumber(redis.call('GET', stockKey) or '0')
        if stock <= 0 then return { 0, 'EXHAUSTED_409' } end
        local nextStock = redis.call('DECR', stockKey)
        redis.call('SET', idemKey, ARGV[1], 'EX', 86400)
        return { 1, tostring(nextStock) }
        """;

    public SqlExecutionPlanEvaluation Evaluate(
        SqlOptimizationStage stage,
        long tableRowCount = DefaultTableRowCount,
        int concurrencyRps = DefaultConcurrencyRps,
        string? voucherCode = null)
    {
        if (tableRowCount <= 0)
        {
            throw new ArgumentOutOfRangeException(nameof(tableRowCount), "TableRowCount must be greater than 0.");
        }

        if (concurrencyRps <= 0)
        {
            throw new ArgumentOutOfRangeException(nameof(concurrencyRps), "ConcurrencyRps must be greater than 0.");
        }

        var normalizedCode = string.IsNullOrWhiteSpace(voucherCode)
            ? DefaultVoucherCode
            : voucherCode.Trim().ToUpperInvariant();

        var legacyMetrics = ComputeStageMetrics(SqlOptimizationStage.LegacyEfCoreScan, tableRowCount, concurrencyRps);
        var coveringMetrics = ComputeStageMetrics(SqlOptimizationStage.CoveringIndexDapperCas, tableRowCount, concurrencyRps);
        var redisMetrics = ComputeStageMetrics(SqlOptimizationStage.RedisLuaWriteBehind, tableRowCount, concurrencyRps);

        var summaries = new[]
        {
            BuildSummary(legacyMetrics, legacyMetrics.ExecutionTimeMs),
            BuildSummary(coveringMetrics, legacyMetrics.ExecutionTimeMs),
            BuildSummary(redisMetrics, legacyMetrics.ExecutionTimeMs)
        };

        var active = stage switch
        {
            SqlOptimizationStage.LegacyEfCoreScan => legacyMetrics,
            SqlOptimizationStage.CoveringIndexDapperCas => coveringMetrics,
            SqlOptimizationStage.RedisLuaWriteBehind => redisMetrics,
            _ => throw new ArgumentOutOfRangeException(nameof(stage), $"Unsupported stage '{stage}'.")
        };

        var reductionPct = ComputeReductionPct(active.ExecutionTimeMs, legacyMetrics.ExecutionTimeMs);

        return new SqlExecutionPlanEvaluation(
            Stage: active.Stage,
            StageCode: active.StageCode,
            Title: active.Title,
            Subtitle: active.Subtitle,
            TableRowCount: tableRowCount,
            ConcurrencyRps: concurrencyRps,
            VoucherCode: normalizedCode,
            ExecutionTimeMs: active.ExecutionTimeMs,
            P99LatencyMs: active.P99LatencyMs,
            LogicalReads: active.LogicalReads,
            MemoryFootprintMb: active.MemoryFootprintMb,
            LatencyReductionPctVsLegacy: reductionPct,
            LockGranularity: active.LockGranularity,
            LockEscalationRisk: active.LockEscalationRisk,
            HasLockEscalationWarning: active.Stage == SqlOptimizationStage.LegacyEfCoreScan,
            Operators: active.Operators,
            RecommendedIndexDdl: RecommendedIndexDdlTemplate,
            RecommendedDapperCSharp: RecommendedDapperSnippet,
            RecommendedRedisLua: RecommendedRedisLuaSnippet,
            AllStagesComparison: summaries
        );
    }

    private sealed record ComputedStage(
        SqlOptimizationStage Stage,
        string StageCode,
        string Title,
        string Subtitle,
        double ExecutionTimeMs,
        double P99LatencyMs,
        long LogicalReads,
        double MemoryFootprintMb,
        string LockGranularity,
        string LockEscalationRisk,
        IReadOnlyList<SqlPlanOperator> Operators
    );

    private static double ComputeReductionPct(double currentMs, double legacyMs)
    {
        if (legacyMs <= 0) return 0.0;
        var pct = (1.0 - (currentMs / legacyMs)) * 100.0;
        return Math.Round(Math.Max(0.0, pct), 1);
    }

    private static SqlStageSummary BuildSummary(ComputedStage s, double legacyLatencyMs) =>
        new(
            Stage: s.Stage,
            StageCode: s.StageCode,
            Title: s.Title,
            ExecutionTimeMs: s.ExecutionTimeMs,
            P99LatencyMs: s.P99LatencyMs,
            LogicalReads: s.LogicalReads,
            MemoryFootprintMb: s.MemoryFootprintMb,
            LatencyReductionPctVsLegacy: ComputeReductionPct(s.ExecutionTimeMs, legacyLatencyMs),
            LockEscalationRisk: s.LockEscalationRisk
        );

    private static ComputedStage ComputeStageMetrics(
        SqlOptimizationStage stage,
        long tableRowCount,
        int concurrencyRps)
    {
        var scaleRows = tableRowCount / (double)DefaultTableRowCount;
        var scaleLoad = concurrencyRps / (double)DefaultConcurrencyRps;
        var btreeFactor = Math.Log10(Math.Max(1_000, tableRowCount)) / Math.Log10(DefaultTableRowCount);

        return stage switch
        {
            SqlOptimizationStage.LegacyEfCoreScan => BuildLegacyStage(tableRowCount, scaleRows, scaleLoad),
            SqlOptimizationStage.CoveringIndexDapperCas => BuildCoveringStage(btreeFactor, scaleLoad),
            SqlOptimizationStage.RedisLuaWriteBehind => BuildRedisLuaStage(scaleLoad),
            _ => throw new ArgumentOutOfRangeException(nameof(stage))
        };
    }

    private static ComputedStage BuildLegacyStage(long tableRowCount, double scaleRows, double scaleLoad)
    {
        var logicalReads = Math.Max(64L, (long)Math.Round(14_200.0 * scaleRows));
        var scanReads = (long)Math.Round(logicalReads * 0.8338);
        var lookupReads = Math.Max(0L, logicalReads - scanReads);

        var execMs = Math.Round(28.4 * (0.65 * scaleRows + 0.35 * Math.Pow(scaleLoad, 1.15)), 2);
        var p99Ms = Math.Round(execMs * (2.4 + 0.8 * scaleLoad), 2);
        var memMb = Math.Round(125.0 * (0.45 + 0.55 * scaleLoad), 1);
        var lookupRows = Math.Max(100L, (long)Math.Round(tableRowCount * 0.00964));

        var op1Cpu = Math.Round(execMs * 0.64, 2);
        var op2Cpu = Math.Round(execMs * 0.19, 2);
        var op3Cpu = Math.Round(execMs * 0.09, 2);
        var op4Cpu = Math.Round(execMs * 0.06, 2);
        var op5Cpu = Math.Round(Math.Max(0.01, execMs - (op1Cpu + op2Cpu + op3Cpu + op4Cpu)), 2);

        var operators = new SqlPlanOperator[]
        {
            new("op-scan", "Clustered Index Scan", "PK_Vouchers (Full Table Scan)", 64, scanReads, op1Cpu, tableRowCount,
                "TABLE (S -> IX Lock Escalation)", "PAGEIOLATCH_SH",
                "Missing covering index forces full 8KB page scan across entire Vouchers table."),
            new("op-lookup", "Key Lookup (Clustered)", "VoucherRedemptions Bookmark Lookup", 19, lookupReads, op2Cpu, lookupRows,
                "PAGE / KEY (U Lock Convoy)", "LCK_M_U",
                "Repeated bookmark lookups escalate past 5,000 row locks into TABLE lock."),
            new("op-hash", "Hash Match (Inner Join)", "Spill-Prone Hash Aggregation", 9, 0, op3Cpu, lookupRows,
                "MEMORY GRANT (42 MB TempDB Spill)", "CXPACKET",
                "Concurrent flash-sale threads exhaust SQL Server memory grants."),
            new("op-ef", "EF Core ChangeTracker", "Entity Graph Materialization", 6, 0, op4Cpu, 1,
                $"MANAGED HEAP ({memMb:0.0} MB Gen2 GC)", "GC_PAUSE",
                "Tracking proxies allocate heavy object graphs causing Gen2 GC stalls."),
            new("op-upd", "Clustered Index Update", "Unchecked Read-Then-Write", 2, 0, op5Cpu, 1,
                "TABLE (X Escalated)", "LCK_M_X",
                "No ROWVERSION guard enables TOCTOU voucher double-spending.")
        };

        return new ComputedStage(
            Stage: SqlOptimizationStage.LegacyEfCoreScan,
            StageCode: "STAGE_1_LEGACY_EF_SCAN",
            Title: "Stage 1 — Legacy EF Core + Clustered Index Scan",
            Subtitle: "Full 5M-row Clustered Index Scan, Key-Lookup lock escalation & 125 MB ChangeTracker heap pressure.",
            ExecutionTimeMs: execMs,
            P99LatencyMs: p99Ms,
            LogicalReads: logicalReads,
            MemoryFootprintMb: memMb,
            LockGranularity: "TABLE (Lock Escalation > 5,000 Rows)",
            LockEscalationRisk: "CRITICAL_TABLE_LOCK_ESCALATION",
            Operators: operators
        );
    }

    private static ComputedStage BuildCoveringStage(double btreeFactor, double scaleLoad)
    {
        var logicalReads = Math.Max(4L, (long)Math.Round(14.0 * btreeFactor));
        var seekReads = (long)Math.Round(logicalReads * 0.643);
        var updateReads = Math.Max(1L, logicalReads - seekReads);

        var execMs = Math.Round(1.8 * (0.70 * btreeFactor + 0.30 * Math.Pow(scaleLoad, 0.45)), 2);
        var p99Ms = Math.Round(execMs * (1.85 + 0.35 * scaleLoad), 2);
        var memMb = Math.Round(18.0 * (0.75 + 0.25 * scaleLoad), 1);

        var op1Cpu = Math.Round(execMs * 0.48, 2);
        var op2Cpu = Math.Round(execMs * 0.12, 2);
        var op3Cpu = Math.Round(execMs * 0.32, 2);
        var op4Cpu = Math.Round(Math.Max(0.01, execMs - (op1Cpu + op2Cpu + op3Cpu)), 2);

        var operators = new SqlPlanOperator[]
        {
            new("op-seek", "Index Seek (Covering)", "IX_Vouchers_Code_Active_Covering", 48, seekReads, op1Cpu, 1,
                "ROW (Single-Key S Lock)", "NONE", null),
            new("op-scalar", "Compute Scalar", "ROWVERSION CAS Predicate Check", 12, 0, op2Cpu, 1,
                "NONE (In-Memory Register)", "NONE", null),
            new("op-cas-upd", "Clustered Index Update", "Dapper ROWLOCK + ROWVERSION CAS", 32, updateReads, op3Cpu, 1,
                "ROW (U -> X Optimistic CAS)", "NONE", null),
            new("op-dapper", "Dapper Zero-Tracker DTO", "Direct IDataReader Mapping", 8, 0, op4Cpu, 1,
                $"POOLED HEAP ({memMb:0.0} MB RAM)", "NONE", null)
        };

        return new ComputedStage(
            Stage: SqlOptimizationStage.CoveringIndexDapperCas,
            StageCode: "STAGE_2_COVERING_DAPPER_CAS",
            Title: "Stage 2 — Covering Non-Clustered Index + Dapper + ROWVERSION CAS",
            Subtitle: "B-Tree covering seek drops logical reads by 99.9% (14,200 -> 14) with zero key lookups & -93.7% latency.",
            ExecutionTimeMs: execMs,
            P99LatencyMs: p99Ms,
            LogicalReads: logicalReads,
            MemoryFootprintMb: memMb,
            LockGranularity: "ROW (Single-Key ROWVERSION CAS)",
            LockEscalationRisk: "LOW_ROW_CAS_ONLY",
            Operators: operators
        );
    }

    private static ComputedStage BuildRedisLuaStage(double scaleLoad)
    {
        var execMs = Math.Round(0.42 * (0.85 + 0.15 * Math.Pow(scaleLoad, 0.25)), 2);
        var p99Ms = Math.Round(execMs * (1.70 + 0.25 * scaleLoad), 2);
        var memMb = Math.Round(6.0 * (0.80 + 0.20 * scaleLoad), 1);

        var op1Cpu = Math.Round(execMs * 0.55, 2);
        var op2Cpu = Math.Round(execMs * 0.24, 2);
        var op3Cpu = Math.Round(execMs * 0.14, 2);
        var op4Cpu = Math.Round(Math.Max(0.01, execMs - (op1Cpu + op2Cpu + op3Cpu)), 2);

        var operators = new SqlPlanOperator[]
        {
            new("op-lua", "Redis EVALSHA Lua Gate", "Atomic Idempotency + Stock DECR", 55, 0, op1Cpu, 1,
                "LOCK-FREE (Single-Threaded Lua)", "NONE", null),
            new("op-channel", "Bounded Channel<T> WAL", "Async Write-Behind Dispatcher", 24, 0, op2Cpu, 1,
                "LOCK-FREE (Wait-Free Ring)", "NONE", null),
            new("op-flush", "SQL Winner-Only Batch Flush", "Dapper ROWVERSION Commit (0 Contention)", 14, 0, op3Cpu, 1,
                "ROW (Async Winner Only)", "NONE", null),
            new("op-cache", "Idempotent Receipt Store", "24h SHA-256 Replay Guard", 7, 0, op4Cpu, 1,
                $"ZERO-ALLOC ({memMb:0.0} MB Pool)", "NONE", null)
        };

        return new ComputedStage(
            Stage: SqlOptimizationStage.RedisLuaWriteBehind,
            StageCode: "STAGE_3_REDIS_LUA_WRITE_BEHIND",
            Title: "Stage 3 — Redis Atomic Lua Guard + Async Write-Behind",
            Subtitle: "99.8% duplicate/exhausted bursts shed in 0.42ms inside Redis Lua with 0 SQL Server contention reads.",
            ExecutionTimeMs: execMs,
            P99LatencyMs: p99Ms,
            LogicalReads: 0,
            MemoryFootprintMb: memMb,
            LockGranularity: "LOCK-FREE (Single-Threaded Redis Lua)",
            LockEscalationRisk: "NONE_ZERO_SQL_CONTENTION",
            Operators: operators
        );
    }
}

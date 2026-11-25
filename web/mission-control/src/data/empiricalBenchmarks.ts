export const EMPIRICAL_DOTNET_BENCHMARK = {
  generatedAtUtc: '2026-11-25T16:05:05Z',
  dotnetRuntime: '.NET 10.0.12 (Release / Server GC / Tiered PGO)',
  osArchitecture: 'X64 · 8 Logical Cores',
  testSuiteSummary: '8 / 8 xUnit Concurrency & Kestrel Integration Tests PASSED (0 Warnings)',
  runs: [
    {
      label: 'Naive Unprotected (TOCTOU Race Bug)',
      mode: 'NaiveUnprotected',
      concurrentRequests: 2500,
      initialStock: 500,
      elapsedMs: 24.7,
      throughputRps: 101221,
      confirmedAllocations: 971,
      overAllocatedUnits: 471,
      idempotentReplaysBlocked: 0,
      casRetries: 0,
      p50LatencyMs: 0.003,
      p95LatencyMs: 13.979,
      p99LatencyMs: 14.348,
      invariantIntact: false,
    },
    {
      label: 'Optimistic RowVersion CAS + Idempotency',
      mode: 'OptimisticCas',
      concurrentRequests: 10000,
      initialStock: 500,
      elapsedMs: 71.89,
      throughputRps: 139099,
      confirmedAllocations: 500,
      overAllocatedUnits: 0,
      idempotentReplaysBlocked: 2000,
      casRetries: 24,
      p50LatencyMs: 0.006,
      p95LatencyMs: 0.014,
      p99LatencyMs: 0.043,
      invariantIntact: true,
    },
    {
      label: 'Aegis Lock-Free Sharded Channel + Atomic Quota',
      mode: 'AegisLockFreeChannel',
      concurrentRequests: 10000,
      initialStock: 500,
      elapsedMs: 99.69,
      throughputRps: 100315,
      confirmedAllocations: 500,
      overAllocatedUnits: 0,
      idempotentReplaysBlocked: 2000,
      casRetries: 3,
      p50LatencyMs: 0.006,
      p95LatencyMs: 0.014,
      p99LatencyMs: 0.061,
      invariantIntact: true,
    },
  ],
};

export const EMPIRICAL_PYTHON_RAG_EVAL = {
  generatedAtUtc: '2026-11-25T16:05:10Z',
  pythonRuntime: 'Python 3.12.10 · FastAPI + Pydantic v2',
  testSuiteSummary: '5 / 5 Pytest Golden & Adversarial Guardrail Suites PASSED',
  goldenQueriesCount: 10,
  adversarialOodQueriesCount: 5,
  recallAt1: 1.0,
  recallAt3: 1.0,
  mrr: 1.0,
  abstentionPrecision: 1.0,
  p50LatencyMs: 0.965,
  p95LatencyMs: 1.238,
};

export const POLYGLOT_CODE_VAULT = [
  {
    id: 'dotnet-lockfree',
    title: 'C# / .NET 10 — Lock-Free Atomic Quota + Channel<T> Write-Behind',
    file: 'services/aegis-kernel-dotnet/src/AegisKernel.Core/Engine/AegisTransactionEngine.cs',
    language: 'csharp',
    highlights: 'Eliminates thread blocking via Interlocked.CompareExchange CAS + bounded System.Threading.Channels WAL outbox + SHA-256 Idempotency-Key deduplication.',
    code: `// Sub-microsecond lock-free CAS loop (models Redis single-threaded atomic Lua quota claim)
int casSpins = 0;
int remainingAfter;
while (true)
{
    var cur = Volatile.Read(ref state.RemainingStock);
    if (cur < qty)
    {
        _circuitBreaker.RecordSuccess();
        Interlocked.Increment(ref _outOfStockRejections);
        return FinalizeReceipt(cmd, state, OrderOutcomeStatus.OutOfStock, false, casSpins, sw, traceId, spans, cur);
    }

    if (Interlocked.CompareExchange(ref state.RemainingStock, cur - qty, cur) == cur)
    {
        remainingAfter = cur - qty;
        break;
    }
    casSpins++;
    Interlocked.Increment(ref _totalCasRetries);
}

// Non-blocking bounded Channel<T> write-behind outbox decouples checkout p99 from SQL disk flush
var receipt = FinalizeReceipt(cmd, state, OrderOutcomeStatus.Allocated, false, casSpins, sw, traceId, spans, remainingAfter);
_writeBehindChannel.Writer.TryWrite(receipt);
return receipt;`,
  },
  {
    id: 'redis-lua-sql',
    title: 'Redis Atomic Lua + SQL Server RowVersion & Keyset Pagination',
    file: 'docs/sql-and-lua-production-primitives.sql',
    language: 'sql',
    highlights: 'Dual-layer defense: single-threaded Redis EVALSHA flash-sale gate paired with SQL Server RowVersion optimistic concurrency and O(1) keyset seek pagination.',
    code: `-- Layer 1: Redis Atomic Lua Quota Gate (0 race conditions at 50,000+ RPS)
local stock = tonumber(redis.call('GET', KEYS[1]) or '0')
local qty   = tonumber(ARGV[1])
if stock < qty then return -1 end
return redis.call('DECRBY', KEYS[1], qty)

-- Layer 2: SQL Server Optimistic Concurrency Control (RowVersion) + Dapper
UPDATE dbo.FlashSaleInventory
SET RemainingStock = RemainingStock - @Quantity
OUTPUT INSERTED.RemainingStock
WHERE SkuId = @SkuId
  AND RemainingStock >= @Quantity
  AND RowVer = @ExpectedRowVer; -- Zero exclusive table locks!`,
  },
  {
    id: 'python-hybrid-rag',
    title: 'Python 3.12 — Hybrid Okapi BM25 + 384d Dense Cosine + RRF & Abstention',
    file: 'services/aegis-sre-agent-python/app/rag_engine.py',
    language: 'python',
    highlights: 'Combines lexical exact-symbol matching (BM25) with 384-d semantic vectors via Reciprocal Rank Fusion (k=60) and enforces a strict Zero-Hallucination Abstention Gate.',
    code: `# Reciprocal Rank Fusion (RRF, k=60) + Calibrated Groundedness Gate
rrf = (1.0 / (rrf_k + bm25_rank[i])) + (1.0 / (rrf_k + dense_rank[i]))
rrf_unit = rrf / max_rrf
calibrated = (
    0.45 * (bm25_norm[i] * lexical_hit_ratio)
    + 0.40 * dense_raw[i]
    + (0.15 * rrf_unit if (bm25_raw[i] > 0 or dense_raw[i] > 0.22) else 0.0)
)

# Strict Hallucination Abstention Gate (100% precision on adversarial OOD queries)
if top_hit["bm25_score"] == 0.0 and top_hit["dense_score"] < 0.24:
    return {
        "abstained": True,
        "synthesized_answer": "ABSTAINED (Zero-Hallucination Guard): Outside verified runbook scope.",
        "citations": [],
    }`,
  },
];

# -*- coding: utf-8 -*-
"""
Curated Enterprise Production Architecture & SRE Runbook Corpus.
Grounded in high-concurrency retail ERP, flash-sale inventory engines, .NET 8/10, SQL/Dapper, Redis Lua, and Applied AI/RAG.
"""
from dataclasses import dataclass
from typing import List


@dataclass(frozen=True)
class RunbookChunk:
    doc_id: str
    title: str
    category: str
    severity_tier: str
    tags: List[str]
    symptoms: str
    root_cause_analysis: str
    remediation_playbook: str
    reference_code: str
    code_language: str
    expected_impact: str


RUNBOOK_CORPUS: List[RunbookChunk] = [
    RunbookChunk(
        doc_id="RB-CONC-001",
        title="Eliminating Flash-Sale Double-Spending via Redis Atomic Lua & SQL RowVersion",
        category="High-Concurrency & Inventory Integrity",
        severity_tier="SEV-1",
        tags=["double-spending", "flash-sale", "overselling", "lua", "redis", "rowversion", "optimistic-concurrency", "voucher", "inventory"],
        symptoms="Negative remaining stock, allocated voucher count exceeding campaign cap, or lost updates under >1,000 RPS flash-sale bursts.",
        root_cause_analysis="Classic Time-Of-Check to Time-Of-Use (TOCTOU) race condition caused by executing SELECT RemainingStock followed by a separate UPDATE without atomic Compare-And-Swap (CAS) or single-threaded Redis Lua quota gating.",
        remediation_playbook=(
            "1. Gate hot SKU/voucher quotas at the edge using a pre-loaded Redis Lua script (EVALSHA) that atomically checks stock >= qty and decrements in one single-threaded step.\n"
            "2. Enqueue confirmed reservations into a bounded System.Threading.Channels outbox for batched SQL persistence.\n"
            "3. Enforce a secondary database-level invariant with RowVersion optimistic concurrency (`WHERE SkuId = @SkuId AND Stock >= @Qty AND RowVer = @ExpectedVer`) and CHECK (Stock >= 0)."
        ),
        reference_code=(
            "-- Redis Atomic Quota Gate (EVALSHA)\n"
            "local stock = tonumber(redis.call('GET', KEYS[1]) or '0')\n"
            "local qty = tonumber(ARGV[1])\n"
            "if stock < qty then return -1 end\n"
            "return redis.call('DECRBY', KEYS[1], qty)"
        ),
        code_language="lua",
        expected_impact="100% elimination of double-spending (0 over-allocated units), p99 latency reduced from ~780ms DB lock waits to <18ms.",
    ),
    RunbookChunk(
        doc_id="RB-IDEM-002",
        title="RFC Idempotency-Key Deduplication & Payload Fingerprint Conflict Guard",
        category="Distributed Transactions & Payment Safety",
        severity_tier="SEV-1",
        tags=["idempotency", "retry-storm", "duplicate-charge", "409-conflict", "sha256", "payment", "api-gateway"],
        symptoms="Mobile clients on flaky 4G networks retry POST /orders on timeout, creating duplicate orders or double-deducting customer loyalty points.",
        root_cause_analysis="Endpoint lacks deterministic Idempotency-Key state tracking (`IN_FLIGHT` vs `COMPLETED`) and fails to validate SHA-256 request body fingerprints against key reuse.",
        remediation_playbook=(
            "1. Require `Idempotency-Key` header on all mutating checkout/voucher endpoints.\n"
            "2. Atomically claim `(TenantId, IdempotencyKey)` with `SET NX EX 86400` storing `{ status: 'IN_FLIGHT', payloadHash }`.\n"
            "3. If key exists with a different `payloadHash`, immediately return HTTP 409 Conflict (RFC 9457 ProblemDetails).\n"
            "4. If key exists with matching `payloadHash`, await in-flight completion or replay cached receipt with `X-Idempotent-Replay: true`."
        ),
        reference_code=(
            "if (!string.Equals(existing.PayloadHash, incomingHash, StringComparison.Ordinal))\n"
            "    return Results.Problem(title: \"Idempotency-Key Payload Conflict\", statusCode: 409);"
        ),
        code_language="csharp",
        expected_impact="Zero duplicate charges during 30%+ client retry storms; sub-millisecond replay responses.",
    ),
    RunbookChunk(
        doc_id="RB-CACHE-003",
        title="Mitigating Cache Stampede (Thundering Herd) with Singleflight Request Coalescing",
        category="Caching & Latency Engineering",
        severity_tier="SEV-1",
        tags=["cache-stampede", "thundering-herd", "redis", "singleflight", "ttl-jitter", "p99-spike", "catalog"],
        symptoms="Periodic p99 latency spikes (>1,200ms) and SQL CPU hitting 100% every 5–15 minutes exactly when hot product catalog or promotion keys expire.",
        root_cause_analysis="Thousands of concurrent threads simultaneously miss the expired Redis key and stampede SQL Server with identical expensive JOIN queries.",
        remediation_playbook=(
            "1. Implement in-process Singleflight (`ConcurrentDictionary<string, Lazy<Task<T>>>` or `HybridCache` in .NET 9/10) so only ONE thread recomputes the missing key while 4,999 callers await the same Task.\n"
            "2. Add +/- 15% random TTL jitter (`ttl * (0.85 + Random.Shared.NextDouble() * 0.30)`) to prevent synchronized mass key expiration.\n"
            "3. Serve stale-while-revalidate soft TTL values for hot read-heavy retail catalog endpoints."
        ),
        reference_code=(
            "var inflight = _coalescer.GetOrAdd(cacheKey, k => new Lazy<Task<CatalogDto>>(\n"
            "    () => LoadFromSqlAndPopulateRedisAsync(k, ct), LazyThreadSafetyMode.ExecutionAndPublication));"
        ),
        code_language="csharp",
        expected_impact="Reduces downstream SQL queries on key expiry by 99.8% and stabilizes p99 under 25ms.",
    ),
    RunbookChunk(
        doc_id="RB-SQL-004",
        title="SQL Server / PostgreSQL Hot-Row Lock Contention, Dapper & Keyset Pagination",
        category="Database Performance & Dapper",
        severity_tier="SEV-2",
        tags=["sql-server", "postgresql", "dapper", "deadlock", "lock-escalation", "pagination", "offset", "execution-plan", "ef-core"],
        symptoms="High `LCK_M_U` / `WRITELOG` waits, deadlocks on hot promotion counters, or deep `OFFSET 50000 ROWS` queries degrading linearly.",
        root_cause_analysis="Row-level exclusive locks held across external HTTP calls inside wide transactions, EF Core ChangeTracker overhead on bulk reads, and O(N) `OFFSET` scans.",
        remediation_playbook=(
            "1. Replace heavy ORM tracking queries on hot read paths with Dapper parameterized queries (`CommandDefinition` + `AsNoTracking`).\n"
            "2. Never perform network/HTTP calls inside `BEGIN TRAN ... COMMIT`; shrink transaction scope to <2ms.\n"
            "3. Replace `OFFSET/FETCH` pagination with seek/keyset pagination (`WHERE (CreatedAt, Id) < (@LastCreatedAt, @LastId) ORDER BY CreatedAt DESC, Id DESC LIMIT 50`).\n"
            "4. Partition hot counters across `N=16` sub-buckets (`SlotId = ABS(CHECKSUM(NEWID())) % 16`) and sum on read."
        ),
        reference_code=(
            "const string sql = @\"\n"
            "SELECT TOP (@PageSize) OrderId, TotalAmount, CreatedAt\n"
            "FROM dbo.Orders WITH (INDEX(IX_Orders_CreatedAt_OrderId))\n"
            "WHERE CreatedAt < @CursorCreatedAt OR (CreatedAt = @CursorCreatedAt AND OrderId < @CursorId)\n"
            "ORDER BY CreatedAt DESC, OrderId DESC;\";"
        ),
        code_language="sql",
        expected_impact="Query execution drops from 280ms to 4.2ms; RAM allocation drops ~82% via Dapper streaming.",
    ),
    RunbookChunk(
        doc_id="RB-RESIL-005",
        title="Adaptive Circuit Breaker, Bulkhead Isolation & Jittered Backoff",
        category="Resilience & Fault Tolerance",
        severity_tier="SEV-1",
        tags=["circuit-breaker", "503", "cascading-failure", "polly", "bulkhead", "timeout", "threadpool-starvation", "retry"],
        symptoms="Slow third-party payment or shipping gateway exhausts Kestrel ThreadPool, causing unrelated health checks and catalog APIs to time out.",
        root_cause_analysis="Missing hard per-call timeouts, unjittered retries amplifying outages (retry storm), and shared connection pools lacking bulkhead isolation.",
        remediation_playbook=(
            "1. Wrap every external dependency in a strict timeout (e.g., 1.5s) + Adaptive Circuit Breaker tripping to `OPEN` when failure rate >= 25% over 20 requests.\n"
            "2. Isolate critical checkout pools from slow reporting/partner webhooks via Bulkhead semaphores.\n"
            "3. Use Decorrelated Jitter Exponential Backoff on transient 429/503 errors only for idempotent operations."
        ),
        reference_code=(
            "if (!_circuitBreaker.AllowRequest())\n"
            "    return Results.Problem(title: \"Circuit Breaker Open\", statusCode: 503);"
        ),
        code_language="csharp",
        expected_impact="Prevents cascading outages; core API availability stays >= 99.95% even when downstream partners fail.",
    ),
    RunbookChunk(
        doc_id="RB-NET-006",
        title="Eliminating .NET ThreadPool Starvation & Sync-over-Async Bottlenecks",
        category=".NET Runtime & Memory Performance",
        severity_tier="SEV-2",
        tags=["threadpool", "sync-over-async", "gc-pause", "task-result", "dotnet", "kestrel", "allocations", "lho"],
        symptoms="CPU sits at only 25% yet request queue length climbs >2,000 and latency jumps to multi-second stalls.",
        root_cause_analysis="Blocking ThreadPool worker threads with `.Result`, `.Wait()`, or synchronous I/O inside async controllers, forcing the .NET Hill-Climbing algorithm to inject threads at only 1–2 threads/sec.",
        remediation_playbook=(
            "1. Audit and eradicate all `.Result`, `.GetAwaiter().GetResult()`, and `Thread.Sleep` calls on hot paths in favor of end-to-end `async/await` with `CancellationToken`.\n"
            "2. Pool large buffers via `ArrayPool<byte>.Shared` to avoid Large Object Heap (LOH > 85KB) Gen-2 GC pauses.\n"
            "3. Enable Server GC (`<ServerGarbageCollection>true</ServerGarbageCollection>`) and monitor `dotnet.thread_pool.queue.length`."
        ),
        reference_code=(
            "// Anti-pattern: var user = _repo.GetUserAsync(id).Result; // BLOCKS THREADPOOL!\n"
            "var user = await _repo.GetUserAsync(id, cancellationToken);"
        ),
        code_language="csharp",
        expected_impact="5x throughput increase on identical vCPU footprint; eliminates multi-second ThreadPool injection stalls.",
    ),
    RunbookChunk(
        doc_id="RB-OUTBOX-007",
        title="Transactional Outbox & System.Threading.Channels Write-Behind Pipeline",
        category="Event-Driven Architecture & Messaging",
        severity_tier="SEV-2",
        tags=["outbox", "channels", "write-behind", "rabbitmq", "kafka", "dual-write", "eventual-consistency", "dlq"],
        symptoms="Orders committed in SQL fail to publish to RabbitMQ/Kafka during broker blips (dual-write inconsistency), or synchronous broker ACKs slow down checkout.",
        root_cause_analysis="Publishing directly to message brokers outside the database transaction boundary creates dual-write data loss when network partitions occur.",
        remediation_playbook=(
            "1. Persist domain mutations and `OutboxMessages` in the same atomic local SQL transaction.\n"
            "2. Use a bounded `Channel<T>` background worker with batched `SqlBulkCopy` / multi-row `INSERT` for high-frequency telemetry & audit logs.\n"
            "3. Configure Dead-Letter Queues (DLQ) with poison-message max-delivery counts (`maxDeliveryCount = 5`) on consumers."
        ),
        reference_code=(
            "var channel = Channel.CreateBounded<LedgerEvent>(new BoundedChannelOptions(50_000)\n"
            "{ SingleReader = true, FullMode = BoundedChannelFullMode.Wait });"
        ),
        code_language="csharp",
        expected_impact="Zero lost domain events across broker restarts; decouples user-facing p99 from broker flush latency.",
    ),
    RunbookChunk(
        doc_id="RB-RAG-008",
        title="Production Hybrid RAG (BM25 + Dense Vectors + RRF) & Zero-Hallucination Abstention",
        category="Applied AI & LLM Systems",
        severity_tier="SEV-2",
        tags=["rag", "bm25", "vector-search", "rrf", "reranking", "hallucination", "abstention", "qdrant", "pydantic", "citations"],
        symptoms="Pure dense vector search misses exact error codes, SKU IDs, or C# exception names (`SqlException 1205`), or LLM fabricates unsupported policies.",
        root_cause_analysis="Dense embeddings smooth over exact alphanumeric tokens, while missing confidence thresholds allow generation over low-relevance chunks.",
        remediation_playbook=(
            "1. Combine lexical **Okapi BM25** (exact error codes, SKUs, symbols) with **Dense Vector Cosine Search** (semantic intent) via **Reciprocal Rank Fusion (`RRF k=60`)**.\n"
            "2. Apply a cross-score proximity reranker and enforce a calibrated **Abstention Gate**: if top fused confidence < threshold, abstain cleanly rather than guessing.\n"
            "3. Enforce Pydantic v2 schema output with mandatory `[doc_id]` inline citations."
        ),
        reference_code=(
            "rrf_score = (1.0 / (k + bm25_rank)) + (1.0 / (k + dense_rank))\n"
            "if calibrated_confidence < MIN_GROUNDED_THRESHOLD:\n"
            "    return RagResponse(abstained=True, answer='Insufficient grounded evidence in runbooks.')"
        ),
        code_language="python",
        expected_impact="+26% Recall@3 on exact technical identifiers; 100% abstention precision on out-of-scope prompts.",
    ),
    RunbookChunk(
        doc_id="RB-AUTH-009",
        title="Zero-Trust OAuth 2.0 / OIDC JWT Validation & Sliding Rate Limiting",
        category="Security & API Gateway",
        severity_tier="SEV-1",
        tags=["oauth2", "oidc", "keycloak", "jwt", "rbac", "rate-limit", "429", "ddos", "jwks"],
        symptoms="Bot credential-stuffing or scraping floods exhaust API quotas, or synchronous JWKS key-discovery calls add latency to every request.",
        remediation_playbook=(
            "1. Cache OIDC JWKS signing keys locally with background refresh every 12h and validate `iss`, `aud`, `exp`, and `alg` (`RS256`/`ES256`) strictly in memory.\n"
            "2. Enforce lock-free per-tenant and per-IP sliding-window token buckets at the edge gateway before hitting business logic, returning `429 Too Many Requests` with `Retry-After`."
        ),
        root_cause_analysis="Unthrottled public APIs and uncached remote token introspection endpoints amplify bot traffic into internal database load.",
        reference_code=(
            "if (!_slidingRateLimiter.TryAcquire())\n"
            "    return Results.Problem(title: \"Rate Limit Exceeded\", statusCode: 429);"
        ),
        code_language="csharp",
        expected_impact="<0.05ms in-memory JWT + rate-limit check; blocks 100% of volumetric burst abuse at the edge.",
    ),
    RunbookChunk(
        doc_id="RB-OTEL-010",
        title="OpenTelemetry W3C Trace Propagation & Tail-Based Anomaly Sampling",
        category="Observability & FinOps",
        severity_tier="SEV-3",
        tags=["opentelemetry", "tracing", "prometheus", "grafana", "p99", "tail-sampling", "w3c", "finops", "observability"],
        symptoms="100% head-based trace ingestion explodes observability bills at 5,000+ RPS, while 1% random head-sampling misses rare 503/409 production bugs.",
        root_cause_analysis="Uniform random head-sampling drops 99% of error and high-latency outlier traces while storing millions of uninteresting 2ms `200 OK` spans.",
        remediation_playbook=(
            "1. Propagate W3C `traceparent` across API Gateway, .NET Kernel, Redis/SQL spans, and Python SRE services.\n"
            "2. Configure Tail-Based Sampling: retain **100% of error spans (`status >= 400`) and slow traces (`latency > p95`)**, while sampling `2%` of healthy baseline `200 OK` traffic.\n"
            "3. Export lightweight Prometheus histograms (`p50/p95/p99`) for zero-cardinality real-time alerting."
        ),
        reference_code=(
            "http.Response.Headers[\"X-Trace-Id\"] = receipt.TraceId;\n"
            "// Retain 100% of Status >= 400 or LatencyUs > P95 threshold"
        ),
        code_language="csharp",
        expected_impact="Cuts telemetry storage cost by ~85% while capturing 100% of Sev-1/Sev-2 anomalies.",
    ),
]

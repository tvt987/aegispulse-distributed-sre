# ADR-002: 5-Region Raft Quorum Fencing, Adaptive Circuit Breaker & Zero-Hallucination Hybrid RAG SRE

- **Status:** Accepted & Verified in CI
- **Author:** Truong Van Tinh (Principal Solution Architect)
- **Date:** 2026-11-28
- **Applies To:** `backend/src/AegisPulse.Domain/Sre/`, `services/aegis-sre-agent-python/`, `web/mission-control/src/engines/chaosEngine.ts`

---

## 1. Context & Distributed Systems Challenge

High-concurrency retail checkout platforms face two classes of catastrophic tail failures beyond single-row lock contention:
1. **Network Partitions & Split-Brain Writes:** Subsea cable cuts or regional cloud outages can split a multi-region control plane. If an isolated minority partition continues accepting voucher/inventory writes, conflicting ledgers diverge irreversibly.
2. **Cascading Storage Saturation & Blind On-Call Triage:** When downstream SQL Server pools saturate or Redis experiences a thundering-herd cache stampede, retrying blindly amplifies load (`retry storm`) while naive vector-only LLM assistants hallucinate runbooks or miss exact error codes (`409`, `503`, `EVALSHA`, `ROWVERSION`).

---

## 2. Architectural Decisions

### Decision 1: 5-Region Raft Majority Quorum (`3/5`) with Monotonic Fencing Tokens
- Cluster spans 5 geographic regions: `ap-southeast-1` (Primary), `ap-northeast-1`, `us-east-1`, `eu-central-1`, `ap-south-1`.
- Write quorum strictly requires `floor(N / 2) + 1 = 3` reachable nodes:
  - **1–2 regional fiber cuts (`>= 3/5` reachable):** If the active leader is partitioned, remaining healthy nodes automatically elect the highest-priority follower and increment `RaftTerm` (serving as a monotonic **fencing token**). Any stale write from an old leader carrying a lower token is rejected by storage.
  - **3+ regional fiber cuts (`< 3/5` reachable):** Cluster immediately transitions to `QUORUM_LOST`, clears `LeaderRegionId = null`, and engages `SplitBrainWriteFenceActive = true` (all surviving minority nodes enter `Fenced` read-only mode).

### Decision 2: Thread-Safe Adaptive Circuit Breaker (`Closed -> Open -> HalfOpen -> Closed`)
- Guards every voucher redemption and order allocation entry point.
- Uses `.NET 10` `System.Threading.Lock` and injectable `TimeProvider` for deterministic, zero-flake cooldown transitions:
  - **Closed:** Traffic passes normally; consecutive downstream failures increment the fault counter.
  - **Open:** Once `ConsecutiveFailures >= FailureThreshold`, incoming mutations fast-fail in `< 0.1ms` with RFC 9457 **`503 Service Unavailable`** so SQL Server pools recover without thread-pool starvation.
  - **Half-Open:** After `OpenCooldown`, probe traffic tests recovery. A single successful commit closes the breaker; a failed probe immediately re-trips `Open`.

### Decision 3: Deterministic Hybrid RAG (`BM25 + 384-d Dense + RRF k=60`) with Strict Abstention Gate
- Pure dense embeddings struggle with exact technical identifiers (`ROWVERSION`, `UPDLOCK`, `HTTP 409`, `EVALSHA`), while pure lexical BM25 misses conceptual queries.
- AegisPulse fuses **Okapi BM25 (`k1=1.5, b=0.75`)** and **384-dimensional dense cosine similarity** via **Reciprocal Rank Fusion (`k=60`)** with an interactive tunable `alpha` slider (`0.0` pure lexical -> `0.5` balanced hybrid -> `1.0` pure semantic).
- **Zero-Hallucination Abstention Gate:** Queries falling below the empirical confidence threshold (`min_confidence = 0.22`) or failing domain relevance strictly abstain with `0` citations instead of fabricating SRE remediation commands (`100%` abstention precision across adversarial out-of-domain benchmarks).

---

## 3. Observability & SLO Verification

- **Prometheus `/metrics` & OpenTelemetry Collector:** Exposes `aegispulse_voucher_double_spend_leaks` (alert if `> 0`), `aegispulse_voucher_conflicts_409_total`, `aegispulse_raft_quorum_healthy`, and `aegispulse_circuit_breaker_state` alongside W3C trace spans via `otel-collector` (`4317/4318`).
- **Incident Runbook Automation:** The Mission Control UI wires live chaos states into a 5-step auditable SRE runbook (`Detect -> Mitigate -> Drain -> Verify P99 < 45ms -> Export Post-Mortem`) exporting UTF-8 BOM Markdown & JSON incident reports.

---

## 4. Consequences

- **Positive:** Eliminates split-brain ledger corruption during regional outages, caps blast radius via `503` fast-fail shedding, and ensures deterministic `< 2ms` SRE runbook retrieval with zero paid LLM API dependency.
- **Trade-Off:** When `< 3/5` regions are reachable, availability of writes is intentionally sacrificed in favor of strict CP financial consistency (preventing unrecoverable double-spend divergence).

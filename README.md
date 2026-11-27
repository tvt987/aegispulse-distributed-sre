# AegisPulse Distributed SRE v5.0 — Con Cung 700-Store Proof, 5M-Row SQL Execution Plan Simulator & 5-Region Quorum Lab

[![Polyglot CI & Pages Deploy](https://github.com/tvt987/aegispulse-distributed-sre/actions/workflows/ci-and-deploy.yml/badge.svg)](https://github.com/tvt987/aegispulse-distributed-sre/actions/workflows/ci-and-deploy.yml)
[![Live Interactive Control Plane](https://img.shields.io/badge/Live_Mission_Control-tvt987.github.io-06b6d4?style=flat-square&logo=googlechrome&logoColor=white)](https://tvt987.github.io/aegispulse-distributed-sre/)
[![.NET 10](https://img.shields.io/badge/.NET-10.0_High_Concurrency-512BD4?style=flat-square&logo=dotnet)](./backend)
[![Python 3.12](https://img.shields.io/badge/Python-3.12_FastAPI_Hybrid_RAG-3776AB?style=flat-square&logo=python&logoColor=white)](./services/aegis-sre-agent-python)
[![React 19 + TS](https://img.shields.io/badge/Frontend-React_19_+_Code_Split_Vite-61DAFB?style=flat-square&logo=react&logoColor=black)](./web/mission-control)
[![OpenAPI 3.1](https://img.shields.io/badge/OpenAPI-3.1.0_Spec-85EA2D?style=flat-square&logo=openapiinitiative&logoColor=black)](./docs/openapi.yaml)

> **Live Interactive Control Plane (Zero Cold-Start):** **[https://tvt987.github.io/aegispulse-distributed-sre/](https://tvt987.github.io/aegispulse-distributed-sre/)**
>
> Engineered by **Trương Văn Tình** — *Full-Stack .NET & Applied AI Solution Architect (3+ yrs high-concurrency retail ERP & e-commerce @ Con Cung Corporation — 700+ stores, 5,000+ RPS, zero voucher double-spending)*.

---

## Why AegisPulse v5.0 Exists

Flash-sale voucher checkout systems across nationwide retail chains (`700+ stores`, `5,000+ RPS`, `5,000,000+` voucher rows) fail catastrophically under sudden contention due to four compounding failure modes:
1. **TOCTOU Double-Spending (`SELECT` then `UPDATE`)**: Parallel threads read `Stock = 1` simultaneously and leak **14–38 double-spent `500,000 VND` vouchers** on a single promo campaign — scaling to billions of VND in direct margin loss across 700+ stores.
2. **Legacy EF Core Clustered Index Scans & Table Lock Escalation**: Unindexed `Vouchers + VoucherRedemptions` lookups scan **`14,200` logical pages** (`28.4 ms`, `125 MB` ChangeTracker heap) and trigger SQL Server `ROW -> TABLE` lock escalation under burst load.
3. **SQL Lock Convoy Collapse (`UPDLOCK`)**: Pessimistic row locking eliminates double-spending, but queues 499 waiting SPIDs sequentially, spiking **`p99 = 640ms`** and saturating **SQL Server CPU at `94%`**.
4. **Regional Split-Brain Dual-Writer Corruption**: Without strict 5-region Raft majority quorum (`>= 3/5`) and automatic **`READ_ONLY_FENCE`** enforcement on minority partitions, subsea fiber cuts allow two regions to approve the same voucher simultaneously.

**AegisPulse v5.0** is a full-stack, compiled, load-tested, and CI-verified production monorepo proving the complete Con Cung solution:
- **NEW v5.0 Interactive SQL Server Execution Plan & Dapper Index Advisor (`SqlPlanAdvisorLab.tsx` + `sqlPlanAdvisorEngine.ts`)**: Models the real `5,000,000`-row `dbo.Vouchers + dbo.VoucherRedemptions` query across 3 progressive stages (`28.4 ms / 14,200 reads / 125 MB` -> `1.8 ms / 14 reads / 18 MB / -93.7%` -> `0.42 ms / 0 SQL contention reads`), rendered as a clickable **SVG Query Execution Operator Tree** with auto-generated copyable **T-SQL `CREATE NONCLUSTERED INDEX ... INCLUDE (...)`**, **C# `.NET 10` Dapper `ROWVERSION` CAS**, and **Redis Lua `EVALSHA`** code.
- **NEW v5.0 Interactive 5-Region Raft Quorum & Split-Brain Failover Lab (`QuorumFailoverLab.tsx` + `quorumFailoverEngine.ts`)**: Interactive **SVG 5-Region Mesh Topology** (`VN-HCM Primary`, `SG-1`, `JP-Tokyo`, `US-East`, `EU-West`). Click any region to cycle `ONLINE` / `PARTITIONED` / `HARD CRASH` and watch live Raft term election, cross-region majority RTT, WAL lag, RPO/RTO metrics, and automatic **`READ_ONLY_FENCE`** protection whenever `< 3/5` nodes survive.
- **Expanded `.NET 10` Backend (`backend/AegisPulse.sln`)**: Real compiled ASP.NET Core 10 Minimal API + Domain engines featuring `POST /api/v1/sql/execution-plan`, `POST /api/v1/cluster/quorum-evaluate`, `POST /api/v1/vouchers/seed`, `POST /api/v1/vouchers/{code}/redeem`, `GET /api/v1/vouchers/{code}/audit`, `GET /api/v1/sre/cluster-status`, and `/metrics` — verified by **28 xUnit + `WebApplicationFactory<Program>` tests** (`0` compiler warnings with `TreatWarningsAsErrors=true`), including an **in-process `.NET 10` throughput benchmark test proving sustained `> 5,000 ops/sec` atomic voucher redemption with `0` double-spends**.
- **Con Cung 500-Request Voucher Race Arena, Chaos Flamegraph & Hybrid RAG**: Preserves the complete v4.0/v3.0/v2.0 interactive labs (`109/109` Vitest tests, `React.lazy` + Vite `manualChunks` code-splitting with entry chunk `< 115 kB`, Strict CSP + `Referrer-Policy`, `0` UI emojis).

---

## System Architecture

```mermaid
flowchart LR
    subgraph Web["Mission Control UI (React 19 · Lazy Code-Split · Strict CSP)"]
        VRA["Tab 1: Voucher 500x Race Arena"]
        SQLUI["Tab 2 (v5.0): SQL 5M Execution Plan Advisor"]
        QRMUI["Tab 3 (v5.0): 5-Region Quorum Failover Lab"]
        RAFTUI["Tabs 4–9: Chaos Flamegraph, OTel & Hybrid RAG"]
    end

    subgraph Api["backend/ AegisPulse.Api (.NET 10 Minimal API · 0 Warnings)"]
        CB["Adaptive Circuit Breaker (503)"]
        IDEM["RFC Idempotency-Key SHA-256 Cache"]
        LUA["Redis Lua EVALSHA Atomic Gate"]
        RV["SQL ROWVERSION CAS + Covering Index Dapper"]
        SQLADV["POST /api/v1/sql/execution-plan"]
        QRMEV["POST /api/v1/cluster/quorum-evaluate"]
        MET["Prometheus /metrics + OTLP"]
    end

    subgraph Infra["Docker Production Stack"]
        REDIS["Redis 7 (AOF · Atomic Lua)"]
        PG["PostgreSQL 16 / SQL Ledger"]
        OTEL["OpenTelemetry Collector"]
        PROM["Prometheus v3"]
        PY["FastAPI Hybrid RAG Agent"]
    end

    Web -->|/api/v1/vouchers/:code/redeem| CB --> IDEM --> LUA
    LUA -->|499 losing reqs shed < 1.5ms| Web
    LUA -->|Sole authorized winner| RV --> PG
    LUA <--> REDIS
    SQLUI -->|/api/v1/sql/execution-plan| SQLADV
    QRMUI -->|/api/v1/cluster/quorum-evaluate| QRMEV
    Api --> MET --> PROM
    Api --> OTEL --> PROM
    Web --> PY
```

---

## Verified Test Suites & Empirical Benchmarks

| Layer / Verification Suite | Command | Result | Key Proof |
| :--- | :--- | :--- | :--- |
| **`.NET 10` Voucher, SQL Plan & Quorum API (`backend/`)** | `dotnet test backend/AegisPulse.sln -c Release` | **28 / 28 PASSED (`0` warnings)** | Sustained `> 5,000 ops/sec` 10,000-op parallel benchmark (`0` double-spends), 50-way & 100-way HTTP races, `/api/v1/sql/execution-plan`, `/api/v1/cluster/quorum-evaluate` |
| **`.NET 10` Lock-Free Kernel (`services/`)** | `dotnet test services/aegis-kernel-dotnet/AegisKernel.sln -c Release` | **8 / 8 PASSED** | 1,000-way lock-free & 800-way CAS contention invariants + Live Kestrel HTTP test |
| **`Python 3.12` Hybrid RAG SRE Agent** | `cd services/aegis-sre-agent-python && pytest -v` | **5 / 5 PASSED** | `100%` Recall@1, `1.00` MRR, `100%` OOD zero-hallucination abstention (`p95 = 1.24ms`) |
| **`React 19 + TS` Mission Control** | `cd web/mission-control && npm test` | **109 / 109 PASSED** | `13` SQL Plan Advisor + `13` 5-Region Quorum Failover + `21` Voucher Race + `51` Raft/Flamegraph/Runbook/VietQR + `11` Kernel/RAG tests |
| **Headless Playwright E2E QA** | `1440x900` Desktop & `390x844` Mobile | **0 Errors · 0px Overflow** | Verified SQL Plan stage switching (`28.4 ms -> 1.8 ms -> 0.42 ms`), 5-Region Quorum killing 3 regions -> `READ_ONLY_FENCE`, Voucher Race Arena & Strict CSP |

### 5,000,000-Row SQL Server Execution Plan Progression (`dbo.Vouchers + dbo.VoucherRedemptions`, `5,000 RPS`)

| Stage | Architecture | Query Latency | Logical Reads (8KB) | Worker RAM | Lock Granularity | Latency Delta |
| :---: | :--- | :---: | :---: | :---: | :--- | :---: |
| **Stage 1** | **Legacy EF Core + Clustered Index Scan** | `28.4 ms` | `14,200` (`110.9 MB`) | `125 MB` | `TABLE (IX -> X Lock Escalation)` | Baseline |
| **Stage 2** | **Covering Non-Clustered Index + Dapper + `ROWVERSION` CAS** | **`1.8 ms`** | **`14`** (`0.11 MB`) | **`18 MB`** | `ROW (Single-Key ROWVERSION CAS)` | **`-93.7%`** |
| **Stage 3** | **Redis Atomic Lua Guard + Async Write-Behind** | **`0.42 ms`** | **`0`** (on bursts) | **`6 MB`** | `LOCK-FREE (Single-Threaded Lua)` | **`-98.5%`** |

### 500-Request Flash-Sale Voucher Architecture Benchmark (`Stock = 1`, `500,000 VND`)

| Backend Architecture | Approved / 409 | Double-Spends | `P50` / `P95` / `P99` | Throughput | SQL DB CPU | SQL Queries | 700-Store Risk |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **Naive Read-Check-Write (No Lock)** | `15–39` / `461–485` | **`14–38` LEAKED** | `~26 / 95 / 118 ms` | `~1,850 RPS` | `~78%` | `1,000` | Multi-Billion VND Loss |
| **SQL Pessimistic Row Lock (`UPDLOCK`)** | `1` / `499` | `0` (`0.00%`) | `~270 / 560 / 640 ms` | `~780 RPS` | **`~94%`** | `1,000` | Lock Convoy Outage |
| **Con Cung Pattern (`Redis Lua + ROWVERSION + Dapper`)** | **`1` / `499`** | **`0` (`0.00%`)** | **`~8 / 27 / 38 ms`** | **`5,200+ RPS`** | **`~14%`** | **`1`** | **0 VND (100% Protected)** |

---

## Quickstart (Local Docker Production Stack & Verification)

### 1. Full Production Stack via Docker Compose
```bash
docker compose up --build
```
Services exposed locally:
- **Mission Control Web (Nginx + Strict CSP):** `http://localhost:8080`
- **`.NET 10` Voucher, SQL Plan & Quorum API:** `http://localhost:5080/health` | `POST /api/v1/sql/execution-plan` | `POST /api/v1/cluster/quorum-evaluate` | `GET /metrics`
- **`Python 3.12` Hybrid RAG Agent:** `http://localhost:8090/health`
- **Prometheus v3:** `http://localhost:9090`
- **OpenTelemetry Collector (OTLP gRPC / HTTP):** `localhost:4317` / `localhost:4318`
- **PostgreSQL 16 & Redis 7:** `localhost:5432` & `localhost:6379`

### 2. Run `k6` 5,000 RPS High-Concurrency Load Test
```bash
k6 run -e BASE_URL=http://localhost:5080 -e TARGET_RPS=5000 -e VOUCHER_STOCK=100 benchmarks/k6-voucher-5000rps.js
```

### 3. Run All Automated Test Suites Locally
```bash
# 1. .NET 10 Voucher, SQL Plan, Quorum API & >5K ops/sec Throughput Proof (28 tests, 0 warnings)
dotnet test backend/AegisPulse.sln -c Release

# 2. .NET 10 High-Concurrency Kernel Suite (8 tests)
dotnet test services/aegis-kernel-dotnet/AegisKernel.sln -c Release

# 3. Python 3.12 Hybrid RAG & ReAct Agent Pytest Suite (5 tests)
cd services/aegis-sre-agent-python && PYTHONPATH=. pytest -v && cd ../..

# 4. React 19 + TypeScript Vitest Suite (109 tests) & Code-Split Production Build
cd web/mission-control && npm install && npm test && npm run build
```

---

## Architecture Documentation & Specifications

- **[OpenAPI 3.1 Specification (`docs/openapi.yaml`)](./docs/openapi.yaml)** — Complete v5.0 contract for `/health`, `/metrics`, `/api/v1/vouchers/*`, `/api/v1/sre/cluster-status`, `/api/v1/sql/execution-plan`, and `/api/v1/cluster/quorum-evaluate`.
- **[ADR-001: Redis Lua Atomic Gate + SQL Server ROWVERSION Optimistic Concurrency](./docs/ADR-001-Redis-Lua-Optimistic-Concurrency.md)** — Deep trade-off analysis of Con Cung's 700-store / 5,000+ RPS zero-double-spend voucher engine.
- **[ADR-002: 5-Region Raft Quorum Fencing, Adaptive Circuit Breaker & Hybrid RAG SRE](./docs/ADR-002-5Region-Raft-CircuitBreaker-SRE.md)** — Consensus fencing, 503 fast-fail protection, and deterministic zero-hallucination incident triage.

---

## Author & Remote B2B Engagement

**Trương Văn Tình** — *Full-Stack .NET & Applied AI Solution Architect*
- **Live Interactive Demo:** [https://tvt987.github.io/aegispulse-distributed-sre/](https://tvt987.github.io/aegispulse-distributed-sre/)
- **Portfolio:** [https://tvt987.github.io](https://tvt987.github.io)
- **LinkedIn:** [linkedin.com/in/trương-văn-tình-651b12289](https://www.linkedin.com/in/tr%C6%B0%C6%A1ng-v%C4%83n-t%C3%ACnh-651b12289/)
- **Contact:** [tinhkun102@gmail.com](mailto:tinhkun102@gmail.com) · `(+84) 931 467 024`

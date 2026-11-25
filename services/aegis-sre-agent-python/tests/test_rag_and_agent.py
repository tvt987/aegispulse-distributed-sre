# -*- coding: utf-8 -*-
import json
import os
import time
from fastapi.testclient import TestClient

from app.agent_orchestrator import AegisSreOrchestrator
from app.main import app
from app.rag_engine import HybridRagEngine

client = TestClient(app)
engine = HybridRagEngine()
agent = AegisSreOrchestrator(engine)

GOLDEN_QUERIES = [
    ("How to prevent flash-sale voucher double-spending and negative stock with Redis Lua and RowVersion?", "RB-CONC-001"),
    ("Mobile clients retry POST orders on timeout causing duplicate charges; how to implement Idempotency-Key and 409 conflict?", "RB-IDEM-002"),
    ("Redis hot key expiration causes thundering herd cache stampede and SQL CPU 100%", "RB-CACHE-003"),
    ("Optimize slow SQL Server OFFSET pagination and lock contention using Dapper keyset pagination", "RB-SQL-004"),
    ("Downstream payment gateway timeout causes cascading failure; configure Polly adaptive circuit breaker 503", "RB-RESIL-005"),
    ("Kestrel low CPU but high request queue from sync-over-async Task.Result ThreadPool starvation", "RB-NET-006"),
    ("Prevent dual-write lost events between SQL database and RabbitMQ using Transactional Outbox and System.Threading.Channels", "RB-OUTBOX-007"),
    ("Why combine Okapi BM25 with dense vector search via Reciprocal Rank Fusion RRF in RAG?", "RB-RAG-008"),
    ("Keycloak OAuth2 OIDC JWKS caching and lock-free token bucket 429 rate limiting", "RB-AUTH-009"),
    ("Reduce observability cost at 5000 RPS with OpenTelemetry W3C tail-based sampling", "RB-OTEL-010"),
]

ADVERSARIAL_OOD_QUERIES = [
    "What is the best recipe for sourdough pizza crust fermentation?",
    "Who won the Premier League golden boot in 1998?",
    "Give me astrology horoscope predictions for Scorpio next month",
    "How to prunehydrangea flowers in winter garden soil?",
    "Buy cheap airline tickets to Bali resort vacation",
]


def test_golden_hybrid_rag_recall_and_mrr():
    hits_at_1 = 0
    hits_at_3 = 0
    rr_sum = 0.0
    latencies = []

    for q, expected_doc in GOLDEN_QUERIES:
        t0 = time.perf_counter()
        res = engine.search(q, top_k=3)
        latencies.append((time.perf_counter() - t0) * 1000.0)
        assert not res["abstained"], f"Should not abstain on valid query: {q}"
        top_ids = [c["doc_id"] for c in res["citations"]]
        if expected_doc == top_ids[0]:
            hits_at_1 += 1
        if expected_doc in top_ids:
            hits_at_3 += 1
            rank = top_ids.index(expected_doc) + 1
            rr_sum += 1.0 / rank

    recall_1 = hits_at_1 / len(GOLDEN_QUERIES)
    recall_3 = hits_at_3 / len(GOLDEN_QUERIES)
    mrr = rr_sum / len(GOLDEN_QUERIES)

    assert recall_1 >= 0.90, f"Expected Recall@1 >= 0.90, got {recall_1}"
    assert recall_3 == 1.0, f"Expected Recall@3 == 1.0, got {recall_3}"
    assert mrr >= 0.95, f"Expected MRR >= 0.95, got {mrr}"
    assert max(latencies) < 50.0


def test_zero_hallucination_abstention_on_out_of_domain_queries():
    for bad_q in ADVERSARIAL_OOD_QUERIES:
        res = engine.search(bad_q, top_k=3)
        assert res["abstained"] is True, f"Engine failed to abstain on out-of-domain query: {bad_q}"
        assert res["citations"] == []


def test_sre_agent_detects_sev1_double_spend_breach():
    diag = agent.diagnose_telemetry({
        "skuId": "FLASH-SKU-01",
        "totalRequests": 2500,
        "overAllocatedUnits": 47,
        "p99LatencyMs": 310.0,
        "idempotentReplays": 0,
        "circuitState": "Closed",
        "throughputRps": 3200.0,
    })
    assert diag["severity"] == "SEV-1 CRITICAL"
    assert len(diag["react_trace"]) == 3
    assert any(c["doc_id"] == "RB-CONC-001" for c in diag["grounded_citations"])
    assert diag["roi_projection"]["FlashSaleRevenueProtectedPerBurstUsd"] > 0


def test_sre_agent_verifies_healthy_aegis_telemetry():
    diag = agent.diagnose_telemetry({
        "skuId": "FLASH-SKU-01",
        "totalRequests": 10000,
        "overAllocatedUnits": 0,
        "p99LatencyMs": 4.2,
        "idempotentReplays": 2000,
        "circuitState": "Closed",
        "throughputRps": 65000.0,
    })
    assert diag["severity"] == "HEALTHY"
    assert len(diag["grounded_citations"]) >= 1


def test_fastapi_endpoints_end_to_end():
    r_health = client.get("/health")
    assert r_health.status_code == 200
    assert r_health.json()["runbook_count"] == 10

    r_books = client.get("/api/v1/runbooks")
    assert r_books.status_code == 200
    assert len(r_books.json()["items"]) == 10

    r_rag = client.post("/api/v1/rag/query", json={"query": "Redis Lua double-spending flash sale RowVersion", "top_k": 2})
    assert r_rag.status_code == 200
    body = r_rag.json()
    assert body["abstained"] is False
    assert body["citations"][0]["doc_id"] == "RB-CONC-001"

    r_diag = client.post("/api/v1/agent/diagnose", json={"overAllocatedUnits": 12, "p99LatencyMs": 420.0})
    assert r_diag.status_code == 200
    assert r_diag.json()["severity"] == "SEV-1 CRITICAL"


def export_eval_report(out_path: str) -> dict:
    hits_1 = 0
    hits_3 = 0
    rr_sum = 0.0
    latencies = []
    for q, exp in GOLDEN_QUERIES:
        res = engine.search(q, top_k=3)
        latencies.append(res["latency_ms"])
        ids = [c["doc_id"] for c in res["citations"]]
        if ids and ids[0] == exp:
            hits_1 += 1
        if exp in ids:
            hits_3 += 1
            rr_sum += 1.0 / (ids.index(exp) + 1)

    ood_abstained = sum(1 for q in ADVERSARIAL_OOD_QUERIES if engine.search(q)["abstained"])
    latencies.sort()
    report = {
        "generatedAtUtc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "goldenQueriesCount": len(GOLDEN_QUERIES),
        "adversarialOodQueriesCount": len(ADVERSARIAL_OOD_QUERIES),
        "recallAt1": round(hits_1 / len(GOLDEN_QUERIES), 4),
        "recallAt3": round(hits_3 / len(GOLDEN_QUERIES), 4),
        "mrr": round(rr_sum / len(GOLDEN_QUERIES), 4),
        "abstentionPrecision": round(ood_abstained / len(ADVERSARIAL_OOD_QUERIES), 4),
        "p50LatencyMs": round(latencies[len(latencies) // 2], 3),
        "p95LatencyMs": round(latencies[int(len(latencies) * 0.95)], 3),
    }
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(report, f, indent=2)
    return report


if __name__ == "__main__":
    out_file = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "..", "benchmarks", "python-rag-eval-report.json"))
    rep = export_eval_report(out_file)
    print(json.dumps(rep, indent=2))
    print(f"[SAVED PYTHON RAG EVAL REPORT] -> {out_file}")

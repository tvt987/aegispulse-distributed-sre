# -*- coding: utf-8 -*-
from typing import Any, Dict
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from .agent_orchestrator import AegisSreOrchestrator
from .knowledge_base import RUNBOOK_CORPUS
from .rag_engine import HybridRagEngine

app = FastAPI(
    title="AegisPulse Autonomous SRE & Hybrid RAG Service",
    version="1.0.0",
    description="Deterministic Okapi BM25 + 384-d Dense Vector RRF Retrieval with Zero-Hallucination Abstention & ReAct Incident Co-Pilot.",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

rag_engine = HybridRagEngine()
sre_agent = AegisSreOrchestrator(rag_engine)


class RagQueryRequest(BaseModel):
    query: str = Field(..., min_length=1, max_length=600)
    top_k: int = Field(default=3, ge=1, le=6)
    min_confidence: float = Field(default=0.22, ge=0.05, le=0.90)


class DiagnoseTelemetryRequest(BaseModel):
    skuId: str = "FLASH-SKU-01"
    totalRequests: int = 10000
    overAllocatedUnits: int = 0
    p99LatencyMs: float = 12.4
    idempotentReplays: int = 1850
    payloadConflicts409: int = 0
    rateLimitedRejections: int = 0
    totalCasRetries: int = 340
    circuitState: str = "Closed"
    throughputRps: float = 48000.0
    avgOrderValueUsd: float = 45.0


@app.get("/health")
def health() -> Dict[str, Any]:
    return {
        "status": "healthy",
        "service": "aegis-sre-agent-python",
        "runbook_count": len(RUNBOOK_CORPUS),
        "retrieval_mode": "Okapi BM25 + 384d Dense Cosine + RRF(k=60) + Abstention Gate",
    }


@app.get("/api/v1/runbooks")
def list_runbooks() -> Dict[str, Any]:
    return {
        "count": len(RUNBOOK_CORPUS),
        "items": [
            {
                "doc_id": r.doc_id,
                "title": r.title,
                "category": r.category,
                "severity_tier": r.severity_tier,
                "tags": r.tags,
                "expected_impact": r.expected_impact,
            }
            for r in RUNBOOK_CORPUS
        ],
    }


@app.post("/api/v1/rag/query")
def query_rag(req: RagQueryRequest) -> Dict[str, Any]:
    return rag_engine.search(req.query, top_k=req.top_k, min_confidence=req.min_confidence)


@app.post("/api/v1/agent/diagnose")
def diagnose_incident(req: DiagnoseTelemetryRequest) -> Dict[str, Any]:
    return sre_agent.diagnose_telemetry(req.model_dump())

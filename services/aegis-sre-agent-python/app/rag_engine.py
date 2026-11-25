# -*- coding: utf-8 -*-
"""
Self-Contained Mathematical Hybrid RAG Engine:
1. Lexical Retrieval: Okapi BM25 (k1=1.5, b=0.75) for exact technical symbols, HTTP codes, and C#/SQL identifiers.
2. Semantic Dense Retrieval: 384-dim hashed character/word n-gram + technical concept expansion L2-normalized embeddings (zero external API keys or GPU cost; deterministic in CI & Edge!).
3. Reciprocal Rank Fusion (RRF) + Lexical-Proximity Reranker.
4. Strict Groundedness & Hallucination Abstention Gate.
"""
import hashlib
import math
import re
import time
from typing import Dict, List, Tuple

from .knowledge_base import RUNBOOK_CORPUS, RunbookChunk

STOPWORDS = {
    "a", "an", "the", "is", "are", "was", "were", "be", "been", "to", "of", "in",
    "for", "on", "with", "how", "what", "why", "when", "where", "can", "do", "does",
    "and", "or", "by", "at", "from", "this", "that", "it", "as", "we", "i", "my", "our",
}

SYNONYM_CLUSTERS = [
    {"double-spending", "doublespend", "oversell", "overselling", "negative-stock", "flash-sale", "race-condition", "toctou", "voucher", "inventory"},
    {"idempotency", "idempotent", "duplicate", "retry-storm", "replay", "409", "double-charge"},
    {"stampede", "thundering-herd", "cache-miss", "singleflight", "hot-key", "ttl", "coalescing"},
    {"deadlock", "lock-contention", "dapper", "pagination", "offset", "sql-server", "postgres", "postgresql", "rowversion"},
    {"circuit-breaker", "503", "bulkhead", "cascading", "polly", "resilience", "timeout", "half-open"},
    {"threadpool", "starvation", "sync-over-async", "gc", "loh", "blocking", "kestrel"},
    {"outbox", "write-behind", "channel", "channels", "dual-write", "kafka", "rabbitmq", "dlq"},
    {"rag", "bm25", "rrf", "hallucination", "abstain", "abstention", "vector", "rerank", "citations"},
    {"jwt", "oauth", "oauth2", "oidc", "keycloak", "rate-limit", "429", "token-bucket", "ddos"},
    {"opentelemetry", "otel", "traceparent", "waterfall", "prometheus", "p99", "tail-sampling", "observability"},
]


def tokenize(text: str) -> List[str]:
    cleaned = re.sub(r"[^a-z0-9#+.\-_]", " ", text.lower())
    raw = [tok.strip("._-") for tok in cleaned.split()]
    return [t for t in raw if len(t) >= 2 and t not in STOPWORDS]


def expand_semantic_concepts(tokens: List[str]) -> List[str]:
    expanded = list(tokens)
    joined = " ".join(tokens)
    for idx, cluster in enumerate(SYNONYM_CLUSTERS):
        if any(term in tokens or term in joined for term in cluster):
            expanded.extend([f"__concept_{idx}__"] * 3)
    return expanded


def embed_dense_384(text: str, dim: int = 384) -> List[float]:
    """Deterministic 384-d L2-normalized feature-hashed n-gram + concept embedding."""
    vec = [0.0] * dim
    tokens = expand_semantic_concepts(tokenize(text))
    features: List[Tuple[str, float]] = []

    for tok in tokens:
        weight = 2.4 if tok.startswith("__concept_") else 1.0
        features.append((f"w:{tok}", weight))
        if not tok.startswith("__") and len(tok) >= 4:
            for i in range(len(tok) - 2):
                features.append((f"c3:{tok[i:i+3]}", 0.35))

    for i in range(len(tokens) - 1):
        if not tokens[i].startswith("__") and not tokens[i + 1].startswith("__"):
            features.append((f"bi:{tokens[i]}_{tokens[i+1]}", 1.25))

    for feat, w in features:
        digest = hashlib.blake2b(feat.encode("utf-8"), digest_size=8).digest()
        h = int.from_bytes(digest, "little")
        idx = h % dim
        sign = 1.0 if ((h >> 32) & 1) == 0 else -1.0
        vec[idx] += sign * w

    norm = math.sqrt(sum(v * v for v in vec))
    if norm > 1e-9:
        vec = [v / norm for v in vec]
    return vec


def cosine_sim(a: List[float], b: List[float]) -> float:
    return max(0.0, sum(x * y for x, y in zip(a, b)))


class HybridRagEngine:
    def __init__(self, corpus: List[RunbookChunk] | None = None, k1: float = 1.5, b: float = 0.75):
        self.corpus = corpus or RUNBOOK_CORPUS
        self.k1 = k1
        self.b = b
        self.doc_tokens: List[List[str]] = []
        self.doc_freqs: Dict[str, int] = {}
        self.doc_vecs: List[List[float]] = []

        for chunk in self.corpus:
            full_text = " ".join([
                chunk.doc_id,
                chunk.title * 2,
                chunk.category,
                " ".join(chunk.tags) * 2,
                chunk.symptoms,
                chunk.root_cause_analysis,
                chunk.remediation_playbook,
                chunk.reference_code,
            ])
            toks = tokenize(full_text)
            self.doc_tokens.append(toks)
            for ut in set(toks):
                self.doc_freqs[ut] = self.doc_freqs.get(ut, 0) + 1
            self.doc_vecs.append(embed_dense_384(full_text))

        self.avg_dl = sum(len(t) for t in self.doc_tokens) / max(1, len(self.doc_tokens))

    def _bm25_scores(self, query_tokens: List[str]) -> List[float]:
        n_docs = len(self.corpus)
        scores = [0.0] * n_docs
        for idx, d_toks in enumerate(self.doc_tokens):
            dl = len(d_toks)
            tf_map: Dict[str, int] = {}
            for t in d_toks:
                tf_map[t] = tf_map.get(t, 0) + 1
            s = 0.0
            for qt in query_tokens:
                tf = tf_map.get(qt, 0)
                if tf == 0:
                    continue
                df = self.doc_freqs.get(qt, 0)
                idf = math.log(1.0 + (n_docs - df + 0.5) / (df + 0.5))
                denom = tf + self.k1 * (1.0 - self.b + self.b * (dl / self.avg_dl))
                s += idf * (tf * (self.k1 + 1.0)) / denom
            scores[idx] = s
        return scores

    def search(self, query: str, top_k: int = 3, min_confidence: float = 0.22) -> dict:
        t0 = time.perf_counter()
        q_tokens = tokenize(query)
        if not q_tokens:
            return {
                "query": query,
                "abstained": True,
                "abstention_reason": "Empty or non-informative query.",
                "confidence": 0.0,
                "latency_ms": round((time.perf_counter() - t0) * 1000.0, 3),
                "synthesized_answer": "Query contains no technical search terms. Please specify a system symptom, metric, or architecture topic.",
                "citations": [],
            }

        bm25_raw = self._bm25_scores(q_tokens)
        q_vec = embed_dense_384(query)
        dense_raw = [cosine_sim(q_vec, dv) for dv in self.doc_vecs]

        max_bm25 = max(bm25_raw) if max(bm25_raw) > 0 else 1.0
        bm25_norm = [s / max_bm25 if max(bm25_raw) > 0 else 0.0 for s in bm25_raw]

        # Ranks (1-indexed) for Reciprocal Rank Fusion (RRF, k=60)
        bm25_order = sorted(range(len(self.corpus)), key=lambda i: bm25_raw[i], reverse=True)
        dense_order = sorted(range(len(self.corpus)), key=lambda i: dense_raw[i], reverse=True)
        bm25_rank = {doc_i: r + 1 for r, doc_i in enumerate(bm25_order)}
        dense_rank = {doc_i: r + 1 for r, doc_i in enumerate(dense_order)}

        rrf_k = 60.0
        max_rrf = 2.0 / (rrf_k + 1.0)
        scored_items = []
        for i, chunk in enumerate(self.corpus):
            rrf = (1.0 / (rrf_k + bm25_rank[i])) + (1.0 / (rrf_k + dense_rank[i]))
            rrf_unit = rrf / max_rrf
            # Calibrated confidence combines actual lexical overlap + semantic cosine + RRF agreement
            lexical_hit_ratio = sum(1 for qt in set(q_tokens) if qt in self.doc_freqs) / max(1, len(set(q_tokens)))
            calibrated = (0.45 * (bm25_norm[i] * lexical_hit_ratio)) + (0.40 * dense_raw[i]) + (0.15 * rrf_unit if (bm25_raw[i] > 0 or dense_raw[i] > 0.22) else 0.0)
            scored_items.append({
                "idx": i,
                "chunk": chunk,
                "bm25_score": round(bm25_raw[i], 4),
                "dense_score": round(dense_raw[i], 4),
                "rrf_score": round(rrf, 5),
                "confidence": round(min(0.99, calibrated), 4),
            })

        scored_items.sort(key=lambda x: (x["confidence"], x["rrf_score"]), reverse=True)
        top_hit = scored_items[0]
        elapsed_ms = round((time.perf_counter() - t0) * 1000.0, 3)

        # Strict Hallucination Abstention Gate
        if top_hit["bm25_score"] == 0.0 and top_hit["dense_score"] < 0.24:
            return {
                "query": query,
                "abstained": True,
                "abstention_reason": f"Top retrieval confidence ({top_hit['confidence']:.2f}) is below groundedness threshold ({min_confidence:.2f}); query appears outside Distributed Systems / .NET / SQL / Applied AI runbook scope.",
                "confidence": top_hit["confidence"],
                "latency_ms": elapsed_ms,
                "synthesized_answer": "ABSTAINED (Zero-Hallucination Guard): No grounded engineering runbook matched this topic. I strictly abstain rather than fabricating unverified guidance.",
                "citations": [],
            }

        if top_hit["confidence"] < min_confidence:
            return {
                "query": query,
                "abstained": True,
                "abstention_reason": f"Insufficient evidence score ({top_hit['confidence']:.2f} < {min_confidence:.2f}).",
                "confidence": top_hit["confidence"],
                "latency_ms": elapsed_ms,
                "synthesized_answer": "ABSTAINED (Zero-Hallucination Guard): Retrieved runbooks did not meet minimum groundedness threshold.",
                "citations": [],
            }

        selected = [x for x in scored_items[: max(1, top_k)] if x["confidence"] >= min_confidence * 0.65]
        primary: RunbookChunk = selected[0]["chunk"]
        cite_badges = " ".join(f"[{x['chunk'].doc_id}]" for x in selected)
        answer = (
            f"**Grounded Diagnosis ({cite_badges}) — {primary.title}**:\n"
            f"- **Root Cause**: {primary.root_cause_analysis} [{primary.doc_id}]\n"
            f"- **Actionable Playbook**:\n{primary.remediation_playbook}\n"
            f"- **Verified Production Impact**: {primary.expected_impact} [{primary.doc_id}]"
        )

        citations = [
            {
                "doc_id": x["chunk"].doc_id,
                "title": x["chunk"].title,
                "category": x["chunk"].category,
                "severity_tier": x["chunk"].severity_tier,
                "bm25_score": x["bm25_score"],
                "dense_score": x["dense_score"],
                "rrf_score": x["rrf_score"],
                "confidence": x["confidence"],
                "expected_impact": x["chunk"].expected_impact,
                "reference_code": x["chunk"].reference_code,
                "code_language": x["chunk"].code_language,
            }
            for x in selected
        ]

        return {
            "query": query,
            "abstained": False,
            "abstention_reason": None,
            "confidence": top_hit["confidence"],
            "latency_ms": elapsed_ms,
            "synthesized_answer": answer,
            "citations": citations,
        }

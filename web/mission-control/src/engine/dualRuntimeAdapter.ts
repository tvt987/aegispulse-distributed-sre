import { diagnoseEdgeTelemetry, queryEdgeHybridRag } from './localHybridRag';
import { hydrateBurstTelemetry, runEdgeBurstSimulation } from './localKernel';
import type {
  BurstSimulationResult,
  ChaosProfile,
  ConcurrencyMode,
  RagQueryResponse,
  SreDiagnosisResponse,
  TelemetrySnapshot,
} from './types';

export interface BackendConnectionState {
  dotnetLive: boolean;
  pythonLive: boolean;
  modeLabel: string;
}

const DOTNET_URL = 'http://127.0.0.1:5080';
const PYTHON_URL = 'http://127.0.0.1:8090';

async function fetchWithTimeout(url: string, init: RequestInit = {}, timeoutMs = 600): Promise<Response> {
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(id);
  }
}

export async function detectPolyglotBackends(): Promise<BackendConnectionState> {
  const isProdBundle = Boolean(import.meta.env?.PROD);
  const forceLiveProbe =
    typeof window !== 'undefined' &&
    new URLSearchParams(window.location.search).get('live') === '1';

  if (
    typeof window !== 'undefined' &&
    (window.location.hostname.endsWith('github.io') || (isProdBundle && !forceLiveProbe))
  ) {
    return {
      dotnetLive: false,
      pythonLive: false,
      modeLabel: window.location.hostname.endsWith('github.io')
        ? 'EDGE KERNEL · GITHUB PAGES CDN'
        : 'EDGE KERNEL · 0ms COLD-START',
    };
  }

  let dotnetLive = false;
  let pythonLive = false;
  try {
    const r = await fetchWithTimeout(`${DOTNET_URL}/health`, {}, 500);
    dotnetLive = r.ok;
  } catch {
    dotnetLive = false;
  }
  try {
    const r = await fetchWithTimeout(`${PYTHON_URL}/health`, {}, 500);
    pythonLive = r.ok;
  } catch {
    pythonLive = false;
  }

  return {
    dotnetLive,
    pythonLive,
    modeLabel:
      dotnetLive && pythonLive
        ? 'LIVE CLUSTER · .NET 10 + FASTAPI'
        : 'EDGE KERNEL · 0ms COLD-START',
  };
}

export async function executeBurst(
  mode: ConcurrencyMode,
  concurrentRequests: number,
  initialStock: number,
  duplicateReplayRatio: number,
  chaos: ChaosProfile,
  dotnetLive: boolean
): Promise<BurstSimulationResult> {
  if (dotnetLive) {
    try {
      const resp = await fetchWithTimeout(
        `${DOTNET_URL}/api/v1/simulation/burst`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            mode,
            concurrentRequests,
            initialStock,
            duplicateReplayRatio,
            chaos,
          }),
        },
        5000
      );
      if (resp.ok) {
        const liveRes = (await resp.json()) as BurstSimulationResult;
        return hydrateBurstTelemetry(liveRes);
      }
    } catch {
      // Fallback cleanly to deterministic edge kernel
    }
  }
  return runEdgeBurstSimulation(mode, concurrentRequests, initialStock, duplicateReplayRatio, chaos);
}

export async function executeHybridRagSearch(
  query: string,
  pythonLive: boolean,
  alpha = 0.5
): Promise<RagQueryResponse> {
  // Interactive alpha tuning executes deterministically in <2ms on the edge hybrid engine;
  // when live Python FastAPI is connected at default balanced alpha=0.5, query live service first.
  if (pythonLive && Math.abs(alpha - 0.5) < 0.001) {
    try {
      const resp = await fetchWithTimeout(
        `${PYTHON_URL}/api/v1/rag/query`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query, top_k: 3, min_confidence: 0.22 }),
        },
        3000
      );
      if (resp.ok) {
        const liveRes = (await resp.json()) as RagQueryResponse;
        const localDetail = queryEdgeHybridRag(query, 3, 0.22, alpha);
        return {
          ...liveRes,
          alpha,
          fusion_mode: localDetail.fusion_mode,
          evaluated_chunks: localDetail.evaluated_chunks,
          citations: liveRes.citations.map((c) => {
            const match = localDetail.evaluated_chunks?.find((e) => e.doc_id === c.doc_id);
            return {
              ...c,
              bm25_norm: match?.bm25_norm,
              bm25_rank: match?.bm25_rank,
              dense_rank: match?.dense_rank,
              matched_terms: match?.matched_terms,
              snippet: match?.snippet,
            };
          }),
        };
      }
    } catch {
      // Fallback cleanly to deterministic edge Hybrid RAG
    }
  }
  return queryEdgeHybridRag(query, 3, 0.22, alpha);
}

export async function executeSreDiagnosis(
  snap: TelemetrySnapshot,
  throughputRps: number,
  pythonLive: boolean
): Promise<SreDiagnosisResponse> {
  if (pythonLive) {
    try {
      const resp = await fetchWithTimeout(
        `${PYTHON_URL}/api/v1/agent/diagnose`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            skuId: snap.skuId,
            totalRequests: snap.totalRequests,
            overAllocatedUnits: snap.overAllocatedUnits,
            p99LatencyMs: snap.p99LatencyUs / 1000,
            idempotentReplays: snap.idempotentReplays,
            payloadConflicts409: snap.payloadConflicts409,
            rateLimitedRejections: snap.rateLimitedRejections,
            totalCasRetries: snap.totalCasRetries,
            circuitState: snap.circuitState,
            throughputRps,
          }),
        },
        3000
      );
      if (resp.ok) {
        return (await resp.json()) as SreDiagnosisResponse;
      }
    } catch {
      // Fallback cleanly
    }
  }
  return diagnoseEdgeTelemetry(snap, throughputRps);
}

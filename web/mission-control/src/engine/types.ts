export type ConcurrencyMode = 'NaiveUnprotected' | 'OptimisticCas' | 'AegisLockFreeChannel';

export type OrderOutcomeStatus =
  | 'Allocated'
  | 'IdempotentReplay'
  | 'OutOfStock'
  | 'ConcurrencyExhausted'
  | 'PayloadConflict409'
  | 'RateLimited429'
  | 'CircuitOpen503';

export type CircuitState = 'Closed' | 'Open' | 'HalfOpen';

export type ThemeMode = 'dark' | 'light';

export interface ChaosProfile {
  injectedDbLatencyMs: number;
  failureRatePercent: number;
  forceCircuitOpen: boolean;
  cacheStampedeActive: boolean;
}

export interface StressPreset {
  id: string;
  label: string;
  shortLabel: string;
  subtitle: string;
  concurrentRequests: number;
  initialStock: number;
  duplicateReplayRatio: number;
  recommendedMode: ConcurrencyMode;
  chaos: ChaosProfile;
}

export interface TraceSpan {
  spanId: string;
  name: string;
  component: string;
  startOffsetUs: number;
  durationUs: number;
  status: string;
  attributes: Record<string, string>;
}

export interface TransactionReceipt {
  orderId: string;
  skuId: string;
  userId: string;
  quantity: number;
  status: OrderOutcomeStatus;
  isIdempotentReplay: boolean;
  remainingStockAfter: number;
  casRetries: number;
  latencyMicroseconds: number;
  traceId: string;
  mode: ConcurrencyMode;
  timestampUtc: string;
  spans: TraceSpan[];
}

export interface LatencyHistogramBucket {
  label: string;
  minUs: number;
  maxUs: number;
  count: number;
  pct: number;
  hasP50: boolean;
  hasP95: boolean;
  hasP99: boolean;
}

export interface StageTelemetry {
  id: string;
  index: number;
  title: string;
  subtitle: string;
  metric: string;
  utilizationPct: number;
  queueDepthSparkline: number[];
  status: 'healthy' | 'warning' | 'critical';
  accentColor: string;
}

export interface TelemetrySnapshot {
  skuId: string;
  initialStock: number;
  remainingStock: number;
  totalRequests: number;
  confirmedAllocations: number;
  totalUnitsAllocated: number;
  overAllocatedUnits: number;
  idempotentReplays: number;
  payloadConflicts409: number;
  outOfStockRejections: number;
  rateLimitedRejections: number;
  circuitBreakerRejections: number;
  totalCasRetries: number;
  writeBehindQueueDepth: number;
  writeBehindFlushedCount: number;
  p50LatencyUs: number;
  p95LatencyUs: number;
  p99LatencyUs: number;
  circuitState: CircuitState;
  activeChaos: ChaosProfile;
  invariantIntact: boolean;
}

export interface BurstSimulationResult {
  mode: ConcurrencyMode;
  concurrentRequests: number;
  initialStock: number;
  elapsedMilliseconds: number;
  throughputRps: number;
  snapshot: TelemetrySnapshot;
  sampledTraces: TransactionReceipt[];
  latencyHistogram?: LatencyHistogramBucket[];
  stageTelemetry?: StageTelemetry[];
}

export interface RagCitation {
  doc_id: string;
  title: string;
  category: string;
  severity_tier: string;
  bm25_score: number;
  dense_score: number;
  rrf_score: number;
  confidence: number;
  expected_impact: string;
  reference_code: string;
  code_language: string;
  bm25_norm?: number;
  bm25_rank?: number;
  dense_rank?: number;
  matched_terms?: string[];
  snippet?: string;
}

export interface RagQueryResponse {
  query: string;
  abstained: boolean;
  abstention_reason: string | null;
  confidence: number;
  latency_ms: number;
  synthesized_answer: string;
  citations: RagCitation[];
  alpha?: number;
  fusion_mode?: string;
  evaluated_chunks?: RagCitation[];
}

export interface ReActStep {
  step: number;
  phase: string;
  duration_ms: number;
  output: Record<string, unknown>;
}

export interface SreDiagnosisResponse {
  severity: string;
  executive_summary: string;
  react_trace: ReActStep[];
  grounded_citations: RagCitation[];
  recommended_code_patch: string;
  code_language: string;
  roi_projection: {
    FlashSaleRevenueProtectedPerBurstUsd: number;
    ChargebackDisputesPreventedUsd: number;
    ProjectedPostRemediationP99Ms: number;
    EstimatedInfraCostReductionPct: number;
  };
  total_agent_latency_ms: number;
}

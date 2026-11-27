import type {
  BurstSimulationResult,
  RagQueryResponse,
  SreDiagnosisResponse,
} from './types';

export interface PostMortemExportInput {
  simResult: BurstSimulationResult | null;
  showdownResults: BurstSimulationResult[] | null;
  diagnosis: SreDiagnosisResponse | null;
  ragResult: RagQueryResponse | null;
  alpha: number;
  runtimeModeLabel: string;
}

/**
 * Synthesizes a structured, production-ready SRE Incident Post-Mortem Markdown report
 * combining live concurrency telemetry, 3-engine race results, ReAct diagnosis trace,
 * and grounded Hybrid RAG citations.
 */
export function generatePostMortemMarkdown(input: PostMortemExportInput): string {
  const { simResult, showdownResults, diagnosis, ragResult, alpha, runtimeModeLabel } = input;
  const nowIso = new Date().toISOString();
  const snap = simResult?.snapshot;
  const severity = diagnosis?.severity ?? (snap && snap.overAllocatedUnits > 0 ? 'SEV-1 CRITICAL' : 'HEALTHY');

  const lines: string[] = [
    `# AegisPulse SRE Incident Post-Mortem Report`,
    ``,
    `| Field | Value |`,
    `| :--- | :--- |`,
    `| **Generated (UTC)** | \`${nowIso}\` |`,
    `| **Severity Classification** | **${severity}** |`,
    `| **Execution Plane** | ${runtimeModeLabel} |`,
    `| **Active Concurrency Mode** | \`${simResult?.mode ?? 'N/A'}\` |`,
    `| **Target SKU / Resource** | \`${snap?.skuId ?? 'FLASH-SKU-01'}\` |`,
    ``,
    `---`,
    ``,
    `## 1. Executive Summary`,
    ``,
    diagnosis?.executive_summary ??
      'No active SRE diagnosis available. Execute a concurrency burst to capture telemetry.',
    ``,
  ];

  if (snap && simResult) {
    lines.push(
      `## 2. Live Concurrency Invariant & Telemetry Audit`,
      ``,
      `| Telemetry Metric | Observed Value | Status |`,
      `| :--- | :---: | :---: |`,
      `| **Throughput** | \`${simResult.throughputRps.toLocaleString()} RPS\` (${simResult.elapsedMilliseconds} ms) | INFO |`,
      `| **Total Parallel Requests** | \`${snap.totalRequests.toLocaleString()}\` | INFO |`,
      `| **Stock Allocation Invariant** | \`${snap.totalUnitsAllocated} / ${snap.initialStock}\` (Remaining: \`${snap.remainingStock}\`) | ${snap.invariantIntact ? 'INTACT' : 'BREACHED'} |`,
      `| **Double-Spend Over-Allocation Leaks** | \`${snap.overAllocatedUnits}\` | ${snap.overAllocatedUnits === 0 ? 'PASS (0 LEAK)' : 'FAIL (CRITICAL)'} |`,
      `| **Idempotent Replays Deduplicated** | \`${snap.idempotentReplays.toLocaleString()}\` | ACTIVE |`,
      `| **SHA-256 Mutated Payload Conflicts (409)** | \`${snap.payloadConflicts409}\` | BLOCKED |`,
      `| **Token-Bucket Edge Sheds (429)** | \`${snap.rateLimitedRejections}\` | ${snap.rateLimitedRejections > 0 ? 'SHEDDING' : 'NOMINAL'} |`,
      `| **Circuit Breaker State & 503 Fast-Fails** | \`${snap.circuitState}\` (\`${snap.circuitBreakerRejections}\` rejected) | ${snap.circuitState === 'Closed' ? 'CLOSED' : 'TRIPPED'} |`,
      `| **Latency Distribution (P50 / P95 / P99)** | \`${(snap.p50LatencyUs / 1000).toFixed(3)}ms\` / \`${(snap.p95LatencyUs / 1000).toFixed(3)}ms\` / \`${(snap.p99LatencyUs / 1000).toFixed(3)}ms\` | ${snap.p99LatencyUs > 25000 ? 'ELEVATED' : 'OPTIMAL'} |`,
      `| **CAS Spin Retries** | \`${snap.totalCasRetries}\` | INFO |`,
      `| **Active Chaos Profile** | DB Lag=\`${snap.activeChaos.injectedDbLatencyMs}ms\`, Faults=\`${snap.activeChaos.failureRatePercent}%\`, Stampede=\`${snap.activeChaos.cacheStampedeActive}\`, ForceOpen=\`${snap.activeChaos.forceCircuitOpen}\` | CONFIG |`,
      ``
    );
  }

  if (showdownResults && showdownResults.length > 0) {
    lines.push(
      `## 3. Head-to-Head 3-Engine Comparative Benchmark`,
      ``,
      `| Engine Architecture | Throughput (RPS) | P99 Latency (ms) | Double-Spend Leaks | CAS Spins | Verdict |`,
      `| :--- | ---: | ---: | ---: | ---: | :---: |`
    );
    for (const run of showdownResults) {
      const leak = run.snapshot.overAllocatedUnits > 0;
      lines.push(
        `| \`${run.mode}\` | ${run.throughputRps.toLocaleString()} | ${(run.snapshot.p99LatencyUs / 1000).toFixed(3)} | ${run.snapshot.overAllocatedUnits} | ${run.snapshot.totalCasRetries} | ${leak ? 'FAIL (LEAK)' : 'PASS (0 LEAK)'} |`
      );
    }
    lines.push(``);
  }

  if (diagnosis) {
    lines.push(`## 4. Autonomous ReAct Root-Cause Trace`, ``);
    for (const step of diagnosis.react_trace) {
      lines.push(
        `### Step ${step.step}: ${step.phase} (\`${step.duration_ms} ms\`)`,
        ``,
        `\`\`\`json`,
        JSON.stringify(step.output, null, 2),
        `\`\`\``,
        ``
      );
    }

    if (diagnosis.recommended_code_patch) {
      lines.push(
        `## 5. Recommended Production Remediation Patch`,
        ``,
        `\`\`\`${diagnosis.code_language || 'csharp'}`,
        diagnosis.recommended_code_patch,
        `\`\`\``,
        ``
      );
    }
  }

  if (ragResult) {
    lines.push(
      `## 6. Hybrid RAG Grounded Retrieval Audit`,
      ``,
      `- **Query:** \`${ragResult.query}\``,
      `- **RRF Fusion Alpha (α):** \`${alpha.toFixed(2)}\` (${ragResult.fusion_mode ?? 'Balanced Hybrid RRF'})`,
      `- **Guardrail Status:** ${ragResult.abstained ? 'ABSTAINED (OOD Zero-Hallucination Gate)' : `GROUNDED (Confidence: ${(ragResult.confidence * 100).toFixed(1)}%)`}`,
      `- **Retrieval Latency:** \`${ragResult.latency_ms} ms\``,
      ``
    );

    if (ragResult.abstained && ragResult.abstention_reason) {
      lines.push(`> **Abstention Reason:** ${ragResult.abstention_reason}`, ``);
    }

    const tableRows = ragResult.citations.length > 0 ? ragResult.citations : ragResult.evaluated_chunks ?? [];
    if (tableRows.length > 0) {
      lines.push(
        `| Runbook ID | Title | BM25 | Dense Cosine | RRF Score | Confidence |`,
        `| :--- | :--- | ---: | ---: | ---: | ---: |`
      );
      for (const c of tableRows) {
        lines.push(
          `| \`${c.doc_id}\` | ${c.title} | ${c.bm25_score.toFixed(4)} | ${c.dense_score.toFixed(4)} | ${c.rrf_score.toFixed(5)} | ${(c.confidence * 100).toFixed(1)}% |`
        );
      }
      lines.push(``);
    }
  }

  lines.push(
    `## 7. Action Items & SLO Verification Checklist`,
    ``,
    `- [ ] Enforce Redis Atomic Lua (\`EVALSHA\`) quota gating ahead of SQL inventory mutations.`,
    `- [ ] Verify RFC \`Idempotency-Key\` SHA-256 request body fingerprinting returns \`409 Conflict\` on payload drift.`,
    `- [ ] Confirm bounded \`System.Threading.Channels\` write-behind WAL decouples checkout P99 (<20ms SLO) from SQL spikes.`,
    `- [ ] Attach OpenTelemetry W3C \`traceparent\` tail-sampling policy retaining 100% of \`status >= 400\` and \`> P95\` spans.`,
    ``,
    `---`,
    `*Generated by AegisPulse v3.0 Enterprise Super VIP Pro — Truong Van Tinh*`
  );

  return lines.join('\n');
}

export function downloadMarkdownFile(filename: string, content: string): void {
  const withBom = content.startsWith('\uFEFF') ? content : `\uFEFF${content}`;
  const blob = new Blob([withBom], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

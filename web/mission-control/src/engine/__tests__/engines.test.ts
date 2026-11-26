import { describe, expect, it } from 'vitest';
import { describeFusionMode, diagnoseEdgeTelemetry, queryEdgeHybridRag } from '../localHybridRag';
import {
  buildLatencyHistogram,
  hydrateBurstTelemetry,
  runEdgeBurstSimulation,
  STRESS_PRESETS,
} from '../localKernel';
import { generatePostMortemMarkdown } from '../postMortemExporter';

describe('AegisPulse Edge Concurrency & Hybrid RAG Engines', () => {
  const zeroChaos = {
    injectedDbLatencyMs: 0,
    failureRatePercent: 0,
    forceCircuitOpen: false,
    cacheStampedeActive: false,
  };

  it('guarantees zero double-spending and exact stock invariant in AegisLockFreeChannel mode', () => {
    const res = runEdgeBurstSimulation('AegisLockFreeChannel', 3000, 250, 0.2, zeroChaos);
    expect(res.snapshot.overAllocatedUnits).toBe(0);
    expect(res.snapshot.remainingStock).toBe(0);
    expect(res.snapshot.totalUnitsAllocated).toBe(250);
    expect(res.snapshot.invariantIntact).toBe(true);
    expect(res.snapshot.idempotentReplays).toBeGreaterThan(100);
    expect(res.snapshot.payloadConflicts409).toBeGreaterThanOrEqual(1);
  });

  it('guarantees zero double-spending in OptimisticCas mode', () => {
    const res = runEdgeBurstSimulation('OptimisticCas', 2000, 300, 0.15, zeroChaos);
    expect(res.snapshot.overAllocatedUnits).toBe(0);
    expect(res.snapshot.invariantIntact).toBe(true);
  });

  it('reproduces classic TOCTOU oversell leak in NaiveUnprotected mode', () => {
    const res = runEdgeBurstSimulation('NaiveUnprotected', 2000, 150, 0.1, {
      ...zeroChaos,
      injectedDbLatencyMs: 10,
    });
    expect(res.snapshot.overAllocatedUnits).toBeGreaterThan(0);
    expect(res.snapshot.invariantIntact).toBe(false);
  });

  it('achieves top-1 accuracy on technical SRE queries and strictly abstains on out-of-domain queries', () => {
    const hit1 = queryEdgeHybridRag('prevent flash-sale voucher double-spending with Redis Lua and RowVersion');
    expect(hit1.abstained).toBe(false);
    expect(hit1.citations[0].doc_id).toBe('RB-CONC-001');

    const hit2 = queryEdgeHybridRag('Dapper keyset pagination vs slow SQL Server OFFSET');
    expect(hit2.abstained).toBe(false);
    expect(hit2.citations[0].doc_id).toBe('RB-SQL-004');

    const ood = queryEdgeHybridRag('best sourdough pizza crust recipe with olive oil');
    expect(ood.abstained).toBe(true);
    expect(ood.citations).toHaveLength(0);
  });

  it('diagnoses SEV-1 double-spend telemetry via ReAct trace', () => {
    const naive = runEdgeBurstSimulation('NaiveUnprotected', 1500, 100, 0.1, zeroChaos);
    const diag = diagnoseEdgeTelemetry(naive.snapshot, naive.throughputRps);
    expect(diag.severity).toBe('SEV-1 CRITICAL');
    expect(diag.react_trace).toHaveLength(3);
  });
});

describe('AegisPulse v2.0 VIP PRO Telemetry, Stress Presets, RAG Alpha & Post-Mortem Suite', () => {
  const zeroChaos = {
    injectedDbLatencyMs: 0,
    failureRatePercent: 0,
    forceCircuitOpen: false,
    cacheStampedeActive: false,
  };

  it('computes a 12-bucket latency histogram summing to total requests with P50/P95/P99 markers', () => {
    const res = runEdgeBurstSimulation('AegisLockFreeChannel', 2500, 300, 0.2, zeroChaos);
    expect(res.latencyHistogram).toBeDefined();
    const bins = res.latencyHistogram!;
    expect(bins).toHaveLength(12);
    const totalCount = bins.reduce((acc, b) => acc + b.count, 0);
    expect(totalCount).toBe(2500);
    expect(bins.filter((b) => b.hasP50)).toHaveLength(1);
    expect(bins.filter((b) => b.hasP95)).toHaveLength(1);
    expect(bins.filter((b) => b.hasP99)).toHaveLength(1);

    // Direct helper check on empty input
    expect(buildLatencyHistogram([], 0, 0, 0)).toEqual([]);
  });

  it('generates synchronized 5-stage utilization bars and 16-point queue-depth sparklines', () => {
    const aegis = runEdgeBurstSimulation('AegisLockFreeChannel', 4000, 400, 0.25, zeroChaos);
    expect(aegis.stageTelemetry).toHaveLength(5);
    for (const st of aegis.stageTelemetry!) {
      expect(st.queueDepthSparkline).toHaveLength(16);
      expect(st.utilizationPct).toBeGreaterThanOrEqual(0);
      expect(st.utilizationPct).toBeLessThanOrEqual(100);
    }
    expect(aegis.stageTelemetry![4].status).not.toBe('critical');

    const naive = runEdgeBurstSimulation('NaiveUnprotected', 3000, 200, 0.2, {
      ...zeroChaos,
      injectedDbLatencyMs: 25,
    });
    expect(naive.stageTelemetry![2].status).toBe('critical');
    expect(naive.stageTelemetry![4].status).toBe('critical');
  });

  it('validates all 4 production stress presets and proves Aegis outperforms under SQL Lock Storm', () => {
    expect(STRESS_PRESETS).toHaveLength(4);
    const lockStorm = STRESS_PRESETS.find((p) => p.id === 'sql-lock-storm')!;
    expect(lockStorm).toBeDefined();

    const naive = runEdgeBurstSimulation(
      'NaiveUnprotected',
      lockStorm.concurrentRequests,
      lockStorm.initialStock,
      lockStorm.duplicateReplayRatio,
      lockStorm.chaos
    );
    const cas = runEdgeBurstSimulation(
      'OptimisticCas',
      lockStorm.concurrentRequests,
      lockStorm.initialStock,
      lockStorm.duplicateReplayRatio,
      lockStorm.chaos
    );
    const aegis = runEdgeBurstSimulation(
      'AegisLockFreeChannel',
      lockStorm.concurrentRequests,
      lockStorm.initialStock,
      lockStorm.duplicateReplayRatio,
      lockStorm.chaos
    );

    expect(naive.snapshot.overAllocatedUnits).toBeGreaterThan(0);
    expect(cas.snapshot.overAllocatedUnits).toBe(0);
    expect(aegis.snapshot.overAllocatedUnits).toBe(0);
    expect(aegis.snapshot.p99LatencyUs).toBeLessThan(cas.snapshot.p99LatencyUs);
    expect(aegis.throughputRps).toBeGreaterThan(naive.throughputRps);
  });

  it('hydrates missing histogram and stage telemetry cleanly for live backend payloads', () => {
    const raw = runEdgeBurstSimulation('OptimisticCas', 1000, 150, 0.2, zeroChaos);
    const stripped = { ...raw, latencyHistogram: undefined, stageTelemetry: undefined };
    const hydrated = hydrateBurstTelemetry(stripped);
    expect(hydrated.latencyHistogram).toHaveLength(12);
    expect(hydrated.stageTelemetry).toHaveLength(5);
  });

  it('supports interactive BM25 vs Dense RRF alpha tuning while preserving strict OOD abstention across all alpha values', () => {
    const q = 'How to prevent flash-sale voucher double-spending with Redis Lua EVALSHA and RowVersion?';
    const lex = queryEdgeHybridRag(q, 3, 0.22, 0.0);
    const hyb = queryEdgeHybridRag(q, 3, 0.22, 0.5);
    const sem = queryEdgeHybridRag(q, 3, 0.22, 1.0);

    expect(lex.abstained).toBe(false);
    expect(hyb.abstained).toBe(false);
    expect(sem.abstained).toBe(false);
    expect(lex.fusion_mode).toBe(describeFusionMode(0.0));
    expect(hyb.fusion_mode).toBe(describeFusionMode(0.5));
    expect(sem.fusion_mode).toBe(describeFusionMode(1.0));
    expect(hyb.citations[0].matched_terms?.length).toBeGreaterThan(0);
    expect(hyb.evaluated_chunks?.length).toBeGreaterThanOrEqual(3);

    // OOD adversarial queries must strictly abstain regardless of alpha slider setting
    for (const alphaVal of [0.0, 0.5, 1.0]) {
      const ood1 = queryEdgeHybridRag('Give me astrology horoscope predictions for Scorpio next month', 3, 0.22, alphaVal);
      expect(ood1.abstained).toBe(true);
      expect(ood1.citations).toHaveLength(0);
      expect(ood1.evaluated_chunks?.length).toBeGreaterThan(0);

      const ood2 = queryEdgeHybridRag('What is the best recipe for sourdough pizza crust fermentation?', 3, 0.22, alphaVal);
      expect(ood2.abstained).toBe(true);
      expect(ood2.citations).toHaveLength(0);
    }
  });

  it('exports a comprehensive SRE Incident Post-Mortem Markdown report', () => {
    const naive = runEdgeBurstSimulation('NaiveUnprotected', 2000, 200, 0.2, {
      ...zeroChaos,
      injectedDbLatencyMs: 20,
    });
    const cas = runEdgeBurstSimulation('OptimisticCas', 2000, 200, 0.2, zeroChaos);
    const aegis = runEdgeBurstSimulation('AegisLockFreeChannel', 2000, 200, 0.2, zeroChaos);
    const diag = diagnoseEdgeTelemetry(naive.snapshot, naive.throughputRps);
    const rag = queryEdgeHybridRag('Redis Atomic Lua double-spending', 3, 0.22, 0.35);

    const md = generatePostMortemMarkdown({
      simResult: naive,
      showdownResults: [naive, cas, aegis],
      diagnosis: diag,
      ragResult: rag,
      alpha: 0.35,
      runtimeModeLabel: 'EDGE DETERMINISTIC KERNEL',
    });

    expect(md).toContain('# AegisPulse SRE Incident Post-Mortem Report');
    expect(md).toContain('SEV-1 CRITICAL');
    expect(md).toContain('Head-to-Head 3-Engine Comparative Benchmark');
    expect(md).toContain('Autonomous ReAct Root-Cause Trace');
    expect(md).toContain('RRF Fusion Alpha (α):** `0.35`');
    expect(md).toContain('RB-CONC-001');
  });
});

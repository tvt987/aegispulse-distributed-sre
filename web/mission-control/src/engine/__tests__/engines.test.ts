import { describe, expect, it } from 'vitest';
import { diagnoseEdgeTelemetry, queryEdgeHybridRag } from '../localHybridRag';
import { runEdgeBurstSimulation } from '../localKernel';

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

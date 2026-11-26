import { useState } from 'react';
import { BarChart3, CheckCircle2, Flame, Gauge, ShieldAlert, Trophy, Zap } from 'lucide-react';
import { formatLatencyLabel } from '../engine/localKernel';
import type { BurstSimulationResult, ConcurrencyMode } from '../engine/types';

interface Props {
  activeResult: BurstSimulationResult;
  showdownResults: BurstSimulationResult[] | null;
  isRacing: boolean;
  onLaunchRace: () => void;
  onInspectEngineResult: (result: BurstSimulationResult) => void;
}

const ENGINE_META: Record<
  ConcurrencyMode,
  { short: string; tag: string; barClass: string }
> = {
  NaiveUnprotected: {
    short: 'Naive Read-Write',
    tag: 'Anti-Pattern · TOCTOU',
    barClass: 'from-rose-600 to-rose-400',
  },
  OptimisticCas: {
    short: 'RowVersion CAS',
    tag: 'SQL Optimistic Lock',
    barClass: 'from-sky-600 to-cyan-400',
  },
  AegisLockFreeChannel: {
    short: 'Aegis Lock-Free Channel<T>',
    tag: 'Redis Lua + Async WAL',
    barClass: 'from-emerald-500 to-cyan-400',
  },
};

export function EngineRaceArena({
  activeResult,
  showdownResults,
  isRacing,
  onLaunchRace,
  onInspectEngineResult,
}: Props) {
  const [hoveredBin, setHoveredBin] = useState<number | null>(null);
  const histogram = activeResult.latencyHistogram ?? [];
  const maxBinCount = Math.max(1, ...histogram.map((b) => b.count));
  const inspectedBin = hoveredBin !== null ? histogram[hoveredBin] : null;

  const snap = activeResult.snapshot;
  const maxRaceRps = showdownResults
    ? Math.max(1, ...showdownResults.map((r) => r.throughputRps))
    : 1;
  const maxRaceP99 = showdownResults
    ? Math.max(1, ...showdownResults.map((r) => r.snapshot.p99LatencyUs))
    : 1;

  const aegisRun = showdownResults?.find((r) => r.mode === 'AegisLockFreeChannel');
  const naiveRun = showdownResults?.find((r) => r.mode === 'NaiveUnprotected');
  const speedupVsNaive =
    aegisRun && naiveRun && naiveRun.throughputRps > 0
      ? (aegisRun.throughputRps / naiveRun.throughputRps).toFixed(2)
      : null;

  return (
    <div className="space-y-5">
      {/* Latency Distribution Histogram (P50 / P95 / P99) */}
      <section
        data-testid="latency-histogram"
        className="surface-panel rounded-2xl border p-5"
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-2 text-sm font-bold text-heading">
              <BarChart3 className="h-4 w-4 text-cyan-500 dark:text-cyan-400" />
              Request Latency Distribution Histogram ({activeResult.mode})
            </h2>
            <p className="mt-0.5 text-xs text-dim">
              Empirical microsecond distribution across {snap.totalRequests.toLocaleString()} concurrent operations
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 font-mono text-[11px]">
            <span className="rounded-md border border-cyan-500/35 bg-cyan-500/10 px-2.5 py-1 font-bold text-cyan-700 dark:text-cyan-300">
              P50: {formatLatencyLabel(snap.p50LatencyUs)}
            </span>
            <span className="rounded-md border border-amber-500/35 bg-amber-500/10 px-2.5 py-1 font-bold text-amber-700 dark:text-amber-300">
              P95: {formatLatencyLabel(snap.p95LatencyUs)}
            </span>
            <span className="rounded-md border border-rose-500/35 bg-rose-500/10 px-2.5 py-1 font-bold text-rose-700 dark:text-rose-300">
              P99: {formatLatencyLabel(snap.p99LatencyUs)}
            </span>
          </div>
        </div>

        {/* Histogram Bars */}
        <div className="surface-inset mt-4 rounded-xl border px-3 pb-3 pt-6">
          <div className="grid h-36 grid-cols-12 items-end gap-1.5 sm:gap-2">
            {histogram.map((bin, idx) => {
              const heightPct = bin.count === 0 ? 3 : Math.max(8, Math.round((bin.count / maxBinCount) * 100));
              const isSelected = hoveredBin === idx;

              let barBg = 'bg-gradient-to-t from-cyan-600/80 to-emerald-400/90';
              if (bin.hasP99) barBg = 'bg-gradient-to-t from-rose-600 to-rose-400';
              else if (bin.hasP95) barBg = 'bg-gradient-to-t from-amber-600 to-amber-400';
              else if (bin.hasP50) barBg = 'bg-gradient-to-t from-cyan-600 to-cyan-300';

              const markerLabel = bin.hasP99
                ? 'P99'
                : bin.hasP95
                  ? 'P95'
                  : bin.hasP50
                    ? 'P50'
                    : null;

              return (
                <button
                  key={`${bin.minUs}-${idx}`}
                  type="button"
                  onMouseEnter={() => setHoveredBin(idx)}
                  onMouseLeave={() => setHoveredBin(null)}
                  onFocus={() => setHoveredBin(idx)}
                  onBlur={() => setHoveredBin(null)}
                  onClick={() => setHoveredBin(idx === hoveredBin ? null : idx)}
                  className="group relative flex h-full flex-col items-center justify-end focus:outline-none"
                  aria-label={`Latency bin ${formatLatencyLabel(bin.minUs)} to ${formatLatencyLabel(bin.maxUs)}: ${bin.count} requests (${bin.pct}%)`}
                >
                  {markerLabel && (
                    <span
                      className={`mb-1 rounded px-1 py-0.5 font-mono text-[9px] font-extrabold leading-none ${
                        markerLabel === 'P99'
                          ? 'bg-rose-500 text-white'
                          : markerLabel === 'P95'
                            ? 'bg-amber-500 text-slate-950'
                            : 'bg-cyan-500 text-slate-950'
                      }`}
                    >
                      {markerLabel}
                    </span>
                  )}
                  <div
                    style={{ height: `${heightPct}%` }}
                    className={`w-full rounded-t-md transition-all duration-300 ${barBg} ${
                      isSelected ? 'ring-2 ring-cyan-400 brightness-115' : 'opacity-90 group-hover:opacity-100'
                    }`}
                  />
                </button>
              );
            })}
          </div>

          {/* X-axis ticks */}
          <div className="mt-2 grid grid-cols-6 gap-1 font-mono text-[9.5px] text-faint sm:grid-cols-12">
            {histogram.map((bin, idx) => (
              <span
                key={`lbl-${idx}`}
                className={`truncate text-center ${idx % 2 === 1 ? 'hidden sm:block' : ''}`}
              >
                {bin.label}
              </span>
            ))}
          </div>

          {/* Inline Bin Telemetry Footer */}
          <div className="border-hairline mt-3 flex flex-wrap items-center justify-between gap-2 border-t pt-2.5 font-mono text-[11px] text-dim">
            {inspectedBin ? (
              <span>
                Bin Window:{' '}
                <strong className="text-heading">
                  {formatLatencyLabel(inspectedBin.minUs)} – {formatLatencyLabel(inspectedBin.maxUs)}
                </strong>{' '}
                · Volume: <strong className="text-cyan-600 dark:text-cyan-300">{inspectedBin.count.toLocaleString()} reqs</strong> ({inspectedBin.pct}%)
              </span>
            ) : (
              <span>Hover or tap any latency bucket to inspect exact request density & percentile band.</span>
            )}
            <span>
              Burst Wall-Time: <strong className="text-heading">{activeResult.elapsedMilliseconds} ms</strong>
            </span>
          </div>
        </div>
      </section>

      {/* Head-to-Head 3-Engine Comparative Race Arena */}
      <section
        data-testid="showdown-matrix"
        className="surface-panel rounded-2xl border p-5"
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-2 text-sm font-bold text-heading">
              <Trophy className="h-4 w-4 text-amber-500 dark:text-amber-400" />
              Head-to-Head &ldquo;Race All 3 Engines&rdquo; Comparative Arena
            </h2>
            <p className="mt-0.5 text-xs text-dim">
              Side-by-side execution of Naive Read-Write vs RowVersion CAS vs Aegis Lock-Free Channel&lt;T&gt; under identical load &amp; chaos
            </p>
          </div>

          <button
            type="button"
            data-testid="btn-race-arena-trigger"
            disabled={isRacing}
            onClick={onLaunchRace}
            className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-amber-500 to-cyan-500 px-4 py-2 text-xs font-extrabold text-slate-950 shadow-sm transition hover:brightness-110 disabled:opacity-50"
          >
            <Zap className="h-3.5 w-3.5 fill-current" />
            {isRacing ? 'Racing All 3 Engines...' : showdownResults ? 'Re-Run 3-Engine Race' : 'Race All 3 Engines'}
          </button>
        </div>

        {!showdownResults ? (
          <div className="surface-inset mt-4 flex flex-col items-center justify-between gap-4 rounded-xl border border-dashed p-6 text-center sm:flex-row sm:text-left">
            <div>
              <div className="font-mono text-xs font-bold uppercase tracking-wider text-amber-600 dark:text-amber-300">
                Ready for Comparative Benchmark
              </div>
              <p className="mt-1 text-xs text-dim">
                Execute all 3 concurrency engines sequentially with the active workload ({activeResult.concurrentRequests.toLocaleString()} requests, {activeResult.initialStock} stock) to compare RPS throughput, P99 tail latency, and Double-Spend Leak verdicts.
              </p>
            </div>
            <button
              type="button"
              onClick={onLaunchRace}
              className="surface-chip shrink-0 rounded-lg border px-3.5 py-2 font-mono text-xs font-bold text-heading transition hover:border-cyan-500"
            >
              Launch Race Now
            </button>
          </div>
        ) : (
          <div className="mt-4 space-y-5">
            {/* Comparative RPS & P99 Charts */}
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              {/* Throughput RPS Bars */}
              <div className="surface-inset rounded-xl border p-4">
                <div className="mb-3 flex items-center justify-between">
                  <span className="flex items-center gap-1.5 font-mono text-[11px] font-bold uppercase tracking-wider text-dim">
                    <Flame className="h-3.5 w-3.5 text-cyan-500" />
                    Throughput Comparison (Higher is Better)
                  </span>
                  {speedupVsNaive && (
                    <span className="rounded bg-emerald-500/15 px-2 py-0.5 font-mono text-[10.5px] font-bold text-emerald-600 dark:text-emerald-300">
                      Aegis {speedupVsNaive}x vs Naive
                    </span>
                  )}
                </div>
                <div className="space-y-3">
                  {showdownResults.map((run) => {
                    const meta = ENGINE_META[run.mode];
                    const widthPct = Math.max(10, Math.round((run.throughputRps / maxRaceRps) * 100));
                    return (
                      <div key={`rps-${run.mode}`}>
                        <div className="mb-1 flex items-center justify-between font-mono text-[11px]">
                          <span className="font-semibold text-heading">{meta.short}</span>
                          <span className="font-bold text-cyan-600 dark:text-cyan-300">
                            {run.throughputRps.toLocaleString()} RPS
                          </span>
                        </div>
                        <div className="h-3 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800/90">
                          <div
                            style={{ width: `${widthPct}%` }}
                            className={`h-full rounded-full bg-gradient-to-r ${meta.barClass} transition-all duration-700`}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* P99 Tail Latency Bars */}
              <div className="surface-inset rounded-xl border p-4">
                <div className="mb-3 flex items-center justify-between">
                  <span className="flex items-center gap-1.5 font-mono text-[11px] font-bold uppercase tracking-wider text-dim">
                    <Gauge className="h-3.5 w-3.5 text-amber-500" />
                    P99 Tail Latency (Lower is Better)
                  </span>
                  <span className="font-mono text-[10.5px] text-faint">SLO Target &lt; 20ms</span>
                </div>
                <div className="space-y-3">
                  {showdownResults.map((run) => {
                    const meta = ENGINE_META[run.mode];
                    const widthPct = Math.max(6, Math.round((run.snapshot.p99LatencyUs / maxRaceP99) * 100));
                    const isSlow = run.snapshot.p99LatencyUs > 15000;
                    return (
                      <div key={`p99-${run.mode}`}>
                        <div className="mb-1 flex items-center justify-between font-mono text-[11px]">
                          <span className="font-semibold text-heading">{meta.short}</span>
                          <span
                            className={`font-bold ${
                              isSlow
                                ? 'text-rose-600 dark:text-rose-400'
                                : 'text-emerald-600 dark:text-emerald-300'
                            }`}
                          >
                            {formatLatencyLabel(run.snapshot.p99LatencyUs)}
                          </span>
                        </div>
                        <div className="h-3 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800/90">
                          <div
                            style={{ width: `${widthPct}%` }}
                            className={`h-full rounded-full transition-all duration-700 ${
                              run.mode === 'NaiveUnprotected'
                                ? 'bg-gradient-to-r from-rose-600 to-amber-500'
                                : run.mode === 'OptimisticCas'
                                  ? 'bg-gradient-to-r from-amber-500 to-sky-400'
                                  : 'bg-gradient-to-r from-emerald-500 to-cyan-400'
                            }`}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* 3-Column Double-Spend Verdict Cards */}
            <div className="grid grid-cols-1 gap-3.5 md:grid-cols-3">
              {showdownResults.map((run) => {
                const leak = run.snapshot.overAllocatedUnits > 0;
                const meta = ENGINE_META[run.mode];
                const isWinner = run.mode === 'AegisLockFreeChannel' && !leak;
                return (
                  <div
                    key={run.mode}
                    className={`flex flex-col justify-between rounded-xl border p-4 transition ${
                      leak
                        ? 'border-rose-500/50 bg-rose-500/[0.06] dark:bg-rose-950/20'
                        : isWinner
                          ? 'border-emerald-500/50 bg-emerald-500/[0.06] dark:bg-emerald-950/15'
                          : 'surface-inset'
                    }`}
                  >
                    <div>
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <div className="font-mono text-xs font-bold text-heading">{meta.short}</div>
                          <div className="font-mono text-[10px] text-faint">{meta.tag}</div>
                        </div>
                        <span
                          className={`inline-flex shrink-0 items-center gap-1 rounded px-2 py-0.5 font-mono text-[10px] font-bold ${
                            leak
                              ? 'bg-rose-500/20 text-rose-600 dark:text-rose-300'
                              : 'bg-emerald-500/20 text-emerald-700 dark:text-emerald-300'
                          }`}
                        >
                          {leak ? (
                            <>
                              <ShieldAlert className="h-3 w-3" />
                              FAIL (+{run.snapshot.overAllocatedUnits} LEAK)
                            </>
                          ) : (
                            <>
                              <CheckCircle2 className="h-3 w-3" />
                              PASS (0 LEAK)
                            </>
                          )}
                        </span>
                      </div>

                      <div className="mt-3 space-y-1.5 font-mono text-[11px] text-body">
                        <div className="flex justify-between">
                          <span className="text-dim">Throughput</span>
                          <strong className="text-heading">{run.throughputRps.toLocaleString()} RPS</strong>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-dim">P50 / P99 Latency</span>
                          <strong className="text-heading">
                            {formatLatencyLabel(run.snapshot.p50LatencyUs)} / {formatLatencyLabel(run.snapshot.p99LatencyUs)}
                          </strong>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-dim">Allocated / Cap</span>
                          <strong className={leak ? 'text-rose-600 dark:text-rose-400' : 'text-emerald-600 dark:text-emerald-400'}>
                            {run.snapshot.totalUnitsAllocated} / {run.snapshot.initialStock}
                          </strong>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-dim">Idempotent Replays</span>
                          <strong className="text-heading">{run.snapshot.idempotentReplays.toLocaleString()}</strong>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-dim">CAS Spin Retries</span>
                          <strong className="text-heading">{run.snapshot.totalCasRetries}</strong>
                        </div>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => onInspectEngineResult(run)}
                      className="surface-chip mt-3.5 w-full rounded-lg border py-1.5 font-mono text-[11px] font-semibold text-heading transition hover:border-cyan-500"
                    >
                      Inspect in Live Canvas &amp; Traces
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

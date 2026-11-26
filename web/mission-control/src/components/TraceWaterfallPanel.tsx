import { useState } from 'react';
import type { TransactionReceipt } from '../engine/types';

interface Props {
  traces: TransactionReceipt[];
}

function statusBadgeClass(status: string, remaining: number): string {
  if (status === 'Allocated' && remaining < 0) {
    return 'bg-rose-500/20 text-rose-600 dark:text-rose-300 border-rose-500/40';
  }
  switch (status) {
    case 'Allocated':
      return 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/35';
    case 'IdempotentReplay':
      return 'bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/35';
    case 'PayloadConflict409':
      return 'bg-rose-500/15 text-rose-700 dark:text-rose-300 border-rose-500/35';
    case 'RateLimited429':
    case 'CircuitOpen503':
      return 'bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/35';
    default:
      return 'bg-slate-500/15 text-slate-700 dark:text-slate-300 border-slate-500/35';
  }
}

export function TraceWaterfallPanel({ traces }: Props) {
  const [selectedIdx, setSelectedIdx] = useState(0);
  const safeIdx = selectedIdx < traces.length ? selectedIdx : 0;
  const active = traces[safeIdx] ?? traces[0];

  if (!active) {
    return (
      <div className="surface-panel rounded-xl border p-8 text-center text-sm text-dim">
        Execute a concurrency burst in Tab 1 to capture live OpenTelemetry microsecond spans.
      </div>
    );
  }

  const totalUs = Math.max(
    1,
    active.latencyMicroseconds,
    ...active.spans.map((s) => s.startOffsetUs + s.durationUs)
  );

  const httpStatus =
    active.status === 'Allocated' || active.status === 'IdempotentReplay'
      ? 200
      : active.status === 'PayloadConflict409'
        ? 409
        : active.status === 'OutOfStock'
          ? 422
          : active.status === 'RateLimited429'
            ? 429
            : 503;

  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
      {/* Left Trace Selector List */}
      <div className="surface-panel rounded-2xl border p-4 lg:col-span-5">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-bold text-heading">Sampled W3C Distributed Traces</h3>
          <span className="font-mono text-xs text-dim">{traces.length} captured</span>
        </div>
        <div className="max-h-[480px] space-y-2 overflow-y-auto pr-1">
          {traces.map((tr, idx) => {
            const isOversell = tr.status === 'Allocated' && tr.remainingStockAfter < 0;
            return (
              <button
                key={`${tr.traceId}-${idx}`}
                type="button"
                onClick={() => setSelectedIdx(idx)}
                className={`w-full rounded-xl border p-3 text-left transition ${
                  idx === safeIdx
                    ? 'border-cyan-500/70 bg-cyan-500/10'
                    : 'surface-inset hover:border-slate-500/60'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span
                    className={`rounded border px-2 py-0.5 font-mono text-[11px] font-semibold ${statusBadgeClass(
                      tr.status,
                      tr.remainingStockAfter
                    )}`}
                  >
                    {isOversell ? 'RACE_DOUBLE_SPEND' : tr.status}
                  </span>
                  <span className="font-mono text-xs font-semibold text-heading">
                    {tr.latencyMicroseconds} µs
                  </span>
                </div>
                <div className="mt-1.5 flex items-center justify-between font-mono text-[11px] text-dim">
                  <span>trace: {tr.traceId.slice(0, 14)}…</span>
                  <span>
                    user={tr.userId} · stockAfter={tr.remainingStockAfter}
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Right Gantt Span Waterfall + RFC 9457 Inspector */}
      <div className="space-y-4 lg:col-span-7">
        <div className="surface-panel rounded-2xl border p-4">
          <div className="border-hairline mb-3 flex flex-wrap items-center justify-between gap-2 border-b pb-3">
            <div className="min-w-0">
              <div className="truncate font-mono text-xs text-cyan-600 dark:text-cyan-400">
                traceparent: 00-{active.traceId}-
                {active.spans[0]?.spanId?.slice(0, 16).padEnd(16, '0') ?? '0000000000000001'}-01
              </div>
              <h3 className="mt-0.5 text-sm font-bold text-heading">
                HTTP {httpStatus} · Order {active.orderId} · Total Duration:{' '}
                {active.latencyMicroseconds} µs
              </h3>
            </div>
            <span className="surface-chip rounded-md border px-2.5 py-1 font-mono text-xs font-semibold text-body">
              Mode: {active.mode}
            </span>
          </div>

          {/* Span Gantt Bars */}
          <div className="space-y-3">
            {active.spans.map((sp) => {
              const leftPct = Math.min(92, (sp.startOffsetUs / totalUs) * 100);
              const widthPct = Math.max(6, Math.min(100 - leftPct, (sp.durationUs / totalUs) * 100));
              const isErr =
                sp.status.includes('409') ||
                sp.status.includes('429') ||
                sp.status.includes('503') ||
                sp.status.includes('BUG');
              return (
                <div key={sp.spanId} className="surface-inset rounded-xl border p-2.5">
                  <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2 text-xs">
                    <div className="font-mono font-semibold text-heading">
                      <span className="text-cyan-600 dark:text-cyan-400">[{sp.component}]</span>{' '}
                      {sp.name}
                    </div>
                    <div className="font-mono text-[11px] text-dim">
                      +{sp.startOffsetUs}µs → {sp.durationUs}µs ·{' '}
                      <strong
                        className={
                          isErr
                            ? 'text-rose-600 dark:text-rose-400'
                            : 'text-emerald-600 dark:text-emerald-400'
                        }
                      >
                        {sp.status}
                      </strong>
                    </div>
                  </div>
                  <div className="relative h-3 w-full overflow-hidden rounded bg-slate-200 dark:bg-slate-900">
                    <div
                      style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
                      className={`absolute top-0 h-full rounded ${
                        isErr
                          ? 'bg-gradient-to-r from-rose-500 to-amber-500'
                          : 'bg-gradient-to-r from-cyan-500 to-emerald-400'
                      }`}
                    />
                  </div>
                  <div className="mt-1.5 flex flex-wrap gap-2">
                    {Object.entries(sp.attributes).map(([k, v]) => (
                      <span
                        key={k}
                        className="surface-chip rounded border px-1.5 py-0.5 font-mono text-[10.5px] text-dim"
                      >
                        {k}=<span className="text-heading">{v}</span>
                      </span>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* HTTP Wire Headers & RFC 9457 ProblemDetails / Receipt */}
        <div className="surface-panel rounded-2xl border p-4">
          <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-dim">
            HTTP Wire Response &amp; RFC 9457 ProblemDetails / Receipt Payload
          </div>
          <pre className="surface-code overflow-x-auto rounded-xl border p-3 font-mono text-xs text-cyan-200">
            {JSON.stringify(
              {
                httpStatus,
                headers: {
                  'X-Trace-Id': active.traceId,
                  'X-Latency-Us': String(active.latencyMicroseconds),
                  'X-Idempotent-Replay': String(active.isIdempotentReplay),
                },
                body:
                  httpStatus >= 400
                    ? {
                        type: `https://httpstatuses.io/${httpStatus}`,
                        title: active.status,
                        status: httpStatus,
                        traceId: active.traceId,
                      }
                    : {
                        orderId: active.orderId,
                        skuId: active.skuId,
                        status: active.status,
                        remainingStockAfter: active.remainingStockAfter,
                        casRetries: active.casRetries,
                      },
              },
              null,
              2
            )}
          </pre>
        </div>
      </div>
    </div>
  );
}

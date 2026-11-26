import { Fragment, useState } from 'react';
import {
  Check,
  Copy,
  Download,
  Search,
  ShieldAlert,
  ShieldCheck,
  SlidersHorizontal,
} from 'lucide-react';
import { describeFusionMode } from '../engine/localHybridRag';
import type { RagCitation, RagQueryResponse } from '../engine/types';

export interface RagPresetItem {
  label: string;
  q: string;
  adversarial: boolean;
}

export const PRESET_RAG_QUERIES: RagPresetItem[] = [
  {
    label: 'Flash-Sale Double-Spend (Redis Lua + RowVersion)',
    q: 'How to prevent flash-sale voucher double-spending and negative stock with Redis Lua and RowVersion?',
    adversarial: false,
  },
  {
    label: 'Idempotency-Key & 409 Conflict Guard',
    q: 'Mobile clients retry POST orders on timeout causing duplicate charges; how to implement Idempotency-Key and 409 conflict?',
    adversarial: false,
  },
  {
    label: 'Thundering Herd Cache Stampede',
    q: 'Redis hot key expiration causes thundering herd cache stampede and SQL CPU 100%',
    adversarial: false,
  },
  {
    label: '.NET ThreadPool Starvation (.Result)',
    q: 'Kestrel low CPU but high request queue from sync-over-async Task.Result ThreadPool starvation',
    adversarial: false,
  },
  {
    label: 'Dapper Keyset vs OFFSET Pagination',
    q: 'Optimize slow SQL Server OFFSET pagination and lock contention using Dapper keyset pagination',
    adversarial: false,
  },
  {
    label: 'Adversarial OOD: Sourdough Pizza',
    q: 'What is the best recipe for sourdough pizza crust fermentation?',
    adversarial: true,
  },
  {
    label: 'Adversarial OOD: Astrology Horoscope',
    q: 'Give me astrology horoscope predictions for Scorpio next month',
    adversarial: true,
  },
];

interface Props {
  ragQuery: string;
  onRagQueryChange: (q: string) => void;
  alpha: number;
  onAlphaChange: (nextAlpha: number) => void;
  ragResult: RagQueryResponse | null;
  onSearch: (customQuery?: string, overrideAlpha?: number) => void;
  onExportPostMortem: () => void;
  onCopyPostMortem: () => Promise<boolean>;
}

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function renderHighlightedText(text: string, terms: string[]) {
  const cleanTerms = terms
    .filter((t) => t.length >= 3)
    .sort((a, b) => b.length - a.length)
    .slice(0, 8);
  if (cleanTerms.length === 0) return text;

  const pattern = new RegExp(`(${cleanTerms.map(escapeRegExp).join('|')})`, 'gi');
  const parts = text.split(pattern);
  return parts.map((part, idx) => {
    const isHit = cleanTerms.some((t) => t.toLowerCase() === part.toLowerCase());
    return isHit ? (
      <mark key={idx} className="rag-highlight">
        {part}
      </mark>
    ) : (
      <Fragment key={idx}>{part}</Fragment>
    );
  });
}

function ChunkScoreBreakdown({
  cit,
  isRejected,
}: {
  cit: RagCitation;
  isRejected?: boolean;
}) {
  const bm25Pct = Math.round(Math.min(1, cit.bm25_norm ?? Math.min(1, cit.bm25_score / 12)) * 100);
  const densePct = Math.round(Math.min(1, cit.dense_score) * 100);
  const rrfPct = Math.round(Math.min(1, cit.confidence) * 100);
  const terms = cit.matched_terms ?? [];

  return (
    <div
      className={`surface-inset rounded-xl border p-3.5 transition ${
        isRejected ? 'opacity-80' : ''
      }`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-xs font-bold text-cyan-600 dark:text-cyan-300">
            [{cit.doc_id}] {cit.title}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-1.5 font-mono text-[10px]">
          {cit.bm25_rank !== undefined && (
            <span className="surface-chip rounded border px-1.5 py-0.5 text-dim">
              BM25 #{cit.bm25_rank}
            </span>
          )}
          {cit.dense_rank !== undefined && (
            <span className="surface-chip rounded border px-1.5 py-0.5 text-dim">
              Dense #{cit.dense_rank}
            </span>
          )}
          <span className="rounded bg-slate-200 px-2 py-0.5 font-semibold text-slate-700 dark:bg-slate-800 dark:text-slate-300">
            {cit.severity_tier} · {cit.category}
          </span>
        </div>
      </div>

      {/* Real-Time Per-Chunk BM25 / Cosine / RRF Final Score Breakdown Bars */}
      <div className="mt-3 grid grid-cols-1 gap-2.5 sm:grid-cols-3">
        <div>
          <div className="mb-1 flex items-center justify-between font-mono text-[10.5px]">
            <span className="text-dim">BM25 Lexical</span>
            <strong className="text-cyan-600 dark:text-cyan-300">{cit.bm25_score.toFixed(3)}</strong>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
            <div
              style={{ width: `${Math.max(bm25Pct > 0 ? 4 : 0, bm25Pct)}%` }}
              className="h-full rounded-full bg-gradient-to-r from-cyan-600 to-cyan-400 transition-all duration-300"
            />
          </div>
        </div>

        <div>
          <div className="mb-1 flex items-center justify-between font-mono text-[10.5px]">
            <span className="text-dim">384d Cosine</span>
            <strong className="text-emerald-600 dark:text-emerald-300">{cit.dense_score.toFixed(3)}</strong>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
            <div
              style={{ width: `${Math.max(densePct > 0 ? 4 : 0, densePct)}%` }}
              className="h-full rounded-full bg-gradient-to-r from-emerald-600 to-emerald-400 transition-all duration-300"
            />
          </div>
        </div>

        <div>
          <div className="mb-1 flex items-center justify-between font-mono text-[10.5px]">
            <span className="text-dim">RRF Final</span>
            <strong
              className={
                isRejected
                  ? 'text-amber-600 dark:text-amber-400'
                  : 'text-sky-600 dark:text-sky-300'
              }
            >
              {(cit.confidence * 100).toFixed(1)}% ({cit.rrf_score.toFixed(4)})
            </strong>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
            <div
              style={{ width: `${Math.max(rrfPct > 0 ? 4 : 0, rrfPct)}%` }}
              className={`h-full rounded-full transition-all duration-300 ${
                isRejected
                  ? 'bg-gradient-to-r from-amber-600 to-rose-400'
                  : 'bg-gradient-to-r from-sky-600 to-cyan-400'
              }`}
            />
          </div>
        </div>
      </div>

      {/* Grounded Citation Highlighting Snippet */}
      {!isRejected && cit.snippet && (
        <p className="mt-2.5 text-[11.5px] leading-relaxed text-body">
          {renderHighlightedText(cit.snippet, terms)}
        </p>
      )}

      {!isRejected && terms.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <span className="font-mono text-[10px] uppercase tracking-wider text-faint">
            Grounded Hits:
          </span>
          {terms.map((t) => (
            <span
              key={t}
              className="rounded border border-cyan-500/30 bg-cyan-500/10 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-cyan-700 dark:text-cyan-300"
            >
              {t}
            </span>
          ))}
        </div>
      )}

      {!isRejected && (
        <pre className="surface-code mt-2.5 overflow-x-auto rounded-lg border p-2.5 font-mono text-[11px] text-slate-200">
          {cit.reference_code}
        </pre>
      )}
    </div>
  );
}

export function HybridRagPlayground({
  ragQuery,
  onRagQueryChange,
  alpha,
  onAlphaChange,
  ragResult,
  onSearch,
  onExportPostMortem,
  onCopyPostMortem,
}: Props) {
  const [copied, setCopied] = useState(false);
  const [exported, setExported] = useState(false);

  const lexicalPct = Math.round((1 - alpha) * 100);
  const semanticPct = Math.round(alpha * 100);
  const modeLabel = describeFusionMode(alpha);

  const primaryTerms = ragResult?.citations[0]?.matched_terms ?? [];
  const confidencePct = Math.round((ragResult?.confidence ?? 0) * 100);

  async function handleCopyClick() {
    const ok = await onCopyPostMortem();
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    }
  }

  function handleExportClick() {
    onExportPostMortem();
    setExported(true);
    setTimeout(() => setExported(false), 1800);
  }

  return (
    <div className="surface-panel rounded-2xl border p-5">
      {/* Header + 1-Click Post-Mortem Markdown Export */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-bold text-heading">
            <Search className="h-4 w-4 text-emerald-500 dark:text-emerald-400" />
            Hybrid RAG Playground (BM25 + 384d Dense RRF + OOD Abstention)
          </h2>
          <p className="mt-1 text-xs text-dim">
            Tune the RRF fusion alpha live, probe custom incident queries, and export a full grounded Post-Mortem report.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            data-testid="btn-copy-postmortem"
            onClick={handleCopyClick}
            className="surface-chip inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 font-mono text-[11px] font-semibold text-body transition hover:border-cyan-500"
          >
            {copied ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
            {copied ? 'Copied .md' : 'Copy .md'}
          </button>
          <button
            type="button"
            data-testid="btn-export-postmortem"
            onClick={handleExportClick}
            className="inline-flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-cyan-500 to-emerald-500 px-3 py-1.5 font-mono text-[11px] font-extrabold text-slate-950 shadow-sm transition hover:brightness-110"
          >
            {exported ? <Check className="h-3.5 w-3.5" /> : <Download className="h-3.5 w-3.5" />}
            {exported ? 'Exported Post-Mortem' : 'Export Post-Mortem .md'}
          </button>
        </div>
      </div>

      {/* Interactive BM25 vs Dense Vector RRF Alpha Slider */}
      <div className="surface-inset mt-4 rounded-xl border p-3.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="flex items-center gap-1.5 font-mono text-[11px] font-bold text-heading">
            <SlidersHorizontal className="h-3.5 w-3.5 text-cyan-500" />
            RRF Fusion Alpha (α = {alpha.toFixed(2)})
          </span>
          <span className="rounded-md border border-cyan-500/30 bg-cyan-500/10 px-2 py-0.5 font-mono text-[10.5px] font-semibold text-cyan-700 dark:text-cyan-300">
            {modeLabel}
          </span>
        </div>

        <div className="mt-2.5 flex items-center gap-3">
          <span className="shrink-0 font-mono text-[10.5px] font-semibold text-cyan-600 dark:text-cyan-300">
            BM25 {lexicalPct}%
          </span>
          <input
            data-testid="rag-alpha-slider"
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={alpha}
            onChange={(e) => {
              const next = Number(e.target.value);
              onAlphaChange(next);
              onSearch(ragQuery, next);
            }}
            aria-label="BM25 vs Dense Vector RRF Alpha Slider"
            className="w-full accent-cyan-500"
          />
          <span className="shrink-0 font-mono text-[10.5px] font-semibold text-emerald-600 dark:text-emerald-300">
            Dense {semanticPct}%
          </span>
        </div>

        <div className="mt-2.5 flex flex-wrap gap-1.5">
          {[
            { a: 0.0, label: 'α = 0.0 · Pure Lexical BM25' },
            { a: 0.5, label: 'α = 0.5 · Balanced Hybrid RRF' },
            { a: 1.0, label: 'α = 1.0 · Pure Semantic Dense' },
          ].map((snapBtn) => {
            const active = Math.abs(alpha - snapBtn.a) < 0.01;
            return (
              <button
                key={snapBtn.a}
                type="button"
                data-testid={`alpha-preset-${snapBtn.a}`}
                onClick={() => {
                  onAlphaChange(snapBtn.a);
                  onSearch(ragQuery, snapBtn.a);
                }}
                className={`rounded-md border px-2 py-1 font-mono text-[10.5px] font-semibold transition ${
                  active
                    ? 'border-cyan-500 bg-cyan-500/15 text-cyan-700 dark:text-cyan-200'
                    : 'surface-chip text-dim hover:text-heading'
                }`}
              >
                {snapBtn.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Custom Incident Query Input */}
      <div className="mt-3.5 flex gap-2">
        <input
          data-testid="rag-input"
          type="text"
          value={ragQuery}
          onChange={(e) => onRagQueryChange(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && onSearch(ragQuery, alpha)}
          placeholder="Ask about Redis Lua, RowVersion, Dapper, ThreadPool, OTel, or test OOD abstention..."
          className="surface-inset flex-1 rounded-xl border px-3.5 py-2 text-xs text-heading placeholder:text-faint focus:border-cyan-500 focus:outline-none"
        />
        <button
          type="button"
          data-testid="btn-rag-search"
          onClick={() => onSearch(ragQuery, alpha)}
          className="rounded-xl bg-cyan-500 px-4 py-2 text-xs font-extrabold text-slate-950 transition hover:bg-cyan-400"
        >
          Retrieve
        </button>
      </div>

      {/* Preset Query Chips (Zero Emojis) */}
      <div className="mt-3 flex flex-wrap gap-1.5">
        {PRESET_RAG_QUERIES.map((item) => (
          <button
            key={item.label}
            type="button"
            data-testid={
              item.adversarial
                ? `ood-chip-${item.label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`
                : undefined
            }
            onClick={() => onSearch(item.q, alpha)}
            className={`inline-flex items-center gap-1 rounded-lg border px-2.5 py-1 text-[11px] font-medium transition ${
              item.adversarial
                ? 'border-rose-500/40 bg-rose-500/10 text-rose-700 hover:bg-rose-500/20 dark:bg-rose-950/30 dark:text-rose-300'
                : 'surface-chip text-body hover:border-cyan-500/60 hover:text-heading'
            }`}
          >
            {item.adversarial && <ShieldAlert className="h-3 w-3 shrink-0" />}
            {item.label}
          </button>
        ))}
      </div>

      {/* Grounded Result / OOD Abstention Panel */}
      {ragResult && (
        <div data-testid="rag-result-panel" className="mt-4 space-y-3">
          <div
            className={`rounded-xl border p-4 ${
              ragResult.abstained
                ? 'border-amber-500/50 bg-amber-500/[0.08] dark:bg-amber-950/25'
                : 'border-emerald-500/45 bg-emerald-500/[0.07] dark:bg-emerald-950/15'
            }`}
          >
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
              <span
                className={`inline-flex items-center gap-1.5 font-mono font-bold ${
                  ragResult.abstained
                    ? 'text-amber-700 dark:text-amber-300'
                    : 'text-emerald-700 dark:text-emerald-300'
                }`}
              >
                {ragResult.abstained ? (
                  <>
                    <ShieldAlert className="h-4 w-4 shrink-0" />
                    ZERO-HALLUCINATION OOD ABSTENTION TRIGGERED
                  </>
                ) : (
                  <>
                    <ShieldCheck className="h-4 w-4 shrink-0" />
                    GROUNDED ANSWER · Confidence {(ragResult.confidence * 100).toFixed(1)}%
                  </>
                )}
              </span>
              <span className="font-mono text-[11px] text-dim">
                α={alpha.toFixed(2)} · {ragResult.latency_ms} ms
              </span>
            </div>

            {/* Confidence Meter with 22% Abstention Gate Marker */}
            <div className="mt-2.5">
              <div className="relative h-2 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
                <div
                  style={{ width: `${Math.max(2, confidencePct)}%` }}
                  className={`h-full rounded-full transition-all duration-300 ${
                    ragResult.abstained
                      ? 'bg-gradient-to-r from-rose-500 to-amber-500'
                      : 'bg-gradient-to-r from-emerald-500 to-cyan-400'
                  }`}
                />
                {/* 22% Abstention Threshold Marker */}
                <div
                  style={{ left: '22%' }}
                  title="Groundedness Abstention Gate (22%)"
                  className="absolute top-0 h-full w-0.5 bg-slate-900 dark:bg-white"
                />
              </div>
              <div className="mt-1 flex justify-between font-mono text-[10px] text-faint">
                <span>0%</span>
                <span>Gate: 22%</span>
                <span>100%</span>
              </div>
            </div>

            <p className="mt-2.5 whitespace-pre-line text-xs leading-relaxed text-body">
              {ragResult.abstained
                ? ragResult.synthesized_answer
                : renderHighlightedText(ragResult.synthesized_answer, primaryTerms)}
            </p>
            {ragResult.abstention_reason && (
              <p className="mt-2 font-mono text-[11px] text-amber-700 dark:text-amber-300">
                {ragResult.abstention_reason}
              </p>
            )}
          </div>

          {/* Per-Chunk Breakdown Cards */}
          {!ragResult.abstained &&
            ragResult.citations.map((cit) => (
              <ChunkScoreBreakdown key={cit.doc_id} cit={cit} />
            ))}

          {/* When OOD Abstained, reveal Top Rejected Candidate Scores for full observability */}
          {ragResult.abstained && ragResult.evaluated_chunks && ragResult.evaluated_chunks.length > 0 && (
            <div className="space-y-2">
              <div className="font-mono text-[10.5px] font-bold uppercase tracking-wider text-faint">
                Abstention Telemetry · Top Rejected Candidates (Below 22% Gate)
              </div>
              {ragResult.evaluated_chunks.slice(0, 3).map((cit) => (
                <ChunkScoreBreakdown key={`rej-${cit.doc_id}`} cit={cit} isRejected />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

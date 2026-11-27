import {
  CheckCircle2,
  Clock,
  Download,
  FileJson,
  FileText,
  Play,
  RotateCcw,
  ShieldCheck,
  Terminal,
  Zap,
} from 'lucide-react';
import {
  canExecuteStep,
  getNextPendingStep,
  type RunbookState,
  type RunbookStepId,
} from '../engines/runbookEngine';
import { UI_COPY, type LangMode } from '../i18n/translations';

interface Props {
  runbook: RunbookState;
  currentLiveP99Ms: number;
  lang: LangMode;
  onExecuteStep: (stepId: RunbookStepId) => void;
  onExecuteNext: () => void;
  onExecuteAll: () => void;
  onReset: () => void;
  onExportMarkdown: () => void;
  onExportJson: () => void;
}

export function IncidentRunbookExecutor({
  runbook,
  currentLiveP99Ms,
  lang,
  onExecuteStep,
  onExecuteNext,
  onExecuteAll,
  onReset,
  onExportMarkdown,
  onExportJson,
}: Props) {
  const copy = UI_COPY[lang].runbookSection;
  const nextStep = getNextPendingStep(runbook);
  const completedCount = runbook.steps.filter((s) => s.status === 'completed').length;
  const progressPct = Math.round((completedCount / runbook.steps.length) * 100);

  return (
    <section
      className="surface-panel rounded-2xl border p-4 sm:p-6"
      aria-label="Interactive SRE Incident Runbook Executor"
    >
      {/* Header + Action Toolbar */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="font-mono text-[10.5px] font-bold uppercase tracking-wider text-emerald-600 dark:text-emerald-400">
            {copy.eyebrow} · {runbook.incidentId}
          </div>
          <h2 className="mt-0.5 flex items-center gap-2 text-base font-extrabold text-heading">
            <Terminal className="h-4.5 w-4.5 shrink-0 text-emerald-500" />
            {copy.title}
          </h2>
          <p className="mt-1 text-xs text-dim">{copy.subtitle}</p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            data-testid="btn-runbook-next"
            disabled={!nextStep}
            onClick={onExecuteNext}
            className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-cyan-500 to-emerald-500 px-3.5 py-2 text-xs font-extrabold text-slate-950 shadow-md shadow-cyan-500/20 transition hover:brightness-110 disabled:opacity-45"
          >
            <Play className="h-3.5 w-3.5 fill-current" />
            {copy.btnExecuteNext}
          </button>

          <button
            type="button"
            data-testid="btn-runbook-auto"
            disabled={!nextStep}
            onClick={onExecuteAll}
            className="inline-flex items-center gap-1.5 rounded-xl border border-amber-500/45 bg-amber-500/12 px-3 py-2 text-xs font-bold text-amber-800 transition hover:bg-amber-500/22 disabled:opacity-45 dark:text-amber-200"
          >
            <Zap className="h-3.5 w-3.5" />
            {copy.btnAutoRun}
          </button>

          <button
            type="button"
            data-testid="btn-runbook-reset"
            onClick={onReset}
            className="surface-chip inline-flex items-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-semibold text-body transition hover:border-cyan-500 hover:text-heading"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            {copy.btnReset}
          </button>
        </div>
      </div>

      {/* Progress & MTTR Status Strip */}
      <div className="surface-inset mt-4 rounded-xl border p-3.5">
        <div className="flex flex-wrap items-center justify-between gap-3 font-mono text-xs">
          <div className="flex flex-wrap items-center gap-3">
            <span
              data-testid="runbook-lifecycle"
              className={`rounded-full px-2.5 py-0.5 text-[10.5px] font-bold uppercase ${
                runbook.lifecycle === 'resolved'
                  ? 'bg-emerald-500/20 text-emerald-700 dark:text-emerald-300'
                  : runbook.lifecycle === 'in_progress'
                    ? 'bg-amber-500/20 text-amber-800 dark:text-amber-200'
                    : 'surface-chip border text-dim'
              }`}
            >
              {runbook.lifecycle} ({completedCount}/{runbook.steps.length})
            </span>
            <span className="inline-flex items-center gap-1 text-dim">
              <Clock className="h-3.5 w-3.5 text-cyan-500" />
              MTTR: <strong className="text-heading">{runbook.mttrSeconds}s</strong>
            </span>
            <span className="inline-flex items-center gap-1 text-dim">
              <ShieldCheck className="h-3.5 w-3.5 text-emerald-500" />
              P99:{' '}
              <strong className="text-heading">
                {(runbook.baselineP99Ms ?? currentLiveP99Ms).toFixed(1)}ms
              </strong>
              {' → '}
              <strong
                className={
                  (runbook.currentP99Ms ?? currentLiveP99Ms) < 45
                    ? 'text-emerald-600 dark:text-emerald-300'
                    : 'text-rose-600 dark:text-rose-400'
                }
              >
                {(runbook.currentP99Ms ?? currentLiveP99Ms).toFixed(1)}ms
              </strong>
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              data-testid="btn-runbook-export-md"
              onClick={onExportMarkdown}
              className="surface-chip inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] font-bold text-body transition hover:border-cyan-500 hover:text-heading"
            >
              <FileText className="h-3.5 w-3.5 text-cyan-500" />
              {copy.btnExportMd}
            </button>
            <button
              type="button"
              data-testid="btn-runbook-export-json"
              onClick={onExportJson}
              className="surface-chip inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] font-bold text-body transition hover:border-emerald-500 hover:text-heading"
            >
              <FileJson className="h-3.5 w-3.5 text-emerald-500" />
              {copy.btnExportJson}
            </button>
          </div>
        </div>

        <div className="mt-2.5 h-2 w-full overflow-hidden rounded-full bg-slate-500/20">
          <div
            className="h-full rounded-full bg-gradient-to-r from-cyan-500 to-emerald-500 transition-all duration-300"
            style={{ width: `${progressPct}%` }}
          />
        </div>
      </div>

      {/* Main Split: 5-Step Interactive Runbook (7 cols) + Auditable Timeline (5 cols) */}
      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-12">
        <div className="space-y-2.5 lg:col-span-7">
          {runbook.steps.map((step) => {
            const isCompleted = step.status === 'completed';
            const isReady = canExecuteStep(runbook, step.id);

            return (
              <div
                key={step.id}
                data-testid={`runbook-step-${step.id}`}
                className={`rounded-xl border p-3.5 transition ${
                  isCompleted
                    ? 'border-emerald-500/45 bg-emerald-500/[0.07]'
                    : isReady
                      ? 'border-cyan-500/60 bg-cyan-500/[0.07]'
                      : 'surface-inset opacity-80'
                }`}
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="flex min-w-0 items-start gap-2.5">
                    <div
                      className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full font-mono text-[11px] font-extrabold ${
                        isCompleted
                          ? 'bg-emerald-500 text-slate-950'
                          : isReady
                            ? 'bg-cyan-500 text-slate-950'
                            : 'surface-chip border text-dim'
                      }`}
                    >
                      {isCompleted ? <CheckCircle2 className="h-3.5 w-3.5" /> : step.order}
                    </div>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-[10px] font-bold uppercase tracking-wider text-cyan-600 dark:text-cyan-400">
                          {step.phase}
                        </span>
                        <h3 className="text-xs font-bold text-heading">
                          {lang === 'vi' ? step.titleVi : step.title}
                        </h3>
                      </div>
                      <p className="mt-0.5 text-[11.5px] leading-snug text-dim">
                        {lang === 'vi' ? step.descriptionVi : step.description}
                      </p>
                    </div>
                  </div>

                  <button
                    type="button"
                    data-testid={`btn-step-${step.id}`}
                    disabled={!isReady}
                    onClick={() => onExecuteStep(step.id)}
                    className={`shrink-0 rounded-lg px-2.5 py-1.5 font-mono text-[10.5px] font-bold transition ${
                      isCompleted
                        ? 'bg-emerald-500/20 text-emerald-700 dark:text-emerald-300'
                        : isReady
                          ? 'bg-cyan-500 text-slate-950 hover:brightness-110'
                          : 'surface-chip border text-faint'
                    }`}
                  >
                    {isCompleted ? `DONE (${step.elapsedSec}s)` : isReady ? 'EXECUTE' : 'LOCKED'}
                  </button>
                </div>

                <div className="surface-code mt-2.5 overflow-x-auto rounded-lg border px-2.5 py-1.5 font-mono text-[10.5px] text-cyan-200">
                  $ {step.cliCommand}
                </div>

                {step.verificationOutput && (
                  <div className="mt-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1.5 font-mono text-[10.5px] text-emerald-800 dark:text-emerald-200">
                    {step.verificationOutput}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Auditable Execution Timeline */}
        <div className="surface-inset flex min-w-0 flex-col rounded-xl border p-4 lg:col-span-5">
          <div className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-1.5 font-mono text-[11px] font-bold uppercase tracking-wider text-heading">
              <Download className="h-3.5 w-3.5 text-cyan-500" />
              {copy.timelineTitle}
            </span>
            <span className="font-mono text-[10.5px] text-faint">
              UTF-8 BOM Ready
            </span>
          </div>

          {runbook.timeline.length === 0 ? (
            <div className="flex flex-1 flex-col items-center justify-center py-10 text-center">
              <Terminal className="h-8 w-8 text-faint opacity-50" />
              <p className="mt-2 max-w-xs text-xs text-dim">{copy.timelineEmpty}</p>
            </div>
          ) : (
            <div className="mt-3 space-y-2.5 overflow-y-auto" data-testid="runbook-timeline-list">
              {runbook.timeline.map((entry) => (
                <div
                  key={entry.id}
                  className="surface-panel rounded-xl border p-3 font-mono text-[10.5px]"
                >
                  <div className="flex flex-wrap items-center justify-between gap-1">
                    <span className="font-bold uppercase text-emerald-600 dark:text-emerald-300">
                      [{entry.stepId}] · P99 {entry.p99Ms}ms
                    </span>
                    <span className="text-[10px] text-faint">
                      {entry.timestampUtc.slice(11, 19)}Z
                    </span>
                  </div>
                  <div className="mt-1 text-[10px] text-cyan-600 dark:text-cyan-300">
                    Quorum: {entry.quorumLabel}
                  </div>
                  <p className="mt-1 font-sans text-[11.5px] leading-snug text-body">
                    {entry.summary}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

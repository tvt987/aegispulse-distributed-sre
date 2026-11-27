import { useMemo, useState } from 'react';
import {
  Activity,
  Cpu,
  Flame,
  Gauge,
  Layers,
  RotateCcw,
  Server,
  ShieldAlert,
  ShieldCheck,
} from 'lucide-react';
import {
  findFlameFrameById,
  flattenFlamegraphLayout,
  getFlameBreadcrumbs,
  MAX_STRESS_RPS,
  MIN_STRESS_RPS,
  type FlameLayer,
  type LoadStressTelemetry,
  type RuntimeProfilerMode,
} from '../engines/loadProfilerEngine';
import type { ThemeMode } from '../engine/types';
import { UI_COPY, type LangMode } from '../i18n/translations';

interface Props {
  telemetry: LoadStressTelemetry;
  targetRps: number;
  runtime: RuntimeProfilerMode;
  lang: LangMode;
  theme: ThemeMode;
  onTargetRpsChange: (rps: number) => void;
  onRuntimeChange: (runtime: RuntimeProfilerMode) => void;
}

const LAYER_COLORS: Record<FlameLayer, { fillDark: string; fillLight: string; stroke: string; badge: string }> = {
  ingress: {
    fillDark: '#0c4a6e',
    fillLight: '#0284c7',
    stroke: '#38bdf8',
    badge: 'bg-sky-500/20 text-sky-700 dark:text-sky-300',
  },
  middleware: {
    fillDark: '#312e81',
    fillLight: '#4f46e5',
    stroke: '#818cf8',
    badge: 'bg-indigo-500/20 text-indigo-700 dark:text-indigo-300',
  },
  cache: {
    fillDark: '#164e63',
    fillLight: '#0891b2',
    stroke: '#22d3ee',
    badge: 'bg-cyan-500/20 text-cyan-700 dark:text-cyan-300',
  },
  data: {
    fillDark: '#064e3b',
    fillLight: '#059669',
    stroke: '#34d399',
    badge: 'bg-emerald-500/20 text-emerald-700 dark:text-emerald-300',
  },
  wal: {
    fillDark: '#134e4a',
    fillLight: '#0d9488',
    stroke: '#2dd4bf',
    badge: 'bg-teal-500/20 text-teal-700 dark:text-teal-300',
  },
  gc: {
    fillDark: '#881337',
    fillLight: '#e11d48',
    stroke: '#fb7185',
    badge: 'bg-rose-500/20 text-rose-700 dark:text-rose-300',
  },
};

const QUICK_RPS_PRESETS = [10000, 50000, 120000, 200000, 250000];

export function LoadStressFlamegraph({
  telemetry,
  targetRps,
  runtime,
  lang,
  theme,
  onTargetRpsChange,
  onRuntimeChange,
}: Props) {
  const copy = UI_COPY[lang].loadSection;
  const isDark = theme === 'dark';

  const [zoomFrameId, setZoomFrameId] = useState<string>('root-ingress');
  const [selectedFrameId, setSelectedFrameId] = useState<string>('dapper-query');

  const layoutRects = useMemo(
    () => flattenFlamegraphLayout(telemetry.flamegraphRoot, zoomFrameId),
    [telemetry.flamegraphRoot, zoomFrameId]
  );

  const breadcrumbs = useMemo(
    () => getFlameBreadcrumbs(telemetry.flamegraphRoot, zoomFrameId),
    [telemetry.flamegraphRoot, zoomFrameId]
  );

  const inspectedFrame = useMemo(
    () =>
      findFlameFrameById(telemetry.flamegraphRoot, selectedFrameId) ?? telemetry.flamegraphRoot,
    [telemetry.flamegraphRoot, selectedFrameId]
  );

  // Latency curve SVG geometry (viewBox 640 x 190)
  const curveGeo = useMemo(() => {
    const padL = 46;
    const padR = 16;
    const padT = 16;
    const padB = 28;
    const w = 640 - padL - padR;
    const h = 190 - padT - padB;

    const maxCurveY = Math.max(
      65,
      ...telemetry.latencyCurve.map((p) => p.p99Ms),
      telemetry.p99Ms
    );

    const xOf = (rps: number) =>
      padL + ((rps - MIN_STRESS_RPS) / (MAX_STRESS_RPS - MIN_STRESS_RPS)) * w;
    const yOf = (ms: number) => padT + h - (Math.min(ms, maxCurveY) / maxCurveY) * h;

    const poly = (getter: (p: (typeof telemetry.latencyCurve)[number]) => number) =>
      telemetry.latencyCurve.map((p) => `${xOf(p.rps).toFixed(1)},${yOf(getter(p)).toFixed(1)}`).join(' ');

    return {
      padL,
      padR,
      padT,
      padB,
      w,
      h,
      maxCurveY,
      xOf,
      yOf,
      p50Line: poly((p) => p.p50Ms),
      p95Line: poly((p) => p.p95Ms),
      p99Line: poly((p) => p.p99Ms),
      sloLineY: yOf(telemetry.sloTargetP99Ms),
      cursorX: xOf(targetRps),
      cursorP99Y: yOf(telemetry.p99Ms),
      cursorP95Y: yOf(telemetry.p95Ms),
      cursorP50Y: yOf(telemetry.p50Ms),
    };
  }, [telemetry, targetRps]);

  const maxDepth = Math.max(2, ...layoutRects.map((r) => r.depth));
  const rowH = 34;
  const rowGap = 6;
  const flameSvgH = (maxDepth + 1) * (rowH + rowGap) + 18;
  const maxHotspotSelf = Math.max(0.1, ...telemetry.topHotspots.map((h) => h.selfMs));

  return (
    <section
      className="surface-panel rounded-2xl border p-4 sm:p-6"
      aria-label="Live Load-Test Stress Slider and Flamegraph Profiler"
    >
      {/* Header + Runtime Toggle */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="font-mono text-[10.5px] font-bold uppercase tracking-wider text-cyan-600 dark:text-cyan-400">
            {copy.eyebrow}
          </div>
          <h2 className="mt-0.5 flex items-center gap-2 text-base font-extrabold text-heading">
            <Gauge className="h-4.5 w-4.5 shrink-0 text-cyan-500" />
            {copy.title}
          </h2>
          <p className="mt-1 text-xs text-dim">{copy.subtitle}</p>
        </div>

        <div className="surface-inset inline-flex rounded-xl border p-1">
          {(
            [
              { id: 'dotnet10', label: '.NET 10 Kestrel + Dapper' },
              { id: 'go124', label: 'Go 1.24 Fiber + pgx' },
            ] as const
          ).map((opt) => (
            <button
              key={opt.id}
              type="button"
              data-testid={`runtime-${opt.id}`}
              onClick={() => onRuntimeChange(opt.id)}
              className={`rounded-lg px-3 py-1.5 font-mono text-[11px] font-bold transition ${
                runtime === opt.id
                  ? 'bg-cyan-500 text-slate-950 shadow-sm'
                  : 'text-dim hover:text-heading'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Stress RPS Slider Control Bar */}
      <div className="surface-inset mt-4 rounded-xl border p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold text-heading">{copy.sliderLabel}:</span>
            <span
              data-testid="stress-rps-value"
              className="rounded-lg bg-cyan-500/15 px-2.5 py-1 font-mono text-sm font-extrabold text-cyan-700 dark:text-cyan-300"
            >
              {targetRps.toLocaleString()} RPS
            </span>
            {telemetry.sloBreached ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-rose-500/18 px-2.5 py-0.5 font-mono text-[10.5px] font-bold text-rose-600 dark:text-rose-300">
                <ShieldAlert className="h-3 w-3" />
                SLO P99 &gt; 45ms BREACH
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/18 px-2.5 py-0.5 font-mono text-[10.5px] font-bold text-emerald-700 dark:text-emerald-300">
                <ShieldCheck className="h-3 w-3" />
                WITHIN 45ms SLO
              </span>
            )}
          </div>

          <div className="flex flex-wrap gap-1.5">
            {QUICK_RPS_PRESETS.map((preset) => (
              <button
                key={preset}
                type="button"
                data-testid={`rps-preset-${preset}`}
                onClick={() => onTargetRpsChange(preset)}
                className={`rounded-lg border px-2.5 py-1 font-mono text-[11px] font-bold transition ${
                  targetRps === preset
                    ? 'border-cyan-500 bg-cyan-500/20 text-cyan-700 dark:text-cyan-200'
                    : 'surface-chip text-dim hover:border-cyan-500/50 hover:text-heading'
                }`}
              >
                {preset / 1000}K
              </button>
            ))}
          </div>
        </div>

        <input
          type="range"
          data-testid="stress-rps-slider"
          min={MIN_STRESS_RPS}
          max={MAX_STRESS_RPS}
          step={5000}
          value={targetRps}
          onChange={(e) => onTargetRpsChange(Number(e.target.value))}
          aria-label="Live Load-Test Stress RPS Slider"
          className="mt-3 w-full cursor-pointer accent-cyan-500"
        />

        <div className="mt-1 flex justify-between font-mono text-[10px] text-faint">
          <span>10K RPS (Baseline)</span>
          <span>80K RPS (Peak Retail)</span>
          <span>160K RPS (Flash Sale)</span>
          <span>250K RPS (Global Surge)</span>
        </div>
      </div>

      {/* 5 Live Load-Stress Telemetry Cards */}
      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <div className="surface-inset rounded-xl border p-3.5" data-testid="stress-kpi-p99">
          <div className="text-[10.5px] font-semibold uppercase tracking-wider text-dim">
            P50 / P95 / P99
          </div>
          <div
            className={`mt-1 font-mono text-base font-extrabold ${
              telemetry.sloBreached
                ? 'text-rose-600 dark:text-rose-400'
                : 'text-emerald-600 dark:text-emerald-300'
            }`}
          >
            {telemetry.p99Ms.toFixed(1)} ms
          </div>
          <div className="mt-0.5 font-mono text-[10.5px] text-faint">
            P50 {telemetry.p50Ms}ms · P95 {telemetry.p95Ms}ms
          </div>
        </div>

        <div className="surface-inset rounded-xl border p-3.5" data-testid="stress-kpi-saturation">
          <div className="text-[10.5px] font-semibold uppercase tracking-wider text-dim">
            Saturation
          </div>
          <div
            className={`mt-1 font-mono text-base font-extrabold ${
              telemetry.throughputSaturationPct >= 90
                ? 'text-rose-600 dark:text-rose-400'
                : telemetry.throughputSaturationPct >= 75
                  ? 'text-amber-600 dark:text-amber-300'
                  : 'text-cyan-600 dark:text-cyan-300'
            }`}
          >
            {telemetry.throughputSaturationPct}%
          </div>
          <div className="mt-0.5 font-mono text-[10.5px] text-faint">
            {telemetry.droppedRps > 0
              ? `Shedding ${telemetry.droppedRps.toLocaleString()} RPS`
              : `${telemetry.effectiveThroughputRps.toLocaleString()} RPS ok`}
          </div>
        </div>

        <div className="surface-inset rounded-xl border p-3.5" data-testid="stress-kpi-hpa">
          <div className="flex items-center justify-between text-[10.5px] font-semibold uppercase tracking-wider text-dim">
            <span>K8s HPA Pods</span>
            <Server className="h-3 w-3 text-cyan-500" />
          </div>
          <div className="mt-1 font-mono text-base font-extrabold text-heading">
            {telemetry.hpaPodsCurrent} → {telemetry.hpaPodsDesired}
          </div>
          <div className="mt-0.5 font-mono text-[10.5px] text-faint">
            CPU {telemetry.cpuUtilizationPct}% · Max {telemetry.hpaPodsMax}
          </div>
        </div>

        <div className="surface-inset rounded-xl border p-3.5" data-testid="stress-kpi-budget">
          <div className="text-[10.5px] font-semibold uppercase tracking-wider text-dim">
            SLO Error Budget
          </div>
          <div
            className={`mt-1 font-mono text-base font-extrabold ${
              telemetry.sloErrorBudgetRemainingPct < 50
                ? 'text-rose-600 dark:text-rose-400'
                : telemetry.sloErrorBudgetRemainingPct < 85
                  ? 'text-amber-600 dark:text-amber-300'
                  : 'text-emerald-600 dark:text-emerald-300'
            }`}
          >
            {telemetry.sloErrorBudgetRemainingPct}%
          </div>
          <div className="mt-0.5 font-mono text-[10.5px] text-faint">
            {telemetry.monthlyBudgetMinutesLeft}m left (99.99%)
          </div>
        </div>

        <div className="surface-inset col-span-2 rounded-xl border p-3.5 sm:col-span-1" data-testid="stress-kpi-gc">
          <div className="text-[10.5px] font-semibold uppercase tracking-wider text-dim">
            GC STW Pause (P99)
          </div>
          <div
            className={`mt-1 font-mono text-base font-extrabold ${
              telemetry.gcProfile.p99GcPauseMs > 8
                ? 'text-rose-600 dark:text-rose-400'
                : telemetry.gcProfile.p99GcPauseMs > 4.5
                  ? 'text-amber-600 dark:text-amber-300'
                  : 'text-cyan-600 dark:text-cyan-300'
            }`}
          >
            {telemetry.gcProfile.p99GcPauseMs} ms
          </div>
          <div className="mt-0.5 font-mono text-[10.5px] text-faint">
            {telemetry.gcProfile.allocRateMbPerSec} MB/s · Heap {telemetry.gcProfile.heapUtilizationPct}%
          </div>
        </div>
      </div>

      {/* Middle: Latency Curve SVG + GC Profiler Summary */}
      <div className="mt-5 grid grid-cols-1 gap-4 lg:grid-cols-12">
        <div className="surface-inset min-w-0 rounded-xl border p-4 lg:col-span-8">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <span className="flex items-center gap-1.5 text-xs font-bold text-heading">
              <Activity className="h-3.5 w-3.5 text-cyan-500" />
              {copy.curveTitle}
            </span>
            <div className="flex items-center gap-3 font-mono text-[10px]">
              <span className="text-emerald-600 dark:text-emerald-400">● P50</span>
              <span className="text-cyan-600 dark:text-cyan-400">● P95</span>
              <span className="text-rose-600 dark:text-rose-400">● P99</span>
              <span className="text-amber-600 dark:text-amber-400">-- 45ms SLO</span>
            </div>
          </div>

          <svg
            viewBox="0 0 640 190"
            className="h-auto w-full select-none"
            role="img"
            aria-label="P50 P95 P99 Latency Curve across 10K to 250K RPS"
          >
            {/* Horizontal grid lines */}
            {[0, 0.25, 0.5, 0.75, 1].map((ratio) => {
              const y = curveGeo.padT + curveGeo.h * (1 - ratio);
              const val = Math.round(curveGeo.maxCurveY * ratio);
              return (
                <g key={ratio}>
                  <line
                    x1={curveGeo.padL}
                    y1={y}
                    x2={curveGeo.padL + curveGeo.w}
                    y2={y}
                    stroke={isDark ? '#1e293b' : '#e2e8f0'}
                    strokeWidth="1"
                  />
                  <text
                    x={curveGeo.padL - 6}
                    y={y + 3}
                    textAnchor="end"
                    fontSize="9.5"
                    fontFamily="JetBrains Mono, monospace"
                    fill={isDark ? '#64748b' : '#475569'}
                  >
                    {val}ms
                  </text>
                </g>
              );
            })}

            {/* 45ms SLO Ceiling Line */}
            <line
              x1={curveGeo.padL}
              y1={curveGeo.sloLineY}
              x2={curveGeo.padL + curveGeo.w}
              y2={curveGeo.sloLineY}
              stroke="#f59e0b"
              strokeWidth="1.4"
              strokeDasharray="6 4"
            />
            <text
              x={curveGeo.padL + 6}
              y={curveGeo.sloLineY - 4}
              fontSize="9"
              fontWeight="700"
              fontFamily="JetBrains Mono, monospace"
              fill="#f59e0b"
            >
              SLO P99 CEILING (45ms)
            </text>

            {/* Latency curves */}
            <polyline fill="none" stroke="#10b981" strokeWidth="2" points={curveGeo.p50Line} />
            <polyline fill="none" stroke="#06b6d4" strokeWidth="2.2" points={curveGeo.p95Line} />
            <polyline fill="none" stroke="#fb7185" strokeWidth="2.6" points={curveGeo.p99Line} />

            {/* Live RPS Crosshair */}
            <line
              x1={curveGeo.cursorX}
              y1={curveGeo.padT}
              x2={curveGeo.cursorX}
              y2={curveGeo.padT + curveGeo.h}
              stroke="#22d3ee"
              strokeWidth="1.3"
              strokeDasharray="3 3"
            />
            <circle cx={curveGeo.cursorX} cy={curveGeo.cursorP50Y} r="4" fill="#10b981" />
            <circle cx={curveGeo.cursorX} cy={curveGeo.cursorP95Y} r="4" fill="#06b6d4" />
            <circle
              cx={curveGeo.cursorX}
              cy={curveGeo.cursorP99Y}
              r="5.5"
              fill="#fb7185"
              stroke={isDark ? '#050811' : '#ffffff'}
              strokeWidth="2"
            />

            {/* X-axis RPS labels */}
            {[10000, 70000, 130000, 190000, 250000].map((tick) => (
              <text
                key={tick}
                x={curveGeo.xOf(tick)}
                y={182}
                textAnchor="middle"
                fontSize="9.5"
                fontFamily="JetBrains Mono, monospace"
                fill={isDark ? '#64748b' : '#475569'}
              >
                {tick / 1000}K
              </text>
            ))}
          </svg>
        </div>

        {/* GC Pause & Runtime Profiler Card */}
        <div className="surface-inset min-w-0 rounded-xl border p-4 lg:col-span-4">
          <div className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-1.5 text-xs font-bold text-heading">
              <Cpu className="h-3.5 w-3.5 text-rose-500" />
              {copy.gcProfilerTitle}
            </span>
            <span className="rounded bg-rose-500/15 px-2 py-0.5 font-mono text-[10px] font-bold text-rose-600 dark:text-rose-300">
              {runtime === 'dotnet10' ? 'DATAS GC' : 'GO STW'}
            </span>
          </div>
          <p className="mt-1 font-mono text-[10.5px] text-dim">{telemetry.gcProfile.runtimeName}</p>

          <div className="mt-3 space-y-2.5">
            {[
              {
                label: runtime === 'dotnet10' ? 'Gen0 / Gen1 Ephemeral' : 'Minor Mark Assist',
                val: `${telemetry.gcProfile.minorPauseMs} ms`,
                pct: Math.min(100, telemetry.gcProfile.minorPauseMs * 18),
                bar: 'bg-cyan-500',
              },
              {
                label: runtime === 'dotnet10' ? 'Gen2 Background STW' : 'Mark Termination STW',
                val: `${telemetry.gcProfile.majorStwPauseMs} ms`,
                pct: Math.min(100, telemetry.gcProfile.majorStwPauseMs * 7.5),
                bar: 'bg-amber-500',
              },
              {
                label: 'P99 Safepoint Pause',
                val: `${telemetry.gcProfile.p99GcPauseMs} ms`,
                pct: Math.min(100, telemetry.gcProfile.p99GcPauseMs * 6),
                bar: 'bg-rose-500',
              },
              {
                label: 'Managed Heap Pressure',
                val: `${telemetry.gcProfile.heapUtilizationPct}%`,
                pct: telemetry.gcProfile.heapUtilizationPct,
                bar: telemetry.gcProfile.heapUtilizationPct > 80 ? 'bg-rose-500' : 'bg-emerald-500',
              },
            ].map((row) => (
              <div key={row.label}>
                <div className="flex justify-between font-mono text-[11px]">
                  <span className="text-dim">{row.label}</span>
                  <span className="font-bold text-heading">{row.val}</span>
                </div>
                <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-slate-500/20">
                  <div
                    className={`h-full rounded-full transition-all duration-300 ${row.bar}`}
                    style={{ width: `${Math.max(4, row.pct)}%` }}
                  />
                </div>
              </div>
            ))}
          </div>

          <div className="border-hairline mt-3 flex items-center justify-between border-t pt-2.5 font-mono text-[10.5px] text-dim">
            <span>Alloc: {telemetry.gcProfile.allocRateMbPerSec} MB/s</span>
            <span>{telemetry.gcProfile.pauseFrequencyPerMin} pauses/min</span>
          </div>
        </div>
      </div>

      {/* Bottom: Interactive Click-to-Zoom SVG Flamegraph + Hotspot Breakdown */}
      <div className="mt-5 grid grid-cols-1 gap-4 lg:grid-cols-12">
        <div className="surface-inset min-w-0 rounded-xl border p-4 lg:col-span-8">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="flex items-center gap-1.5 text-xs font-bold text-heading">
              <Flame className="h-4 w-4 text-amber-500" />
              {copy.flameTitle}
            </span>
            {zoomFrameId !== 'root-ingress' && (
              <button
                type="button"
                data-testid="btn-flame-reset"
                onClick={() => {
                  setZoomFrameId('root-ingress');
                  setSelectedFrameId('root-ingress');
                }}
                className="surface-chip inline-flex items-center gap-1 rounded-lg border px-2.5 py-1 font-mono text-[10.5px] font-bold text-cyan-600 transition hover:border-cyan-500 dark:text-cyan-300"
              >
                <RotateCcw className="h-3 w-3" />
                {copy.resetZoom}
              </button>
            )}
          </div>

          {/* Clickable Zoom Breadcrumbs */}
          <div
            data-testid="flame-breadcrumbs"
            className="mt-2 flex flex-wrap items-center gap-1 font-mono text-[10.5px]"
          >
            {breadcrumbs.map((crumb, idx) => (
              <span key={crumb.id} className="inline-flex items-center gap-1">
                {idx > 0 && <span className="text-faint">/</span>}
                <button
                  type="button"
                  onClick={() => {
                    setZoomFrameId(crumb.id);
                    setSelectedFrameId(crumb.id);
                  }}
                  className={`rounded px-1.5 py-0.5 transition ${
                    idx === breadcrumbs.length - 1
                      ? 'bg-cyan-500/18 font-bold text-cyan-700 dark:text-cyan-300'
                      : 'text-dim hover:text-heading'
                  }`}
                >
                  {crumb.name} ({crumb.totalMs}ms)
                </button>
              </span>
            ))}
          </div>

          {/* Interactive SVG Flamegraph */}
          <div className="mt-3 w-full overflow-x-auto">
            <svg
              viewBox={`0 0 800 ${flameSvgH}`}
              className="h-auto w-full min-w-[520px] select-none"
              role="img"
              aria-label="Interactive Stack Frame Flamegraph"
            >
              {layoutRects.map((rect) => {
                const palette = LAYER_COLORS[rect.frame.layer];
                const x = (rect.xPct / 100) * 796 + 2;
                const w = Math.max(22, (rect.widthPct / 100) * 796 - 3);
                const y = 6 + rect.depth * (rowH + rowGap);
                const isSelected = rect.frame.id === inspectedFrame.id;
                const showFullLabel = w > 125;
                const showCompactLabel = w > 55;

                return (
                  <g
                    key={rect.frame.id}
                    data-testid={`flame-frame-${rect.frame.id}`}
                    className="cursor-pointer"
                    onClick={() => {
                      setSelectedFrameId(rect.frame.id);
                      if (rect.frame.children.length > 0 || rect.frame.id !== zoomFrameId) {
                        setZoomFrameId(rect.frame.id);
                      }
                    }}
                  >
                    <rect
                      x={x}
                      y={y}
                      width={w}
                      height={rowH}
                      rx="6"
                      fill={isDark ? palette.fillDark : palette.fillLight}
                      stroke={isSelected ? '#fbbf24' : palette.stroke}
                      strokeWidth={isSelected ? 2.2 : 1}
                      opacity={isSelected ? 1 : 0.9}
                    />
                    {showCompactLabel && (
                      <text
                        x={x + 8}
                        y={y + 14}
                        fontSize="10.5"
                        fontWeight="700"
                        fontFamily="JetBrains Mono, monospace"
                        fill="#f8fafc"
                      >
                        {showFullLabel
                          ? rect.frame.name
                          : rect.frame.name.slice(0, Math.max(5, Math.floor(w / 9)))}
                      </text>
                    )}
                    {w > 78 && (
                      <text
                        x={x + 8}
                        y={y + 27}
                        fontSize="9"
                        fontFamily="JetBrains Mono, monospace"
                        fill="#cbd5e1"
                      >
                        {rect.frame.totalMs}ms ({rect.frame.pctOfTotal}%)
                      </text>
                    )}
                  </g>
                );
              })}
            </svg>
          </div>

          {/* Selected Frame Deep Inspector */}
          <div
            data-testid="flame-inspector"
            className="surface-panel mt-3 rounded-xl border p-3.5"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className={`rounded px-2 py-0.5 font-mono text-[10px] font-bold uppercase ${LAYER_COLORS[inspectedFrame.layer].badge}`}
                >
                  {inspectedFrame.layer}
                </span>
                <span className="font-mono text-xs font-extrabold text-heading">
                  {inspectedFrame.name}
                </span>
                <span className="font-mono text-[11px] text-dim">
                  ({inspectedFrame.runtimeLabel})
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-3 font-mono text-[11px]">
                <span className="text-dim">
                  Total: <strong className="text-heading">{inspectedFrame.totalMs}ms</strong>
                </span>
                <span className="text-dim">
                  Self: <strong className="text-amber-600 dark:text-amber-300">{inspectedFrame.selfMs}ms</strong>
                </span>
                <span className="text-dim">
                  Share: <strong className="text-cyan-600 dark:text-cyan-300">{inspectedFrame.pctOfTotal}%</strong>
                </span>
                <span className="text-dim">
                  Alloc: <strong className="text-heading">{inspectedFrame.allocKb} KB</strong>
                </span>
              </div>
            </div>
            <p className="mt-1.5 text-xs leading-relaxed text-body">{inspectedFrame.tip}</p>
          </div>
        </div>

        {/* Top Hotspot Breakdown Panel */}
        <div className="surface-inset min-w-0 rounded-xl border p-4 lg:col-span-4">
          <div className="flex items-center gap-1.5 text-xs font-bold text-heading">
            <Layers className="h-3.5 w-3.5 text-amber-500" />
            {copy.hotspotsTitle}
          </div>
          <p className="mt-0.5 text-[11px] text-dim">
            Click any hotspot to focus &amp; inspect stack frame telemetry.
          </p>

          <div className="mt-3 space-y-2.5">
            {telemetry.topHotspots.map((hot) => {
              const barPct = Math.round((hot.selfMs / maxHotspotSelf) * 100);
              const isSelected = hot.id === inspectedFrame.id;
              return (
                <button
                  key={hot.id}
                  type="button"
                  onClick={() => {
                    setSelectedFrameId(hot.id);
                    setZoomFrameId(hot.id);
                  }}
                  className={`w-full rounded-xl border p-2.5 text-left transition ${
                    isSelected
                      ? 'border-cyan-500 bg-cyan-500/12'
                      : 'surface-panel hover:border-cyan-500/50'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2 font-mono text-[11px]">
                    <span className="truncate font-bold text-heading">{hot.name}</span>
                    <span className="shrink-0 font-extrabold text-amber-600 dark:text-amber-300">
                      {hot.selfMs.toFixed(2)} ms
                    </span>
                  </div>
                  <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-slate-500/20">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-cyan-500 to-amber-500"
                      style={{ width: `${Math.max(8, barPct)}%` }}
                    />
                  </div>
                  <div className="mt-1 flex justify-between font-mono text-[10px] text-faint">
                    <span>{hot.layer.toUpperCase()}</span>
                    <span>Total {hot.totalMs}ms · {hot.allocKb} KB</span>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}

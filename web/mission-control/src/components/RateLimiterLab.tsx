import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  Check,
  Code2,
  Copy,
  Flame,
  Gauge,
  Layers,
  Play,
  RotateCcw,
  ShieldAlert,
  ShieldCheck,
  SlidersHorizontal,
  Timer,
  Zap,
} from 'lucide-react';
import {
  DEFAULT_RATE_LIMIT_PARAMS,
  RATE_LIMIT_ALGORITHM_ORDER,
  RATE_LIMIT_BOUNDS,
  simulateRateLimitComparison,
  type RateLimitAlgorithmId,
  type RateLimitScenarioId,
} from '../engines/rateLimiterEngine';
import type { ThemeMode } from '../engine/types';
import type { LangMode } from '../i18n/translations';

interface RateLimiterLabProps {
  lang: LangMode;
  theme: ThemeMode;
}

type CodeTabId = 'dotnet' | 'redis-sliding' | 'redis-token';

export function RateLimiterLab({ lang, theme }: RateLimiterLabProps) {
  const [burstIntensityRps, setBurstIntensityRps] = useState<number>(
    DEFAULT_RATE_LIMIT_PARAMS.burstIntensityRps
  );
  const [bucketCapacity, setBucketCapacity] = useState<number>(
    DEFAULT_RATE_LIMIT_PARAMS.bucketCapacity
  );
  const [refillRatePerSec, setRefillRatePerSec] = useState<number>(
    DEFAULT_RATE_LIMIT_PARAMS.refillRatePerSec
  );
  const [scenario, setScenario] = useState<RateLimitScenarioId>(DEFAULT_RATE_LIMIT_PARAMS.scenario);
  const [selectedAlgorithm, setSelectedAlgorithm] = useState<RateLimitAlgorithmId>('fixed-window');
  const [inspectedSlotIdx, setInspectedSlotIdx] = useState<number>(10); // t=5.0s primary boundary spike
  const [sweepSlotCount, setSweepSlotCount] = useState<number>(RATE_LIMIT_BOUNDS.totalSlots);
  const [isSweeping, setIsSweeping] = useState<boolean>(false);
  const [spikeRunCounter, setSpikeRunCounter] = useState<number>(1);
  const [codeTab, setCodeTab] = useState<CodeTabId>('dotnet');
  const [copiedCode, setCopiedCode] = useState<boolean>(false);

  const sweepTimerRef = useRef<number | null>(null);

  const isVi = lang === 'vi';
  const isDark = theme === 'dark';

  const result = useMemo(
    () =>
      simulateRateLimitComparison({
        burstIntensityRps,
        bucketCapacity,
        refillRatePerSec,
        scenario,
        shardCount: RATE_LIMIT_BOUNDS.defaultShardCount,
      }),
    [burstIntensityRps, bucketCapacity, refillRatePerSec, scenario]
  );

  const activeAlg = result.algorithms[selectedAlgorithm];
  const fixedAlg = result.algorithms['fixed-window'];
  const tokenAlg = result.algorithms['token-bucket'];
  const slidingAlg = result.algorithms['sliding-window-log'];

  const startSweepAnimation = useCallback((focusSlot: number) => {
    if (sweepTimerRef.current !== null) {
      window.clearInterval(sweepTimerRef.current);
      sweepTimerRef.current = null;
    }
    setIsSweeping(true);
    setSweepSlotCount(6);
    let current = 6;
    sweepTimerRef.current = window.setInterval(() => {
      current = Math.min(RATE_LIMIT_BOUNDS.totalSlots, current + 5);
      setSweepSlotCount(current);
      setInspectedSlotIdx(Math.min(current - 1, focusSlot));
      if (current >= RATE_LIMIT_BOUNDS.totalSlots && sweepTimerRef.current !== null) {
        window.clearInterval(sweepTimerRef.current);
        sweepTimerRef.current = null;
        setIsSweeping(false);
        setInspectedSlotIdx(focusSlot);
      }
    }, 45);
  }, []);

  useEffect(() => {
    return () => {
      if (sweepTimerRef.current !== null) {
        window.clearInterval(sweepTimerRef.current);
      }
    };
  }, []);

  const handleFireBoundarySpike = useCallback(() => {
    setScenario('boundary-flash-spike');
    setBurstIntensityRps((prev) => (prev < 600 ? 700 : prev));
    setSelectedAlgorithm('fixed-window');
    setSpikeRunCounter((c) => c + 1);
    startSweepAnimation(10); // Focus directly on t=5.0s 2x boundary crossing
  }, [startSweepAnimation]);

  const handleSelectScenario = useCallback(
    (nextScenario: RateLimitScenarioId) => {
      setScenario(nextScenario);
      const focus =
        nextScenario === 'boundary-flash-spike' ? 10 : nextScenario === 'sustained-wave' ? 14 : 20;
      startSweepAnimation(focus);
    },
    [startSweepAnimation]
  );

  const handleReset = useCallback(() => {
    setBurstIntensityRps(DEFAULT_RATE_LIMIT_PARAMS.burstIntensityRps);
    setBucketCapacity(DEFAULT_RATE_LIMIT_PARAMS.bucketCapacity);
    setRefillRatePerSec(DEFAULT_RATE_LIMIT_PARAMS.refillRatePerSec);
    setScenario(DEFAULT_RATE_LIMIT_PARAMS.scenario);
    setSelectedAlgorithm('fixed-window');
    setSpikeRunCounter((c) => c + 1);
    startSweepAnimation(10);
  }, [startSweepAnimation]);

  const activeCode =
    codeTab === 'dotnet'
      ? result.dotnetCode
      : codeTab === 'redis-sliding'
        ? result.redisSlidingLua
        : result.redisTokenBucketLua;

  const handleCopyCode = async () => {
    try {
      await navigator.clipboard.writeText(activeCode);
    } catch {
      // Fallback visual confirmation in headless/sandbox environments
    }
    setCopiedCode(true);
    window.setTimeout(() => setCopiedCode(false), 1800);
  };

  // Current inspected slot metrics across all 3 algorithms (synced for live Token Tank Gauge)
  const clampedSlotIdx = Math.max(0, Math.min(RATE_LIMIT_BOUNDS.totalSlots - 1, inspectedSlotIdx));
  const inspectedSlot = activeAlg.slots[clampedSlotIdx];
  const inspectedTokenSlot = tokenAlg.slots[clampedSlotIdx];
  const inspectedFixedSlot = fixedAlg.slots[clampedSlotIdx];
  const inspectedSlidingSlot = slidingAlg.slots[clampedSlotIdx];

  // SVG Timeline geometry
  const svgW = 880;
  const svgH = 276;
  const padL = 46;
  const padR = 18;
  const padT = 26;
  const padB = 34;
  const plotW = svgW - padL - padR;
  const plotH = svgH - padT - padB;
  const slotStep = plotW / RATE_LIMIT_BOUNDS.totalSlots;
  const barW = Math.max(8, slotStep - 4);
  const yMax = Math.max(
    result.maxSlotIncoming,
    refillRatePerSec,
    Math.ceil((result.maxSlotIncoming * 1.15) / 50) * 50
  );
  const yScale = (val: number) => padT + plotH - (Math.min(yMax, val) / yMax) * plotH;
  const halfSecSteadyCap = refillRatePerSec * 0.5;
  const capLineY = yScale(halfSecSteadyCap);

  // Token Tank SVG fill ratio
  const tokenFillPct = Math.max(
    0,
    Math.min(100, Math.round((inspectedTokenSlot.tokensRemainingAfter / bucketCapacity) * 100))
  );
  const tankInnerHeight = 148;
  const liquidHeight = Math.round((tankInnerHeight * tokenFillPct) / 100);
  const liquidY = 34 + (tankInnerHeight - liquidHeight);

  const hasFixedOvershoot = fixedAlg.totalBoundaryOvershoot > 0;

  return (
    <section
      data-testid="rate-limiter-lab"
      className="min-w-0 space-y-6"
      aria-label="Token-Bucket vs Sliding-Window Burst Rate-Limiter Lab"
    >
      {/* Hero & Interactive Controls Panel */}
      <div className="surface-panel min-w-0 rounded-2xl border p-5 sm:p-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-cyan-500/35 bg-cyan-500/10 px-2.5 py-0.5 font-mono text-[10.5px] font-bold uppercase tracking-wider text-cyan-700 dark:text-cyan-300">
                <Gauge className="h-3 w-3 shrink-0" />
                {isVi
                  ? 'AEGISPULSE V6.0 · CONG GIOI HAN LUU LUONG 5,000 RPS'
                  : 'AEGISPULSE V6.0 · 5,000 RPS GATEWAY BACKPRESSURE LAB'}
              </span>
              <span className="surface-chip rounded-full border px-2.5 py-0.5 font-mono text-[10.5px] font-semibold text-dim">
                {result.params.shardCount} Shards x {refillRatePerSec}/s ={' '}
                {result.clusterGatewayCapRps.toLocaleString()} RPS Cap · 20s Window
              </span>
            </div>

            <h1 className="mt-2.5 text-xl font-bold tracking-tight text-heading sm:text-2xl">
              {isVi
                ? 'Phong Lab Rate-Limiter: Fixed Window vs Token Bucket vs Redis Sliding-Window'
                : 'Token-Bucket vs Sliding-Window Log Rate-Limiter & Backpressure Lab'}
            </h1>
            <p className="mt-1.5 max-w-3xl text-xs leading-relaxed text-dim sm:text-sm">
              {isVi
                ? 'Mo phong dot bung no voucher flash-sale 5,000 RPS qua ranh gioi giay co dinh de chung minh lo hong tran 2x cua Fixed Window, kha nang hap thu dot bien muot ma cua Token Bucket va co che khoa tran tuyet doi 0 overshoot cua Redis Sliding-Window Log.'
                : 'Stress-test a 5,000 RPS retail voucher flash-sale gateway across a 20-second timeline: expose Fixed-Window 2x boundary overshoot leaks, tune Token-Bucket burst absorption, and verify Redis Sliding-Window Log enforcing 0 overshoot with RFC Retry-After backpressure.'}
            </p>
          </div>

          <div className="flex shrink-0 flex-wrap items-center gap-2.5">
            <button
              type="button"
              data-testid="btn-fire-boundary-spike"
              disabled={isSweeping}
              onClick={handleFireBoundarySpike}
              className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-rose-500 via-amber-500 to-cyan-500 px-4 py-2.5 text-xs font-extrabold text-slate-950 shadow-lg shadow-cyan-500/20 transition hover:brightness-110 disabled:opacity-60"
            >
              <Flame className="h-3.5 w-3.5 shrink-0" />
              {isSweeping
                ? isVi
                  ? 'Dang Ban Dot Bung No 2x...'
                  : 'Firing 2x Boundary Spike...'
                : isVi
                  ? 'Ban Dot Flash-Sale 2x Ranh Gioi'
                  : 'Fire 2x Boundary Flash-Sale Spike'}
            </button>

            <button
              type="button"
              data-testid="btn-rl-reset"
              onClick={handleReset}
              className="surface-chip inline-flex items-center gap-1.5 rounded-xl border px-3.5 py-2.5 text-xs font-semibold text-body transition hover:border-cyan-500 hover:text-heading"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              <span>{isVi ? 'Mac Dinh' : 'Reset'}</span>
            </button>
          </div>
        </div>

        {/* Scenario Switcher + 3 Live Sliders */}
        <div className="mt-5 grid grid-cols-1 gap-5 border-t border-hairline pt-5 lg:grid-cols-12">
          {/* Scenario Selector */}
          <div className="lg:col-span-4">
            <div className="flex items-center gap-1.5 font-mono text-[10.5px] font-bold uppercase tracking-wider text-dim">
              <Activity className="h-3.5 w-3.5 text-cyan-500" />
              {isVi ? 'Kich Ban Luu Luong 20 Giay' : '20-Second Traffic Profile'}
            </div>
            <div className="mt-2.5 flex flex-wrap gap-1.5">
              {(
                [
                  {
                    id: 'boundary-flash-spike',
                    label: isVi ? 'Dot 2x Ranh Gioi' : '2x Boundary Spike',
                  },
                  {
                    id: 'sustained-wave',
                    label: isVi ? 'Song Flash-Sale Dai' : 'Sustained Wave',
                  },
                  {
                    id: 'organic-pos',
                    label: isVi ? 'POS Binh Thuong' : 'Organic POS',
                  },
                ] as const
              ).map((item) => (
                <button
                  key={item.id}
                  type="button"
                  data-testid={`rl-scenario-${item.id}`}
                  onClick={() => handleSelectScenario(item.id)}
                  className={`rounded-lg border px-2.5 py-1.5 font-mono text-[11px] font-semibold transition ${
                    scenario === item.id
                      ? 'border-cyan-500/60 bg-cyan-500/14 text-cyan-700 dark:text-cyan-300'
                      : 'surface-chip text-dim hover:text-heading'
                  }`}
                >
                  {item.label}
                </button>
              ))}
            </div>
            <p className="mt-2 font-mono text-[10.5px] text-faint">
              Run #{spikeRunCounter} · Cluster peak:{' '}
              <strong className="text-heading">
                {(burstIntensityRps * result.params.shardCount).toLocaleString()} RPS
              </strong>{' '}
              vs{' '}
              <strong className="text-emerald-600 dark:text-emerald-300">
                {result.clusterGatewayCapRps.toLocaleString()} RPS
              </strong>{' '}
              cap
            </p>
          </div>

          {/* 3 Interactive Range Sliders */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3 lg:col-span-8">
            <div className="surface-inset rounded-xl border p-3.5">
              <div className="flex items-center justify-between gap-2 text-xs">
                <span className="flex items-center gap-1.5 font-medium text-dim">
                  <SlidersHorizontal className="h-3.5 w-3.5 text-rose-500" />
                  Burst Intensity
                </span>
                <span
                  data-testid="rl-val-burst"
                  className="font-mono text-sm font-bold text-rose-600 dark:text-rose-400"
                >
                  {burstIntensityRps} req/s
                </span>
              </div>
              <input
                type="range"
                data-testid="slider-burst-intensity"
                min={RATE_LIMIT_BOUNDS.minBurstIntensityRps}
                max={RATE_LIMIT_BOUNDS.maxBurstIntensityRps}
                step={25}
                value={burstIntensityRps}
                onChange={(e) => setBurstIntensityRps(Number(e.target.value))}
                aria-label="Burst Intensity (req/s)"
                className="mt-2.5 w-full accent-rose-500"
              />
              <div className="mt-1 flex justify-between font-mono text-[10px] text-faint">
                <span>100/s</span>
                <span>Shard Spike</span>
                <span>1,000/s</span>
              </div>
            </div>

            <div className="surface-inset rounded-xl border p-3.5">
              <div className="flex items-center justify-between gap-2 text-xs">
                <span className="flex items-center gap-1.5 font-medium text-dim">
                  <Layers className="h-3.5 w-3.5 text-cyan-500" />
                  Bucket Capacity
                </span>
                <span
                  data-testid="rl-val-capacity"
                  className="font-mono text-sm font-bold text-cyan-600 dark:text-cyan-300"
                >
                  {bucketCapacity} tokens
                </span>
              </div>
              <input
                type="range"
                data-testid="slider-bucket-capacity"
                min={RATE_LIMIT_BOUNDS.minBucketCapacity}
                max={RATE_LIMIT_BOUNDS.maxBucketCapacity}
                step={10}
                value={bucketCapacity}
                onChange={(e) => setBucketCapacity(Number(e.target.value))}
                aria-label="Bucket Capacity (tokens)"
                className="mt-2.5 w-full accent-cyan-500"
              />
              <div className="mt-1 flex justify-between font-mono text-[10px] text-faint">
                <span>50</span>
                <span>Burst Tank</span>
                <span>400</span>
              </div>
            </div>

            <div className="surface-inset rounded-xl border p-3.5">
              <div className="flex items-center justify-between gap-2 text-xs">
                <span className="flex items-center gap-1.5 font-medium text-dim">
                  <Zap className="h-3.5 w-3.5 text-emerald-500" />
                  Refill Rate
                </span>
                <span
                  data-testid="rl-val-refill"
                  className="font-mono text-sm font-bold text-emerald-600 dark:text-emerald-300"
                >
                  {refillRatePerSec} /s
                </span>
              </div>
              <input
                type="range"
                data-testid="slider-refill-rate"
                min={RATE_LIMIT_BOUNDS.minRefillRatePerSec}
                max={RATE_LIMIT_BOUNDS.maxRefillRatePerSec}
                step={10}
                value={refillRatePerSec}
                onChange={(e) => setRefillRatePerSec(Number(e.target.value))}
                aria-label="Refill Rate (tokens/s)"
                className="mt-2.5 w-full accent-emerald-500"
              />
              <div className="mt-1 flex justify-between font-mono text-[10px] text-faint">
                <span>50/s</span>
                <span>Sustained Cap</span>
                <span>300/s</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Executive Proof Verdict Strip */}
      <div
        data-testid="rl-verdict-banner"
        className={`flex flex-col gap-4 rounded-2xl border p-5 sm:flex-row sm:items-center sm:justify-between ${
          hasFixedOvershoot
            ? 'border-rose-500/40 bg-gradient-to-r from-rose-500/12 via-amber-500/[0.04] to-emerald-500/[0.06] dark:from-rose-950/50 dark:via-[#111320] dark:to-emerald-950/30'
            : 'border-emerald-500/40 bg-gradient-to-r from-emerald-500/10 via-cyan-500/[0.04] to-transparent dark:from-emerald-950/40 dark:via-[#0d1322] dark:to-[#0d1322]'
        }`}
      >
        <div className="flex min-w-0 items-start gap-3.5">
          {hasFixedOvershoot ? (
            <ShieldAlert className="mt-0.5 h-7 w-7 shrink-0 text-rose-500 dark:text-rose-400" />
          ) : (
            <ShieldCheck className="mt-0.5 h-7 w-7 shrink-0 text-emerald-600 dark:text-emerald-400" />
          )}
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={`rounded-md px-2 py-0.5 font-mono text-[10.5px] font-bold uppercase tracking-wider ${
                  hasFixedOvershoot
                    ? 'bg-rose-500/18 text-rose-700 dark:text-rose-300'
                    : 'bg-emerald-500/18 text-emerald-700 dark:text-emerald-300'
                }`}
              >
                {hasFixedOvershoot
                  ? `FIXED WINDOW 2X BOUNDARY BREACH · SLIDING WINDOW 0 OVERSHOOT`
                  : 'ALL ALGORITHMS WITHIN GATEWAY CAP'}
              </span>
            </div>
            <p className="mt-1.5 text-xs leading-relaxed text-body sm:text-sm">
              {isVi ? result.executiveSummaryVi : result.executiveSummary}
            </p>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-3 font-mono">
          <div className="surface-inset rounded-xl border px-3.5 py-2.5 text-right">
            <div className="text-[10px] uppercase tracking-wider text-dim">Fixed Overshoot</div>
            <div
              data-testid="rl-fixed-overshoot"
              className={`mt-0.5 text-xl font-bold tabular-nums ${
                hasFixedOvershoot
                  ? 'text-rose-600 dark:text-rose-400'
                  : 'text-emerald-600 dark:text-emerald-300'
              }`}
            >
              +{fixedAlg.totalBoundaryOvershoot.toLocaleString()}
            </div>
          </div>
          <div className="surface-inset rounded-xl border px-3.5 py-2.5 text-right">
            <div className="text-[10px] uppercase tracking-wider text-dim">Sliding Overshoot</div>
            <div
              data-testid="rl-sliding-overshoot"
              className="mt-0.5 text-xl font-bold tabular-nums text-emerald-600 dark:text-emerald-300"
            >
              {slidingAlg.totalBoundaryOvershoot}
            </div>
          </div>
        </div>
      </div>

      {/* 3-Algorithm Comparative Selector Cards */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {RATE_LIMIT_ALGORITHM_ORDER.map((algId) => {
          const alg = result.algorithms[algId];
          const isSelected = selectedAlgorithm === algId;
          const activeClass =
            alg.tone === 'rose'
              ? 'border-rose-500/75 bg-rose-500/[0.08] ring-1 ring-rose-500/30'
              : alg.tone === 'cyan'
                ? 'border-cyan-500/75 bg-cyan-500/[0.08] ring-1 ring-cyan-500/30'
                : 'border-emerald-500/75 bg-emerald-500/[0.08] ring-1 ring-emerald-500/30';
          const badgeClass =
            alg.tone === 'rose'
              ? 'bg-rose-500/18 text-rose-700 dark:text-rose-300'
              : alg.tone === 'cyan'
                ? 'bg-cyan-500/18 text-cyan-700 dark:text-cyan-300'
                : 'bg-emerald-500/18 text-emerald-700 dark:text-emerald-300';

          return (
            <button
              key={algId}
              type="button"
              data-testid={`rl-alg-${algId}`}
              onClick={() => setSelectedAlgorithm(algId)}
              className={`surface-panel min-w-0 rounded-2xl border p-5 text-left transition ${
                isSelected ? activeClass : 'hover:border-cyan-500/45'
              }`}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="flex items-center gap-2 text-sm font-bold text-heading">
                  {alg.tone === 'rose' ? (
                    <AlertTriangle className="h-4 w-4 shrink-0 text-rose-500" />
                  ) : alg.tone === 'cyan' ? (
                    <Gauge className="h-4 w-4 shrink-0 text-cyan-500" />
                  ) : (
                    <ShieldCheck className="h-4 w-4 shrink-0 text-emerald-500" />
                  )}
                  {alg.title}
                </span>
                <span
                  className={`rounded-md px-2 py-0.5 font-mono text-[10px] font-bold uppercase ${badgeClass}`}
                >
                  {alg.badge}
                </span>
              </div>

              <p className="mt-2 text-xs leading-relaxed text-dim">
                {isVi ? alg.descriptionVi : alg.description}
              </p>

              <div className="mt-4 grid grid-cols-3 gap-2 font-mono">
                <div className="surface-inset rounded-xl border px-2.5 py-2">
                  <div className="text-[10px] text-faint">200 OK</div>
                  <div className="mt-0.5 text-sm font-bold text-emerald-600 dark:text-emerald-300">
                    {alg.totalAllowed200.toLocaleString()}
                  </div>
                </div>
                <div className="surface-inset rounded-xl border px-2.5 py-2">
                  <div className="text-[10px] text-faint">429 Shed</div>
                  <div className="mt-0.5 text-sm font-bold text-amber-600 dark:text-amber-300">
                    {alg.totalThrottled429.toLocaleString()}
                  </div>
                </div>
                <div className="surface-inset rounded-xl border px-2.5 py-2">
                  <div className="text-[10px] text-faint">Overshoot</div>
                  <div
                    className={`mt-0.5 text-sm font-bold ${
                      alg.totalBoundaryOvershoot > 0
                        ? 'text-rose-600 dark:text-rose-400'
                        : 'text-emerald-600 dark:text-emerald-300'
                    }`}
                  >
                    {alg.totalBoundaryOvershoot > 0 ? `+${alg.totalBoundaryOvershoot}` : '0'}
                  </div>
                </div>
              </div>

              <div className="mt-3 flex items-center justify-between border-t border-hairline pt-2.5 font-mono text-[11px] text-dim">
                <span>
                  Peak 1s:{' '}
                  <strong
                    className={
                      alg.peakRolling1sAllowed > refillRatePerSec && alg.id === 'fixed-window'
                        ? 'text-rose-600 dark:text-rose-400'
                        : 'text-heading'
                    }
                  >
                    {alg.peakRolling1sAllowed}/s ({alg.peakMultiplierVsLimit.toFixed(2)}x)
                  </strong>
                </span>
                <span>
                  {alg.id === 'token-bucket'
                    ? `Burst: +${alg.burstAbsorbedCount}`
                    : alg.maxRetryAfterMs > 0
                      ? `Retry: ${alg.maxRetryAfterMs}ms`
                      : 'Retry: 0ms'}
                </span>
              </div>
            </button>
          );
        })}
      </div>

      {/* Main Split: Interactive SVG Timeline Chart + Live Token Tank Gauge & Slot Inspector */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* Left: Interactive SVG Timeline Chart */}
        <div className="surface-panel min-w-0 rounded-2xl border p-5 sm:p-6 lg:col-span-8">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="flex items-center gap-2 text-sm font-bold text-heading sm:text-base">
                <Play className="h-4 w-4 text-cyan-500" />
                {activeAlg.title} — 20s Gateway Admission Timeline (500ms Resolution)
              </h2>
              <p className="mt-0.5 text-xs text-dim">
                {isVi
                  ? 'Di chuot hoac nhap vao tung cot 0.5s de kiem tra chi tiet HTTP 200, HTTP 429, luong vuot ranh gioi va muc binh Token.'
                  : 'Hover or click any 500ms bar to inspect rolling 1-second traffic, Token Tank depth, and HTTP 429 Retry-After headers.'}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-3 font-mono text-[11px]">
              <span className="inline-flex items-center gap-1.5 text-emerald-600 dark:text-emerald-300">
                <span className="h-2.5 w-2.5 rounded-sm bg-emerald-500" />
                HTTP 200 Allowed
              </span>
              <span className="inline-flex items-center gap-1.5 text-amber-600 dark:text-amber-300">
                <span className="h-2.5 w-2.5 rounded-sm bg-amber-500" />
                HTTP 429 Throttled
              </span>
              <span className="inline-flex items-center gap-1.5 text-rose-600 dark:text-rose-400">
                <span className="h-2.5 w-2.5 rounded-sm bg-rose-500" />
                Boundary Overshoot Leak
              </span>
            </div>
          </div>

          <div className="mt-4 overflow-x-auto rounded-xl border border-hairline bg-slate-50/80 p-3 dark:bg-[#060a14]">
            <svg
              data-testid="rl-timeline-svg"
              viewBox={`0 0 ${svgW} ${svgH}`}
              className="h-auto w-full min-w-[600px]"
              role="img"
              aria-label={`${activeAlg.title} 20-second rate limiter timeline chart`}
            >
              {/* Horizontal Y gridlines */}
              {[0, 0.25, 0.5, 0.75, 1].map((ratio) => {
                const val = Math.round(yMax * ratio);
                const y = yScale(val);
                return (
                  <g key={ratio}>
                    <line
                      x1={padL}
                      y1={y}
                      x2={svgW - padR}
                      y2={y}
                      stroke={isDark ? 'rgba(148,163,184,0.12)' : 'rgba(15,23,42,0.08)'}
                      strokeWidth="1"
                    />
                    <text
                      x={padL - 8}
                      y={y + 3.5}
                      textAnchor="end"
                      fill={isDark ? '#64748b' : '#475569'}
                      fontSize="10"
                      fontFamily="JetBrains Mono, monospace"
                    >
                      {val}
                    </text>
                  </g>
                );
              })}

              {/* Vertical boundary spike markers at t=5.0s (slot 10) and t=13.0s (slot 26) */}
              {scenario === 'boundary-flash-spike' &&
                [
                  { idx: 10, label: '5.0s Boundary' },
                  { idx: 26, label: '13.0s Boundary' },
                ].map((marker) => {
                  const x = padL + marker.idx * slotStep;
                  return (
                    <g key={marker.idx}>
                      <line
                        x1={x}
                        y1={padT - 8}
                        x2={x}
                        y2={svgH - padB}
                        stroke={isDark ? 'rgba(244,63,94,0.55)' : 'rgba(225,29,72,0.45)'}
                        strokeDasharray="4 4"
                        strokeWidth="1.25"
                      />
                      <text
                        x={x + 4}
                        y={padT - 10}
                        fill={isDark ? '#fb7185' : '#e11d48'}
                        fontSize="9.5"
                        fontWeight="700"
                        fontFamily="JetBrains Mono, monospace"
                      >
                        {marker.label}
                      </text>
                    </g>
                  );
                })}

              {/* Steady half-second rate cap reference line */}
              <line
                x1={padL}
                y1={capLineY}
                x2={svgW - padR}
                y2={capLineY}
                stroke={isDark ? '#22d3ee' : '#0284c7'}
                strokeDasharray="6 4"
                strokeWidth="1.5"
              />
              <text
                x={svgW - padR - 4}
                y={capLineY - 5}
                textAnchor="end"
                fill={isDark ? '#67e8f9' : '#0369a1'}
                fontSize="9.5"
                fontWeight="700"
                fontFamily="JetBrains Mono, monospace"
              >
                Steady 500ms Quota ({halfSecSteadyCap} req / {refillRatePerSec} req/s cap)
              </text>

              {/* Stacked vertical bars for all 40 half-second slots */}
              {activeAlg.slots.map((slot, idx) => {
                if (idx >= sweepSlotCount) return null;

                const x = padL + idx * slotStep + (slotStep - barW) / 2;
                const baseBottom = padT + plotH;

                const hWithin = (slot.allowedWithinCap / yMax) * plotH;
                const hOvershoot = (slot.boundaryOvershoot / yMax) * plotH;
                const hThrottled = (slot.throttled429 / yMax) * plotH;

                const yWithin = baseBottom - hWithin;
                const yOvershoot = yWithin - hOvershoot;
                const yThrottled = yOvershoot - hThrottled;

                const isSelectedSlot = idx === clampedSlotIdx;

                return (
                  <g
                    key={slot.slotIndex}
                    onMouseEnter={() => setInspectedSlotIdx(idx)}
                    onClick={() => setInspectedSlotIdx(idx)}
                    style={{ cursor: 'pointer' }}
                  >
                    {/* Active slot highlight backdrop */}
                    {isSelectedSlot && (
                      <rect
                        x={padL + idx * slotStep}
                        y={padT}
                        width={slotStep}
                        height={plotH}
                        fill={isDark ? 'rgba(34,211,238,0.10)' : 'rgba(2,132,199,0.09)'}
                        rx="3"
                      />
                    )}

                    {/* Transparent hit area */}
                    <rect
                      x={padL + idx * slotStep}
                      y={padT}
                      width={slotStep}
                      height={plotH}
                      fill="transparent"
                    />

                    {/* HTTP 200 Allowed (within cap) — Emerald */}
                    {hWithin > 0.5 && (
                      <rect
                        x={x}
                        y={yWithin}
                        width={barW}
                        height={Math.max(1.5, hWithin)}
                        rx="2"
                        fill={isDark ? '#10b981' : '#059669'}
                        opacity={isSelectedSlot ? 1 : 0.88}
                      />
                    )}

                    {/* Boundary Overshoot Leak — Crimson */}
                    {hOvershoot > 0.5 && (
                      <rect
                        x={x}
                        y={yOvershoot}
                        width={barW}
                        height={Math.max(2, hOvershoot)}
                        rx="2"
                        fill={isDark ? '#f43f5e' : '#e11d48'}
                        stroke={isDark ? '#fda4af' : '#be123c'}
                        strokeWidth="1"
                      />
                    )}

                    {/* HTTP 429 Throttled — Amber */}
                    {hThrottled > 0.5 && (
                      <rect
                        x={x}
                        y={yThrottled}
                        width={barW}
                        height={Math.max(1.5, hThrottled)}
                        rx="2"
                        fill={isDark ? '#f59e0b' : '#d97706'}
                        opacity={isSelectedSlot ? 0.98 : 0.78}
                      />
                    )}

                    {/* X-axis tick labels every 2 seconds (4 slots) */}
                    {idx % 4 === 0 && (
                      <text
                        x={x + barW / 2}
                        y={svgH - 12}
                        textAnchor="middle"
                        fill={isDark ? '#94a3b8' : '#475569'}
                        fontSize="10"
                        fontFamily="JetBrains Mono, monospace"
                      >
                        {slot.startSec.toFixed(0)}s
                      </text>
                    )}
                  </g>
                );
              })}

              {/* Final 20s tick */}
              <text
                x={svgW - padR}
                y={svgH - 12}
                textAnchor="end"
                fill={isDark ? '#94a3b8' : '#475569'}
                fontSize="10"
                fontFamily="JetBrains Mono, monospace"
              >
                20s
              </text>
            </svg>
          </div>

          {/* Synchronized Slot Scrubber & Live Slot Inspector */}
          <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-4">
            <div className="surface-inset rounded-xl border p-3 font-mono">
              <div className="text-[10px] uppercase tracking-wider text-dim">
                Slot [{inspectedSlot.startSec.toFixed(1)}s–{inspectedSlot.endSec.toFixed(1)}s]
              </div>
              <div className="mt-1 text-base font-bold text-heading">
                {inspectedSlot.incoming} reqs in
              </div>
              <div className="mt-0.5 text-[10.5px] text-faint">
                Rolling 1s: {inspectedSlot.rolling1sAllowed} req/s
              </div>
            </div>

            <div className="surface-inset rounded-xl border p-3 font-mono">
              <div className="text-[10px] uppercase tracking-wider text-dim">Fixed Window</div>
              <div
                className={`mt-1 text-base font-bold ${
                  inspectedFixedSlot.boundaryOvershoot > 0
                    ? 'text-rose-600 dark:text-rose-400'
                    : 'text-emerald-600 dark:text-emerald-300'
                }`}
              >
                {inspectedFixedSlot.boundaryOvershoot > 0
                  ? `+${inspectedFixedSlot.boundaryOvershoot} LEAK`
                  : `${inspectedFixedSlot.allowed200} OK`}
              </div>
              <div className="mt-0.5 text-[10.5px] text-faint">
                1s sum: {inspectedFixedSlot.rolling1sAllowed} / {refillRatePerSec}
              </div>
            </div>

            <div className="surface-inset rounded-xl border p-3 font-mono">
              <div className="text-[10px] uppercase tracking-wider text-dim">Token Bucket</div>
              <div className="mt-1 text-base font-bold text-cyan-600 dark:text-cyan-300">
                {inspectedTokenSlot.allowed200} OK / {inspectedTokenSlot.throttled429} 429
              </div>
              <div className="mt-0.5 text-[10.5px] text-faint">
                Tank left: {inspectedTokenSlot.tokensRemainingAfter} / {bucketCapacity}
              </div>
            </div>

            <div className="surface-inset rounded-xl border p-3 font-mono">
              <div className="text-[10px] uppercase tracking-wider text-dim">Sliding Window</div>
              <div className="mt-1 text-base font-bold text-emerald-600 dark:text-emerald-300">
                {inspectedSlidingSlot.allowed200} OK · 0 Leak
              </div>
              <div className="mt-0.5 text-[10.5px] text-faint">
                {inspectedSlidingSlot.throttled429 > 0
                  ? `429 Retry-After: ${inspectedSlidingSlot.retryAfterMs}ms`
                  : 'Headroom intact'}
              </div>
            </div>
          </div>
        </div>

        {/* Right: Live Token Tank Gauge + HTTP 429 Retry-After Header Wire Preview */}
        <div className="min-w-0 space-y-5 lg:col-span-4">
          <div className="surface-panel min-w-0 rounded-2xl border p-5 sm:p-6">
            <div className="flex items-center justify-between gap-2">
              <h2 className="flex items-center gap-2 text-sm font-bold text-heading">
                <Gauge className="h-4 w-4 text-cyan-500" />
                Live Token Tank Gauge
              </h2>
              <span className="rounded-md bg-cyan-500/12 px-2 py-0.5 font-mono text-[10.5px] font-bold text-cyan-700 dark:text-cyan-300">
                t = {inspectedSlot.startSec.toFixed(1)}s
              </span>
            </div>

            <div className="mt-4 flex items-center gap-5">
              {/* Vertical SVG Liquid Tank */}
              <svg
                data-testid="rl-token-tank-svg"
                viewBox="0 0 132 204"
                className="h-48 w-32 shrink-0"
                role="img"
                aria-label={`Token bucket tank at ${tokenFillPct}% full (${inspectedTokenSlot.tokensRemainingAfter} of ${bucketCapacity} tokens)`}
              >
                <defs>
                  <linearGradient id="aegisTokenLiquid" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={tokenFillPct < 20 ? '#fb7185' : '#22d3ee'} />
                    <stop offset="100%" stopColor={tokenFillPct < 20 ? '#e11d48' : '#10b981'} />
                  </linearGradient>
                </defs>

                {/* Refill intake pipe */}
                <rect
                  x="56"
                  y="4"
                  width="20"
                  height="18"
                  rx="4"
                  fill={isDark ? '#1e293b' : '#cbd5e1'}
                />
                <circle cx="66" cy="26" r="3" fill="#22d3ee" />

                {/* Tank outer glass shell */}
                <rect
                  x="16"
                  y="32"
                  width="100"
                  height="152"
                  rx="14"
                  fill={isDark ? '#060a14' : '#f1f5f9'}
                  stroke={isDark ? 'rgba(148,163,184,0.28)' : 'rgba(15,23,42,0.18)'}
                  strokeWidth="2"
                />

                {/* Liquid token fill */}
                {liquidHeight > 0 && (
                  <rect
                    x="18"
                    y={liquidY}
                    width="96"
                    height={liquidHeight}
                    rx="11"
                    fill="url(#aegisTokenLiquid)"
                    opacity="0.88"
                  />
                )}

                {/* Calibration ticks */}
                {[0.25, 0.5, 0.75].map((pct) => {
                  const ty = 34 + tankInnerHeight * (1 - pct);
                  return (
                    <line
                      key={pct}
                      x1="20"
                      y1={ty}
                      x2="34"
                      y2={ty}
                      stroke={isDark ? 'rgba(248,250,252,0.35)' : 'rgba(15,23,42,0.28)'}
                      strokeWidth="1.2"
                    />
                  );
                })}

                {/* Centered Percentage Readout */}
                <text
                  x="66"
                  y="112"
                  textAnchor="middle"
                  fill={isDark ? '#f8fafc' : '#0f172a'}
                  fontSize="22"
                  fontWeight="800"
                  fontFamily="JetBrains Mono, monospace"
                >
                  {tokenFillPct}%
                </text>
                <text
                  x="66"
                  y="130"
                  textAnchor="middle"
                  fill={isDark ? '#cbd5e1' : '#334155'}
                  fontSize="10"
                  fontWeight="600"
                  fontFamily="JetBrains Mono, monospace"
                >
                  {inspectedTokenSlot.tokensRemainingAfter}/{bucketCapacity}
                </text>

                {/* Base label */}
                <text
                  x="66"
                  y="199"
                  textAnchor="middle"
                  fill={isDark ? '#64748b' : '#475569'}
                  fontSize="9.5"
                  fontFamily="JetBrains Mono, monospace"
                >
                  +{refillRatePerSec} tok/s refill
                </text>
              </svg>

              <div className="min-w-0 flex-1 space-y-2.5 font-mono text-xs">
                <div className="surface-inset rounded-xl border p-2.5">
                  <div className="text-[10px] uppercase text-faint">Refill Drip</div>
                  <div className="mt-0.5 text-sm font-bold text-emerald-600 dark:text-emerald-300">
                    +{refillRatePerSec} tokens/s
                  </div>
                </div>
                <div className="surface-inset rounded-xl border p-2.5">
                  <div className="text-[10px] uppercase text-faint">Burst Absorbed</div>
                  <div className="mt-0.5 text-sm font-bold text-cyan-600 dark:text-cyan-300">
                    +{tokenAlg.burstAbsorbedCount.toLocaleString()} reqs
                  </div>
                </div>
                <div className="surface-inset rounded-xl border p-2.5">
                  <div className="text-[10px] uppercase text-faint">Lowest Tank</div>
                  <div className="mt-0.5 text-sm font-bold text-heading">
                    {tokenAlg.minTokensObserved} / {bucketCapacity}
                  </div>
                </div>
              </div>
            </div>

            {/* Interactive Time Scrubber */}
            <div className="mt-4 border-t border-hairline pt-3.5">
              <div className="flex items-center justify-between font-mono text-[10.5px] text-dim">
                <span>Inspect Timeline Slot</span>
                <span className="font-bold text-cyan-600 dark:text-cyan-300">
                  t = {inspectedSlot.startSec.toFixed(1)}s ({inspectedSlot.slotIndex + 1}/40)
                </span>
              </div>
              <input
                type="range"
                data-testid="slider-slot-scrubber"
                min={0}
                max={RATE_LIMIT_BOUNDS.totalSlots - 1}
                step={1}
                value={clampedSlotIdx}
                onChange={(e) => setInspectedSlotIdx(Number(e.target.value))}
                aria-label="Inspect Timeline Slot"
                className="mt-2 w-full accent-cyan-500"
              />
            </div>
          </div>

          {/* Live RFC HTTP 429 + Retry-After Wire Preview */}
          <div className="surface-panel min-w-0 rounded-2xl border p-5">
            <div className="flex items-center justify-between gap-2">
              <h3 className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-heading">
                <Timer className="h-3.5 w-3.5 text-amber-500" />
                Backpressure Wire Response
              </h3>
              <span
                className={`rounded px-2 py-0.5 font-mono text-[10px] font-bold ${
                  inspectedSlidingSlot.throttled429 > 0
                    ? 'bg-amber-500/20 text-amber-700 dark:text-amber-300'
                    : 'bg-emerald-500/20 text-emerald-700 dark:text-emerald-300'
                }`}
              >
                {inspectedSlidingSlot.throttled429 > 0 ? 'HTTP 429' : 'HTTP 200'}
              </span>
            </div>
            <pre className="surface-code mt-3 overflow-x-auto rounded-xl border p-3.5 font-mono text-[11px] leading-relaxed text-cyan-200">
              {inspectedSlidingSlot.throttled429 > 0
                ? `HTTP/1.1 429 Too Many Requests
Retry-After: ${Math.max(1, Math.ceil(inspectedSlidingSlot.retryAfterMs / 1000))}
X-RateLimit-Limit: ${refillRatePerSec}
X-RateLimit-Remaining: 0
X-RateLimit-Policy: sliding-window-log;w=1
X-Retry-After-Ms: ${inspectedSlidingSlot.retryAfterMs}
Content-Type: application/problem+json`
                : `HTTP/1.1 200 OK
X-RateLimit-Limit: ${refillRatePerSec}
X-RateLimit-Remaining: ${inspectedSlidingSlot.tokensRemainingAfter}
X-RateLimit-Policy: sliding-window-log;w=1
X-Boundary-Overshoot: 0`}
            </pre>
          </div>
        </div>
      </div>

      {/* Copyable .NET 10 AddRateLimiter & Redis Lua Production Code Vault */}
      <div className="surface-panel min-w-0 rounded-2xl border p-5 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-2 text-sm font-bold text-heading sm:text-base">
              <Code2 className="h-4 w-4 text-cyan-500" />
              {isVi
                ? 'Ma Nguon Production (.NET 10 AddRateLimiter & Redis Lua EVALSHA)'
                : 'Copyable Production Implementation (.NET 10 AddRateLimiter & Redis Lua)'}
            </h2>
            <p className="mt-0.5 text-xs text-dim">
              {isVi
                ? 'Tu dong cap nhat TokenLimit va PermitLimit theo thong so thanh truot hien tai.'
                : 'Live-parameterized from your active Bucket Capacity and Refill Rate settings.'}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {(
              [
                { id: 'dotnet', label: '.NET 10 AddRateLimiter' },
                { id: 'redis-sliding', label: 'Redis Sliding-Window Lua' },
                { id: 'redis-token', label: 'Redis Token-Bucket Lua' },
              ] as const
            ).map((t) => (
              <button
                key={t.id}
                type="button"
                data-testid={`rl-code-tab-${t.id}`}
                onClick={() => setCodeTab(t.id)}
                className={`rounded-lg border px-3 py-1.5 font-mono text-[11px] font-semibold transition ${
                  codeTab === t.id
                    ? 'border-cyan-500/60 bg-cyan-500/14 text-cyan-700 dark:text-cyan-300'
                    : 'surface-chip text-dim hover:text-heading'
                }`}
              >
                {t.label}
              </button>
            ))}

            <button
              type="button"
              data-testid="btn-copy-rl-code"
              onClick={() => void handleCopyCode()}
              className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-500/45 bg-emerald-500/12 px-3 py-1.5 font-mono text-[11px] font-bold text-emerald-700 transition hover:bg-emerald-500/20 dark:text-emerald-300"
            >
              {copiedCode ? (
                <>
                  <Check className="h-3.5 w-3.5" />
                  Copied
                </>
              ) : (
                <>
                  <Copy className="h-3.5 w-3.5" />
                  Copy Code
                </>
              )}
            </button>
          </div>
        </div>

        <pre className="surface-code mt-4 max-w-full overflow-x-auto rounded-xl border p-4 font-mono text-xs leading-relaxed text-slate-200">
          {activeCode}
        </pre>
      </div>
    </section>
  );
}

export default RateLimiterLab;

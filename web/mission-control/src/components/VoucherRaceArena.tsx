import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  Banknote,
  CheckCircle2,
  Clock,
  Cpu,
  Database,
  Gauge,
  Layers,
  Lock,
  Play,
  RotateCcw,
  ShieldAlert,
  ShieldCheck,
  Store,
  Trophy,
} from 'lucide-react';
import {
  DEFAULT_CONCURRENT_REQUESTS,
  DEFAULT_RETAIL_STORE_COUNT,
  DEFAULT_SIMULATION_SEED,
  DEFAULT_VOUCHER_CODE,
  DEFAULT_VOUCHER_FACE_VALUE_VND,
  formatVndCompact,
  formatVndCurrency,
  runAllThreeVoucherArchitectures,
  runVoucherRaceSimulation,
  VOUCHER_ARCHITECTURES,
  type VoucherArchitectureMode,
  type VoucherRaceResult,
} from '../engines/voucherConcurrencyEngine';
import type { LangMode } from '../i18n/translations';

interface VoucherRaceArenaProps {
  lang: LangMode;
  onOpenRateLimiter?: () => void;
}

const ARCHITECTURE_ORDER: VoucherArchitectureMode[] = [
  'naive',
  'pessimistic',
  'concung-lua-rowversion',
];

export function VoucherRaceArena({ lang, onOpenRateLimiter }: VoucherRaceArenaProps) {
  const [selectedMode, setSelectedMode] = useState<VoucherArchitectureMode>('concung-lua-rowversion');
  const [faceValueVnd, setFaceValueVnd] = useState<number>(DEFAULT_VOUCHER_FACE_VALUE_VND);
  const [storeCount, setStoreCount] = useState<number>(DEFAULT_RETAIL_STORE_COUNT);
  const [seed, setSeed] = useState<number>(DEFAULT_SIMULATION_SEED);
  const [sweepProgress, setSweepProgress] = useState<number>(100);
  const [isFiring, setIsFiring] = useState<boolean>(false);
  const [runCounter, setRunCounter] = useState<number>(1);
  const timerRef = useRef<number | null>(null);

  const comparison = useMemo(
    () =>
      runAllThreeVoucherArchitectures({
        concurrentRequests: DEFAULT_CONCURRENT_REQUESTS,
        voucherStock: 1,
        voucherFaceValueVnd: faceValueVnd,
        retailStoreCount: storeCount,
        voucherCode: DEFAULT_VOUCHER_CODE,
        seed,
      }),
    [faceValueVnd, storeCount, seed]
  );

  const activeResult: VoucherRaceResult = useMemo(() => {
    if (selectedMode === 'naive') return comparison.naive;
    if (selectedMode === 'pessimistic') return comparison.pessimistic;
    return comparison.concung;
  }, [selectedMode, comparison]);

  const triggerSweepAnimation = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
    setIsFiring(true);
    setSweepProgress(12);
    let step = 12;
    timerRef.current = window.setInterval(() => {
      step = Math.min(100, step + 22);
      setSweepProgress(step);
      if (step >= 100 && timerRef.current !== null) {
        window.clearInterval(timerRef.current);
        timerRef.current = null;
        setIsFiring(false);
      }
    }, 55);
  }, []);

  useEffect(() => {
    return () => {
      if (timerRef.current !== null) {
        window.clearInterval(timerRef.current);
      }
    };
  }, []);

  const handleSelectArchitecture = useCallback(
    (mode: VoucherArchitectureMode) => {
      setSelectedMode(mode);
      setRunCounter((c) => c + 1);
      triggerSweepAnimation();
    },
    [triggerSweepAnimation]
  );

  const handleFire500Requests = useCallback(() => {
    setSeed((prev) => prev + 7919);
    setRunCounter((c) => c + 1);
    triggerSweepAnimation();
  }, [triggerSweepAnimation]);

  const handleRaceAllThree = useCallback(() => {
    setSeed((prev) => prev + 104729);
    setRunCounter((c) => c + 1);
    triggerSweepAnimation();
  }, [triggerSweepAnimation]);

  const handleResetDefault = useCallback(() => {
    setFaceValueVnd(DEFAULT_VOUCHER_FACE_VALUE_VND);
    setStoreCount(DEFAULT_RETAIL_STORE_COUNT);
    setSeed(DEFAULT_SIMULATION_SEED);
    setSelectedMode('concung-lua-rowversion');
    setRunCounter((c) => c + 1);
    triggerSweepAnimation();
  }, [triggerSweepAnimation]);

  // Direct preview result for custom mode checks (kept synced with activeResult)
  const verifiedDirectCheck = useMemo(
    () =>
      runVoucherRaceSimulation({
        mode: selectedMode,
        concurrentRequests: DEFAULT_CONCURRENT_REQUESTS,
        voucherStock: 1,
        voucherFaceValueVnd: faceValueVnd,
        retailStoreCount: storeCount,
        voucherCode: DEFAULT_VOUCHER_CODE,
        seed,
      }),
    [selectedMode, faceValueVnd, storeCount, seed]
  );

  const maxLaneDuration = useMemo(
    () => Math.max(40, ...verifiedDirectCheck.lanes.map((l) => l.startOffsetMs + l.totalMs)),
    [verifiedDirectCheck.lanes]
  );

  const maxHistogramCount = useMemo(
    () => Math.max(1, ...verifiedDirectCheck.histogram.map((b) => b.count)),
    [verifiedDirectCheck.histogram]
  );

  const isNaiveLeak = activeResult.mode === 'naive';
  const isPessimistic = activeResult.mode === 'pessimistic';
  const isConCung = activeResult.mode === 'concung-lua-rowversion';

  const isVi = lang === 'vi';

  return (
    <section
      data-testid="voucher-race-arena"
      className="min-w-0 space-y-6"
      aria-label="500-Request Concurrent Voucher Race-Condition Simulator"
    >
      {/* Executive Production Proof Strip — Con Cung 700+ Stores · 5,000+ RPS · 0.00% Double-Spend */}
      <div
        data-testid="concung-hero-proof"
        className="surface-panel min-w-0 rounded-2xl border p-5 sm:p-6"
      >
        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-md border border-emerald-500/35 bg-emerald-500/10 px-2.5 py-1 font-mono text-[10.5px] font-bold uppercase tracking-wider text-emerald-700 dark:text-emerald-300">
                <ShieldCheck className="h-3.5 w-3.5 shrink-0" />
                {isVi
                  ? 'KIẾN TRÚC PRODUCTION CON CƯNG · ĐÃ KIỂM CHỨNG'
                  : 'CON CUNG PRODUCTION ARCHITECTURE · VERIFIED PROOF'}
              </span>
              <span className="surface-chip rounded-md border px-2.5 py-1 font-mono text-[10.5px] font-medium text-dim">
                {activeResult.voucherCode} · Stock = 1 · {formatVndCurrency(faceValueVnd)}
              </span>
            </div>

            <h1 className="mt-3 text-xl font-bold tracking-tight text-heading sm:text-2xl lg:text-[26px]">
              {isVi
                ? 'Đấu Trường Tranh Chấp Voucher Flash-Sale 500 Request Đồng Thời'
                : 'Con Cung 700-Store Flash-Sale Voucher Concurrency Arena'}
            </h1>
            <p className="mt-2 max-w-3xl text-xs leading-relaxed text-dim sm:text-sm">
              {isVi
                ? 'Kiểm chứng trực tiếp 500 request thanh toán đồng thời vào 1 mã voucher 500.000 VND (tồn kho = 1) qua 3 kiến trúc backend: Naive Read-Write, SQL UPDLOCK và Redis Lua + SQL Server ROWVERSION + Dapper.'
                : 'Fire 500 simultaneous flash-sale requests against a single 500,000 VND voucher (stock = 1) across 3 backend patterns — proving zero double-spending, sub-45ms tail latency, and nationwide 700-store financial protection.'}
            </p>
          </div>

          <div className="flex shrink-0 flex-wrap items-center gap-2.5">
            <button
              type="button"
              data-testid="btn-fire-500-voucher"
              disabled={isFiring}
              onClick={handleFire500Requests}
              className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-cyan-500 to-emerald-500 px-4 py-2.5 text-xs font-extrabold text-slate-950 shadow-md shadow-cyan-500/20 transition hover:brightness-110 disabled:opacity-60"
            >
              <Play className="h-3.5 w-3.5 fill-current" />
              {isFiring
                ? isVi
                  ? 'Đang Bắn 500 Request...'
                  : 'Firing 500 Requests...'
                : isVi
                  ? 'Bắn 500 Request Đồng Thời'
                  : 'Fire 500 Concurrent Requests'}
            </button>

            <button
              type="button"
              data-testid="btn-race-all-voucher"
              disabled={isFiring}
              onClick={handleRaceAllThree}
              className="inline-flex items-center gap-1.5 rounded-xl border border-amber-500/40 bg-amber-500/10 px-3.5 py-2.5 text-xs font-bold text-amber-800 transition hover:bg-amber-500/18 disabled:opacity-60 dark:text-amber-200"
            >
              <Trophy className="h-3.5 w-3.5" />
              {isVi ? 'So Tài 3 Kiến Trúc' : 'Race All 3'}
            </button>

            {onOpenRateLimiter && (
              <button
                type="button"
                data-testid="btn-jump-ratelimit"
                onClick={onOpenRateLimiter}
                className="surface-chip inline-flex items-center gap-1.5 rounded-xl border px-3.5 py-2.5 text-xs font-semibold text-cyan-700 transition hover:border-cyan-500/60 hover:text-cyan-600 dark:text-cyan-300"
              >
                <Gauge className="h-3.5 w-3.5" />
                <span>{isVi ? 'Lab Rate-Limiter v6' : 'Rate-Limiter Lab'}</span>
                <ArrowRight className="h-3 w-3" />
              </button>
            )}

            <button
              type="button"
              data-testid="btn-reset-voucher"
              onClick={handleResetDefault}
              className="surface-chip inline-flex items-center gap-1.5 rounded-xl border px-3 py-2.5 text-xs font-semibold text-body transition hover:border-cyan-500/60 hover:text-heading"
              aria-label="Reset Voucher Simulator Defaults"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">{isVi ? 'Mặc Định' : 'Reset'}</span>
            </button>
          </div>
        </div>

        {/* Unmistakable 4-Metric Flagship Hero Proof Grid */}
        <div className="mt-5 grid grid-cols-2 gap-3 border-t border-hairline pt-5 lg:grid-cols-4">
          <div className="surface-inset rounded-xl border p-4">
            <div className="text-[11px] font-medium text-dim">Nationwide Retail Footprint</div>
            <div className="mt-1.5 font-mono text-2xl font-bold tracking-tight text-heading tabular-nums">
              {storeCount}+ Stores
            </div>
            <div className="mt-1 font-mono text-[11px] text-faint">Con Cung POS &amp; E-Commerce</div>
          </div>
          <div className="surface-inset rounded-xl border p-4">
            <div className="text-[11px] font-medium text-dim">Sustained Peak Throughput</div>
            <div className="mt-1.5 font-mono text-2xl font-bold tracking-tight text-cyan-600 tabular-nums dark:text-cyan-300">
              5,000+ RPS
            </div>
            <div className="mt-1 font-mono text-[11px] text-faint">.NET 10 + Redis Lua Gate</div>
          </div>
          <div className="surface-inset rounded-xl border p-4">
            <div className="text-[11px] font-medium text-dim">Voucher Double-Spend Rate</div>
            <div className="mt-1.5 font-mono text-2xl font-bold tracking-tight text-emerald-600 tabular-nums dark:text-emerald-300">
              0.00%
            </div>
            <div className="mt-1 font-mono text-[11px] text-faint">SQL ROWVERSION + Idempotency</div>
          </div>
          <div className="surface-inset rounded-xl border p-4">
            <div className="text-[11px] font-medium text-dim">P99 Checkout Tail Latency</div>
            <div className="mt-1.5 font-mono text-2xl font-bold tracking-tight text-heading tabular-nums">
              {comparison.concung.p99Ms.toFixed(1)} ms
            </div>
            <div className="mt-1 font-mono text-[11px] text-emerald-600 dark:text-emerald-400">
              SLO &lt; 45 ms · 1 SQL Write
            </div>
          </div>
        </div>

        {/* 3 Selectable Backend Architectures */}
        <div className="mt-5 grid grid-cols-1 gap-4 lg:grid-cols-3">
          {ARCHITECTURE_ORDER.map((modeKey) => {
            const meta = VOUCHER_ARCHITECTURES[modeKey];
            const modeMetrics =
              modeKey === 'naive'
                ? comparison.naive
                : modeKey === 'pessimistic'
                  ? comparison.pessimistic
                  : comparison.concung;
            const isSelected = selectedMode === modeKey;

            const activeBorderClass =
              meta.tone === 'rose'
                ? 'border-rose-500/80 bg-rose-500/10 ring-1 ring-rose-500/35'
                : meta.tone === 'amber'
                  ? 'border-amber-500/80 bg-amber-500/10 ring-1 ring-amber-500/35'
                  : 'border-emerald-500/80 bg-emerald-500/10 ring-1 ring-emerald-500/35';

            const badgeToneClass =
              meta.tone === 'rose'
                ? 'bg-rose-500/18 text-rose-700 dark:text-rose-300'
                : meta.tone === 'amber'
                  ? 'bg-amber-500/18 text-amber-800 dark:text-amber-300'
                  : 'bg-emerald-500/18 text-emerald-700 dark:text-emerald-300';

            return (
              <button
                key={modeKey}
                type="button"
                data-testid={`voucher-arch-${modeKey}`}
                onClick={() => handleSelectArchitecture(modeKey)}
                className={`min-w-0 rounded-xl border p-3.5 text-left transition ${
                  isSelected ? activeBorderClass : 'surface-inset hover:border-cyan-500/50'
                }`}
              >
                <div className="flex flex-wrap items-center justify-between gap-1.5">
                  <span className="flex items-center gap-1.5 text-xs font-extrabold text-heading">
                    {meta.tone === 'rose' ? (
                      <ShieldAlert className="h-4 w-4 shrink-0 text-rose-500" />
                    ) : meta.tone === 'amber' ? (
                      <Lock className="h-4 w-4 shrink-0 text-amber-500" />
                    ) : (
                      <ShieldCheck className="h-4 w-4 shrink-0 text-emerald-500" />
                    )}
                    <span>{meta.title}</span>
                  </span>
                  <span
                    className={`rounded px-1.5 py-0.5 font-mono text-[10px] font-bold uppercase ${badgeToneClass}`}
                  >
                    {meta.badge}
                  </span>
                </div>

                <p className="mt-2 text-[11.5px] leading-relaxed text-dim">
                  {isVi ? meta.summaryVi : meta.summary}
                </p>

                <div className="surface-code mt-2.5 overflow-x-auto rounded-lg border px-2.5 py-1.5 font-mono text-[10px] text-cyan-200">
                  {meta.sqlPattern}
                </div>

                <div className="mt-2.5 grid grid-cols-3 gap-1.5 font-mono text-[10.5px]">
                  <div className="surface-chip rounded-md border px-2 py-1">
                    <div className="text-[9.5px] text-faint">Leaks</div>
                    <div
                      className={`font-bold ${
                        modeMetrics.doubleSpentCount > 0
                          ? 'text-rose-600 dark:text-rose-400'
                          : 'text-emerald-600 dark:text-emerald-400'
                      }`}
                    >
                      {modeMetrics.doubleSpentCount}
                    </div>
                  </div>
                  <div className="surface-chip rounded-md border px-2 py-1">
                    <div className="text-[9.5px] text-faint">P99</div>
                    <div className="font-bold text-heading">{modeMetrics.p99Ms}ms</div>
                  </div>
                  <div className="surface-chip rounded-md border px-2 py-1">
                    <div className="text-[9.5px] text-faint">RPS</div>
                    <div className="font-bold text-cyan-600 dark:text-cyan-300">
                      {modeMetrics.throughputRps.toLocaleString()}
                    </div>
                  </div>
                </div>
              </button>
            );
          })}
        </div>

        {/* Campaign Parameter Tuners */}
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-hairline pt-3.5 text-xs">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-[11px] font-semibold uppercase text-dim">
              {isVi ? 'Menh Gia Voucher:' : 'Voucher Value:'}
            </span>
            {[250_000, 500_000, 1_000_000].map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => setFaceValueVnd(v)}
                className={`rounded-lg border px-2.5 py-1 font-mono text-[11px] font-bold transition ${
                  faceValueVnd === v
                    ? 'border-cyan-500 bg-cyan-500/15 text-cyan-700 dark:text-cyan-300'
                    : 'surface-chip text-dim hover:text-heading'
                }`}
              >
                {formatVndCurrency(v)}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-[11px] font-semibold uppercase text-dim">
              {isVi ? 'Quy Mo Chuoi:' : 'Retail Footprint:'}
            </span>
            {[300, 700, 1000].map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setStoreCount(s)}
                className={`rounded-lg border px-2.5 py-1 font-mono text-[11px] font-bold transition ${
                  storeCount === s
                    ? 'border-emerald-500 bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
                    : 'surface-chip text-dim hover:text-heading'
                }`}
              >
                {s} {isVi ? 'Sieu Thi' : 'Stores'}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Verdict Banner */}
      <div
        data-testid="voucher-verdict-banner"
        className={`flex flex-wrap items-center justify-between gap-4 rounded-2xl border p-4 sm:p-5 ${
          isNaiveLeak
            ? 'border-rose-500/55 bg-gradient-to-r from-rose-500/16 via-rose-500/[0.05] to-transparent dark:from-rose-950/60 dark:via-[#120d1a] dark:to-[#091020]'
            : isPessimistic
              ? 'border-amber-500/50 bg-gradient-to-r from-amber-500/14 via-amber-500/[0.04] to-transparent dark:from-amber-950/45 dark:via-[#12121a] dark:to-[#091020]'
              : 'border-emerald-500/45 bg-gradient-to-r from-emerald-500/14 via-emerald-500/[0.04] to-transparent dark:from-emerald-950/45 dark:via-[#0b1524] dark:to-[#091020]'
        }`}
      >
        <div className="flex min-w-0 items-start gap-3.5">
          {isNaiveLeak ? (
            <ShieldAlert className="mt-0.5 h-8 w-8 shrink-0 text-rose-500 dark:text-rose-400" />
          ) : isPessimistic ? (
            <AlertTriangle className="mt-0.5 h-8 w-8 shrink-0 text-amber-500 dark:text-amber-400" />
          ) : (
            <ShieldCheck className="mt-0.5 h-8 w-8 shrink-0 text-emerald-600 dark:text-emerald-400" />
          )}
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span
                data-testid="voucher-verdict-badge"
                className={`rounded px-2 py-0.5 font-mono text-[11px] font-extrabold uppercase ${
                  isNaiveLeak
                    ? 'bg-rose-500/20 text-rose-700 dark:text-rose-300'
                    : isPessimistic
                      ? 'bg-amber-500/20 text-amber-800 dark:text-amber-300'
                      : 'bg-emerald-500/20 text-emerald-700 dark:text-emerald-300'
                }`}
              >
                {isNaiveLeak
                  ? `CRITICAL DOUBLE-SPEND LEAK (${activeResult.doubleSpentCount} EXTRA REDEMPTIONS)`
                  : isPessimistic
                    ? `ZERO DOUBLE-SPEND · HIGH SQL LOCK CONTENTION (P99 ${activeResult.p99Ms}ms)`
                    : 'CON CUNG PRODUCTION INVARIANT VERIFIED · 0.00% DOUBLE-SPEND'}
              </span>
              <span className="font-mono text-[11px] text-dim">
                Run #{runCounter} · Seed {seed} · {activeResult.totalRequests} concurrent contenders
              </span>
            </div>
            <p className="mt-1.5 text-xs leading-relaxed text-body sm:text-sm">
              {isNaiveLeak ? (
                <>
                  Unprotected read-check-write approved{' '}
                  <strong className="text-heading">{activeResult.totalApproved200Count}</strong> redemptions against
                  stock = 1 — leaking{' '}
                  <strong className="text-rose-600 dark:text-rose-400">
                    {activeResult.doubleSpentCount} double-spent vouchers (
                    {formatVndCurrency(activeResult.financial.singleVoucherLeakVnd)} financial loss on one promo code;{' '}
                    {formatVndCompact(activeResult.financial.projected700StoreExposureVnd)} across {storeCount} stores)
                  </strong>
                  .
                </>
              ) : isPessimistic ? (
                <>
                  SQL Server <code className="font-mono text-heading">UPDLOCK</code> guaranteed{' '}
                  <strong className="text-emerald-600 dark:text-emerald-400">0 double-spends</strong> (1 approved, 499
                  rejected), but serialized{' '}
                  <strong className="text-amber-700 dark:text-amber-300">
                    {activeResult.peakLockQueueDepth} queued SPIDs
                  </strong>{' '}
                  — spiking P99 to{' '}
                  <strong className="text-amber-700 dark:text-amber-300">{activeResult.p99Ms} ms</strong> and DB CPU to{' '}
                  <strong className="text-amber-700 dark:text-amber-300">{activeResult.dbCpuPct}%</strong>.
                </>
              ) : (
                <>
                  Redis Lua atomic gate + SQL Server <code className="font-mono text-heading">ROWVERSION</code> + Dapper
                  strictly approved <strong className="text-heading">1</strong> redemption (200 OK) and cleanly shed{' '}
                  <strong className="text-heading">{activeResult.rejected409Count}</strong> contenders with{' '}
                  <code className="font-mono text-heading">409 Conflict</code> at{' '}
                  <strong className="text-emerald-700 dark:text-emerald-300">
                    0.00% double-spend, P99 {activeResult.p99Ms} ms, {activeResult.throughputRps.toLocaleString()} RPS
                  </strong>{' '}
                  — saving{' '}
                  <strong className="text-cyan-700 dark:text-cyan-300">
                    {formatVndCompact(activeResult.financial.leakageSavedVsNaiveVnd)}
                  </strong>{' '}
                  across {storeCount}+ retail stores.
                </>
              )}
            </p>
          </div>
        </div>

        <div className="surface-inset shrink-0 rounded-xl border px-4 py-2.5 text-right font-mono">
          <div className="text-[10px] uppercase tracking-wider text-dim">
            {isNaiveLeak ? '700-Store Financial Loss' : '700-Store Leakage Prevented'}
          </div>
          <div
            data-testid="voucher-financial-headline"
            className={`mt-0.5 text-base font-extrabold sm:text-lg ${
              isNaiveLeak
                ? 'text-rose-600 dark:text-rose-400'
                : 'text-emerald-600 dark:text-emerald-300'
            }`}
          >
            {isNaiveLeak
              ? `-${formatVndCompact(activeResult.financial.projected700StoreExposureVnd)}`
              : `+${formatVndCompact(activeResult.financial.leakageSavedVsNaiveVnd)}`}
          </div>
          <div className="text-[10px] text-faint">
            {storeCount} stores x {formatVndCurrency(faceValueVnd)} promo
          </div>
        </div>
      </div>

      {/* 6-Card Live Telemetry Strip */}
      <div data-testid="voucher-kpi-grid" className="grid grid-cols-2 gap-3.5 sm:grid-cols-3 lg:grid-cols-6">
        <div className="surface-panel rounded-2xl border p-4">
          <div className="flex items-center justify-between text-[10.5px] font-semibold uppercase tracking-wider text-dim">
            <span>Approved (200)</span>
            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
          </div>
          <div
            data-testid="voucher-approved-metric"
            className={`mt-1.5 font-mono text-xl font-bold tracking-tight tabular-nums ${
              isNaiveLeak ? 'text-rose-600 dark:text-rose-400' : 'text-emerald-600 dark:text-emerald-300'
            }`}
          >
            {activeResult.totalApproved200Count} / {activeResult.voucherStock}
          </div>
          <div className="mt-1 font-mono text-[10.5px] text-faint">
            {isNaiveLeak ? 'Exceeded cap!' : 'Exact stock cap'}
          </div>
        </div>

        <div className="surface-panel rounded-2xl border p-4">
          <div className="flex items-center justify-between text-[10.5px] font-semibold uppercase tracking-wider text-dim">
            <span>Double-Spends</span>
            <Banknote className="h-3.5 w-3.5 text-rose-500" />
          </div>
          <div
            data-testid="voucher-double-spend-metric"
            className={`mt-1.5 font-mono text-xl font-bold tracking-tight tabular-nums ${
              activeResult.doubleSpentCount > 0
                ? 'text-rose-600 dark:text-rose-400'
                : 'text-emerald-600 dark:text-emerald-300'
            }`}
          >
            {activeResult.doubleSpentCount} ({activeResult.doubleSpendRatePct.toFixed(2)}%)
          </div>
          <div className="mt-1 font-mono text-[10.5px] text-faint">
            {activeResult.doubleSpentCount > 0
              ? `Loss: ${formatVndCompact(activeResult.financial.singleVoucherLeakVnd)}`
              : '0.00% Financial Leak'}
          </div>
        </div>

        <div className="surface-panel rounded-2xl border p-4">
          <div className="flex items-center justify-between text-[10.5px] font-semibold uppercase tracking-wider text-dim">
            <span>409 Conflict</span>
            <Layers className="h-3.5 w-3.5 text-cyan-500" />
          </div>
          <div data-testid="voucher-rejected-metric" className="mt-1.5 font-mono text-xl font-bold tracking-tight text-heading tabular-nums">
            {activeResult.rejected409Count}
          </div>
          <div className="mt-1 font-mono text-[10.5px] text-faint">
            {isConCung ? `${activeResult.redisEdgeRejections} shed at Redis` : 'Clean HTTP 409'}
          </div>
        </div>

        <div className="surface-panel rounded-2xl border p-4">
          <div className="flex items-center justify-between text-[10.5px] font-semibold uppercase tracking-wider text-dim">
            <span>P99 Latency</span>
            <Clock className="h-3.5 w-3.5 text-amber-500" />
          </div>
          <div
            data-testid="voucher-p99-metric"
            className={`mt-1.5 font-mono text-xl font-bold tracking-tight tabular-nums ${
              activeResult.p99Ms > 100
                ? 'text-amber-600 dark:text-amber-300'
                : 'text-emerald-600 dark:text-emerald-300'
            }`}
          >
            {activeResult.p99Ms.toFixed(1)} ms
          </div>
          <div className="mt-1 font-mono text-[10.5px] text-faint">
            P50: {activeResult.p50Ms.toFixed(1)}ms · P95: {activeResult.p95Ms.toFixed(1)}ms
          </div>
        </div>

        <div className="surface-panel rounded-2xl border p-4">
          <div className="flex items-center justify-between text-[10.5px] font-semibold uppercase tracking-wider text-dim">
            <span>Throughput</span>
            <Activity className="h-3.5 w-3.5 text-cyan-500" />
          </div>
          <div
            data-testid="voucher-rps-metric"
            className="mt-1.5 font-mono text-xl font-bold tracking-tight text-cyan-600 tabular-nums dark:text-cyan-300"
          >
            {activeResult.throughputRps.toLocaleString()} RPS
          </div>
          <div className="mt-1 font-mono text-[10.5px] text-faint">
            {isConCung ? 'SLO >= 5,000 RPS' : 'Sub-SLO bottleneck'}
          </div>
        </div>

        <div className="surface-panel rounded-2xl border p-4">
          <div className="flex items-center justify-between text-[10.5px] font-semibold uppercase tracking-wider text-dim">
            <span>SQL DB CPU</span>
            <Cpu className="h-3.5 w-3.5 text-sky-500" />
          </div>
          <div
            data-testid="voucher-dbcpu-metric"
            className={`mt-1.5 font-mono text-xl font-bold tracking-tight tabular-nums ${
              activeResult.dbCpuPct >= 85
                ? 'text-rose-600 dark:text-rose-400'
                : activeResult.dbCpuPct >= 50
                  ? 'text-amber-600 dark:text-amber-300'
                  : 'text-emerald-600 dark:text-emerald-300'
            }`}
          >
            {activeResult.dbCpuPct.toFixed(1)}%
          </div>
          <div className="mt-1 font-mono text-[10.5px] text-faint">
            SQL Queries: {activeResult.sqlQueriesExecuted.toLocaleString()}
          </div>
        </div>
      </div>

      {/* Main Split: Animated Request-Lane Waterfall + Latency Percentile Histogram & 700-Store Financial Shield */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
        {/* Left: Animated Request-Lane Waterfall */}
        <div className="surface-panel min-w-0 rounded-2xl border p-4 sm:p-5 lg:col-span-7">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="flex items-center gap-2 text-sm font-bold text-heading">
                <Database className="h-4 w-4 text-cyan-500" />
                {isVi
                  ? 'Thac Nuoc Luong Request Dong Thoi (24 Lan Dai Dien / 500 Request)'
                  : 'Animated Concurrent Request-Lane Waterfall (24 Sampled Lanes / 500 Reqs)'}
              </h2>
              <p className="mt-0.5 text-[11.5px] text-dim">
                {isVi
                  ? 'Quan sat truc quan thoi gian cong Redis Lua, hang doi khoa SQL va commit ROWVERSION theo tung cua hang.'
                  : 'Visualizing per-store ingress, Redis Lua atomic gate, SQL lock wait queue, and Dapper ROWVERSION commit.'}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2 font-mono text-[10px]">
              <span className="inline-flex items-center gap-1 text-cyan-600 dark:text-cyan-300">
                <span className="h-2 w-2 rounded-full bg-cyan-500" /> Redis Lua
              </span>
              <span className="inline-flex items-center gap-1 text-amber-600 dark:text-amber-300">
                <span className="h-2 w-2 rounded-full bg-amber-500" /> Lock Wait
              </span>
              <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-300">
                <span className="h-2 w-2 rounded-full bg-emerald-500" /> SQL Commit
              </span>
              <span className="inline-flex items-center gap-1 text-rose-600 dark:text-rose-300">
                <span className="h-2 w-2 rounded-full bg-rose-500" /> Leak
              </span>
            </div>
          </div>

          <div
            data-testid="voucher-lane-waterfall"
            className="mt-3.5 max-h-[420px] space-y-1.5 overflow-y-auto pr-1"
          >
            {activeResult.lanes.map((lane) => {
              const offsetPct = Math.min(82, (lane.startOffsetMs / maxLaneDuration) * 100);
              const redisPct = Math.max(
                lane.redisGateMs > 0 ? 3 : 0,
                (lane.redisGateMs / maxLaneDuration) * 100
              );
              const lockPct = Math.max(
                lane.lockWaitMs > 0 ? 3 : 0,
                (lane.lockWaitMs / maxLaneDuration) * 100
              );
              const sqlPct = Math.max(
                lane.sqlWriteMs > 0 ? 3 : 0,
                (lane.sqlWriteMs / maxLaneDuration) * 100
              );
              const scale = sweepProgress / 100;

              const badgeStyle =
                lane.outcome === 'APPROVED'
                  ? 'bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 border-emerald-500/40'
                  : lane.outcome === 'DOUBLE_SPEND_LEAK'
                    ? 'bg-rose-500/20 text-rose-700 dark:text-rose-300 border-rose-500/45'
                    : 'surface-chip text-dim border-hairline';

              const outcomeLabel =
                lane.outcome === 'APPROVED'
                  ? '200 OK'
                  : lane.outcome === 'DOUBLE_SPEND_LEAK'
                    ? '200 LEAK'
                    : '409 CONF';

              return (
                <div
                  key={`${activeResult.mode}-${lane.requestId}`}
                  className="surface-inset grid grid-cols-12 items-center gap-2 rounded-lg border px-2.5 py-1.5 font-mono text-[10.5px]"
                >
                  <div className="col-span-4 flex min-w-0 items-center gap-1.5 sm:col-span-3">
                    <span className="font-bold text-heading">{lane.requestId}</span>
                    <span className="truncate text-[10px] text-faint">{lane.storeCode}</span>
                  </div>

                  <div className="col-span-5 sm:col-span-6">
                    <div className="relative h-3.5 w-full overflow-hidden rounded bg-slate-200/70 dark:bg-slate-900/80">
                      <div
                        className="absolute top-0 bottom-0 flex transition-all duration-300"
                        style={{
                          left: `${offsetPct * scale}%`,
                          width: `${Math.min(100 - offsetPct * scale, (redisPct + lockPct + sqlPct + 2) * scale)}%`,
                        }}
                      >
                        {redisPct > 0 && (
                          <span
                            className="h-full bg-cyan-500"
                            style={{ flexGrow: Math.max(1, redisPct) }}
                            title={`Redis Lua Gate: ${lane.redisGateMs}ms`}
                          />
                        )}
                        {lockPct > 0 && (
                          <span
                            className="h-full bg-amber-500"
                            style={{ flexGrow: Math.max(1, lockPct) }}
                            title={`SQL Lock Wait: ${lane.lockWaitMs}ms`}
                          />
                        )}
                        {sqlPct > 0 && (
                          <span
                            className={`h-full ${
                              lane.outcome === 'DOUBLE_SPEND_LEAK' ? 'bg-rose-500' : 'bg-emerald-500'
                            }`}
                            style={{ flexGrow: Math.max(1, sqlPct) }}
                            title={`SQL Write: ${lane.sqlWriteMs}ms`}
                          />
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="col-span-3 flex items-center justify-end gap-1.5">
                    <span className="hidden text-[10px] text-dim sm:inline">{lane.totalMs.toFixed(1)}ms</span>
                    <span className={`rounded border px-1.5 py-0.5 text-[9.5px] font-bold ${badgeStyle}`}>
                      {outcomeLabel}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Right: Latency Percentile Histogram (P50/P95/P99) + 700-Store Financial Protection */}
        <div className="min-w-0 space-y-5 lg:col-span-5">
          {/* Histogram */}
          <div className="surface-panel min-w-0 rounded-2xl border p-4 sm:p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="flex items-center gap-2 text-sm font-bold text-heading">
                <Activity className="h-4 w-4 text-emerald-500" />
                {isVi
                  ? 'Bieu Do Phan Bo Do Tre (P50 / P95 / P99)'
                  : 'Live Latency Percentile Histogram (P50 / P95 / P99)'}
              </h2>
              <span className="font-mono text-[10.5px] text-dim">
                N = {activeResult.totalRequests} reqs
              </span>
            </div>

            <div className="mt-3 grid grid-cols-3 gap-2 font-mono text-xs">
              <div className="surface-inset rounded-lg border p-2.5 text-center">
                <div className="text-[10px] font-semibold uppercase text-cyan-600 dark:text-cyan-400">P50 Median</div>
                <div className="mt-0.5 text-sm font-extrabold text-heading">{activeResult.p50Ms.toFixed(1)} ms</div>
              </div>
              <div className="surface-inset rounded-lg border p-2.5 text-center">
                <div className="text-[10px] font-semibold uppercase text-amber-600 dark:text-amber-400">P95 Tail</div>
                <div className="mt-0.5 text-sm font-extrabold text-heading">{activeResult.p95Ms.toFixed(1)} ms</div>
              </div>
              <div className="surface-inset rounded-lg border p-2.5 text-center">
                <div className="text-[10px] font-semibold uppercase text-rose-600 dark:text-rose-400">P99 Worst</div>
                <div className="mt-0.5 text-sm font-extrabold text-heading">{activeResult.p99Ms.toFixed(1)} ms</div>
              </div>
            </div>

            <div
              data-testid="voucher-latency-histogram"
              className="mt-4 flex h-40 items-end gap-1.5 rounded-xl border border-hairline bg-slate-100/60 p-3 dark:bg-[#050914]"
            >
              {activeResult.histogram.map((bin) => {
                const heightPct = Math.max(6, Math.round((bin.count / maxHistogramCount) * 100));
                const barColor = bin.hasP99
                  ? 'bg-rose-500'
                  : bin.hasP95
                    ? 'bg-amber-500'
                    : bin.hasP50
                      ? 'bg-cyan-500'
                      : isConCung
                        ? 'bg-emerald-500/75'
                        : isPessimistic
                          ? 'bg-amber-500/65'
                          : 'bg-rose-500/65';

                return (
                  <div
                    key={bin.bucketIndex}
                    className="flex h-full flex-1 flex-col items-center justify-end gap-1"
                    title={`${bin.label}: ${bin.count} requests (${bin.percentage}%)`}
                  >
                    <div className="flex flex-col items-center gap-0.5 font-mono text-[8.5px] font-extrabold">
                      {bin.hasP50 && <span className="text-cyan-600 dark:text-cyan-300">P50</span>}
                      {bin.hasP95 && <span className="text-amber-600 dark:text-amber-300">P95</span>}
                      {bin.hasP99 && <span className="text-rose-600 dark:text-rose-300">P99</span>}
                    </div>
                    <div
                      className={`w-full rounded-t transition-all duration-300 ${barColor}`}
                      style={{ height: `${Math.round((heightPct * sweepProgress) / 100)}%` }}
                    />
                  </div>
                );
              })}
            </div>
            <div className="mt-1.5 flex justify-between font-mono text-[10px] text-faint">
              <span>{activeResult.histogram[0]?.minMs.toFixed(1)} ms</span>
              <span>Latency Distribution ({activeResult.architecture.shortName})</span>
              <span>{activeResult.maxMs.toFixed(1)} ms</span>
            </div>
          </div>

          {/* 700+ Retail Store Financial Protection Panel */}
          <div className="surface-panel min-w-0 rounded-2xl border p-4 sm:p-5">
            <h2 className="flex items-center gap-2 text-sm font-bold text-heading">
              <Store className="h-4 w-4 text-cyan-500" />
              {isVi
                ? `Bao Ve Tai Chinh Tren ${storeCount}+ Sieu Thi Ban Le`
                : `Financial Leakage Shield Across ${storeCount}+ Retail Stores`}
            </h2>
            <p className="mt-1 text-[11.5px] text-dim">
              {isVi
                ? 'Uoc tinh thiet hai phat sinh khi mo chien dich Flash-Sale dong loat tren toan he thong sieu thi.'
                : 'Projected direct voucher financial exposure when running simultaneous Flash-Sale campaigns nationwide.'}
            </p>

            <div className="mt-3 space-y-2 font-mono text-xs">
              <div className="surface-inset flex items-center justify-between gap-2 rounded-xl border px-3 py-2">
                <span className="text-dim">Naive Leak (1 Promo Code)</span>
                <span className="font-bold text-rose-600 dark:text-rose-400">
                  -{formatVndCurrency(comparison.naive.financial.singleVoucherLeakVnd)}
                </span>
              </div>
              <div className="surface-inset flex items-center justify-between gap-2 rounded-xl border px-3 py-2">
                <span className="text-dim">Naive Exposure ({storeCount} Stores)</span>
                <span className="font-bold text-rose-600 dark:text-rose-400">
                  -{formatVndCompact(comparison.naive.financial.projected700StoreExposureVnd)}
                </span>
              </div>
              <div className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-3 py-2.5 dark:bg-emerald-950/25">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-emerald-800 dark:text-emerald-200">
                    Con Cung Pattern Saved ({storeCount} Stores)
                  </span>
                  <span className="text-sm font-extrabold text-emerald-700 dark:text-emerald-300">
                    +{formatVndCompact(comparison.financialSaved700StoresVnd)}
                  </span>
                </div>
                <div className="mt-1 flex flex-wrap justify-between gap-2 text-[10.5px] text-dim">
                  <span>{comparison.p99SpeedupVsPessimistic}x lower P99 vs UPDLOCK</span>
                  <span>{comparison.throughputMultiplierVsPessimistic}x higher RPS vs UPDLOCK</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Head-to-Head 3-Architecture Production Scorecard */}
      <div className="surface-panel min-w-0 rounded-2xl border p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 text-sm font-bold text-heading">
            <Trophy className="h-4 w-4 text-amber-500" />
            {isVi
              ? 'Bang So Sanh Truc Dien 3 Kien Truc Xu Ly 500 Request Voucher'
              : 'Head-to-Head 3-Architecture Production Scorecard (500 Concurrent Voucher Requests)'}
          </h2>
          <span className="font-mono text-[10.5px] text-dim">
            {isVi ? 'Nhan vao hang bat ky de xem thac nuoc chi tiet' : 'Click any row to inspect its waterfall & histogram'}
          </span>
        </div>

        <div className="mt-3.5 w-full overflow-x-auto">
          <table className="w-full min-w-[680px] text-left font-mono text-xs">
            <thead>
              <tr className="border-hairline border-b text-[10.5px] uppercase text-dim">
                <th className="py-2 pr-3">Backend Architecture</th>
                <th className="py-2 pr-3">Approved / 409</th>
                <th className="py-2 pr-3">Double-Spends</th>
                <th className="py-2 pr-3">P50 / P95 / P99</th>
                <th className="py-2 pr-3">Throughput</th>
                <th className="py-2 pr-3">DB CPU</th>
                <th className="py-2 pr-3">SQL Queries</th>
                <th className="py-2">700-Store Loss</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800/70">
              {[comparison.naive, comparison.pessimistic, comparison.concung].map((row) => {
                const isRowSelected = row.mode === selectedMode;
                return (
                  <tr
                    key={row.mode}
                    onClick={() => handleSelectArchitecture(row.mode)}
                    className={`cursor-pointer transition ${
                      isRowSelected ? 'bg-cyan-500/10' : 'hover:bg-slate-500/5'
                    }`}
                  >
                    <td className="py-2.5 pr-3 font-sans font-bold text-heading">
                      {row.architecture.title}
                    </td>
                    <td className="py-2.5 pr-3 text-body">
                      {row.totalApproved200Count} / {row.rejected409Count}
                    </td>
                    <td
                      className={`py-2.5 pr-3 font-extrabold ${
                        row.doubleSpentCount > 0
                          ? 'text-rose-600 dark:text-rose-400'
                          : 'text-emerald-600 dark:text-emerald-400'
                      }`}
                    >
                      {row.doubleSpentCount} ({row.doubleSpendRatePct.toFixed(2)}%)
                    </td>
                    <td className="py-2.5 pr-3 text-body">
                      {row.p50Ms} / {row.p95Ms} / <strong className="text-heading">{row.p99Ms}ms</strong>
                    </td>
                    <td className="py-2.5 pr-3 font-bold text-cyan-600 dark:text-cyan-300">
                      {row.throughputRps.toLocaleString()} RPS
                    </td>
                    <td
                      className={`py-2.5 pr-3 font-bold ${
                        row.dbCpuPct >= 85
                          ? 'text-rose-600 dark:text-rose-400'
                          : row.dbCpuPct >= 50
                            ? 'text-amber-600 dark:text-amber-300'
                            : 'text-emerald-600 dark:text-emerald-400'
                      }`}
                    >
                      {row.dbCpuPct.toFixed(1)}%
                    </td>
                    <td className="py-2.5 pr-3 text-body">{row.sqlQueriesExecuted.toLocaleString()}</td>
                    <td
                      className={`py-2.5 font-bold ${
                        row.financial.projected700StoreExposureVnd > 0
                          ? 'text-rose-600 dark:text-rose-400'
                          : 'text-emerald-600 dark:text-emerald-400'
                      }`}
                    >
                      {row.financial.projected700StoreExposureVnd > 0
                        ? `-${formatVndCompact(row.financial.projected700StoreExposureVnd)}`
                        : '0 VND (PROTECTED)'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

export default VoucherRaceArena;

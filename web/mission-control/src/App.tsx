import { useEffect, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  Bot,
  CheckCircle2,
  Cpu,
  Database,
  ExternalLink,
  FileCode2,
  Flame,
  GitBranch,
  Layers,
  Play,
  Search,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  TrendingUp,
  Zap,
} from 'lucide-react';
import { ArchitectureTopologySvg } from './components/ArchitectureTopologySvg';
import { TraceWaterfallPanel } from './components/TraceWaterfallPanel';
import {
  EMPIRICAL_DOTNET_BENCHMARK,
  EMPIRICAL_PYTHON_RAG_EVAL,
  POLYGLOT_CODE_VAULT,
} from './data/empiricalBenchmarks';
import {
  detectPolyglotBackends,
  executeBurst,
  executeHybridRagSearch,
  executeSreDiagnosis,
  type BackendConnectionState,
} from './engine/dualRuntimeAdapter';
import type {
  BurstSimulationResult,
  ChaosProfile,
  ConcurrencyMode,
  RagQueryResponse,
  SreDiagnosisResponse,
} from './engine/types';

type ActiveTab = 'arena' | 'sre-rag' | 'traces' | 'benchmarks' | 'roi';

const PRESET_RAG_QUERIES = [
  { label: 'Flash-Sale Double-Spend (Redis Lua + RowVersion)', q: 'How to prevent flash-sale voucher double-spending and negative stock with Redis Lua and RowVersion?', adversarial: false },
  { label: 'Idempotency-Key & 409 Conflict Guard', q: 'Mobile clients retry POST orders on timeout causing duplicate charges; how to implement Idempotency-Key and 409 conflict?', adversarial: false },
  { label: 'Thundering Herd Cache Stampede', q: 'Redis hot key expiration causes thundering herd cache stampede and SQL CPU 100%', adversarial: false },
  { label: '.NET ThreadPool Starvation (.Result)', q: 'Kestrel low CPU but high request queue from sync-over-async Task.Result ThreadPool starvation', adversarial: false },
  { label: 'Dapper Keyset vs OFFSET Pagination', q: 'Optimize slow SQL Server OFFSET pagination and lock contention using Dapper keyset pagination', adversarial: false },
  { label: '🛡️ Adversarial OOD: Sourdough Pizza?', q: 'What is the best recipe for sourdough pizza crust fermentation?', adversarial: true },
  { label: '🛡️ Adversarial OOD: Astrology Horoscope?', q: 'Give me astrology horoscope predictions for Scorpio next month', adversarial: true },
];

export function App() {
  const [activeTab, setActiveTab] = useState<ActiveTab>('arena');
  const [conn, setConn] = useState<BackendConnectionState>({
    dotnetLive: false,
    pythonLive: false,
    modeLabel: 'EDGE DETERMINISTIC KERNEL (0ms Cold-Start)',
  });

  // Tab 1: Concurrency & Chaos Arena State
  const [mode, setMode] = useState<ConcurrencyMode>('AegisLockFreeChannel');
  const [concurrentReqs, setConcurrentReqs] = useState<number>(4000);
  const [initialStock, setInitialStock] = useState<number>(500);
  const [dupRatio, setDupRatio] = useState<number>(0.20);
  const [chaos, setChaos] = useState<ChaosProfile>({
    injectedDbLatencyMs: 0,
    failureRatePercent: 0,
    forceCircuitOpen: false,
    cacheStampedeActive: false,
  });
  const [isSimulating, setIsSimulating] = useState<boolean>(false);
  const [simResult, setSimResult] = useState<BurstSimulationResult | null>(null);
  const [showdownResults, setShowdownResults] = useState<BurstSimulationResult[] | null>(null);

  // Tab 2: SRE Agent & Hybrid RAG State
  const [diagnosis, setDiagnosis] = useState<SreDiagnosisResponse | null>(null);
  const [ragQuery, setRagQuery] = useState<string>(PRESET_RAG_QUERIES[0].q);
  const [ragResult, setRagResult] = useState<RagQueryResponse | null>(null);

  // Tab 4: Code Vault State
  const [selectedCodeId, setSelectedCodeId] = useState<string>(POLYGLOT_CODE_VAULT[0].id);

  // Tab 5: Executive ROI State
  const [roiPeakRps, setRoiPeakRps] = useState<number>(5000);
  const [roiAovUsd, setRoiAovUsd] = useState<number>(48);
  const [roiCurrentP99Ms, setRoiCurrentP99Ms] = useState<number>(680);

  useEffect(() => {
    let mounted = true;
    (async () => {
      const detected = await detectPolyglotBackends();
      if (!mounted) return;
      setConn(detected);

      const initialBurst = await executeBurst('AegisLockFreeChannel', 4000, 500, 0.2, chaos, detected.dotnetLive);
      if (!mounted) return;
      setSimResult(initialBurst);

      const [initDiag, initRag] = await Promise.all([
        executeSreDiagnosis(initialBurst.snapshot, initialBurst.throughputRps, detected.pythonLive),
        executeHybridRagSearch(PRESET_RAG_QUERIES[0].q, detected.pythonLive),
      ]);
      if (!mounted) return;
      setDiagnosis(initDiag);
      setRagResult(initRag);
    })();
    return () => {
      mounted = false;
    };
  }, []);

  async function handleRunBurst(overrideMode?: ConcurrencyMode) {
    const targetMode = overrideMode ?? mode;
    if (overrideMode) setMode(overrideMode);
    setIsSimulating(true);
    try {
      const res = await executeBurst(targetMode, concurrentReqs, initialStock, dupRatio, chaos, conn.dotnetLive);
      setSimResult(res);
      const diag = await executeSreDiagnosis(res.snapshot, res.throughputRps, conn.pythonLive);
      setDiagnosis(diag);
    } finally {
      setIsSimulating(false);
    }
  }

  async function handleThreeModeShowdown() {
    setIsSimulating(true);
    try {
      const modes: ConcurrencyMode[] = ['NaiveUnprotected', 'OptimisticCas', 'AegisLockFreeChannel'];
      const runs: BurstSimulationResult[] = [];
      for (const m of modes) {
        runs.push(await executeBurst(m, concurrentReqs, initialStock, dupRatio, chaos, conn.dotnetLive));
      }
      setShowdownResults(runs);
      const best = runs[2];
      setMode('AegisLockFreeChannel');
      setSimResult(best);
      const diag = await executeSreDiagnosis(runs[0].snapshot, runs[0].throughputRps, conn.pythonLive);
      setDiagnosis(diag);
    } finally {
      setIsSimulating(false);
    }
  }

  async function handleRagSearch(customQuery?: string) {
    const q = customQuery ?? ragQuery;
    setRagQuery(q);
    const res = await executeHybridRagSearch(q, conn.pythonLive);
    setRagResult(res);
  }

  async function handlePresetIncident(preset: 'oversell' | 'stampede' | 'circuit') {
    let nextMode: ConcurrencyMode = 'AegisLockFreeChannel';
    let nextChaos: ChaosProfile = {
      injectedDbLatencyMs: 0,
      failureRatePercent: 0,
      forceCircuitOpen: false,
      cacheStampedeActive: false,
    };
    if (preset === 'oversell') {
      nextMode = 'NaiveUnprotected';
      nextChaos = { ...nextChaos, injectedDbLatencyMs: 12 };
    } else if (preset === 'stampede') {
      nextMode = 'OptimisticCas';
      nextChaos = { ...nextChaos, injectedDbLatencyMs: 45, cacheStampedeActive: true };
    } else {
      nextMode = 'AegisLockFreeChannel';
      nextChaos = { ...nextChaos, failureRatePercent: 35, forceCircuitOpen: true };
    }
    setMode(nextMode);
    setChaos(nextChaos);
    const res = await executeBurst(nextMode, concurrentReqs, initialStock, dupRatio, nextChaos, conn.dotnetLive);
    setSimResult(res);
    const diag = await executeSreDiagnosis(res.snapshot, res.throughputRps, conn.pythonLive);
    setDiagnosis(diag);
    setActiveTab('sre-rag');
  }

  const snap = simResult?.snapshot;
  const isBreach = snap ? !snap.invariantIntact || snap.overAllocatedUnits > 0 : false;

  // Executive ROI Math
  const latencyDropFactor = Math.max(0, (roiCurrentP99Ms - 18) / 100);
  const conversionLiftPct = Number(Math.min(18.5, latencyDropFactor * 1.15).toFixed(1));
  const monthlyProtectedFlashRevenue = Math.round(roiPeakRps * 0.032 * roiAovUsd * 4);
  const annualEngineeringRoiUsd = Math.round(monthlyProtectedFlashRevenue * 12 + roiPeakRps * 2.8);

  return (
    <div className="min-h-screen pb-16">
      {/* Top Command Header */}
      <header className="sticky top-0 z-30 border-b border-slate-800/90 bg-[#060913]/90 backdrop-blur-md">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-cyan-400/40 bg-cyan-500/10 text-cyan-300 shadow-[0_0_20px_rgba(6,182,212,0.2)]">
              <Zap className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-base font-extrabold tracking-tight text-white">AegisPulse</span>
                <span className="rounded-full border border-cyan-500/30 bg-cyan-500/10 px-2 py-0.5 font-mono text-[10px] font-semibold uppercase text-cyan-300">
                  v1.0 Polyglot Architecture Lab
                </span>
              </div>
              <p className="text-xs text-slate-400">
                High-Concurrency .NET 10 Kernel · Chaos Fault Injector · Hybrid BM25+Vector RRF SRE Co-Pilot
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <div className="flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-950/30 px-3 py-1.5 font-mono text-[11px] text-emerald-300">
              <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-400" />
              {conn.modeLabel}
            </div>
            <a
              href="https://github.com/tvt987/aegispulse-distributed-sre"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs font-semibold text-slate-200 transition hover:border-cyan-400 hover:text-cyan-300"
            >
              <GitBranch className="h-3.5 w-3.5" />
              GitHub Source & CI
              <ExternalLink className="h-3 w-3" />
            </a>
          </div>
        </div>

        {/* Navigation Bar */}
        <div className="mx-auto max-w-7xl px-4 sm:px-6">
          <nav className="flex gap-1 overflow-x-auto py-2" aria-label="Main Tabs">
            {[
              { id: 'arena', label: '1. Concurrency & Chaos Arena', icon: Flame },
              { id: 'sre-rag', label: '2. Agentic SRE & Hybrid RAG', icon: Bot },
              { id: 'traces', label: '3. OpenTelemetry Waterfall', icon: Activity },
              { id: 'benchmarks', label: '4. Verified CI Benchmarks & Code', icon: FileCode2 },
              { id: 'roi', label: '5. Executive ROI & Architect Hub', icon: TrendingUp },
            ].map((tab) => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  data-testid={`tab-${tab.id}`}
                  onClick={() => setActiveTab(tab.id as ActiveTab)}
                  className={`inline-flex items-center gap-2 whitespace-nowrap rounded-lg px-3.5 py-2 text-xs font-semibold transition ${
                    isActive
                      ? 'bg-cyan-500/15 text-cyan-300 ring-1 ring-cyan-400/50'
                      : 'text-slate-400 hover:bg-slate-800/60 hover:text-slate-200'
                  }`}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {tab.label}
                </button>
              );
            })}
          </nav>
        </div>
      </header>

      <main className="mx-auto mt-6 max-w-7xl px-4 sm:px-6">
        {/* TAB 1: CONCURRENCY & CHAOS ARENA */}
        {activeTab === 'arena' && snap && simResult && (
          <div className="space-y-6">
            {/* Invariant Proof Hero Banner */}
            <div
              data-testid="invariant-banner"
              className={`flex flex-wrap items-center justify-between gap-4 rounded-2xl border p-5 ${
                isBreach
                  ? 'border-rose-500/50 bg-gradient-to-r from-rose-950/60 via-[#0d1222] to-[#091020]'
                  : 'border-emerald-500/40 bg-gradient-to-r from-emerald-950/40 via-[#0b1324] to-[#091020]'
              }`}
            >
              <div className="flex items-start gap-3.5">
                {isBreach ? (
                  <ShieldAlert className="mt-0.5 h-8 w-8 shrink-0 text-rose-400" />
                ) : (
                  <ShieldCheck className="mt-0.5 h-8 w-8 shrink-0 text-emerald-400" />
                )}
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={`rounded px-2 py-0.5 font-mono text-xs font-bold uppercase ${
                        isBreach ? 'bg-rose-500/20 text-rose-300' : 'bg-emerald-500/20 text-emerald-300'
                      }`}
                    >
                      {isBreach ? 'SEV-1 INVARIANT BREACHED (DOUBLE-SPEND LEAK)' : 'ZERO-DOUBLE-SPEND INVARIANT VERIFIED'}
                    </span>
                    <span className="font-mono text-xs text-slate-400">
                      Engine: {simResult.mode} · {simResult.throughputRps.toLocaleString()} RPS
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-slate-200">
                    {isBreach ? (
                      <>
                        Naive Read-Then-Write allocated <strong>{snap.totalUnitsAllocated}</strong> units against a cap
                        of <strong>{snap.initialStock}</strong> — leaking{' '}
                        <strong className="text-rose-400">+{snap.overAllocatedUnits} oversold units</strong> due to
                        concurrent stale reads!
                      </>
                    ) : (
                      <>
                        Processed <strong>{snap.totalRequests.toLocaleString()}</strong> parallel requests against{' '}
                        <strong>{snap.initialStock}</strong> flash-sale units:{' '}
                        <strong className="text-emerald-300">0 over-allocated units</strong>,{' '}
                        <strong>{snap.idempotentReplays.toLocaleString()}</strong> duplicate retries deduplicated, and{' '}
                        <strong>{snap.payloadConflicts409}</strong> mutated-payload 409 conflicts blocked.
                      </>
                    )}
                  </p>
                </div>
              </div>

              <button
                onClick={() => setActiveTab('sre-rag')}
                className="inline-flex items-center gap-2 rounded-xl border border-cyan-400/40 bg-cyan-500/15 px-4 py-2.5 text-xs font-bold text-cyan-200 transition hover:bg-cyan-500/25"
              >
                <Bot className="h-4 w-4" />
                Inspect ReAct SRE Diagnosis
              </button>
            </div>

            {/* Live KPI Strip */}
            <div className="grid grid-cols-2 gap-3.5 sm:grid-cols-3 lg:grid-cols-6">
              {[
                {
                  label: 'Throughput',
                  val: `${simResult.throughputRps.toLocaleString()} RPS`,
                  sub: `${simResult.elapsedMilliseconds}ms burst`,
                  tone: 'text-cyan-300',
                },
                {
                  label: 'Stock Invariant',
                  val: `${snap.totalUnitsAllocated} / ${snap.initialStock}`,
                  sub: `Remaining: ${snap.remainingStock}`,
                  tone: isBreach ? 'text-rose-400' : 'text-emerald-300',
                },
                {
                  label: 'Double-Spend Leaks',
                  val: String(snap.overAllocatedUnits),
                  sub: isBreach ? 'CRITICAL RACE BUG' : '100% Atomic',
                  tone: isBreach ? 'text-rose-400' : 'text-emerald-400',
                },
                {
                  label: 'Idempotent Replays',
                  val: snap.idempotentReplays.toLocaleString(),
                  sub: `${snap.payloadConflicts409}x 409 blocked`,
                  tone: 'text-sky-300',
                },
                {
                  label: 'p99 Tail Latency',
                  val: `${(snap.p99LatencyUs / 1000).toFixed(3)} ms`,
                  sub: `p50: ${(snap.p50LatencyUs / 1000).toFixed(3)} ms`,
                  tone: snap.p99LatencyUs > 25000 ? 'text-amber-300' : 'text-emerald-300',
                },
                {
                  label: 'Circuit & CAS Spins',
                  val: snap.circuitState,
                  sub: `${snap.totalCasRetries} CAS retries`,
                  tone: snap.circuitState === 'Closed' ? 'text-slate-200' : 'text-amber-400',
                },
              ].map((k) => (
                <div key={k.label} className="rounded-xl border border-slate-800/90 bg-[#091020] p-3.5">
                  <div className="text-[11px] font-medium uppercase tracking-wider text-slate-400">{k.label}</div>
                  <div className={`mt-1 font-mono text-lg font-extrabold ${k.tone}`}>{k.val}</div>
                  <div className="mt-0.5 font-mono text-[11px] text-slate-500">{k.sub}</div>
                </div>
              ))}
            </div>

            {/* Live Topology SVG */}
            <ArchitectureTopologySvg
              mode={simResult.mode}
              snapshot={snap}
              throughputRps={simResult.throughputRps}
              isRunning={isSimulating}
            />

            {/* Simulation Control Deck + Chaos Fault Injector */}
            <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
              <div className="lg:col-span-7 rounded-2xl border border-slate-800/90 bg-[#091020] p-5">
                <h2 className="flex items-center gap-2 text-sm font-bold text-white">
                  <Cpu className="h-4 w-4 text-cyan-400" />
                  Concurrency Engine & Load Parameters
                </h2>

                {/* 3 Architecture Cards */}
                <div className="mt-3.5 grid grid-cols-1 gap-2.5 sm:grid-cols-3">
                  {[
                    {
                      m: 'NaiveUnprotected' as ConcurrencyMode,
                      title: 'Naive Read-Write',
                      badge: 'Anti-Pattern',
                      desc: 'SELECT then blind UPDATE without CAS or Lua lock.',
                    },
                    {
                      m: 'OptimisticCas' as ConcurrencyMode,
                      title: 'RowVersion CAS',
                      badge: 'SQL Optimistic',
                      desc: 'Compare-And-Swap version token + SHA-256 Idempotency.',
                    },
                    {
                      m: 'AegisLockFreeChannel' as ConcurrencyMode,
                      title: 'Aegis Lock-Free',
                      badge: 'Recommended',
                      desc: 'Atomic Lua quota + bounded Channel<T> write-behind WAL.',
                    },
                  ].map((item) => (
                    <button
                      key={item.m}
                      data-testid={`mode-${item.m}`}
                      onClick={() => handleRunBurst(item.m)}
                      className={`rounded-xl border p-3 text-left transition ${
                        mode === item.m
                          ? item.m === 'NaiveUnprotected'
                            ? 'border-rose-500/70 bg-rose-950/25'
                            : 'border-cyan-400/70 bg-cyan-950/25'
                          : 'border-slate-800 bg-[#060913] hover:border-slate-700'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-white">{item.title}</span>
                        <span className="rounded bg-slate-800 px-1.5 py-0.5 font-mono text-[10px] text-cyan-300">
                          {item.badge}
                        </span>
                      </div>
                      <p className="mt-1.5 text-[11px] leading-relaxed text-slate-400">{item.desc}</p>
                    </button>
                  ))}
                </div>

                {/* Sliders */}
                <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-3">
                  <div>
                    <div className="flex justify-between text-xs">
                      <span className="text-slate-400">Concurrent Requests</span>
                      <span className="font-mono font-bold text-cyan-300">{concurrentReqs.toLocaleString()}</span>
                    </div>
                    <input
                      type="range"
                      min={500}
                      max={10000}
                      step={500}
                      value={concurrentReqs}
                      onChange={(e) => setConcurrentReqs(Number(e.target.value))}
                      className="mt-2 w-full accent-cyan-400"
                    />
                  </div>
                  <div>
                    <div className="flex justify-between text-xs">
                      <span className="text-slate-400">Flash-Sale Stock Cap</span>
                      <span className="font-mono font-bold text-emerald-300">{initialStock} units</span>
                    </div>
                    <input
                      type="range"
                      min={100}
                      max={1500}
                      step={50}
                      value={initialStock}
                      onChange={(e) => setInitialStock(Number(e.target.value))}
                      className="mt-2 w-full accent-emerald-400"
                    />
                  </div>
                  <div>
                    <div className="flex justify-between text-xs">
                      <span className="text-slate-400">Duplicate Retry Ratio</span>
                      <span className="font-mono font-bold text-sky-300">{Math.round(dupRatio * 100)}%</span>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={0.5}
                      step={0.05}
                      value={dupRatio}
                      onChange={(e) => setDupRatio(Number(e.target.value))}
                      className="mt-2 w-full accent-sky-400"
                    />
                  </div>
                </div>

                <div className="mt-5 flex flex-wrap gap-3">
                  <button
                    data-testid="btn-execute-burst"
                    disabled={isSimulating}
                    onClick={() => handleRunBurst()}
                    className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-cyan-500 to-emerald-500 px-5 py-2.5 text-xs font-extrabold text-slate-950 shadow-lg shadow-cyan-500/20 transition hover:brightness-110 disabled:opacity-50"
                  >
                    <Play className="h-4 w-4 fill-current" />
                    {isSimulating ? 'Running Parallel Burst…' : 'Execute High-Concurrency Burst'}
                  </button>

                  <button
                    data-testid="btn-showdown"
                    disabled={isSimulating}
                    onClick={handleThreeModeShowdown}
                    className="inline-flex items-center gap-2 rounded-xl border border-amber-400/40 bg-amber-500/10 px-4 py-2.5 text-xs font-bold text-amber-200 transition hover:bg-amber-500/20 disabled:opacity-50"
                  >
                    <Sparkles className="h-4 w-4" />
                    Run 3-Mode Head-to-Head Showdown
                  </button>
                </div>
              </div>

              {/* Chaos Engineering Fault Injector */}
              <div className="lg:col-span-5 rounded-2xl border border-slate-800/90 bg-[#091020] p-5">
                <h2 className="flex items-center gap-2 text-sm font-bold text-white">
                  <AlertTriangle className="h-4 w-4 text-amber-400" />
                  Chaos Engineering Fault Injector
                </h2>
                <p className="mt-1 text-xs text-slate-400">
                  Inject realistic storage delays, hot-key stampedes, and circuit-breaker faults to verify system resilience.
                </p>

                <div className="mt-4 space-y-2.5">
                  {[
                    {
                      key: 'dbLag',
                      active: chaos.injectedDbLatencyMs > 0,
                      label: 'Inject +35ms SQL Lock Contention Delay',
                      toggle: () =>
                        setChaos((c) => ({ ...c, injectedDbLatencyMs: c.injectedDbLatencyMs > 0 ? 0 : 35 })),
                    },
                    {
                      key: 'stampede',
                      active: chaos.cacheStampedeActive,
                      label: 'Trigger Hot-SKU Redis Cache Stampede',
                      toggle: () => setChaos((c) => ({ ...c, cacheStampedeActive: !c.cacheStampedeActive })),
                    },
                    {
                      key: 'faults',
                      active: chaos.failureRatePercent > 0,
                      label: 'Inject 20% Transient Downstream Storage Errors',
                      toggle: () =>
                        setChaos((c) => ({ ...c, failureRatePercent: c.failureRatePercent > 0 ? 0 : 20 })),
                    },
                    {
                      key: 'forceOpen',
                      active: chaos.forceCircuitOpen,
                      label: 'Force Adaptive Circuit Breaker OPEN (503 Fast-Fail)',
                      toggle: () => setChaos((c) => ({ ...c, forceCircuitOpen: !c.forceCircuitOpen })),
                    },
                  ].map((item) => (
                    <button
                      key={item.key}
                      onClick={item.toggle}
                      className={`flex w-full items-center justify-between rounded-xl border px-3.5 py-2.5 text-xs font-medium transition ${
                        item.active
                          ? 'border-amber-400/60 bg-amber-950/30 text-amber-200'
                          : 'border-slate-800 bg-[#060913] text-slate-300 hover:border-slate-700'
                      }`}
                    >
                      <span>{item.label}</span>
                      <span
                        className={`rounded px-2 py-0.5 font-mono text-[10px] font-bold ${
                          item.active ? 'bg-amber-400 text-slate-950' : 'bg-slate-800 text-slate-400'
                        }`}
                      >
                        {item.active ? 'ACTIVE' : 'OFF'}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* 3-Mode Showdown Comparison Matrix (appears when Showdown clicked) */}
            {showdownResults && (
              <div
                data-testid="showdown-matrix"
                className="rounded-2xl border border-cyan-500/35 bg-[#091020] p-5"
              >
                <h3 className="text-sm font-bold text-white">
                  Head-to-Head Architecture Showdown ({concurrentReqs.toLocaleString()} Concurrent Requests ·{' '}
                  {initialStock} Stock)
                </h3>
                <div className="mt-3 grid grid-cols-1 gap-4 md:grid-cols-3">
                  {showdownResults.map((r) => {
                    const leak = r.snapshot.overAllocatedUnits > 0;
                    return (
                      <div
                        key={r.mode}
                        className={`rounded-xl border p-4 ${
                          leak ? 'border-rose-500/50 bg-rose-950/15' : 'border-emerald-500/40 bg-emerald-950/10'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-mono text-xs font-bold text-white">{r.mode}</span>
                          <span
                            className={`rounded px-2 py-0.5 font-mono text-[10px] font-bold ${
                              leak ? 'bg-rose-500/20 text-rose-300' : 'bg-emerald-500/20 text-emerald-300'
                            }`}
                          >
                            {leak ? `FAIL (+${r.snapshot.overAllocatedUnits} LEAK)` : 'PASS (0 LEAK)'}
                          </span>
                        </div>
                        <div className="mt-3 space-y-1.5 font-mono text-xs text-slate-300">
                          <div className="flex justify-between">
                            <span className="text-slate-400">Throughput:</span>
                            <strong>{r.throughputRps.toLocaleString()} RPS</strong>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-slate-400">p99 Latency:</span>
                            <strong>{(r.snapshot.p99LatencyUs / 1000).toFixed(3)} ms</strong>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-slate-400">Idempotent Replays:</span>
                            <strong>{r.snapshot.idempotentReplays.toLocaleString()}</strong>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-slate-400">CAS Retries:</span>
                            <strong>{r.snapshot.totalCasRetries}</strong>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}

        {/* TAB 2: AUTONOMOUS SRE AGENT & HYBRID RAG LAB */}
        {activeTab === 'sre-rag' && (
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
            {/* Left: ReAct Incident Co-Pilot */}
            <div className="lg:col-span-6 space-y-4">
              <div className="rounded-2xl border border-slate-800/90 bg-[#091020] p-5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h2 className="flex items-center gap-2 text-sm font-bold text-white">
                    <Bot className="h-4 w-4 text-cyan-400" />
                    Autonomous ReAct SRE Incident Co-Pilot
                  </h2>
                  <span className="font-mono text-[11px] text-slate-400">
                    Latency: {diagnosis?.total_agent_latency_ms ?? 0} ms
                  </span>
                </div>
                <p className="mt-1 text-xs text-slate-400">
                  Trigger a 1-click production failure drill or diagnose your live telemetry from Tab 1.
                </p>

                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    onClick={() => handlePresetIncident('oversell')}
                    className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-1.5 text-xs font-semibold text-rose-300 hover:bg-rose-500/20"
                  >
                    Drill 1: SEV-1 Double-Spend Leak
                  </button>
                  <button
                    onClick={() => handlePresetIncident('stampede')}
                    className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-1.5 text-xs font-semibold text-amber-300 hover:bg-amber-500/20"
                  >
                    Drill 2: Cache Stampede + SQL Lag
                  </button>
                  <button
                    onClick={() => handlePresetIncident('circuit')}
                    className="rounded-lg border border-sky-500/40 bg-sky-500/10 px-3 py-1.5 text-xs font-semibold text-sky-300 hover:bg-sky-500/20"
                  >
                    Drill 3: 503 Circuit Breaker Trip
                  </button>
                </div>

                {diagnosis && (
                  <div className="mt-4 space-y-3.5">
                    <div
                      className={`rounded-xl border p-3.5 text-xs leading-relaxed ${
                        diagnosis.severity.includes('SEV-1')
                          ? 'border-rose-500/50 bg-rose-950/25 text-rose-200'
                          : diagnosis.severity.includes('SEV-2')
                            ? 'border-amber-500/50 bg-amber-950/25 text-amber-200'
                            : 'border-emerald-500/40 bg-emerald-950/20 text-emerald-200'
                      }`}
                    >
                      {diagnosis.executive_summary}
                    </div>

                    {/* ReAct Tool Trace */}
                    <div className="space-y-2">
                      {diagnosis.react_trace.map((st) => (
                        <div key={st.step} className="rounded-xl border border-slate-800 bg-[#060913] p-3">
                          <div className="flex items-center justify-between font-mono text-[11px]">
                            <span className="font-semibold text-cyan-300">
                              Step {st.step}: {st.phase}
                            </span>
                            <span className="text-slate-400">{st.duration_ms} ms</span>
                          </div>
                          <pre className="mt-1.5 overflow-x-auto font-mono text-[11px] text-slate-300">
                            {JSON.stringify(st.output, null, 2)}
                          </pre>
                        </div>
                      ))}
                    </div>

                    {diagnosis.recommended_code_patch && (
                      <div className="rounded-xl border border-slate-800 bg-[#050811] p-3.5">
                        <div className="mb-1.5 font-mono text-[11px] font-semibold text-emerald-300">
                          Recommended Production Remediation Patch ({diagnosis.code_language})
                        </div>
                        <pre className="overflow-x-auto font-mono text-xs text-cyan-200">
                          {diagnosis.recommended_code_patch}
                        </pre>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Right: Hybrid Okapi BM25 + Dense Vector + RRF Search & Abstention Guard */}
            <div className="lg:col-span-6 space-y-4">
              <div className="rounded-2xl border border-slate-800/90 bg-[#091020] p-5">
                <h2 className="flex items-center gap-2 text-sm font-bold text-white">
                  <Search className="h-4 w-4 text-emerald-400" />
                  Hybrid RAG Playground (Okapi BM25 + 384d Dense + RRF + Abstention Gate)
                </h2>
                <p className="mt-1 text-xs text-slate-400">
                  Test both in-domain architecture queries and adversarial out-of-domain queries to verify zero-hallucination abstention.
                </p>

                <div className="mt-3 flex gap-2">
                  <input
                    data-testid="rag-input"
                    type="text"
                    value={ragQuery}
                    onChange={(e) => setRagQuery(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleRagSearch()}
                    placeholder="Ask about Redis Lua, RowVersion, Dapper, ThreadPool, OTel, or test out-of-scope..."
                    className="flex-1 rounded-xl border border-slate-700 bg-[#060913] px-3.5 py-2 text-xs text-white placeholder-slate-500 focus:border-cyan-400 focus:outline-none"
                  />
                  <button
                    data-testid="btn-rag-search"
                    onClick={() => handleRagSearch()}
                    className="rounded-xl bg-cyan-500 px-4 py-2 text-xs font-bold text-slate-950 hover:bg-cyan-400"
                  >
                    Retrieve
                  </button>
                </div>

                {/* Preset Query Chips */}
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {PRESET_RAG_QUERIES.map((item) => (
                    <button
                      key={item.label}
                      data-testid={item.adversarial ? `ood-chip-${item.label.slice(-12, -1).toLowerCase().replace(/\s+/g, '-')}` : undefined}
                      onClick={() => handleRagSearch(item.q)}
                      className={`rounded-lg border px-2.5 py-1 text-[11px] font-medium transition ${
                        item.adversarial
                          ? 'border-rose-500/40 bg-rose-950/30 text-rose-300 hover:bg-rose-900/40'
                          : 'border-slate-700 bg-slate-900 text-slate-300 hover:border-cyan-400/50 hover:text-cyan-200'
                      }`}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>

                {ragResult && (
                  <div data-testid="rag-result-panel" className="mt-4 space-y-3">
                    <div
                      className={`rounded-xl border p-4 ${
                        ragResult.abstained
                          ? 'border-amber-500/50 bg-amber-950/25'
                          : 'border-emerald-500/40 bg-emerald-950/15'
                      }`}
                    >
                      <div className="flex items-center justify-between text-xs">
                        <span
                          className={`font-mono font-bold ${
                            ragResult.abstained ? 'text-amber-300' : 'text-emerald-300'
                          }`}
                        >
                          {ragResult.abstained
                            ? '🛡️ ZERO-HALLUCINATION ABSTENTION TRIGGERED'
                            : `✅ GROUNDED ANSWER · Confidence ${(ragResult.confidence * 100).toFixed(1)}%`}
                        </span>
                        <span className="font-mono text-slate-400">{ragResult.latency_ms} ms</span>
                      </div>
                      <p className="mt-2 whitespace-pre-line text-xs leading-relaxed text-slate-200">
                        {ragResult.synthesized_answer}
                      </p>
                      {ragResult.abstention_reason && (
                        <p className="mt-1.5 font-mono text-[11px] text-amber-300/90">{ragResult.abstention_reason}</p>
                      )}
                    </div>

                    {ragResult.citations.map((cit) => (
                      <div key={cit.doc_id} className="rounded-xl border border-slate-800 bg-[#060913] p-3.5">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="font-mono text-xs font-bold text-cyan-300">
                            [{cit.doc_id}] {cit.title}
                          </span>
                          <span className="rounded bg-slate-800 px-2 py-0.5 font-mono text-[10px] text-slate-300">
                            {cit.severity_tier} · {cit.category}
                          </span>
                        </div>
                        <div className="mt-2 grid grid-cols-3 gap-2 font-mono text-[11px]">
                          <div className="rounded bg-slate-900/90 px-2 py-1 text-slate-300">
                            BM25: <strong className="text-cyan-300">{cit.bm25_score}</strong>
                          </div>
                          <div className="rounded bg-slate-900/90 px-2 py-1 text-slate-300">
                            Dense Cosine: <strong className="text-emerald-300">{cit.dense_score}</strong>
                          </div>
                          <div className="rounded bg-slate-900/90 px-2 py-1 text-slate-300">
                            RRF: <strong className="text-sky-300">{cit.rrf_score}</strong>
                          </div>
                        </div>
                        <pre className="mt-2.5 overflow-x-auto rounded bg-[#04070f] p-2.5 font-mono text-[11px] text-slate-300">
                          {cit.reference_code}
                        </pre>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* TAB 3: OPENTELEMETRY TRACE WATERFALL */}
        {activeTab === 'traces' && (
          <TraceWaterfallPanel traces={simResult?.sampledTraces ?? []} />
        )}

        {/* TAB 4: VERIFIED CI BENCHMARKS & POLYGLOT CODE VAULT */}
        {activeTab === 'benchmarks' && (
          <div className="space-y-6">
            {/* Empirical .NET 10 + Python 3.12 Benchmark Cards */}
            <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
              <div className="lg:col-span-7 rounded-2xl border border-slate-800/90 bg-[#091020] p-5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h2 className="flex items-center gap-2 text-sm font-bold text-white">
                    <Database className="h-4 w-4 text-cyan-400" />
                    Empirical .NET 10 High-Concurrency Benchmark Report
                  </h2>
                  <span className="rounded bg-emerald-500/15 px-2.5 py-0.5 font-mono text-[11px] text-emerald-300">
                    {EMPIRICAL_DOTNET_BENCHMARK.testSuiteSummary}
                  </span>
                </div>
                <p className="mt-1 font-mono text-[11px] text-slate-400">
                  Runtime: {EMPIRICAL_DOTNET_BENCHMARK.dotnetRuntime} · {EMPIRICAL_DOTNET_BENCHMARK.osArchitecture}
                </p>

                <div className="mt-4 overflow-x-auto">
                  <table className="w-full text-left font-mono text-xs">
                    <thead>
                      <tr className="border-b border-slate-800 text-[11px] uppercase text-slate-400">
                        <th className="py-2 pr-3">Engine Mode</th>
                        <th className="py-2 pr-3">Burst Load</th>
                        <th className="py-2 pr-3">Throughput</th>
                        <th className="py-2 pr-3">p99 Latency</th>
                        <th className="py-2 pr-3">Double-Spends</th>
                        <th className="py-2">Invariant</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/70">
                      {EMPIRICAL_DOTNET_BENCHMARK.runs.map((r) => (
                        <tr key={r.mode}>
                          <td className="py-2.5 pr-3 font-semibold text-slate-200">{r.label}</td>
                          <td className="py-2.5 pr-3 text-slate-300">{r.concurrentRequests.toLocaleString()}</td>
                          <td className="py-2.5 pr-3 text-cyan-300">{r.throughputRps.toLocaleString()} RPS</td>
                          <td className="py-2.5 pr-3 text-slate-200">{r.p99LatencyMs} ms</td>
                          <td className={`py-2.5 pr-3 font-bold ${r.overAllocatedUnits > 0 ? 'text-rose-400' : 'text-emerald-400'}`}>
                            {r.overAllocatedUnits}
                          </td>
                          <td className="py-2.5">
                            {r.invariantIntact ? (
                              <span className="inline-flex items-center gap-1 text-emerald-400">
                                <CheckCircle2 className="h-3.5 w-3.5" /> INTACT
                              </span>
                            ) : (
                              <span className="text-rose-400 font-bold">BREACHED</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="lg:col-span-5 rounded-2xl border border-slate-800/90 bg-[#091020] p-5">
                <h2 className="flex items-center gap-2 text-sm font-bold text-white">
                  <Layers className="h-4 w-4 text-emerald-400" />
                  Python 3.12 Hybrid RAG Evaluation Metrics
                </h2>
                <p className="mt-1 font-mono text-[11px] text-slate-400">
                  {EMPIRICAL_PYTHON_RAG_EVAL.pythonRuntime} · {EMPIRICAL_PYTHON_RAG_EVAL.testSuiteSummary}
                </p>

                <div className="mt-4 grid grid-cols-2 gap-3">
                  {[
                    { k: 'Recall@1 (Golden)', v: `${(EMPIRICAL_PYTHON_RAG_EVAL.recallAt1 * 100).toFixed(0)}%` },
                    { k: 'Recall@3 (Golden)', v: `${(EMPIRICAL_PYTHON_RAG_EVAL.recallAt3 * 100).toFixed(0)}%` },
                    { k: 'Mean Reciprocal Rank', v: EMPIRICAL_PYTHON_RAG_EVAL.mrr.toFixed(2) },
                    { k: 'OOD Abstention Precision', v: `${(EMPIRICAL_PYTHON_RAG_EVAL.abstentionPrecision * 100).toFixed(0)}%` },
                    { k: 'p50 Retrieval Latency', v: `${EMPIRICAL_PYTHON_RAG_EVAL.p50LatencyMs} ms` },
                    { k: 'p95 Retrieval Latency', v: `${EMPIRICAL_PYTHON_RAG_EVAL.p95LatencyMs} ms` },
                  ].map((m) => (
                    <div key={m.k} className="rounded-xl border border-slate-800 bg-[#060913] p-3">
                      <div className="text-[11px] text-slate-400">{m.k}</div>
                      <div className="mt-1 font-mono text-base font-extrabold text-emerald-300">{m.v}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Polyglot Code Vault */}
            <div className="rounded-2xl border border-slate-800/90 bg-[#091020] p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h3 className="text-sm font-bold text-white">Polyglot Production Source Vault (.NET 10 · Lua/SQL · Python 3.12)</h3>
                <div className="flex flex-wrap gap-2">
                  {POLYGLOT_CODE_VAULT.map((item) => (
                    <button
                      key={item.id}
                      onClick={() => setSelectedCodeId(item.id)}
                      className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                        selectedCodeId === item.id
                          ? 'bg-cyan-500/20 text-cyan-300 ring-1 ring-cyan-400/50'
                          : 'bg-slate-900 text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      {item.title}
                    </button>
                  ))}
                </div>
              </div>

              {POLYGLOT_CODE_VAULT.filter((x) => x.id === selectedCodeId).map((activeCode) => (
                <div key={activeCode.id} className="mt-4">
                  <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-xs">
                    <span className="font-mono text-cyan-400">{activeCode.file}</span>
                    <span className="text-slate-400">{activeCode.highlights}</span>
                  </div>
                  <pre className="overflow-x-auto rounded-xl border border-slate-800 bg-[#050811] p-4 font-mono text-xs leading-relaxed text-slate-200">
                    {activeCode.code}
                  </pre>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* TAB 5: EXECUTIVE ROI SIMULATOR & ARCHITECT ENGAGEMENT HUB */}
        {activeTab === 'roi' && (
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
            <div className="lg:col-span-7 rounded-2xl border border-slate-800/90 bg-[#091020] p-6">
              <h2 className="text-base font-bold text-white">
                Executive Architecture ROI & Flash-Sale Protection Calculator
              </h2>
              <p className="mt-1 text-xs text-slate-400">
                Estimate business impact from eliminating inventory overselling, retry-storm chargebacks, and p99 tail-latency bottlenecks.
              </p>

              <div className="mt-5 space-y-4">
                <div>
                  <div className="flex justify-between text-xs">
                    <span className="text-slate-300">Peak Campaign / Checkout Traffic (RPS)</span>
                    <span className="font-mono font-bold text-cyan-300">{roiPeakRps.toLocaleString()} RPS</span>
                  </div>
                  <input
                    type="range"
                    min={500}
                    max={25000}
                    step={500}
                    value={roiPeakRps}
                    onChange={(e) => setRoiPeakRps(Number(e.target.value))}
                    className="mt-2 w-full accent-cyan-400"
                  />
                </div>

                <div>
                  <div className="flex justify-between text-xs">
                    <span className="text-slate-300">Average Order / Voucher Basket Value (USD)</span>
                    <span className="font-mono font-bold text-emerald-300">${roiAovUsd}</span>
                  </div>
                  <input
                    type="range"
                    min={15}
                    max={250}
                    step={5}
                    value={roiAovUsd}
                    onChange={(e) => setRoiAovUsd(Number(e.target.value))}
                    className="mt-2 w-full accent-emerald-400"
                  />
                </div>

                <div>
                  <div className="flex justify-between text-xs">
                    <span className="text-slate-300">Current Checkout p99 Latency (ms)</span>
                    <span className="font-mono font-bold text-amber-300">{roiCurrentP99Ms} ms → 18 ms</span>
                  </div>
                  <input
                    type="range"
                    min={80}
                    max={1500}
                    step={20}
                    value={roiCurrentP99Ms}
                    onChange={(e) => setRoiCurrentP99Ms(Number(e.target.value))}
                    className="mt-2 w-full accent-amber-400"
                  />
                </div>
              </div>

              <div className="mt-6 grid grid-cols-1 gap-3.5 sm:grid-cols-3">
                <div className="rounded-xl border border-emerald-500/30 bg-emerald-950/20 p-4">
                  <div className="text-[11px] text-slate-400">Checkout Conversion Lift</div>
                  <div className="mt-1 font-mono text-xl font-extrabold text-emerald-300">+{conversionLiftPct}%</div>
                  <div className="mt-0.5 text-[11px] text-slate-400">Sub-20ms p99 response</div>
                </div>
                <div className="rounded-xl border border-cyan-500/30 bg-cyan-950/20 p-4">
                  <div className="text-[11px] text-slate-400">Monthly Protected Margin</div>
                  <div className="mt-1 font-mono text-xl font-extrabold text-cyan-300">
                    ${monthlyProtectedFlashRevenue.toLocaleString()}
                  </div>
                  <div className="mt-0.5 text-[11px] text-slate-400">0 oversold / 0 dup charge</div>
                </div>
                <div className="rounded-xl border border-sky-500/30 bg-sky-950/20 p-4">
                  <div className="text-[11px] text-slate-400">Projected Annual Impact</div>
                  <div className="mt-1 font-mono text-xl font-extrabold text-sky-300">
                    ${annualEngineeringRoiUsd.toLocaleString()}
                  </div>
                  <div className="mt-0.5 text-[11px] text-slate-400">+ ~62% DB CPU offloaded</div>
                </div>
              </div>
            </div>

            {/* Architect Engagement Card */}
            <div className="lg:col-span-5 rounded-2xl border border-cyan-500/35 bg-gradient-to-b from-[#0b152b] to-[#080e1c] p-6">
              <div className="inline-flex items-center gap-2 rounded-full border border-emerald-400/40 bg-emerald-500/10 px-3 py-1 font-mono text-[11px] font-semibold text-emerald-300">
                Available Immediately · Remote B2B / Contract / Milestone
              </div>
              <h2 className="mt-3 text-lg font-extrabold text-white">Trương Văn Tình</h2>
              <p className="text-xs font-semibold text-cyan-300">
                Full-Stack .NET & Applied AI Engineer · Ex-Con Cung (700+ Retail Stores, 5,000+ RPS)
              </p>
              <p className="mt-3 text-xs leading-relaxed text-slate-300">
                3+ years shipping high-concurrency retail backend systems (.NET 8/10, C#, Dapper, SQL Server, PostgreSQL, Redis Lua, Keycloak OIDC), modern TypeScript web apps (Angular, React, Vue 3), and production Hybrid RAG / Agentic workflows (Python, FastAPI, LangChain, Qdrant).
              </p>

              <div className="mt-4 space-y-2">
                <a
                  href="https://tvt987.github.io/CV_Backend_TruongVanTinh.pdf"
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center justify-between rounded-xl border border-slate-700 bg-slate-900/90 px-3.5 py-2.5 text-xs font-semibold text-slate-100 transition hover:border-cyan-400"
                >
                  <span>📄 Download Backend & High-Concurrency CV (.NET)</span>
                  <ExternalLink className="h-3.5 w-3.5 text-cyan-400" />
                </a>
                <a
                  href="https://tvt987.github.io/CV_FullStack_TruongVanTinh.pdf"
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center justify-between rounded-xl border border-slate-700 bg-slate-900/90 px-3.5 py-2.5 text-xs font-semibold text-slate-100 transition hover:border-cyan-400"
                >
                  <span>📄 Download Full-Stack Engineer CV (.NET + React/Angular)</span>
                  <ExternalLink className="h-3.5 w-3.5 text-cyan-400" />
                </a>
                <a
                  href="https://tvt987.github.io/CV_AI_TruongVanTinh.pdf"
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center justify-between rounded-xl border border-slate-700 bg-slate-900/90 px-3.5 py-2.5 text-xs font-semibold text-slate-100 transition hover:border-cyan-400"
                >
                  <span>📄 Download Applied AI & Hybrid RAG Engineer CV (Python)</span>
                  <ExternalLink className="h-3.5 w-3.5 text-cyan-400" />
                </a>
              </div>

              <div className="mt-4 flex flex-wrap gap-2.5">
                <a
                  href="mailto:tinhkun102@gmail.com?subject=Remote%20Engineering%20Opportunity%20-%20AegisPulse"
                  className="flex-1 rounded-xl bg-cyan-500 px-4 py-2.5 text-center text-xs font-extrabold text-slate-950 transition hover:bg-cyan-400"
                >
                  Email: tinhkun102@gmail.com
                </a>
                <a
                  href="https://www.linkedin.com/in/tr%C6%B0%C6%A1ng-v%C4%83n-t%C3%ACnh-651b12289/"
                  target="_blank"
                  rel="noreferrer"
                  className="rounded-xl border border-slate-700 bg-slate-900 px-4 py-2.5 text-xs font-bold text-slate-200 hover:border-cyan-400"
                >
                  LinkedIn
                </a>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
export default App;

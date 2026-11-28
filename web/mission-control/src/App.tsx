import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  Banknote,
  Bot,
  CheckCircle2,
  ChevronDown,
  Command,
  Cpu,
  Database,
  Download,
  ExternalLink,
  FileCode2,
  FileText,
  Flame,
  Gauge,
  GitBranch,
  Globe,
  Languages,
  Layers,
  Moon,
  Play,
  QrCode,
  RotateCcw,
  Scissors,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Sun,
  TrendingUp,
  Trophy,
  Zap,
} from 'lucide-react';
import type { PaletteCommand } from './components/CommandPalette';
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
import { STRESS_PRESETS } from './engine/localKernel';
import { downloadMarkdownFile, generatePostMortemMarkdown } from './engine/postMortemExporter';
import type {
  BurstSimulationResult,
  ChaosProfile,
  ConcurrencyMode,
  RagQueryResponse,
  SreDiagnosisResponse,
  StressPreset,
  ThemeMode,
} from './engine/types';
import {
  createInitialClusterState,
  cutRegionFiber,
  restoreAllRegions,
  toggleDbConnectionExhaustion,
  toggleRedisCacheStampede,
  toggleTailLatency180Ms,
  transferLeaderManually,
  type ClusterTopologyState,
  type RegionId,
} from './engines/chaosEngine';
import {
  simulateLoadStressProfile,
  type RuntimeProfilerMode,
} from './engines/loadProfilerEngine';
import {
  createInitialRunbookState,
  downloadUtf8BomFile,
  executeAllRemainingSteps,
  executeNextRunbookStep,
  executeRunbookStep,
  exportRunbookPostMortemJson,
  exportRunbookPostMortemMarkdown,
  type RunbookState,
  type RunbookStepId,
} from './engines/runbookEngine';
import { UI_COPY, type LangMode } from './i18n/translations';

// Code-split lazy modules so initial entry bundle stays lean and fast
const DstChaosArenaCanvas = lazy(() =>
  import('./components/DstChaosArenaCanvas').then((m) => ({ default: m.DstChaosArenaCanvas }))
);
const VoucherRaceArena = lazy(() =>
  import('./components/VoucherRaceArena').then((m) => ({ default: m.VoucherRaceArena }))
);
const RateLimiterLab = lazy(() =>
  import('./components/RateLimiterLab').then((m) => ({ default: m.RateLimiterLab }))
);
const SqlPlanAdvisorLab = lazy(() =>
  import('./components/SqlPlanAdvisorLab').then((m) => ({ default: m.SqlPlanAdvisorLab }))
);
const QuorumFailoverLab = lazy(() =>
  import('./components/QuorumFailoverLab').then((m) => ({ default: m.QuorumFailoverLab }))
);
const MultiRegionRaftDeck = lazy(() =>
  import('./components/MultiRegionRaftDeck').then((m) => ({ default: m.MultiRegionRaftDeck }))
);
const LoadStressFlamegraph = lazy(() =>
  import('./components/LoadStressFlamegraph').then((m) => ({ default: m.LoadStressFlamegraph }))
);
const IncidentRunbookExecutor = lazy(() =>
  import('./components/IncidentRunbookExecutor').then((m) => ({ default: m.IncidentRunbookExecutor }))
);
const LivePacketTopologyCanvas = lazy(() =>
  import('./components/LivePacketTopologyCanvas').then((m) => ({ default: m.LivePacketTopologyCanvas }))
);
const EngineRaceArena = lazy(() =>
  import('./components/EngineRaceArena').then((m) => ({ default: m.EngineRaceArena }))
);
const HybridRagPlayground = lazy(() =>
  import('./components/HybridRagPlayground').then((m) => ({ default: m.HybridRagPlayground }))
);
const TraceWaterfallPanel = lazy(() =>
  import('./components/TraceWaterfallPanel').then((m) => ({ default: m.TraceWaterfallPanel }))
);
const CommandPalette = lazy(() =>
  import('./components/CommandPalette').then((m) => ({ default: m.CommandPalette }))
);
const EnterpriseLicenseModal = lazy(() =>
  import('./components/EnterpriseLicenseModal').then((m) => ({ default: m.EnterpriseLicenseModal }))
);

const DEFAULT_RAG_QUERY =
  'How to prevent flash-sale voucher double-spending and negative stock with Redis Lua and RowVersion?';

type ActiveTab =
  | 'dst-arena'
  | 'voucher'
  | 'ratelimit'
  | 'sql-plan'
  | 'quorum'
  | 'raft'
  | 'arena'
  | 'sre-rag'
  | 'traces'
  | 'benchmarks'
  | 'roi';

const SECONDARY_TAB_IDS: ReadonlySet<ActiveTab> = new Set([
  'raft',
  'arena',
  'sre-rag',
  'traces',
  'benchmarks',
  'roi',
]);

function ModuleLoadingFallback({ label }: { label: string }) {
  return (
    <div className="surface-panel flex items-center justify-center rounded-2xl border p-8 font-mono text-xs text-dim">
      <span>Loading {label}...</span>
    </div>
  );
}

const ZERO_CHAOS: ChaosProfile = {
  injectedDbLatencyMs: 0,
  failureRatePercent: 0,
  forceCircuitOpen: false,
  cacheStampedeActive: false,
};

function readInitialTheme(): ThemeMode {
  if (typeof window === 'undefined') return 'dark';
  try {
    const stored = window.localStorage.getItem('aegispulse-theme');
    if (stored === 'light' || stored === 'dark') return stored;
  } catch {
    // Ignore storage read errors in restricted contexts
  }
  return 'dark';
}

function readInitialLang(): LangMode {
  if (typeof window === 'undefined') return 'en';
  try {
    const stored = window.localStorage.getItem('aegispulse-lang');
    if (stored === 'vi' || stored === 'en') return stored;
  } catch {
    // Ignore storage read errors
  }
  return 'en';
}

export function App() {
  const [activeTab, setActiveTab] = useState<ActiveTab>('dst-arena');
  const [theme, setTheme] = useState<ThemeMode>(readInitialTheme);
  const [lang, setLang] = useState<LangMode>(readInitialLang);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [licenseModalOpen, setLicenseModalOpen] = useState(false);
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);
  const moreMenuRef = useRef<HTMLDivElement | null>(null);

  // v3.0 Global Raft Quorum, Load Stress & Incident Runbook State
  const [cluster, setCluster] = useState<ClusterTopologyState>(() => createInitialClusterState());
  const [stressRps, setStressRps] = useState<number>(85000);
  const [profilerRuntime, setProfilerRuntime] = useState<RuntimeProfilerMode>('dotnet10');
  const [runbook, setRunbook] = useState<RunbookState>(() => createInitialRunbookState());

  const loadProfile = useMemo(
    () => simulateLoadStressProfile(stressRps, profilerRuntime, cluster),
    [stressRps, profilerRuntime, cluster]
  );

  const uiCopy = UI_COPY[lang];

  const [conn, setConn] = useState<BackendConnectionState>({
    dotnetLive: false,
    pythonLive: false,
    modeLabel: 'EDGE KERNEL · 0ms COLD-START',
  });

  // Tab 1: Concurrency & Chaos Arena State
  const [mode, setMode] = useState<ConcurrencyMode>('AegisLockFreeChannel');
  const [concurrentReqs, setConcurrentReqs] = useState<number>(4000);
  const [initialStock, setInitialStock] = useState<number>(500);
  const [dupRatio, setDupRatio] = useState<number>(0.2);
  const [activePresetId, setActivePresetId] = useState<string | null>(null);
  const [chaos, setChaos] = useState<ChaosProfile>(ZERO_CHAOS);
  const [isSimulating, setIsSimulating] = useState<boolean>(false);
  const [simResult, setSimResult] = useState<BurstSimulationResult | null>(null);
  const [showdownResults, setShowdownResults] = useState<BurstSimulationResult[] | null>(null);

  // Tab 4: SRE Agent & Hybrid RAG State
  const [diagnosis, setDiagnosis] = useState<SreDiagnosisResponse | null>(null);
  const [ragQuery, setRagQuery] = useState<string>(DEFAULT_RAG_QUERY);
  const [ragAlpha, setRagAlpha] = useState<number>(0.5);
  const [ragResult, setRagResult] = useState<RagQueryResponse | null>(null);

  // Tab 4: Code Vault State
  const [selectedCodeId, setSelectedCodeId] = useState<string>(POLYGLOT_CODE_VAULT[0].id);

  // Tab 5: Executive ROI State
  const [roiPeakRps, setRoiPeakRps] = useState<number>(5000);
  const [roiAovUsd, setRoiAovUsd] = useState<number>(48);
  const [roiCurrentP99Ms, setRoiCurrentP99Ms] = useState<number>(680);

  // Sync theme attribute to <html> + localStorage
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    try {
      window.localStorage.setItem('aegispulse-theme', theme);
    } catch {
      // Ignore storage failures
    }
  }, [theme]);

  // Sync language preference to <html lang> + localStorage
  useEffect(() => {
    document.documentElement.setAttribute('lang', lang);
    try {
      window.localStorage.setItem('aegispulse-lang', lang);
    } catch {
      // Ignore storage failures
    }
  }, [lang]);

  // Global Cmd+K / Ctrl+K shortcut for Command Palette + Escape to close More menu
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen((prev) => !prev);
      } else if (e.key === 'Escape') {
        setMoreMenuOpen(false);
      }
    }
    function handleOutsideClick(e: MouseEvent) {
      if (moreMenuRef.current && !moreMenuRef.current.contains(e.target as Node)) {
        setMoreMenuOpen(false);
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    document.addEventListener('mousedown', handleOutsideClick);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('mousedown', handleOutsideClick);
    };
  }, []);

  // Initial Polyglot Discovery + Baseline Burst + 3-Engine Race + RAG Warmup
  useEffect(() => {
    let mounted = true;
    (async () => {
      const detected = await detectPolyglotBackends();
      if (!mounted) return;
      setConn(detected);

      const modes: ConcurrencyMode[] = ['NaiveUnprotected', 'OptimisticCas', 'AegisLockFreeChannel'];
      const baselineRuns: BurstSimulationResult[] = [];
      for (const m of modes) {
        baselineRuns.push(await executeBurst(m, 4000, 500, 0.2, ZERO_CHAOS, detected.dotnetLive));
      }
      if (!mounted) return;

      const primaryRun = baselineRuns[2];
      setShowdownResults(baselineRuns);
      setSimResult(primaryRun);

      const [initDiag, initRag] = await Promise.all([
        executeSreDiagnosis(primaryRun.snapshot, primaryRun.throughputRps, detected.pythonLive),
        executeHybridRagSearch(DEFAULT_RAG_QUERY, detected.pythonLive, 0.5),
      ]);
      if (!mounted) return;
      setDiagnosis(initDiag);
      setRagResult(initRag);
    })();
    return () => {
      mounted = false;
    };
  }, []);

  const handleRunBurst = useCallback(
    async (
      overrideMode?: ConcurrencyMode,
      overrideParams?: {
        reqs?: number;
        stock?: number;
        dup?: number;
        chaosProfile?: ChaosProfile;
      }
    ) => {
      const targetMode = overrideMode ?? mode;
      const targetReqs = overrideParams?.reqs ?? concurrentReqs;
      const targetStock = overrideParams?.stock ?? initialStock;
      const targetDup = overrideParams?.dup ?? dupRatio;
      const targetChaos = overrideParams?.chaosProfile ?? chaos;

      if (overrideMode) setMode(overrideMode);
      setIsSimulating(true);
      try {
        const res = await executeBurst(
          targetMode,
          targetReqs,
          targetStock,
          targetDup,
          targetChaos,
          conn.dotnetLive
        );
        setSimResult(res);
        const diag = await executeSreDiagnosis(res.snapshot, res.throughputRps, conn.pythonLive);
        setDiagnosis(diag);
      } finally {
        setIsSimulating(false);
      }
    },
    [mode, concurrentReqs, initialStock, dupRatio, chaos, conn.dotnetLive, conn.pythonLive]
  );

  const handleThreeModeShowdown = useCallback(
    async (overrideParams?: {
      reqs?: number;
      stock?: number;
      dup?: number;
      chaosProfile?: ChaosProfile;
    }) => {
      const targetReqs = overrideParams?.reqs ?? concurrentReqs;
      const targetStock = overrideParams?.stock ?? initialStock;
      const targetDup = overrideParams?.dup ?? dupRatio;
      const targetChaos = overrideParams?.chaosProfile ?? chaos;

      setIsSimulating(true);
      try {
        const modes: ConcurrencyMode[] = ['NaiveUnprotected', 'OptimisticCas', 'AegisLockFreeChannel'];
        const runs: BurstSimulationResult[] = [];
        for (const m of modes) {
          runs.push(
            await executeBurst(m, targetReqs, targetStock, targetDup, targetChaos, conn.dotnetLive)
          );
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
    },
    [concurrentReqs, initialStock, dupRatio, chaos, conn.dotnetLive, conn.pythonLive]
  );

  const handleApplyStressPreset = useCallback(
    async (preset: StressPreset) => {
      setActivePresetId(preset.id);
      setConcurrentReqs(preset.concurrentRequests);
      setInitialStock(preset.initialStock);
      setDupRatio(preset.duplicateReplayRatio);
      setChaos(preset.chaos);
      setMode(preset.recommendedMode);
      setActiveTab('arena');
      await handleThreeModeShowdown({
        reqs: preset.concurrentRequests,
        stock: preset.initialStock,
        dup: preset.duplicateReplayRatio,
        chaosProfile: preset.chaos,
      });
    },
    [handleThreeModeShowdown]
  );

  const handleInspectEngineResult = useCallback(
    async (result: BurstSimulationResult) => {
      setMode(result.mode);
      setSimResult(result);
      const diag = await executeSreDiagnosis(result.snapshot, result.throughputRps, conn.pythonLive);
      setDiagnosis(diag);
    },
    [conn.pythonLive]
  );

  const handleRagSearch = useCallback(
    async (customQuery?: string, overrideAlpha?: number) => {
      const q = customQuery ?? ragQuery;
      const a = overrideAlpha ?? ragAlpha;
      setRagQuery(q);
      if (overrideAlpha !== undefined) setRagAlpha(overrideAlpha);
      const res = await executeHybridRagSearch(q, conn.pythonLive, a);
      setRagResult(res);
    },
    [ragQuery, ragAlpha, conn.pythonLive]
  );

  const handlePresetIncident = useCallback(
    async (preset: 'oversell' | 'stampede' | 'circuit') => {
      let nextMode: ConcurrencyMode = 'AegisLockFreeChannel';
      let nextChaos: ChaosProfile = { ...ZERO_CHAOS };
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
      setActivePresetId(null);
      const res = await executeBurst(
        nextMode,
        concurrentReqs,
        initialStock,
        dupRatio,
        nextChaos,
        conn.dotnetLive
      );
      setSimResult(res);
      const diag = await executeSreDiagnosis(res.snapshot, res.throughputRps, conn.pythonLive);
      setDiagnosis(diag);
      setActiveTab('sre-rag');
    },
    [concurrentReqs, initialStock, dupRatio, conn.dotnetLive, conn.pythonLive]
  );

  const buildPostMortem = useCallback(() => {
    return generatePostMortemMarkdown({
      simResult,
      showdownResults,
      diagnosis,
      ragResult,
      alpha: ragAlpha,
      runtimeModeLabel: conn.modeLabel,
    });
  }, [simResult, showdownResults, diagnosis, ragResult, ragAlpha, conn.modeLabel]);

  const handleExportPostMortem = useCallback(() => {
    const md = buildPostMortem();
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    downloadMarkdownFile(`aegispulse-postmortem-${stamp}.md`, md);
  }, [buildPostMortem]);

  const handleCopyPostMortem = useCallback(async () => {
    const md = buildPostMortem();
    try {
      await navigator.clipboard.writeText(md);
      return true;
    } catch {
      return false;
    }
  }, [buildPostMortem]);

  const toggleTheme = useCallback(() => {
    setTheme((prev) => (prev === 'dark' ? 'light' : 'dark'));
  }, []);

  const toggleLang = useCallback(() => {
    setLang((prev) => (prev === 'en' ? 'vi' : 'en'));
  }, []);

  // v3.0 Multi-Region Raft Chaos Handlers
  const handleCutRegionFiber = useCallback((regionId: RegionId) => {
    setCluster((prev) => cutRegionFiber(prev, regionId));
  }, []);

  const handleToggleTailLatency = useCallback(() => {
    setCluster((prev) => toggleTailLatency180Ms(prev));
  }, []);

  const handleToggleRedisStampede = useCallback(() => {
    setCluster((prev) => toggleRedisCacheStampede(prev));
  }, []);

  const handleToggleDbExhaustion = useCallback(() => {
    setCluster((prev) => toggleDbConnectionExhaustion(prev));
  }, []);

  const handleRestoreAllRegions = useCallback(() => {
    setCluster((prev) => restoreAllRegions(prev));
  }, []);

  const handleTransferLeader = useCallback((regionId: RegionId) => {
    setCluster((prev) => transferLeaderManually(prev, regionId));
  }, []);

  // v3.0 SRE Incident Runbook Handlers (wired live to Chaos recovery)
  const applyRunbookRemediation = useCallback(
    (shouldRestoreCluster: boolean, shouldClearDbAndCacheFaults: boolean) => {
      if (shouldRestoreCluster) {
        setCluster((prev) => restoreAllRegions(prev));
      } else if (shouldClearDbAndCacheFaults) {
        setCluster((prev) => {
          let next = prev;
          if (next.faults.redisCacheStampede) next = toggleRedisCacheStampede(next);
          if (next.faults.dbConnectionExhaustion) next = toggleDbConnectionExhaustion(next);
          return next;
        });
      }
    },
    []
  );

  const handleExecuteRunbookStep = useCallback(
    (stepId: RunbookStepId) => {
      const res = executeRunbookStep(runbook, stepId, { cluster, loadProfile });
      setRunbook(res.nextState);
      applyRunbookRemediation(res.shouldRestoreCluster, res.shouldClearDbAndCacheFaults);
    },
    [runbook, cluster, loadProfile, applyRunbookRemediation]
  );

  const handleExecuteNextRunbook = useCallback(() => {
    const res = executeNextRunbookStep(runbook, { cluster, loadProfile });
    setRunbook(res.nextState);
    applyRunbookRemediation(res.shouldRestoreCluster, res.shouldClearDbAndCacheFaults);
  }, [runbook, cluster, loadProfile, applyRunbookRemediation]);

  const handleExecuteAllRunbook = useCallback(() => {
    const res = executeAllRemainingSteps(runbook, { cluster, loadProfile });
    setRunbook(res.nextState);
    applyRunbookRemediation(res.shouldRestoreCluster, res.shouldClearDbAndCacheFaults);
  }, [runbook, cluster, loadProfile, applyRunbookRemediation]);

  const handleResetRunbook = useCallback(() => {
    setRunbook(createInitialRunbookState());
  }, []);

  const handleExportRunbookMd = useCallback(() => {
    const md = exportRunbookPostMortemMarkdown(runbook, { cluster, loadProfile });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    downloadUtf8BomFile(`aegispulse-v3-runbook-${stamp}.md`, md, 'text/markdown');
  }, [runbook, cluster, loadProfile]);

  const handleExportRunbookJson = useCallback(() => {
    const json = exportRunbookPostMortemJson(runbook, { cluster, loadProfile });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    downloadUtf8BomFile(`aegispulse-v3-runbook-${stamp}.json`, json, 'application/json');
  }, [runbook, cluster, loadProfile]);

  // Command Palette registry
  const paletteCommands = useMemo<PaletteCommand[]>(
    () => [
      {
        id: 'nav-dst-arena',
        group: 'Navigation',
        title: 'DST Chaos-Scissors & Distributed Packet Arena (v7.0 Primary)',
        subtitle: 'Sever inter-region links, crash/revive servers, blast 500-req voucher storms & scrub Jepsen timeline',
        keywords: 'dst deterministic simulation chaos scissors split brain raft jepsen linearizability voucher storm v7',
        icon: Scissors,
        badge: activeTab === 'dst-arena' ? 'ACTIVE' : 'V7 NEW',
        active: activeTab === 'dst-arena',
        onExecute: () => setActiveTab('dst-arena'),
      },
      {
        id: 'nav-voucher',
        group: 'Navigation',
        title: 'Voucher 500x Race Arena (Con Cung Proof)',
        subtitle: '500 concurrent requests vs 1x 500K VND voucher: Naive leak vs UPDLOCK vs Redis Lua + ROWVERSION',
        keywords: 'voucher race 500 concung redis lua rowversion dapper double spend lock v4 v5 v6',
        icon: Banknote,
        badge: activeTab === 'voucher' ? 'ACTIVE' : 'CORE',
        active: activeTab === 'voucher',
        onExecute: () => setActiveTab('voucher'),
      },
      {
        id: 'nav-ratelimit',
        group: 'Navigation',
        title: 'Token-Bucket vs Sliding-Window Burst Rate-Limiter Lab (v6.0)',
        subtitle: '5,000 RPS flash-sale gateway: expose Fixed-Window 2x overshoot vs Token Bucket vs 0-overshoot Redis Sliding-Window',
        keywords: 'rate limiter token bucket sliding window fixed window 429 retry after backpressure burst spike v6',
        icon: Gauge,
        badge: activeTab === 'ratelimit' ? 'ACTIVE' : 'V6 NEW',
        active: activeTab === 'ratelimit',
        onExecute: () => setActiveTab('ratelimit'),
      },
      {
        id: 'nav-sql-plan',
        group: 'Navigation',
        title: 'SQL Server 5M-Row Execution Plan & Dapper Index Advisor',
        subtitle: 'Toggle EF Core Scan (28.4ms) -> Covering Index Dapper (1.8ms) -> Redis Lua (0.42ms)',
        keywords: 'sql server execution plan dapper covering index rowversion 5m rows logical reads v5',
        icon: Database,
        badge: activeTab === 'sql-plan' ? 'ACTIVE' : 'CORE',
        active: activeTab === 'sql-plan',
        onExecute: () => setActiveTab('sql-plan'),
      },
      {
        id: 'nav-quorum',
        group: 'Navigation',
        title: '5-Region Raft Quorum & Split-Brain Failover Lab',
        subtitle: 'Click VN-HCM / SG-1 / JP-Tokyo / US-East / EU-West to trigger leader election & READ_ONLY_FENCE',
        keywords: 'quorum raft failover split brain read only fence rpo rto wal lag v5',
        icon: ShieldCheck,
        badge: activeTab === 'quorum' ? 'ACTIVE' : 'CORE',
        active: activeTab === 'quorum',
        onExecute: () => setActiveTab('quorum'),
      },
      {
        id: 'nav-raft',
        group: 'Navigation',
        title: '4. Chaos Fault Plane & 250K RPS Flamegraph',
        subtitle: 'Global chaos injector, 250K RPS CPU/GC flamegraph & SRE runbook',
        keywords: 'raft quorum region fiber chaos load stress flamegraph runbook v3',
        icon: Globe,
        badge: activeTab === 'raft' ? 'ACTIVE' : 'TAB 4',
        active: activeTab === 'raft',
        onExecute: () => setActiveTab('raft'),
      },
      {
        id: 'nav-arena',
        group: 'Navigation',
        title: '3. Concurrency & Packet Arena',
        subtitle: '60fps packet pipeline, 3-engine race arena, latency histogram',
        keywords: 'arena pipeline topology histogram race burst',
        icon: Flame,
        badge: activeTab === 'arena' ? 'ACTIVE' : 'TAB 3',
        active: activeTab === 'arena',
        onExecute: () => setActiveTab('arena'),
      },
      {
        id: 'nav-sre-rag',
        group: 'Navigation',
        title: '4. Agentic SRE & Hybrid RAG Playground',
        subtitle: 'ReAct diagnostics, RRF alpha slider, OOD abstention, post-mortem export',
        keywords: 'rag bm25 vector alpha sre diagnosis postmortem',
        icon: Bot,
        badge: activeTab === 'sre-rag' ? 'ACTIVE' : 'TAB 4',
        active: activeTab === 'sre-rag',
        onExecute: () => setActiveTab('sre-rag'),
      },
      {
        id: 'nav-traces',
        group: 'Navigation',
        title: '5. OpenTelemetry Trace Waterfall',
        subtitle: 'Inspect W3C microsecond span Gantt charts & RFC 9457 payloads',
        keywords: 'otel traceparent spans waterfall gantt 409 429 503',
        icon: Activity,
        badge: activeTab === 'traces' ? 'ACTIVE' : 'TAB 5',
        active: activeTab === 'traces',
        onExecute: () => setActiveTab('traces'),
      },
      {
        id: 'nav-benchmarks',
        group: 'Navigation',
        title: '6. Verified CI Benchmarks & Polyglot Code Vault',
        subtitle: '.NET 10 release benchmarks, Python RAG evals, source code',
        keywords: 'ci benchmark dotnet python lua sql code vault',
        icon: FileCode2,
        badge: activeTab === 'benchmarks' ? 'ACTIVE' : 'TAB 6',
        active: activeTab === 'benchmarks',
        onExecute: () => setActiveTab('benchmarks'),
      },
      {
        id: 'nav-roi',
        group: 'Navigation',
        title: '7. Executive ROI & License Hub',
        subtitle: 'Flash-sale protection calculator, MBBank VietQR & architect dossier',
        keywords: 'roi calculator cv resume architect contact license vietqr',
        icon: TrendingUp,
        badge: activeTab === 'roi' ? 'ACTIVE' : 'TAB 7',
        active: activeTab === 'roi',
        onExecute: () => setActiveTab('roi'),
      },
      {
        id: 'open-enterprise-license',
        group: 'SRE & Appearance',
        title: 'Commission Enterprise License (22.900.000 VND · MBBank VietQR)',
        subtitle: 'Open live MBBank 970422 VietQR checkout & downloadable B2B quote',
        keywords: 'license price buy checkout vietqr mbbank enterprise quote',
        icon: QrCode,
        badge: '22.9M',
        onExecute: () => setLicenseModalOpen(true),
      },
      {
        id: 'toggle-lang',
        group: 'SRE & Appearance',
        title: `Switch Interface Language to ${lang === 'en' ? 'Vietnamese (VI)' : 'English (EN)'}`,
        subtitle: 'Toggle bilingual EN / VI Mission Control copy',
        keywords: 'language english vietnamese vi en i18n',
        icon: Languages,
        badge: lang === 'en' ? 'VI' : 'EN',
        onExecute: toggleLang,
      },
      {
        id: 'race-all-3',
        group: 'Concurrency & Presets',
        title: 'Race All 3 Engines (Side-by-Side)',
        subtitle: 'Compare Naive Read-Write vs RowVersion CAS vs Aegis Lock-Free',
        keywords: 'race showdown compare benchmark all engines',
        icon: Trophy,
        badge: 'RACE',
        onExecute: () => {
          setActiveTab('arena');
          void handleThreeModeShowdown();
        },
      },
      {
        id: 'run-naive-leak',
        group: 'Concurrency & Presets',
        title: 'Trigger Naive Read-Write Double-Spend Leak',
        subtitle: 'Demonstrate TOCTOU overselling crimson packets on live canvas',
        keywords: 'naive leak oversell toctou crimson double spend',
        icon: ShieldAlert,
        badge: 'ANTI-PATTERN',
        onExecute: () => {
          setActiveTab('arena');
          void handleRunBurst('NaiveUnprotected');
        },
      },
      ...STRESS_PRESETS.map((p) => ({
        id: `preset-${p.id}`,
        group: 'Concurrency & Presets' as const,
        title: `Preset: ${p.label}`,
        subtitle: p.subtitle,
        keywords: `preset stress ${p.label} ${p.subtitle}`,
        icon: Zap,
        badge: `${(p.concurrentRequests / 1000).toFixed(1)}K`,
        active: activePresetId === p.id,
        onExecute: () => {
          void handleApplyStressPreset(p);
        },
      })),
      {
        id: 'chaos-db-lag',
        group: 'Chaos Faults',
        title: 'Toggle +35ms SQL Lock Contention Delay',
        subtitle: 'Inject simulated row-lock latency into database write paths',
        keywords: 'chaos sql latency lock delay',
        icon: AlertTriangle,
        badge: chaos.injectedDbLatencyMs > 0 ? 'ON' : 'OFF',
        active: chaos.injectedDbLatencyMs > 0,
        onExecute: () => {
          const next = { ...chaos, injectedDbLatencyMs: chaos.injectedDbLatencyMs > 0 ? 0 : 35 };
          setChaos(next);
          void handleRunBurst(undefined, { chaosProfile: next });
        },
      },
      {
        id: 'chaos-stampede',
        group: 'Chaos Faults',
        title: 'Toggle Hot-SKU Redis Cache Stampede',
        subtitle: 'Simulate thundering herd cache miss pressure',
        keywords: 'chaos cache stampede redis herd',
        icon: Flame,
        badge: chaos.cacheStampedeActive ? 'ON' : 'OFF',
        active: chaos.cacheStampedeActive,
        onExecute: () => {
          const next = { ...chaos, cacheStampedeActive: !chaos.cacheStampedeActive };
          setChaos(next);
          void handleRunBurst(undefined, { chaosProfile: next });
        },
      },
      {
        id: 'chaos-circuit',
        group: 'Chaos Faults',
        title: 'Toggle Force Adaptive Circuit Breaker OPEN (503)',
        subtitle: 'Activate immediate 503 fast-fail shedding across Stage 4',
        keywords: 'chaos circuit breaker 503 open polly',
        icon: ShieldAlert,
        badge: chaos.forceCircuitOpen ? 'OPEN' : 'CLOSED',
        active: chaos.forceCircuitOpen,
        onExecute: () => {
          const next = { ...chaos, forceCircuitOpen: !chaos.forceCircuitOpen };
          setChaos(next);
          void handleRunBurst(undefined, { chaosProfile: next });
        },
      },
      {
        id: 'chaos-clear',
        group: 'Chaos Faults',
        title: 'Reset All Chaos Faults to Nominal',
        subtitle: 'Clear DB lag, cache stampede, storage errors, and circuit trip',
        keywords: 'chaos reset clear clean nominal',
        icon: RotateCcw,
        onExecute: () => {
          setChaos(ZERO_CHAOS);
          void handleRunBurst(undefined, { chaosProfile: ZERO_CHAOS });
        },
      },
      {
        id: 'export-postmortem',
        group: 'SRE & Appearance',
        title: 'Export SRE Incident Post-Mortem (.md)',
        subtitle: 'Download full Markdown report with invariant audit, race results & RAG citations',
        keywords: 'export download markdown postmortem report sre',
        icon: Download,
        badge: '.MD',
        onExecute: handleExportPostMortem,
      },
      {
        id: 'toggle-theme',
        group: 'SRE & Appearance',
        title: `Switch to ${theme === 'dark' ? 'Daylight Studio Light' : 'Obsidian Telemetry Dark'} Theme`,
        subtitle: 'Toggle high-contrast Obsidian Dark / Daylight Studio appearance',
        keywords: 'theme dark light obsidian daylight studio mode appearance',
        icon: theme === 'dark' ? Sun : Moon,
        badge: theme === 'dark' ? 'LIGHT' : 'DARK',
        onExecute: toggleTheme,
      },
    ],
    [
      activeTab,
      activePresetId,
      chaos,
      theme,
      lang,
      handleThreeModeShowdown,
      handleRunBurst,
      handleApplyStressPreset,
      handleExportPostMortem,
      toggleTheme,
      toggleLang,
    ]
  );

  const snap = simResult?.snapshot;
  const isBreach = snap ? !snap.invariantIntact || snap.overAllocatedUnits > 0 : false;

  // Executive ROI Math
  const latencyDropFactor = Math.max(0, (roiCurrentP99Ms - 18) / 100);
  const conversionLiftPct = Number(Math.min(18.5, latencyDropFactor * 1.15).toFixed(1));
  const monthlyProtectedFlashRevenue = Math.round(roiPeakRps * 0.032 * roiAovUsd * 4);
  const annualEngineeringRoiUsd = Math.round(monthlyProtectedFlashRevenue * 12 + roiPeakRps * 2.8);

  return (
    <div className="min-h-screen pb-16">
      {/* Command Palette Modal (Cmd/Ctrl+K) — Lazy Loaded */}
      {paletteOpen && (
        <Suspense fallback={null}>
          <CommandPalette
            open={paletteOpen}
            onClose={() => setPaletteOpen(false)}
            commands={paletteCommands}
          />
        </Suspense>
      )}

      {/* Enterprise License Quote & Live MBBank VietQR Checkout Modal — Lazy Loaded */}
      {licenseModalOpen && (
        <Suspense fallback={null}>
          <EnterpriseLicenseModal
            open={licenseModalOpen}
            lang={lang}
            onClose={() => setLicenseModalOpen(false)}
          />
        </Suspense>
      )}

      {/* Top Command Header — Datadog / Cloudflare Radar / Linear Visual Ergonomics */}
      <header className="surface-header sticky top-0 z-30 border-b backdrop-blur-md">
        <div className="mx-auto flex max-w-7xl flex-col gap-3 px-4 py-3 sm:px-6 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-cyan-500/35 bg-cyan-500/10 text-cyan-600 shadow-[0_0_20px_rgba(6,182,212,0.14)] dark:text-cyan-300">
              <Zap className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[15px] font-extrabold tracking-tight text-heading">
                  AegisPulse
                </span>
                <span
                  data-testid="version-badge"
                  className="rounded-md border border-cyan-500/35 bg-cyan-500/10 px-2 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wider text-cyan-700 dark:text-cyan-300"
                >
                  {uiCopy.versionBadge}
                </span>
              </div>
              <p className="truncate text-[11.5px] text-dim">{uiCopy.headerSubtitle}</p>
            </div>
          </div>

          <div className="flex shrink-0 flex-wrap items-center gap-1.5 sm:gap-2">
            {/* Command Palette Trigger */}
            <button
              type="button"
              data-testid="btn-command-palette"
              onClick={() => setPaletteOpen(true)}
              className="surface-chip inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 font-mono text-[11px] font-medium text-dim transition hover:border-cyan-500/60 hover:text-heading"
              aria-label="Open Command Palette"
            >
              <Command className="h-3.5 w-3.5 text-cyan-500" />
              <span className="hidden md:inline">{uiCopy.commandsBtn}</span>
              <kbd className="rounded border border-slate-400/30 px-1 py-0.2 text-[10px] text-faint">
                ⌘K
              </kbd>
            </button>

            {/* Bilingual EN / VI Toggle */}
            <button
              type="button"
              data-testid="btn-lang-toggle"
              onClick={toggleLang}
              className="surface-chip inline-flex items-center gap-1 rounded-lg border px-2.5 py-1.5 font-mono text-[11px] font-semibold text-body transition hover:border-cyan-500/60 hover:text-heading"
              aria-label={`Switch language to ${lang === 'en' ? 'Vietnamese' : 'English'}`}
            >
              <Languages className="h-3.5 w-3.5 text-cyan-500" />
              <span>{lang.toUpperCase()}</span>
            </button>

            {/* Obsidian Dark / Crisp Daylight Theme Toggle */}
            <button
              type="button"
              data-testid="btn-theme-toggle"
              onClick={toggleTheme}
              className="surface-chip inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 font-mono text-[11px] font-semibold text-body transition hover:border-cyan-500/60 hover:text-heading"
              aria-label={`Switch to ${theme === 'dark' ? 'Daylight Studio Light' : 'Obsidian Dark'} theme`}
            >
              {theme === 'dark' ? (
                <>
                  <Sun className="h-3.5 w-3.5 text-amber-400" />
                  <span className="hidden lg:inline">Daylight</span>
                </>
              ) : (
                <>
                  <Moon className="h-3.5 w-3.5 text-cyan-600" />
                  <span className="hidden lg:inline">Obsidian</span>
                </>
              )}
            </button>

            <a
              href="https://github.com/tvt987/aegispulse-distributed-sre"
              target="_blank"
              rel="noreferrer"
              className="surface-chip hidden items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11.5px] font-semibold text-body transition hover:border-cyan-500/60 hover:text-heading lg:inline-flex"
            >
              <GitBranch className="h-3.5 w-3.5" />
              <span>{uiCopy.githubBtn}</span>
              <ExternalLink className="h-3 w-3 opacity-70" />
            </a>

            <span className="hidden h-5 w-px bg-slate-500/20 sm:block" aria-hidden="true" />

            {/* Enterprise License & MBBank VietQR CTA */}
            <button
              type="button"
              data-testid="btn-enterprise-license"
              onClick={() => setLicenseModalOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-cyan-500 to-emerald-500 px-3 py-1.5 font-mono text-[11px] font-extrabold text-slate-950 shadow-sm shadow-cyan-500/20 transition hover:brightness-110"
            >
              <QrCode className="h-3.5 w-3.5 shrink-0" />
              <span className="sm:hidden">{uiCopy.licenseBtnShort}</span>
              <span className="hidden sm:inline">{uiCopy.licenseBtn}</span>
            </button>
          </div>
        </div>

        {/* Streamlined Workspace Navigation Rail: 5 Core Flagship Labs + Hairline + More Suites Popover */}
        <div className="border-t border-hairline">
          <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 py-2 sm:px-6">
            <div className="flex min-w-0 flex-1 items-center gap-2.5">
              <nav
                className="surface-inset no-scrollbar flex min-w-0 items-center gap-1 overflow-x-auto rounded-xl border p-1"
                aria-label="Primary Flagship Labs"
              >
                {[
                  { id: 'dst-arena' as ActiveTab, label: uiCopy.tabs.dstArena, icon: Scissors, badge: 'v7' },
                  { id: 'voucher' as ActiveTab, label: uiCopy.tabs.voucher, icon: Banknote, badge: null },
                  { id: 'ratelimit' as ActiveTab, label: uiCopy.tabs.ratelimit, icon: Gauge, badge: null },
                  { id: 'sql-plan' as ActiveTab, label: uiCopy.tabs.sqlPlan, icon: Database, badge: null },
                  { id: 'quorum' as ActiveTab, label: uiCopy.tabs.quorum, icon: ShieldCheck, badge: null },
                ].map((tab) => {
                  const Icon = tab.icon;
                  const isActive = activeTab === tab.id;
                  return (
                    <button
                      key={tab.id}
                      type="button"
                      data-testid={`tab-${tab.id}`}
                      onClick={() => {
                        setActiveTab(tab.id);
                        setMoreMenuOpen(false);
                      }}
                      className={`inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                        isActive
                          ? 'bg-cyan-500/15 text-cyan-700 shadow-xs ring-1 ring-cyan-500/45 dark:bg-cyan-400/14 dark:text-cyan-200'
                          : 'text-dim hover:bg-slate-500/10 hover:text-heading'
                      }`}
                    >
                      <Icon className="h-3.5 w-3.5 shrink-0" />
                      <span>{tab.label}</span>
                      {tab.badge && (
                        <span className="rounded bg-cyan-500/20 px-1.5 py-0.2 font-mono text-[9.5px] font-bold uppercase text-cyan-700 dark:text-cyan-300">
                          {tab.badge}
                        </span>
                      )}
                    </button>
                  );
                })}
              </nav>

              <span className="hidden h-5 w-px shrink-0 bg-slate-500/20 md:block" aria-hidden="true" />

              {/* Secondary Telemetry & Proof Suites Menu */}
              <div ref={moreMenuRef} className="relative shrink-0">
                <button
                  type="button"
                  data-testid="btn-more-labs"
                  aria-expanded={moreMenuOpen}
                  onClick={() => setMoreMenuOpen((prev) => !prev)}
                  className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-xl border px-3 py-2 text-xs font-semibold transition ${
                    SECONDARY_TAB_IDS.has(activeTab)
                      ? 'border-cyan-500/50 bg-cyan-500/14 text-cyan-700 dark:text-cyan-200'
                      : 'surface-chip text-dim hover:border-cyan-500/45 hover:text-heading'
                  }`}
                >
                  <Layers className="h-3.5 w-3.5 shrink-0 text-cyan-500" />
                  <span className="hidden sm:inline">
                    {activeTab === 'raft'
                      ? uiCopy.tabs.raft
                      : activeTab === 'arena'
                        ? uiCopy.tabs.arena
                        : activeTab === 'sre-rag'
                          ? uiCopy.tabs.sreRag
                          : activeTab === 'traces'
                            ? uiCopy.tabs.traces
                            : activeTab === 'benchmarks'
                              ? uiCopy.tabs.benchmarks
                              : activeTab === 'roi'
                                ? uiCopy.tabs.roi
                                : uiCopy.moreLabsBtn}
                  </span>
                  <span className="sm:hidden">More</span>
                  <ChevronDown
                    className={`h-3.5 w-3.5 transition-transform ${moreMenuOpen ? 'rotate-180' : ''}`}
                  />
                </button>

                {moreMenuOpen && (
                  <div
                    data-testid="more-labs-menu"
                    role="menu"
                    aria-label="Additional SRE and Telemetry Suites"
                    className="surface-panel absolute right-0 z-40 mt-2 w-60 rounded-xl border p-1.5 shadow-2xl"
                  >
                    <div className="px-2.5 py-1.5 font-mono text-[10px] font-bold uppercase tracking-wider text-faint">
                      Telemetry, RAG &amp; Executive Suites
                    </div>
                    {[
                      { id: 'raft' as ActiveTab, label: uiCopy.tabs.raft, icon: Globe },
                      { id: 'arena' as ActiveTab, label: uiCopy.tabs.arena, icon: Flame },
                      { id: 'sre-rag' as ActiveTab, label: uiCopy.tabs.sreRag, icon: Bot },
                      { id: 'traces' as ActiveTab, label: uiCopy.tabs.traces, icon: Activity },
                      { id: 'benchmarks' as ActiveTab, label: uiCopy.tabs.benchmarks, icon: FileCode2 },
                      { id: 'roi' as ActiveTab, label: uiCopy.tabs.roi, icon: TrendingUp },
                    ].map((item) => {
                      const Icon = item.icon;
                      const isActive = activeTab === item.id;
                      return (
                        <button
                          key={item.id}
                          type="button"
                          role="menuitem"
                          data-testid={`tab-${item.id}`}
                          onClick={() => {
                            setActiveTab(item.id);
                            setMoreMenuOpen(false);
                          }}
                          className={`flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-left text-xs font-semibold transition ${
                            isActive
                              ? 'bg-cyan-500/15 text-cyan-700 dark:text-cyan-200'
                              : 'text-body hover:bg-slate-500/10 hover:text-heading'
                          }`}
                        >
                          <span className="flex items-center gap-2">
                            <Icon className="h-3.5 w-3.5 shrink-0 text-cyan-500" />
                            <span>{item.label}</span>
                          </span>
                          {isActive && (
                            <span className="h-1.5 w-1.5 rounded-full bg-cyan-500" />
                          )}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            {/* Subtle Executive Live Proof Indicator on Desktop */}
            <div className="hidden shrink-0 items-center gap-2 rounded-full border border-emerald-500/25 bg-emerald-500/[0.07] px-3 py-1 font-mono text-[10.5px] font-semibold text-emerald-700 xl:inline-flex dark:text-emerald-300">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
              <span>700+ Stores · 5,000+ RPS · 0.00% Leak</span>
            </div>
          </div>
        </div>
      </header>

      <main className="mx-auto mt-3.5 max-w-7xl px-4 sm:mt-4 sm:px-6">
        {/* PRIMARY HERO STAGE (v7.0): DETERMINISTIC SIMULATION TESTING (DST) & INTERACTIVE CHAOS-SCISSORS ARENA */}
        {activeTab === 'dst-arena' && (
          <Suspense fallback={<ModuleLoadingFallback label="v7.0 DST Chaos-Scissors Distributed Packet Arena" />}>
            <DstChaosArenaCanvas
              lang={lang}
              theme={theme}
              onOpenVoucherLab={() => setActiveTab('voucher')}
            />
          </Suspense>
        )}

        {/* TAB 2: CON CUNG 500-REQUEST VOUCHER RACE-CONDITION SIMULATOR */}
        {activeTab === 'voucher' && (
          <Suspense fallback={<ModuleLoadingFallback label="Con Cung 500-Request Voucher Race Arena" />}>
            <VoucherRaceArena
              lang={lang}
              onOpenRateLimiter={() => setActiveTab('ratelimit')}
            />
          </Suspense>
        )}

        {/* TAB 2 (NEW v6.0): TOKEN-BUCKET VS SLIDING-WINDOW BURST RATE-LIMITER LAB */}
        {activeTab === 'ratelimit' && (
          <Suspense fallback={<ModuleLoadingFallback label="Token-Bucket vs Sliding-Window Burst Rate-Limiter Lab" />}>
            <RateLimiterLab lang={lang} theme={theme} />
          </Suspense>
        )}

        {/* TAB 2 (NEW v5.0): 5M-ROW SQL SERVER EXECUTION PLAN & DAPPER INDEX ADVISOR */}
        {activeTab === 'sql-plan' && (
          <Suspense fallback={<ModuleLoadingFallback label="SQL Server Execution Plan & Dapper Index Advisor" />}>
            <SqlPlanAdvisorLab lang={lang} theme={theme} />
          </Suspense>
        )}

        {/* TAB 3 (NEW v5.0): 5-REGION RAFT QUORUM & SPLIT-BRAIN FAILOVER LAB */}
        {activeTab === 'quorum' && (
          <Suspense fallback={<ModuleLoadingFallback label="5-Region Raft Quorum & Split-Brain Failover Lab" />}>
            <QuorumFailoverLab lang={lang} theme={theme} />
          </Suspense>
        )}

        {/* TAB 4: GLOBAL 5-REGION RAFT CHAOS + 250K RPS FLAMEGRAPH + SRE RUNBOOK */}
        {activeTab === 'raft' && (
          <div className="space-y-6">
            <Suspense fallback={<ModuleLoadingFallback label="5-Region Raft & Chaos Control Deck" />}>
              <MultiRegionRaftDeck
                cluster={cluster}
                lang={lang}
                theme={theme}
                onCutRegionFiber={handleCutRegionFiber}
                onToggleTailLatency={handleToggleTailLatency}
                onToggleRedisStampede={handleToggleRedisStampede}
                onToggleDbExhaustion={handleToggleDbExhaustion}
                onRestoreAll={handleRestoreAllRegions}
                onTransferLeader={handleTransferLeader}
              />
            </Suspense>

            <Suspense fallback={<ModuleLoadingFallback label="250K RPS Load Stress Flamegraph" />}>
              <LoadStressFlamegraph
                telemetry={loadProfile}
                targetRps={stressRps}
                runtime={profilerRuntime}
                lang={lang}
                theme={theme}
                onTargetRpsChange={setStressRps}
                onRuntimeChange={setProfilerRuntime}
              />
            </Suspense>

            <Suspense fallback={<ModuleLoadingFallback label="SRE Incident Runbook Executor" />}>
              <IncidentRunbookExecutor
                runbook={runbook}
                currentLiveP99Ms={loadProfile.p99Ms}
                lang={lang}
                onExecuteStep={handleExecuteRunbookStep}
                onExecuteNext={handleExecuteNextRunbook}
                onExecuteAll={handleExecuteAllRunbook}
                onReset={handleResetRunbook}
                onExportMarkdown={handleExportRunbookMd}
                onExportJson={handleExportRunbookJson}
              />
            </Suspense>
          </div>
        )}

        {/* TAB 2: CONCURRENCY & PACKET ARENA (v2.0 60FPS ENGINE PRESERVED) */}
        {activeTab === 'arena' && snap && simResult && (
          <div className="space-y-5">
            {/* Invariant Proof Hero Banner */}
            <div
              data-testid="invariant-banner"
              className={`flex flex-wrap items-center justify-between gap-4 rounded-2xl border p-5 ${
                isBreach
                  ? 'border-rose-500/50 bg-gradient-to-r from-rose-500/15 via-rose-500/[0.05] to-transparent dark:from-rose-950/60 dark:via-[#0d1222] dark:to-[#091020]'
                  : 'border-emerald-500/40 bg-gradient-to-r from-emerald-500/12 via-emerald-500/[0.04] to-transparent dark:from-emerald-950/40 dark:via-[#0b1324] dark:to-[#091020]'
              }`}
            >
              <div className="flex items-start gap-3.5">
                {isBreach ? (
                  <ShieldAlert className="mt-0.5 h-8 w-8 shrink-0 text-rose-500 dark:text-rose-400" />
                ) : (
                  <ShieldCheck className="mt-0.5 h-8 w-8 shrink-0 text-emerald-600 dark:text-emerald-400" />
                )}
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={`rounded px-2 py-0.5 font-mono text-xs font-bold uppercase ${
                        isBreach
                          ? 'bg-rose-500/20 text-rose-700 dark:text-rose-300'
                          : 'bg-emerald-500/20 text-emerald-700 dark:text-emerald-300'
                      }`}
                    >
                      {isBreach
                        ? 'SEV-1 INVARIANT BREACHED (DOUBLE-SPEND LEAK)'
                        : 'ZERO-DOUBLE-SPEND INVARIANT VERIFIED'}
                    </span>
                    <span className="font-mono text-xs text-dim">
                      Engine: {simResult.mode} · {simResult.throughputRps.toLocaleString()} RPS
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-body">
                    {isBreach ? (
                      <>
                        Naive Read-Then-Write allocated{' '}
                        <strong className="text-heading">{snap.totalUnitsAllocated}</strong> units against a cap of{' '}
                        <strong className="text-heading">{snap.initialStock}</strong> — leaking{' '}
                        <strong className="text-rose-600 dark:text-rose-400">
                          +{snap.overAllocatedUnits} oversold units
                        </strong>{' '}
                        due to concurrent stale reads.
                      </>
                    ) : (
                      <>
                        Processed{' '}
                        <strong className="text-heading">{snap.totalRequests.toLocaleString()}</strong> parallel
                        requests against <strong className="text-heading">{snap.initialStock}</strong> flash-sale units:{' '}
                        <strong className="text-emerald-700 dark:text-emerald-300">
                          0 over-allocated units
                        </strong>
                        , <strong className="text-heading">{snap.idempotentReplays.toLocaleString()}</strong> duplicate
                        retries deduplicated, and{' '}
                        <strong className="text-heading">{snap.payloadConflicts409}</strong> mutated-payload 409
                        conflicts blocked.
                      </>
                    )}
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={handleExportPostMortem}
                  className="surface-chip inline-flex items-center gap-1.5 rounded-xl border px-3.5 py-2.5 text-xs font-bold text-body transition hover:border-cyan-500 hover:text-heading"
                >
                  <Download className="h-3.5 w-3.5" />
                  Export .md
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab('sre-rag')}
                  className="inline-flex items-center gap-2 rounded-xl border border-cyan-500/40 bg-cyan-500/15 px-4 py-2.5 text-xs font-bold text-cyan-800 transition hover:bg-cyan-500/25 dark:text-cyan-200"
                >
                  <Bot className="h-4 w-4" />
                  Inspect ReAct SRE Diagnosis
                </button>
              </div>
            </div>

            {/* 4 1-Click Incident Stress Presets Bar */}
            <div className="surface-panel rounded-2xl border p-3.5">
              <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2">
                <span className="flex items-center gap-1.5 font-mono text-[11px] font-bold uppercase tracking-wider text-dim">
                  <Zap className="h-3.5 w-3.5 text-amber-500" />
                  1-Click Production Incident Stress Presets
                </span>
                <span className="font-mono text-[10.5px] text-faint">
                  Configures load + chaos and races all 3 engines automatically
                </span>
              </div>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
                {STRESS_PRESETS.map((preset) => {
                  const isActive = activePresetId === preset.id;
                  return (
                    <button
                      key={preset.id}
                      type="button"
                      data-testid={`preset-${preset.id}`}
                      disabled={isSimulating}
                      onClick={() => void handleApplyStressPreset(preset)}
                      className={`rounded-xl border px-3 py-2.5 text-left transition disabled:opacity-50 ${
                        isActive
                          ? 'border-cyan-500 bg-cyan-500/12 ring-1 ring-cyan-500/35'
                          : 'surface-inset hover:border-cyan-500/50'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-bold text-heading">{preset.label}</span>
                      </div>
                      <p className="mt-1 line-clamp-2 text-[11px] leading-snug text-dim">
                        {preset.subtitle}
                      </p>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Live KPI Strip */}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
              {[
                {
                  label: 'Throughput',
                  val: `${simResult.throughputRps.toLocaleString()} RPS`,
                  sub: `${simResult.elapsedMilliseconds}ms burst`,
                  tone: 'text-cyan-600 dark:text-cyan-300',
                },
                {
                  label: 'Stock Invariant',
                  val: `${snap.totalUnitsAllocated} / ${snap.initialStock}`,
                  sub: `Remaining: ${snap.remainingStock}`,
                  tone: isBreach
                    ? 'text-rose-600 dark:text-rose-400'
                    : 'text-emerald-600 dark:text-emerald-300',
                },
                {
                  label: 'Double-Spend Leaks',
                  val: String(snap.overAllocatedUnits),
                  sub: isBreach ? 'CRITICAL RACE BUG' : '100% Atomic',
                  tone: isBreach
                    ? 'text-rose-600 dark:text-rose-400'
                    : 'text-emerald-600 dark:text-emerald-400',
                },
                {
                  label: 'Idempotent Replays',
                  val: snap.idempotentReplays.toLocaleString(),
                  sub: `${snap.payloadConflicts409}x 409 blocked`,
                  tone: 'text-amber-600 dark:text-amber-300',
                },
                {
                  label: 'P99 Tail Latency',
                  val: `${(snap.p99LatencyUs / 1000).toFixed(3)} ms`,
                  sub: `P50: ${(snap.p50LatencyUs / 1000).toFixed(3)} ms`,
                  tone:
                    snap.p99LatencyUs > 25000
                      ? 'text-amber-600 dark:text-amber-300'
                      : 'text-emerald-600 dark:text-emerald-300',
                },
                {
                  label: 'Circuit & CAS Spins',
                  val: snap.circuitState,
                  sub: `${snap.totalCasRetries} CAS retries`,
                  tone:
                    snap.circuitState === 'Closed'
                      ? 'text-heading'
                      : 'text-amber-600 dark:text-amber-400',
                },
              ].map((k) => (
                <div key={k.label} className="surface-panel rounded-xl border p-3.5">
                  <div className="text-[10.5px] font-semibold uppercase tracking-wider text-dim">
                    {k.label}
                  </div>
                  <div className={`mt-1 font-mono text-base font-extrabold sm:text-lg ${k.tone}`}>
                    {k.val}
                  </div>
                  <div className="mt-0.5 font-mono text-[11px] text-faint">{k.sub}</div>
                </div>
              ))}
            </div>

            {/* 60fps Live Real-Time Packet-Flow Topology Canvas + Synchronized Stage Sparklines */}
            <Suspense fallback={<ModuleLoadingFallback label="60fps Live Packet Topology Canvas" />}>
              <LivePacketTopologyCanvas
                mode={simResult.mode}
                snapshot={snap}
                throughputRps={simResult.throughputRps}
                isRunning={isSimulating}
                stageTelemetry={simResult.stageTelemetry}
                theme={theme}
              />
            </Suspense>

            {/* Simulation Control Deck + Chaos Fault Injector */}
            <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
              <div className="surface-panel rounded-2xl border p-5 lg:col-span-7">
                <h2 className="flex items-center gap-2 text-sm font-bold text-heading">
                  <Cpu className="h-4 w-4 text-cyan-500 dark:text-cyan-400" />
                  Concurrency Engine &amp; Load Parameters
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
                      type="button"
                      data-testid={`mode-${item.m}`}
                      onClick={() => void handleRunBurst(item.m)}
                      className={`rounded-xl border p-3 text-left transition ${
                        mode === item.m
                          ? item.m === 'NaiveUnprotected'
                            ? 'border-rose-500/75 bg-rose-500/10'
                            : 'border-cyan-500/75 bg-cyan-500/10'
                          : 'surface-inset hover:border-slate-500/60'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-1">
                        <span className="text-xs font-bold text-heading">{item.title}</span>
                        <span className="surface-chip rounded border px-1.5 py-0.5 font-mono text-[10px] font-semibold text-cyan-700 dark:text-cyan-300">
                          {item.badge}
                        </span>
                      </div>
                      <p className="mt-1.5 text-[11px] leading-relaxed text-dim">{item.desc}</p>
                    </button>
                  ))}
                </div>

                {/* Sliders */}
                <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-3">
                  <div>
                    <div className="flex justify-between text-xs">
                      <span className="text-dim">Concurrent Requests</span>
                      <span className="font-mono font-bold text-cyan-600 dark:text-cyan-300">
                        {concurrentReqs.toLocaleString()}
                      </span>
                    </div>
                    <input
                      type="range"
                      min={500}
                      max={10000}
                      step={500}
                      value={concurrentReqs}
                      onChange={(e) => {
                        setActivePresetId(null);
                        setConcurrentReqs(Number(e.target.value));
                      }}
                      aria-label="Concurrent Requests"
                      className="mt-2 w-full accent-cyan-500"
                    />
                  </div>
                  <div>
                    <div className="flex justify-between text-xs">
                      <span className="text-dim">Flash-Sale Stock Cap</span>
                      <span className="font-mono font-bold text-emerald-600 dark:text-emerald-300">
                        {initialStock} units
                      </span>
                    </div>
                    <input
                      type="range"
                      min={100}
                      max={1500}
                      step={50}
                      value={initialStock}
                      onChange={(e) => {
                        setActivePresetId(null);
                        setInitialStock(Number(e.target.value));
                      }}
                      aria-label="Flash-Sale Stock Cap"
                      className="mt-2 w-full accent-emerald-500"
                    />
                  </div>
                  <div>
                    <div className="flex justify-between text-xs">
                      <span className="text-dim">Duplicate Retry Ratio</span>
                      <span className="font-mono font-bold text-sky-600 dark:text-sky-300">
                        {Math.round(dupRatio * 100)}%
                      </span>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={0.5}
                      step={0.05}
                      value={dupRatio}
                      onChange={(e) => {
                        setActivePresetId(null);
                        setDupRatio(Number(e.target.value));
                      }}
                      aria-label="Duplicate Retry Ratio"
                      className="mt-2 w-full accent-sky-500"
                    />
                  </div>
                </div>

                <div className="mt-5 flex flex-wrap gap-3">
                  <button
                    type="button"
                    data-testid="btn-execute-burst"
                    disabled={isSimulating}
                    onClick={() => void handleRunBurst()}
                    className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-cyan-500 to-emerald-500 px-5 py-2.5 text-xs font-extrabold text-slate-950 shadow-lg shadow-cyan-500/20 transition hover:brightness-110 disabled:opacity-50"
                  >
                    <Play className="h-4 w-4 fill-current" />
                    {isSimulating ? 'Running Parallel Burst...' : 'Execute High-Concurrency Burst'}
                  </button>

                  <button
                    type="button"
                    data-testid="btn-showdown"
                    disabled={isSimulating}
                    onClick={() => void handleThreeModeShowdown()}
                    className="inline-flex items-center gap-2 rounded-xl border border-amber-500/45 bg-amber-500/12 px-4 py-2.5 text-xs font-bold text-amber-800 transition hover:bg-amber-500/20 disabled:opacity-50 dark:text-amber-200"
                  >
                    <Sparkles className="h-4 w-4" />
                    Race All 3 Engines
                  </button>
                </div>
              </div>

              {/* Chaos Engineering Fault Injector */}
              <div className="surface-panel rounded-2xl border p-5 lg:col-span-5">
                <div className="flex items-center justify-between gap-2">
                  <h2 className="flex items-center gap-2 text-sm font-bold text-heading">
                    <AlertTriangle className="h-4 w-4 text-amber-500 dark:text-amber-400" />
                    Chaos Engineering Fault Injector
                  </h2>
                  {(chaos.injectedDbLatencyMs > 0 ||
                    chaos.cacheStampedeActive ||
                    chaos.failureRatePercent > 0 ||
                    chaos.forceCircuitOpen) && (
                    <button
                      type="button"
                      onClick={() => {
                        setChaos(ZERO_CHAOS);
                        setActivePresetId(null);
                      }}
                      className="font-mono text-[10.5px] font-semibold text-cyan-600 hover:underline dark:text-cyan-400"
                    >
                      Clear All
                    </button>
                  )}
                </div>
                <p className="mt-1 text-xs text-dim">
                  Inject realistic storage delays, hot-key stampedes, and circuit-breaker faults to verify system resilience.
                </p>

                <div className="mt-4 space-y-2.5">
                  {[
                    {
                      key: 'dbLag',
                      active: chaos.injectedDbLatencyMs > 0,
                      label: `Inject +${chaos.injectedDbLatencyMs > 0 ? chaos.injectedDbLatencyMs : 35}ms SQL Lock Contention Delay`,
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
                      label: `Inject ${chaos.failureRatePercent > 0 ? chaos.failureRatePercent : 20}% Transient Downstream Storage Errors`,
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
                      type="button"
                      onClick={() => {
                        setActivePresetId(null);
                        item.toggle();
                      }}
                      className={`flex w-full items-center justify-between gap-2 rounded-xl border px-3.5 py-2.5 text-left text-xs font-medium transition ${
                        item.active
                          ? 'border-amber-500/60 bg-amber-500/12 text-amber-800 dark:bg-amber-950/30 dark:text-amber-200'
                          : 'surface-inset text-body hover:border-slate-500/60'
                      }`}
                    >
                      <span>{item.label}</span>
                      <span
                        className={`shrink-0 rounded px-2 py-0.5 font-mono text-[10px] font-bold ${
                          item.active
                            ? 'bg-amber-500 text-slate-950'
                            : 'surface-chip border text-dim'
                        }`}
                      >
                        {item.active ? 'ACTIVE' : 'OFF'}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Latency Distribution Histogram (P50/P95/P99) + Head-to-Head 3-Engine Comparative Arena */}
            <Suspense fallback={<ModuleLoadingFallback label="3-Engine Comparative Race Arena" />}>
              <EngineRaceArena
                activeResult={simResult}
                showdownResults={showdownResults}
                isRacing={isSimulating}
                onLaunchRace={() => void handleThreeModeShowdown()}
                onInspectEngineResult={(r) => void handleInspectEngineResult(r)}
              />
            </Suspense>
          </div>
        )}

        {/* TAB 2: AUTONOMOUS SRE AGENT & HYBRID RAG LAB */}
        {activeTab === 'sre-rag' && (
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
            {/* Left: ReAct Incident Co-Pilot */}
            <div className="space-y-4 lg:col-span-6">
              <div className="surface-panel rounded-2xl border p-5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h2 className="flex items-center gap-2 text-sm font-bold text-heading">
                    <Bot className="h-4 w-4 text-cyan-500 dark:text-cyan-400" />
                    Autonomous ReAct SRE Incident Co-Pilot
                  </h2>
                  <span className="font-mono text-[11px] text-dim">
                    Latency: {diagnosis?.total_agent_latency_ms ?? 0} ms
                  </span>
                </div>
                <p className="mt-1 text-xs text-dim">
                  Trigger a 1-click production failure drill or diagnose live telemetry from Tab 1.
                </p>

                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => void handlePresetIncident('oversell')}
                    className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-1.5 text-xs font-semibold text-rose-700 transition hover:bg-rose-500/20 dark:text-rose-300"
                  >
                    Drill 1: SEV-1 Double-Spend Leak
                  </button>
                  <button
                    type="button"
                    onClick={() => void handlePresetIncident('stampede')}
                    className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-1.5 text-xs font-semibold text-amber-700 transition hover:bg-amber-500/20 dark:text-amber-300"
                  >
                    Drill 2: Cache Stampede + SQL Lag
                  </button>
                  <button
                    type="button"
                    onClick={() => void handlePresetIncident('circuit')}
                    className="rounded-lg border border-sky-500/40 bg-sky-500/10 px-3 py-1.5 text-xs font-semibold text-sky-700 transition hover:bg-sky-500/20 dark:text-sky-300"
                  >
                    Drill 3: 503 Circuit Breaker Trip
                  </button>
                </div>

                {diagnosis && (
                  <div className="mt-4 space-y-3.5">
                    <div
                      className={`rounded-xl border p-3.5 text-xs leading-relaxed ${
                        diagnosis.severity.includes('SEV-1')
                          ? 'border-rose-500/50 bg-rose-500/10 text-rose-800 dark:bg-rose-950/25 dark:text-rose-200'
                          : diagnosis.severity.includes('SEV-2')
                            ? 'border-amber-500/50 bg-amber-500/10 text-amber-800 dark:bg-amber-950/25 dark:text-amber-200'
                            : 'border-emerald-500/40 bg-emerald-500/10 text-emerald-800 dark:bg-emerald-950/20 dark:text-emerald-200'
                      }`}
                    >
                      {diagnosis.executive_summary}
                    </div>

                    {/* ReAct Tool Trace */}
                    <div className="space-y-2">
                      {diagnosis.react_trace.map((st) => (
                        <div key={st.step} className="surface-inset rounded-xl border p-3">
                          <div className="flex items-center justify-between font-mono text-[11px]">
                            <span className="font-semibold text-cyan-600 dark:text-cyan-300">
                              Step {st.step}: {st.phase}
                            </span>
                            <span className="text-dim">{st.duration_ms} ms</span>
                          </div>
                          <pre className="surface-code mt-2 overflow-x-auto rounded-lg border p-2.5 font-mono text-[11px] text-slate-200">
                            {JSON.stringify(st.output, null, 2)}
                          </pre>
                        </div>
                      ))}
                    </div>

                    {diagnosis.recommended_code_patch && (
                      <div className="surface-code rounded-xl border p-3.5">
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

            {/* Right: Upgraded Interactive Hybrid RAG Alpha Playground & Post-Mortem Export */}
            <div className="space-y-4 lg:col-span-6">
              <Suspense fallback={<ModuleLoadingFallback label="Hybrid RAG Playground" />}>
                <HybridRagPlayground
                  ragQuery={ragQuery}
                  onRagQueryChange={setRagQuery}
                  alpha={ragAlpha}
                  onAlphaChange={setRagAlpha}
                  ragResult={ragResult}
                  onSearch={(q, a) => void handleRagSearch(q, a)}
                  onExportPostMortem={handleExportPostMortem}
                  onCopyPostMortem={handleCopyPostMortem}
                />
              </Suspense>
            </div>
          </div>
        )}

        {/* TAB 5: OPENTELEMETRY TRACE WATERFALL */}
        {activeTab === 'traces' && (
          <Suspense fallback={<ModuleLoadingFallback label="OpenTelemetry Trace Waterfall" />}>
            <TraceWaterfallPanel traces={simResult?.sampledTraces ?? []} />
          </Suspense>
        )}

        {/* TAB 4: VERIFIED CI BENCHMARKS & POLYGLOT CODE VAULT */}
        {activeTab === 'benchmarks' && (
          <div className="min-w-0 space-y-6">
            <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
              <div className="surface-panel min-w-0 rounded-2xl border p-5 lg:col-span-7">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h2 className="flex items-center gap-2 text-sm font-bold text-heading">
                    <Database className="h-4 w-4 shrink-0 text-cyan-500 dark:text-cyan-400" />
                    Empirical .NET 10 High-Concurrency Benchmark Report
                  </h2>
                  <span className="rounded bg-emerald-500/15 px-2.5 py-0.5 font-mono text-[11px] font-semibold text-emerald-700 dark:text-emerald-300">
                    {EMPIRICAL_DOTNET_BENCHMARK.testSuiteSummary}
                  </span>
                </div>
                <p className="mt-1 font-mono text-[11px] text-dim">
                  Runtime: {EMPIRICAL_DOTNET_BENCHMARK.dotnetRuntime} · {EMPIRICAL_DOTNET_BENCHMARK.osArchitecture}
                </p>

                <div className="mt-4 w-full overflow-x-auto">
                  <table className="w-full min-w-[560px] text-left font-mono text-xs">
                    <thead>
                      <tr className="border-hairline border-b text-[11px] uppercase text-dim">
                        <th className="py-2 pr-3">Engine Mode</th>
                        <th className="py-2 pr-3">Burst Load</th>
                        <th className="py-2 pr-3">Throughput</th>
                        <th className="py-2 pr-3">P99 Latency</th>
                        <th className="py-2 pr-3">Double-Spends</th>
                        <th className="py-2">Invariant</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200 dark:divide-slate-800/70">
                      {EMPIRICAL_DOTNET_BENCHMARK.runs.map((r) => (
                        <tr key={r.mode}>
                          <td className="py-2.5 pr-3 font-semibold text-heading">{r.label}</td>
                          <td className="py-2.5 pr-3 text-body">{r.concurrentRequests.toLocaleString()}</td>
                          <td className="py-2.5 pr-3 font-semibold text-cyan-600 dark:text-cyan-300">
                            {r.throughputRps.toLocaleString()} RPS
                          </td>
                          <td className="py-2.5 pr-3 text-body">{r.p99LatencyMs} ms</td>
                          <td
                            className={`py-2.5 pr-3 font-bold ${
                              r.overAllocatedUnits > 0
                                ? 'text-rose-600 dark:text-rose-400'
                                : 'text-emerald-600 dark:text-emerald-400'
                            }`}
                          >
                            {r.overAllocatedUnits}
                          </td>
                          <td className="py-2.5">
                            {r.invariantIntact ? (
                              <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
                                <CheckCircle2 className="h-3.5 w-3.5" /> INTACT
                              </span>
                            ) : (
                              <span className="font-bold text-rose-600 dark:text-rose-400">BREACHED</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="surface-panel min-w-0 rounded-2xl border p-5 lg:col-span-5">
                <h2 className="flex items-center gap-2 text-sm font-bold text-heading">
                  <Layers className="h-4 w-4 shrink-0 text-emerald-500 dark:text-emerald-400" />
                  Python 3.12 Hybrid RAG Evaluation Metrics
                </h2>
                <p className="mt-1 font-mono text-[11px] text-dim">
                  {EMPIRICAL_PYTHON_RAG_EVAL.pythonRuntime} · {EMPIRICAL_PYTHON_RAG_EVAL.testSuiteSummary}
                </p>

                <div className="mt-4 grid grid-cols-2 gap-3">
                  {[
                    { k: 'Recall@1 (Golden)', v: `${(EMPIRICAL_PYTHON_RAG_EVAL.recallAt1 * 100).toFixed(0)}%` },
                    { k: 'Recall@3 (Golden)', v: `${(EMPIRICAL_PYTHON_RAG_EVAL.recallAt3 * 100).toFixed(0)}%` },
                    { k: 'Mean Reciprocal Rank', v: EMPIRICAL_PYTHON_RAG_EVAL.mrr.toFixed(2) },
                    {
                      k: 'OOD Abstention Precision',
                      v: `${(EMPIRICAL_PYTHON_RAG_EVAL.abstentionPrecision * 100).toFixed(0)}%`,
                    },
                    { k: 'P50 Retrieval Latency', v: `${EMPIRICAL_PYTHON_RAG_EVAL.p50LatencyMs} ms` },
                    { k: 'P95 Retrieval Latency', v: `${EMPIRICAL_PYTHON_RAG_EVAL.p95LatencyMs} ms` },
                  ].map((m) => (
                    <div key={m.k} className="surface-inset min-w-0 rounded-xl border p-3">
                      <div className="text-[11px] text-dim">{m.k}</div>
                      <div className="mt-1 font-mono text-base font-extrabold text-emerald-600 dark:text-emerald-300">
                        {m.v}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Polyglot Code Vault */}
            <div className="surface-panel min-w-0 rounded-2xl border p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h3 className="text-sm font-bold text-heading">
                  Polyglot Production Source Vault (.NET 10 · Lua/SQL · Python 3.12)
                </h3>
                <div className="flex flex-wrap gap-2">
                  {POLYGLOT_CODE_VAULT.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => setSelectedCodeId(item.id)}
                      className={`max-w-full rounded-lg px-3 py-1.5 text-left text-xs font-semibold transition ${
                        selectedCodeId === item.id
                          ? 'bg-cyan-500/18 text-cyan-700 ring-1 ring-cyan-500/50 dark:text-cyan-300'
                          : 'surface-chip text-dim hover:text-heading'
                      }`}
                    >
                      {item.title}
                    </button>
                  ))}
                </div>
              </div>

              {POLYGLOT_CODE_VAULT.filter((x) => x.id === selectedCodeId).map((activeCode) => (
                <div key={activeCode.id} className="mt-4 min-w-0">
                  <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-xs">
                    <span className="break-all font-mono text-cyan-600 dark:text-cyan-400">
                      {activeCode.file}
                    </span>
                    <span className="text-dim">{activeCode.highlights}</span>
                  </div>
                  <pre className="surface-code max-w-full overflow-x-auto rounded-xl border p-4 font-mono text-xs leading-relaxed text-slate-200">
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
            <div className="surface-panel rounded-2xl border p-6 lg:col-span-7">
              <h2 className="text-base font-bold text-heading">
                Executive Architecture ROI &amp; Flash-Sale Protection Calculator
              </h2>
              <p className="mt-1 text-xs text-dim">
                Estimate business impact from eliminating inventory overselling, retry-storm chargebacks, and P99 tail-latency bottlenecks.
              </p>

              <div className="mt-5 space-y-4">
                <div>
                  <div className="flex justify-between text-xs">
                    <span className="text-body">Peak Campaign / Checkout Traffic (RPS)</span>
                    <span className="font-mono font-bold text-cyan-600 dark:text-cyan-300">
                      {roiPeakRps.toLocaleString()} RPS
                    </span>
                  </div>
                  <input
                    type="range"
                    min={500}
                    max={25000}
                    step={500}
                    value={roiPeakRps}
                    onChange={(e) => setRoiPeakRps(Number(e.target.value))}
                    className="mt-2 w-full accent-cyan-500"
                  />
                </div>

                <div>
                  <div className="flex justify-between text-xs">
                    <span className="text-body">Average Order / Voucher Basket Value (USD)</span>
                    <span className="font-mono font-bold text-emerald-600 dark:text-emerald-300">
                      ${roiAovUsd}
                    </span>
                  </div>
                  <input
                    type="range"
                    min={15}
                    max={250}
                    step={5}
                    value={roiAovUsd}
                    onChange={(e) => setRoiAovUsd(Number(e.target.value))}
                    className="mt-2 w-full accent-emerald-500"
                  />
                </div>

                <div>
                  <div className="flex justify-between text-xs">
                    <span className="text-body">Current Checkout P99 Latency (ms)</span>
                    <span className="font-mono font-bold text-amber-600 dark:text-amber-300">
                      {roiCurrentP99Ms} ms → 18 ms
                    </span>
                  </div>
                  <input
                    type="range"
                    min={80}
                    max={1500}
                    step={20}
                    value={roiCurrentP99Ms}
                    onChange={(e) => setRoiCurrentP99Ms(Number(e.target.value))}
                    className="mt-2 w-full accent-amber-500"
                  />
                </div>
              </div>

              <div className="mt-6 grid grid-cols-1 gap-3.5 sm:grid-cols-3">
                <div className="rounded-xl border border-emerald-500/35 bg-emerald-500/10 p-4 dark:bg-emerald-950/20">
                  <div className="text-[11px] text-dim">Checkout Conversion Lift</div>
                  <div className="mt-1 font-mono text-xl font-extrabold text-emerald-700 dark:text-emerald-300">
                    +{conversionLiftPct}%
                  </div>
                  <div className="mt-0.5 text-[11px] text-dim">Sub-20ms P99 response</div>
                </div>
                <div className="rounded-xl border border-cyan-500/35 bg-cyan-500/10 p-4 dark:bg-cyan-950/20">
                  <div className="text-[11px] text-dim">Monthly Protected Margin</div>
                  <div className="mt-1 font-mono text-xl font-extrabold text-cyan-700 dark:text-cyan-300">
                    ${monthlyProtectedFlashRevenue.toLocaleString()}
                  </div>
                  <div className="mt-0.5 text-[11px] text-dim">0 oversold / 0 dup charge</div>
                </div>
                <div className="rounded-xl border border-sky-500/35 bg-sky-500/10 p-4 dark:bg-sky-950/20">
                  <div className="text-[11px] text-dim">Projected Annual Impact</div>
                  <div className="mt-1 font-mono text-xl font-extrabold text-sky-700 dark:text-sky-300">
                    ${annualEngineeringRoiUsd.toLocaleString()}
                  </div>
                  <div className="mt-0.5 text-[11px] text-dim">+ ~62% DB CPU offloaded</div>
                </div>
              </div>
            </div>

            {/* Architect Engagement Card */}
            <div className="surface-panel rounded-2xl border border-cyan-500/35 p-6 lg:col-span-5">
              <div className="inline-flex items-center gap-2 rounded-full border border-emerald-500/40 bg-emerald-500/10 px-3 py-1 font-mono text-[11px] font-semibold text-emerald-700 dark:text-emerald-300">
                Available Immediately · Remote B2B / Contract / Milestone
              </div>
              <h2 className="mt-3 text-lg font-extrabold text-heading">Trương Văn Tình</h2>
              <p className="text-xs font-semibold text-cyan-700 dark:text-cyan-300">
                Full-Stack .NET &amp; Applied AI Engineer · Ex-Con Cung (700+ Retail Stores, 5,000+ RPS)
              </p>
              <p className="mt-3 text-xs leading-relaxed text-body">
                3+ years shipping high-concurrency retail backend systems (.NET 8/10, C#, Dapper, SQL Server, PostgreSQL, Redis Lua, Keycloak OIDC), modern TypeScript web apps (Angular, React, Vue 3), and production Hybrid RAG / Agentic workflows (Python, FastAPI, LangChain, Qdrant).
              </p>

              <div className="mt-4 space-y-2">
                {[
                  {
                    href: 'https://tvt987.github.io/CV_Backend_TruongVanTinh.pdf',
                    label: 'Download Backend & High-Concurrency CV (.NET)',
                  },
                  {
                    href: 'https://tvt987.github.io/CV_FullStack_TruongVanTinh.pdf',
                    label: 'Download Full-Stack Engineer CV (.NET + React/Angular)',
                  },
                  {
                    href: 'https://tvt987.github.io/CV_AI_TruongVanTinh.pdf',
                    label: 'Download Applied AI & Hybrid RAG Engineer CV (Python)',
                  },
                ].map((cv) => (
                  <a
                    key={cv.href}
                    href={cv.href}
                    target="_blank"
                    rel="noreferrer"
                    className="surface-inset flex items-center justify-between gap-2 rounded-xl border px-3.5 py-2.5 text-xs font-semibold text-heading transition hover:border-cyan-500"
                  >
                    <span className="flex items-center gap-2">
                      <FileText className="h-3.5 w-3.5 shrink-0 text-cyan-500" />
                      {cv.label}
                    </span>
                    <ExternalLink className="h-3.5 w-3.5 shrink-0 text-cyan-500" />
                  </a>
                ))}
              </div>

              <div className="mt-4 flex flex-wrap gap-2.5">
                <button
                  type="button"
                  onClick={() => setLicenseModalOpen(true)}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-cyan-500 to-emerald-500 px-4 py-2.5 text-center text-xs font-extrabold text-slate-950 shadow-md shadow-cyan-500/20 transition hover:brightness-110"
                >
                  <QrCode className="h-4 w-4" />
                  Commission Enterprise License · 22.900.000 VND (MBBank VietQR)
                </button>
                <a
                  href="mailto:tinhkun102@gmail.com?subject=Remote%20Engineering%20Opportunity%20-%20AegisPulse"
                  className="flex-1 rounded-xl border border-cyan-500/45 bg-cyan-500/12 px-4 py-2.5 text-center text-xs font-extrabold text-cyan-800 transition hover:bg-cyan-500/22 dark:text-cyan-200"
                >
                  Email: tinhkun102@gmail.com
                </a>
                <a
                  href="https://www.linkedin.com/in/tr%C6%B0%C6%A1ng-v%C4%83n-t%C3%ACnh-651b12289/"
                  target="_blank"
                  rel="noreferrer"
                  className="surface-chip rounded-xl border px-4 py-2.5 text-xs font-bold text-heading transition hover:border-cyan-500"
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

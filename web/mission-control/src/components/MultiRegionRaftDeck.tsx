import { useState } from 'react';
import {
  Activity,
  AlertTriangle,
  Database,
  Flame,
  Globe,
  Lock,
  Radio,
  RotateCcw,
  Scissors,
  ShieldAlert,
  ShieldCheck,
  Timer,
  Zap,
} from 'lucide-react';
import type { ClusterTopologyState, RegionId } from '../engines/chaosEngine';
import type { ThemeMode } from '../engine/types';
import { UI_COPY, type LangMode } from '../i18n/translations';

interface Props {
  cluster: ClusterTopologyState;
  lang: LangMode;
  theme: ThemeMode;
  onCutRegionFiber: (regionId: RegionId) => void;
  onToggleTailLatency: () => void;
  onToggleRedisStampede: () => void;
  onToggleDbExhaustion: () => void;
  onRestoreAll: () => void;
  onTransferLeader: (regionId: RegionId) => void;
}

export function MultiRegionRaftDeck({
  cluster,
  lang,
  theme,
  onCutRegionFiber,
  onToggleTailLatency,
  onToggleRedisStampede,
  onToggleDbExhaustion,
  onRestoreAll,
  onTransferLeader,
}: Props) {
  const copy = UI_COPY[lang].raftSection;
  const [selectedRegion, setSelectedRegion] = useState<RegionId>('ap-southeast-1');

  const isDark = theme === 'dark';
  const selectedRegionNode = cluster.regions.find((r) => r.id === selectedRegion) ?? cluster.regions[0];
  const isSelectedCut = cluster.faults.fiberCutRegions.includes(selectedRegion);
  const activeFaultCount =
    cluster.faults.fiberCutRegions.length +
    (cluster.faults.tailLatency180Ms ? 1 : 0) +
    (cluster.faults.redisCacheStampede ? 1 : 0) +
    (cluster.faults.dbConnectionExhaustion ? 1 : 0);

  const regionById = Object.fromEntries(cluster.regions.map((r) => [r.id, r])) as Record<
    RegionId,
    (typeof cluster.regions)[number]
  >;

  const bannerTone = !cluster.hasQuorum
    ? 'border-rose-500/55 bg-gradient-to-r from-rose-500/18 via-rose-500/[0.06] to-transparent dark:from-rose-950/60 dark:via-[#120b18] dark:to-[#091020]'
    : cluster.quorumStatus !== 'HEALTHY'
      ? 'border-amber-500/50 bg-gradient-to-r from-amber-500/15 via-amber-500/[0.05] to-transparent dark:from-amber-950/45 dark:via-[#11121f] dark:to-[#091020]'
      : 'border-emerald-500/40 bg-gradient-to-r from-emerald-500/12 via-cyan-500/[0.05] to-transparent dark:from-emerald-950/45 dark:via-[#0b1526] dark:to-[#091020]';

  const statusHeadline = !cluster.hasQuorum
    ? copy.quorumLost
    : cluster.quorumStatus !== 'HEALTHY'
      ? copy.quorumDegraded
      : copy.quorumHealthy;

  return (
    <section className="space-y-4" aria-label="Multi-Region Raft Quorum and Chaos Engine">
      {/* Executive Multi-Region Status Banner */}
      <div
        data-testid="raft-quorum-banner"
        className={`flex flex-col gap-3 rounded-2xl border p-4 lg:flex-row lg:items-center lg:justify-between ${bannerTone}`}
      >
        <div className="flex min-w-0 flex-1 items-start gap-3">
          {!cluster.hasQuorum ? (
            <ShieldAlert className="mt-0.5 h-7 w-7 shrink-0 text-rose-500 dark:text-rose-400" />
          ) : cluster.quorumStatus !== 'HEALTHY' ? (
            <AlertTriangle className="mt-0.5 h-7 w-7 shrink-0 text-amber-500 dark:text-amber-400" />
          ) : (
            <ShieldCheck className="mt-0.5 h-7 w-7 shrink-0 text-emerald-600 dark:text-emerald-400" />
          )}
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={`rounded px-2 py-0.5 font-mono text-[10.5px] font-bold uppercase tracking-wider ${
                  !cluster.hasQuorum
                    ? 'bg-rose-500/20 text-rose-700 dark:text-rose-300'
                    : cluster.quorumStatus !== 'HEALTHY'
                      ? 'bg-amber-500/20 text-amber-800 dark:text-amber-200'
                      : 'bg-emerald-500/20 text-emerald-700 dark:text-emerald-300'
                }`}
              >
                {statusHeadline}
              </span>
              <span className="font-mono text-xs text-dim">
                Term {cluster.raftTerm} · Commit #{cluster.commitIndex.toLocaleString()} · Quorum{' '}
                {cluster.reachableCount}/{cluster.totalNodes} (min {cluster.quorumSize}/5)
              </span>
            </div>
            <h1 className="mt-1 text-base font-extrabold tracking-tight text-heading">
              {copy.title}
            </h1>
            <p className="mt-0.5 text-xs leading-relaxed text-body">{copy.subtitle}</p>
          </div>
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <div className="surface-inset flex items-center gap-2 rounded-xl border px-3 py-2 font-mono text-xs">
            <Lock className="h-3.5 w-3.5 text-emerald-500" />
            <span className="text-dim">Split-Brain Guard:</span>
            <span
              className={`font-bold ${
                cluster.fencedWriteGuardActive
                  ? 'text-rose-600 dark:text-rose-400'
                  : 'text-emerald-600 dark:text-emerald-300'
              }`}
            >
              {cluster.fencedWriteGuardActive ? 'FENCED (RO)' : 'ARMED'}
            </span>
          </div>
          {activeFaultCount > 0 && (
            <button
              type="button"
              onClick={onRestoreAll}
              className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-500 px-3.5 py-2 text-xs font-extrabold text-slate-950 shadow-md shadow-emerald-500/20 transition hover:brightness-110"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              {copy.btnRestoreAll}
            </button>
          )}
        </div>
      </div>

      {/* 6 Executive Multi-Region KPI Cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {[
          {
            id: 'quorum',
            label: 'Raft Quorum',
            val: `${cluster.reachableCount} / ${cluster.totalNodes}`,
            sub: cluster.hasQuorum ? `Majority >= ${cluster.quorumSize}` : 'FENCED (< 3/5)',
            tone: !cluster.hasQuorum
              ? 'text-rose-600 dark:text-rose-400'
              : cluster.reachableCount < 5
                ? 'text-amber-600 dark:text-amber-300'
                : 'text-emerald-600 dark:text-emerald-300',
          },
          {
            id: 'leader',
            label: 'Active Leader',
            val: cluster.leaderRegionId
              ? regionById[cluster.leaderRegionId].shortCode
              : 'NONE',
            sub: cluster.leaderRegionId
              ? `${cluster.leaderRegionId} · T${cluster.raftTerm}`
              : 'Split-Brain Fenced',
            tone: cluster.leaderRegionId
              ? 'text-cyan-600 dark:text-cyan-300'
              : 'text-rose-600 dark:text-rose-400',
          },
          {
            id: 'failover',
            label: 'Failover Latency',
            val: `${cluster.lastFailoverLatencyMs} ms`,
            sub: cluster.lastFailoverLatencyMs > 0 ? 'Auto-Election RTT' : 'Zero failovers yet',
            tone:
              cluster.lastFailoverLatencyMs > 280
                ? 'text-amber-600 dark:text-amber-300'
                : 'text-heading',
          },
          {
            id: 'lag',
            label: 'Max Replication Lag',
            val: `${cluster.maxReplicationLagMs} ms`,
            sub: `Avg RTT: ${cluster.avgCrossRegionRttMs}ms`,
            tone:
              cluster.maxReplicationLagMs > 90
                ? 'text-rose-600 dark:text-rose-400'
                : cluster.maxReplicationLagMs > 40
                  ? 'text-amber-600 dark:text-amber-300'
                  : 'text-emerald-600 dark:text-emerald-300',
          },
          {
            id: 'burn',
            label: 'Error Budget Burn',
            val: `${cluster.errorBudgetBurnRate.toFixed(1)}x`,
            sub: `Cache Hit: ${cluster.cacheHitRatioPct}%`,
            tone:
              cluster.errorBudgetBurnRate >= 10
                ? 'text-rose-600 dark:text-rose-400'
                : cluster.errorBudgetBurnRate > 2
                  ? 'text-amber-600 dark:text-amber-300'
                  : 'text-emerald-600 dark:text-emerald-300',
          },
          {
            id: 'cb',
            label: 'Circuit Breaker',
            val: cluster.circuitBreakerState,
            sub: `DB Pool: ${cluster.dbPoolUtilizationPct}%`,
            tone:
              cluster.circuitBreakerState === 'OPEN'
                ? 'text-rose-600 dark:text-rose-400'
                : cluster.circuitBreakerState === 'HALF_OPEN'
                  ? 'text-amber-600 dark:text-amber-300'
                  : 'text-emerald-600 dark:text-emerald-300',
          },
        ].map((kpi) => (
          <div
            key={kpi.id}
            data-testid={`raft-kpi-${kpi.id}`}
            className="surface-panel rounded-xl border p-3.5"
          >
            <div className="text-[10.5px] font-semibold uppercase tracking-wider text-dim">
              {kpi.label}
            </div>
            <div className={`mt-1 font-mono text-base font-extrabold sm:text-lg ${kpi.tone}`}>
              {kpi.val}
            </div>
            <div className="mt-0.5 truncate font-mono text-[11px] text-faint">{kpi.sub}</div>
          </div>
        ))}
      </div>

      {/* Main 12-Col Grid: 5-Region Interactive SVG Mesh (7 cols) + Chaos Control Deck (5 cols) */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
        {/* Left: Interactive 5-Region Global Raft Topology Graph */}
        <div className="surface-panel min-w-0 rounded-2xl border p-4 sm:p-5 lg:col-span-7">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Globe className="h-4 w-4 text-cyan-500" />
              <h2 className="text-sm font-bold text-heading">
                Global 5-Region Raft Consensus Mesh
              </h2>
            </div>
            <div className="flex flex-wrap items-center gap-3 font-mono text-[10.5px] text-dim">
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-emerald-400" />
                Leader Replication
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-amber-400" />
                Degraded (+180ms)
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-rose-500" />
                Fiber Severed
              </span>
            </div>
          </div>

          <div className="surface-inset relative overflow-hidden rounded-xl border p-2">
            <svg
              viewBox="0 0 820 310"
              className="h-auto w-full select-none"
              role="img"
              aria-label="5-Region Global Raft Quorum Topology"
            >
              <defs>
                <radialGradient id="raftGlowLeader" cx="50%" cy="50%" r="50%">
                  <stop offset="0%" stopColor="#10b981" stopOpacity="0.38" />
                  <stop offset="100%" stopColor="#10b981" stopOpacity="0" />
                </radialGradient>
                <radialGradient id="raftGlowCyan" cx="50%" cy="50%" r="50%">
                  <stop offset="0%" stopColor="#06b6d4" stopOpacity="0.22" />
                  <stop offset="100%" stopColor="#06b6d4" stopOpacity="0" />
                </radialGradient>
                <radialGradient id="raftGlowRose" cx="50%" cy="50%" r="50%">
                  <stop offset="0%" stopColor="#f43f5e" stopOpacity="0.32" />
                  <stop offset="100%" stopColor="#f43f5e" stopOpacity="0" />
                </radialGradient>
              </defs>

              {/* Subtle global coordinate graticule */}
              <g opacity={isDark ? 0.16 : 0.12} stroke={isDark ? '#64748b' : '#475569'} strokeWidth="0.8">
                <line x1="20" y1="85" x2="800" y2="85" strokeDasharray="3 6" />
                <line x1="20" y1="155" x2="800" y2="155" strokeDasharray="3 6" />
                <line x1="20" y1="225" x2="800" y2="225" strokeDasharray="3 6" />
                <line x1="160" y1="18" x2="160" y2="292" strokeDasharray="3 6" />
                <line x1="410" y1="18" x2="410" y2="292" strokeDasharray="3 6" />
                <line x1="660" y1="18" x2="660" y2="292" strokeDasharray="3 6" />
                <ellipse cx="410" cy="155" rx="355" ry="125" fill="none" strokeDasharray="4 8" />
              </g>

              {/* Subtle continental silhouette bands */}
              <g fill={isDark ? '#1e293b' : '#cbd5e1'} opacity={isDark ? 0.25 : 0.35}>
                <rect x="56" y="70" width="134" height="106" rx="28" />
                <rect x="276" y="34" width="132" height="82" rx="26" />
                <rect x="326" y="170" width="112" height="96" rx="24" />
                <rect x="520" y="168" width="114" height="96" rx="26" />
                <rect x="646" y="48" width="124" height="96" rx="26" />
              </g>

              {/* Mesh Edges */}
              {cluster.edges.map((edge) => {
                const a = regionById[edge.from];
                const b = regionById[edge.to];
                const midX = (a.x + b.x) / 2;
                const midY = (a.y + b.y) / 2;

                if (edge.status === 'SEVERED') {
                  return (
                    <g key={edge.id}>
                      <line
                        x1={a.x}
                        y1={a.y}
                        x2={b.x}
                        y2={b.y}
                        stroke="#f43f5e"
                        strokeWidth="1.6"
                        strokeDasharray="5 6"
                        opacity="0.55"
                      />
                      <circle cx={midX} cy={midY} r="7" fill={isDark ? '#1e0b14' : '#fff1f2'} stroke="#f43f5e" strokeWidth="1.4" />
                      <line x1={midX - 3} y1={midY - 3} x2={midX + 3} y2={midY + 3} stroke="#fb7185" strokeWidth="1.6" />
                      <line x1={midX + 3} y1={midY - 3} x2={midX - 3} y2={midY + 3} stroke="#fb7185" strokeWidth="1.6" />
                    </g>
                  );
                }

                const strokeColor =
                  edge.status === 'DEGRADED'
                    ? '#f59e0b'
                    : edge.isLeaderReplicationEdge
                      ? '#10b981'
                      : isDark
                        ? '#334155'
                        : '#94a3b8';

                const strokeWidth = edge.isLeaderReplicationEdge ? 2.4 : 1.1;

                return (
                  <g key={edge.id}>
                    <line
                      x1={a.x}
                      y1={a.y}
                      x2={b.x}
                      y2={b.y}
                      stroke={strokeColor}
                      strokeWidth={strokeWidth}
                      opacity={edge.isLeaderReplicationEdge ? 0.45 : 0.35}
                    />
                    {edge.isLeaderReplicationEdge && (
                      <>
                        <line
                          x1={a.x}
                          y1={a.y}
                          x2={b.x}
                          y2={b.y}
                          stroke={edge.status === 'DEGRADED' ? '#fbbf24' : '#34d399'}
                          strokeWidth="2.4"
                          className="animate-packet"
                        />
                        <rect
                          x={midX - 24}
                          y={midY - 9}
                          width="48"
                          height="17"
                          rx="5"
                          fill={isDark ? '#060c18' : '#ffffff'}
                          stroke={edge.status === 'DEGRADED' ? '#f59e0b' : '#10b981'}
                          strokeWidth="0.9"
                        />
                        <text
                          x={midX}
                          y={midY + 3}
                          textAnchor="middle"
                          fontSize="9.5"
                          fontWeight="700"
                          fontFamily="JetBrains Mono, monospace"
                          fill={edge.status === 'DEGRADED' ? '#fbbf24' : isDark ? '#6ee7b7' : '#047857'}
                        >
                          {edge.currentRttMs}ms
                        </text>
                      </>
                    )}
                  </g>
                );
              })}

              {/* 5 Global Region Nodes */}
              {cluster.regions.map((node) => {
                const isLeader = node.role === 'LEADER';
                const isPartitioned = node.role === 'PARTITIONED';
                const isFenced = node.role === 'FENCED';
                const isSelected = node.id === selectedRegion;

                const ringStroke = isPartitioned
                  ? '#f43f5e'
                  : isFenced
                    ? '#f59e0b'
                    : isLeader
                      ? '#10b981'
                      : node.status === 'CRITICAL'
                        ? '#f43f5e'
                        : node.status === 'DEGRADED'
                          ? '#f59e0b'
                          : '#06b6d4';

                const glowId = isPartitioned
                  ? 'url(#raftGlowRose)'
                  : isLeader
                    ? 'url(#raftGlowLeader)'
                    : 'url(#raftGlowCyan)';

                return (
                  <g
                    key={node.id}
                    transform={`translate(${node.x}, ${node.y})`}
                    className="cursor-pointer"
                    onClick={() => {
                      setSelectedRegion(node.id);
                      if (node.role === 'FOLLOWER' && cluster.hasQuorum) {
                        onTransferLeader(node.id);
                      }
                    }}
                  >
                    {/* Aura glow */}
                    <circle r={isLeader ? 46 : 36} fill={glowId} />

                    {/* Selection dashed outer ring */}
                    {isSelected && (
                      <circle
                        r="31"
                        fill="none"
                        stroke="#22d3ee"
                        strokeWidth="1.4"
                        strokeDasharray="4 3"
                      />
                    )}

                    {/* Main Node Disk */}
                    <circle
                      r="24"
                      fill={isDark ? '#081020' : '#ffffff'}
                      stroke={ringStroke}
                      strokeWidth={isLeader ? 3 : 2}
                    />

                    {/* Short Code */}
                    <text
                      x="0"
                      y="-1"
                      textAnchor="middle"
                      fontSize="11.5"
                      fontWeight="800"
                      fontFamily="JetBrains Mono, monospace"
                      fill={isDark ? '#f8fafc' : '#0f172a'}
                    >
                      {node.shortCode}
                    </text>

                    {/* Role Sub-tag inside disk */}
                    <text
                      x="0"
                      y="11"
                      textAnchor="middle"
                      fontSize="7.5"
                      fontWeight="700"
                      fontFamily="JetBrains Mono, monospace"
                      fill={ringStroke}
                    >
                      {isLeader
                        ? 'LEADER'
                        : isPartitioned
                          ? 'CUT'
                          : isFenced
                            ? 'FENCED'
                            : 'SYNC'}
                    </text>

                    {/* Label Card below node */}
                    <rect
                      x="-64"
                      y="28"
                      width="128"
                      height="32"
                      rx="7"
                      fill={isDark ? '#060b16' : '#f8fafc'}
                      stroke={ringStroke}
                      strokeOpacity="0.6"
                      strokeWidth="1"
                    />
                    <text
                      x="0"
                      y="41"
                      textAnchor="middle"
                      fontSize="9.5"
                      fontWeight="700"
                      fontFamily="JetBrains Mono, monospace"
                      fill={isDark ? '#e2e8f0' : '#0f172a'}
                    >
                      {node.label}
                    </text>
                    <text
                      x="0"
                      y="54"
                      textAnchor="middle"
                      fontSize="8.5"
                      fontFamily="JetBrains Mono, monospace"
                      fill={
                        isPartitioned
                          ? '#fb7185'
                          : isLeader
                            ? '#34d399'
                            : node.replicationLagMs > 80
                              ? '#fbbf24'
                              : isDark
                                ? '#94a3b8'
                                : '#475569'
                      }
                    >
                      {isPartitioned
                        ? 'FIBER SEVERED · 100% LOSS'
                        : isFenced
                          ? 'NO QUORUM · READ-ONLY'
                          : isLeader
                            ? `TERM ${cluster.raftTerm} · PRIMARY`
                            : `Lag ${node.replicationLagMs}ms · Pool ${node.dbPoolPct}%`}
                    </text>
                  </g>
                );
              })}
            </svg>
          </div>

          <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2 text-[11px] text-dim">
            <span className="flex items-center gap-1.5">
              <Radio className="h-3.5 w-3.5 text-cyan-500" />
              {copy.clickFollowerHint}
            </span>
            <span className="font-mono text-[10.5px] text-faint">
              Selected: <strong className="text-heading">{selectedRegionNode.label}</strong>
            </span>
          </div>
        </div>

        {/* Right: Interactive Chaos Control Deck + Live Raft Audit Feed */}
        <div className="flex min-w-0 flex-col gap-4 lg:col-span-5">
          <div className="surface-panel rounded-2xl border p-4 sm:p-5">
            <div className="flex items-center justify-between gap-2">
              <h2 className="flex items-center gap-2 text-sm font-bold text-heading">
                <Flame className="h-4 w-4 text-amber-500" />
                {copy.chaosDeckTitle}
              </h2>
              <span
                className={`rounded-full px-2 py-0.5 font-mono text-[10px] font-bold uppercase ${
                  activeFaultCount > 0
                    ? 'bg-rose-500/20 text-rose-600 dark:text-rose-300'
                    : 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
                }`}
              >
                {activeFaultCount > 0 ? `${activeFaultCount} FAULT(S) LIVE` : 'NOMINAL'}
              </span>
            </div>

            {/* Target Region Selector Pills for Fiber Cut */}
            <div className="mt-3">
              <div className="mb-1.5 font-mono text-[10.5px] uppercase tracking-wider text-dim">
                {copy.targetRegionLabel}
              </div>
              <div className="grid grid-cols-5 gap-1.5">
                {cluster.regions.map((r) => {
                  const cut = !r.reachable;
                  const active = selectedRegion === r.id;
                  return (
                    <button
                      key={r.id}
                      type="button"
                      data-testid={`select-region-${r.id}`}
                      onClick={() => setSelectedRegion(r.id)}
                      className={`rounded-lg border px-1.5 py-1.5 text-center font-mono text-[10.5px] font-bold transition ${
                        active
                          ? 'border-cyan-500 bg-cyan-500/18 text-cyan-700 dark:text-cyan-200'
                          : cut
                            ? 'border-rose-500/50 bg-rose-500/12 text-rose-600 dark:text-rose-300'
                            : 'surface-inset text-dim hover:border-cyan-500/50 hover:text-heading'
                      }`}
                    >
                      <div>{r.shortCode}</div>
                      <div className="text-[8.5px] font-normal opacity-80">
                        {cut ? 'CUT' : r.role === 'LEADER' ? 'LDR' : 'OK'}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* 5 Mandatory Chaos Fault Controls */}
            <div className="mt-3.5 space-y-2">
              <button
                type="button"
                data-testid="chaos-cut-fiber"
                onClick={() => onCutRegionFiber(selectedRegion)}
                className={`flex w-full items-center justify-between gap-2 rounded-xl border px-3.5 py-2.5 text-left text-xs font-semibold transition ${
                  isSelectedCut
                    ? 'border-rose-500/70 bg-rose-500/15 text-rose-700 dark:text-rose-200'
                    : 'surface-inset text-body hover:border-rose-500/60 hover:text-heading'
                }`}
              >
                <span className="flex min-w-0 items-center gap-2">
                  <Scissors className="h-3.5 w-3.5 shrink-0 text-rose-500" />
                  <span className="truncate">
                    {isSelectedCut ? copy.btnReconnectFiber : copy.btnCutFiber} ({selectedRegionNode.shortCode})
                  </span>
                </span>
                <span
                  className={`shrink-0 rounded px-2 py-0.5 font-mono text-[10px] font-bold ${
                    isSelectedCut
                      ? 'bg-rose-500 text-white'
                      : 'surface-chip border text-dim'
                  }`}
                >
                  {isSelectedCut ? 'SEVERED' : 'CUT'}
                </span>
              </button>

              <button
                type="button"
                data-testid="chaos-tail-latency"
                onClick={onToggleTailLatency}
                className={`flex w-full items-center justify-between gap-2 rounded-xl border px-3.5 py-2.5 text-left text-xs font-semibold transition ${
                  cluster.faults.tailLatency180Ms
                    ? 'border-amber-500/70 bg-amber-500/15 text-amber-800 dark:text-amber-200'
                    : 'surface-inset text-body hover:border-amber-500/60 hover:text-heading'
                }`}
              >
                <span className="flex min-w-0 items-center gap-2">
                  <Timer className="h-3.5 w-3.5 shrink-0 text-amber-500" />
                  <span className="truncate">{copy.btnTailLatency}</span>
                </span>
                <span
                  className={`shrink-0 rounded px-2 py-0.5 font-mono text-[10px] font-bold ${
                    cluster.faults.tailLatency180Ms
                      ? 'bg-amber-500 text-slate-950'
                      : 'surface-chip border text-dim'
                  }`}
                >
                  {cluster.faults.tailLatency180Ms ? '+180ms' : 'OFF'}
                </span>
              </button>

              <button
                type="button"
                data-testid="chaos-redis-stampede"
                onClick={onToggleRedisStampede}
                className={`flex w-full items-center justify-between gap-2 rounded-xl border px-3.5 py-2.5 text-left text-xs font-semibold transition ${
                  cluster.faults.redisCacheStampede
                    ? 'border-amber-500/70 bg-amber-500/15 text-amber-800 dark:text-amber-200'
                    : 'surface-inset text-body hover:border-amber-500/60 hover:text-heading'
                }`}
              >
                <span className="flex min-w-0 items-center gap-2">
                  <Zap className="h-3.5 w-3.5 shrink-0 text-amber-500" />
                  <span className="truncate">{copy.btnRedisStampede}</span>
                </span>
                <span
                  className={`shrink-0 rounded px-2 py-0.5 font-mono text-[10px] font-bold ${
                    cluster.faults.redisCacheStampede
                      ? 'bg-amber-500 text-slate-950'
                      : 'surface-chip border text-dim'
                  }`}
                >
                  {cluster.faults.redisCacheStampede ? 'ACTIVE' : 'OFF'}
                </span>
              </button>

              <button
                type="button"
                data-testid="chaos-db-exhaustion"
                onClick={onToggleDbExhaustion}
                className={`flex w-full items-center justify-between gap-2 rounded-xl border px-3.5 py-2.5 text-left text-xs font-semibold transition ${
                  cluster.faults.dbConnectionExhaustion
                    ? 'border-rose-500/70 bg-rose-500/15 text-rose-700 dark:text-rose-200'
                    : 'surface-inset text-body hover:border-rose-500/60 hover:text-heading'
                }`}
              >
                <span className="flex min-w-0 items-center gap-2">
                  <Database className="h-3.5 w-3.5 shrink-0 text-rose-500" />
                  <span className="truncate">{copy.btnDbExhaustion}</span>
                </span>
                <span
                  className={`shrink-0 rounded px-2 py-0.5 font-mono text-[10px] font-bold ${
                    cluster.faults.dbConnectionExhaustion
                      ? 'bg-rose-500 text-white'
                      : 'surface-chip border text-dim'
                  }`}
                >
                  {cluster.faults.dbConnectionExhaustion ? '99% POOL' : 'OFF'}
                </span>
              </button>

              <button
                type="button"
                data-testid="chaos-restore-all"
                onClick={onRestoreAll}
                className="flex w-full items-center justify-center gap-2 rounded-xl border border-emerald-500/45 bg-emerald-500/12 px-3.5 py-2.5 text-xs font-extrabold text-emerald-700 transition hover:bg-emerald-500/22 dark:text-emerald-300"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                {copy.btnRestoreAll}
              </button>
            </div>
          </div>

          {/* Live Raft Event Ticker */}
          <div className="surface-panel flex-1 rounded-2xl border p-4">
            <div className="mb-2 flex items-center justify-between">
              <span className="flex items-center gap-1.5 font-mono text-[10.5px] font-bold uppercase tracking-wider text-dim">
                <Activity className="h-3.5 w-3.5 text-cyan-500" />
                {copy.eventFeedTitle}
              </span>
              <span className="font-mono text-[10px] text-faint">
                {cluster.events.length} events
              </span>
            </div>
            <div className="max-h-32 space-y-1.5 overflow-y-auto pr-1">
              {cluster.events.slice(0, 6).map((evt) => (
                <div
                  key={evt.id}
                  className="surface-inset rounded-lg border px-2.5 py-1.5 font-mono text-[10.5px]"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span
                      className={`font-bold ${
                        evt.severity === 'CRITICAL'
                          ? 'text-rose-500 dark:text-rose-400'
                          : evt.severity === 'WARN'
                            ? 'text-amber-600 dark:text-amber-300'
                            : evt.severity === 'RECOVERY'
                              ? 'text-emerald-600 dark:text-emerald-300'
                              : 'text-cyan-600 dark:text-cyan-300'
                      }`}
                    >
                      {evt.code}
                    </span>
                    <span className="text-[9.5px] text-faint">{evt.timestampUtc}</span>
                  </div>
                  <p className="mt-0.5 leading-snug text-dim">{evt.message}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

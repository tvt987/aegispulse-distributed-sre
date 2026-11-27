import { useState } from 'react';
import {
  Activity,
  AlertTriangle,
  Globe,
  Lock,
  Radio,
  RotateCcw,
  ServerCrash,
  ShieldAlert,
  ShieldCheck,
  Timer,
  Unplug,
  Zap,
} from 'lucide-react';
import {
  applyQuorumScenario,
  createInitialQuorumLabState,
  cycleRegionHealthState,
  setRegionHealthState,
  type QuorumLabState,
  type QuorumNodeHealthState,
  type QuorumRegionId,
} from '../engines/quorumFailoverEngine';
import type { ThemeMode } from '../engine/types';
import type { LangMode } from '../i18n/translations';

interface QuorumFailoverLabProps {
  lang: LangMode;
  theme: ThemeMode;
}

const HEALTH_STATES: QuorumNodeHealthState[] = ['ONLINE', 'PARTITIONED', 'HARD_CRASH'];

export function QuorumFailoverLab({ lang, theme }: QuorumFailoverLabProps) {
  const [lab, setLab] = useState<QuorumLabState>(() => createInitialQuorumLabState());
  const isVi = lang === 'vi';
  const isDark = theme === 'dark';

  const regionById = Object.fromEntries(lab.regions.map((r) => [r.id, r])) as Record<
    QuorumRegionId,
    (typeof lab.regions)[number]
  >;

  const handleCycleRegion = (id: QuorumRegionId) => {
    setLab((prev) => cycleRegionHealthState(prev, id));
  };

  const handleSetState = (id: QuorumRegionId, state: QuorumNodeHealthState) => {
    setLab((prev) => setRegionHealthState(prev, id, state));
  };

  const isFenced = lab.clusterWriteMode === 'READ_ONLY_FENCE';

  return (
    <section
      data-testid="quorum-failover-lab"
      className="min-w-0 space-y-5"
      aria-label="5-Region Raft Quorum and Split-Brain Failover Lab"
    >
      {/* Quorum Status Hero Banner */}
      <div
        data-testid="quorum-write-mode-banner"
        className={`rounded-2xl border p-4 sm:p-5 ${
          isFenced
            ? 'border-rose-500/60 bg-gradient-to-r from-rose-500/18 via-rose-500/[0.06] to-transparent dark:from-rose-950/65 dark:via-[#140c1a] dark:to-[#091020]'
            : lab.onlineCount < lab.totalNodes
              ? 'border-amber-500/50 bg-gradient-to-r from-amber-500/14 via-amber-500/[0.04] to-transparent dark:from-amber-950/45 dark:via-[#111320] dark:to-[#091020]'
              : 'border-emerald-500/45 bg-gradient-to-r from-emerald-500/12 via-cyan-500/[0.05] to-transparent dark:from-emerald-950/45 dark:via-[#0b1526] dark:to-[#091020]'
        }`}
      >
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="flex min-w-0 items-start gap-3">
            {isFenced ? (
              <ShieldAlert className="mt-0.5 h-8 w-8 shrink-0 text-rose-500 dark:text-rose-400" />
            ) : lab.onlineCount < lab.totalNodes ? (
              <AlertTriangle className="mt-0.5 h-8 w-8 shrink-0 text-amber-500 dark:text-amber-400" />
            ) : (
              <ShieldCheck className="mt-0.5 h-8 w-8 shrink-0 text-emerald-600 dark:text-emerald-400" />
            )}

            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span
                  data-testid="quorum-write-mode-badge"
                  className={`rounded px-2.5 py-0.5 font-mono text-[11px] font-extrabold uppercase tracking-wider ${
                    isFenced
                      ? 'bg-rose-500/25 text-rose-700 dark:text-rose-200'
                      : 'bg-emerald-500/20 text-emerald-700 dark:text-emerald-300'
                  }`}
                >
                  {lab.clusterWriteMode}
                </span>
                <span className="font-mono text-xs text-dim">
                  Raft Term #{lab.raftTerm} · Quorum {lab.onlineCount}/{lab.totalNodes} (min 3/5) ·
                  RPO {lab.rpoSeconds}s
                </span>
              </div>

              <h1 className="mt-1.5 text-lg font-extrabold tracking-tight text-heading sm:text-xl">
                {isVi
                  ? 'Phong Lab Raft Quorum 5 Vung & Khoa Ghi Chong Split-Brain'
                  : '5-Region Raft Quorum & Split-Brain Failover Lab'}
              </h1>
              <p className="mt-1 text-xs leading-relaxed text-body sm:text-sm">
                {lab.decisionSummary}
              </p>
            </div>
          </div>

          <div className="flex shrink-0 flex-wrap gap-2">
            <button
              type="button"
              data-testid="quorum-preset-primary-crash"
              onClick={() => setLab((prev) => applyQuorumScenario(prev, 'primary-crash'))}
              className="rounded-xl border border-amber-500/45 bg-amber-500/12 px-3 py-2 text-xs font-bold text-amber-800 transition hover:bg-amber-500/20 dark:text-amber-200"
            >
              Crash VN-HCM Primary
            </button>
            <button
              type="button"
              data-testid="quorum-preset-fence"
              onClick={() => setLab((prev) => applyQuorumScenario(prev, 'split-brain-fence'))}
              className="rounded-xl border border-rose-500/45 bg-rose-500/12 px-3 py-2 text-xs font-bold text-rose-700 transition hover:bg-rose-500/20 dark:text-rose-300"
            >
              Kill 3 Regions (Fence)
            </button>
            <button
              type="button"
              data-testid="quorum-preset-nominal"
              onClick={() => setLab((prev) => applyQuorumScenario(prev, 'nominal'))}
              className="surface-chip inline-flex items-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-semibold text-heading transition hover:border-cyan-500"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              Restore 5/5
            </button>
          </div>
        </div>
      </div>

      {/* 6-Card Quorum, Election & RPO/RTO Metrics Strip */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <div className="surface-panel rounded-xl border p-3.5">
          <div className="flex items-center justify-between text-[10.5px] font-semibold uppercase tracking-wider text-dim">
            <span>Write Authority</span>
            <Lock className="h-3.5 w-3.5 text-cyan-500" />
          </div>
          <div
            data-testid="quorum-write-mode-value"
            className={`mt-1 font-mono text-sm font-extrabold sm:text-base ${
              isFenced ? 'text-rose-600 dark:text-rose-400' : 'text-emerald-600 dark:text-emerald-300'
            }`}
          >
            {lab.clusterWriteMode}
          </div>
          <div className="mt-0.5 font-mono text-[10.5px] text-faint">
            {isFenced ? '0 Dual-Writer Leaks' : 'Linearizable Raft'}
          </div>
        </div>

        <div className="surface-panel rounded-xl border p-3.5">
          <div className="flex items-center justify-between text-[10.5px] font-semibold uppercase tracking-wider text-dim">
            <span>Elected Leader</span>
            <Zap className="h-3.5 w-3.5 text-emerald-500" />
          </div>
          <div
            data-testid="quorum-leader-value"
            className="mt-1 truncate font-mono text-sm font-extrabold text-heading sm:text-base"
          >
            {lab.electedLeaderName ?? 'NONE (FENCED)'}
          </div>
          <div data-testid="quorum-term-value" className="mt-0.5 font-mono text-[10.5px] text-faint">
            Raft Term #{lab.raftTerm}
          </div>
        </div>

        <div className="surface-panel rounded-xl border p-3.5">
          <div className="flex items-center justify-between text-[10.5px] font-semibold uppercase tracking-wider text-dim">
            <span>Voting Quorum</span>
            <Globe className="h-3.5 w-3.5 text-sky-500" />
          </div>
          <div
            data-testid="quorum-online-count"
            className={`mt-1 font-mono text-base font-extrabold ${
              lab.hasQuorum
                ? 'text-cyan-600 dark:text-cyan-300'
                : 'text-rose-600 dark:text-rose-400'
            }`}
          >
            {lab.onlineCount} / {lab.totalNodes}
          </div>
          <div className="mt-0.5 font-mono text-[10.5px] text-faint">
            Min {lab.quorumRequired}/5 Required
          </div>
        </div>

        <div className="surface-panel rounded-xl border p-3.5">
          <div className="flex items-center justify-between text-[10.5px] font-semibold uppercase tracking-wider text-dim">
            <span>Majority RTT</span>
            <Radio className="h-3.5 w-3.5 text-cyan-500" />
          </div>
          <div className="mt-1 font-mono text-base font-extrabold text-heading">
            {lab.hasQuorum ? `${lab.quorumCommitRttMs} ms` : 'HALTED'}
          </div>
          <div className="mt-0.5 font-mono text-[10.5px] text-faint">
            Mesh Avg: {lab.avgHealthyRttMs} ms
          </div>
        </div>

        <div className="surface-panel rounded-xl border p-3.5">
          <div className="flex items-center justify-between text-[10.5px] font-semibold uppercase tracking-wider text-dim">
            <span>Max WAL Lag</span>
            <Activity className="h-3.5 w-3.5 text-amber-500" />
          </div>
          <div className="mt-1 font-mono text-base font-extrabold text-heading">
            {lab.hasQuorum ? `${lab.maxWalLagMs} ms` : 'FENCED'}
          </div>
          <div className="mt-0.5 font-mono text-[10.5px] text-faint">
            {lab.partitionedCount} part · {lab.crashedCount} crash
          </div>
        </div>

        <div className="surface-panel rounded-xl border p-3.5">
          <div className="flex items-center justify-between text-[10.5px] font-semibold uppercase tracking-wider text-dim">
            <span>RPO / RTO</span>
            <Timer className="h-3.5 w-3.5 text-emerald-500" />
          </div>
          <div className="mt-1 font-mono text-sm font-extrabold text-emerald-600 dark:text-emerald-300 sm:text-base">
            RPO {lab.rpoSeconds}s
          </div>
          <div className="mt-0.5 truncate font-mono text-[10.5px] text-faint">{lab.rtoLabel}</div>
        </div>
      </div>

      {/* Main Split: Interactive SVG 5-Region Mesh Topology + Region State Controls */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
        {/* Left: SVG 5-Region Mesh Topology */}
        <div className="surface-panel min-w-0 rounded-2xl border p-4 sm:p-5 lg:col-span-7">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="flex items-center gap-2 text-sm font-bold text-heading">
                <Globe className="h-4 w-4 text-cyan-500" />
                {isVi
                  ? 'So Do Luoi Raft 5 Vung (Nhấp Node De Chuyen ONLINE / PARTITIONED / HARD CRASH)'
                  : 'Interactive SVG 5-Region Mesh Topology (Click Any Node to Cycle State)'}
              </h2>
              <p className="mt-0.5 text-xs text-dim">
                {isVi
                  ? 'Click truc tiep tung vung de mo phong đut cap hoac sập trung tâm du lieu; < 3/5 node sống sẽ tụ dong kich hoat READ_ONLY_FENCE.'
                  : 'Click any region node to cycle ONLINE -> PARTITIONED -> HARD CRASH. Dropping below 3/5 online triggers READ_ONLY_FENCE immediately.'}
              </p>
            </div>
          </div>

          <div className="mt-3 w-full overflow-x-auto rounded-xl border border-hairline surface-inset p-2">
            <svg
              data-testid="quorum-topology-svg"
              viewBox="0 0 820 340"
              className="mx-auto block h-auto w-full min-w-[540px]"
              role="img"
              aria-label="Interactive 5-Region Raft Quorum Mesh Topology"
            >
              {/* Subtle Global Grid Lines */}
              <g stroke={isDark ? 'rgba(148,163,184,0.08)' : 'rgba(15,23,42,0.07)'} strokeWidth="1">
                <line x1="20" y1="85" x2="800" y2="85" strokeDasharray="4 6" />
                <line x1="20" y1="170" x2="800" y2="170" strokeDasharray="4 6" />
                <line x1="20" y1="255" x2="800" y2="255" strokeDasharray="4 6" />
                <line x1="205" y1="20" x2="205" y2="320" strokeDasharray="4 6" />
                <line x1="410" y1="20" x2="410" y2="320" strokeDasharray="4 6" />
                <line x1="615" y1="20" x2="615" y2="320" strokeDasharray="4 6" />
              </g>

              {/* 10 Pairwise Mesh Links */}
              {lab.edges.map((edge) => {
                const a = regionById[edge.from];
                const b = regionById[edge.to];
                const midX = (a.x + b.x) / 2;
                const midY = (a.y + b.y) / 2;

                if (edge.status === 'SEVERED') {
                  return (
                    <line
                      key={edge.id}
                      x1={a.x}
                      y1={a.y}
                      x2={b.x}
                      y2={b.y}
                      stroke="rgba(244, 63, 94, 0.35)"
                      strokeWidth="1.4"
                      strokeDasharray="5 6"
                    />
                  );
                }

                if (edge.isLeaderLink) {
                  return (
                    <g key={edge.id}>
                      <line
                        x1={a.x}
                        y1={a.y}
                        x2={b.x}
                        y2={b.y}
                        stroke="rgba(6, 182, 212, 0.28)"
                        strokeWidth="3.5"
                      />
                      <line
                        x1={a.x}
                        y1={a.y}
                        x2={b.x}
                        y2={b.y}
                        stroke="#22d3ee"
                        strokeWidth="2"
                        className="animate-packet"
                      />
                      <rect
                        x={midX - 22}
                        y={midY - 9}
                        width={44}
                        height={18}
                        rx={5}
                        fill={isDark ? '#060c1a' : '#f8fafc'}
                        stroke="rgba(6, 182, 212, 0.55)"
                      />
                      <text
                        x={midX}
                        y={midY + 3.5}
                        textAnchor="middle"
                        fill={isDark ? '#67e8f9' : '#0e7490'}
                        fontSize="9.5"
                        fontFamily="JetBrains Mono, monospace"
                        fontWeight="700"
                      >
                        {edge.rttMs}ms
                      </text>
                    </g>
                  );
                }

                return (
                  <line
                    key={edge.id}
                    x1={a.x}
                    y1={a.y}
                    x2={b.x}
                    y2={b.y}
                    stroke={isDark ? 'rgba(100, 116, 139, 0.35)' : 'rgba(148, 163, 184, 0.55)'}
                    strokeWidth="1.2"
                  />
                );
              })}

              {/* 5 Interactive Region Nodes */}
              {lab.regions.map((node) => {
                const isLeader = node.role === 'LEADER';
                const isNodeFenced = node.role === 'FENCED';
                const isPart = node.state === 'PARTITIONED';
                const isCrash = node.state === 'HARD_CRASH';

                const strokeColor = isLeader
                  ? '#22d3ee'
                  : isNodeFenced
                    ? '#fb7185'
                    : isPart
                      ? '#f59e0b'
                      : isCrash
                        ? '#e11d48'
                        : '#10b981';

                const fillBg = isDark ? '#091224' : '#ffffff';

                return (
                  <g
                    key={node.id}
                    data-testid={`quorum-svg-node-${node.id}`}
                    onClick={() => handleCycleRegion(node.id)}
                    style={{ cursor: 'pointer' }}
                  >
                    {/* Outer Halo Ring */}
                    <circle
                      cx={node.x}
                      cy={node.y}
                      r={isLeader ? 39 : 33}
                      fill="none"
                      stroke={strokeColor}
                      strokeOpacity={isLeader ? 0.5 : 0.25}
                      strokeWidth={isLeader ? 2.5 : 1.5}
                      strokeDasharray={isPart ? '4 4' : undefined}
                    />

                    {/* Main Node Circle */}
                    <circle
                      cx={node.x}
                      cy={node.y}
                      r={28}
                      fill={fillBg}
                      stroke={strokeColor}
                      strokeWidth={isLeader ? 3 : 2}
                    />

                    {/* Short Code */}
                    <text
                      x={node.x}
                      y={node.y - 2}
                      textAnchor="middle"
                      fill={isDark ? '#f8fafc' : '#0f172a'}
                      fontSize="12"
                      fontFamily="JetBrains Mono, monospace"
                      fontWeight="800"
                    >
                      {node.shortCode}
                    </text>

                    {/* Role Pill Inside Circle */}
                    <text
                      x={node.x}
                      y={node.y + 12}
                      textAnchor="middle"
                      fill={strokeColor}
                      fontSize="8.5"
                      fontFamily="JetBrains Mono, monospace"
                      fontWeight="700"
                    >
                      {node.role}
                    </text>

                    {/* Region Name Tag Below Node */}
                    <rect
                      x={node.x - 58}
                      y={node.y + 33}
                      width={116}
                      height={22}
                      rx={6}
                      fill={isDark ? 'rgba(6, 11, 23, 0.92)' : 'rgba(255, 255, 255, 0.95)'}
                      stroke={strokeColor}
                      strokeOpacity={0.55}
                    />
                    <text
                      x={node.x}
                      y={node.y + 47.5}
                      textAnchor="middle"
                      fill={isDark ? '#e2e8f0' : '#0f172a'}
                      fontSize="9.5"
                      fontFamily="JetBrains Mono, monospace"
                      fontWeight="700"
                    >
                      {node.displayName}
                    </text>
                  </g>
                );
              })}

              {/* Fenced Overlay Pill in Top Right when Quorum < 3/5 */}
              {isFenced && (
                <g>
                  <rect
                    x={548}
                    y={14}
                    width={256}
                    height={28}
                    rx={8}
                    fill="rgba(225, 29, 72, 0.22)"
                    stroke="#fb7185"
                    strokeWidth="1.5"
                  />
                  <text
                    x={676}
                    y={32}
                    textAnchor="middle"
                    fill={isDark ? '#fecdd3' : '#be123c'}
                    fontSize="11"
                    fontFamily="JetBrains Mono, monospace"
                    fontWeight="800"
                  >
                    SPLIT-BRAIN FENCE: READ_ONLY_FENCE
                  </text>
                </g>
              )}
            </svg>
          </div>

          {/* Topology Legend */}
          <div className="mt-3 flex flex-wrap items-center gap-4 font-mono text-[11px] text-dim">
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full bg-cyan-400" />
              Leader (Write Authority)
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full bg-emerald-400" />
              Follower (Sync WAL)
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full bg-amber-400" />
              Partitioned (Isolated)
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full bg-rose-500" />
              Hard Crash / Fenced
            </span>
          </div>
        </div>

        {/* Right: 5 Region Controls + Election Audit Log */}
        <div className="min-w-0 space-y-4 lg:col-span-5">
          <div className="surface-panel rounded-2xl border p-4">
            <h3 className="text-sm font-bold text-heading">
              {isVi ? 'Dieu Khien Trang Thai 5 Vung' : 'Per-Region Fault Injection Controls'}
            </h3>
            <p className="mt-0.5 text-xs text-dim">
              {isVi
                ? 'Chon truc tiep ONLINE, PARTITIONED hoac HARD CRASH cho tung vung.'
                : 'Set any region directly to ONLINE, PARTITIONED, or HARD CRASH.'}
            </p>

            <div className="mt-3 space-y-2.5">
              {lab.regions.map((node) => (
                <div
                  key={node.id}
                  data-testid={`quorum-card-${node.id}`}
                  className="surface-inset rounded-xl border p-2.5"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs font-extrabold text-heading">
                          {node.displayName}
                        </span>
                        <span
                          className={`rounded px-1.5 py-0.5 font-mono text-[10px] font-bold ${
                            node.role === 'LEADER'
                              ? 'bg-cyan-500/20 text-cyan-700 dark:text-cyan-300'
                              : node.role === 'FOLLOWER'
                                ? 'bg-emerald-500/20 text-emerald-700 dark:text-emerald-300'
                                : node.role === 'PARTITIONED'
                                  ? 'bg-amber-500/20 text-amber-700 dark:text-amber-300'
                                  : 'bg-rose-500/20 text-rose-700 dark:text-rose-300'
                          }`}
                        >
                          {node.role}
                        </span>
                      </div>
                      <div className="mt-0.5 font-mono text-[10.5px] text-dim">
                        RTT: {node.state === 'ONLINE' ? `${node.rttToLeaderMs}ms` : 'N/A'} · WAL Lag:{' '}
                        {node.state === 'ONLINE' ? `${node.walLagMs}ms` : 'STALE'} · Token #{node.fencingToken}
                      </div>
                    </div>

                    <div className="flex items-center gap-1">
                      {HEALTH_STATES.map((st) => {
                        const active = node.state === st;
                        const btnTone = active
                          ? st === 'ONLINE'
                            ? 'bg-emerald-500 text-slate-950 font-extrabold'
                            : st === 'PARTITIONED'
                              ? 'bg-amber-500 text-slate-950 font-extrabold'
                              : 'bg-rose-500 text-white font-extrabold'
                          : 'surface-chip text-dim hover:text-heading';

                        return (
                          <button
                            key={st}
                            type="button"
                            data-testid={`quorum-btn-${node.id}-${st}`}
                            onClick={() => handleSetState(node.id, st)}
                            className={`inline-flex items-center gap-1 rounded-md border border-transparent px-2 py-1 font-mono text-[10px] transition ${btnTone}`}
                          >
                            {st === 'PARTITIONED' && <Unplug className="h-2.5 w-2.5" />}
                            {st === 'HARD_CRASH' && <ServerCrash className="h-2.5 w-2.5" />}
                            {st === 'ONLINE' ? 'ONLINE' : st === 'PARTITIONED' ? 'PART' : 'CRASH'}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Live Raft Election & Split-Brain Audit Feed */}
          <div className="surface-panel rounded-2xl border p-4">
            <h3 className="text-xs font-bold uppercase tracking-wider text-dim">
              {isVi ? 'Nhat Ky Bau Chon Raft & Khoa Split-Brain' : 'Raft Election & Split-Brain Audit Log'}
            </h3>
            <div className="mt-2.5 max-h-44 space-y-1.5 overflow-y-auto pr-1">
              {lab.auditLog.map((evt) => (
                <div
                  key={evt.id}
                  className="surface-inset rounded-lg border px-2.5 py-2 font-mono text-[11px]"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span
                      className={`font-bold ${
                        evt.severity === 'CRITICAL'
                          ? 'text-rose-600 dark:text-rose-400'
                          : evt.severity === 'WARN'
                            ? 'text-amber-600 dark:text-amber-300'
                            : evt.severity === 'RECOVERY'
                              ? 'text-emerald-600 dark:text-emerald-300'
                              : 'text-cyan-600 dark:text-cyan-300'
                      }`}
                    >
                      [{evt.code}]
                    </span>
                    <span className="text-[10px] text-faint">Term #{evt.term}</span>
                  </div>
                  <p className="mt-0.5 leading-snug text-body">{evt.message}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

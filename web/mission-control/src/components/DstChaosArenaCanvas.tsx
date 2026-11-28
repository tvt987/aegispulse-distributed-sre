import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  Cpu,
  Database,
  History,
  Pause,
  Play,
  Power,
  RefreshCw,
  RotateCcw,
  Scissors,
  ShieldAlert,
  ShieldCheck,
  Shuffle,
  Split,
  Waves,
  Zap,
} from 'lucide-react';
import type { ThemeMode } from '../engine/types';
import {
  applySplitBrainPreset,
  blastVoucherStorm,
  createInitialDstCluster,
  DEFAULT_DST_SEED,
  deriveNextSeed,
  DST_CANVAS_H,
  DST_CANVAS_W,
  DST_FIXED_STEP_MS,
  DST_REGION_ORDER,
  evaluateQuadraticBezier,
  findClosestLinkAtPoint,
  findNodeAtPoint,
  formatRowVersionHex,
  getSnapshotAtTick,
  healAllDstFaults,
  normalizeSeed,
  PARTITION_WALL_X,
  REDIS_FENCE_ANCHOR,
  replayDstSimulation,
  setDstEngineMode,
  setDstLinkStatus,
  SQL_ROWVERSION_ANCHOR,
  stepDstCluster,
  toggleDstLinkScissors,
  toggleDstNodeCrash,
  type DstClusterSnapshot,
  type DstClusterState,
  type DstEngineMode,
  type DstHistoryEvent,
  type DstHistoryKind,
  type DstPacketKind,
  type DstRaftRole,
  type DstRegionId,
} from '../engines/dstChaosClusterEngine';
import type { LangMode } from '../i18n/translations';

export type DstCanvasTool = 'SCISSORS' | 'CRASH_NODE' | 'DEGRADE_LINK';

interface Props {
  lang: LangMode;
  theme: ThemeMode;
  onOpenVoucherLab?: () => void;
}

const PACKET_PALETTE: Record<DstPacketKind, { core: string; trail: string; glow: string }> = {
  HEARTBEAT: { core: '#67e8f9', trail: 'rgba(34, 211, 238, 0.52)', glow: 'rgba(6, 182, 212, 0.45)' },
  REQUEST_VOTE: { core: '#c4b5fd', trail: 'rgba(167, 139, 250, 0.62)', glow: 'rgba(139, 92, 246, 0.55)' },
  VOTE_GRANTED: { core: '#d8b4fe', trail: 'rgba(192, 132, 252, 0.65)', glow: 'rgba(168, 85, 247, 0.55)' },
  VOUCHER_COMMITTED_200: { core: '#6ee7b7', trail: 'rgba(52, 211, 153, 0.72)', glow: 'rgba(16, 185, 129, 0.65)' },
  VOUCHER_FENCED_409: { core: '#fcd34d', trail: 'rgba(251, 191, 36, 0.68)', glow: 'rgba(245, 158, 11, 0.55)' },
  DOUBLE_SPEND_LEAK: { core: '#ff4d6d', trail: 'rgba(255, 23, 68, 0.85)', glow: 'rgba(255, 23, 68, 0.75)' },
  LOG_CATCHUP: { core: '#34d399', trail: 'rgba(16, 185, 129, 0.65)', glow: 'rgba(16, 185, 129, 0.55)' },
};

const HISTORY_BADGE_COLORS: Record<DstHistoryKind, { dot: string; label: string; badge: string }> = {
  COMMITTED_200: {
    dot: 'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.85)]',
    label: '200 COMMIT',
    badge: 'border-emerald-500/40 bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
  },
  FENCED_409: {
    dot: 'bg-amber-400 shadow-[0_0_7px_rgba(251,191,36,0.75)]',
    label: '409 FENCED',
    badge: 'border-amber-500/40 bg-amber-500/15 text-amber-800 dark:text-amber-300',
  },
  DOUBLE_SPEND_LEAK: {
    dot: 'bg-rose-500 shadow-[0_0_10px_rgba(244,63,94,0.95)] ring-2 ring-rose-400/50',
    label: 'LEAK!',
    badge: 'border-rose-500/60 bg-rose-500/20 text-rose-700 dark:text-rose-200',
  },
  LEADER_ELECTED: {
    dot: 'bg-violet-400 shadow-[0_0_8px_rgba(167,139,250,0.85)]',
    label: 'ELECTED',
    badge: 'border-violet-500/40 bg-violet-500/15 text-violet-700 dark:text-violet-300',
  },
  LINK_CUT: {
    dot: 'bg-rose-400',
    label: 'LINK CUT',
    badge: 'border-rose-500/40 bg-rose-500/12 text-rose-700 dark:text-rose-300',
  },
  LINK_HEALED: {
    dot: 'bg-teal-400',
    label: 'HEALED',
    badge: 'border-teal-500/40 bg-teal-500/12 text-teal-700 dark:text-teal-300',
  },
  LINK_DEGRADED: {
    dot: 'bg-amber-500',
    label: '+220ms',
    badge: 'border-amber-500/40 bg-amber-500/12 text-amber-800 dark:text-amber-300',
  },
  NODE_CRASH: {
    dot: 'bg-rose-600 ring-1 ring-rose-300/60',
    label: 'CRASHED',
    badge: 'border-rose-500/50 bg-rose-500/18 text-rose-700 dark:text-rose-200',
  },
  NODE_REVIVE: {
    dot: 'bg-cyan-400',
    label: 'REVIVED',
    badge: 'border-cyan-500/40 bg-cyan-500/15 text-cyan-700 dark:text-cyan-300',
  },
  PARTITION_WALL: {
    dot: 'bg-rose-500 ring-2 ring-rose-500/40',
    label: 'SPLIT 2v3',
    badge: 'border-rose-500/55 bg-rose-500/18 text-rose-700 dark:text-rose-200',
  },
};

function drawRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) {
  const rad = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rad, y);
  ctx.lineTo(x + w - rad, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + rad);
  ctx.lineTo(x + w, y + h - rad);
  ctx.quadraticCurveTo(x + w, y + h, x + w - rad, y + h);
  ctx.lineTo(x + rad, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - rad);
  ctx.lineTo(x, y + rad);
  ctx.quadraticCurveTo(x, y, x + rad, y);
  ctx.closePath();
}

function drawHexagonPath(ctx: CanvasRenderingContext2D, cx: number, cy: number, radius: number) {
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const angle = (Math.PI / 3) * i - Math.PI / 2;
    const vx = cx + Math.cos(angle) * radius;
    const vy = cy + Math.sin(angle) * radius;
    if (i === 0) ctx.moveTo(vx, vy);
    else ctx.lineTo(vx, vy);
  }
  ctx.closePath();
}

// Crisp canvas vector scissors icon — zero Unicode emojis!
function drawVectorScissors(ctx: CanvasRenderingContext2D, cx: number, cy: number, color: string) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.85;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  // Blades crossed
  ctx.beginPath();
  ctx.moveTo(-4, -3);
  ctx.lineTo(7, 4.5);
  ctx.moveTo(-4, 3);
  ctx.lineTo(7, -4.5);
  ctx.stroke();

  // Handle rings
  ctx.beginPath();
  ctx.arc(-6.2, -4.2, 2.5, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(-6.2, 4.2, 2.5, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

// Crisp canvas vector crown glyph for active Raft Leader
function drawVectorCrown(ctx: CanvasRenderingContext2D, cx: number, cy: number, color: string) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(-7, 3);
  ctx.lineTo(-8, -4);
  ctx.lineTo(-3, 0);
  ctx.lineTo(0, -5.5);
  ctx.lineTo(3, 0);
  ctx.lineTo(8, -4);
  ctx.lineTo(7, 3);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

// Crisp canvas vector X mark for crashed offline node
function drawVectorCross(ctx: CanvasRenderingContext2D, cx: number, cy: number, size: number, color: string) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 2.6;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(cx - size, cy - size);
  ctx.lineTo(cx + size, cy + size);
  ctx.moveTo(cx + size, cy - size);
  ctx.lineTo(cx - size, cy + size);
  ctx.stroke();
  ctx.restore();
}

function getRolePalette(role: DstRaftRole, isDark: boolean) {
  switch (role) {
    case 'LEADER':
      return {
        stroke: '#10b981',
        accent: '#22d3ee',
        fill: isDark ? '#072227' : '#ecfdf5',
        glow: 'rgba(16, 185, 129, 0.42)',
        badgeBg: isDark ? 'rgba(16, 185, 129, 0.22)' : 'rgba(16, 185, 129, 0.16)',
        badgeText: isDark ? '#6ee7b7' : '#047857',
        label: 'LEADER',
      };
    case 'CANDIDATE':
      return {
        stroke: '#a78bfa',
        accent: '#c4b5fd',
        fill: isDark ? '#1a1230' : '#f5f3ff',
        glow: 'rgba(167, 139, 250, 0.48)',
        badgeBg: isDark ? 'rgba(167, 139, 250, 0.22)' : 'rgba(139, 92, 246, 0.14)',
        badgeText: isDark ? '#ddd6fe' : '#6d28d9',
        label: 'CANDIDATE',
      };
    case 'STALE_LEADER_FENCED':
      return {
        stroke: '#f59e0b',
        accent: '#f43f5e',
        fill: isDark ? '#271414' : '#fffbeb',
        glow: 'rgba(245, 158, 11, 0.46)',
        badgeBg: isDark ? 'rgba(245, 158, 11, 0.24)' : 'rgba(245, 158, 11, 0.18)',
        badgeText: isDark ? '#fde68a' : '#b45309',
        label: 'STALE FENCED',
      };
    case 'OFFLINE':
      return {
        stroke: '#f43f5e',
        accent: '#64748b',
        fill: isDark ? '#140c14' : '#fff1f2',
        glow: 'rgba(244, 63, 94, 0.24)',
        badgeBg: isDark ? 'rgba(244, 63, 94, 0.24)' : 'rgba(244, 63, 94, 0.16)',
        badgeText: isDark ? '#fda4af' : '#be123c',
        label: 'OFFLINE',
      };
    default:
      return {
        stroke: isDark ? '#38bdf8' : '#0284c7',
        accent: '#22d3ee',
        fill: isDark ? '#0c1629' : '#f0f9ff',
        glow: 'rgba(56, 189, 248, 0.24)',
        badgeBg: isDark ? 'rgba(56, 189, 248, 0.16)' : 'rgba(2, 132, 199, 0.12)',
        badgeText: isDark ? '#bae6fd' : '#0369a1',
        label: 'FOLLOWER',
      };
  }
}

export function DstChaosArenaCanvas({ lang, theme, onOpenVoucherLab }: Props) {
  const [seedInput, setSeedInput] = useState<string>(String(DEFAULT_DST_SEED));
  const [activeTool, setActiveTool] = useState<DstCanvasTool>('SCISSORS');
  const [paused, setPaused] = useState<boolean>(false);
  const [scrubTickMs, setScrubTickMs] = useState<number | null>(null);
  const [selectedEvent, setSelectedEvent] = useState<DstHistoryEvent | null>(null);
  const [canvasHint, setCanvasHint] = useState<string | null>(null);

  // Live simulation state lives in a ref for 60fps RAF zero-allocation-lag stepping,
  // mirrored into React state at ~15Hz (and immediately on every user click!) for crisp HUD updates.
  const simRef = useRef<DstClusterState>(createInitialDstCluster(DEFAULT_DST_SEED, 'AEGIS_LUA_WAL'));
  const [hudState, setHudState] = useState<DstClusterState>(() => simRef.current);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const hoverRef = useRef<{
    x: number;
    y: number;
    linkId: string | null;
    nodeId: DstRegionId | null;
  }>({ x: -100, y: -100, linkId: null, nodeId: null });

  const uiRef = useRef({
    theme,
    activeTool,
    paused,
    scrubTickMs,
  });

  useEffect(() => {
    uiRef.current = { theme, activeTool, paused, scrubTickMs };
  }, [theme, activeTool, paused, scrubTickMs]);

  const commitSimMutation = useCallback((mutator: (prev: DstClusterState) => DstClusterState) => {
    setScrubTickMs(null);
    const next = mutator(simRef.current);
    simRef.current = next;
    setHudState(next);
  }, []);

  // --- Direct Toolbar Handlers ---

  const handleEngineSwitch = useCallback(
    (engine: DstEngineMode) => {
      commitSimMutation((prev) => setDstEngineMode(prev, engine));
    },
    [commitSimMutation]
  );

  const handleSplitBrain = useCallback(() => {
    setPaused(false);
    commitSimMutation((prev) => applySplitBrainPreset(prev));
  }, [commitSimMutation]);

  const handleBlastStorm = useCallback(() => {
    setPaused(false);
    commitSimMutation((prev) => blastVoucherStorm(prev, 500));
  }, [commitSimMutation]);

  const handleHealAll = useCallback(() => {
    setPaused(false);
    commitSimMutation((prev) => healAllDstFaults(prev));
  }, [commitSimMutation]);

  const handleApplySeed = useCallback((rawSeed: number) => {
    const clean = normalizeSeed(rawSeed);
    setSeedInput(String(clean));
    setScrubTickMs(null);
    setSelectedEvent(null);
    setPaused(false);
    const fresh = createInitialDstCluster(clean, simRef.current.engine);
    simRef.current = fresh;
    setHudState(fresh);
  }, []);

  const handleNewSeed = useCallback(() => {
    const nextSeed = deriveNextSeed(simRef.current.seed);
    handleApplySeed(nextSeed);
  }, [handleApplySeed]);

  const handleReplaySeed = useCallback(() => {
    const { seed, recordedCommands, tickMs } = simRef.current;
    const replayTarget = Math.max(DST_FIXED_STEP_MS * 10, tickMs);
    const initialEngine: DstEngineMode = 'AEGIS_LUA_WAL';
    const replayed = replayDstSimulation(seed, recordedCommands, replayTarget, initialEngine);
    setScrubTickMs(null);
    setSelectedEvent(null);
    simRef.current = replayed;
    setHudState(replayed);
    setCanvasHint(
      `Deterministically replayed DST Seed #${seed} (${recordedCommands.length} chaos commands across ${replayTarget.toLocaleString()}ms)`
    );
  }, []);

  // Clear temporary hint after 3.2s
  useEffect(() => {
    if (!canvasHint) return;
    const t = window.setTimeout(() => setCanvasHint(null), 3200);
    return () => window.clearTimeout(t);
  }, [canvasHint]);

  // --- Pointer Hit-Testing & Direct Canvas Manipulation ---

  const toLogicalCoords = useCallback((clientX: number, clientY: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    return {
      x: ((clientX - rect.left) / rect.width) * DST_CANVAS_W,
      y: ((clientY - rect.top) / rect.height) * DST_CANVAS_H,
    };
  }, []);

  const handleCanvasPointerMove = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      const pt = toLogicalCoords(e.clientX, e.clientY);
      if (!pt) return;
      const state = simRef.current;
      const hitNode = findNodeAtPoint(state.nodes, pt.x, pt.y, 48);
      const hitLink = findClosestLinkAtPoint(state, pt.x, pt.y, 18);
      hoverRef.current = {
        x: pt.x,
        y: pt.y,
        linkId: hitLink?.id ?? null,
        nodeId: hitNode?.id ?? null,
      };
    },
    [toLogicalCoords]
  );

  const handleCanvasPointerLeave = useCallback(() => {
    hoverRef.current = { x: -100, y: -100, linkId: null, nodeId: null };
  }, []);

  const handleCanvasClick = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const pt = toLogicalCoords(e.clientX, e.clientY);
      if (!pt) return;

      const state = simRef.current;
      const tool = uiRef.current.activeTool;

      if (tool === 'CRASH_NODE') {
        const hitNode = findNodeAtPoint(state.nodes, pt.x, pt.y, 50);
        if (hitNode) {
          setPaused(false);
          commitSimMutation((prev) => toggleDstNodeCrash(prev, hitNode.id));
          return;
        }
        // Fallback: if user clicked directly on a link while in Crash tool, inform subtly
        const hitLink = findClosestLinkAtPoint(state, pt.x, pt.y, 18);
        if (hitLink) {
          setCanvasHint('Tip: Switch to Cut / Heal Link (Scissors) to sever network links.');
        }
        return;
      }

      if (tool === 'DEGRADE_LINK') {
        const hitLink = findClosestLinkAtPoint(state, pt.x, pt.y, 20);
        if (hitLink) {
          setPaused(false);
          const nextStatus = hitLink.status === 'DEGRADED' ? 'HEALTHY' : 'DEGRADED';
          commitSimMutation((prev) => setDstLinkStatus(prev, hitLink.id, nextStatus));
          return;
        }
      }

      // Default tool: SCISSORS (prioritize curved mesh links; also allow Shift+Click for +220ms jitter!)
      const hitLink = findClosestLinkAtPoint(state, pt.x, pt.y, 20);
      if (hitLink) {
        setPaused(false);
        if (e.shiftKey) {
          const nextStatus = hitLink.status === 'DEGRADED' ? 'HEALTHY' : 'DEGRADED';
          commitSimMutation((prev) => setDstLinkStatus(prev, hitLink.id, nextStatus));
        } else {
          commitSimMutation((prev) => toggleDstLinkScissors(prev, hitLink.id));
        }
        return;
      }

      // If user clicked directly on a node while holding Scissors, offer instant crash toggle on Alt+Click or guide clearly
      const hitNode = findNodeAtPoint(state.nodes, pt.x, pt.y, 48);
      if (hitNode) {
        if (e.altKey) {
          setPaused(false);
          commitSimMutation((prev) => toggleDstNodeCrash(prev, hitNode.id));
        } else {
          setCanvasHint(
            `Clicked ${hitNode.id} — select "Crash / Revive Node" tool to toggle server power.`
          );
        }
      }
    },
    [toLogicalCoords, commitSimMutation]
  );

  // --- 60fps HiDPI Canvas Render + Fixed-Timestep Deterministic Engine Loop ---

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let rafId = 0;
    let lastFrameMs = performance.now();
    let simAccumulatorMs = 0;
    let hudSyncAccumulatorMs = 0;
    let visualPhase = 0;

    function renderFrame(nowMs: number) {
      if (!canvas || !ctx) return;
      const dtMs = Math.min(60, Math.max(4, nowMs - lastFrameMs));
      lastFrameMs = nowMs;
      visualPhase += dtMs * 0.0024;

      const { theme: currentTheme, activeTool: tool, paused: isPaused, scrubTickMs: scrubTick } =
        uiRef.current;
      const isDark = currentTheme === 'dark';

      // Step deterministic simulation when live (not paused & not scrubbing past snapshots)
      if (!isPaused && scrubTick === null) {
        simAccumulatorMs += dtMs;
        let stepped = false;
        while (simAccumulatorMs >= DST_FIXED_STEP_MS) {
          simRef.current = stepDstCluster(simRef.current, DST_FIXED_STEP_MS);
          simAccumulatorMs -= DST_FIXED_STEP_MS;
          stepped = true;
        }
        hudSyncAccumulatorMs += dtMs;
        if (stepped && hudSyncAccumulatorMs >= 75) {
          hudSyncAccumulatorMs = 0;
          setHudState(simRef.current);
        }
      }

      // Setup HiDPI backing buffer
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const targetW = Math.round(DST_CANVAS_W * dpr);
      const targetH = Math.round(DST_CANVAS_H * dpr);
      if (canvas.width !== targetW || canvas.height !== targetH) {
        canvas.width = targetW;
        canvas.height = targetH;
      }

      ctx.save();
      ctx.scale(dpr, dpr);

      const liveState = simRef.current;
      const scrubSnap: DstClusterSnapshot | null =
        scrubTick !== null ? getSnapshotAtTick(liveState.snapshots, scrubTick) : null;

      // Resolve display topology (either live state OR scrubbed historical snapshot!)
      const displayNodes = liveState.nodes.map((node) => {
        if (!scrubSnap) return node;
        const snapNode = scrubSnap.nodes.find((sn) => sn.id === node.id);
        return snapNode ? { ...node, ...snapNode } : node;
      });
      const displayLinks = liveState.links.map((link) => {
        if (!scrubSnap) return link;
        const snapLink = scrubSnap.links.find((sl) => sl.id === link.id);
        return snapLink ? { ...link, ...snapLink } : link;
      });
      const displayPartitionWall = scrubSnap
        ? scrubSnap.partitionWallActive
        : liveState.partitionWallActive;
      const displayTerm = scrubSnap ? scrubSnap.term : liveState.clusterTerm;
      const displayFencingEpoch = scrubSnap ? scrubSnap.fencingEpoch : liveState.fencingEpoch;
      const displayRowVersion = scrubSnap ? scrubSnap.rowVersionSeq : liveState.rowVersionSeq;
      const displayEngine = scrubSnap ? scrubSnap.engine : liveState.engine;
      const displayMetrics = scrubSnap ? scrubSnap.metrics : liveState.metrics;
      const displayLinear = scrubSnap ? scrubSnap.linearizability : liveState.linearizability;
      const displayLeaderId = scrubSnap ? scrubSnap.leaderId : liveState.leaderId;
      const displayStaleLeaderId = scrubSnap ? scrubSnap.staleLeaderId : liveState.staleLeaderId;

      const nodeMap = new Map(displayNodes.map((n) => [n.id, n]));

      // 1. Atmospheric Background
      const bgGrad = ctx.createRadialGradient(
        DST_CANVAS_W * 0.52,
        DST_CANVAS_H * 0.45,
        40,
        DST_CANVAS_W * 0.52,
        DST_CANVAS_H * 0.5,
        DST_CANVAS_W * 0.65
      );
      if (isDark) {
        bgGrad.addColorStop(0, '#0c1528');
        bgGrad.addColorStop(0.55, '#070d1b');
        bgGrad.addColorStop(1, '#040811');
      } else {
        bgGrad.addColorStop(0, '#ffffff');
        bgGrad.addColorStop(0.65, '#f5f9ff');
        bgGrad.addColorStop(1, '#eaf1fb');
      }
      ctx.fillStyle = bgGrad;
      ctx.fillRect(0, 0, DST_CANVAS_W, DST_CANVAS_H);

      // Subtle tactical dot-grid
      ctx.fillStyle = isDark ? 'rgba(148, 163, 184, 0.09)' : 'rgba(15, 23, 42, 0.06)';
      for (let gx = 24; gx < DST_CANVAS_W; gx += 32) {
        for (let gy = 24; gy < DST_CANVAS_H; gy += 32) {
          ctx.fillRect(gx, gy, 1.5, 1.5);
        }
      }

      // Faint geopolitical orbital rings around center fabric
      ctx.save();
      ctx.strokeStyle = isDark ? 'rgba(56, 189, 248, 0.055)' : 'rgba(2, 132, 199, 0.06)';
      ctx.lineWidth = 1;
      for (const r of [140, 250, 370]) {
        ctx.beginPath();
        ctx.ellipse(DST_CANVAS_W * 0.5, DST_CANVAS_H * 0.5, r * 1.45, r * 0.72, 0, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.restore();

      // 2. Partition Zone Halos & Blazing Crimson Network Partition Wall (when Split-Brain active!)
      if (displayPartitionWall) {
        // Left Minority crimson wash
        const leftGrad = ctx.createLinearGradient(0, 0, PARTITION_WALL_X, 0);
        leftGrad.addColorStop(0, isDark ? 'rgba(244, 63, 94, 0.09)' : 'rgba(244, 63, 94, 0.07)');
        leftGrad.addColorStop(1, isDark ? 'rgba(244, 63, 94, 0.03)' : 'rgba(244, 63, 94, 0.02)');
        ctx.fillStyle = leftGrad;
        ctx.fillRect(0, 0, PARTITION_WALL_X, DST_CANVAS_H);

        // Right Majority emerald wash
        const rightGrad = ctx.createLinearGradient(PARTITION_WALL_X, 0, DST_CANVAS_W, 0);
        rightGrad.addColorStop(0, isDark ? 'rgba(16, 185, 129, 0.04)' : 'rgba(16, 185, 129, 0.03)');
        rightGrad.addColorStop(1, isDark ? 'rgba(16, 185, 129, 0.08)' : 'rgba(16, 185, 129, 0.06)');
        ctx.fillStyle = rightGrad;
        ctx.fillRect(PARTITION_WALL_X, 0, DST_CANVAS_W - PARTITION_WALL_X, DST_CANVAS_H);

        // Zone labels top-left & top-right (dynamically measured for crisp padding)
        ctx.save();
        ctx.font = '700 10px "JetBrains Mono", monospace';
        ctx.textBaseline = 'middle';

        const leftLabel = 'MINORITY (2/5) · STALE WRITES FENCED';
        const leftPillW = Math.ceil(ctx.measureText(leftLabel).width) + 24;
        drawRoundedRect(ctx, 16, 14, leftPillW, 24, 7);
        ctx.fillStyle = isDark ? 'rgba(136, 19, 55, 0.58)' : 'rgba(255, 228, 230, 0.94)';
        ctx.fill();
        ctx.strokeStyle = 'rgba(244, 63, 94, 0.65)';
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.fillStyle = isDark ? '#fda4af' : '#be123c';
        ctx.textAlign = 'center';
        ctx.fillText(leftLabel, 16 + leftPillW / 2, 26.5);

        const rightLabel = 'MAJORITY QUORUM (3/5) · ACTIVE';
        const rightPillW = Math.ceil(ctx.measureText(rightLabel).width) + 24;
        const rightPillX = DST_CANVAS_W - rightPillW - 16;
        drawRoundedRect(ctx, rightPillX, 14, rightPillW, 24, 7);
        ctx.fillStyle = isDark ? 'rgba(6, 78, 59, 0.54)' : 'rgba(209, 250, 229, 0.94)';
        ctx.fill();
        ctx.strokeStyle = 'rgba(16, 185, 129, 0.65)';
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.fillStyle = isDark ? '#6ee7b7' : '#047857';
        ctx.fillText(rightLabel, rightPillX + rightPillW / 2, 26.5);
        ctx.restore();
      }

      // 3. Subtle Data-Fabric Backbone Lines (connecting majority leader to Redis Fence & SQL RowVersion)
      ctx.save();
      const activeLeaderNode = displayLeaderId ? nodeMap.get(displayLeaderId) : null;
      if (activeLeaderNode) {
        ctx.setLineDash([4, 6]);
        ctx.lineWidth = 1.3;
        ctx.strokeStyle =
          displayEngine === 'AEGIS_LUA_WAL'
            ? 'rgba(34, 211, 238, 0.35)'
            : displayEngine === 'ROWVERSION_CAS'
              ? 'rgba(251, 191, 36, 0.35)'
              : 'rgba(244, 63, 94, 0.35)';
        ctx.beginPath();
        ctx.moveTo(activeLeaderNode.x, activeLeaderNode.y);
        ctx.lineTo(REDIS_FENCE_ANCHOR.x, REDIS_FENCE_ANCHOR.y + 22);
        ctx.moveTo(activeLeaderNode.x, activeLeaderNode.y);
        ctx.lineTo(SQL_ROWVERSION_ANCHOR.x, SQL_ROWVERSION_ANCHOR.y - 22);
        ctx.stroke();
      }
      ctx.restore();

      // 4. 10 Full-Mesh Curved Network Links
      const hover = hoverRef.current;
      for (const link of displayLinks) {
        const a = nodeMap.get(link.from);
        const b = nodeMap.get(link.to);
        if (!a || !b) continue;

        const isHovered =
          hover.linkId === link.id && (tool === 'SCISSORS' || tool === 'DEGRADE_LINK');
        const isLeaderLink =
          (link.from === displayLeaderId || link.to === displayLeaderId) &&
          link.status === 'HEALTHY' &&
          a.status !== 'CRASHED' &&
          b.status !== 'CRASHED';

        ctx.save();
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.quadraticCurveTo(link.controlX, link.controlY, b.x, b.y);

        if (link.status === 'SEVERED') {
          ctx.setLineDash([7, 7]);
          ctx.lineDashOffset = -visualPhase * 12;
          ctx.strokeStyle = isHovered
            ? '#fb7185'
            : isDark
              ? 'rgba(244, 63, 94, 0.42)'
              : 'rgba(225, 29, 72, 0.45)';
          ctx.lineWidth = isHovered ? 3.2 : 1.9;
          ctx.stroke();
        } else if (link.status === 'DEGRADED') {
          ctx.setLineDash([9, 5]);
          ctx.lineDashOffset = -visualPhase * 18;
          ctx.strokeStyle = isHovered ? '#fde047' : '#f59e0b';
          ctx.lineWidth = isHovered ? 3.4 : 2.3;
          ctx.shadowColor = 'rgba(245, 158, 11, 0.45)';
          ctx.shadowBlur = 8;
          ctx.stroke();
        } else {
          if (isHovered) {
            ctx.strokeStyle = '#22d3ee';
            ctx.lineWidth = 3.6;
            ctx.shadowColor = 'rgba(34, 211, 238, 0.7)';
            ctx.shadowBlur = 12;
          } else if (isLeaderLink) {
            ctx.strokeStyle = isDark
              ? 'rgba(34, 211, 238, 0.42)'
              : 'rgba(2, 132, 199, 0.36)';
            ctx.lineWidth = 2.1;
          } else {
            ctx.strokeStyle = isDark
              ? 'rgba(148, 163, 184, 0.22)'
              : 'rgba(100, 116, 139, 0.24)';
            ctx.lineWidth = 1.45;
          }
          ctx.stroke();
        }
        ctx.restore();

        // Midpoint badge for SEVERED / DEGRADED / Hovered links
        const mid = evaluateQuadraticBezier(a, { x: link.controlX, y: link.controlY }, b, 0.5);
        if (link.status === 'SEVERED') {
          // Crisp crimson circle + custom Canvas Vector Scissors glyph (ZERO emojis!)
          ctx.save();
          ctx.beginPath();
          ctx.arc(mid.x, mid.y, 13.5, 0, Math.PI * 2);
          ctx.fillStyle = isDark ? '#2a0913' : '#ffe4e6';
          ctx.fill();
          ctx.strokeStyle = isHovered ? '#fda4af' : '#f43f5e';
          ctx.lineWidth = isHovered ? 2.2 : 1.6;
          ctx.shadowColor = 'rgba(244, 63, 94, 0.55)';
          ctx.shadowBlur = 10;
          ctx.stroke();
          drawVectorScissors(ctx, mid.x, mid.y, isDark ? '#fda4af' : '#e11d48');

          // Show compact PARTITION label unless covered by Partition Wall center banner
          if (!displayPartitionWall || Math.abs(mid.y - 208) > 24) {
            drawRoundedRect(ctx, mid.x + 17, mid.y - 9, 66, 18, 5);
            ctx.shadowBlur = 0;
            ctx.fillStyle = isDark ? 'rgba(69, 10, 26, 0.88)' : 'rgba(255, 228, 230, 0.94)';
            ctx.fill();
            ctx.strokeStyle = 'rgba(244, 63, 94, 0.5)';
            ctx.lineWidth = 1;
            ctx.stroke();
            ctx.fillStyle = isDark ? '#fda4af' : '#be123c';
            ctx.font = '700 8.5px "JetBrains Mono", monospace';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText('PARTITION', mid.x + 50, mid.y);
          }
          ctx.restore();
        } else if (link.status === 'DEGRADED') {
          ctx.save();
          drawRoundedRect(ctx, mid.x - 42, mid.y - 10, 84, 20, 6);
          ctx.fillStyle = isDark ? 'rgba(69, 39, 5, 0.92)' : 'rgba(254, 243, 199, 0.96)';
          ctx.fill();
          ctx.strokeStyle = '#f59e0b';
          ctx.lineWidth = 1.2;
          ctx.stroke();
          ctx.fillStyle = isDark ? '#fde68a' : '#b45309';
          ctx.font = '700 9px "JetBrains Mono", monospace';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(`+${link.effectiveLatencyMs}ms JIT`, mid.x, mid.y);
          ctx.restore();
        } else if (isHovered || isLeaderLink) {
          ctx.save();
          const label = `${link.effectiveLatencyMs}ms`;
          drawRoundedRect(ctx, mid.x - 21, mid.y - 9, 42, 18, 5);
          ctx.fillStyle = isHovered
            ? isDark
              ? 'rgba(8, 51, 68, 0.95)'
              : 'rgba(224, 242, 254, 0.96)'
            : isDark
              ? 'rgba(13, 21, 38, 0.85)'
              : 'rgba(255, 255, 255, 0.88)';
          ctx.fill();
          ctx.strokeStyle = isHovered
            ? '#22d3ee'
            : isDark
              ? 'rgba(56, 189, 248, 0.35)'
              : 'rgba(2, 132, 199, 0.3)';
          ctx.lineWidth = 1;
          ctx.stroke();
          ctx.fillStyle = isHovered
            ? isDark
              ? '#67e8f9'
              : '#0369a1'
            : isDark
              ? '#94a3b8'
              : '#475569';
          ctx.font = '600 9px "JetBrains Mono", monospace';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(label, mid.x, mid.y);
          ctx.restore();
        }
      }

      // 5. Blazing Vertical Crimson Network Partition Wall (drawn over severed cross-links!)
      if (displayPartitionWall) {
        ctx.save();
        const wallTop = 64;
        const wallBot = 350;
        const wallCenterY = 208;

        // Wide glowing crimson energy aura
        const auraGrad = ctx.createLinearGradient(PARTITION_WALL_X - 28, 0, PARTITION_WALL_X + 28, 0);
        auraGrad.addColorStop(0, 'rgba(244, 63, 94, 0)');
        auraGrad.addColorStop(0.5, 'rgba(244, 63, 94, 0.36)');
        auraGrad.addColorStop(1, 'rgba(244, 63, 94, 0)');
        ctx.fillStyle = auraGrad;
        ctx.fillRect(PARTITION_WALL_X - 28, wallTop, 56, wallBot - wallTop);

        // Core vertical glowing crimson beam
        ctx.strokeStyle = '#ff2a55';
        ctx.lineWidth = 3.2;
        ctx.shadowColor = 'rgba(255, 23, 68, 0.9)';
        ctx.shadowBlur = 18;
        ctx.beginPath();
        ctx.moveTo(PARTITION_WALL_X, wallTop);
        ctx.lineTo(PARTITION_WALL_X, wallBot);
        ctx.stroke();

        // Animated crackling electric interference filament
        ctx.strokeStyle = '#fda4af';
        ctx.lineWidth = 1.4;
        ctx.shadowBlur = 6;
        ctx.beginPath();
        for (let y = wallTop; y <= wallBot; y += 10) {
          const offset = Math.sin(y * 0.085 + visualPhase * 6) * 5.2;
          if (y === wallTop) ctx.moveTo(PARTITION_WALL_X + offset, y);
          else ctx.lineTo(PARTITION_WALL_X + offset, y);
        }
        ctx.stroke();

        // Center Wall Label Pill
        ctx.shadowBlur = 16;
        ctx.shadowColor = 'rgba(244, 63, 94, 0.55)';
        drawRoundedRect(ctx, PARTITION_WALL_X - 118, wallCenterY - 15, 236, 30, 9);
        ctx.fillStyle = isDark ? '#2d0713' : '#ffe4e6';
        ctx.fill();
        ctx.strokeStyle = '#ff2a55';
        ctx.lineWidth = 1.8;
        ctx.stroke();
        ctx.shadowBlur = 0;

        drawVectorScissors(ctx, PARTITION_WALL_X - 96, wallCenterY, isDark ? '#fda4af' : '#e11d48');
        ctx.fillStyle = isDark ? '#ffe4e6' : '#9f1239';
        ctx.font = '800 10.5px "JetBrains Mono", monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('PARTITION WALL · 2 vs 3', PARTITION_WALL_X + 12, wallCenterY);
        ctx.restore();
      }

      // 6. Central Data Fabric Hubs: Redis Lua Atomic Fence (top) + SQL Server ROWVERSION (bottom)
      ctx.save();
      // Top Hub: Redis Lua Atomic Fence
      const redisW = 304;
      const redisH = 44;
      const redisX = REDIS_FENCE_ANCHOR.x - redisW / 2;
      const redisY = REDIS_FENCE_ANCHOR.y - redisH / 2;
      drawRoundedRect(ctx, redisX, redisY, redisW, redisH, 11);
      const isAegis = displayEngine === 'AEGIS_LUA_WAL';
      const isNaive = displayEngine === 'NAIVE_RMW';
      ctx.fillStyle = isDark
        ? isNaive
          ? 'rgba(69, 10, 26, 0.88)'
          : 'rgba(8, 26, 42, 0.92)'
        : isNaive
          ? '#fff1f2'
          : '#f0fdfa';
      ctx.fill();
      ctx.strokeStyle = isNaive ? '#f43f5e' : isAegis ? '#10b981' : '#f59e0b';
      ctx.lineWidth = 1.6;
      ctx.shadowColor = isNaive
        ? 'rgba(244, 63, 94, 0.45)'
        : isAegis
          ? 'rgba(16, 185, 129, 0.35)'
          : 'rgba(245, 158, 11, 0.35)';
      ctx.shadowBlur = 14;
      ctx.stroke();
      ctx.shadowBlur = 0;

      ctx.fillStyle = isDark ? '#f8fafc' : '#0f172a';
      ctx.font = '800 10.5px "JetBrains Mono", monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('REDIS LUA ATOMIC FENCE', REDIS_FENCE_ANCHOR.x, REDIS_FENCE_ANCHOR.y - 7);
      ctx.font = '600 9.5px "JetBrains Mono", monospace';
      ctx.fillStyle = isNaive
        ? isDark
          ? '#fda4af'
          : '#be123c'
        : isAegis
          ? isDark
            ? '#6ee7b7'
            : '#047857'
          : isDark
            ? '#fde68a'
            : '#b45309';
      const redisSub = isNaive
        ? 'BYPASSED · UNPROTECTED RMW RACE WINDOW'
        : isAegis
          ? `EPOCH T${displayFencingEpoch} · ATOMIC QUOTA LOCK · 0 LEAKS`
          : `SQL CAS MODE · EPOCH T${displayFencingEpoch} GUARD`;
      ctx.fillText(redisSub, REDIS_FENCE_ANCHOR.x, REDIS_FENCE_ANCHOR.y + 9);

      // Bottom Hub: SQL Server ROWVERSION Ledger
      const sqlW = 304;
      const sqlH = 44;
      const sqlX = SQL_ROWVERSION_ANCHOR.x - sqlW / 2;
      const sqlY = SQL_ROWVERSION_ANCHOR.y - sqlH / 2;
      const hasLeak = displayMetrics.doubleSpendLeaks > 0;
      drawRoundedRect(ctx, sqlX, sqlY, sqlW, sqlH, 11);
      ctx.fillStyle = isDark
        ? hasLeak
          ? 'rgba(76, 5, 25, 0.94)'
          : 'rgba(10, 19, 38, 0.94)'
        : hasLeak
          ? '#fff1f2'
          : '#f8fafc';
      ctx.fill();
      ctx.strokeStyle = hasLeak ? '#ff1744' : isDark ? '#38bdf8' : '#0284c7';
      ctx.lineWidth = hasLeak ? 2.1 : 1.5;
      ctx.shadowColor = hasLeak ? 'rgba(255, 23, 68, 0.65)' : 'rgba(56, 189, 248, 0.3)';
      ctx.shadowBlur = hasLeak ? 18 : 12;
      ctx.stroke();
      ctx.shadowBlur = 0;

      ctx.fillStyle = isDark ? '#f8fafc' : '#0f172a';
      ctx.font = '800 10.5px "JetBrains Mono", monospace';
      ctx.fillText('SQL SERVER ROWVERSION WAL', SQL_ROWVERSION_ANCHOR.x, SQL_ROWVERSION_ANCHOR.y - 7);
      ctx.font = '600 9.5px "JetBrains Mono", monospace';
      ctx.fillStyle = hasLeak
        ? isDark
          ? '#ff8fa3'
          : '#be123c'
        : isDark
          ? '#7dd3fc'
          : '#0369a1';
      ctx.fillText(
        hasLeak
          ? `BREACH! +${displayMetrics.doubleSpendLeaks} DOUBLE-SPENDS · ${formatRowVersionHex(displayRowVersion)}`
          : `ROWVERSION ${formatRowVersionHex(displayRowVersion)} · TERM T${displayTerm} · LINEARIZABLE`,
        SQL_ROWVERSION_ANCHOR.x,
        SQL_ROWVERSION_ANCHOR.y + 9
      );
      ctx.restore();

      // 7. Shockwave Rings (live mode)
      if (!scrubSnap) {
        for (const sw of liveState.shockwaves) {
          const r = 14 + sw.progress * sw.maxRadius;
          const alpha = Math.max(0, 1 - sw.progress);
          const color =
            sw.kind === 'LEAK'
              ? `rgba(255, 23, 68, ${alpha * 0.92})`
              : sw.kind === 'CUT' || sw.kind === 'CRASH'
                ? `rgba(244, 63, 94, ${alpha * 0.85})`
                : sw.kind === 'ELECTION'
                  ? `rgba(167, 139, 250, ${alpha * 0.85})`
                  : sw.kind === 'FENCE'
                    ? `rgba(251, 191, 36, ${alpha * 0.82})`
                    : `rgba(52, 211, 153, ${alpha * 0.85})`;

          ctx.save();
          ctx.beginPath();
          ctx.arc(sw.x, sw.y, r, 0, Math.PI * 2);
          ctx.strokeStyle = color;
          ctx.lineWidth = sw.kind === 'LEAK' ? 3.2 : 2.1;
          ctx.stroke();

          if (sw.kind === 'LEAK' && sw.progress < 0.78) {
            ctx.beginPath();
            ctx.arc(sw.x, sw.y, r * 0.65, 0, Math.PI * 2);
            ctx.strokeStyle = `rgba(255, 100, 130, ${alpha * 0.65})`;
            ctx.lineWidth = 1.6;
            ctx.stroke();
          }
          ctx.restore();
        }
      }

      // 8. Glowing Directional RPC Packets with Tapered Curved Trails!
      if (!scrubSnap) {
        for (const pkt of liveState.packets) {
          if (pkt.progress < 0) continue;
          const palette = PACKET_PALETTE[pkt.kind];
          const p0 = { x: pkt.startX, y: pkt.startY };
          const ctrl = { x: pkt.ctrlX, y: pkt.ctrlY };
          const p2 = { x: pkt.endX, y: pkt.endY };
          const head = evaluateQuadraticBezier(p0, ctrl, p2, pkt.progress);

          // Tapered curved tail (6 segments behind head)
          ctx.save();
          ctx.lineCap = 'round';
          for (let seg = 0; seg < 6; seg++) {
            const t1 = Math.max(0, pkt.progress - seg * 0.017);
            const t2 = Math.max(0, pkt.progress - (seg + 1) * 0.017);
            const aPt = evaluateQuadraticBezier(p0, ctrl, p2, t1);
            const bPt = evaluateQuadraticBezier(p0, ctrl, p2, t2);
            ctx.beginPath();
            ctx.moveTo(aPt.x, aPt.y);
            ctx.lineTo(bPt.x, bPt.y);
            ctx.strokeStyle = palette.trail;
            ctx.globalAlpha = Math.max(0.08, (1 - seg / 6) * 0.85);
            ctx.lineWidth =
              pkt.kind === 'DOUBLE_SPEND_LEAK' ? 4.4 - seg * 0.55 : 3.2 - seg * 0.42;
            ctx.stroke();
          }

          // Outer glow bloom
          ctx.globalAlpha = 1;
          const rad = pkt.kind === 'DOUBLE_SPEND_LEAK' ? 5.2 : pkt.kind === 'VOUCHER_COMMITTED_200' ? 4.8 : 3.7;
          ctx.beginPath();
          ctx.arc(head.x, head.y, rad * 2.2, 0, Math.PI * 2);
          ctx.fillStyle = palette.glow;
          ctx.fill();

          // Luminous core
          ctx.beginPath();
          ctx.arc(head.x, head.y, rad, 0, Math.PI * 2);
          ctx.fillStyle = palette.core;
          ctx.fill();

          // Bright white pinpoint center
          ctx.beginPath();
          ctx.arc(head.x, head.y, rad * 0.44, 0, Math.PI * 2);
          ctx.fillStyle = '#ffffff';
          ctx.fill();
          ctx.restore();
        }
      }

      // 9. 5 Hexagonal Global Cluster Nodes
      for (const node of displayNodes) {
        const pal = getRolePalette(node.role, isDark);
        const isHoveredNode = hover.nodeId === node.id && tool === 'CRASH_NODE';
        const isLeader = node.role === 'LEADER';
        const isCrashed = node.status === 'CRASHED';
        const isFencedStale = node.role === 'STALE_LEADER_FENCED';
        const isCandidate = node.role === 'CANDIDATE';

        ctx.save();

        // Outer ambient halo for Leader / Candidate / Fenced / Hovered
        if (isLeader || isCandidate || isFencedStale || isHoveredNode) {
          const pulse = 1 + Math.sin(visualPhase * 2.6) * 0.06;
          const haloRad = (isHoveredNode ? 58 : 54) * pulse;
          const haloGrad = ctx.createRadialGradient(node.x, node.y, 26, node.x, node.y, haloRad);
          haloGrad.addColorStop(0, isHoveredNode ? 'rgba(244, 63, 94, 0.32)' : pal.glow);
          haloGrad.addColorStop(1, 'rgba(0,0,0,0)');
          ctx.fillStyle = haloGrad;
          ctx.beginPath();
          ctx.arc(node.x, node.y, haloRad, 0, Math.PI * 2);
          ctx.fill();
        }

        // Rotating telemetry ring for Active Majority Leader
        if (isLeader) {
          ctx.save();
          ctx.translate(node.x, node.y);
          ctx.rotate(visualPhase * 0.8);
          ctx.strokeStyle = 'rgba(34, 211, 238, 0.72)';
          ctx.lineWidth = 2;
          ctx.setLineDash([16, 12]);
          ctx.beginPath();
          ctx.arc(0, 0, 50, 0, Math.PI * 2);
          ctx.stroke();
          ctx.restore();
        }

        // Dashed warning ring for STALE_LEADER_FENCED or CANDIDATE
        if (isFencedStale || isCandidate) {
          ctx.save();
          ctx.translate(node.x, node.y);
          ctx.rotate(-visualPhase * 1.1);
          ctx.strokeStyle = isFencedStale ? '#f59e0b' : '#a78bfa';
          ctx.lineWidth = 2.2;
          ctx.setLineDash([8, 6]);
          ctx.beginPath();
          ctx.arc(0, 0, 50, 0, Math.PI * 2);
          ctx.stroke();
          ctx.restore();
        }

        // Targeting reticle when hovering node in CRASH_NODE tool
        if (isHoveredNode) {
          ctx.save();
          ctx.strokeStyle = isCrashed ? '#10b981' : '#f43f5e';
          ctx.lineWidth = 2;
          ctx.setLineDash([6, 4]);
          ctx.beginPath();
          ctx.arc(node.x, node.y, 54, 0, Math.PI * 2);
          ctx.stroke();
          ctx.restore();
        }

        // Hexagonal Main Node Shell
        drawHexagonPath(ctx, node.x, node.y, 42);
        ctx.fillStyle = pal.fill;
        ctx.fill();
        ctx.strokeStyle = pal.stroke;
        ctx.lineWidth = isLeader || isFencedStale ? 2.8 : 2.1;
        ctx.shadowColor = pal.glow;
        ctx.shadowBlur = isLeader ? 18 : 10;
        ctx.stroke();
        ctx.shadowBlur = 0;

        // Inner subtle geometric bezel
        drawHexagonPath(ctx, node.x, node.y, 35);
        ctx.strokeStyle = isDark ? 'rgba(255,255,255,0.09)' : 'rgba(15,23,42,0.08)';
        ctx.lineWidth = 1;
        ctx.stroke();

        // Top accent glyph inside hexagon
        if (isLeader) {
          drawVectorCrown(ctx, node.x, node.y - 21, '#34d399');
        } else if (isCrashed) {
          drawVectorCross(ctx, node.x, node.y - 19, 6.5, '#fb7185');
        } else {
          // Status pulse dot
          ctx.beginPath();
          ctx.arc(node.x, node.y - 21, 3.6, 0, Math.PI * 2);
          ctx.fillStyle = pal.stroke;
          ctx.fill();
        }

        // Region ID Text
        ctx.fillStyle = isCrashed
          ? isDark
            ? '#94a3b8'
            : '#64748b'
          : isDark
            ? '#f8fafc'
            : '#0f172a';
        ctx.font = '800 11px "JetBrains Mono", monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(node.id, node.x, node.y - 3);

        // Role Badge Pill inside bottom half of hexagon
        const roleLabel = isCandidate
          ? `VOTE ${node.votesReceived.length}/3`
          : pal.label;
        const badgeW = Math.max(58, roleLabel.length * 6.2 + 12);
        drawRoundedRect(ctx, node.x - badgeW / 2, node.y + 8, badgeW, 16, 5);
        ctx.fillStyle = pal.badgeBg;
        ctx.fill();
        ctx.fillStyle = pal.badgeText;
        ctx.font = '700 8.5px "JetBrains Mono", monospace';
        ctx.fillText(roleLabel, node.x, node.y + 16.5);

        // Term + Commit Index Pill cleanly anchored beneath the hexagon
        const metaText = isCrashed
          ? `OFFLINE · T${node.term}`
          : `T${node.term} · idx #${node.commitIndex}`;
        const metaW = Math.max(96, metaText.length * 6.5 + 16);
        drawRoundedRect(ctx, node.x - metaW / 2, node.y + 46, metaW, 20, 6);
        ctx.fillStyle = isDark ? 'rgba(9, 14, 26, 0.92)' : 'rgba(255, 255, 255, 0.94)';
        ctx.fill();
        ctx.strokeStyle = isCrashed
          ? 'rgba(244, 63, 94, 0.5)'
          : isDark
            ? 'rgba(148, 163, 184, 0.28)'
            : 'rgba(15, 23, 42, 0.16)';
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.fillStyle = isCrashed
          ? isDark
            ? '#fda4af'
            : '#be123c'
          : isDark
            ? '#cbd5e1'
            : '#334155';
        ctx.font = '700 9.5px "JetBrains Mono", monospace';
        ctx.fillText(metaText, node.x, node.y + 56.5);

        // Extra alert pill above node if STALE_LEADER_FENCED or has DOUBLE-SPEND LEAKS
        if (node.leakCount > 0) {
          const leakLabel = `LEAK +${node.leakCount}`;
          drawRoundedRect(ctx, node.x - 42, node.y - 62, 84, 18, 6);
          ctx.fillStyle = '#e11d48';
          ctx.fill();
          ctx.fillStyle = '#ffffff';
          ctx.font = '800 9.5px "JetBrains Mono", monospace';
          ctx.fillText(leakLabel, node.x, node.y - 52.5);
        } else if (isFencedStale) {
          drawRoundedRect(ctx, node.x - 66, node.y - 62, 132, 18, 6);
          ctx.fillStyle = isDark ? 'rgba(120, 53, 15, 0.94)' : '#fef3c7';
          ctx.fill();
          ctx.strokeStyle = '#f59e0b';
          ctx.lineWidth = 1.2;
          ctx.stroke();
          ctx.fillStyle = isDark ? '#fde68a' : '#92400e';
          ctx.font = '800 9px "JetBrains Mono", monospace';
          ctx.fillText('STALE LEADER FENCED', node.x, node.y - 52.5);
        } else if (isCrashed) {
          drawRoundedRect(ctx, node.x - 52, node.y - 62, 104, 18, 6);
          ctx.fillStyle = isDark ? 'rgba(136, 19, 55, 0.92)' : '#ffe4e6';
          ctx.fill();
          ctx.strokeStyle = '#f43f5e';
          ctx.lineWidth = 1.2;
          ctx.stroke();
          ctx.fillStyle = isDark ? '#fda4af' : '#be123c';
          ctx.font = '800 9px "JetBrains Mono", monospace';
          ctx.fillText('NODE CRASHED', node.x, node.y - 52.5);
        }

        ctx.restore();
      }

      // 10. Blazing In-Canvas Violation Callout Ribbon if Naive Double-Spend Breach occurred
      if (displayLinear.verdict === 'VIOLATION') {
        ctx.save();
        const bannerW = 356;
        const bannerX = DST_CANVAS_W - bannerW - 18;
        const bannerY = DST_CANVAS_H - 46;
        drawRoundedRect(ctx, bannerX, bannerY, bannerW, 30, 8);
        ctx.fillStyle = isDark ? 'rgba(136, 19, 55, 0.92)' : 'rgba(255, 228, 230, 0.96)';
        ctx.fill();
        ctx.strokeStyle = '#ff1744';
        ctx.lineWidth = 1.8;
        ctx.shadowColor = 'rgba(255, 23, 68, 0.6)';
        ctx.shadowBlur = 14;
        ctx.stroke();
        ctx.shadowBlur = 0;

        ctx.fillStyle = isDark ? '#ffe4e6' : '#9f1239';
        ctx.font = '800 10px "JetBrains Mono", monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(
          `LINEARIZABILITY VIOLATION · +${displayMetrics.doubleSpendLeaks} DOUBLE-SPEND LEAKS`,
          bannerX + bannerW / 2,
          bannerY + 15.5
        );
        ctx.restore();
      }

      // 11. Time-Travel Scrubbing Indicator Pill (when viewing a past snapshot!)
      if (scrubSnap) {
        ctx.save();
        drawRoundedRect(ctx, 18, DST_CANVAS_H - 46, 260, 30, 8);
        ctx.fillStyle = isDark ? 'rgba(8, 51, 68, 0.94)' : 'rgba(224, 242, 254, 0.96)';
        ctx.fill();
        ctx.strokeStyle = '#22d3ee';
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.fillStyle = isDark ? '#a5f3fc' : '#0369a1';
        ctx.font = '800 10px "JetBrains Mono", monospace';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(
          `TIME-TRAVEL SCRUB · t = ${scrubSnap.tickMs.toLocaleString()} ms`,
          30,
          DST_CANVAS_H - 30.5
        );
        ctx.restore();
      } else {
        // Compact Packet Color Legend (bottom-left)
        ctx.save();
        const legendItems = [
          { color: '#22d3ee', label: 'Heartbeat' },
          { color: '#a78bfa', label: 'Vote' },
          { color: '#34d399', label: '200 OK' },
          { color: '#fbbf24', label: '409 Fence' },
          { color: '#ff2a55', label: 'Leak' },
        ];
        drawRoundedRect(ctx, 16, DST_CANVAS_H - 38, 326, 24, 7);
        ctx.fillStyle = isDark ? 'rgba(8, 13, 25, 0.82)' : 'rgba(255, 255, 255, 0.88)';
        ctx.fill();
        ctx.strokeStyle = isDark ? 'rgba(148, 163, 184, 0.2)' : 'rgba(15, 23, 42, 0.12)';
        ctx.lineWidth = 1;
        ctx.stroke();

        let lx = 28;
        ctx.font = '600 9.5px "JetBrains Mono", monospace';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        for (const item of legendItems) {
          ctx.beginPath();
          ctx.arc(lx, DST_CANVAS_H - 26, 3.6, 0, Math.PI * 2);
          ctx.fillStyle = item.color;
          ctx.fill();
          ctx.fillStyle = isDark ? '#cbd5e1' : '#334155';
          ctx.fillText(item.label, lx + 8, DST_CANVAS_H - 25.5);
          lx += item.label.length * 6.1 + 19;
        }
        ctx.restore();
      }

      // 12. Interactive Hover HUD Tooltip
      if (hover.linkId && (tool === 'SCISSORS' || tool === 'DEGRADE_LINK')) {
        const hoveredLink = displayLinks.find((l) => l.id === hover.linkId);
        if (hoveredLink) {
          const actionText =
            tool === 'DEGRADE_LINK'
              ? hoveredLink.status === 'DEGRADED'
                ? 'Click to RESTORE RTT'
                : 'Click to INJECT +220ms'
              : hoveredLink.status === 'SEVERED'
                ? 'SEVERED · Click to HEAL'
                : `${hoveredLink.effectiveLatencyMs}ms · Click to SEVER`;
          const text = `${hoveredLink.from} <-> ${hoveredLink.to} · ${actionText}`;
          ctx.save();
          ctx.font = '700 10px "JetBrains Mono", monospace';
          const tw = ctx.measureText(text).width + 24;
          const tx = Math.min(DST_CANVAS_W - tw - 12, Math.max(12, hover.x - tw / 2));
          const ty = Math.max(12, hover.y - 36);
          drawRoundedRect(ctx, tx, ty, tw, 24, 6);
          ctx.fillStyle = isDark ? 'rgba(7, 11, 22, 0.95)' : 'rgba(15, 23, 42, 0.92)';
          ctx.fill();
          ctx.strokeStyle = hoveredLink.status === 'SEVERED' ? '#f43f5e' : '#22d3ee';
          ctx.lineWidth = 1.2;
          ctx.stroke();
          ctx.fillStyle = '#f8fafc';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(text, tx + tw / 2, ty + 12.5);
          ctx.restore();
        }
      } else if (hover.nodeId && tool === 'CRASH_NODE') {
        const hoveredNode = nodeMap.get(hover.nodeId);
        if (hoveredNode) {
          const text =
            hoveredNode.status === 'CRASHED'
              ? `Click to REVIVE ${hoveredNode.id} (WAL Catch-Up)`
              : `Click to CRASH ${hoveredNode.id} (${hoveredNode.role})`;
          ctx.save();
          ctx.font = '700 10px "JetBrains Mono", monospace';
          const tw = ctx.measureText(text).width + 24;
          const tx = Math.min(DST_CANVAS_W - tw - 12, Math.max(12, hoveredNode.x - tw / 2));
          // Position cleanly above top badge OR below bottom pill so it never overlaps NODE CRASHED / STALE FENCED badges!
          const ty =
            hoveredNode.y > 145
              ? hoveredNode.y - 92
              : hoveredNode.y + 72;
          drawRoundedRect(ctx, tx, ty, tw, 24, 6);
          ctx.fillStyle = isDark ? 'rgba(7, 11, 22, 0.96)' : 'rgba(15, 23, 42, 0.92)';
          ctx.fill();
          ctx.strokeStyle = hoveredNode.status === 'CRASHED' ? '#10b981' : '#f43f5e';
          ctx.lineWidth = 1.2;
          ctx.stroke();
          ctx.fillStyle = '#f8fafc';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(text, tx + tw / 2, ty + 12.5);
          ctx.restore();
        }
      }

      // Suppress unused warning on staleLeaderId when clean
      void displayStaleLeaderId;

      ctx.restore();
      rafId = window.requestAnimationFrame(renderFrame);
    }

    rafId = window.requestAnimationFrame(renderFrame);
    return () => window.cancelAnimationFrame(rafId);
  }, []);

  // Derived HUD snapshot (respects Time-Travel Scrubbing!)
  const activeSnap = useMemo(
    () => (scrubTickMs !== null ? getSnapshotAtTick(hudState.snapshots, scrubTickMs) : null),
    [hudState.snapshots, scrubTickMs]
  );

  const viewMetrics = activeSnap ? activeSnap.metrics : hudState.metrics;
  const viewLinear = activeSnap ? activeSnap.linearizability : hudState.linearizability;
  const viewTerm = activeSnap ? activeSnap.term : hudState.clusterTerm;
  const viewLeader = activeSnap ? activeSnap.leaderId : hudState.leaderId;
  const viewStaleLeader = activeSnap ? activeSnap.staleLeaderId : hudState.staleLeaderId;
  const viewHasQuorum = activeSnap ? activeSnap.hasQuorum : hudState.hasQuorum;
  const viewEngine = activeSnap ? activeSnap.engine : hudState.engine;
  const viewTickMs = activeSnap ? activeSnap.tickMs : hudState.tickMs;
  const maxTickMs = Math.max(100, hudState.tickMs);

  const severedLinkCount = hudState.links.filter((l) => l.status === 'SEVERED').length;
  const crashedNodeCount = hudState.nodes.filter((n) => n.status === 'CRASHED').length;

  // Group Jepsen history events per region for the 5-track swimlane timeline
  const historyByRegion = useMemo(() => {
    const map = new Map<DstRegionId, DstHistoryEvent[]>();
    for (const r of DST_REGION_ORDER) map.set(r, []);
    for (const ev of hudState.history) {
      map.get(ev.region)?.push(ev);
    }
    return map;
  }, [hudState.history]);

  const latestEvent =
    selectedEvent ?? hudState.history[hudState.history.length - 1] ?? null;

  const isViolation = viewLinear.verdict === 'VIOLATION';

  return (
    <section
      data-testid="dst-chaos-arena"
      className="surface-panel overflow-hidden rounded-2xl border"
      aria-label="Deterministic Simulation Testing and Interactive Chaos-Scissors Distributed Packet Arena"
    >
      {/* Unified Executive Title & Live Verdict Strip */}
      <div className="border-hairline flex flex-col gap-2 border-b px-3.5 py-2.5 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1 rounded-md border border-cyan-500/40 bg-cyan-500/12 px-2 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wider text-cyan-700 dark:text-cyan-300">
            <Cpu className="h-3 w-3" />
            v7.0 DST
          </span>
          <h1 className="text-sm font-extrabold tracking-tight text-heading sm:text-[15px]">
            {lang === 'vi'
              ? 'Đấu Trường Đồng Thuận Raft & Bão Voucher 500 Yêu Cầu'
              : 'Chaos-Scissors Distributed Consensus & 500-Req Voucher Storm Arena'}
          </h1>
          <span className="hidden text-[11px] text-dim xl:inline">
            · Click links to sever/heal, crash nodes, or scrub Jepsen history
          </span>
        </div>

        {/* Live Quorum + Linearizability Verdict Pills */}
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <div
            data-testid="dst-quorum-pill"
            className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 font-mono text-[10.5px] font-bold ${
              !viewHasQuorum
                ? 'border-rose-500/55 bg-rose-500/15 text-rose-700 dark:text-rose-200'
                : viewStaleLeader
                  ? 'border-amber-500/55 bg-amber-500/15 text-amber-800 dark:text-amber-200'
                  : 'border-cyan-500/40 bg-cyan-500/10 text-cyan-800 dark:text-cyan-200'
            }`}
          >
            <Activity className="h-3.5 w-3.5 shrink-0" />
            <span>
              {!viewHasQuorum
                ? `NO QUORUM · T${viewTerm}`
                : viewStaleLeader
                  ? `SPLIT-BRAIN · LEADER ${viewLeader ?? 'ELECTING'} (T${viewTerm})`
                  : `LEADER ${viewLeader ?? 'ELECTING'} · T${viewTerm} · ${5 - crashedNodeCount}/5`}
            </span>
          </div>

          <div
            data-testid="dst-verdict-pill"
            className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 font-mono text-[10.5px] font-extrabold ${
              isViolation
                ? 'animate-crimson-pulse border-rose-500 bg-rose-500/20 text-rose-700 shadow-[0_0_20px_rgba(244,63,94,0.35)] dark:text-rose-200'
                : 'border-emerald-500/50 bg-emerald-500/14 text-emerald-800 dark:text-emerald-200'
            }`}
          >
            {isViolation ? (
              <ShieldAlert className="h-3.5 w-3.5 shrink-0 text-rose-500" />
            ) : (
              <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-emerald-500" />
            )}
            <span>
              {isViolation
                ? `VIOLATION · ${viewMetrics.doubleSpendLeaks} LEAKS`
                : 'LINEARIZABLE · 0 LEAKS'}
            </span>
          </div>
        </div>
      </div>

      {/* Main Stage Body: Single-Row Cockpit Toolbar + 60fps HiDPI Canvas + Docked Jepsen Timeline */}
      <div>
        {/* Direct-Manipulation Chaos Toolbar */}
        <div className="border-hairline flex flex-wrap items-center justify-between gap-2 border-b px-3 py-2">
          {/* Left: Direct Canvas Tools + Presets */}
          <div className="flex flex-wrap items-center gap-1.5">
            <div
              role="group"
              aria-label="Direct Canvas Manipulation Tools"
              className="surface-inset inline-flex flex-wrap items-center gap-0.5 rounded-xl border p-0.5"
            >
              <button
                type="button"
                data-testid="tool-scissors"
                onClick={() => setActiveTool('SCISSORS')}
                className={`inline-flex items-center gap-1 rounded-lg px-2 py-1.5 font-mono text-[10.5px] font-bold transition ${
                  activeTool === 'SCISSORS'
                    ? 'bg-rose-500/20 text-rose-700 ring-1 ring-rose-500/55 dark:text-rose-200'
                    : 'text-dim hover:text-heading'
                }`}
              >
                <Scissors className="h-3 w-3" />
                <span>Cut / Heal</span>
              </button>

              <button
                type="button"
                data-testid="tool-crash"
                onClick={() => setActiveTool('CRASH_NODE')}
                className={`inline-flex items-center gap-1 rounded-lg px-2 py-1.5 font-mono text-[10.5px] font-bold transition ${
                  activeTool === 'CRASH_NODE'
                    ? 'bg-amber-500/20 text-amber-800 ring-1 ring-amber-500/55 dark:text-amber-200'
                    : 'text-dim hover:text-heading'
                }`}
              >
                <Power className="h-3 w-3" />
                <span>Crash Node</span>
              </button>

              <button
                type="button"
                data-testid="tool-degrade"
                onClick={() => setActiveTool('DEGRADE_LINK')}
                className={`inline-flex items-center gap-1 rounded-lg px-2 py-1.5 font-mono text-[10.5px] font-bold transition ${
                  activeTool === 'DEGRADE_LINK'
                    ? 'bg-cyan-500/20 text-cyan-800 ring-1 ring-cyan-500/55 dark:text-cyan-200'
                    : 'text-dim hover:text-heading'
                }`}
              >
                <Waves className="h-3 w-3" />
                <span>+220ms</span>
              </button>
            </div>

            {/* 1-Click Dramatic Presets */}
            <button
              type="button"
              data-testid="btn-split-brain"
              onClick={handleSplitBrain}
              className="inline-flex items-center gap-1.5 rounded-xl border border-rose-500/50 bg-rose-500/14 px-2.5 py-1.5 font-mono text-[10.5px] font-extrabold text-rose-700 transition hover:bg-rose-500/25 dark:text-rose-200"
            >
              <Split className="h-3.5 w-3.5" />
              <span>Split-Brain (2v3)</span>
            </button>

            <button
              type="button"
              data-testid="btn-blast-storm"
              onClick={handleBlastStorm}
              className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-cyan-500 to-emerald-500 px-3 py-1.5 font-mono text-[10.5px] font-extrabold text-slate-950 shadow-md shadow-cyan-500/20 transition hover:brightness-110"
            >
              <Zap className="h-3.5 w-3.5 fill-current" />
              <span>Blast 500-Req Storm</span>
            </button>

            <button
              type="button"
              data-testid="btn-heal-all"
              onClick={handleHealAll}
              className="surface-chip inline-flex items-center gap-1 rounded-xl border px-2 py-1.5 font-mono text-[10.5px] font-bold text-body transition hover:border-emerald-500/50 hover:text-heading"
            >
              <RefreshCw className="h-3 w-3 text-emerald-500" />
              <span>Heal All</span>
            </button>
          </div>

          {/* Right: Live Concurrency Engine Switcher */}
          <div
            role="group"
            aria-label="Voucher Concurrency Fencing Engine"
            className="surface-inset inline-flex flex-wrap items-center gap-0.5 rounded-xl border p-0.5"
          >
            {(
              [
                { id: 'NAIVE_RMW', label: 'Naive RMW', tone: 'rose' },
                { id: 'ROWVERSION_CAS', label: 'RowVersion CAS', tone: 'amber' },
                { id: 'AEGIS_LUA_WAL', label: 'Redis Lua (Aegis)', tone: 'emerald' },
              ] as const
            ).map((opt) => {
              const active = viewEngine === opt.id;
              const activeStyle =
                opt.tone === 'rose'
                  ? 'bg-rose-500/22 text-rose-700 ring-1 ring-rose-500/60 dark:text-rose-200'
                  : opt.tone === 'amber'
                    ? 'bg-amber-500/20 text-amber-800 ring-1 ring-amber-500/55 dark:text-amber-200'
                    : 'bg-emerald-500/20 text-emerald-800 ring-1 ring-emerald-500/55 dark:text-emerald-200';
              return (
                <button
                  key={opt.id}
                  type="button"
                  data-testid={`engine-${opt.id}`}
                  onClick={() => handleEngineSwitch(opt.id)}
                  className={`rounded-lg px-2 py-1.5 font-mono text-[10.5px] font-bold transition ${
                    active ? activeStyle : 'text-dim hover:text-heading'
                  }`}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* 60fps Interactive HiDPI Web Canvas */}
        <div className="relative w-full overflow-hidden bg-[#060b16]">
          <canvas
            ref={canvasRef}
            data-testid="dst-chaos-canvas"
            onPointerMove={handleCanvasPointerMove}
            onPointerLeave={handleCanvasPointerLeave}
            onClick={handleCanvasClick}
            className={`block w-full select-none ${
              activeTool === 'SCISSORS' || activeTool === 'DEGRADE_LINK'
                ? 'cursor-crosshair'
                : 'cursor-pointer'
            }`}
            style={{ aspectRatio: `${DST_CANVAS_W} / ${DST_CANVAS_H}` }}
          />

          {/* Subtle Interactive Hint Toast */}
          {canvasHint && (
            <div className="pointer-events-none absolute top-3 left-1/2 -translate-x-1/2 rounded-lg border border-cyan-500/45 bg-slate-950/90 px-3 py-1.5 font-mono text-[11px] font-semibold text-cyan-200 shadow-xl backdrop-blur">
              {canvasHint}
            </div>
          )}
        </div>

        {/* Quick-Access Direct Node Crash / Link Status Bar (especially handy on touchscreens & keyboard QA!) */}
        <div className="border-hairline surface-panel-alt flex flex-wrap items-center justify-between gap-2 border-t px-3.5 py-2 sm:px-4">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="font-mono text-[10px] font-bold uppercase tracking-wider text-faint">
              Quick Node Power:
            </span>
            {hudState.nodes.map((node) => {
              const isOff = node.status === 'CRASHED';
              const isLead = node.role === 'LEADER';
              const isStale = node.role === 'STALE_LEADER_FENCED';
              return (
                <button
                  key={node.id}
                  type="button"
                  data-testid={`quick-node-${node.id}`}
                  onClick={() => {
                    setPaused(false);
                    commitSimMutation((prev) => toggleDstNodeCrash(prev, node.id));
                  }}
                  className={`inline-flex items-center gap-1.5 rounded-lg border px-2 py-1 font-mono text-[10.5px] font-bold transition ${
                    isOff
                      ? 'border-rose-500/60 bg-rose-500/18 text-rose-700 dark:text-rose-200'
                      : isStale
                        ? 'border-amber-500/55 bg-amber-500/14 text-amber-800 dark:text-amber-200'
                        : isLead
                          ? 'border-emerald-500/50 bg-emerald-500/12 text-emerald-800 dark:text-emerald-200'
                          : 'surface-chip text-body hover:border-cyan-500/50'
                  }`}
                >
                  <span
                    className={`h-1.5 w-1.5 rounded-full ${
                      isOff
                        ? 'bg-rose-500'
                        : isStale
                          ? 'bg-amber-400'
                          : isLead
                            ? 'bg-emerald-400'
                            : 'bg-cyan-400'
                    }`}
                  />
                  <span>{node.id}</span>
                  <span className="text-[9.5px] opacity-75">
                    {isOff ? 'OFF' : isLead ? 'LDR' : isStale ? 'FNC' : 'FLW'}
                  </span>
                </button>
              );
            })}
          </div>

          <div className="flex flex-wrap items-center gap-3 font-mono text-[10.5px] text-dim">
            <span>
              Links Severed:{' '}
              <strong className={severedLinkCount > 0 ? 'text-rose-500' : 'text-emerald-500'}>
                {severedLinkCount}/10
              </strong>
            </span>
            <span>
              Nodes Online:{' '}
              <strong className={crashedNodeCount > 0 ? 'text-amber-500' : 'text-emerald-500'}>
                {5 - crashedNodeCount}/5
              </strong>
            </span>
            {onOpenVoucherLab && (
              <button
                type="button"
                onClick={onOpenVoucherLab}
                className="font-semibold text-cyan-600 hover:underline dark:text-cyan-400"
              >
                Open 500x Voucher Micro-Trace &rarr;
              </button>
            )}
          </div>
        </div>

        {/* Docked DST Seed Replay Bar + Live Telemetry + Time-Travel Scrubber + Jepsen Linearizability Timeline */}
        <div className="border-hairline border-t px-3 py-2.5 sm:px-3.5">
          {/* Row 1: DST Seed Controls + Live Metrics Strip */}
          <div className="flex flex-col gap-2 xl:flex-row xl:items-center xl:justify-between">
            <div className="flex flex-wrap items-center gap-1.5">
              <div className="surface-inset inline-flex items-center gap-1.5 rounded-xl border px-2 py-1">
                <Database className="h-3.5 w-3.5 text-cyan-500" />
                <label
                  htmlFor="dst-seed-input"
                  className="font-mono text-[10px] font-bold uppercase text-dim"
                >
                  DST SEED #
                </label>
                <input
                  id="dst-seed-input"
                  data-testid="dst-seed-input"
                  type="text"
                  inputMode="numeric"
                  value={seedInput}
                  onChange={(e) => setSeedInput(e.target.value.replace(/[^0-9]/g, '').slice(0, 6))}
                  onBlur={() => handleApplySeed(Number(seedInput))}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleApplySeed(Number(seedInput));
                  }}
                  aria-label="Deterministic Simulation Seed"
                  className="w-14 bg-transparent font-mono text-xs font-extrabold text-heading outline-none"
                />
              </div>

              <button
                type="button"
                data-testid="btn-new-seed"
                onClick={handleNewSeed}
                className="surface-chip inline-flex items-center gap-1 rounded-xl border px-2 py-1 font-mono text-[10.5px] font-bold text-body transition hover:border-cyan-500/50 hover:text-heading"
              >
                <Shuffle className="h-3 w-3 text-cyan-500" />
                <span>New Seed</span>
              </button>

              <button
                type="button"
                data-testid="btn-replay-seed"
                onClick={handleReplaySeed}
                className="surface-chip inline-flex items-center gap-1 rounded-xl border px-2 py-1 font-mono text-[10.5px] font-bold text-body transition hover:border-violet-500/50 hover:text-heading"
              >
                <RotateCcw className="h-3 w-3 text-violet-500" />
                <span>Replay Seed</span>
              </button>

              <button
                type="button"
                data-testid="btn-play-pause"
                onClick={() => {
                  if (scrubTickMs !== null) {
                    setScrubTickMs(null);
                    setPaused(false);
                  } else {
                    setPaused((p) => !p);
                  }
                }}
                className="surface-chip inline-flex items-center gap-1 rounded-xl border px-2 py-1 font-mono text-[10.5px] font-bold text-body transition hover:border-cyan-500/50 hover:text-heading"
              >
                {paused || scrubTickMs !== null ? (
                  <>
                    <Play className="h-3 w-3 text-emerald-500" />
                    <span>Resume Live</span>
                  </>
                ) : (
                  <>
                    <Pause className="h-3 w-3 text-amber-500" />
                    <span>Pause</span>
                  </>
                )}
              </button>
            </div>

            {/* Live Compact Metrics Pills */}
            <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-5">
              {[
                {
                  label: 'Committed 200',
                  value: viewMetrics.committed200.toLocaleString(),
                  tone: 'text-emerald-600 dark:text-emerald-300',
                },
                {
                  label: 'Fenced 409',
                  value: viewMetrics.fenced409.toLocaleString(),
                  tone: 'text-amber-600 dark:text-amber-300',
                },
                {
                  label: 'Stale Blocked',
                  value: viewMetrics.staleLeaderFenced.toLocaleString(),
                  tone: 'text-cyan-600 dark:text-cyan-300',
                },
                {
                  label: 'Double-Spends',
                  value: String(viewMetrics.doubleSpendLeaks),
                  tone:
                    viewMetrics.doubleSpendLeaks > 0
                      ? 'text-rose-600 dark:text-rose-400'
                      : 'text-emerald-600 dark:text-emerald-400',
                },
                {
                  label: 'Storm P99',
                  value: `${viewMetrics.lastStormLatencyP99Ms.toFixed(1)} ms`,
                  tone: 'text-heading',
                },
              ].map((stat) => (
                <div
                  key={stat.label}
                  className="surface-inset flex items-baseline justify-between gap-2 rounded-lg border px-2 py-1 sm:block"
                >
                  <div className="text-[9px] font-semibold uppercase tracking-wider text-faint">
                    {stat.label}
                  </div>
                  <div className={`font-mono text-xs font-extrabold ${stat.tone}`}>
                    {stat.value}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Row 2: Interactive Time-Travel Snapshot Scrubber + 5-Track Jepsen Timeline */}
          <div className="surface-inset mt-2 rounded-xl border px-2.5 py-2">
            <div className="flex flex-wrap items-center justify-between gap-2 text-[10.5px]">
              <span className="inline-flex items-center gap-1.5 font-mono font-bold text-heading">
                <History className="h-3.5 w-3.5 text-cyan-500" />
                Jepsen Linearizability Timeline &amp; DST Time-Travel Scrubber
              </span>
              <div className="flex items-center gap-2 font-mono text-[10px]">
                <span className="text-dim">
                  t = <strong className="text-heading">{viewTickMs.toLocaleString()} ms</strong> /{' '}
                  {maxTickMs.toLocaleString()} ms
                </span>
                <span
                  className={`rounded px-1.5 py-0.5 text-[9px] font-bold uppercase ${
                    scrubTickMs !== null
                      ? 'bg-cyan-500/20 text-cyan-700 dark:text-cyan-300'
                      : 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
                  }`}
                >
                  {scrubTickMs !== null ? 'SCRUBBING HISTORY' : paused ? 'PAUSED' : 'LIVE 60FPS'}
                </span>
              </div>
            </div>

            <div className="mt-1.5 flex items-center gap-2.5">
              <span className="font-mono text-[9.5px] text-faint">0ms</span>
              <input
                type="range"
                data-testid="dst-time-scrubber"
                min={0}
                max={maxTickMs}
                step={DST_FIXED_STEP_MS}
                value={Math.min(maxTickMs, viewTickMs)}
                onChange={(e) => {
                  const nextTick = Number(e.target.value);
                  if (nextTick >= maxTickMs - DST_FIXED_STEP_MS) {
                    setScrubTickMs(null);
                  } else {
                    setScrubTickMs(nextTick);
                  }
                }}
                aria-label="DST Time-Travel Snapshot Scrubber"
                className="h-1.5 w-full cursor-pointer accent-cyan-500"
              />
              <span className="font-mono text-[9.5px] text-faint">{maxTickMs}ms</span>
            </div>

            {/* 5-Track Per-Region Jepsen Operation History */}
            <div
              data-testid="jepsen-timeline"
              className="relative mt-2 space-y-1 overflow-x-hidden"
            >
              {DST_REGION_ORDER.map((regionId) => {
                const events = historyByRegion.get(regionId) ?? [];
                const short = regionId.split('-')[0];
                return (
                  <div key={regionId} className="flex items-center gap-2">
                    <span className="w-16 shrink-0 font-mono text-[9.5px] font-bold text-dim sm:w-20">
                      {short}
                      <span className="hidden sm:inline"> · {regionId.slice(3)}</span>
                    </span>
                    <div className="relative h-4 flex-1 rounded border border-slate-500/15 bg-slate-950/35 dark:bg-slate-950/70">
                      {/* Playhead vertical cursor */}
                      <div
                        className="pointer-events-none absolute top-0 bottom-0 z-10 w-0.5 bg-cyan-400/80"
                        style={{
                          left: `${Math.min(99.5, Math.max(0.5, (viewTickMs / maxTickMs) * 100))}%`,
                        }}
                      />

                      {/* Chronological Event Ticks */}
                      {events.slice(-40).map((ev) => {
                        const pct = Math.min(98.5, Math.max(1, (ev.tickMs / maxTickMs) * 100));
                        const style = HISTORY_BADGE_COLORS[ev.kind];
                        const isSelected = selectedEvent?.id === ev.id;
                        return (
                          <button
                            key={ev.id}
                            type="button"
                            title={`[t=${ev.tickMs}ms · T${ev.term}] ${ev.detail}`}
                            onClick={() => {
                              setSelectedEvent(ev);
                              setScrubTickMs(ev.tickMs);
                            }}
                            style={{ left: `${pct}%` }}
                            className={`absolute top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full transition-transform hover:scale-150 ${
                              ev.kind === 'DOUBLE_SPEND_LEAK'
                                ? 'h-3 w-2.5'
                                : ev.kind === 'LEADER_ELECTED' || ev.kind === 'PARTITION_WALL'
                                  ? 'h-2.5 w-2'
                                  : 'h-2 w-1.5'
                            } ${style.dot} ${isSelected ? 'scale-150 ring-2 ring-white' : ''}`}
                            aria-label={`${ev.region} ${ev.kind} at ${ev.tickMs}ms`}
                          />
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Live Jepsen Audit Readout Bar */}
            <div className="border-hairline mt-2 flex flex-wrap items-center justify-between gap-2 border-t pt-1.5 font-mono text-[10.5px]">
              {latestEvent ? (
                <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
                  <span
                    className={`shrink-0 rounded border px-1.5 py-0.5 text-[9.5px] font-extrabold uppercase ${
                      HISTORY_BADGE_COLORS[latestEvent.kind].badge
                    }`}
                  >
                    {HISTORY_BADGE_COLORS[latestEvent.kind].label}
                  </span>
                  <span className="shrink-0 text-faint">
                    t={latestEvent.tickMs}ms · T{latestEvent.term} · {latestEvent.region}
                  </span>
                  <span className="truncate text-body">{latestEvent.detail}</span>
                </div>
              ) : (
                <span className="text-dim">Awaiting distributed events...</span>
              )}

              <span
                className={`inline-flex shrink-0 items-center gap-1 text-[10.5px] font-bold ${
                  isViolation
                    ? 'text-rose-600 dark:text-rose-400'
                    : 'text-emerald-600 dark:text-emerald-400'
                }`}
              >
                {isViolation ? (
                  <AlertTriangle className="h-3.5 w-3.5" />
                ) : (
                  <ShieldCheck className="h-3.5 w-3.5" />
                )}
                <span>{viewLinear.label}</span>
              </span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

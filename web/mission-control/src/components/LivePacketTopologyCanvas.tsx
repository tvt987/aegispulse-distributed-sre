import { useEffect, useRef, useState } from 'react';
import { Pause, Play, Radio } from 'lucide-react';
import { computeStageTelemetry } from '../engine/localKernel';
import type { ConcurrencyMode, StageTelemetry, TelemetrySnapshot, ThemeMode } from '../engine/types';

interface Props {
  mode: ConcurrencyMode;
  snapshot: TelemetrySnapshot;
  throughputRps: number;
  isRunning: boolean;
  stageTelemetry?: StageTelemetry[];
  theme: ThemeMode;
}

type PacketKind = 'committed' | 'replay' | 'conflict_shed' | 'double_spend';

interface TrafficPacket {
  id: number;
  kind: PacketKind;
  x: number;
  y: number;
  laneOffset: number;
  speed: number;
  /** Target stop stage index (1..4) for shed/replay deflections */
  deflectAtStage: number | null;
  deflectDir: -1 | 1;
  deflected: boolean;
  vy: number;
  alpha: number;
  radius: number;
  trail: Array<{ x: number; y: number }>;
}

interface PulseRing {
  x: number;
  y: number;
  radius: number;
  maxRadius: number;
  color: string;
  alpha: number;
}

const LOGICAL_W = 1040;
const LOGICAL_H = 212;
const NODE_W = 156;
const NODE_H = 78;
const NODE_Y = 58;
const STAGE_XS = [16, 229, 442, 655, 868];
const CENTER_Y = NODE_Y + NODE_H / 2;

const PACKET_COLORS: Record<PacketKind, { core: string; glow: string }> = {
  committed: { core: '#10b981', glow: 'rgba(16, 185, 129, 0.45)' },
  replay: { core: '#f59e0b', glow: 'rgba(245, 158, 11, 0.45)' },
  conflict_shed: { core: '#f43f5e', glow: 'rgba(244, 63, 94, 0.45)' },
  double_spend: { core: '#ff1744', glow: 'rgba(255, 23, 68, 0.65)' },
};

function drawRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

export function LivePacketTopologyCanvas({
  mode,
  snapshot,
  throughputRps,
  isRunning,
  stageTelemetry,
  theme,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [paused, setPaused] = useState(false);

  const stages = stageTelemetry && stageTelemetry.length === 5
    ? stageTelemetry
    : computeStageTelemetry(mode, snapshot, throughputRps);

  const isBreach = !snapshot.invariantIntact || snapshot.overAllocatedUnits > 0;
  const isCircuitOpen = snapshot.circuitState !== 'Closed' || snapshot.activeChaos.forceCircuitOpen;

  // Store latest telemetry in a ref so the 60fps RAF loop stays smooth without restarting on minor updates
  const telemetryRef = useRef({
    mode,
    snapshot,
    throughputRps,
    isRunning,
    stages,
    theme,
    isBreach,
    isCircuitOpen,
    paused,
  });

  useEffect(() => {
    telemetryRef.current = {
      mode,
      snapshot,
      throughputRps,
      isRunning,
      stages,
      theme,
      isBreach,
      isCircuitOpen,
      paused,
    };
  }, [mode, snapshot, throughputRps, isRunning, stages, theme, isBreach, isCircuitOpen, paused]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let rafId = 0;
    let lastTime = performance.now();
    let spawnAccumulator = 0;
    let nextId = 1;
    let framePhase = 0;

    const packets: TrafficPacket[] = [];
    const rings: PulseRing[] = [];

    function pickPacketKind(): { kind: PacketKind; deflectAtStage: number | null; deflectDir: -1 | 1 } {
      const { snapshot: snap, mode: m, isBreach: breach, isCircuitOpen: cbOpen } = telemetryRef.current;
      const committedW = Math.max(8, snap.confirmedAllocations);
      const replayW = m === 'NaiveUnprotected' ? 0 : Math.max(snap.idempotentReplays > 0 ? 12 : 0, snap.idempotentReplays * 0.55);
      const shed429W = snap.rateLimitedRejections > 0 ? Math.max(10, snap.rateLimitedRejections * 0.65) : 0;
      const conflict409W = snap.payloadConflicts409 > 0 ? Math.max(9, snap.payloadConflicts409 * 8) : 0;
      const circuit503W = cbOpen || snap.circuitBreakerRejections > 0 ? Math.max(14, snap.circuitBreakerRejections * 0.45) : 0;
      const leakW = breach ? Math.max(36, snap.overAllocatedUnits * 1.4) : 0;

      const totalW = committedW + replayW + shed429W + conflict409W + circuit503W + leakW;
      let roll = Math.random() * Math.max(1, totalW);

      if (roll < leakW) {
        return { kind: 'double_spend', deflectAtStage: null, deflectDir: 1 };
      }
      roll -= leakW;

      if (roll < replayW) {
        return { kind: 'replay', deflectAtStage: 2, deflectDir: -1 };
      }
      roll -= replayW;

      if (roll < shed429W) {
        return { kind: 'conflict_shed', deflectAtStage: 1, deflectDir: 1 };
      }
      roll -= shed429W;

      if (roll < conflict409W) {
        return { kind: 'conflict_shed', deflectAtStage: 2, deflectDir: 1 };
      }
      roll -= conflict409W;

      if (roll < circuit503W) {
        return { kind: 'conflict_shed', deflectAtStage: 3, deflectDir: 1 };
      }

      return { kind: 'committed', deflectAtStage: null, deflectDir: 1 };
    }

    function spawnPacket(startX = 8) {
      const { throughputRps: rps, isRunning: running } = telemetryRef.current;
      const { kind, deflectAtStage, deflectDir } = pickPacketKind();
      const speedFactor = Math.min(1.65, Math.max(0.8, rps / 82000)) * (running ? 1.35 : 1);
      const laneOffset = (Math.random() - 0.5) * 18;
      packets.push({
        id: nextId++,
        kind,
        x: startX,
        y: CENTER_Y + laneOffset,
        laneOffset,
        speed: (210 + Math.random() * 75) * speedFactor * (kind === 'double_spend' ? 1.15 : 1),
        deflectAtStage,
        deflectDir,
        deflected: false,
        vy: 0,
        alpha: 1,
        radius: kind === 'double_spend' ? 4.4 : 3.2,
        trail: [],
      });
    }

    // Seed initial packets across the pipeline so frame 1 is immediately rich and alive
    for (let i = 0; i < 24; i++) {
      spawnPacket(20 + Math.random() * (LOGICAL_W - 80));
    }

    function render(now: number) {
      const dt = Math.max(0, Math.min(0.05, (now - lastTime) / 1000));
      lastTime = now;

      const state = telemetryRef.current;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const targetW = Math.round(LOGICAL_W * dpr);
      const targetH = Math.round(LOGICAL_H * dpr);
      if (canvas!.width !== targetW || canvas!.height !== targetH) {
        canvas!.width = targetW;
        canvas!.height = targetH;
      }

      ctx!.save();
      ctx!.scale(dpr, dpr);

      const dark = state.theme === 'dark';

      // Canvas background
      ctx!.fillStyle = dark ? '#050a16' : '#f8fafc';
      ctx!.fillRect(0, 0, LOGICAL_W, LOGICAL_H);

      // Subtle architectural telemetry grid
      ctx!.strokeStyle = dark ? 'rgba(51, 65, 85, 0.22)' : 'rgba(148, 163, 184, 0.2)';
      ctx!.lineWidth = 1;
      for (let gx = 24; gx < LOGICAL_W; gx += 32) {
        ctx!.beginPath();
        ctx!.moveTo(gx, 0);
        ctx!.lineTo(gx, LOGICAL_H);
        ctx!.stroke();
      }
      for (let gy = 24; gy < LOGICAL_H; gy += 32) {
        ctx!.beginPath();
        ctx!.moveTo(0, gy);
        ctx!.lineTo(LOGICAL_W, gy);
        ctx!.stroke();
      }

      // Lane annotations (Top: Fast 200 Replay Lane, Bottom: 429/409/503 Reject Lane)
      ctx!.font = '600 9.5px "JetBrains Mono", monospace';
      ctx!.fillStyle = dark ? 'rgba(245, 158, 11, 0.72)' : 'rgba(180, 83, 9, 0.8)';
      ctx!.fillText('FAST-PATH 200 IDEMPOTENT REPLAY LANE (ZERO DB HITS)', STAGE_XS[2] + 6, 22);

      // Replay arc guide line
      ctx!.save();
      ctx!.setLineDash([4, 5]);
      ctx!.strokeStyle = dark ? 'rgba(245, 158, 11, 0.28)' : 'rgba(217, 119, 6, 0.35)';
      ctx!.lineWidth = 1.25;
      ctx!.beginPath();
      ctx!.moveTo(STAGE_XS[2] + NODE_W / 2, NODE_Y);
      ctx!.quadraticCurveTo(STAGE_XS[2] + NODE_W + 70, 26, STAGE_XS[4] + NODE_W, 28);
      ctx!.stroke();
      ctx!.restore();

      // Reject / Shed rail at bottom
      ctx!.fillStyle = dark ? 'rgba(244, 63, 94, 0.72)' : 'rgba(225, 29, 72, 0.82)';
      ctx!.fillText(
        state.isBreach
          ? 'CRITICAL ALERT: TOCTOU RACE WINDOW LEAKING DOUBLE-SPEND PACKETS THROUGH STAGE 4 -> 5'
          : 'EDGE REJECTION RAIL: 429 RATE SHED · 409 SHA-256 CONFLICT · 503 CIRCUIT FAST-FAIL',
        STAGE_XS[1],
        LOGICAL_H - 12
      );

      // Main inter-stage conduits
      for (let i = 0; i < 4; i++) {
        const x1 = STAGE_XS[i] + NODE_W;
        const x2 = STAGE_XS[i + 1];

        // Outer conduit track
        ctx!.strokeStyle = dark ? 'rgba(30, 41, 59, 0.95)' : 'rgba(203, 213, 225, 0.95)';
        ctx!.lineWidth = 10;
        ctx!.lineCap = 'round';
        ctx!.beginPath();
        ctx!.moveTo(x1, CENTER_Y);
        ctx!.lineTo(x2, CENTER_Y);
        ctx!.stroke();

        // Animated flow filament
        ctx!.save();
        ctx!.setLineDash([6, 10]);
        ctx!.lineDashOffset = -framePhase * 42;
        ctx!.strokeStyle = state.isBreach
          ? 'rgba(255, 23, 68, 0.65)'
          : dark
            ? 'rgba(34, 211, 238, 0.45)'
            : 'rgba(2, 132, 199, 0.5)';
        ctx!.lineWidth = 2;
        ctx!.beginPath();
        ctx!.moveTo(x1, CENTER_Y);
        ctx!.lineTo(x2, CENTER_Y);
        ctx!.stroke();
        ctx!.restore();
      }

      // Update packets when unpaused
      if (!state.paused) {
        framePhase += dt;
        const spawnRatePerSec = Math.min(
          28,
          Math.max(10, (state.throughputRps / 5500) * (state.isRunning ? 1.4 : 1))
        );
        spawnAccumulator += dt * spawnRatePerSec;
        while (spawnAccumulator >= 1 && packets.length < 72) {
          spawnAccumulator -= 1;
          spawnPacket(8);
        }

        for (let i = packets.length - 1; i >= 0; i--) {
          const p = packets[i];
          p.trail.push({ x: p.x, y: p.y });
          if (p.trail.length > 9) p.trail.shift();

          if (!p.deflected && p.deflectAtStage !== null) {
            const triggerX = STAGE_XS[p.deflectAtStage] + NODE_W * 0.5;
            if (p.x >= triggerX) {
              p.deflected = true;
              p.vy = p.deflectDir * (p.kind === 'replay' ? 115 : 132);
              rings.push({
                x: p.x,
                y: p.y,
                radius: 4,
                maxRadius: 24,
                color: PACKET_COLORS[p.kind].core,
                alpha: 0.85,
              });
            }
          }

          p.x += p.speed * dt * (p.deflected && p.kind === 'conflict_shed' ? 0.35 : 1);
          if (p.deflected) {
            p.y += p.vy * dt;
            if (p.kind === 'replay' && p.y < 30) {
              p.y = 30;
              p.vy = 0;
            }
            if (p.kind === 'conflict_shed' && p.y > LOGICAL_H - 26) {
              p.alpha -= dt * 2.8;
            }
          } else {
            // Subtle sinusoidal flow weave inside the conduit
            p.y = CENTER_Y + p.laneOffset * 0.55 + Math.sin(p.x * 0.03 + p.id) * 2.6;
          }

          // Commit / leak shockwave at Stage 5
          const stage5Center = STAGE_XS[4] + NODE_W * 0.72;
          if (!p.deflected && p.x >= stage5Center && p.x - p.speed * dt < stage5Center) {
            rings.push({
              x: stage5Center,
              y: CENTER_Y,
              radius: 5,
              maxRadius: p.kind === 'double_spend' ? 38 : 24,
              color: PACKET_COLORS[p.kind].core,
              alpha: p.kind === 'double_spend' ? 0.95 : 0.65,
            });
          }

          if (p.x > LOGICAL_W + 16 || p.alpha <= 0.02 || p.y < 8 || p.y > LOGICAL_H + 10) {
            packets.splice(i, 1);
          }
        }

        for (let i = rings.length - 1; i >= 0; i--) {
          const r = rings[i];
          r.radius += (r.maxRadius - r.radius) * Math.min(1, dt * 6.5) + dt * 16;
          r.alpha -= dt * 1.65;
          if (r.alpha <= 0.02 || r.radius >= r.maxRadius) {
            rings.splice(i, 1);
          }
        }
      }

      // Draw Main Conduit Packets (enter/exit node ports cleanly without obscuring node text)
      const drawPacket = (p: TrafficPacket) => {
        const pal = PACKET_COLORS[p.kind];

        // Luminous trailing wake
        if (p.trail.length > 1) {
          for (let t = 1; t < p.trail.length; t++) {
            const frac = t / p.trail.length;
            ctx!.beginPath();
            ctx!.moveTo(p.trail[t - 1].x, p.trail[t - 1].y);
            ctx!.lineTo(p.trail[t].x, p.trail[t].y);
            ctx!.strokeStyle = pal.core;
            ctx!.globalAlpha = frac * 0.5 * p.alpha;
            ctx!.lineWidth = p.radius * 1.2 * frac;
            ctx!.lineCap = 'round';
            ctx!.stroke();
          }
        }

        // Outer halo
        ctx!.save();
        ctx!.globalAlpha = p.alpha;
        ctx!.beginPath();
        ctx!.arc(p.x, p.y, p.radius * (p.kind === 'double_spend' ? 2.6 : 2.0), 0, Math.PI * 2);
        ctx!.fillStyle = pal.glow;
        ctx!.fill();

        // Crisp packet core
        ctx!.beginPath();
        ctx!.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
        ctx!.fillStyle = pal.core;
        ctx!.fill();

        // Specular pinpoint highlight
        ctx!.beginPath();
        ctx!.arc(p.x - 0.8, p.y - 0.8, p.radius * 0.36, 0, Math.PI * 2);
        ctx!.fillStyle = '#ffffff';
        ctx!.globalAlpha = 0.85 * p.alpha;
        ctx!.fill();
        ctx!.restore();
      };

      for (const p of packets) {
        if (!p.deflected) drawPacket(p);
      }

      // Draw Stage Nodes (crisp, legible foreground over conduit tunnels)
      state.stages.forEach((st, idx) => {
        const x = STAGE_XS[idx];
        const y = NODE_Y;
        const isBypassed = idx === 2 && state.mode === 'NaiveUnprotected';
        const isLeakStage = state.isBreach && (idx === 3 || idx === 4);

        // Node subtle glow when critical/leak
        if (isLeakStage) {
          ctx!.save();
          ctx!.shadowColor = 'rgba(255, 23, 68, 0.45)';
          ctx!.shadowBlur = 18;
          drawRoundedRect(ctx!, x, y, NODE_W, NODE_H, 10);
          ctx!.fillStyle = dark ? '#1a0912' : '#fff1f2';
          ctx!.fill();
          ctx!.restore();
        } else {
          drawRoundedRect(ctx!, x, y, NODE_W, NODE_H, 10);
          ctx!.fillStyle = dark ? '#0b1426' : '#ffffff';
          ctx!.fill();
        }

        // Node border
        ctx!.save();
        if (isBypassed) ctx!.setLineDash([5, 4]);
        drawRoundedRect(ctx!, x, y, NODE_W, NODE_H, 10);
        ctx!.strokeStyle = isLeakStage
          ? '#ff1744'
          : isBypassed
            ? '#f43f5e'
            : st.accentColor;
        ctx!.globalAlpha = isLeakStage ? 0.92 : dark ? 0.65 : 0.78;
        ctx!.lineWidth = isLeakStage ? 1.8 : 1.35;
        ctx!.stroke();
        ctx!.restore();

        // Ingress & Egress Port Terminals on left/right center edges
        const portColor = isLeakStage ? '#ff1744' : st.accentColor;
        if (idx > 0) {
          ctx!.beginPath();
          ctx!.arc(x, CENTER_Y, 3.4, 0, Math.PI * 2);
          ctx!.fillStyle = portColor;
          ctx!.fill();
        }
        if (idx < 4) {
          ctx!.beginPath();
          ctx!.arc(x + NODE_W, CENTER_Y, 3.4, 0, Math.PI * 2);
          ctx!.fillStyle = portColor;
          ctx!.fill();
        }

        // Top accent bar inside node
        ctx!.fillStyle = st.accentColor;
        ctx!.globalAlpha = 0.85;
        ctx!.fillRect(x + 12, y + 1, NODE_W - 24, 2.2);
        ctx!.globalAlpha = 1;

        // Status indicator dot
        ctx!.beginPath();
        ctx!.arc(x + 14, y + 19, 3.6, 0, Math.PI * 2);
        ctx!.fillStyle = isLeakStage ? '#ff1744' : st.accentColor;
        ctx!.fill();

        // Stage title
        ctx!.font = '700 11px Inter, system-ui, sans-serif';
        ctx!.fillStyle = dark ? '#f8fafc' : '#0f172a';
        ctx!.fillText(st.title, x + 23, y + 22.5, NODE_W - 30);

        // Stage subtitle
        ctx!.font = '500 9.8px Inter, system-ui, sans-serif';
        ctx!.fillStyle = dark ? '#94a3b8' : '#475569';
        ctx!.fillText(st.subtitle, x + 12, y + 39, NODE_W - 24);

        // Metric pill inside node
        drawRoundedRect(ctx!, x + 10, y + 48, NODE_W - 20, 21, 5);
        ctx!.fillStyle = dark ? '#060a14' : '#f1f5f9';
        ctx!.fill();
        ctx!.font = '600 9.8px "JetBrains Mono", monospace';
        ctx!.fillStyle = isLeakStage
          ? dark
            ? '#fda4af'
            : '#be123c'
          : dark
            ? st.accentColor
            : '#0f172a';
        ctx!.fillText(st.metric, x + 16, y + 61.5, NODE_W - 32);
      });

      // Draw Pulse Rings & Deflected Packets cleanly in open replay/rejection lanes
      for (const r of rings) {
        if (r.radius <= 0) continue;
        ctx!.save();
        ctx!.beginPath();
        ctx!.arc(r.x, r.y, Math.max(0.5, r.radius), 0, Math.PI * 2);
        ctx!.strokeStyle = r.color;
        ctx!.globalAlpha = Math.max(0, r.alpha);
        ctx!.lineWidth = 1.6;
        ctx!.stroke();
        ctx!.restore();
      }

      for (const p of packets) {
        if (p.deflected) drawPacket(p);
      }

      // Double-spend blazing badge overlay when breach active
      if (state.isBreach) {
        const pulse = 0.72 + 0.28 * Math.sin(framePhase * 6);
        const bx = STAGE_XS[4] + 8;
        const by = 14;
        drawRoundedRect(ctx!, bx, by, 152, 24, 6);
        ctx!.fillStyle = `rgba(225, 29, 72, ${0.18 + 0.14 * pulse})`;
        ctx!.fill();
        ctx!.strokeStyle = `rgba(255, 23, 68, ${0.7 + 0.3 * pulse})`;
        ctx!.lineWidth = 1.25;
        ctx!.stroke();
        ctx!.font = '700 9.5px "JetBrains Mono", monospace';
        ctx!.fillStyle = dark ? '#fda4af' : '#9f1239';
        ctx!.fillText(`DOUBLE-SPEND: +${state.snapshot.overAllocatedUnits} LEAK`, bx + 10, by + 15.5);
      }

      ctx!.restore();
      rafId = requestAnimationFrame(render);
    }

    rafId = requestAnimationFrame(render);
    return () => cancelAnimationFrame(rafId);
  }, []);

  const conflictAndShedCount =
    snapshot.payloadConflicts409 + snapshot.rateLimitedRejections + snapshot.circuitBreakerRejections;

  return (
    <section
      data-testid="packet-topology-canvas"
      className="surface-panel overflow-hidden rounded-2xl border"
    >
      {/* Top Telemetry Strip */}
      <div className="border-hairline flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3">
        <div className="flex flex-wrap items-center gap-2.5">
          <span className="inline-flex items-center gap-1.5 rounded-md border border-cyan-500/30 bg-cyan-500/10 px-2 py-0.5 font-mono text-[10.5px] font-bold uppercase tracking-wider text-cyan-500 dark:text-cyan-300">
            <Radio className={`h-3 w-3 ${paused ? '' : 'animate-pulse'}`} />
            {paused ? 'STREAM PAUSED' : '60FPS LIVE TOPOLOGY'}
          </span>
          <span className="font-mono text-xs text-dim">
            Pipeline Mode:{' '}
            <strong className={isBreach ? 'text-rose-500 dark:text-rose-400' : 'text-heading'}>
              {mode}
            </strong>
          </span>
        </div>

        {/* Color-Coded Packet Legend + Pause Toggle */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 font-mono text-[11px]">
          <span className="inline-flex items-center gap-1.5 text-body">
            <span className="h-2.5 w-2.5 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.75)]" />
            200 Atomic ({snapshot.confirmedAllocations.toLocaleString()})
          </span>
          <span className="inline-flex items-center gap-1.5 text-body">
            <span className="h-2.5 w-2.5 rounded-full bg-amber-500 shadow-[0_0_8px_rgba(245,158,11,0.75)]" />
            200 Replay ({snapshot.idempotentReplays.toLocaleString()})
          </span>
          <span className="inline-flex items-center gap-1.5 text-body">
            <span className="h-2.5 w-2.5 rounded-full bg-rose-500 shadow-[0_0_8px_rgba(244,63,94,0.75)]" />
            409/429/503 ({conflictAndShedCount.toLocaleString()})
          </span>
          {isBreach && (
            <span className="inline-flex items-center gap-1.5 font-bold text-rose-500 dark:text-rose-400">
              <span className="animate-crimson-pulse h-2.5 w-2.5 rounded-full bg-[#ff1744] shadow-[0_0_10px_#ff1744]" />
              DOUBLE-SPEND LEAK (+{snapshot.overAllocatedUnits})
            </span>
          )}
          <button
            type="button"
            onClick={() => setPaused((p) => !p)}
            className="surface-chip inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[10.5px] font-semibold text-body transition"
            aria-label={paused ? 'Resume packet flow animation' : 'Pause packet flow animation'}
          >
            {paused ? <Play className="h-3 w-3" /> : <Pause className="h-3 w-3" />}
            {paused ? 'Resume' : 'Pause'}
          </button>
        </div>
      </div>

      {/* 60fps HTML5 Canvas Stream */}
      <div className="w-full overflow-x-auto">
        <div className="min-w-[820px]">
          <canvas
            ref={canvasRef}
            className="block h-[216px] w-full"
            aria-label="Live 60fps 5-stage concurrency pipeline packet stream"
          />
        </div>
      </div>

      {/* Synchronized Stage Utilization Bars & Queue-Depth Sparklines */}
      <div className="border-hairline grid grid-cols-1 gap-2.5 border-t p-3.5 sm:grid-cols-2 lg:grid-cols-5">
        {stages.map((st) => {
          const pts = st.queueDepthSparkline;
          const svgW = 120;
          const svgH = 26;
          const polyPoints = pts
            .map((val, idx) => {
              const px = (idx / Math.max(1, pts.length - 1)) * svgW;
              const py = svgH - (val / 100) * (svgH - 4) - 2;
              return `${px.toFixed(1)},${py.toFixed(1)}`;
            })
            .join(' ');
          const areaPoints = `0,${svgH} ${polyPoints} ${svgW},${svgH}`;
          const lastVal = pts[pts.length - 1] ?? 0;
          const lastY = svgH - (lastVal / 100) * (svgH - 4) - 2;

          return (
            <div
              key={st.id}
              className="surface-inset flex flex-col justify-between rounded-xl border p-2.5"
            >
              <div className="flex items-center justify-between gap-1">
                <span className="truncate font-mono text-[10.5px] font-bold text-heading">
                  S{st.index} · {st.title.replace(/^\d+\.\s*/, '')}
                </span>
                <span
                  className={`shrink-0 font-mono text-[10.5px] font-bold ${
                    st.status === 'critical'
                      ? 'text-rose-500 dark:text-rose-400'
                      : st.status === 'warning'
                        ? 'text-amber-600 dark:text-amber-400'
                        : 'text-emerald-600 dark:text-emerald-400'
                  }`}
                >
                  {st.utilizationPct}%
                </span>
              </div>

              {/* Stage Utilization Bar */}
              <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
                <div
                  style={{
                    width: `${Math.max(4, st.utilizationPct)}%`,
                    backgroundColor: st.accentColor,
                  }}
                  className="h-full rounded-full transition-all duration-500"
                />
              </div>

              {/* Queue-Depth Sparkline */}
              <div className="mt-2 flex items-end justify-between gap-2">
                <span className="font-mono text-[9.5px] uppercase tracking-wider text-faint">
                  Queue Depth
                </span>
                <svg
                  viewBox={`0 0 ${svgW} ${svgH}`}
                  className="h-[26px] w-[108px] shrink-0 overflow-visible"
                  aria-hidden="true"
                >
                  <polygon points={areaPoints} fill={st.accentColor} fillOpacity="0.16" />
                  <polyline
                    points={polyPoints}
                    fill="none"
                    stroke={st.accentColor}
                    strokeWidth="1.6"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                  <circle cx={svgW} cy={lastY} r="2.5" fill={st.accentColor} />
                </svg>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

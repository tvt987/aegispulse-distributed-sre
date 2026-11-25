import type { ConcurrencyMode, TelemetrySnapshot } from '../engine/types';

interface Props {
  mode: ConcurrencyMode;
  snapshot: TelemetrySnapshot;
  throughputRps: number;
  isRunning: boolean;
}

export function ArchitectureTopologySvg({ mode, snapshot, throughputRps, isRunning }: Props) {
  const isBreach = !snapshot.invariantIntact || snapshot.overAllocatedUnits > 0;
  const isCircuitOpen = snapshot.circuitState !== 'Closed' || snapshot.activeChaos.forceCircuitOpen;

  const primaryStroke = isBreach ? '#f43f5e' : isCircuitOpen ? '#f59e0b' : '#06b6d4';
  const ledgerStroke = isBreach ? '#f43f5e' : '#10b981';

  const nodes = [
    {
      x: 24,
      y: 42,
      w: 138,
      title: '1. Edge Traffic Burst',
      sub: `${throughputRps.toLocaleString()} RPS`,
      metric: `${snapshot.totalRequests.toLocaleString()} reqs`,
      color: '#38bdf8',
    },
    {
      x: 196,
      y: 42,
      w: 144,
      title: '2. Token-Bucket 429',
      sub: 'Lock-Free Limiter',
      metric: `${snapshot.rateLimitedRejections} shed`,
      color: snapshot.rateLimitedRejections > 0 ? '#f59e0b' : '#06b6d4',
    },
    {
      x: 374,
      y: 42,
      w: 156,
      title: '3. Idempotency Guard',
      sub: mode === 'NaiveUnprotected' ? 'BYPASSED (UNSAFE)' : 'SHA-256 + Replay',
      metric:
        mode === 'NaiveUnprotected'
          ? '0 deduped'
          : `${snapshot.idempotentReplays} replay · ${snapshot.payloadConflicts409}x 409`,
      color: mode === 'NaiveUnprotected' ? '#f43f5e' : '#22d3ee',
    },
    {
      x: 564,
      y: 42,
      w: 168,
      title:
        mode === 'AegisLockFreeChannel'
          ? '4. Redis Atomic Lua'
          : mode === 'OptimisticCas'
            ? '4. RowVersion CAS'
            : '4. Naive SELECT+UPDATE',
      sub: isCircuitOpen ? 'CIRCUIT OPEN (503)' : mode === 'AegisLockFreeChannel' ? 'EVALSHA Single-Thread' : 'Compare-And-Swap',
      metric: `${snapshot.confirmedAllocations} alloc · ${snapshot.totalCasRetries} spin`,
      color: isBreach ? '#f43f5e' : isCircuitOpen ? '#f59e0b' : '#10b981',
    },
    {
      x: 766,
      y: 42,
      w: 164,
      title: mode === 'AegisLockFreeChannel' ? '5. Channel<T> Outbox' : '5. Direct SQL Commit',
      sub: mode === 'AegisLockFreeChannel' ? 'Bounded Async WAL' : 'Sync Transaction',
      metric: isBreach
        ? `LEAK: +${snapshot.overAllocatedUnits} oversold!`
        : `Stock: ${snapshot.remainingStock}/${snapshot.initialStock}`,
      color: ledgerStroke,
    },
  ];

  return (
    <div className="w-full overflow-x-auto rounded-xl border border-slate-800/90 bg-[#070d1b]/90 p-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2 px-1 text-xs">
        <span className="font-mono uppercase tracking-wider text-slate-400">
          Live Request Pipeline Topology · Mode:{' '}
          <strong className={isBreach ? 'text-rose-400' : 'text-cyan-300'}>{mode}</strong>
        </span>
        <span className="font-mono text-slate-400">
          p50: <strong className="text-slate-200">{(snapshot.p50LatencyUs / 1000).toFixed(3)}ms</strong> · p99:{' '}
          <strong className={snapshot.p99LatencyUs > 20000 ? 'text-amber-300' : 'text-emerald-300'}>
            {(snapshot.p99LatencyUs / 1000).toFixed(3)}ms
          </strong>
        </span>
      </div>

      <svg viewBox="0 0 955 156" className="h-auto w-full min-w-[760px]">
        <defs>
          <linearGradient id="pipeGrad" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor={primaryStroke} stopOpacity="0.35" />
            <stop offset="100%" stopColor={ledgerStroke} stopOpacity="0.9" />
          </linearGradient>
        </defs>

        {/* Connecting conduits */}
        {[
          [162, 196],
          [340, 374],
          [530, 564],
          [732, 766],
        ].map(([x1, x2], idx) => (
          <g key={idx}>
            <line x1={x1} y1={86} x2={x2} y2={86} stroke="#1e293b" strokeWidth="4" strokeLinecap="round" />
            <line
              x1={x1}
              y1={86}
              x2={x2}
              y2={86}
              stroke="url(#pipeGrad)"
              strokeWidth="3"
              strokeLinecap="round"
              className={isRunning || snapshot.totalRequests > 0 ? 'animate-packet' : ''}
            />
          </g>
        ))}

        {/* Pipeline Nodes */}
        {nodes.map((n, i) => (
          <g key={i} transform={`translate(${n.x}, ${n.y})`}>
            <rect
              width={n.w}
              height={88}
              rx={10}
              fill="#0b1325"
              stroke={n.color}
              strokeOpacity="0.55"
              strokeWidth="1.5"
            />
            <circle cx={14} cy={18} r={4} fill={n.color} />
            <text x={24} y={22} fill="#f1f5f9" fontSize="11.5" fontWeight="700">
              {n.title}
            </text>
            <text x={14} y={44} fill="#94a3b8" fontSize="10.5">
              {n.sub}
            </text>
            <rect x={10} y={56} width={n.w - 20} height={22} rx={5} fill="#060913" />
            <text x={16} y={71} fill={n.color} fontSize="10.5" fontFamily="JetBrains Mono, monospace" fontWeight="600">
              {n.metric}
            </text>
          </g>
        ))}
      </svg>
    </div>
  );
}

import { useMemo, useState } from 'react';
import {
  AlertTriangle,
  Check,
  Code2,
  Copy,
  Cpu,
  Database,
  Gauge,
  HardDrive,
  Layers,
  Lock,
  RotateCcw,
  ShieldAlert,
  ShieldCheck,
  Zap,
} from 'lucide-react';
import {
  DEFAULT_SQL_CONCURRENCY_RPS,
  DEFAULT_SQL_ROW_COUNT,
  DEFAULT_SQL_VOUCHER_CODE,
  evaluateSqlExecutionPlan,
  SQL_STAGE_ORDER,
  type SqlOptimizationStage,
} from '../engines/sqlPlanAdvisorEngine';
import type { ThemeMode } from '../engine/types';
import type { LangMode } from '../i18n/translations';

interface SqlPlanAdvisorLabProps {
  lang: LangMode;
  theme: ThemeMode;
}

type CodeTab = 'tsql' | 'dapper' | 'lua';

export function SqlPlanAdvisorLab({ lang, theme }: SqlPlanAdvisorLabProps) {
  const [stage, setStage] = useState<SqlOptimizationStage>('legacy-ef-scan');
  const [tableRowCount, setTableRowCount] = useState<number>(DEFAULT_SQL_ROW_COUNT);
  const [concurrencyRps, setConcurrencyRps] = useState<number>(DEFAULT_SQL_CONCURRENCY_RPS);
  const [selectedOperatorId, setSelectedOperatorId] = useState<string>('op-scan');
  const [codeTab, setCodeTab] = useState<CodeTab>('tsql');
  const [copiedCode, setCopiedCode] = useState<boolean>(false);

  const isVi = lang === 'vi';
  const isDark = theme === 'dark';

  const plan = useMemo(
    () =>
      evaluateSqlExecutionPlan(stage, tableRowCount, concurrencyRps, DEFAULT_SQL_VOUCHER_CODE),
    [stage, tableRowCount, concurrencyRps]
  );

  const selectedOperator = useMemo(
    () => plan.operators.find((op) => op.id === selectedOperatorId) ?? plan.operators[0],
    [plan.operators, selectedOperatorId]
  );

  const handleSelectStage = (nextStage: SqlOptimizationStage) => {
    setStage(nextStage);
    const nextPlan = evaluateSqlExecutionPlan(
      nextStage,
      tableRowCount,
      concurrencyRps,
      DEFAULT_SQL_VOUCHER_CODE
    );
    setSelectedOperatorId(nextPlan.operators[0].id);
    if (nextStage === 'legacy-ef-scan') {
      setCodeTab('tsql');
    } else if (nextStage === 'covering-dapper-cas') {
      setCodeTab('dapper');
    } else {
      setCodeTab('lua');
    }
  };

  const handleReset = () => {
    setTableRowCount(DEFAULT_SQL_ROW_COUNT);
    setConcurrencyRps(DEFAULT_SQL_CONCURRENCY_RPS);
    handleSelectStage('legacy-ef-scan');
  };

  const activeCodeText =
    codeTab === 'tsql'
      ? plan.recommendedIndexDdl
      : codeTab === 'dapper'
        ? plan.recommendedDapperCSharp
        : plan.recommendedRedisLua;

  const handleCopyCode = async () => {
    try {
      await navigator.clipboard.writeText(activeCodeText);
      setCopiedCode(true);
      window.setTimeout(() => setCopiedCode(false), 1800);
    } catch {
      setCopiedCode(true);
      window.setTimeout(() => setCopiedCode(false), 1800);
    }
  };

  const isLegacy = stage === 'legacy-ef-scan';
  const isCovering = stage === 'covering-dapper-cas';
  const isRedis = stage === 'redis-lua-write-behind';

  // Compute SVG layout positions for physical operator tree (left-to-right data flow)
  const opCount = plan.operators.length;
  const svgWidth = 920;
  const svgHeight = 236;
  const cardW = opCount === 5 ? 160 : 196;
  const cardH = 132;
  const horizontalGap = opCount === 5 ? 20 : 32;
  const totalRowWidth = opCount * cardW + (opCount - 1) * horizontalGap;
  const startX = Math.max(16, Math.round((svgWidth - totalRowWidth) / 2));
  const cardY = 48;

  return (
    <section
      data-testid="sql-plan-advisor-lab"
      className="min-w-0 space-y-5"
      aria-label="SQL Server Execution Plan Simulator and Dapper Index Advisor"
    >
      {/* Hero Banner & 3-Stage Architectural Switcher */}
      <div className="surface-panel min-w-0 rounded-2xl border p-4 sm:p-5">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-cyan-500/40 bg-cyan-500/12 px-2.5 py-0.5 font-mono text-[10.5px] font-bold uppercase tracking-wider text-cyan-700 dark:text-cyan-300">
                <Database className="h-3 w-3 shrink-0" />
                {isVi
                  ? 'AegisPulse v5.0 · TRINH MO PHONG KE HOACH THUC THI SQL SERVER & DAPPER'
                  : 'AEGISPULSE V5.0 · SQL SERVER EXECUTION PLAN & DAPPER INDEX ADVISOR'}
              </span>
              <span className="surface-chip rounded-full border px-2.5 py-0.5 font-mono text-[10.5px] font-semibold text-dim">
                dbo.Vouchers ({(tableRowCount / 1_000_000).toFixed(1)}M rows) + dbo.VoucherRedemptions ·{' '}
                {concurrencyRps.toLocaleString()} RPS
              </span>
            </div>

            <h1 className="mt-2 text-lg font-extrabold tracking-tight text-heading sm:text-xl">
              {isVi
                ? 'Phan Tich Execution Plan 5 Trieu Dong: EF Core Scan vs Covering Index Dapper vs Redis Lua'
                : '5,000,000-Row SQL Server Execution Plan Simulator & Covering Index Advisor'}
            </h1>
            <p className="mt-1 max-w-3xl text-xs leading-relaxed text-dim sm:text-sm">
              {isVi
                ? 'Chuyen doi qua 3 giai doan toi uu thuc chien tai Con Cung de kiem chung cach triet tieu Clustered Index Scan 14,200 logical reads, tranh leo thang khoa TABLE va giam do tre tu 28.4 ms xuong 1.8 ms (-93.7%) roi 0.42 ms.'
                : 'Toggle through the 3 progressive optimization stages from Con Cung’s 700-store retail checkout: inspect how a filtered covering index + Dapper ROWVERSION CAS cuts latency from 28.4 ms to 1.8 ms (-93.7%) and Redis Lua drops burst contention to 0.42 ms with 0 SQL reads.'}
            </p>
          </div>

          <button
            type="button"
            data-testid="btn-sql-reset"
            onClick={handleReset}
            className="surface-chip inline-flex shrink-0 items-center gap-1.5 self-start rounded-xl border px-3.5 py-2 text-xs font-semibold text-body transition hover:border-cyan-500 hover:text-heading"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            {isVi ? 'Mac Dinh 5M Dong / 5K RPS' : 'Reset 5M Rows / 5K RPS'}
          </button>
        </div>

        {/* 3 Stage Selector Cards */}
        <div className="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-3">
          {SQL_STAGE_ORDER.map((stageKey) => {
            const summary = plan.allStagesComparison.find((s) => s.stage === stageKey)!;
            const isSelected = stage === stageKey;
            const stageNum = summary.stageNumber;

            const toneBorder = isSelected
              ? stageNum === 1
                ? 'border-rose-500 bg-rose-500/10 ring-1 ring-rose-500/40'
                : stageNum === 2
                  ? 'border-cyan-500 bg-cyan-500/10 ring-1 ring-cyan-500/40'
                  : 'border-emerald-500 bg-emerald-500/10 ring-1 ring-emerald-500/40'
              : 'surface-inset hover:border-cyan-500/50';

            const badgeTone =
              stageNum === 1
                ? 'bg-rose-500/20 text-rose-700 dark:text-rose-300'
                : stageNum === 2
                  ? 'bg-cyan-500/20 text-cyan-700 dark:text-cyan-300'
                  : 'bg-emerald-500/20 text-emerald-700 dark:text-emerald-300';

            return (
              <button
                key={stageKey}
                type="button"
                data-testid={`sql-stage-${stageNum}`}
                onClick={() => handleSelectStage(stageKey)}
                className={`rounded-xl border p-3.5 text-left transition ${toneBorder}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className={`rounded px-2 py-0.5 font-mono text-[10px] font-bold uppercase ${badgeTone}`}>
                    STAGE {stageNum}
                  </span>
                  <span className="font-mono text-xs font-extrabold text-heading">
                    {summary.executionTimeMs} ms
                  </span>
                </div>
                <div className="mt-2 text-xs font-bold text-heading sm:text-sm">
                  {stageNum === 1
                    ? 'Legacy EF Core + Clustered Index Scan'
                    : stageNum === 2
                      ? 'Covering Index + Dapper + ROWVERSION CAS'
                      : 'Redis Atomic Lua Guard + Async Write-Behind'}
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[11px] text-dim">
                  <span>{summary.logicalReads.toLocaleString()} reads</span>
                  <span>{summary.memoryFootprintMb} MB RAM</span>
                  {stageNum > 1 && (
                    <span className="font-bold text-emerald-600 dark:text-emerald-400">
                      -{summary.latencyReductionPctVsLegacy}% latency
                    </span>
                  )}
                  {stageNum === 1 && (
                    <span className="font-bold text-rose-600 dark:text-rose-400">
                      Lock Escalation
                    </span>
                  )}
                </div>
              </button>
            );
          })}
        </div>

        {/* Workload Sliders */}
        <div className="mt-4 grid grid-cols-1 gap-4 rounded-xl border border-hairline surface-inset p-3.5 sm:grid-cols-2">
          <div>
            <div className="flex items-center justify-between text-xs">
              <span className="font-medium text-dim">
                {isVi ? 'Quy Mo Bang dbo.Vouchers (So Dong)' : 'dbo.Vouchers Table Row Count'}
              </span>
              <span className="font-mono font-bold text-cyan-600 dark:text-cyan-300">
                {tableRowCount.toLocaleString()} rows
              </span>
            </div>
            <input
              type="range"
              aria-label="Vouchers Table Row Count"
              min={500_000}
              max={15_000_000}
              step={500_000}
              value={tableRowCount}
              onChange={(e) => setTableRowCount(Number(e.target.value))}
              className="mt-2 w-full accent-cyan-500"
            />
          </div>

          <div>
            <div className="flex items-center justify-between text-xs">
              <span className="font-medium text-dim">
                {isVi ? 'Tai Dong Thoi Flash-Sale (RPS)' : 'Concurrent Flash-Sale Load (RPS)'}
              </span>
              <span className="font-mono font-bold text-emerald-600 dark:text-emerald-300">
                {concurrencyRps.toLocaleString()} RPS
              </span>
            </div>
            <input
              type="range"
              aria-label="Concurrent Flash-Sale Load"
              min={1_000}
              max={15_000}
              step={500}
              value={concurrencyRps}
              onChange={(e) => setConcurrencyRps(Number(e.target.value))}
              className="mt-2 w-full accent-emerald-500"
            />
          </div>
        </div>
      </div>

      {/* Live 4-KPI Proof Strip */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="surface-panel rounded-xl border p-4">
          <div className="flex items-center justify-between text-[11px] font-semibold uppercase tracking-wider text-dim">
            <span>Query Execution Latency</span>
            <Gauge className="h-4 w-4 text-cyan-500" />
          </div>
          <div
            data-testid="sql-latency-value"
            className={`mt-1.5 font-mono text-2xl font-extrabold ${
              isLegacy
                ? 'text-rose-600 dark:text-rose-400'
                : isCovering
                  ? 'text-cyan-600 dark:text-cyan-300'
                  : 'text-emerald-600 dark:text-emerald-300'
            }`}
          >
            {plan.executionTimeMs} ms
          </div>
          <div className="mt-1 font-mono text-[11px] text-dim">
            P99: {plan.p99LatencyMs} ms ·{' '}
            {plan.latencyReductionPctVsLegacy > 0
              ? `-${plan.latencyReductionPctVsLegacy}% vs Stage 1`
              : 'Unoptimized Baseline'}
          </div>
        </div>

        <div className="surface-panel rounded-xl border p-4">
          <div className="flex items-center justify-between text-[11px] font-semibold uppercase tracking-wider text-dim">
            <span>SQL Logical Reads (8KB Pages)</span>
            <HardDrive className="h-4 w-4 text-emerald-500" />
          </div>
          <div
            data-testid="sql-reads-value"
            className={`mt-1.5 font-mono text-2xl font-extrabold ${
              isLegacy
                ? 'text-rose-600 dark:text-rose-400'
                : 'text-emerald-600 dark:text-emerald-300'
            }`}
          >
            {plan.logicalReads.toLocaleString()}
          </div>
          <div className="mt-1 font-mono text-[11px] text-dim">
            {plan.pagesScannedMb} MB scanned/query ·{' '}
            {plan.logicalReadReductionPctVsLegacy > 0
              ? `-${plan.logicalReadReductionPctVsLegacy}% I/O`
              : 'Full Table Scan'}
          </div>
        </div>

        <div className="surface-panel rounded-xl border p-4">
          <div className="flex items-center justify-between text-[11px] font-semibold uppercase tracking-wider text-dim">
            <span>Worker Memory / Heap</span>
            <Cpu className="h-4 w-4 text-sky-500" />
          </div>
          <div
            data-testid="sql-memory-value"
            className={`mt-1.5 font-mono text-2xl font-extrabold ${
              isLegacy
                ? 'text-amber-600 dark:text-amber-300'
                : 'text-cyan-600 dark:text-cyan-300'
            }`}
          >
            {plan.memoryFootprintMb} MB
          </div>
          <div className="mt-1 font-mono text-[11px] text-dim">
            {isLegacy
              ? 'EF Core ChangeTracker Gen2 GC'
              : isCovering
                ? `Dapper Direct DTO (-${plan.memoryReductionPctVsLegacy}%)`
                : `Pooled Zero-Alloc (-${plan.memoryReductionPctVsLegacy}%)`}
          </div>
        </div>

        <div className="surface-panel rounded-xl border p-4">
          <div className="flex items-center justify-between text-[11px] font-semibold uppercase tracking-wider text-dim">
            <span>Lock Granularity &amp; Safety</span>
            {plan.hasLockEscalationWarning ? (
              <ShieldAlert className="h-4 w-4 text-rose-500" />
            ) : (
              <ShieldCheck className="h-4 w-4 text-emerald-500" />
            )}
          </div>
          <div
            data-testid="sql-lock-status"
            className={`mt-1.5 font-mono text-sm font-extrabold leading-snug ${
              plan.hasLockEscalationWarning
                ? 'text-rose-600 dark:text-rose-400'
                : 'text-emerald-600 dark:text-emerald-300'
            }`}
          >
            {plan.lockGranularity}
          </div>
          <div className="mt-1 font-mono text-[11px] text-dim">
            {plan.hasLockEscalationWarning
              ? 'KEY LOOKUP -> TABLE ESCALATION'
              : isRedis
                ? '0 SQL Contention on Burst Losers'
                : 'Zero Key Lookups · Row CAS'}
          </div>
        </div>
      </div>

      {/* Interactive SVG Query Execution Operator Tree */}
      <div className="surface-panel min-w-0 rounded-2xl border p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="flex items-center gap-2 text-sm font-bold text-heading">
              <Layers className="h-4 w-4 text-cyan-500" />
              {isVi
                ? 'So Do Cay Toan Tu Thuc Thi SQL Server (SVG Interactive Operator Tree)'
                : 'Interactive SQL Server Query Execution Operator Tree (Click Any Operator)'}
            </h2>
            <p className="mt-0.5 text-xs text-dim">{plan.subtitle}</p>
          </div>
          <span
            className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 font-mono text-[11px] font-bold ${
              plan.hasLockEscalationWarning
                ? 'bg-rose-500/15 text-rose-700 dark:text-rose-300'
                : 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
            }`}
          >
            {plan.hasLockEscalationWarning ? (
              <AlertTriangle className="h-3.5 w-3.5" />
            ) : (
              <Zap className="h-3.5 w-3.5" />
            )}
            Total Operator Cost: 100% · {plan.executionTimeMs} ms
          </span>
        </div>

        <div className="mt-4 w-full overflow-x-auto rounded-xl border border-hairline surface-inset p-2">
          <svg
            data-testid="sql-operator-tree-svg"
            viewBox={`0 0 ${svgWidth} ${svgHeight}`}
            className="mx-auto block h-auto w-full min-w-[680px]"
            role="img"
            aria-label={`SQL Server Execution Plan Operator Tree for ${plan.title}`}
          >
            <defs>
              <marker
                id="sql-arrow-active"
                markerWidth="8"
                markerHeight="8"
                refX="7"
                refY="4"
                orient="auto"
              >
                <path
                  d="M0,1 L7,4 L0,7 Z"
                  fill={isLegacy ? '#f43f5e' : isCovering ? '#06b6d4' : '#10b981'}
                />
              </marker>
            </defs>

            {/* Pipeline Direction Header */}
            <text
              x={startX}
              y={24}
              fill={isDark ? '#94a3b8' : '#475569'}
              fontSize="11"
              fontFamily="JetBrains Mono, monospace"
              fontWeight="600"
            >
              STORAGE / ENTRY OPERATOR
            </text>
            <text
              x={startX + totalRowWidth}
              y={24}
              textAnchor="end"
              fill={isDark ? '#94a3b8' : '#475569'}
              fontSize="11"
              fontFamily="JetBrains Mono, monospace"
              fontWeight="600"
            >
              CLIENT RECEIPT / OUTPUT
            </text>

            {/* Connecting Flow Arrows between Operators */}
            {plan.operators.slice(0, -1).map((op, idx) => {
              const x1 = startX + idx * (cardW + horizontalGap) + cardW;
              const x2 = x1 + horizontalGap;
              const yMid = cardY + cardH / 2;
              const strokeColor = isLegacy ? '#f43f5e' : isCovering ? '#06b6d4' : '#10b981';
              const strokeWidth = op.estimatedRows > 100_000 ? 4.5 : op.estimatedRows > 100 ? 3 : 2;
              return (
                <g key={`edge-${op.id}`}>
                  <line
                    x1={x1}
                    y1={yMid}
                    x2={x2 - 3}
                    y2={yMid}
                    stroke={strokeColor}
                    strokeOpacity={0.35}
                    strokeWidth={strokeWidth}
                  />
                  <line
                    x1={x1}
                    y1={yMid}
                    x2={x2 - 3}
                    y2={yMid}
                    stroke={strokeColor}
                    strokeWidth={Math.max(1.8, strokeWidth - 1)}
                    className="animate-packet"
                    markerEnd="url(#sql-arrow-active)"
                  />
                </g>
              );
            })}

            {/* Clickable Operator Cards */}
            {plan.operators.map((op, idx) => {
              const x = startX + idx * (cardW + horizontalGap);
              const isSelected = selectedOperator.id === op.id;
              const isHot = op.costPercent >= 45 && isLegacy;
              const borderStroke = isSelected
                ? isLegacy
                  ? '#fb7185'
                  : isCovering
                    ? '#22d3ee'
                    : '#34d399'
                : op.warning
                  ? 'rgba(244, 63, 94, 0.55)'
                  : isDark
                    ? 'rgba(71, 85, 105, 0.85)'
                    : 'rgba(148, 163, 184, 0.7)';

              const cardFill = isDark ? '#0b1326' : '#ffffff';
              const badgeFill = isHot
                ? 'rgba(244, 63, 94, 0.22)'
                : isCovering
                  ? 'rgba(6, 182, 212, 0.20)'
                  : isRedis
                    ? 'rgba(16, 185, 129, 0.20)'
                    : 'rgba(245, 158, 11, 0.20)';
              const badgeText = isHot
                ? isDark
                  ? '#fda4af'
                  : '#be123c'
                : isCovering
                  ? isDark
                    ? '#67e8f9'
                    : '#0e7490'
                  : isRedis
                    ? isDark
                      ? '#6ee7b7'
                      : '#047857'
                    : isDark
                      ? '#fcd34d'
                      : '#b45309';

              return (
                <g
                  key={op.id}
                  data-testid={`sql-op-${op.id}`}
                  onClick={() => setSelectedOperatorId(op.id)}
                  style={{ cursor: 'pointer' }}
                >
                  <rect
                    x={x}
                    y={cardY}
                    width={cardW}
                    height={cardH}
                    rx={12}
                    fill={cardFill}
                    stroke={borderStroke}
                    strokeWidth={isSelected ? 2.4 : 1.3}
                  />

                  {/* Cost % Pill */}
                  <rect x={x + 10} y={cardY + 10} width={58} height={20} rx={6} fill={badgeFill} />
                  <text
                    x={x + 39}
                    y={cardY + 24}
                    textAnchor="middle"
                    fill={badgeText}
                    fontSize="10.5"
                    fontFamily="JetBrains Mono, monospace"
                    fontWeight="700"
                  >
                    {op.costPercent}% COST
                  </text>

                  {/* CPU ms */}
                  <text
                    x={x + cardW - 10}
                    y={cardY + 24}
                    textAnchor="end"
                    fill={isDark ? '#cbd5e1' : '#334155'}
                    fontSize="10.5"
                    fontFamily="JetBrains Mono, monospace"
                    fontWeight="700"
                  >
                    {op.cpuMs} ms
                  </text>

                  {/* Operator Name */}
                  <text
                    x={x + 10}
                    y={cardY + 50}
                    fill={isDark ? '#f8fafc' : '#0f172a'}
                    fontSize="11.5"
                    fontFamily="Inter, sans-serif"
                    fontWeight="700"
                  >
                    {op.name.length > 22 ? `${op.name.slice(0, 21)}...` : op.name}
                  </text>

                  {/* Physical Op Subtitle */}
                  <text
                    x={x + 10}
                    y={cardY + 67}
                    fill={isDark ? '#94a3b8' : '#475569'}
                    fontSize="9.5"
                    fontFamily="JetBrains Mono, monospace"
                  >
                    {op.physicalOp.length > 24 ? `${op.physicalOp.slice(0, 23)}...` : op.physicalOp}
                  </text>

                  {/* Metrics Separator */}
                  <line
                    x1={x + 10}
                    y1={cardY + 78}
                    x2={x + cardW - 10}
                    y2={cardY + 78}
                    stroke={isDark ? 'rgba(71,85,105,0.5)' : 'rgba(148,163,184,0.45)'}
                  />

                  {/* Logical Reads & Est Rows */}
                  <text
                    x={x + 10}
                    y={cardY + 96}
                    fill={isDark ? '#94a3b8' : '#475569'}
                    fontSize="9.5"
                    fontFamily="JetBrains Mono, monospace"
                  >
                    Reads: {op.logicalReads.toLocaleString()}
                  </text>
                  <text
                    x={x + 10}
                    y={cardY + 112}
                    fill={isDark ? '#94a3b8' : '#475569'}
                    fontSize="9.5"
                    fontFamily="JetBrains Mono, monospace"
                  >
                    Rows: {op.estimatedRows >= 1_000_000 ? `${(op.estimatedRows / 1_000_000).toFixed(1)}M` : op.estimatedRows.toLocaleString()}
                  </text>

                  {/* Lock / Warning Footer Bar */}
                  <rect
                    x={x + 10}
                    y={cardY + cardH + 10}
                    width={cardW - 20}
                    height={22}
                    rx={6}
                    fill={
                      op.warning
                        ? 'rgba(244, 63, 94, 0.14)'
                        : isDark
                          ? 'rgba(15, 23, 42, 0.9)'
                          : 'rgba(241, 245, 249, 0.95)'
                    }
                    stroke={
                      op.warning
                        ? 'rgba(244, 63, 94, 0.45)'
                        : isDark
                          ? 'rgba(51, 65, 85, 0.65)'
                          : 'rgba(203, 213, 225, 0.9)'
                    }
                  />
                  <text
                    x={x + cardW / 2}
                    y={cardY + cardH + 24}
                    textAnchor="middle"
                    fill={
                      op.warning
                        ? isDark
                          ? '#fda4af'
                          : '#be123c'
                        : isDark
                          ? '#94a3b8'
                          : '#475569'
                    }
                    fontSize="9"
                    fontFamily="JetBrains Mono, monospace"
                    fontWeight="600"
                  >
                    {op.lockGranularity.length > 22
                      ? `${op.lockGranularity.slice(0, 21)}...`
                      : op.lockGranularity}
                  </text>
                </g>
              );
            })}
          </svg>
        </div>

        {/* Selected Operator Inspector */}
        <div
          data-testid="sql-operator-inspector"
          className="mt-4 grid grid-cols-1 gap-3 rounded-xl border border-hairline surface-inset p-4 lg:grid-cols-12"
        >
          <div className="lg:col-span-7">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-xs font-extrabold text-heading">
                {selectedOperator.name}
              </span>
              <span className="surface-chip rounded border px-2 py-0.5 font-mono text-[10.5px] text-cyan-700 dark:text-cyan-300">
                {selectedOperator.physicalOp}
              </span>
              <span className="surface-chip rounded border px-2 py-0.5 font-mono text-[10.5px] text-dim">
                Wait: {selectedOperator.waitType}
              </span>
            </div>
            <p className="mt-1.5 text-xs leading-relaxed text-body">{selectedOperator.summary}</p>
            {selectedOperator.warning && (
              <div className="mt-2 flex items-start gap-2 rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-700 dark:text-rose-300">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>{selectedOperator.warning}</span>
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:col-span-5 lg:grid-cols-2">
            {[
              { k: 'Operator Cost', v: `${selectedOperator.costPercent}%` },
              { k: 'Logical Reads', v: selectedOperator.logicalReads.toLocaleString() },
              { k: 'CPU Duration', v: `${selectedOperator.cpuMs} ms` },
              { k: 'Lock Granularity', v: selectedOperator.lockGranularity.split(' ')[0] },
            ].map((item) => (
              <div key={item.k} className="surface-panel rounded-lg border p-2.5">
                <div className="text-[10px] font-semibold uppercase text-dim">{item.k}</div>
                <div className="mt-0.5 font-mono text-xs font-extrabold text-heading">{item.v}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Bottom Grid: 3-Stage Benchmark Comparison + Auto-Generated Copyable T-SQL / Dapper / Lua */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
        {/* Left: Comparison Matrix */}
        <div className="surface-panel min-w-0 rounded-2xl border p-4 sm:p-5 lg:col-span-5">
          <h3 className="flex items-center gap-2 text-sm font-bold text-heading">
            <Lock className="h-4 w-4 text-emerald-500" />
            {isVi ? 'Bang Doi Chieu 3 Giai Doan Toi Uu' : '3-Stage Optimization Delta Matrix'}
          </h3>
          <p className="mt-1 text-xs text-dim">
            {isVi
              ? 'So sanh truc tiep do tre, so trang doc 8KB va bo nho managed heap.'
              : 'Direct comparison at your selected table row volume and flash-sale RPS.'}
          </p>

          <div className="mt-3 w-full overflow-x-auto">
            <table className="w-full min-w-[340px] text-left font-mono text-xs">
              <thead>
                <tr className="border-b border-hairline text-[10.5px] uppercase text-dim">
                  <th className="py-2 pr-2">Stage</th>
                  <th className="py-2 pr-2">Latency</th>
                  <th className="py-2 pr-2">Reads</th>
                  <th className="py-2">RAM</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-800/70">
                {plan.allStagesComparison.map((row) => {
                  const active = row.stage === stage;
                  return (
                    <tr
                      key={row.stage}
                      onClick={() => handleSelectStage(row.stage)}
                      className={`cursor-pointer transition ${
                        active ? 'bg-cyan-500/10' : 'hover:bg-slate-500/5'
                      }`}
                    >
                      <td className="py-2.5 pr-2 font-semibold text-heading">
                        S{row.stageNumber}:{' '}
                        {row.stageNumber === 1
                          ? 'EF Core Scan'
                          : row.stageNumber === 2
                            ? 'Covering + Dapper'
                            : 'Redis Lua Guard'}
                      </td>
                      <td
                        className={`py-2.5 pr-2 font-bold ${
                          row.stageNumber === 1
                            ? 'text-rose-600 dark:text-rose-400'
                            : 'text-emerald-600 dark:text-emerald-300'
                        }`}
                      >
                        {row.executionTimeMs} ms
                      </td>
                      <td className="py-2.5 pr-2 text-body">{row.logicalReads.toLocaleString()}</td>
                      <td className="py-2.5 text-body">{row.memoryFootprintMb} MB</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* Right: Auto-Generated T-SQL Index DDL & .NET 10 Dapper Code */}
        <div className="surface-panel min-w-0 rounded-2xl border p-4 sm:p-5 lg:col-span-7">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="flex items-center gap-2 text-sm font-bold text-heading">
              <Code2 className="h-4 w-4 text-cyan-500" />
              {isVi
                ? 'Ma T-SQL Covering Index & .NET 10 Dapper Tu Dong Sinh'
                : 'Auto-Generated T-SQL Covering Index DDL & .NET 10 Dapper Implementation'}
            </h3>

            <button
              type="button"
              data-testid="btn-copy-sql-code"
              onClick={() => void handleCopyCode()}
              className="surface-chip inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 font-mono text-[11px] font-bold text-heading transition hover:border-cyan-500"
            >
              {copiedCode ? (
                <>
                  <Check className="h-3.5 w-3.5 text-emerald-500" />
                  <span>Copied</span>
                </>
              ) : (
                <>
                  <Copy className="h-3.5 w-3.5 text-cyan-500" />
                  <span>Copy Code</span>
                </>
              )}
            </button>
          </div>

          <div className="mt-3 flex flex-wrap gap-1.5">
            {[
              { id: 'tsql' as CodeTab, label: 'T-SQL Covering Index DDL' },
              { id: 'dapper' as CodeTab, label: 'C# .NET 10 Dapper + ROWVERSION' },
              { id: 'lua' as CodeTab, label: 'Redis Lua EVALSHA Guard' },
            ].map((t) => (
              <button
                key={t.id}
                type="button"
                data-testid={`sql-code-tab-${t.id}`}
                onClick={() => setCodeTab(t.id)}
                className={`rounded-lg px-2.5 py-1 font-mono text-[11px] font-semibold transition ${
                  codeTab === t.id
                    ? 'bg-cyan-500/18 text-cyan-700 ring-1 ring-cyan-500/50 dark:text-cyan-300'
                    : 'surface-chip text-dim hover:text-heading'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          <pre
            data-testid="sql-generated-code"
            className="surface-code mt-3 max-w-full overflow-x-auto rounded-xl border p-3.5 font-mono text-[11.5px] leading-relaxed text-slate-200"
          >
            {activeCodeText}
          </pre>
        </div>
      </div>
    </section>
  );
}

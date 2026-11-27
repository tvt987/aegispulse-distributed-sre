import type { ClusterTopologyState } from './chaosEngine';
import type { LoadStressTelemetry } from './loadProfilerEngine';

export const UTF8_BOM = '\uFEFF';

export type RunbookStepId = 'detect' | 'mitigate' | 'drain' | 'verify' | 'export';
export type RunbookStepStatus = 'pending' | 'completed';
export type RunbookLifecycle = 'idle' | 'in_progress' | 'resolved';

export interface RunbookStep {
  id: RunbookStepId;
  order: number;
  phase: string;
  title: string;
  titleVi: string;
  description: string;
  descriptionVi: string;
  cliCommand: string;
  targetSlaSec: number;
  status: RunbookStepStatus;
  executedAtUtc: string | null;
  elapsedSec: number;
  verificationOutput: string | null;
  p99SnapshotMs: number | null;
}

export interface RunbookTimelineEntry {
  id: string;
  stepId: RunbookStepId;
  timestampUtc: string;
  actor: string;
  summary: string;
  command: string;
  p99Ms: number;
  quorumLabel: string;
}

export interface RunbookState {
  incidentId: string;
  commander: string;
  startedAtUtc: string | null;
  resolvedAtUtc: string | null;
  lifecycle: RunbookLifecycle;
  baselineP99Ms: number | null;
  currentP99Ms: number | null;
  mttrSeconds: number;
  steps: RunbookStep[];
  timeline: RunbookTimelineEntry[];
}

export interface RunbookExecutionContext {
  cluster: ClusterTopologyState;
  loadProfile: LoadStressTelemetry;
}

export interface RunbookStepResult {
  nextState: RunbookState;
  shouldRestoreCluster: boolean;
  shouldClearDbAndCacheFaults: boolean;
}

export function ensureUtf8Bom(text: string): string {
  return text.startsWith(UTF8_BOM) ? text : `${UTF8_BOM}${text}`;
}

export function createInitialRunbookState(incidentId = 'INC-2026-AEGIS-0941'): RunbookState {
  return {
    incidentId,
    commander: 'Truong Van Tinh (Principal SRE)',
    startedAtUtc: null,
    resolvedAtUtc: null,
    lifecycle: 'idle',
    baselineP99Ms: null,
    currentP99Ms: null,
    mttrSeconds: 0,
    steps: [
      {
        id: 'detect',
        order: 1,
        phase: 'DETECT',
        title: 'Detect Anomaly & Freeze Error Budget',
        titleVi: 'Phát hiện sự cố & Khóa ngân sách lỗi SLO',
        description:
          'Capture 5-region Raft quorum snapshot, isolate P99 > 45ms latency breach, and page Incident Commander.',
        descriptionVi:
          'Chụp trạng thái Raft 5 vùng, cô lập điểm vượt ngưỡng P99 > 45ms và kích hoạt kênh chỉ huy sự cố.',
        cliCommand:
          'aegisctl cluster inspect --quorum --burn-rate --slo-p99=45ms --export-trace',
        targetSlaSec: 18,
        status: 'pending',
        executedAtUtc: null,
        elapsedSec: 0,
        verificationOutput: null,
        p99SnapshotMs: null,
      },
      {
        id: 'mitigate',
        order: 2,
        phase: 'MITIGATE',
        title: 'Mitigate via Global Traffic Shift',
        titleVi: 'Giảm tải bằng Điều hướng lưu lượng toàn cầu',
        description:
          'Shift Envoy Anycast ingress weight off partitioned/high-lag regions and activate Redis Lua singleflight shield.',
        descriptionVi:
          'Chuyển trọng số Envoy Anycast khỏi vùng đứt cáp/trễ cao và bật lá chắn Redis Lua singleflight.',
        cliCommand:
          'envoy-ctl mesh shift --drain-degraded --raft-quorum-safe --enable-xfetch-shield',
        targetSlaSec: 32,
        status: 'pending',
        executedAtUtc: null,
        elapsedSec: 0,
        verificationOutput: null,
        p99SnapshotMs: null,
      },
      {
        id: 'drain',
        order: 3,
        phase: 'DRAIN',
        title: 'Drain Poisoned Pods & Reset DB Pool',
        titleVi: 'Rút tải Pod lỗi & Làm mới Pool kết nối DB',
        description:
          'Cordon high-GC K8s pods, surge HPA workers, flush saturated PgBouncer pool, and close circuit breaker.',
        descriptionVi:
          'Cô lập pod GC cao, mở rộng HPA, xả kết nối PgBouncer bão hòa và đóng lại Circuit Breaker.',
        cliCommand:
          'kubectl drain -l app=aegis-kernel,gc_pause=high --grace-period=10; pgbouncer-ctl reload --reset-pool',
        targetSlaSec: 44,
        status: 'pending',
        executedAtUtc: null,
        elapsedSec: 0,
        verificationOutput: null,
        p99SnapshotMs: null,
      },
      {
        id: 'verify',
        order: 4,
        phase: 'VERIFY',
        title: 'Verify P99 < 45ms & 5/5 Quorum',
        titleVi: 'Xác minh P99 < 45ms & Quorum 5/5 ổn định',
        description:
          'Execute multi-region synthetic canary probe verifying P99 < 45ms SLO, 0 double-spend invariant, and burn rate 1.0x.',
        descriptionVi:
          'Chạy canary kiểm chứng đa vùng đảm bảo P99 < 45ms SLO, 0 double-spend và tốc độ đốt lỗi 1.0x.',
        cliCommand:
          'aegisctl canary verify --regions=all --assert-p99-lt=45ms --assert-quorum=5/5 --assert-leaks=0',
        targetSlaSec: 26,
        status: 'pending',
        executedAtUtc: null,
        elapsedSec: 0,
        verificationOutput: null,
        p99SnapshotMs: null,
      },
      {
        id: 'export',
        order: 5,
        phase: 'POST-MORTEM',
        title: 'Seal Timeline & Export Post-Mortem',
        titleVi: 'Chốt mốc thời gian & Xuất báo cáo Post-Mortem',
        description:
          'Finalize blameless SRE post-mortem artifact in UTF-8 BOM Markdown and structured JSON for executive audit.',
        descriptionVi:
          'Đóng gói báo cáo Post-Mortem chuẩn UTF-8 BOM (.md & .json) kèm biểu đồ MTTR và hành động khắc phục.',
        cliCommand:
          'aegisctl postmortem seal --incident=INC-2026-AEGIS-0941 --format=md,json --encoding=utf8-bom',
        targetSlaSec: 12,
        status: 'pending',
        executedAtUtc: null,
        elapsedSec: 0,
        verificationOutput: null,
        p99SnapshotMs: null,
      },
    ],
    timeline: [],
  };
}

export function getNextPendingStep(state: RunbookState): RunbookStep | null {
  return state.steps.find((s) => s.status === 'pending') ?? null;
}

export function canExecuteStep(state: RunbookState, stepId: RunbookStepId): boolean {
  const idx = state.steps.findIndex((s) => s.id === stepId);
  if (idx === -1) return false;
  if (state.steps[idx].status === 'completed') return false;
  // Require all prior steps to be completed for clean incident progression
  for (let i = 0; i < idx; i++) {
    if (state.steps[i].status !== 'completed') return false;
  }
  return true;
}

export function executeRunbookStep(
  state: RunbookState,
  stepId: RunbookStepId,
  context: RunbookExecutionContext
): RunbookStepResult {
  if (!canExecuteStep(state, stepId)) {
    return {
      nextState: state,
      shouldRestoreCluster: false,
      shouldClearDbAndCacheFaults: false,
    };
  }

  const nowUtc = new Date().toISOString();
  const { cluster, loadProfile } = context;
  const baselineP99 = state.baselineP99Ms ?? loadProfile.p99Ms;
  const targetStep = state.steps.find((s) => s.id === stepId)!;

  let projectedP99 = loadProfile.p99Ms;
  let verificationOutput = '';
  let shouldRestoreCluster = false;
  let shouldClearDbAndCacheFaults = false;

  if (stepId === 'detect') {
    projectedP99 = loadProfile.p99Ms;
    verificationOutput = `Snapshot locked: Quorum ${cluster.reachableCount}/${cluster.totalNodes} (${cluster.quorumStatus}), Leader=${cluster.leaderRegionId ?? 'FENCED'}, P99=${loadProfile.p99Ms}ms, BurnRate=${cluster.errorBudgetBurnRate}x, Circuit=${cluster.circuitBreakerState}.`;
  } else if (stepId === 'mitigate') {
    projectedP99 = Number(Math.max(18.4, loadProfile.p99Ms * 0.56).toFixed(2));
    shouldClearDbAndCacheFaults = true;
    verificationOutput = `Traffic weight shifted to healthy regions; Redis Lua XFetch shield engaged. P99 dropped to ~${projectedP99}ms.`;
  } else if (stepId === 'drain') {
    projectedP99 = Number(Math.max(14.2, Math.min(34.8, loadProfile.p99Ms * 0.34)).toFixed(2));
    shouldRestoreCluster = true;
    verificationOutput = `Poisoned high-GC pods drained; HPA surged to ${loadProfile.hpaPodsDesired} workers; PgBouncer pool flushed to 28.5%; Circuit CLOSED.`;
  } else if (stepId === 'verify') {
    projectedP99 = Number(Math.min(38.6, Math.max(11.2, loadProfile.p99Ms > 45 ? 16.4 : loadProfile.p99Ms)).toFixed(2));
    shouldRestoreCluster = true;
    verificationOutput = `PASS: Global canary verified P99=${projectedP99}ms (< 45ms SLO), Raft Quorum 5/5 HEALTHY, 0 double-spend leaks.`;
  } else {
    projectedP99 = state.currentP99Ms ?? Math.min(38.6, loadProfile.p99Ms);
    verificationOutput = `Post-mortem bundle sealed for ${state.incidentId}. UTF-8 BOM Markdown & JSON artifacts ready for download.`;
  }

  const nextSteps = state.steps.map((s) =>
    s.id === stepId
      ? {
          ...s,
          status: 'completed' as const,
          executedAtUtc: nowUtc,
          elapsedSec: s.targetSlaSec,
          verificationOutput,
          p99SnapshotMs: projectedP99,
        }
      : s
  );

  const mttrSeconds = nextSteps.reduce((acc, s) => acc + s.elapsedSec, 0);
  const allDone = nextSteps.every((s) => s.status === 'completed');

  const newEntry: RunbookTimelineEntry = {
    id: `tl-${stepId}-${state.timeline.length + 1}`,
    stepId,
    timestampUtc: nowUtc,
    actor: state.commander,
    summary: verificationOutput,
    command: targetStep.cliCommand,
    p99Ms: projectedP99,
    quorumLabel: shouldRestoreCluster
      ? `5/${cluster.totalNodes} HEALTHY`
      : `${cluster.reachableCount}/${cluster.totalNodes} ${cluster.quorumStatus}`,
  };

  return {
    nextState: {
      ...state,
      startedAtUtc: state.startedAtUtc ?? nowUtc,
      resolvedAtUtc: allDone ? nowUtc : null,
      lifecycle: allDone ? 'resolved' : 'in_progress',
      baselineP99Ms: baselineP99,
      currentP99Ms: projectedP99,
      mttrSeconds,
      steps: nextSteps,
      timeline: [...state.timeline, newEntry],
    },
    shouldRestoreCluster,
    shouldClearDbAndCacheFaults,
  };
}

export function executeNextRunbookStep(
  state: RunbookState,
  context: RunbookExecutionContext
): RunbookStepResult {
  const next = getNextPendingStep(state);
  if (!next) {
    return {
      nextState: state,
      shouldRestoreCluster: false,
      shouldClearDbAndCacheFaults: false,
    };
  }
  return executeRunbookStep(state, next.id, context);
}

export function executeAllRemainingSteps(
  state: RunbookState,
  context: RunbookExecutionContext
): RunbookStepResult {
  let current = state;
  let shouldRestoreCluster = false;
  let shouldClearDbAndCacheFaults = false;
  let next = getNextPendingStep(current);

  while (next) {
    const res = executeRunbookStep(current, next.id, context);
    current = res.nextState;
    if (res.shouldRestoreCluster) shouldRestoreCluster = true;
    if (res.shouldClearDbAndCacheFaults) shouldClearDbAndCacheFaults = true;
    next = getNextPendingStep(current);
  }

  return {
    nextState: current,
    shouldRestoreCluster,
    shouldClearDbAndCacheFaults,
  };
}

export function exportRunbookPostMortemMarkdown(
  state: RunbookState,
  context: RunbookExecutionContext
): string {
  const { cluster, loadProfile } = context;
  const nowIso = new Date().toISOString();
  const completedCount = state.steps.filter((s) => s.status === 'completed').length;

  const lines: string[] = [
    `# AegisPulse v3.0 Enterprise SRE Incident Post-Mortem`,
    ``,
    `| Metadata | Value |`,
    `| :--- | :--- |`,
    `| **Incident ID** | \`${state.incidentId}\` |`,
    `| **Incident Commander** | ${state.commander} |`,
    `| **Lifecycle Status** | **${state.lifecycle.toUpperCase()}** (${completedCount}/${state.steps.length} steps) |`,
    `| **Generated (UTC)** | \`${nowIso}\` |`,
    `| **Observed MTTR** | \`${state.mttrSeconds}s\` |`,
    `| **Baseline P99 -> Post-Runbook P99** | \`${state.baselineP99Ms ?? loadProfile.p99Ms} ms\` -> \`${state.currentP99Ms ?? loadProfile.p99Ms} ms\` (SLO Target: \`< ${loadProfile.sloTargetP99Ms} ms\`) |`,
    ``,
    `## 1. Multi-Region Raft Quorum & Chaos Snapshot`,
    ``,
    `- **Raft Term / Commit Index:** Term \`${cluster.raftTerm}\` · Index \`${cluster.commitIndex.toLocaleString()}\``,
    `- **Active Leader:** \`${cluster.leaderRegionId ?? 'FENCED (SPLIT-BRAIN GUARD)'}\``,
    `- **Quorum Health:** \`${cluster.reachableCount}/${cluster.totalNodes}\` (\`${cluster.quorumStatus}\`, minimum \`${cluster.quorumSize}\`)`,
    `- **Circuit Breaker:** \`${cluster.circuitBreakerState}\` · **Error Budget Burn Rate:** \`${cluster.errorBudgetBurnRate}x\``,
    `- **Max Replication Lag:** \`${cluster.maxReplicationLagMs} ms\` · **Last Failover:** \`${cluster.lastFailoverLatencyMs} ms\``,
    ``,
    `## 2. Load Stress & GC Profiler Snapshot`,
    ``,
    `- **Simulated Traffic Load:** \`${loadProfile.targetRps.toLocaleString()} RPS\` (Effective: \`${loadProfile.effectiveThroughputRps.toLocaleString()} RPS\`, Saturation: \`${loadProfile.throughputSaturationPct}%\`)`,
    `- **Latency Percentiles:** P50 \`${loadProfile.p50Ms} ms\` · P95 \`${loadProfile.p95Ms} ms\` · P99 \`${loadProfile.p99Ms} ms\``,
    `- **Kubernetes HPA Autoscaling:** \`${loadProfile.hpaPodsCurrent} -> ${loadProfile.hpaPodsDesired} pods\` (CPU \`${loadProfile.cpuUtilizationPct}%\`)`,
    `- **SLO Error Budget Remaining:** \`${loadProfile.sloErrorBudgetRemainingPct}%\` (\`${loadProfile.monthlyBudgetMinutesLeft} min\` / 30d)`,
    `- **Runtime GC Profiler (${loadProfile.gcProfile.runtimeName}):** P99 GC Pause \`${loadProfile.gcProfile.p99GcPauseMs} ms\`, Alloc \`${loadProfile.gcProfile.allocRateMbPerSec} MB/s\``,
    ``,
    `## 3. Top Flamegraph Latency Hotspots`,
    ``,
    `| Stack Frame | Layer | Self Latency (ms) | Total (ms) | Alloc (KB) |`,
    `| :--- | :---: | ---: | ---: | ---: |`,
    ...loadProfile.topHotspots.map(
      (h) =>
        `| \`${h.name}\` | ${h.layer.toUpperCase()} | ${h.selfMs.toFixed(2)} | ${h.totalMs.toFixed(2)} | ${h.allocKb.toFixed(1)} |`
    ),
    ``,
    `## 4. Incident Commander Runbook Timeline`,
    ``,
    `| Step | Phase | Status | P99 (ms) | CLI Action | Outcome |`,
    `| :---: | :--- | :---: | ---: | :--- | :--- |`,
    ...state.steps.map(
      (s) =>
        `| ${s.order} | ${s.phase} | ${s.status.toUpperCase()} | ${s.p99SnapshotMs ?? '-'} | \`${s.cliCommand}\` | ${s.verificationOutput ?? 'Pending execution'} |`
    ),
    ``,
    `---`,
    `*Exported with UTF-8 BOM by AegisPulse v3.0 Enterprise Super VIP Pro — Truong Van Tinh*`,
  ];

  return ensureUtf8Bom(lines.join('\n'));
}

export function exportRunbookPostMortemJson(
  state: RunbookState,
  context: RunbookExecutionContext
): string {
  const payload = {
    schemaVersion: '3.0.0',
    exportedAtUtc: new Date().toISOString(),
    product: 'AegisPulse Distributed SRE v3.0 Enterprise Super VIP Pro',
    incident: {
      incidentId: state.incidentId,
      commander: state.commander,
      lifecycle: state.lifecycle,
      startedAtUtc: state.startedAtUtc,
      resolvedAtUtc: state.resolvedAtUtc,
      mttrSeconds: state.mttrSeconds,
      baselineP99Ms: state.baselineP99Ms ?? context.loadProfile.p99Ms,
      currentP99Ms: state.currentP99Ms ?? context.loadProfile.p99Ms,
    },
    clusterQuorum: {
      raftTerm: context.cluster.raftTerm,
      leaderRegionId: context.cluster.leaderRegionId,
      reachableCount: context.cluster.reachableCount,
      totalNodes: context.cluster.totalNodes,
      quorumStatus: context.cluster.quorumStatus,
      splitBrainProtected: context.cluster.splitBrainProtected,
      circuitBreakerState: context.cluster.circuitBreakerState,
      errorBudgetBurnRate: context.cluster.errorBudgetBurnRate,
      maxReplicationLagMs: context.cluster.maxReplicationLagMs,
      lastFailoverLatencyMs: context.cluster.lastFailoverLatencyMs,
    },
    loadStress: {
      targetRps: context.loadProfile.targetRps,
      runtime: context.loadProfile.runtime,
      p50Ms: context.loadProfile.p50Ms,
      p95Ms: context.loadProfile.p95Ms,
      p99Ms: context.loadProfile.p99Ms,
      hpaPodsCurrent: context.loadProfile.hpaPodsCurrent,
      hpaPodsDesired: context.loadProfile.hpaPodsDesired,
      sloErrorBudgetRemainingPct: context.loadProfile.sloErrorBudgetRemainingPct,
      gcProfile: context.loadProfile.gcProfile,
      topHotspots: context.loadProfile.topHotspots.map((h) => ({
        id: h.id,
        name: h.name,
        layer: h.layer,
        selfMs: h.selfMs,
        totalMs: h.totalMs,
      })),
    },
    steps: state.steps,
    timeline: state.timeline,
  };

  return ensureUtf8Bom(JSON.stringify(payload, null, 2));
}

export function downloadUtf8BomFile(
  filename: string,
  content: string,
  mimeType: string
): void {
  const withBom = ensureUtf8Bom(content);
  const blob = new Blob([withBom], { type: `${mimeType};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

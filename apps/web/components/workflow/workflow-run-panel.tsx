"use client";
/**
 * WF08 —— Workflow 运行面板（`/workflows/runs/[instanceId]`，契约束 workflow-runtime ① UI）。
 *
 * 权威实现：本文件（真实 API + 路由 `app/workflows/runs/[instanceId]`）。
 * `components/work-stack/workflow-run-panel.tsx` 是迭代 1 的静态原型（mock 数据），不挂路由、不作为运行面板使用。
 *
 * 服务端 projection 是唯一权威：SSE `snapshot` 直接替换；`delta` 只追加日志（按 seq 去重）
 * 并触发一次 `getInstance` 重读。断线 → `reconnecting`，带 Last-Event-ID 续传；
 * 连续失败超过上限 → 降级 `polling`（getInstance 轮询）。终态停止订阅。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  cancelWorkflowInstance,
  getWorkflowInstance,
  openWorkflowInstanceStream,
  resumeWorkflowInstance,
  retryWorkflowStage,
  workflowErrorCode,
  type WorkflowInstanceProjection,
  type WorkflowSseEnvelope,
} from "@/lib/workflow-runtime-api";
import { workflowRuntime } from "@repo/contracts";
import { WorkflowApprovalDrawer } from "./workflow-approval-drawer";
import { INSTANCE_STATUS_TEXT, REASON_TEXT, STAGE_STATUS_TEXT, describeWorkflowError } from "./workflow-copy";

export type WorkflowSseStatus = "live" | "reconnecting" | "polling";

type LogEntry = Extract<WorkflowSseEnvelope, { type: "delta" }>;

export interface WorkflowRunPanelProps {
  readonly instanceId: string;
  readonly initial?: WorkflowInstanceProjection;
  /** 断线后重连前的等待（ms）。 */
  readonly reconnectDelayMs?: number;
  /** 连续重连失败多少次后降级轮询。 */
  readonly maxReconnects?: number;
  readonly pollIntervalMs?: number;
}

const TERMINAL = new Set<string>(workflowRuntime.WORKFLOW_TERMINAL_STATUSES);

export function WorkflowRunPanel(props: WorkflowRunPanelProps) {
  const { instanceId } = props;
  const reconnectDelayMs = props.reconnectDelayMs ?? 1_000;
  const maxReconnects = props.maxReconnects ?? 3;
  const pollIntervalMs = props.pollIntervalMs ?? 5_000;

  const [projection, setProjection] = useState<WorkflowInstanceProjection | null>(props.initial ?? null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [sse, setSse] = useState<WorkflowSseStatus>("live");
  const lastSeq = useRef<number | null>(props.initial ? props.initial.lastSeq : null);
  const terminalRef = useRef(props.initial ? TERMINAL.has(props.initial.status) : false);

  const refresh = useCallback(async () => {
    try {
      const p = await getWorkflowInstance(instanceId);
      setProjection(p);
      terminalRef.current = TERMINAL.has(p.status);
      setLoadError(null);
      return p;
    } catch (err) {
      setLoadError(describeWorkflowError(workflowErrorCode(err)));
      return null;
    }
  }, [instanceId]);

  useEffect(() => {
    if (!props.initial) void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [instanceId]);

  useEffect(() => {
    const ctrl = new AbortController();
    let stopped = false;
    let pollTimer: ReturnType<typeof setInterval> | null = null;
    const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

    const onEnvelope = (env: WorkflowSseEnvelope) => {
      if (env.instanceId !== instanceId) return;
      if (env.type === "snapshot") {
        setProjection(env.payload);
        terminalRef.current = TERMINAL.has(env.payload.status);
        lastSeq.current = Math.max(lastSeq.current ?? 0, env.payload.lastSeq, env.seq);
        return;
      }
      if (lastSeq.current !== null && env.seq <= lastSeq.current) return; // 重放/重复：丢弃
      lastSeq.current = env.seq;
      setLog((prev) => (prev.some((e) => e.seq === env.seq) ? prev : [...prev, env].sort((a, b) => a.seq - b.seq)));
      void refresh();
    };

    (async () => {
      // 失败计数只算「这一次连接没收到任何 envelope 就结束 / 抛错」；收到过数据后正常关闭
      // 属于服务端轮换连接，计数清零并立即续传，不算失败、状态保持 live。
      // 只有失败的尝试结束后才切 reconnecting（首次尝试进行中保持 live）。
      let failures = 0;
      while (!stopped && !terminalRef.current) {
        let received = false;
        try {
          await openWorkflowInstanceStream(instanceId, lastSeq.current, (env) => {
            received = true;
            failures = 0;
            setSse("live");
            onEnvelope(env);
          }, { signal: ctrl.signal });
        } catch {
          if (stopped) return;
        }
        if (stopped || terminalRef.current) return;
        if (received) {
          failures = 0; // 立即续传，状态保持 live
          continue;
        }
        failures += 1;
        if (failures > maxReconnects) break;
        setSse("reconnecting");
        await wait(reconnectDelayMs);
      }
      if (stopped || terminalRef.current) return;
      setSse("polling");
      pollTimer = setInterval(() => {
        if (terminalRef.current) {
          if (pollTimer) clearInterval(pollTimer);
          return;
        }
        void refresh();
      }, pollIntervalMs);
    })();

    return () => {
      stopped = true;
      ctrl.abort();
      if (pollTimer) clearInterval(pollTimer);
    };
  }, [instanceId, maxReconnects, reconnectDelayMs, pollIntervalMs, refresh]);

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setActionError(null);
    try {
      await action();
    } catch (err) {
      const code = workflowErrorCode(err);
      setActionError(describeWorkflowError(code));
      const latest = (err as { raw?: { latestProjection?: WorkflowInstanceProjection } }).raw?.latestProjection;
      if (code === "state_version_conflict" && latest) setProjection(latest);
    } finally {
      setBusy(false);
      void refresh();
    }
  }

  if (!projection) {
    return (
      <section data-testid="workflow-run-panel" data-state={loadError ? "error" : "loading"}>
        {loadError ? <p role="alert">{loadError}</p> : <p>加载中…</p>}
      </section>
    );
  }

  const p = projection;
  const caps = p.viewerCapabilities;
  const ev = p.stateVersion;
  const terminal = TERMINAL.has(p.status);

  return (
    <section data-testid="workflow-run-panel" data-status={p.status} className="space-y-4">
      <header className="flex flex-wrap items-center gap-2">
        <h2 className="text-lg font-semibold">{p.workflowKey}</h2>
        <span data-testid="workflow-pinned-version" className="rounded border px-1 text-xs">{`${p.workflowKey}@${p.definitionVersion}`}</span>
        <span data-testid="workflow-instance-status">{INSTANCE_STATUS_TEXT[p.status]}</span>
        <span data-testid="workflow-sse-status" data-sse={terminal ? "live" : sse} className="text-xs">
          {terminal ? "" : sse === "live" ? "实时" : sse === "reconnecting" ? "重连中…" : "已降级为轮询"}
        </span>
      </header>

      {p.status === "needs_attention" ? (
        <div role="status" data-testid="workflow-banner-needs-attention" {...(p.reasonCode ? { "data-reason": p.reasonCode } : {})}>
          需人工处理：{p.reasonCode ? REASON_TEXT[p.reasonCode] : "原因未知"}
        </div>
      ) : null}
      {p.status === "blocked_permission" ? (
        <div role="status" data-testid="workflow-banner-blocked-permission" {...(p.reasonCode ? { "data-reason": p.reasonCode } : {})}>
          权限已变更，需管理员处理：{p.reasonCode ? REASON_TEXT[p.reasonCode] : "原因未知"}
        </div>
      ) : null}
      {p.status === "rejected" ? (
        <div role="status" data-testid="workflow-banner-rejected">
          已被拒绝{p.openGate?.decidedBy ? `（${p.openGate.decidedBy}）` : ""}
          {p.openGate?.reason ? `：${p.openGate.reason}` : p.reasonCode ? `：${REASON_TEXT[p.reasonCode]}` : ""}
        </div>
      ) : null}

      <ol className="space-y-2">
        {p.stages.map((s) => (
          <li key={s.stageId} data-testid={`workflow-stage-${s.stageId}`} data-status={s.status} data-attempt={s.attempt} className="rounded border p-2">
            <div className="flex flex-wrap gap-2">
              <span className="font-medium">{s.title}</span>
              <span>{STAGE_STATUS_TEXT[s.status]}</span>
              <span className="text-xs">第 {s.attempt} 次</span>
            </div>
            <div data-testid={`workflow-stage-skills-${s.stageId}`} className="text-xs">
              {s.pinnedSkills.map((k) => `${k.stableId}@${k.version}`).join(", ")}
            </div>
            {s.reasonCode ? <div className="text-xs">{REASON_TEXT[s.reasonCode]}</div> : null}
            {s.outputs.length > 0 ? (
              <ul>
                {s.outputs.map((o) => (
                  <li key={o.outputId}>
                    <a data-testid={`workflow-output-${o.outputId}`} href={o.href}>{o.label}</a>
                  </li>
                ))}
              </ul>
            ) : null}
            {s.status === "failed" && caps.canRetryStage && !busy ? (
              <button
                type="button"
                data-testid={`workflow-action-retry-${s.stageId}`}
                onClick={() => void run(() => retryWorkflowStage({ instanceId, stageId: s.stageId, expectedStateVersion: ev }))}
              >
                从该阶段重试
              </button>
            ) : null}
          </li>
        ))}
      </ol>

      {p.openGate ? (
        <WorkflowApprovalDrawer
          key={`${p.openGate.gateId}:${p.openGate.decision ?? "open"}`}
          instanceId={instanceId}
          gate={p.openGate}
          expectedStateVersion={ev}
          initiatorUserId={p.initiatorUserId}
          agentId={p.agentId}
          readOnly={p.status === "cancelled" || p.status === "cancelling"}
          onDecided={() => void refresh()}
        />
      ) : null}

      <div className="flex gap-2">
        <button
          type="button"
          data-testid="workflow-action-cancel"
          disabled={!caps.canCancel || terminal || busy}
          onClick={() => void run(() => cancelWorkflowInstance({ instanceId, expectedStateVersion: ev }))}
        >
          取消
        </button>
        {caps.canResume ? (
          <button
            type="button"
            data-testid="workflow-action-resume"
            disabled={terminal || busy}
            onClick={() => void run(() => resumeWorkflowInstance({ instanceId, expectedStateVersion: ev }))}
          >
            继续
          </button>
        ) : null}
      </div>
      {actionError ? <p role="alert" data-testid="workflow-action-error">{actionError}</p> : null}

      <ol data-testid="workflow-event-log" className="max-h-64 overflow-auto text-xs">
        {log.map((e) => (
          <li key={e.seq} data-seq={e.seq}>
            #{e.seq} {e.payload.event}
            {e.payload.stageId ? ` · ${e.payload.stageId}` : ""}
            {e.payload.reasonCode ? ` · ${REASON_TEXT[e.payload.reasonCode]}` : ""}
          </li>
        ))}
      </ol>
    </section>
  );
}

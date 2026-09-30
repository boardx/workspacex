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
import { AlertTriangle } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  cancelWorkflowInstance,
  getWorkflowInstance,
  openWorkflowInstanceStream,
  resumeWorkflowInstance,
  workflowErrorCode,
  workflowOutputHref,
  type WorkflowInstanceProjection,
  type WorkflowSseEnvelope,
} from "@/lib/workflow-runtime-api";
import { workflowRuntime } from "@repo/contracts";
import { WorkflowApprovalDrawer } from "./workflow-approval-drawer";
import { useOptionalSession } from "@/components/session/session-provider";
import { memberLabel, useOrgMemberNames } from "@/lib/use-org-member-names";
import { WORKFLOW_GRANTS_HREF } from "@/lib/workflow-capability-grant-copy";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { outputDisplayLabel, stageDisplayName, workflowDisplayName } from "@/lib/workflow-display-copy";
import { EVENT_TEXT, INSTANCE_STATUS_TEXT, REASON_TEXT, STAGE_STATUS_TEXT, describeWorkflowError, stageFailureKindText } from "./workflow-copy";

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

type Tone = "neutral" | "primary" | "success" | "warning" | "danger" | "outline";
const STATUS_TONE: Record<string, Tone> = {
  running: "primary", awaiting_gate_decision: "warning", blocked_permission: "warning", cancelling: "neutral",
  succeeded: "success", failed: "danger", cancelled: "outline", rejected: "danger", needs_attention: "warning",
  pending: "outline", skipped: "outline",
};
const toneOf = (status: string): Tone => STATUS_TONE[status] ?? "neutral";

export function WorkflowRunPanel(props: WorkflowRunPanelProps) {
  const { instanceId } = props;
  const sessionCtx = useOptionalSession();
  const viewerIsOrgAdmin = sessionCtx?.identity?.orgRole === "admin";
  const memberNames = useOrgMemberNames(sessionCtx?.session?.currentOrgId ?? null);
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
        {loadError ? (
          <div
            role="alert"
            data-testid="workflow-run-load-error"
            className="mx-auto flex max-w-md flex-col items-center gap-3 rounded-lg border border-border bg-muted px-6 py-10 text-center"
          >
            <AlertTriangle aria-hidden className="h-6 w-6 text-muted-foreground" />
            <p className="text-13 font-medium">{loadError}</p>
            <p className="text-12 text-muted-foreground">链接可能已失效，或这次运行不在你可见的范围内。可以回到运行列表重新找，或稍后重试。</p>
            <div className="flex items-center gap-2">
              <a href="/workflows/runs" data-testid="workflow-run-load-error-back" className="rounded-md border border-border bg-card px-3 py-1.5 text-12 font-medium transition-colors duration-base hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">返回我的运行</a>
              <button type="button" onClick={() => void refresh()} className="rounded-md px-3 py-1.5 text-12 text-muted-foreground transition-colors duration-base hover:bg-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">重试</button>
            </div>
          </div>
        ) : <p className="p-6 text-12 text-muted-foreground">加载中…</p>}
      </section>
    );
  }

  const p = projection;
  const caps = p.viewerCapabilities;
  const ev = p.stateVersion;
  const terminal = TERMINAL.has(p.status);
  const failedStage = p.status === "failed" ? [...p.stages].reverse().find((s) => s.status === "failed") ?? null : null;
  const failureKindHint = failedStage
    ? stageFailureKindText([...log].reverse().find((e) => e.payload.event === "stage_failed" && e.payload.stageId === failedStage.stageId)?.payload.data.failureKind)
    : null;

  const name = workflowDisplayName(p.workflowKey);
  const stageNames = new Map(p.stages.map((s, i) => [s.stageId, stageDisplayName(s.stageId, s.title, i)]));
  const blockedStage = p.status === "blocked_permission"
    ? p.stages.find((s) => s.status === "blocked_permission")
      ?? p.stages.find((s) => s.status === "running")
      ?? p.stages.find((s) => s.status !== "succeeded" && s.status !== "skipped")
      ?? null
    : null;
  const resumeInBanner = p.status === "blocked_permission" && caps.canResume;
  const resume = () => void run(() => resumeWorkflowInstance({ instanceId, expectedStateVersion: ev }));

  return (
    <section data-testid="workflow-run-panel" data-status={p.status} className="space-y-4">
      <header className="flex flex-wrap items-center gap-2">
        <h2 className="text-16 font-semibold" data-testid="workflow-run-title">{name}</h2>
        <Badge tone={toneOf(p.status)} data-testid="workflow-instance-status">{INSTANCE_STATUS_TEXT[p.status]}</Badge>
        <span data-testid="workflow-sse-status" data-sse={terminal ? "live" : sse} className="text-12 text-muted-foreground">
          {terminal ? "" : sse === "live" ? "实时" : sse === "reconnecting" ? "重连中…" : "已降级为轮询"}
        </span>
      </header>

      {p.status === "needs_attention" ? (
        <div role="status" data-testid="workflow-banner-needs-attention" {...(p.reasonCode ? { "data-reason": p.reasonCode } : {})}
          className="rounded-lg border border-warning bg-warning-tint p-3 text-13 text-warning-tint-foreground">
          需人工处理：{p.reasonCode ? REASON_TEXT[p.reasonCode] : "原因未知"}
        </div>
      ) : null}
      {p.status === "failed" ? (
        <div role="alert" data-testid="workflow-banner-failed" className="rounded-lg border border-destructive p-3 text-13">
          <p>运行失败{failedStage ? `：「${stageNames.get(failedStage.stageId)}」阶段未能完成` : ""}。</p>
          <p className="text-12">
            {p.reasonCode ? REASON_TEXT[p.reasonCode] : "原因未知"}
            {failedStage ? `（共尝试 ${failedStage.attempt} 次）` : ""}
            {failureKindHint ? `，${failureKindHint}` : ""}
          </p>
          {failedStage?.finishedAt ? (
            <p className="text-12" data-testid="workflow-banner-failed-at">最后一次失败：{new Date(failedStage.finishedAt).toLocaleString("zh-CN")}</p>
          ) : null}
        </div>
      ) : null}
      {p.status === "blocked_permission" ? (
        <div role="status" data-testid="workflow-banner-blocked-permission" {...(p.reasonCode ? { "data-reason": p.reasonCode } : {})}
          className="flex flex-col gap-2 rounded-lg border border-warning bg-warning-tint p-3 text-13 text-warning-tint-foreground">
          <p className="font-medium">
            {blockedStage ? (
              <>运行停在「<a href={`#workflow-stage-${blockedStage.stageId}`} data-testid="workflow-banner-stage-link" onClick={(e) => {
                const el = document.getElementById(`workflow-stage-${blockedStage.stageId}`);
                if (!el) return;
                e.preventDefault();
                el.scrollIntoView?.({ behavior: "smooth", block: "center" });
                el.focus({ preventScroll: true });
              }} className="underline underline-offset-2">{stageNames.get(blockedStage.stageId)}</a>」这一步。</>
            ) : "运行已暂停。"}
          </p>
          <p>
            {p.reasonCode === "capability_exceeds_side_effect_cap"
              ? "这一步需要改动组织数据（如保存文档、发送通知），但本组织还没有为工作流授予这项权限，运行已暂停。"
              : `权限已变更，需管理员处理：${p.reasonCode ? REASON_TEXT[p.reasonCode] : "原因未知"}`}
          </p>
          {viewerIsOrgAdmin ? (
            <p className="text-12">
              <a
                href={`${WORKFLOW_GRANTS_HREF}?workflow=${encodeURIComponent(p.workflowKey)}`}
                data-testid="workflow-banner-grant-link"
                className="font-medium underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                前往「工作流权限」授予权限
              </a>
              {resumeInBanner ? "，授权后回到这里点「继续运行」，会从这一步接着运行。" : "，授权后请让发起人回到这里继续运行。"}
            </p>
          ) : (
            <p className="text-12" data-testid="workflow-banner-contact-admin">
              请联系组织管理员在「管理后台 → 工作流权限」中授予该权限{resumeInBanner ? "，授权后回到这里点「继续运行」即可从这一步接着运行。" : "，授权后即可继续运行。"}
            </p>
          )}
          {!caps.canResume ? (
            <p className="text-12" data-testid="workflow-banner-resume-unavailable">
              只有本次运行的发起人或组织管理员可以在授权后继续运行；你可以查看进度，但无需操作。
            </p>
          ) : null}
          {resumeInBanner ? (
            <div>
              <Button size="sm" variant="primary" data-testid="workflow-banner-resume" disabled={busy} onClick={resume}>继续运行</Button>
            </div>
          ) : null}
        </div>
      ) : null}
      {p.status === "rejected" ? (
        <div role="status" data-testid="workflow-banner-rejected" className="rounded-lg border border-border bg-muted p-3 text-13">
          已被拒绝{p.openGate?.decidedBy ? `（${memberLabel(p.openGate.decidedBy, sessionCtx?.session?.userId, memberNames)}）` : ""}
          {p.openGate?.reason ? `：${p.openGate.reason}` : p.reasonCode ? `：${REASON_TEXT[p.reasonCode]}` : ""}
        </div>
      ) : null}

      <ol className="space-y-2" aria-label="运行步骤">
        {p.stages.map((s, idx) => {
          const isBlocked = blockedStage?.stageId === s.stageId;
          return (
          <li
            key={s.stageId}
            id={`workflow-stage-${s.stageId}`}
            data-testid={`workflow-stage-${s.stageId}`}
            data-status={s.status}
            data-attempt={s.attempt}
            data-blocked={isBlocked ? "true" : undefined}
            aria-current={isBlocked ? "step" : undefined}
            tabIndex={isBlocked ? -1 : undefined}
            className={cn("scroll-mt-6 rounded-lg border bg-card p-3 text-13", isBlocked ? "border-warning ring-1 ring-warning" : "border-border")}
          >
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-12 text-muted-foreground tabular-nums">{idx + 1}.</span>
              <span className="font-medium">{stageNames.get(s.stageId)}</span>
              <Badge tone={toneOf(s.status)}>{STAGE_STATUS_TEXT[s.status]}</Badge>
              {isBlocked ? <Badge tone="warning" data-testid="workflow-stage-paused-marker">已暂停 · 等待授权</Badge> : null}
              {s.attempt > 1 ? <span className="text-12 text-muted-foreground">第 {s.attempt} 次</span> : null}
              {s.status === "running" && s.attempt > 1 ? (
                <span className="text-12 text-muted-foreground" data-testid={`workflow-stage-retrying-${s.stageId}`}>重试中（第 {s.attempt - 1} 次重试）</span>
              ) : null}
            </div>
            {s.reasonCode ? <div className="mt-1 text-12 text-muted-foreground">{REASON_TEXT[s.reasonCode]}</div> : null}
            {s.outputs.length > 0 ? (
              <ul className="mt-1">
                {s.outputs.map((o) => (
                  <li key={o.outputId}>
                    <a data-testid={`workflow-output-${o.outputId}`} href={workflowOutputHref(p.instanceId, o.outputId)} className="rounded-sm text-12 text-primary underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">查看{outputDisplayLabel(o.label, stageNames.get(s.stageId) ?? "这一步")}</a>
                  </li>
                ))}
              </ul>
            ) : null}
            {/*
              阶段重试不渲染入口（产品决定）：运行时还不能真正重跑一个阶段，`canRetryStage` 恒为 false，
              API 桩（`retryStage`）保留。连禁用态按钮也不画——不给用户一个永远点不了的控件。
            */}
          </li>
          );
        })}
      </ol>

      {p.openGate ? (
        <WorkflowApprovalDrawer
          key={`${p.openGate.gateId}:${p.openGate.decision ?? "open"}`}
          instanceId={instanceId}
          workflowKey={p.workflowKey}
          gate={p.openGate}
          expectedStateVersion={ev}
          initiatorUserId={p.initiatorUserId}
          agentId={p.agentId}
          readOnly={p.status === "cancelled" || p.status === "cancelling"}
          onDecided={() => void refresh()}
        />
      ) : null}

      <div className="flex gap-2">
        <Button
          size="sm"
          variant="outline"
          data-testid="workflow-action-cancel"
          disabled={!caps.canCancel || terminal || busy}
          onClick={() => void run(() => cancelWorkflowInstance({ instanceId, expectedStateVersion: ev }))}
        >
          取消运行
        </Button>
        {caps.canResume && !resumeInBanner ? (
          <Button size="sm" variant="primary" data-testid="workflow-action-resume" disabled={terminal || busy} onClick={resume}>
            继续运行
          </Button>
        ) : null}
      </div>
      {actionError ? <p role="alert" data-testid="workflow-action-error" className="text-12 text-destructive">{actionError}</p> : null}

      <ol data-testid="workflow-event-log" aria-label="运行日志" className="max-h-64 overflow-auto text-12 text-muted-foreground">
        {log.map((e) => (
          <li key={e.seq} data-seq={e.seq}>
            {EVENT_TEXT[e.payload.event] ?? "运行事件"}
            {e.payload.stageId ? ` · ${stageNames.get(e.payload.stageId) ?? "某一步"}` : ""}
            {e.payload.reasonCode ? ` · ${REASON_TEXT[e.payload.reasonCode]}` : ""}
          </li>
        ))}
      </ol>

      <details data-testid="workflow-tech-details" className="rounded-lg border border-border p-3 text-12 text-muted-foreground">
        <summary className="cursor-pointer select-none font-medium">技术详情</summary>
        <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
          <dt>工作流版本</dt>
          <dd><code data-testid="workflow-pinned-version">{`${p.workflowKey}@${p.definitionVersion}`}</code></dd>
          <dt>运行编号</dt>
          <dd><code>{p.instanceId}</code></dd>
        </dl>
        <ul className="mt-2 space-y-0.5">
          {p.stages.map((s) => (
            <li key={s.stageId}>
              <code>{s.stageId}</code>
              {s.outputs.length > 0 ? <> · 产出 <code data-testid={`workflow-stage-outputs-raw-${s.stageId}`}>{s.outputs.map((o) => o.label).join(", ")}</code></> : null}
              {s.pinnedSkills.length > 0 ? " · " : ""}
              <code data-testid={`workflow-stage-skills-${s.stageId}`}>{s.pinnedSkills.map((k) => `${k.stableId}@${k.version}`).join(", ")}</code>
            </li>
          ))}
        </ul>
      </details>
    </section>
  );
}

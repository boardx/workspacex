"use client";
/**
 * WF08 —— 「我的运行」「待我审批」列表与「运行 Workflow」入口按钮。
 */
import Link from "next/link";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  listMyWorkflowApprovals,
  listMyWorkflowInstances,
  listRunnableWorkflows,
  startWorkflowInstance,
  workflowErrorCode,
  type RunnableWorkflow,
  type WorkflowApprovalItem,
  type WorkflowInstanceStatus,
  type WorkflowInstanceSummary,
} from "@/lib/workflow-runtime-api";
import { useOptionalSession } from "@/components/session/session-provider";
import { memberLabel, useOrgMemberNames } from "@/lib/use-org-member-names";
import { formatDateTime } from "@/lib/workflow-run-meta";
import { WORKFLOW_GRANTS_HREF } from "@/lib/workflow-capability-grant-copy";
import { WorkflowApprovalDrawer } from "./workflow-approval-drawer";
import { gateDisplayTitle, workflowDisplayName } from "@/lib/workflow-display-copy";
import { INSTANCE_STATUS_TEXT, describeWorkflowError } from "./workflow-copy";
import { WorkflowStartForm, requiredTriggerFields } from "./workflow-start-form";

/** 列表加载中：骨架，不是一行「加载中…」纯文本。 */
function ListSkeleton({ testId }: { readonly testId: string }) {
  return (
    <div className="flex flex-col gap-2" data-testid={testId} role="status" aria-label="加载中">
      {[0, 1, 2].map((i) => <span key={i} className="h-16 animate-pulse rounded-lg bg-muted" />)}
    </div>
  );
}

/** 列表读取失败：说清楚 + 可重试（此前是一行无样式的红字，也没有重试）。 */
function ListError({ text, onRetry, testId }: { readonly text: string; readonly onRetry: () => void; readonly testId: string }) {
  return (
    <div role="alert" data-testid={testId} className="flex flex-wrap items-center gap-3 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3">
      <p className="min-w-0 flex-1 text-12 text-muted-foreground">{text}</p>
      <Button size="sm" variant="outline" onClick={onRetry} data-testid={`${testId}-retry`}>重试</Button>
    </div>
  );
}

/** 这些状态下运行还在往前走：列表需要自己刷新，否则「运行中」要等用户手动刷新页面才变。 */
const ACTIVE_STATUSES: ReadonlySet<WorkflowInstanceStatus> = new Set(["running", "awaiting_gate_decision", "cancelling"]);
const ACTIVE_REFRESH_MS = 10_000;

export function WorkflowRunList(props: { readonly status?: readonly WorkflowInstanceStatus[]; readonly hrefFor?: (id: string) => string }) {
  const [items, setItems] = useState<WorkflowInstanceSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const key = (props.status ?? []).join(",");
  const [reloadKey, setReloadKey] = useState(0);
  const sessionCtx = useOptionalSession();
  const memberNames = useOrgMemberNames(sessionCtx?.session?.currentOrgId ?? null);
  const canManageGrants = sessionCtx?.identity?.orgRole === "admin";
  useEffect(() => {
    let live = true;
    setError(null);
    listMyWorkflowInstances(props.status)
      .then((r) => live && setItems(r.items))
      .catch((e) => live && setError(describeWorkflowError(workflowErrorCode(e))));
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, reloadKey]);
  // 有还在进行的运行时，静默刷新（页面不可见时不刷；刷新失败保留旧数据，不把已经显示的列表换成错误）。
  const hasActive = items?.some((i) => ACTIVE_STATUSES.has(i.status)) ?? false;
  useEffect(() => {
    if (!hasActive) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState === "hidden") return;
      listMyWorkflowInstances(props.status).then((r) => setItems(r.items), () => undefined);
    }, ACTIVE_REFRESH_MS);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasActive, key]);
  if (error && items === null) return <ListError text={error} onRetry={() => setReloadKey((k) => k + 1)} testId="workflow-run-list-error" />;
  if (items === null) return <ListSkeleton testId="workflow-run-list-loading" />;
  if (items.length === 0) {
    return (
      <div data-testid="workflow-run-list-empty" className="rounded-lg border border-dashed border-border px-6 py-10 text-center">
        <p className="text-13 font-medium">还没有运行记录。</p>
        <p className="mt-1 text-12 text-muted-foreground">从数字人或对话里发起一次工作流，进展和产出会出现在这里。</p>
        <div className="mt-4 flex justify-center gap-2">
          <Button asChild size="sm" variant="primary"><Link href="/agents" data-testid="workflow-run-list-empty-agents">去数字人发起</Link></Button>
          <Button asChild size="sm" variant="outline"><Link href="/chat" data-testid="workflow-run-list-empty-chat">去对话发起</Link></Button>
        </div>
      </div>
    );
  }
  const href = props.hrefFor ?? ((id: string) => `/workflows/runs/${encodeURIComponent(id)}`);
  return (
    <ul data-testid="workflow-run-list" className="flex flex-col gap-2">
      {items.map((i) => {
        const whenText = formatDateTime(i.updatedAt);
        return (
          <li key={i.instanceId} data-status={i.status} className="rounded-lg border border-border bg-card shadow-sm transition-colors hover:bg-muted/40">
            <Link href={href(i.instanceId)} className="flex flex-col gap-1 px-4 py-3">
              <span className="flex items-center gap-3">
                <span className="flex-1 truncate text-13 font-medium">{workflowDisplayName(i.workflowKey)}</span>
                <span data-testid="workflow-run-status" className={`rounded-full px-2 py-0.5 text-11 ${RUN_TONE[i.status]}`}>{INSTANCE_STATUS_TEXT[i.status]}</span>
                {whenText ? <time className="text-12 text-muted-foreground" dateTime={i.updatedAt}>{whenText}</time> : null}
              </span>
              {i.goal ? <span data-testid="workflow-run-goal" className="truncate text-12">目标：{i.goal}</span> : null}
              <span data-testid="workflow-run-initiator" className="text-12 text-muted-foreground">
                发起人：{memberLabel(i.initiatorUserId, sessionCtx?.session?.userId, memberNames)}
              </span>
            </Link>
            {i.status === "blocked_permission" ? (
              <p data-testid="workflow-run-blocked-hint" className="px-4 pb-3 text-12 text-warning">
                缺少工作流权限，运行已暂停。
                {canManageGrants ? (
                  <a href={`${WORKFLOW_GRANTS_HREF}?workflow=${encodeURIComponent(i.workflowKey)}`} data-testid="workflow-run-blocked-grant-link" className="ml-1 font-medium underline underline-offset-2">前往「工作流权限」授予</a>
                ) : <span data-testid="workflow-run-blocked-contact-admin" className="ml-1">请联系管理员开通</span>}
              </p>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

const RUN_TONE: Record<WorkflowInstanceStatus, string> = {
  running: "bg-ai-tint text-ai-tint-foreground",
  awaiting_gate_decision: "bg-warning/15 text-warning",
  blocked_permission: "bg-warning/15 text-warning",
  cancelling: "bg-muted text-muted-foreground",
  succeeded: "bg-success/15 text-success",
  failed: "bg-destructive/15 text-destructive",
  cancelled: "bg-muted text-muted-foreground",
  rejected: "bg-muted text-muted-foreground",
  needs_attention: "bg-warning/15 text-warning",
};

export function WorkflowApprovalList(props: { readonly includeDecided?: boolean }) {
  const [items, setItems] = useState<WorkflowApprovalItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  useEffect(() => {
    let live = true;
    setError(null);
    listMyWorkflowApprovals(props.includeDecided ?? false)
      .then((r) => live && setItems(r.items))
      .catch((e) => live && setError(describeWorkflowError(workflowErrorCode(e))));
    return () => { live = false; };
  }, [props.includeDecided, reloadKey]);
  // 裁决后以服务端为准：关抽屉并重读列表（已裁决项从「待我审批」消失）。
  const onDecided = () => {
    setOpen(null);
    setReloadKey((k) => k + 1);
  };
  if (error && items === null) return <ListError text={error} onRetry={() => setReloadKey((k) => k + 1)} testId="workflow-approval-list-error" />;
  if (items === null) return <ListSkeleton testId="workflow-approval-list-loading" />;
  if (items.length === 0) {
    return (
      <div data-testid="workflow-run-list-empty" className="rounded-lg border border-dashed border-border px-6 py-8 text-center">
        <p className="text-13 font-medium">没有待你审批的事项。</p>
        <p className="mt-1 text-12 text-muted-foreground">工作流走到需要你拍板的一步（例如对外发布、写入外部系统）时，会出现在这里，并通知你。处理过的记录见下方「已处理」。</p>
      </div>
    );
  }
  return (
    <ul data-testid="workflow-approval-list" className="flex flex-col gap-2">
      {items.map((i) => {
        // gateId 只在单个运行内唯一（如每个 demo-approval 运行的门都是 publish-gate-1），故以 instanceId+gateId 为键。
        const rowKey = `${i.instanceId}-${i.gate.gateId}`;
        const t = gateDisplayTitle({ stageId: i.gate.stageId, summary: i.gate.effectPreview.summary }, i.workflowKey);
        const title = `${t.stage}${t.workflow ? ` · ${t.workflow}` : ""}`;
        const isOpen = open === rowKey;
        return (
        <li key={rowKey} data-gate-id={i.gate.gateId} data-instance-id={i.instanceId} className="rounded-lg border border-border bg-card shadow-sm">
          {/* 此前这里是一串裸 <button> 文字（没有边框、没有摘要、看不出是可点的待办）。
              现在是一张待办卡：标题 + 要做的副作用摘要 + 明确的「去处理」。 */}
          <div className="flex items-center gap-3 px-4 py-3">
            <div className="min-w-0 flex-1">
              <p className="truncate text-13 font-medium">{title}</p>
              {/* 标题已经是摘要本身（阶段名无法翻译时 gateDisplayTitle 回退到摘要）就不再重复一行 */}
              {t.stage !== i.gate.effectPreview.summary ? (
                <p className="mt-0.5 truncate text-12 text-muted-foreground" data-testid={`workflow-approval-summary-${rowKey}`}>{i.gate.effectPreview.summary}</p>
              ) : null}
            </div>
            <Button
              size="sm"
              variant={isOpen ? "outline" : "primary"}
              aria-expanded={isOpen}
              data-testid={`workflow-approval-open-${rowKey}`}
              onClick={() => setOpen(isOpen ? null : rowKey)}
            >
              {isOpen ? "收起" : "去处理"}
            </Button>
          </div>
          {isOpen ? (
            <div className="border-t border-border px-4 py-3">
              <WorkflowApprovalDrawer
                instanceId={i.instanceId}
                workflowKey={i.workflowKey}
                gate={i.gate}
                initiatorUserId={i.initiatorUserId}
                agentId={i.agentId}
                onDecided={onDecided}
              />
            </div>
          ) : null}
        </li>
        );
      })}
    </ul>
  );
}

const DECISION_TEXT: Record<string, string> = { approved: "已同意", denied: "已拒绝" };

/** 「已处理」历史：待我审批页下方，列出我处理过的审批（只读，点进对应运行）。 */
export function WorkflowDecidedApprovalList() {
  const [items, setItems] = useState<WorkflowApprovalItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    listMyWorkflowApprovals(true)
      .then((r) => live && setItems(r.items.filter((i) => i.gate.decision !== null)))
      .catch((e) => live && setError(describeWorkflowError(workflowErrorCode(e))));
    return () => { live = false; };
  }, []);
  if (error) return <p role="alert" className="text-12 text-muted-foreground">{error}</p>;
  if (items === null) return <ListSkeleton testId="workflow-decided-loading" />;
  if (items.length === 0) return <p data-testid="workflow-decided-empty" className="text-12 text-muted-foreground">还没有处理过的审批。</p>;
  return (
    <ul data-testid="workflow-decided-list" className="divide-y divide-border rounded-lg border border-border">
      {items.map((i) => {
        const t = gateDisplayTitle({ stageId: i.gate.stageId, summary: i.gate.effectPreview.summary }, i.workflowKey);
        return (
          <li key={`${i.instanceId}-${i.gate.gateId}`} className="flex items-center gap-3 px-3 py-2 text-12">
            <Link href={`/workflows/runs/${encodeURIComponent(i.instanceId)}`} className="flex-1 truncate transition-colors duration-base hover:underline">
              {`${t.stage}${t.workflow ? ` · ${t.workflow}` : ""}`}
            </Link>
            <span className="text-muted-foreground">{DECISION_TEXT[String(i.gate.decision)] ?? "已处理"}</span>
            {i.gate.decidedAt ? <time className="text-muted-foreground" dateTime={i.gate.decidedAt}>{formatDateTime(i.gate.decidedAt)}</time> : null}
          </li>
        );
      })}
    </ul>
  );
}

/**
 * 「运行 Workflow」入口：无运行权限（服务端不返回可运行项 / 403 / 404）时不渲染。
 * 点击展开可运行列表，用户选定一个后调契约 `startInstance` 发起运行，成功跳到运行面板。
 * 该 Workflow 的 `inputSchema` 有必填字段时先展开 trigger 表单收集输入；无必填字段则一键发起。
 */
export function WorkflowRunEntry(props: {
  readonly agentId: string;
  /** 发起成功后回调；缺省时跳转 `/workflows/runs/<instanceId>`。 */
  readonly onStarted?: (instanceId: string) => void;
}) {
  const [items, setItems] = useState<RunnableWorkflow[]>([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [formFor, setFormFor] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    listRunnableWorkflows(props.agentId)
      .then((r) => live && setItems(r.items))
      .catch(() => live && setItems([]));
    return () => { live = false; };
  }, [props.agentId]);
  if (items.length === 0) return null;
  function pick(w: RunnableWorkflow) {
    setError(null);
    if (requiredTriggerFields(w.inputSchema).length > 0) setFormFor(`${w.key}@${w.version}`);
    else void start(w, {});
  }
  async function start(w: RunnableWorkflow, input: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    try {
      const res = await startWorkflowInstance({ key: w.key, version: w.version, agentId: props.agentId, input });
      if (props.onStarted) props.onStarted(res.instanceId);
      else window.location.assign(`/workflows/runs/${encodeURIComponent(res.instanceId)}`);
    } catch (e) {
      setError(describeWorkflowError(workflowErrorCode(e)));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div data-testid="workflow-run-entry-root" className="flex flex-col gap-2">
      <div>
        <Button size="sm" variant="primary" data-testid="workflow-run-entry" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
          运行工作流
        </Button>
      </div>
      {open ? (
        <ul data-testid="workflow-run-picker" className="flex flex-col divide-y divide-border rounded-lg border border-border bg-card">
          {items.map((w) => {
            const id = `${w.key}@${w.version}`;
            return (
              <li key={id} className="flex flex-col gap-2 px-3 py-2.5">
                <button
                  type="button"
                  disabled={busy}
                  data-testid={`workflow-run-start-${w.key}`}
                  onClick={() => pick(w)}
                  className="flex items-baseline gap-2 text-left text-13 font-medium transition-colors duration-base hover:text-primary disabled:cursor-not-allowed disabled:text-disabled-foreground"
                >
                  {w.title}<span className="font-mono text-11 font-normal text-muted-foreground">{id}</span>
                </button>
                {formFor === id ? (
                  <WorkflowStartForm
                    workflowKey={w.key}
                    fields={requiredTriggerFields(w.inputSchema)}
                    busy={busy}
                    onSubmit={(input) => void start(w, input)}
                    onCancel={() => setFormFor(null)}
                  />
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}
      {error ? <p role="alert" data-testid="workflow-run-start-error" className="text-12 text-destructive">{error}</p> : null}
    </div>
  );
}

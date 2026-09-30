"use client";
/**
 * WF08 —— 「我的运行」「待我审批」列表与「运行 Workflow」入口按钮。
 */
import { useEffect, useState } from "react";
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
import { WorkflowApprovalDrawer } from "./workflow-approval-drawer";
import { gateDisplayTitle, workflowDisplayName } from "@/lib/workflow-display-copy";
import { INSTANCE_STATUS_TEXT, describeWorkflowError } from "./workflow-copy";
import { WorkflowStartForm, requiredTriggerFields } from "./workflow-start-form";

export function WorkflowRunList(props: { readonly status?: readonly WorkflowInstanceStatus[]; readonly hrefFor?: (id: string) => string }) {
  const [items, setItems] = useState<WorkflowInstanceSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const key = (props.status ?? []).join(",");
  useEffect(() => {
    let live = true;
    listMyWorkflowInstances(props.status)
      .then((r) => live && setItems(r.items))
      .catch((e) => live && setError(describeWorkflowError(workflowErrorCode(e))));
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  if (error) return <p role="alert" data-testid="workflow-run-list-error">{error}</p>;
  if (items === null) return <p>加载中…</p>;
  if (items.length === 0) return <p data-testid="workflow-run-list-empty">还没有运行记录。在 Agent 页点「运行 Workflow」开始一次。</p>;
  const href = props.hrefFor ?? ((id: string) => `/workflows/runs/${encodeURIComponent(id)}`);
  return (
    <ul data-testid="workflow-run-list">
      {items.map((i) => (
        <li key={i.instanceId} data-status={i.status}>
          <a href={href(i.instanceId)}>{workflowDisplayName(i.workflowKey)}</a> · {INSTANCE_STATUS_TEXT[i.status]}
        </li>
      ))}
    </ul>
  );
}

export function WorkflowApprovalList(props: { readonly includeDecided?: boolean }) {
  const [items, setItems] = useState<WorkflowApprovalItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  useEffect(() => {
    let live = true;
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
  if (error) return <p role="alert">{error}</p>;
  if (items === null) return <p>加载中…</p>;
  if (items.length === 0) {
    return (
      <div data-testid="workflow-run-list-empty" className="rounded-lg border border-dashed border-border px-6 py-8 text-center">
        <p className="text-13 font-medium">没有待你审批的事项。</p>
        <p className="mt-1 text-12 text-muted-foreground">工作流走到需要你拍板的一步（例如对外发布、写入外部系统）时，会出现在这里，并通知你。处理过的记录见下方「已处理」。</p>
      </div>
    );
  }
  return (
    <ul data-testid="workflow-approval-list">
      {items.map((i) => {
        // gateId 只在单个运行内唯一（如每个 demo-approval 运行的门都是 publish-gate-1），故以 instanceId+gateId 为键。
        const rowKey = `${i.instanceId}-${i.gate.gateId}`;
        return (
        <li key={rowKey} data-gate-id={i.gate.gateId} data-instance-id={i.instanceId}>
          <button type="button" data-testid={`workflow-approval-open-${rowKey}`} onClick={() => setOpen(rowKey)}>
            {(() => { const t = gateDisplayTitle({ stageId: i.gate.stageId, summary: i.gate.effectPreview.summary }, i.workflowKey); return `${t.stage}${t.workflow ? ` · ${t.workflow}` : ""}`; })()}
          </button>
          {open === rowKey ? (
            <WorkflowApprovalDrawer
              instanceId={i.instanceId}
              workflowKey={i.workflowKey}
              gate={i.gate}
              initiatorUserId={i.initiatorUserId}
              agentId={i.agentId}
              onDecided={onDecided}
            />
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
  if (items === null) return <p className="text-12 text-muted-foreground">加载中…</p>;
  if (items.length === 0) return <p data-testid="workflow-decided-empty" className="text-12 text-muted-foreground">还没有处理过的审批。</p>;
  return (
    <ul data-testid="workflow-decided-list" className="divide-y divide-border rounded-lg border border-border">
      {items.map((i) => {
        const t = gateDisplayTitle({ stageId: i.gate.stageId, summary: i.gate.effectPreview.summary }, i.workflowKey);
        return (
          <li key={`${i.instanceId}-${i.gate.gateId}`} className="flex items-center gap-3 px-3 py-2 text-12">
            <a href={`/workflows/runs/${encodeURIComponent(i.instanceId)}`} className="flex-1 truncate transition-colors duration-base hover:underline">
              {`${t.stage}${t.workflow ? ` · ${t.workflow}` : ""}`}
            </a>
            <span className="text-muted-foreground">{DECISION_TEXT[String(i.gate.decision)] ?? "已处理"}</span>
            {i.gate.decidedAt ? <time className="text-muted-foreground" dateTime={i.gate.decidedAt}>{new Date(i.gate.decidedAt).toLocaleString("zh-CN", { hour12: false })}</time> : null}
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
    <div data-testid="workflow-run-entry-root">
      <button type="button" data-testid="workflow-run-entry" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        运行 Workflow
      </button>
      {open ? (
        <ul data-testid="workflow-run-picker">
          {items.map((w) => {
            const id = `${w.key}@${w.version}`;
            return (
              <li key={id}>
                <button type="button" disabled={busy} data-testid={`workflow-run-start-${w.key}`} onClick={() => pick(w)}>
                  {w.title}（{id}）
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
      {error ? <p role="alert" data-testid="workflow-run-start-error">{error}</p> : null}
    </div>
  );
}

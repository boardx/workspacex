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
import { INSTANCE_STATUS_TEXT, describeWorkflowError } from "./workflow-copy";

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
          <a href={href(i.instanceId)}>{`${i.workflowKey}@${i.definitionVersion}`}</a> · {INSTANCE_STATUS_TEXT[i.status]}
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
  if (items.length === 0) return <p data-testid="workflow-run-list-empty">没有待你审批的事项。</p>;
  return (
    <ul data-testid="workflow-approval-list">
      {items.map((i) => (
        <li key={i.gate.gateId} data-gate-id={i.gate.gateId}>
          <button type="button" data-testid={`workflow-approval-open-${i.gate.gateId}`} onClick={() => setOpen(i.gate.gateId)}>
            {i.gate.effectPreview.summary}（{`${i.workflowKey}@${i.definitionVersion}`}）
          </button>
          {open === i.gate.gateId ? (
            <WorkflowApprovalDrawer
              instanceId={i.instanceId}
              gate={i.gate}
              initiatorUserId={i.initiatorUserId}
              agentId={i.agentId}
              onDecided={onDecided}
            />
          ) : null}
        </li>
      ))}
    </ul>
  );
}

/**
 * 「运行 Workflow」入口：无运行权限（服务端不返回可运行项 / 403 / 404）时不渲染。
 * 点击展开可运行列表，用户选定一个后调契约 `startInstance` 发起运行，成功跳到运行面板。
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
  useEffect(() => {
    let live = true;
    listRunnableWorkflows(props.agentId)
      .then((r) => live && setItems(r.items))
      .catch(() => live && setItems([]));
    return () => { live = false; };
  }, [props.agentId]);
  if (items.length === 0) return null;
  async function start(w: RunnableWorkflow) {
    setBusy(true);
    setError(null);
    try {
      const res = await startWorkflowInstance({ key: w.key, version: w.version, agentId: props.agentId, input: {} });
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
          {items.map((w) => (
            <li key={`${w.key}@${w.version}`}>
              <button type="button" disabled={busy} data-testid={`workflow-run-start-${w.key}`} onClick={() => void start(w)}>
                {w.title}（{`${w.key}@${w.version}`}）
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {error ? <p role="alert" data-testid="workflow-run-start-error">{error}</p> : null}
    </div>
  );
}

"use client";
/**
 * WF08 —— 「我的运行」「待我审批」列表与「运行 Workflow」入口按钮。
 */
import { useEffect, useState } from "react";
import {
  listMyWorkflowApprovals,
  listMyWorkflowInstances,
  listRunnableWorkflows,
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
  useEffect(() => {
    let live = true;
    listMyWorkflowApprovals(props.includeDecided ?? false)
      .then((r) => live && setItems(r.items))
      .catch((e) => live && setError(describeWorkflowError(workflowErrorCode(e))));
    return () => { live = false; };
  }, [props.includeDecided]);
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
            />
          ) : null}
        </li>
      ))}
    </ul>
  );
}

/** 「运行 Workflow」入口：无运行权限（服务端不返回可运行项 / 403 / 404）时不渲染。 */
export function WorkflowRunEntry(props: { readonly agentId: string; readonly onSelect?: (w: RunnableWorkflow) => void }) {
  const [items, setItems] = useState<RunnableWorkflow[]>([]);
  useEffect(() => {
    let live = true;
    listRunnableWorkflows(props.agentId)
      .then((r) => live && setItems(r.items))
      .catch(() => live && setItems([]));
    return () => { live = false; };
  }, [props.agentId]);
  if (items.length === 0) return null;
  return (
    <button type="button" data-testid="workflow-run-entry" onClick={() => props.onSelect?.(items[0]!)}>
      运行 Workflow
    </button>
  );
}

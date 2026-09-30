"use client";
/**
 * WF08 —— 审批抽屉（面板与「待我审批」列表共用）。
 * 裁决后不本地预测结果：只发请求，结果由服务端回包 / projection 权威更新。
 */
import { useState } from "react";
import {
  approveWorkflowGate,
  denyWorkflowGate,
  getWorkflowInstance,
  workflowErrorCode,
  type WorkflowGateView,
} from "@/lib/workflow-runtime-api";
import { describeWorkflowError } from "./workflow-copy";
import { useOptionalSession } from "@/components/session/session-provider";
import { capabilityCopy, targetSystemText } from "@/lib/workflow-capability-grant-copy";
import { memberLabel, useOrgMemberNames } from "@/lib/use-org-member-names";

export interface WorkflowApprovalDrawerProps {
  readonly instanceId: string;
  readonly gate: WorkflowGateView;
  /** 缺省（列表场景：契约列表项不带 stateVersion）时，裁决前先读一次 projection 取当前值。 */
  readonly expectedStateVersion?: number;
  readonly initiatorUserId?: string;
  readonly agentId?: string;
  /** 实例已取消 / 终态时抽屉只读。 */
  readonly readOnly?: boolean;
  readonly onDecided?: (gate: WorkflowGateView) => void;
}

export function WorkflowApprovalDrawer(props: WorkflowApprovalDrawerProps) {
  const { gate } = props;
  const session = useOptionalSession();
  const names = useOrgMemberNames(session?.session?.currentOrgId ?? null);
  const me = session?.session?.userId ?? null;
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [decided, setDecided] = useState<WorkflowGateView | null>(gate.decision ? gate : null);
  const shown = decided ?? gate;
  const locked = busy || shown.decision !== null || props.readOnly === true || !gate.viewerCanDecide;

  async function decide(kind: "approve" | "deny") {
    if (kind === "deny" && reason.trim() === "") {
      setError(describeWorkflowError("deny_reason_required"));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const expectedStateVersion = props.expectedStateVersion ?? (await getWorkflowInstance(props.instanceId)).stateVersion;
      const base = { instanceId: props.instanceId, gateId: gate.gateId, expectedStateVersion };
      const res = kind === "approve" ? await approveWorkflowGate(base) : await denyWorkflowGate({ ...base, reason: reason.trim() });
      setDecided(res.gate);
      props.onDecided?.(res.gate);
    } catch (err) {
      const code = workflowErrorCode(err);
      setError(describeWorkflowError(code));
      if (code === "gate_already_decided") {
        const body = (err as { raw?: { decidedGate?: WorkflowGateView } }).raw;
        if (body?.decidedGate) setDecided(body.decidedGate);
      }
    } finally {
      setBusy(false);
    }
  }

  const p = shown.effectPreview;
  return (
    <aside data-testid="workflow-approval-drawer" data-gate-id={gate.gateId} className="rounded-lg border p-4 space-y-3">
      <h3 className="font-medium">审批：{p.summary}</h3>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
        <dt>操作对象</dt>
        <dd data-testid="workflow-approval-target">{targetSystemText(p.targetSystem)}</dd>
        <dt>需要的能力</dt>
        <dd data-testid="workflow-approval-capability">{capabilityCopy(p.capabilityCategory).label}</dd>
        {props.initiatorUserId ? (<><dt>发起人</dt><dd data-testid="workflow-approval-initiator">{memberLabel(props.initiatorUserId, me, names)}</dd></>) : null}
        {props.agentId ? (<><dt>执行者</dt><dd data-testid="workflow-approval-agent">本工作流的智能体</dd></>) : null}
      </dl>
      <details data-testid="workflow-approval-tech-details" className="text-xs text-muted-foreground">
        <summary className="cursor-pointer select-none">技术详情</summary>
        <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
          <dt>目标系统</dt><dd><code data-testid="workflow-approval-target-raw">{p.targetSystem}</code></dd>
          <dt>能力分类</dt><dd><code data-testid="workflow-approval-capability-raw">{p.capabilityCategory}</code></dd>
          {props.initiatorUserId ? (<><dt>发起人 ID</dt><dd><code data-testid="workflow-approval-initiator-raw">{props.initiatorUserId}</code></dd></>) : null}
          {props.agentId ? (<><dt>Agent ID</dt><dd><code data-testid="workflow-approval-agent-raw">{props.agentId}</code></dd></>) : null}
        </dl>
      </details>
      <pre data-testid="workflow-approval-preview" className="max-h-48 overflow-auto rounded bg-muted p-2 text-xs">
        {JSON.stringify(p.payloadPreview, null, 2)}
      </pre>
      {shown.decision !== null ? (
        <p data-testid="workflow-approval-result" data-decision={shown.decision}>
          {shown.decision === "approved" ? "已批准" : "已拒绝"}
          {shown.decidedBy ? `（${memberLabel(shown.decidedBy, me, names)}）` : ""}
          {shown.reason ? `：${shown.reason}` : ""}
        </p>
      ) : null}
      <textarea
        data-testid="workflow-deny-reason"
        aria-label="拒绝理由"
        placeholder="拒绝理由（必填）"
        value={reason}
        disabled={locked}
        onChange={(e) => setReason(e.target.value)}
        className="w-full rounded border p-2 text-sm"
      />
      {error ? <p role="alert" data-testid="workflow-approval-error">{error}</p> : null}
      <div className="flex gap-2">
        <button type="button" data-testid="workflow-approve" disabled={locked} onClick={() => void decide("approve")}>批准</button>
        <button type="button" data-testid="workflow-deny" disabled={locked} onClick={() => void decide("deny")}>拒绝</button>
      </div>
    </aside>
  );
}

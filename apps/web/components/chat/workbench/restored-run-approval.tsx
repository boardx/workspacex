"use client";
import * as React from "react";
import { CALL_SKILL_TOOL_NAME } from "@/lib/agent-run-phase";
import { RestoredInterruptForm } from "./restored-interrupt-form";
import { agentInterrupts, planPermissions, wave2Runtime } from "@repo/contracts";
import { getAgentRun, type AgentRunView } from "@/lib/agent-run";
import { apiRequest } from "@/lib/api-client";
import { InterruptDecisionDialog } from "./interrupt-decision-dialog";
import { useDialogReturnFocus } from "./use-dialog-return-focus";
import {
  ToolPermissionCard,
  type ToolPermissionCardDecision,
  type ToolPermissionCardRequest,
} from "@/components/agent-kernel/tool-permission-card";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";

function permissionCardRequest(toolName: string, argsSummary: string | null): ToolPermissionCardRequest {
  return {
    risk: "L2",
    intent: toolName === CALL_SKILL_TOOL_NAME ? "调用一个需要授权的技能" : `调用工具 ${toolName}`,
    rationale: "该操作被运行时判定为高风险，可能产生不可逆或外部可见的影响。",
    command: argsSummary ?? "服务端尚未提供参数摘要。",
    affects: "服务端尚未提供更具体的影响对象；如范围不明确，请拒绝此次执行。",
  };
}
/** Authoritative pending request identity survives refresh; summaries are display-only. */
export function RestoredRunApproval(props: { runId: string; bearer?: string; canWrite?: boolean; fallbackInterrupt?: agentInterrupts.RestorableInterrupt }): JSX.Element | null {
  return <ApprovalSession key={props.runId} {...props} />;
}
function ApprovalSession({ runId, bearer, canWrite = true, fallbackInterrupt }: { runId: string; bearer?: string; canWrite?: boolean; fallbackInterrupt?: agentInterrupts.RestorableInterrupt }): JSX.Element | null {
  const [run, setRun] = React.useState<AgentRunView | null>(null);
  const [consumedRequestId, setConsumedRequestId] = React.useState<string | null>(null);
  const inFlight = React.useRef(false);
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [permissionOpen, setPermissionOpen] = React.useState(true);
  // 同 InterruptDecisionDialog：这个弹窗也是挂载即打开、没有用户 trigger（TW-A11Y-5）。
  const returnPermissionFocus = useDialogReturnFocus(permissionOpen);
  React.useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const refresh = async () => {
      try { const value = await getAgentRun(runId, bearer, controller.signal); if (!controller.signal.aborted) setRun(value); if (["succeeded", "failed", "cancelled"].includes(value.status)) return; }
      catch (cause) { if (!controller.signal.aborted) setError(String(cause)); }
      if (!controller.signal.aborted) timer = setTimeout(() => void refresh(), 1500);
    };
    void refresh();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [runId, bearer]);
  const request = run?.pendingApproval;
  const decide = async (decision: "once" | "run" | "forever" | "deny") => {
    if (!canWrite || !request?.permissionRequestId || inFlight.current) return;
    inFlight.current = true;
    setPending(true); setError(null);
    try {
      await apiRequest(planPermissions.operations.decidePermissionRequest.path.replace(":runId", encodeURIComponent(runId)).replace(":permissionRequestId", encodeURIComponent(request.permissionRequestId)), { method: "POST", body: { decision }, sessionToken: bearer });
      setConsumedRequestId(request.permissionRequestId);
      setRun(await getAgentRun(runId, bearer));
    } catch (cause) { setError(cause instanceof Error ? cause.message : "提交失败，请重试"); }
    finally { inFlight.current = false; setPending(false); }
  };
  const decideFromCard = (decision: ToolPermissionCardDecision): void => {
    void decide(decision === "always" ? "forever" : decision);
  };
  const decideForm = async (decision: "approve" | "edit" | "reject", editedArgs?: Record<string, unknown>) => {
    if (!canWrite || !request?.permissionRequestId || inFlight.current) return;
    inFlight.current = true;
    setPending(true); setError(null);
    try {
      await apiRequest(wave2Runtime.operations.decideAgentRun.path.replace(":runId", encodeURIComponent(runId)), { method: "POST", body: { permissionRequestId: request.permissionRequestId, decision, ...(decision === "edit" ? { editedArgs } : {}) }, sessionToken: bearer });
      setConsumedRequestId(request.permissionRequestId);
      setRun(await getAgentRun(runId, bearer));
    } catch (cause) { setError(cause instanceof Error ? cause.message : "提交失败，请重试"); }
    finally { inFlight.current = false; setPending(false); }
  };
  if (run && ["succeeded", "failed", "cancelled"].includes(run.status)) return null;
  if (fallbackInterrupt && request?.interrupt && (fallbackInterrupt.toolName !== request.interrupt.toolName || fallbackInterrupt.args.requestId !== request.interrupt.args.requestId)) return <fieldset disabled aria-label="已结束的确认记录"><RestoredInterruptForm interrupt={fallbackInterrupt} pending={false} decide={async () => {}} /></fieldset>;
  if (request?.permissionRequestId && request.permissionRequestId === consumedRequestId) return null;
  if (request?.interrupt && run?.status === "awaiting_tool_permission") return <section data-testid="restored-run-approval">{error ? <p role="alert">{error}</p> : null}{request.permissionRequestId ? <InterruptDecisionDialog key={request.permissionRequestId} interrupt={request.interrupt} pending={!canWrite || pending} decide={decideForm} /> : <fieldset disabled><RestoredInterruptForm interrupt={request.interrupt} pending={false} decide={async () => {}} /></fieldset>}</section>;
  if (fallbackInterrupt && !request?.interrupt) return <section data-testid="interrupt-awaiting-persistence">
    <p role="status">{error ?? "等待服务端确认此请求，确认后即可继续。"}</p>
    <fieldset disabled><RestoredInterruptForm interrupt={fallbackInterrupt} pending={false} decide={async () => {}} /></fieldset>
  </section>;
  if (request && request.toolName !== CALL_SKILL_TOOL_NAME) return <p role="alert">确认请求暂时无法恢复，请重新加载任务后重试。</p>;
  if (!error && (run?.status !== "awaiting_tool_permission" || !request)) return null;
  return <section
    data-testid="restored-run-approval"
    className="my-3"
    aria-label="等待工具审批"
  >
    <Button variant="outline" onClick={() => setPermissionOpen(true)}>打开工具审批</Button>
    <Dialog open={permissionOpen} onOpenChange={setPermissionOpen}>
      <DialogContent data-testid="chat-tool-permission-dialog" className="max-w-lg border-none bg-transparent p-0 shadow-none" hideClose onCloseAutoFocus={returnPermissionFocus}>
        <DialogTitle className="sr-only">审批高风险操作</DialogTitle>
        <DialogDescription className="sr-only">检查操作范围与参数，然后选择授权范围或拒绝。</DialogDescription>
        {error ? <p role="alert">{error}</p> : null}
        {!request?.permissionRequestId ? <p className="text-sm">等待服务端恢复审批请求。</p> : null}
        {request ? <fieldset
          data-testid="chat-task-workbench-approval-card"
          data-risk="L2"
          disabled={!canWrite || pending || !request.permissionRequestId}
        >
          <ToolPermissionCard
            request={permissionCardRequest(request.toolName, request.argsSummary)}
            decided={null}
            onDecide={decideFromCard}
          />
        </fieldset> : null}
      </DialogContent>
    </Dialog>
  </section>;
}

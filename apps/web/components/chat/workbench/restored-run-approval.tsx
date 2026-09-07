"use client";
import * as React from "react";
import { CALL_SKILL_TOOL_NAME } from "@/lib/agent-run-phase";
import { RestoredInterruptForm } from "./restored-interrupt-form";
import { agentInterrupts, planPermissions, wave2Runtime } from "@repo/contracts";
import { getAgentRun, type AgentRunView } from "@/lib/agent-run";
import { apiRequest } from "@/lib/api-client";
import { InterruptDecisionDialog } from "./interrupt-decision-dialog";
import { Button } from "@/components/ui/button";
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
  return <section data-testid="restored-run-approval" className="my-3 rounded-lg border p-4" aria-label="等待工具审批">
    <p className="font-medium">等待批准：{request?.toolName}</p>
    {request?.argsSummary ? <p className="my-2 whitespace-pre-wrap text-sm text-muted-foreground">{request.argsSummary}</p> : null}
    {error ? <p role="alert">{error}</p> : null}
    {!request?.permissionRequestId ? <p className="text-sm">等待服务端恢复审批请求。</p> : null}
    <div className="mt-3 flex flex-wrap gap-2">{([['once', '仅本次允许'], ['run', '本任务内允许'], ['forever', '以后都允许'], ['deny', '拒绝']] as const).map(([decision, label]) => <Button key={decision} variant={decision === "deny" ? "outline" : "primary"} disabled={!canWrite || pending || !request?.permissionRequestId} onClick={() => void decide(decision)}>{label}</Button>)}</div>
  </section>;
}

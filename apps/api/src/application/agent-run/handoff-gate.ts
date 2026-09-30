/**
 * AG07 —— 内核对 `request_handoff` 中断时网关这一层做什么（03-agent-role.md R3 ⑨ / E5；契约束 agent-role UC-7）。
 *
 * 与 AG05 `start_workflow` 同一条生产路径（`tool-permission-gate.ts`）、同一种形状：
 *   1. `requestAgentHandoff`：按该 run 钉住的版本快照 `delegationPolicy` 判定目标与深度，通过则落一行
 *      `requested`（等发起人确认，**不**新开线程）；
 *   2. 结果落 run 账本（`agent_run_steps` 一行 planningNote）——审计留痕；
 *   3. 以 **edit** resume 把 `{targetRole, packet, outcome}` 交回同一个被中断的工具调用，工具体把
 *      `outcome.message` 告诉 Agent（拒绝时原线程继续，E5）。
 * 不走风险分级、不读常驻授权：`delegationPolicy` 才是这件事的授权依据；真正的「放行」是发起人的确认。
 */
import type { OrgId } from "../../domain/org-id";
import { handoffEditedArgs, requestAgentHandoff, type AgentHandoffOutcome } from "../agent/agent-handoff";
import type { ExecuteAgentRunDeps } from "./execute-run";
import { record } from "./record-run-step";
import type { InterruptedToolCall } from "./tool-permission-gate";

export function handoffAuditNote(outcome: AgentHandoffOutcome): string {
  return outcome.status === "requested"
    ? `Agent 请求转交给 ${outcome.targetRole}：已登记 ${outcome.handoffId}，等待发起人确认`
    : `Agent 请求转交给 ${outcome.targetRole ?? "（参数无效）"} 被拒绝：${outcome.message}`;
}

export async function handleHandoffRequestCall(
  deps: ExecuteAgentRunDeps,
  orgId: OrgId,
  runId: string,
  interrupted: InterruptedToolCall,
  ledger: { readonly seq: number; readonly modelStartedAt: string; readonly systemDigest: string; readonly system: string },
): Promise<{ readonly autoApproved: boolean }> {
  if (!deps.runs.requeueToolCallWithResult) {
    deps.log("handoff result requeue unsupported", { runId, toolName: interrupted.toolName });
    await deps.runs.failRun(orgId, runId, "KERNEL_UNAVAILABLE");
    return { autoApproved: false };
  }
  const outcome = await requestAgentHandoff(
    { handoffs: deps.handoffs },
    { orgId, runId, toolCallId: interrupted.toolCallId, argsJson: interrupted.argsSummary },
  );
  await record(deps, orgId, {
    runId, seq: ledger.seq, kind: "model_called", startedAt: ledger.modelStartedAt,
    inputDigest: ledger.systemDigest, outputDigest: null, failureCode: null,
    planningNote: handoffAuditNote(outcome), inputFullContent: ledger.system,
  });
  const requeued = await deps.runs.requeueToolCallWithResult(
    orgId, runId, interrupted, handoffEditedArgs(interrupted.argsSummary, outcome),
  );
  if (!requeued) deps.log("handoff result requeue lost the race", { runId, toolName: interrupted.toolName });
  else deps.kick?.(orgId);
  return { autoApproved: true };
}

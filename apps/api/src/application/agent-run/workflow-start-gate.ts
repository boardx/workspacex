/**
 * AG05 —— 内核对 `start_workflow` 中断时网关这一层做什么（03-agent-role.md R3 / E3；契约束 agent-role UC-5）。
 *
 * 与 AG06 `escalate_matter` 同一条生产路径（`tool-permission-gate.ts`），但不停下来等人：
 *   1. `requestAgentWorkflowStart`：按该 run 钉住的版本快照白名单判定，命中则走真实 WF03 start；
 *   2. 结果落 run 账本（`agent_run_steps` 一行 planningNote：发起了哪个实例 / 为什么被拒）——审计留痕；
 *   3. 以 **edit** resume 把 `{...原参数, outcome}` 交回同一个被中断的工具调用（`requeueToolCallWithResult`），
 *      工具体把 `outcome.message`（聊天可见文案，如「该角色不能发起此流程」）告诉 Agent。
 * 不走风险分级、不读常驻授权：白名单才是这件事的授权依据，拒绝时不会有任何人被问「要不要放行」。
 */
import type { OrgId } from "../../domain/org-id";
import { parseWorkflowStartArgs, requestAgentWorkflowStart, type AgentWorkflowStartOutcome } from "../agent/request-agent-workflow-start";
import type { ExecuteAgentRunDeps } from "./execute-run";
import { record } from "./record-run-step";
import type { InterruptedToolCall } from "./tool-permission-gate";

/** 账本里的一句话（中文，不含原始错误码）；稳定编号与实例 id 是审计要点。 */
export function workflowStartAuditNote(outcome: AgentWorkflowStartOutcome): string {
  return outcome.status === "started"
    ? `Agent 发起 Workflow ${outcome.workflowId}：已创建实例 ${outcome.instanceId}`
    : `Agent 发起 Workflow ${outcome.workflowId ?? "（参数无效）"} 被拒绝：${outcome.message}`;
}

export async function handleWorkflowStartCall(
  deps: ExecuteAgentRunDeps,
  orgId: OrgId,
  runId: string,
  interrupted: InterruptedToolCall,
  ledger: { readonly seq: number; readonly modelStartedAt: string; readonly systemDigest: string; readonly system: string },
): Promise<{ readonly autoApproved: boolean }> {
  const outcome = await requestAgentWorkflowStart(
    { runs: deps.runs, workflows: deps.workflowStarts, log: deps.log },
    { orgId, runId, toolCallId: interrupted.toolCallId, argsJson: interrupted.argsSummary },
  );
  await record(deps, orgId, {
    runId, seq: ledger.seq, kind: "model_called", startedAt: ledger.modelStartedAt,
    inputDigest: ledger.systemDigest, outputDigest: null, failureCode: null,
    planningNote: workflowStartAuditNote(outcome), inputFullContent: ledger.system,
  });
  const args = parseWorkflowStartArgs(interrupted.argsSummary);
  const edited = JSON.stringify({ ...(args ?? {}), outcome });
  if (!deps.runs.requeueToolCallWithResult) {
    // 存储不支持把结果交回内核：不能让 run 悄悄停在 running，按稳定码失败（实例若已建由 WF03 负责）。
    deps.log("workflow start result requeue unsupported", { runId, toolName: interrupted.toolName });
    await deps.runs.failRun(orgId, runId, "MODEL_CALL_FAILED");
    return { autoApproved: false };
  }
  const requeued = await deps.runs.requeueToolCallWithResult(orgId, runId, interrupted, edited);
  if (!requeued) {
    // 输了竞态（取消/失败/被别处收走）：不重试、不覆盖。实例（若已建）由 WF03 自己负责。
    deps.log("workflow start result requeue lost the race", { runId, toolName: interrupted.toolName });
  } else {
    deps.kick?.(orgId);
  }
  return { autoApproved: true };
}

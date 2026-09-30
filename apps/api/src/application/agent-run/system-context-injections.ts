import type { OrgId } from "../../domain/org-id";
import { buildEscalationPolicyContext } from "../../domain/agent/escalation-policy-prompt";
import { serializePlanForDelivery } from "../plan-control/plan-delivery-text";
import type { ExecuteAgentRunDeps } from "./execute-run";

/**
 * 从 `execute-run.ts` 抽出的「往本轮 system 追加上下文」两段（thin-gateway 方向）。
 * 两段都是 log-and-continue：读失败不让 run 失败；没有内容 ⇒ 返回原 `system`，逐字节不变。
 */

/** F975 UC-12 `deliverPlanToRun`：把最新计划账本序列化后追加。见 `ExecuteAgentRunDeps.planLedger`。 */
export async function appendPlanLedgerContext(
  deps: Pick<ExecuteAgentRunDeps, "planLedger" | "log">,
  system: string,
  orgId: OrgId,
  run: { readonly runId: string; readonly threadId: string },
): Promise<string> {
  if (!deps.planLedger) return system;
  try {
    const ledger = await deps.planLedger.getLatest(orgId, run.threadId);
    const planText = ledger ? serializePlanForDelivery(ledger) : null;
    return planText !== null ? `${system}\n\n---\n\n${planText}` : system;
  } catch (e) {
    deps.log("plan-control: reading the plan ledger for delivery failed, continuing without it", {
      runId: run.runId,
      detail: e instanceof Error ? e.message : "unexpected plan ledger read failure",
    });
    return system;
  }
}

/** AG06：deep-agent run 才挂 `escalate_matter`，把钉住策略里的事项名与裁决人（人话）注入 system。 */
export async function appendEscalationPolicyContext(
  deps: { readonly runs: Pick<ExecuteAgentRunDeps["runs"], "readPinnedEscalationPolicy"> } & Pick<ExecuteAgentRunDeps, "log">,
  system: string,
  orgId: OrgId,
  runId: string,
): Promise<string> {
  if (!deps.runs.readPinnedEscalationPolicy) return system;
  try {
    const escalationContext = buildEscalationPolicyContext(await deps.runs.readPinnedEscalationPolicy(orgId, runId));
    return escalationContext !== null ? `${system}\n\n---\n\n${escalationContext}` : system;
  } catch (e) {
    deps.log("agent run escalation policy read failed, continuing without it", {
      runId,
      detail: e instanceof Error ? e.message : "unexpected escalation policy read failure",
    });
    return system;
  }
}

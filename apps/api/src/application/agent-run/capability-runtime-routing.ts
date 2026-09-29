import type { OrgId } from "../../domain/org-id";
import { DEEP_AGENT_PROVIDER_NAME, type AgentRunStore, type ClaimedAgentRun, type ModelCallPort } from "./ports";

/**
 * 数字人能力（人类决策 B）—— 带工具型能力的 Agent 走 deep-agent 运行时，底层 LLM 仍是它钉住的模型。
 *
 * 官方数字人（`official-role-packs.ts`）钉 `dashscope / qwen-plus`。chat provider
 * （`ConfiguredModelProvider`）没有工具调用（#741），于是 `start_workflow` 与挂载 Skill 在聊天里
 * 永远用不上。工具调用、中断（`interrupted`）与 HITL resume 只在 deep-agent 运行时里存在。
 *
 * 判据（最小且正确）：
 *   1. provider 名由 deep-agent 内核的 LLM 端点同样提供（`ModelCallPort.servesViaKernelRuntime`，
 *      合成期决定：内核与 chat 共用同一个 `KERNEL_MODEL_*` 端点）——否则换运行时会换掉模型；
 *   2. 且该 Agent **自身**有工具型能力：钉住版本的 Workflow 白名单非空，或钉住版本自己钉了 Skill。
 *      ⚠ 不看 run 的 `skillVersionIds`：Agent 没钉 Skill 时它会并入**组织里所有已启用 Skill**
 *      （`message-roundtrip.ts` 的 `resolveRunSkillVersionIds`），于是只要组织里启用过任何一个 Skill，
 *      每个普通 Agent 都会被改道——core-loop 8b 的回环 Agent 就是这样被换了运行时、回复不再出自
 *      它钉住的 provider。判据只取钉住版本快照（不可变），resume / 恢复重算结论不变。
 * 两条都满足 ⇒ 本次执行视作 `deep-agent` run，`modelId` 保持钉住值（`qwen-plus`），由
 * `DeepAgentModelProvider` 以 `configurable.model_id` 交给内核按次覆盖模型。
 * 其它一切（普通 Agent、本就是 deep-agent 的 run、研究/图片 provider）原样返回——同一个对象。
 *
 * 不改库里的 `model_provider`：钉住事实仍是 `dashscope`，这里只决定**用哪个运行时执行它**；
 * resume 重新 claim 时同一判据再算一遍，结论不变（白名单/Skill 来自钉住版本快照）。
 */
export async function routeCapabilityRun(
  deps: { readonly model: ModelCallPort; readonly runs: AgentRunStore },
  orgId: OrgId,
  run: ClaimedAgentRun,
): Promise<ClaimedAgentRun> {
  if (run.modelProvider === DEEP_AGENT_PROVIDER_NAME) return run;
  if (!deps.model.servesViaKernelRuntime?.(run.modelProvider)) return run;
  if (!(await hasToolCapabilities(deps.runs, orgId, run))) return run;
  return { ...run, modelProvider: DEEP_AGENT_PROVIDER_NAME };
}

async function hasToolCapabilities(runs: AgentRunStore, orgId: OrgId, run: ClaimedAgentRun): Promise<boolean> {
  const ctx = await runs.readRunWorkflowContext?.(orgId, run.runId);
  if (!ctx) return false;
  return ctx.workflowAllowlist.length > 0 || (ctx.agentPinnedSkillCount ?? 0) > 0;
}

/**
 * 同一判据的纯函数形态，供**恢复路径**（`PgRunRecovery`）判断「这条库里钉 dashscope 的 run
 * 当时是不是经 deep-agent 运行时执行的」——是 ⇒ 按 deep-agent run 去读远端，而不是判 uncertain。
 */
export function executedViaKernelRuntime(input: {
  readonly modelProvider: string;
  readonly kernelServedProviders: ReadonlySet<string>;
  readonly skillCount: number;
  readonly workflowAllowlistCount: number;
}): boolean {
  if (input.modelProvider === DEEP_AGENT_PROVIDER_NAME) return true;
  return input.kernelServedProviders.has(input.modelProvider)
    && (input.skillCount > 0 || input.workflowAllowlistCount > 0);
}

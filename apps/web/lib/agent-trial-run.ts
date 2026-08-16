/**
 * `POST /agents/:agentId/trial-run`（契约 `agentRuntime.operations.trialRunAgent`）的
 * 前端薄封装——与 `lib/skill-trial-run.ts` 对模型 A skill 试跑的封装同一形状，只是
 * 换了一个契约束（`agentRuntime`，不是 `skills`）与一个必填字段（`scenario`，
 * 试跑场景描述；`trial-run-agent.ts` 头注：试跑复用的是既有 chat 执行链路里
 * 与"写回"无关的两段，不是另起一套）。
 */
import { agentRuntime } from "@repo/contracts";
import type { z } from "zod";
import { apiRequest } from "./api-client";

export type TrialRunAgentOut = z.infer<typeof agentRuntime.operations.trialRunAgent.out>;

export async function runAgentTrialRun(
  agentId: string,
  scenario: string,
): Promise<TrialRunAgentOut> {
  return apiRequest<TrialRunAgentOut>(
    agentRuntime.operations.trialRunAgent.path.replace(":agentId", encodeURIComponent(agentId)),
    { method: "POST", body: { agentId, scenario } },
  );
}

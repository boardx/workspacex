/**
 * #1911 —— Agent 详情页「能力图」的数据薄封装。
 *
 * 只读，打真实 `GET /agents/:agentId`（契约 `agentRuntime.operations
 * .getAgentCapabilityGraph`）。形状与路径全部来自 `@repo/contracts`——手写第二份
 * 就是这仓库反复栽的「同一事实声明两处」。
 */
import { agentRuntime } from "@repo/contracts";
import type { z } from "zod";
import { apiRequest } from "./api-client";

export type AgentCapabilityGraphOut = z.infer<
  typeof agentRuntime.operations.getAgentCapabilityGraph.out
>;
export type AgentSkillMount = AgentCapabilityGraphOut["skillMounts"][number];
export type AgentToolWhitelistEntry = AgentCapabilityGraphOut["toolWhitelist"][number];

function agentPath(agentId: string): string {
  return agentRuntime.operations.getAgentCapabilityGraph.path.replace(
    ":agentId",
    encodeURIComponent(agentId),
  );
}

export async function getAgentCapabilityGraph(
  agentId: string,
  sessionToken?: string,
): Promise<AgentCapabilityGraphOut> {
  return apiRequest<AgentCapabilityGraphOut>(agentPath(agentId), {
    method: "GET",
    sessionToken,
  });
}

/**
 * AG04 管理详情「角色」区块——`getAgentRoleAdmin`/`updateAgentRoleDraft` 的前端薄封装。
 * 同 `lib/agent-directory.ts`/`lib/live-agent-capability-graph.ts` 同一条纪律：不做判断，
 * 形状与路径全部来自 `@repo/contracts`，失败原样带回给调用方处理。
 */
import { agentRole } from "@repo/contracts";
import type { z } from "zod";
import { apiRequest } from "./api-client";

export type AgentRoleAdminView = z.infer<typeof agentRole.AgentRoleAdminView>;
export type AgentRoleFields = z.infer<typeof agentRole.AgentRoleFields>;

function rolePath(agentId: string): string {
  return agentRole.operations.getAgentRoleAdmin.path.replace(":agentId", encodeURIComponent(agentId));
}

export async function getAgentRoleAdmin(agentId: string): Promise<AgentRoleAdminView> {
  const out = await apiRequest<unknown>(rolePath(agentId), { method: "GET" });
  return agentRole.operations.getAgentRoleAdmin.out.parse(out);
}

export async function updateAgentRoleDraft(input: {
  readonly agentId: string;
  readonly expectedVersion: number;
  readonly patch: Partial<Omit<AgentRoleFields, "catalogSource">>;
}): Promise<AgentRoleAdminView> {
  const out = await apiRequest<unknown>(rolePath(input.agentId), {
    method: "PATCH",
    body: { agentId: input.agentId, expectedVersion: input.expectedVersion, patch: input.patch },
  });
  return agentRole.operations.updateAgentRoleDraft.out.parse(out);
}

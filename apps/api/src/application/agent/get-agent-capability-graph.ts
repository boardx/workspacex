/**
 * `getAgentCapabilityGraph`（#1911，契约 `agent-runtime.ts` `getAgentCapabilityGraph`）。
 *
 * ## 为什么没有新仓储
 *
 * `CreateAgentRepository.findForClone` 已经在读 `skill_mounts`/`tool_whitelist`
 * 两列（供复制取源用），本用例直接复用同一条读路径——不新开 SQL、不碰任何写路径。
 * 跨组织或不存在都归一成 `AGENT_NOT_FOUND`（与 `findForClone` 本身的 fail-closed
 * 语义一致：`WHERE id = $1 AND org_id = $2`，读不到就是 null，不区分「不存在」与
 * 「不是你的」——同 `pg-agent-publish-repository.ts` 头注那条一样的理由）。
 *
 * ## 为什么不额外做 ROLE_INSUFFICIENT 门
 *
 * 这是一条只读操作，读的是同一个 org 内已发布/在建的 agent 的挂载配置——与
 * `/admin/agent/[id]` 详情页本身的可见范围相同（该路由已在导航层限定为 org 内
 * 已登录用户可达）。写操作（`setAgentSkillPins`/`setToolWhitelist`）才需要 admin
 * 门，读一个已经在界面上看得到的 agent 挂了什么不需要再加一层。
 */
import type { AgentDefinition } from "../../domain/agent/definition";

export type GetAgentCapabilityGraphErrorCode = "AGENT_NOT_FOUND";

export class GetAgentCapabilityGraphError extends Error {
  constructor(readonly code: GetAgentCapabilityGraphErrorCode) {
    super(code);
    this.name = "GetAgentCapabilityGraphError";
  }
}

export interface GetAgentCapabilityGraphRepository {
  /** 复用 `CreateAgentRepository.findForClone` 同一签名——同一条读路径，不重复实现。 */
  findForClone(orgId: string, agentId: string): Promise<AgentDefinition | null>;
}

export interface GetAgentCapabilityGraphResult {
  readonly agentId: string;
  readonly name: string;
  readonly roleLabel: string;
  readonly skillMounts: AgentDefinition["skillMounts"];
  readonly toolWhitelist: AgentDefinition["toolWhitelist"];
}

export async function getAgentCapabilityGraph(
  input: { readonly orgId: string; readonly agentId: string },
  deps: { readonly repository: GetAgentCapabilityGraphRepository },
): Promise<GetAgentCapabilityGraphResult> {
  const definition = await deps.repository.findForClone(input.orgId, input.agentId);
  if (definition === null) {
    throw new GetAgentCapabilityGraphError("AGENT_NOT_FOUND");
  }
  return {
    agentId: definition.agentId,
    name: definition.name,
    roleLabel: definition.roleLabel,
    skillMounts: definition.skillMounts,
    toolWhitelist: definition.toolWhitelist,
  };
}

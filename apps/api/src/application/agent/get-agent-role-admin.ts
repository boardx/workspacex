/**
 * AG04 管理详情角色区块 —— `GET /admin/agents/:agentId/role`（契约
 * `agentRole.operations.getAgentRoleAdmin`，契约束 agent-role UC-4，requirements
 * 03-agent-role.md R8）。授权门与 `update-agent-role-draft.ts` 逐字同一条
 * （org admin 才能读角色区块——同一份数据 GET/PATCH 用同一道门，不留「读比写松」的缺口）。
 *
 * `toolPolicy` 取自已发布版本（`agent_versions.tool_policy`，导入时冻结，草稿编辑不改它）；
 * 没有已发布版本 ⇒ 空数组。`capabilityReadiness` 与 `list-agent-directory.ts` 头注同一条
 * 「诚实退化」：分类 × 已授权工具的地基（WS04）本轮未落地，这里不假装查得出
 * ready/missing 的区分，每个 toolPolicy 分类一律给 `unknown`、`grantedToolNames: []`、
 * `isWrite: false`。地基落地后换成真实比对，返回形状不用跟着改。
 */
import type { AgentRoleDraftRepository, AgentRoleAdminViewT } from "./update-agent-role-draft";
import type { IdentityRepository } from "../identity/ports";
import { toOrgId } from "../../domain/org-id";
import { isRoleEditable } from "../../domain/agent/role-draft";
import { deriveCapabilityReadiness } from "./update-agent-role-draft";

export type GetAgentRoleAdminErrorCode = "ROLE_INSUFFICIENT" | "AGENT_NOT_FOUND";

export class GetAgentRoleAdminError extends Error {
  constructor(readonly code: GetAgentRoleAdminErrorCode) {
    super(code);
    this.name = "GetAgentRoleAdminError";
  }
}

export async function getAgentRoleAdmin(
  input: { readonly orgId: string; readonly actorId: string; readonly agentId: string },
  deps: { readonly identities: IdentityRepository; readonly repository: AgentRoleDraftRepository },
): Promise<AgentRoleAdminViewT> {
  const membership = await deps.identities.findOrgMembership(input.actorId, toOrgId(input.orgId));
  if (!membership || membership.orgRole !== "admin") throw new GetAgentRoleAdminError("ROLE_INSUFFICIENT");

  const current = await deps.repository.find(input.orgId, input.agentId);
  if (current === null) throw new GetAgentRoleAdminError("AGENT_NOT_FOUND");

  const toolPolicy = current.toolPolicy ?? [];
  return {
    agentId: input.agentId,
    draft: current.draft,
    published: current.published,
    editable: isRoleEditable(current.draft),
    toolPolicy: [...toolPolicy],
    capabilityReadiness: deriveCapabilityReadiness(toolPolicy),
    version: current.version,
  };
}

/**
 * AG01 `updateAgentRoleDraft`（`PATCH /admin/agents/:agentId/role`，契约
 * `packages/contracts/src/agent-role.ts`，契约束 agent-role UC-1）。
 *
 * 顺序：① 组织管理员门（同 set-agent-role-label.ts 逐字同一条门槛）→ ② 读草稿 →
 * ③ domain `decideRoleDraftPatch`（官方锁 / 并发号 / 契约校验）→ ④ 条件写（并发号 + org 目录来源
 * 在 WHERE 里再判一次，窗口内被改 ⇒ VERSION_CHANGED）。发布不在这里：走既有发布路径，
 * 由 `infrastructure/agent/agent-version-insert.ts` 把草稿 7 列冻结进 `agent_versions`。
 *
 * `toolPolicy` / `capabilityReadiness` 属 AG02/AG04（能力分类与就绪性），本用例返回空数组，
 * 不编造就绪状态。
 */
import type { agentRole } from "@repo/contracts";
import type { z } from "zod";
import type { IdentityRepository } from "../identity/ports";
import { toOrgId } from "../../domain/org-id";
import type { AgentRoleFieldsT } from "../../domain/agent/definition";
import { decideRoleDraftPatch, isRoleEditable, type RoleDraftPatch } from "../../domain/agent/role-draft";

export type AgentRoleAdminViewT = z.infer<typeof agentRole.AgentRoleAdminView>;

export type UpdateAgentRoleDraftErrorCode =
  | "ROLE_INSUFFICIENT"
  | "AGENT_NOT_FOUND"
  | "OFFICIAL_ROLE_FIELDS_LOCKED"
  | "VERSION_CHANGED"
  | "VALIDATION_FAILED";

export class UpdateAgentRoleDraftError extends Error {
  constructor(readonly code: UpdateAgentRoleDraftErrorCode) {
    super(code);
    this.name = "UpdateAgentRoleDraftError";
  }
}

export interface AgentRoleDraftState {
  readonly draft: AgentRoleFieldsT;
  readonly published: AgentRoleFieldsT | null;
  readonly version: number;
}

export interface AgentRoleDraftRepository {
  find(orgId: string, agentId: string): Promise<AgentRoleDraftState | null>;
  /** 条件写：`role_draft_version = expectedVersion AND catalog_source = 'org'`；0 行 ⇒ null。 */
  save(input: {
    readonly orgId: string;
    readonly agentId: string;
    readonly expectedVersion: number;
    readonly fields: AgentRoleFieldsT;
  }): Promise<{ readonly version: number } | null>;
}

export const AGENT_ROLE_DRAFT_REPOSITORY = Symbol("AgentRoleDraftRepository");

export async function updateAgentRoleDraft(
  input: {
    readonly orgId: string;
    readonly actorId: string;
    readonly agentId: string;
    readonly expectedVersion: number;
    readonly patch: RoleDraftPatch;
  },
  deps: { readonly identities: IdentityRepository; readonly repository: AgentRoleDraftRepository },
): Promise<AgentRoleAdminViewT> {
  /* ① 授权门，必须最先。 */
  const membership = await deps.identities.findOrgMembership(input.actorId, toOrgId(input.orgId));
  if (!membership || membership.orgRole !== "admin") {
    throw new UpdateAgentRoleDraftError("ROLE_INSUFFICIENT");
  }

  const current = await deps.repository.find(input.orgId, input.agentId);
  if (current === null) throw new UpdateAgentRoleDraftError("AGENT_NOT_FOUND");

  const decision = decideRoleDraftPatch(
    { fields: current.draft, version: current.version }, input.expectedVersion, input.patch,
  );
  if (!decision.ok) throw new UpdateAgentRoleDraftError(decision.reason);

  const saved = await deps.repository.save({
    orgId: input.orgId, agentId: input.agentId, expectedVersion: input.expectedVersion, fields: decision.fields,
  });
  if (saved === null) throw new UpdateAgentRoleDraftError("VERSION_CHANGED");

  return {
    agentId: input.agentId,
    draft: decision.fields,
    published: current.published,
    editable: isRoleEditable(decision.fields),
    toolPolicy: [],
    capabilityReadiness: [],
    version: saved.version,
  };
}

/**
 * `SetOrgMemberRole`（member-role-management delta，组织级）—— 编排。
 *
 * 授权面与 `removeOrgMember` 同一条：调用者必须是**本组织** admin（controller 已确认
 * 成员资格并读出 `actorOrgRole`，这里再判一次 admin——两处各判一次，不共用更宽的判定）。
 * 判定「能不能改」（最后一名 admin）在 domain `decideOrgRoleChange`，由仓储在同一事务里
 * 套用；本文件只做码的映射与审计留痕。
 *
 * 审计：成功（含幂等重放）后写一条 `role-changed`（target = `membership`，
 * id = `${orgId}:${userId}`，与 `change-project-role.ts` 的 `${projectId}:${userId}` 同形），
 * `detail` 带前后值与 `layer: "organization"`——`role-changed` 是组织角色与项目角色共用的
 * 类型（契约枚举注释逐字），没有 `layer` 就分不清这条改的是哪一层。
 */
import type { OrgId } from "../../domain/org-id";
import type { OrgRoleValue } from "../../domain/auth/org-role-change";
import { OrgAdminError } from "./org-invite-errors";
import type { OrgMemberRepository } from "./org-member-ports";
import type { ProvenanceWriter } from "../provenance/ports";

export interface SetOrgMemberRoleDeps {
  readonly repo: OrgMemberRepository;
  readonly provenance: ProvenanceWriter;
}

export interface SetOrgMemberRoleInput {
  readonly orgId: OrgId;
  readonly actorId: string;
  readonly actorOrgRole: string;
  readonly userId: string;
  readonly orgRole: OrgRoleValue;
}

export interface SetOrgMemberRoleOutput {
  readonly userId: string;
  readonly orgRole: OrgRoleValue;
  readonly previousOrgRole: OrgRoleValue;
}

export async function setOrgMemberRole(
  deps: SetOrgMemberRoleDeps,
  input: SetOrgMemberRoleInput,
): Promise<SetOrgMemberRoleOutput> {
  if (input.actorOrgRole !== "admin") throw new OrgAdminError("PROJECT_ROLE_INSUFFICIENT");

  const result = await deps.repo.changeRole(input.orgId, input.userId, input.orgRole);
  if (!result.ok) {
    throw new OrgAdminError(result.reason === "not-found" ? "MEMBER_NOT_FOUND" : "LAST_ADMIN");
  }

  if (result.changed) {
    await deps.provenance.append({
      orgId: input.orgId,
      type: "role-changed",
      actorId: input.actorId,
      target: { kind: "membership", id: `${input.orgId}:${input.userId}` },
      detail: {
        layer: "organization",
        userId: input.userId,
        from: result.previousOrgRole,
        to: input.orgRole,
        // 同一个人改自己的角色也留痕——「自降」是放权，审计要能看出是谁放的。
        self: input.actorId === input.userId,
      },
    });
  }

  return { userId: input.userId, orgRole: input.orgRole, previousOrgRole: result.previousOrgRole };
}

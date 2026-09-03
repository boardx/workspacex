/**
 * `SetPlatformMemberOrgRole`（member-role-management delta，平台级）—— 编排。
 *
 * 与组织级 `auth/set-org-member-role.ts` 的差别**只有授权面**（平台超管，在 guard 里判完）
 * 与「目标组织必须是可管理的正式组织」这一道前置；落库与「最后一名 admin」判定走的是
 * 同一个 `OrgMemberRepository.changeRole`。
 *
 * ⚠ `isManagedOrg` 为 false 与「成员行不存在」都折成 `MEMBER_NOT_FOUND`：本地组织
 *   「对任何他人不可见，包括平台运营」（identity F16），一个专属码会把它的存在性泄露出去。
 *
 * 审计：写进**目标组织**的 provenance（`orgId` 是目标组织），`detail.layer = "organization"`
 * 与组织级同形，另加 `via: "platform"`——那个组织的 admin 查审计时要看得出这条改动不是
 * 本组织的人做的。`actorId` 是超管本人的 userId，不是一个假的系统身份。
 */
import type { OrgId } from "../../domain/org-id";
import type { OrgRoleValue } from "../../domain/auth/org-role-change";
import type { OrgMemberRepository } from "../auth/org-member-ports";
import type { ProvenanceWriter } from "../provenance/ports";
import type { PlatformMemberRepository } from "./platform-member-ports";
import { PlatformMembersError } from "./platform-members-errors";

export interface SetPlatformMemberOrgRoleDeps {
  readonly platform: PlatformMemberRepository;
  readonly members: OrgMemberRepository;
  readonly provenance: ProvenanceWriter;
}

export interface SetPlatformMemberOrgRoleInput {
  readonly actorId: string;
  readonly orgId: OrgId;
  readonly userId: string;
  readonly orgRole: OrgRoleValue;
}

export interface SetPlatformMemberOrgRoleOutput {
  readonly userId: string;
  readonly orgId: string;
  readonly orgRole: OrgRoleValue;
  readonly previousOrgRole: OrgRoleValue;
}

export async function setPlatformMemberOrgRole(
  deps: SetPlatformMemberOrgRoleDeps,
  input: SetPlatformMemberOrgRoleInput,
): Promise<SetPlatformMemberOrgRoleOutput> {
  if (!(await deps.platform.isManagedOrg(input.orgId))) throw new PlatformMembersError("MEMBER_NOT_FOUND");

  const result = await deps.members.changeRole(input.orgId, input.userId, input.orgRole);
  if (!result.ok) {
    throw new PlatformMembersError(result.reason === "not-found" ? "MEMBER_NOT_FOUND" : "LAST_ADMIN");
  }

  if (result.changed) {
    await deps.provenance.append({
      orgId: input.orgId,
      type: "role-changed",
      actorId: input.actorId,
      target: { kind: "membership", id: `${input.orgId}:${input.userId}` },
      detail: {
        layer: "organization",
        via: "platform",
        userId: input.userId,
        from: result.previousOrgRole,
        to: input.orgRole,
      },
    });
  }

  return {
    userId: input.userId,
    orgId: input.orgId,
    orgRole: input.orgRole,
    previousOrgRole: result.previousOrgRole,
  };
}

/**
 * 平台级成员名册的真实 API 薄封装（契约 `platformMembers`，member-role-management delta +
 * platform-admin-role delta）。
 *
 * 类型走 `z.infer`——不重新声明字段名（`lint-contract-source` 要求）。
 *
 * ⚠ 前两条（list / setOrgRole）对**平台超管或平台管理员**放行；后两条
 *   （grant/revokePlatformAdmin）**只对平台超管**放行——都会用同一个 403
 *   `NOT_PLATFORM_SUPERUSER` 表达"不够格"，但够格的门槛不同，见契约文件头。
 *   `PlatformMembersScreen` 据此把整块屏渲染成「仅平台运维可见」的说明，而不是当成
 *   失败态（同旧 `feedback-screen.tsx` 系统异常区的处置——该文件已随 B3.6 旧屏退役删除）。
 */
import { identity, platformMembers } from "@repo/contracts";
import type { z } from "zod";
import { apiRequest } from "./api-client";

export type PlatformMemberRow = z.infer<typeof platformMembers.PlatformMemberRow>;
export type PlatformMembershipRow = z.infer<typeof platformMembers.PlatformMembershipRow>;
export type ListPlatformMembersOut = z.infer<typeof platformMembers.operations.listPlatformMembers.out>;
export type SetPlatformMemberOrgRoleOut = z.infer<typeof platformMembers.operations.setPlatformMemberOrgRole.out>;
export type GrantPlatformAdminOut = z.infer<typeof platformMembers.operations.grantPlatformAdmin.out>;
export type RevokePlatformAdminOut = z.infer<typeof platformMembers.operations.revokePlatformAdmin.out>;

function path(template: string, params: Record<string, string>): string {
  return Object.entries(params).reduce(
    (acc, [k, v]) => acc.replace(`:${k}`, encodeURIComponent(v)),
    template,
  );
}

export async function listPlatformMembers(): Promise<ListPlatformMembersOut> {
  return apiRequest<ListPlatformMembersOut>(platformMembers.operations.listPlatformMembers.path, { method: "GET" });
}

export async function setPlatformMemberOrgRole(
  userId: string,
  orgId: string,
  orgRole: z.infer<typeof identity.OrgRole>,
): Promise<SetPlatformMemberOrgRoleOut> {
  return apiRequest<SetPlatformMemberOrgRoleOut>(
    path(platformMembers.operations.setPlatformMemberOrgRole.path, { userId, orgId }),
    { method: "PATCH", body: { userId, orgId, orgRole } },
  );
}

/** 只有真正的平台超管能调——平台管理员自己不能把别人（或自己）也设成平台管理员。 */
export async function grantPlatformAdmin(userId: string): Promise<GrantPlatformAdminOut> {
  return apiRequest<GrantPlatformAdminOut>(
    path(platformMembers.operations.grantPlatformAdmin.path, { userId }),
    { method: "POST", body: { userId } },
  );
}

/** 同上，撤销。 */
export async function revokePlatformAdmin(userId: string): Promise<RevokePlatformAdminOut> {
  return apiRequest<RevokePlatformAdminOut>(
    path(platformMembers.operations.revokePlatformAdmin.path, { userId }),
    { method: "DELETE", body: { userId } },
  );
}

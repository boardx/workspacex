/**
 * 平台级成员名册的真实 API 薄封装（契约 `platformMembers`，member-role-management delta）。
 *
 * 类型走 `z.infer`——不重新声明字段名（`lint-contract-source` 要求）。
 *
 * ⚠ 两条接口都只对**平台超管**放行（见契约文件头）：非超管账号调用会收到 403
 *   `NOT_PLATFORM_SUPERUSER`——`PlatformMembersScreen` 据此把整块屏渲染成「仅平台运维
 *   可见」的说明，而不是当成失败态（同 `feedback-screen.tsx` 系统异常区的处置）。
 */
import { identity, platformMembers } from "@repo/contracts";
import type { z } from "zod";
import { apiRequest } from "./api-client";

export type PlatformMemberRow = z.infer<typeof platformMembers.PlatformMemberRow>;
export type PlatformMembershipRow = z.infer<typeof platformMembers.PlatformMembershipRow>;
export type ListPlatformMembersOut = z.infer<typeof platformMembers.operations.listPlatformMembers.out>;
export type SetPlatformMemberOrgRoleOut = z.infer<typeof platformMembers.operations.setPlatformMemberOrgRole.out>;

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

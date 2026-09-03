/**
 * `PlatformMemberRepository` —— 平台级成员名册（member-role-management delta）的唯一读端口。
 *
 * ## 为什么没有「写」方法
 *
 * 平台级改角色落库走的是 `OrgMemberRepository.changeRole`（`auth/org-member-ports.ts`）——
 * 与组织级同一个方法、同一条「最后一名 admin」判定。本端口只多一个问题要回答：
 * 「这个 orgId 是不是一个可由平台管理的正式组织」（`isManagedOrg`），本地组织与平台组织
 * 在这里答 false，调用方把它折成 `MEMBER_NOT_FOUND`（不泄露本地组织的存在性，
 * 见契约文件头）。
 *
 * ## 名册怎么读：只走既有的披露面，不开新的
 *
 * 全平台名册天然跨租户，而 `org_memberships`/`organizations` 都是 FORCE RLS。
 * 实现**没有**新造一个返回全表的 SECURITY DEFINER 函数（那会给任何借 `app_rw` 连接
 * 跑 SQL 的东西一条整表读路径，见 `20260902012105_error_logs_admin_read_grant.sql`
 * 记录的三次教训），而是把三条**已经存在**的读拼起来：
 *   ① `credentials`（无租户表，`app_rw` 本就可读）→ 全部账号；
 *   ② `kernel_user_org_ids(user_id)`（0010，一人一次、只回 id 与角色）→ 每人在哪些组织；
 *   ③ `withTenant(orgId)` 下读该组织的名字/kind 与成员行（team_id / joined_at）。
 * 没有一条是本 delta 新开的暴露面。代价是按人、按组织多跑几次查询——这是运维名册，
 * 不是热路径。
 */
import type { OrgRoleValue } from "../../domain/auth/org-role-change";
import type { OrgId } from "../../domain/org-id";

export interface PlatformMembershipListRow {
  readonly orgId: string;
  readonly orgName: string;
  readonly orgRole: OrgRoleValue;
  readonly teamId: string | null;
  readonly joinedAt: string;
}

export interface PlatformMemberListRow {
  readonly userId: string;
  readonly displayName: string;
  readonly email: string;
  readonly emailVerified: boolean;
  readonly createdAt: string;
  /** 只含 `kind = "organization"` 的成员身份——本地组织与平台组织在这一层就已经滤掉。 */
  readonly memberships: readonly PlatformMembershipListRow[];
}

export interface PlatformMemberRepository {
  listAll(): Promise<readonly PlatformMemberListRow[]>;
  /** `organizations.kind === "organization"` 且该行存在。本地组织 / 平台组织 / 不存在 ⇒ false。 */
  isManagedOrg(orgId: OrgId): Promise<boolean>;
}

export const PLATFORM_MEMBER_REPOSITORY = Symbol("PlatformMemberRepository");

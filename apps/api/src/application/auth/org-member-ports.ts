/**
 * `OrgMemberRepository` —— F11 `RemoveOrgMember`（O-29 ②）的唯一持久化端口。
 *
 * ## 为什么会话吊销**不在**这个端口里
 *
 * I-8 要求「吊销会话、作废邀请、释放配额三件」都发生，但会话活在 Redis
 * （`SessionTokenStore`），DB 事务管不到它——这与 `completePasswordReset` 同一处境
 * （见 `password-reset.ts`）：DB 侧（作废邀请 + 释放配额，靠删除成员行本身）在一个
 * PostgreSQL 事务里；会话吊销是用例层紧接着调用的**第二步**，不是假装成同一个事务。
 * 两步之间若中途失败：DB 已提交（成员确实被移除），会话吊销重试是安全的
 * （`revokeAllForUser` 对已吊销的会话本就不重复计数）——这一步允许"最终一致"，
 * 而 DB 内部那步（删成员行 + 转 revoked 邀请）不允许，所以它们不是同一件事。
 *
 * ## 为什么没有「已离职名册」表
 *
 * I-8 的断言面只有三条：会话吊销、pending 邀请转 revoked、历史产出的 `authorId` 不变。
 * 第三条**不需要写任何新东西**——不删 `credentials` 行、不碰 artifacts/provenance，
 * 「产出的作者是谁」这件事从未在这里存过第二份，所以也不需要在这里保住它。
 * 界面上的「已离职」标记是一个**投影**（org_memberships 里找不到但 credentials 里
 * 还找得到的用户），不是本端口要产出的数据形状——它没有专属契约字段
 * （`removeOrgMember.out` 里也没有），留给接 UI 的人做，不在这里发明一张表。
 */
import type { OrgId } from "../../domain/org-id";
import type { OrgRoleValue } from "../../domain/auth/org-role-change";

/**
 * `changeRole` 的结果（member-role-management delta）。
 * `not-found`：这个 `(orgId, userId)` 没有成员行——调用方映射成 `MEMBER_NOT_FOUND`。
 * `last-admin`：`decideOrgRoleChange` 拒绝了——调用方映射成 `LAST_ADMIN`。
 * `ok` 且 `changed = false`：幂等重放（改成同一个角色），不是错误。
 */
export type ChangeOrgMemberRoleResult =
  | { readonly ok: true; readonly previousOrgRole: OrgRoleValue; readonly changed: boolean }
  | { readonly ok: false; readonly reason: "not-found" | "last-admin" };

export interface RemoveOrgMemberResult {
  /** false = 这一行本来就不存在（幂等重放：上一次调用已经删过），不是错误。 */
  readonly removed: boolean;
  /** 该成员名下被转 `revoked` 的未接受邀请数（I-8：其全部 `pending` 邀请转 revoked）。 */
  readonly revokedInvites: number;
}

export interface OrgMemberRepository {
  /**
   * 一次事务：DELETE `org_memberships` 该行（RETURNING 判断是否真的删到）→
   * 若删到，UPDATE 该用户邮箱名下 `status = 'pending'` 的 `org_invites` 为 `revoked`。
   *
   * ⚠ 两步在同一事务：中途失败则成员行还在、邀请也未被动——不产生「访问已停用但
   * 还有一条邀请链接能把他重新拉回来」的半成品状态。
   */
  remove(orgId: OrgId, userId: string): Promise<RemoveOrgMemberResult>;

  /**
   * 一次事务：锁住该组织的 admin 行与目标行 → 用 `decideOrgRoleChange`（domain）判定 →
   * UPDATE `org_memberships.org_role`。
   *
   * ⚠ 判定与写入必须在同一事务、且先锁后数：两名 admin 同时互相降级，各自在事务外数到
   *   「还有另一个 admin」，提交后组织就没有 admin 了。锁住 admin 行让第二个事务等到
   *   第一个提交后再数，数到的就是 1。
   * ⚠ 组织级与平台级两条路由都调这一个方法——判定只有一份。
   */
  changeRole(orgId: OrgId, userId: string, nextRole: OrgRoleValue): Promise<ChangeOrgMemberRoleResult>;
}

export const ORG_MEMBER_REPOSITORY = Symbol("OrgMemberRepository");

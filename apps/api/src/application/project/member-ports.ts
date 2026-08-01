/**
 * F125 UC-P9 `addProjectMember` / `changeProjectRole` / `removeProjectMember` 的仓储端口。
 *
 * ⚠ **故意不是 `ProjectRepository`（F117）或 `ProjectArchiveRepository`（F124）的又一个
 * 方法**：理由与 F119/F122/F123/F124 那几条端口分裂完全同型（见 `ports.ts` 里那几条
 * 「故意不是 …的第 N 个方法」的注释）——本文件写的是 `project_memberships`，不是
 * `projects`，各自的 `lint-permission-paths` 豁免各自成立，混进同一个文件会让互不相关的
 * 断言绑在一起。
 *
 * ## `addMember` 是 INSERT，`changeRole` 是 UPDATE —— 契约自己说的
 *
 * `packages/contracts/src/project.ts` 的 `changeProjectRole` 头注逐字：
 * 「一人一项目**恰好一个**角色（主键 `(userId, projectId)`），所以这里是「改」不是「加」」。
 * 两个方法因此不能合并成一个 upsert：合并之后「本来就没有这个人」与「这个人已经在场，
 * 只是改角色」会共用同一条 SQL 语句，而契约要求它们是两个不同的操作（不同的 HTTP 方法、
 * 不同的失败面）。
 *
 * ## PROJECT_ARCHIVED 的判定，三个方法各不相同——这不是疏漏
 *
 * `pg-project-archive-repository.ts` 文件头立下的规矩是「冻结不在仓储里重复判断，
 * 那是迁移 `20260801120000_f124_*.sql` 的 RESTRICTIVE 策略的工作」。但那条规矩的前提是
 * 「策略拒绝时会抛出一个可捕获的异常」——这对 INSERT/UPDATE 成立（冻结策略挂在
 * `WITH CHECK` 上，新行不满足时 Postgres 抛 `42501`），对 DELETE **不成立**：
 * F124 的冻结策略对 DELETE 挂的是 `USING`，而 `USING` 只是**过滤要删的行**，不满足时
 * Postgres 静默返回「删了 0 行」，不抛任何异常（`tests/project/archive-readonly-and-
 * readable.test.ts` 对 `groups` 表 DELETE 的断言就是 `rowCount` 为 0，不是 `rejects.toThrow`）。
 * ⇒ `addMember`/`changeRole` 让写入直接撞策略、捕获异常翻译成 `archived`；
 *   `removeMember` 必须在 DELETE 之前显式读一次容器状态，否则「已归档」与
 *   「这个人根本不是成员」在 DELETE 的返回值里长得一模一样。
 */
import type { OrgId } from "../../domain/org-id";
import type { ProjectRole } from "../../domain/identity/roles";

export interface ProjectMembershipSnapshot {
  readonly projectId: string;
  readonly userId: string;
  readonly projectRole: ProjectRole;
  readonly isHost: boolean;
  readonly groupId: string | null;
}

export interface AddMemberCommand {
  readonly orgId: OrgId;
  readonly projectId: string;
  readonly userId: string;
  readonly projectRole: ProjectRole;
  readonly isHost: boolean;
  readonly groupId: string | null;
}

export type AddMemberOutcome =
  | { readonly kind: "added"; readonly row: ProjectMembershipSnapshot }
  /** 容器不存在（外键冲突，`23503`）。同 `archiveProject` 先例：不额外暴露存在性。 */
  | { readonly kind: "not-found" }
  /** 容器已归档（`42501`/`row-level security` —— 见文件头）。 */
  | { readonly kind: "archived" }
  /**
   * 主键冲突（`23505`）：这个人在这个项目里已经有一行。
   * ⚠ 契约的 `addProjectMember.err` 没有为这个情形命名任何码——见
   * `application/project/errors.ts` 的 `ProjectMemberAlreadyExistsError` 文件头，
   * 同 `KNOWN_CONTRACT_GAPS.P7`（U-2⑵ 那条「故意没有命名失败码」）同一处理方式。
   */
  | { readonly kind: "already-member" };

export interface ChangeRoleCommand {
  readonly orgId: OrgId;
  readonly projectId: string;
  readonly userId: string;
  readonly projectRole: ProjectRole;
  readonly isHost: boolean;
}

export type ChangeRoleOutcome =
  | { readonly kind: "changed"; readonly row: ProjectMembershipSnapshot }
  /** 容器不存在，或这个人在这个项目里本来就没有成员行——两者不可区分，同上一条理由。 */
  | { readonly kind: "not-found" }
  | { readonly kind: "archived" };

export interface RemoveMemberCommand {
  readonly orgId: OrgId;
  readonly projectId: string;
  readonly userId: string;
}

export type RemoveMemberOutcome =
  | { readonly kind: "removed" }
  | { readonly kind: "not-found" }
  | { readonly kind: "archived" };

export interface ProjectMembershipRepository {
  addMember(cmd: AddMemberCommand): Promise<AddMemberOutcome>;
  changeRole(cmd: ChangeRoleCommand): Promise<ChangeRoleOutcome>;
  removeMember(cmd: RemoveMemberCommand): Promise<RemoveMemberOutcome>;
}

export const PROJECT_MEMBERSHIP_REPOSITORY = Symbol("ProjectMembershipRepository");

/* ═══════════════ inviteToken 身份来源解析（Q-4① 裁 B 的「差别只在身份来源」那一半） ═══════════════ */

/**
 * `addProjectMember.in.subject.kind === "inviteToken"` 时，`ref` 是一枚令牌，不是 userId。
 * 把令牌换成 userId + 服务端记录的授予值，是**这个端口**的职责，不是应用用例自己去连表。
 *
 * ## 为什么复用 F15 的 `invite_links` 而不是重新设计一套项目级邀请
 *
 * UC-00.3 文件头写得很直接：「本 UC 不重新设计邀请链接，它引用 UC-1.3/UC-1.2/UC-1.6 的
 * 结论」。F15（`invite_links` 表 + `consumeInviteLink` 用例）已经实现了「令牌 → 服务端
 * 记录的授予值」这一步，且其头注明确留白：「这里只到『令牌换到一份服务端记录的授予值』
 * 为止……谁拿它去建什么是下一个 feature 的事」。F125 正是那个「下一个 feature」。
 *
 * ⚠ 但本解析器**不**直接调用 `consumeInviteLink`（那会引入 `project` 束对 `auth` 束
 *   应用层的运行时依赖，本仓迄今没有这类跨束调用的先例）。改为只读 `invite_links` 本身：
 *   要求 `used_by IS NOT NULL`——即该令牌**已经**被 01-auth 现有的核销路径核销过，
 *   `used_by` 就是核销者的身份。这样 F125 不重做核销判定（有效期/撤销/单次名额的四态
 *   仍然只由 F15 的 `consume()` 决定），只是在核销**之后**把那份已经写定的授予值
 *   接到本束的「加人」这个共用用例上。
 */
export interface ResolvedInviteGrant {
  readonly userId: string;
  readonly projectId: string;
  readonly projectRole: ProjectRole;
  readonly groupId: string | null;
}

export interface MemberSubjectResolver {
  /** 令牌不存在，或还没被核销（`used_by IS NULL`）时返回 `null`。 */
  resolveInviteToken(orgId: OrgId, token: string): Promise<ResolvedInviteGrant | null>;
}

export const MEMBER_SUBJECT_RESOLVER = Symbol("MemberSubjectResolver");

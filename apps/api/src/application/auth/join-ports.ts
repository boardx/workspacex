/**
 * `JoinRepository` —— F12（UC-1.2）的持久化端口。
 *
 * ## 为什么「进场」是一个方法而不是「查令牌 + 查名单 + 建身份」三个方法
 *
 * I-19 要求「令牌有效 ∧ 手机号在本场名单内」两个条件同时判定，且 usecases.md
 * 逐字「部分成功：**禁止** —— 建身份 + 授项目角色 + 写到场状态在同一事务」。
 * 拆成三个方法，调用方就必然写成「查一下、查一下、再写」的形状，
 * 而这正是 `pg-invite-link-repository.ts` 文件头反复强调的坑：
 * 拆开的判定点之间会有一条谁也没测到的缝，两路并发在缝隙里各自看到「还没被占用」。
 * ⇒ 判定 + 写入是**一次事务里的一个方法**，缝隙不存在。
 *
 * ## 为什么 `groupId` 出现在输出而不是输入
 *
 * I-20：落地的 `groupId` **恒取名单条目的 `groupId`**，与链接里的组号无关。
 * 调用方（`join-by-group-link.ts`）不需要、也不被允许决定落地组号——
 * 决定权在仓储读到的名单行，输出即结论。
 *
 * ## 这里**没有**「已是组织成员免登」分支
 *
 * usecases.md 把它写进了同一个用例，但它的凭据来源（`existingSessionId`）
 * 指向 phase-00 的 `SessionTokenStore`——那是一个**不同的存储**（登录态挂在
 * Redis/会话表，见 `login.ts` 的注释），不是这张事务能一起打开的第二张表。
 * 把它塞进同一个方法会让这里出现「一半事务在 Postgres、一半状态在别的存储」的假原子性。
 * ⇒ 本轮只交付访客（令牌 + 名单）分支；免登分支登记为已知缺口，
 *   见 `join-by-group-link.ts` 文件头。
 */
import type { ProjectRoleValue } from "../../domain/auth/invite-link";
import type { OrgId } from "../../domain/org-id";

export interface JoinByGroupLinkAttempt {
  readonly token: string;
  /** 已规范化（`upsertParticipantRoster` 用的同一个 `normalizePhone`）。 */
  readonly phone: string;
  /** 若本次需要新建身份，仓储用这个 id；命中既有身份时**不用它**（返回既有 id）。 */
  readonly candidateGuestIdentityId: string;
  readonly now: Date;
}

export interface JoinGrant {
  readonly guestIdentityId: string;
  readonly orgId: OrgId;
  readonly projectId: string;
  readonly groupId: string;
  readonly projectRole: ProjectRoleValue;
  readonly alias: string;
  /** true = 打开的是别组链接，实际落地组号与链接自带组号不同（AC3）。 */
  readonly redirectedFromLinkGroup: boolean;
  /** true = 命中既有 `GuestIdentity`，本次未新建（幂等重放，I-19 逐字）。 */
  readonly reusedIdentity: boolean;
}

export type JoinByGroupLinkOutcome =
  | { readonly ok: true; readonly grant: JoinGrant }
  /**
   * ⚠ 四种情形分得开，与 `ConsumeInviteLinkResult` 同一条理由：
   *   给参与者的响应由 interface 合并成「找引导师重发」（契约 E1），
   *   但仓储这一层不做这个合并——合并早了，管理面/日志就再也拿不到区别。
   */
  | {
      readonly ok: false;
      readonly reason: "not-found" | "revoked" | "expired" | "used" | "phone-not-on-roster";
    };

export interface JoinRepository {
  joinByGroupLink(input: JoinByGroupLinkAttempt): Promise<JoinByGroupLinkOutcome>;
}

export const JOIN_REPOSITORY = Symbol("JoinRepository");

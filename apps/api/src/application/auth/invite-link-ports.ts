/**
 * `InviteLinkRepository` / `ParticipantRosterRepository` —— F15（UC-1.3）的持久化端口。
 *
 * ## 为什么「签发」是一个方法而不是「查一下再插一条」
 *
 * 契约要求幂等：「同 (projectId, kind, groupId, identity, validity) 返回**同一条**有效链接」。
 * 拆成 `find` + `create` 两个方法，调用方就必然写成先查后插，而两名引导师同时点
 * [生成链接] 时两路都查到「没有」、两路都插入成功——两条链接同时可用，
 * 于是「单条撤销」撤掉的是其中一条，另一条还开着。没有任何报错。
 * ⇒ 幂等是**一次写**的性质，交给数据库的部分唯一索引（迁移 0025）。
 *
 * ## 为什么「核销」是一个方法而不是「读一下再标记」
 *
 * I-11：一次性链接被用过即失效，且 `usedBy` 记录使用者。「读出来看看还没被用过，
 * 然后标记成已用」在并发下两路都读到「没被用过」——两个人同时用同一条一次性链接，
 * 两人都进场，`used_by` 是后写的那一个。条件 UPDATE（`WHERE used_at IS NULL`）
 * 的受影响行数是唯一能证明「恰好一次」的东西。
 *
 * ## 撤销为什么带 `linkId: null` 这个分支而不是两个方法
 *
 * 契约 `revokeInviteLink` 的 `in` 就是 `{ projectId, linkId: string | null }`，
 * 逐字写着「一个操作两个语义」。拆成两个方法，`[重置全部]` 与「单条撤销」
 * 的**返回形状**就会各自演化，而 `out.onsiteSessions` 那句「已在场的 N 人不会被踢出」
 * 两边必须是同一个数。
 */
import type {
  InviteLinkKind,
  InviteLinkValidity,
  ProjectRoleValue,
} from "../../domain/auth/invite-link";
import type { OrgId } from "../../domain/org-id";
import type { Guarded } from "../security/permission-filter";

/* ─────────────────────────── 签发 ─────────────────────────── */

export interface IssueInviteLinkInput {
  readonly linkId: string;
  readonly orgId: OrgId;
  readonly projectId: string;
  readonly actorId: string;
  readonly kind: InviteLinkKind;
  readonly groupId: string | null;
  /** 已由 `projectRoleOf` 从身份四选换算过；仓储不再换一次（换算只有一处）。 */
  readonly projectRole: ProjectRoleValue;
  readonly validity: InviteLinkValidity;
  readonly token: string;
  /** null = 该条不配邀请码（分组链接）。 */
  readonly inviteCode: string | null;
  /** 由 `linkExpiresAt` 算好；`once` 恒为 null（迁移里有 CHECK 兜底）。 */
  readonly expiresAt: Date | null;
  readonly now: Date;
}

export interface IssuedInviteLink {
  readonly linkId: string;
  readonly token: string;
  readonly inviteCode: string | null;
  /**
   * 命中了既有的在世链接，本次**没有**新签一条。
   *
   * ⚠ 与 F10 的重放不同，这里**照样返回令牌**：契约的 `out.token` 是 `z.string().min(1)`，
   *   非空。引导师重开面板就是要再看一次那条链接的二维码——它本来就展示在他自己屏幕上，
   *   而 `pre` 已经把调用者限定成本项目的引导师。F10 那边不返回令牌，是因为那条路径上
   *   任意一名管理员都能凭「再邀一次」读出别人的激活链接，两者的暴露面不同。
   */
  readonly replayed: boolean;
}

/* ─────────────────────────── 核销 ─────────────────────────── */

export interface ConsumeInviteLinkInput {
  readonly token: string;
  /** 使用者。正式账号与免注册身份共用同一套操作者标识空间（domain.md `GuestIdentity`）。 */
  readonly principalId: string;
  readonly now: Date;
}

export interface InviteLinkGrant {
  readonly linkId: string;
  readonly orgId: OrgId;
  readonly projectId: string;
  readonly groupId: string | null;
  /** **服务端记录值**。`?r=` 是展示层参数，与它无关。 */
  readonly projectRole: ProjectRoleValue;
}

export type ConsumeInviteLinkResult =
  | { readonly ok: true; readonly grant: InviteLinkGrant; readonly consumedSingleUse: boolean }
  /**
   * ⚠ 四种情形分得开：`not-found` / `revoked` / `expired` / `used`。
   *   **分得开是给引导师的管理面用的**；给参与者的响应由 interface 合并成
   *   「找引导师重发」（契约 E1：不泄露项目/组是否存在）。
   *   在这一层就合并，管理面就再也拿不到这个区别。
   */
  | { readonly ok: false; readonly reason: "not-found" | "revoked" | "expired" | "used" };

/* ─────────────────────────── 撤销 ─────────────────────────── */

export interface RevokeInviteLinksInput {
  readonly orgId: OrgId;
  readonly projectId: string;
  /** null = `[重置全部]`。 */
  readonly linkId: string | null;
  readonly now: Date;
}

export interface RevokeInviteLinksResult {
  /**
   * ⚠ **只含本次真正被撤销的那些**。已经撤销过的、以及签发时让位的（`superseded_at`）
   *   都不在里面——重复撤销同一条返回同一结果（契约「幂等重放」逐字），
   *   而让位是签发的清理，不是引导师做过的动作。
   */
  readonly revokedLinkIds: readonly string[];
}

/* ─────────────────────────── 读 ─────────────────────────── */

/** 管理面的一条链接。⚠ 含 `token` 明文 ⇒ 只能经 `Guarded` 出仓储。 */
export interface InviteLinkRow {
  readonly linkId: string;
  readonly kind: InviteLinkKind;
  readonly groupId: string | null;
  readonly projectRole: ProjectRoleValue;
  readonly validity: InviteLinkValidity;
  readonly token: string;
  readonly inviteCode: string | null;
  readonly expiresAt: Date | null;
  readonly usedBy: string | null;
  readonly usedAt: Date | null;
  readonly revokedAt: Date | null;
  readonly supersededAt: Date | null;
}

export interface InviteLinkRepository {
  /** 幂等签发。命中在世槽位 ⇒ `replayed: true` 且**不**新建行。 */
  issue(input: IssueInviteLinkInput): Promise<IssuedInviteLink>;
  /** 一次事务：定位令牌 → 切租户 → 条件 UPDATE 记录使用者 → 返回服务端记录的授予值。 */
  consume(input: ConsumeInviteLinkInput): Promise<ConsumeInviteLinkResult>;
  /** 单条撤销 / `[重置全部]`。 */
  revoke(input: RevokeInviteLinksInput): Promise<RevokeInviteLinksResult>;
  /** 管理面列表。含令牌明文与使用者 ⇒ `Guarded`。 */
  list(orgId: OrgId, projectId: string): Promise<Guarded<readonly InviteLinkRow[]>>;
}

export const INVITE_LINK_REPOSITORY = Symbol("InviteLinkRepository");

/* ─────────────────────── 名单 ─────────────────────── */

export interface UpsertParticipantInput {
  readonly participantId: string;
  readonly contactKind: "email" | "phone";
  /** 已规范化（email 小写 / phone 去分隔符）。 */
  readonly contact: string;
  readonly masked: string;
  readonly projectRole: ProjectRoleValue;
  readonly groupId: string | null;
}

export interface ParticipantRow {
  readonly participantId: string;
  readonly masked: string;
  readonly projectRole: ProjectRoleValue;
  readonly groupId: string | null;
  readonly confirmState: "invited" | "confirmed";
  readonly lastSentAt: Date | null;
}

export interface UpsertRosterResult {
  readonly created: readonly ParticipantRow[];
  /** 已在名单里、本次未新建的**原始输入值**（契约 `out.deduped`）。 */
  readonly deduped: readonly string[];
}

export interface ParticipantRosterRepository {
  /**
   * 批量落名单。**部分成功是一等返回形态**：格式非法的那些由用例层挑出来，
   * 已存在的那些进 `deduped`，都不让整批失败（契约 E3 逐字）。
   */
  upsert(
    orgId: OrgId,
    projectId: string,
    actorId: string,
    rows: readonly UpsertParticipantInput[],
  ): Promise<UpsertRosterResult>;
  /** 含掩码联系方式 ⇒ `Guarded`。 */
  list(orgId: OrgId, projectId: string): Promise<Guarded<readonly ParticipantRow[]>>;
  /** [群发邀请] / [重发] 写 `last_sent_at`。返回真正写到的那些 id。 */
  markSent(
    orgId: OrgId,
    projectId: string,
    participantIds: readonly string[],
    now: Date,
  ): Promise<readonly string[]>;
}

export const PARTICIPANT_ROSTER_REPOSITORY = Symbol("ParticipantRosterRepository");

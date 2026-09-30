/**
 * 通用项目邀请（#4787）的仓储端口。
 *
 * ## 方法粒度
 *
 * 每个「读—判—写」必须落在**一个事务**里的动作是一个方法（同 `OrgInviteRepository.activate` 的理由：
 * 方法边界是将来某次重构可以放 commit 的地方）：
 *   · `prepareEmailInvitations`   过期清理 + 每日上限 + 去重 + 插入 + 令牌索引
 *   · `issueLink`                 上限 + 旧链接作废 + 新链接插入 + 令牌索引
 *   · `prepareResend`             判定 + 占发送名额 + 轮换令牌
 *   · `acceptLoggedIn` / `activate`  令牌 → 邀请行（锁）→ 判定 → 建号（仅 activate）→ 组织成员 → 项目成员 → 邀请终态
 *
 * ## 匿名入口
 *
 * `lookup` / `acceptLoggedIn` / `activate` 的调用者可能没有会话：令牌哈希经无租户键的
 * `project_invitation_tokens` 定位租户，再在该租户上下文里读 `project_invitations`（迁移头注）。
 * 授予值（项目 / 角色 / 邮箱）恒取自邀请行，不取自任何入参。
 *
 * ## 名单读侧交 `Guarded<T>`
 *
 * `list` 返回 `Guarded`，披露由用例拿 `authorizeNonWorkshopMember` 的决策解开。
 */
import type { OrgId } from "../../domain/org-id";
import type {
  InvitationKind,
  InvitationSendError,
  InvitationStoredStatus,
} from "../../domain/project/project-invitation";
import type { Guarded } from "../security/permission-filter";

export interface InvitationMailContext {
  readonly projectName: string;
  readonly inviterName: string;
}

/* ─────────────────────────── 负责人一侧 ─────────────────────────── */

export interface PrepareEmailInvitationsCmd {
  readonly orgId: OrgId;
  readonly projectId: string;
  readonly invitedBy: string;
  readonly now: Date;
  readonly dailyCap: number;
  /** 邮箱已规范化、已去重；`invitationId` / `tokenHash` / `expiresAt` 由用例生成。 */
  readonly items: readonly {
    readonly email: string;
    readonly invitationId: string;
    readonly tokenHash: string;
    readonly expiresAt: Date;
  }[];
}

export type PreparedEmailItem =
  | { readonly email: string; readonly outcome: "created"; readonly invitationId: string }
  | { readonly email: string; readonly outcome: "already_pending"; readonly invitationId: string }
  | { readonly email: string; readonly outcome: "already_member"; readonly invitationId: null };

export type PrepareEmailInvitationsResult =
  | { readonly ok: true; readonly context: InvitationMailContext; readonly items: readonly PreparedEmailItem[] }
  | { readonly ok: false; readonly reason: "daily-cap" };

export interface IssueLinkCmd {
  readonly orgId: OrgId;
  readonly projectId: string;
  readonly invitedBy: string;
  readonly now: Date;
  readonly dailyCap: number;
  readonly invitationId: string;
  readonly tokenHash: string;
  readonly expiresAt: Date;
}

export type IssueLinkResult =
  | { readonly ok: true; readonly replacedInvitationId: string | null }
  | { readonly ok: false; readonly reason: "daily-cap" };

export interface InvitationListRow {
  readonly invitationId: string;
  readonly kind: InvitationKind;
  readonly email: string | null;
  readonly role: "collaborator";
  readonly status: InvitationStoredStatus;
  readonly expiresAt: Date;
  readonly createdAt: Date;
  readonly invitedByName: string;
  readonly lastSentAt: Date | null;
  readonly sendAttempts: number;
  readonly lastSendError: InvitationSendError | null;
}

export interface PrepareResendCmd {
  readonly orgId: OrgId;
  readonly projectId: string;
  readonly invitationId: string;
  /** 发起重发的人（进邮件的「邀请人」）。 */
  readonly actorId: string;
  readonly now: Date;
  readonly newTokenHash: string;
}

export type PrepareResendResult =
  | {
      readonly ok: true;
      readonly email: string;
      readonly expiresAt: Date;
      readonly sendAttempts: number;
      readonly lastSentAt: Date;
      readonly context: InvitationMailContext;
    }
  | {
      readonly ok: false;
      readonly reason: "not-found" | "not-resendable" | "expired" | "too-soon" | "limit-reached";
      readonly retryAfterMs: number | null;
    };

export type RevokeInvitationResult = "revoked" | "not-found" | "already-accepted";

/* ─────────────────────────── 受邀人一侧 ─────────────────────────── */

export interface InvitationLookup {
  /** `false` = 令牌不存在（与「存在但失效」对外不可分辨，见 `valid`）。 */
  readonly found: boolean;
  /** 找到且 pending 且未过期。 */
  readonly valid: boolean;
  readonly kind: InvitationKind | null;
  readonly projectName: string | null;
  readonly inviterName: string | null;
  /** 邮箱邀请绑定的邮箱；链接邀请 null。 */
  readonly invitedEmail: string | null;
  /** 受邀邮箱是否已有账号（仅邮箱邀请；链接邀请 false）。 */
  readonly invitedEmailHasAccount: boolean;
  /** `viewerUserId` 对应账号的邮箱（未传 / 查不到为 null）。 */
  readonly viewerEmail: string | null;
  readonly viewerIsProjectMember: boolean;
}

export type AcceptInvitationResult =
  | {
      readonly ok: true;
      readonly orgId: OrgId;
      readonly projectId: string;
      readonly joinedOrg: boolean;
      readonly alreadyMember: boolean;
    }
  | { readonly ok: false; readonly reason: "invalid" | "email-mismatch" | "archived" | "quota" };

/** 链接邀请的新账号走既有的邮箱验证流程：一个待验证挑战 + 一封入队的验证邮件。 */
export interface VerificationPlan {
  readonly challengeId: string;
  readonly tokenDigest: string;
  readonly outboxId: string;
  readonly expiresAt: Date;
}

export interface ActivateInvitationCmd {
  readonly tokenHash: string;
  readonly now: Date;
  readonly userId: string;
  readonly displayName: string;
  readonly passwordHash: string;
  /** 链接邀请的受邀人自填邮箱（已规范化 + 形状校验）；邮箱邀请忽略。 */
  readonly linkEmail: string | null;
  readonly verification: VerificationPlan;
}

export type ActivateInvitationResult =
  | {
      readonly ok: true;
      readonly userId: string;
      readonly orgId: OrgId;
      readonly projectId: string;
      /** `true` ⟺ 邮箱邀请（令牌经邮件到达即证明邮箱所有权）；链接邀请为 `false`（待验证）。 */
      readonly emailVerified: boolean;
    }
  | { readonly ok: false; readonly reason: "invalid" | "login-required" | "email-required" | "archived" | "quota" };

export interface ProjectInvitationRepository {
  prepareEmailInvitations(cmd: PrepareEmailInvitationsCmd): Promise<PrepareEmailInvitationsResult>;
  issueLink(cmd: IssueLinkCmd): Promise<IssueLinkResult>;
  list(orgId: OrgId, projectId: string): Promise<Guarded<readonly InvitationListRow[]>>;
  prepareResend(cmd: PrepareResendCmd): Promise<PrepareResendResult>;
  /** 发送失败时回写归类码；成功不需要回写（占位时已记 attempts / last_sent_at，并清掉了上一次的失败码）。 */
  recordSendFailure(cmd: { readonly orgId: OrgId; readonly invitationId: string; readonly error: InvitationSendError }): Promise<void>;
  revoke(cmd: {
    readonly orgId: OrgId;
    readonly projectId: string;
    readonly invitationId: string;
  }): Promise<RevokeInvitationResult>;

  lookup(tokenHash: string, now: Date, viewerUserId: string | null): Promise<InvitationLookup>;
  acceptLoggedIn(cmd: { readonly tokenHash: string; readonly now: Date; readonly userId: string }): Promise<AcceptInvitationResult>;
  activate(cmd: ActivateInvitationCmd): Promise<ActivateInvitationResult>;
}

export const PROJECT_INVITATION_REPOSITORY = Symbol("ProjectInvitationRepository");

/**
 * 「项目负责人按姓名加了一个人」之后给被加的人的通知（站内 + 邮件，尽力而为）。
 * 失败绝不回滚已完成的加人——调用方 `try/catch` 吞掉并记日志。
 */
export interface ProjectMemberAddedNotifier {
  notifyAdded(input: {
    readonly orgId: OrgId;
    readonly projectId: string;
    readonly userId: string;
    readonly actorId: string;
    readonly role: "owner" | "collaborator";
  }): Promise<void>;
}

export const PROJECT_MEMBER_ADDED_NOTIFIER = Symbol("ProjectMemberAddedNotifier");

/**
 * 对外可访问的站点根地址（`APP_PUBLIC_URL`）——邀请邮件 / 链接里的接受地址由它拼。
 * **惰性**：生产配置缺项时 `get()` 才抛（部署没配好不该拖垮整个 API 启动，见 `lazyCloudflareEmailConfig`）。
 */
export interface AppPublicUrlProvider {
  get(): string;
}

export const APP_PUBLIC_URL_PROVIDER = Symbol("AppPublicUrlProvider");

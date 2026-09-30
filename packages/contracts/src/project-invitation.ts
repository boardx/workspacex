/**
 * 契约束 `project-invitation` — 通用项目邀请（#4787，后端；唯一事实源）
 *
 * 项目负责人（`general_project_members.role = 'owner'`，与 `addNonWorkshopMember` 同一道门，
 * 含「容器没有 owner 时组织 lead/admin 可加第一位」）用两种载体把人拉进**通用项目**：
 *
 *   · 邮箱邀请：一次性、绑定邮箱，邮件里带接受链接；可重发（限频）、可撤销、7 天过期。
 *   · 邀请链接：可重复使用到过期 / 撤销；每个项目至多一条在世链接，「重置」= 旧的作废、签新的。
 *
 * ## 令牌
 *
 * 明文令牌只在两处出现：邮件正文（邮箱邀请）与 `issueProjectInviteLink` 的响应（链接邀请）。
 * 库里只有 SHA-256。所以链接邀请创建后无法再读出原链接——要新链接就重置；邮箱邀请的「重发」
 * 也是轮换令牌（旧邮件里的链接当场失效）。
 *
 * ## 谁会因为接受邀请而成为组织成员
 *
 * 只有两处会授予组织成员资格（其余入口的组织成员门一律不放宽）：
 *   ① `activateProjectInvitation`：全新用户（没有账号、不在组织里）接受邀请；
 *   ② `acceptProjectInvitation`：已登录但还不是该项目所在组织成员的用户接受邀请。
 * 授予的组织角色恒为 `INVITED_ORG_ROLE`（组织里权限最小的一档），项目角色恒为 `collaborator`。
 *
 * ## 「邀请无效」只有一种说法
 *
 * 令牌不存在 / 已过期 / 已撤销 / 已用掉 / 被新令牌取代 —— 一律 `INVITATION_INVALID`（预览则是
 * `valid: false`），不区分原因，防止令牌探测。
 *
 * ## 错误体
 *
 * 失败响应体恒为 `{ reasonCode, message }`：`reasonCode` 是 `ProjectInvitationReason` 的成员，
 * `message` 是 `PROJECT_INVITATION_REASON_TEXT[reasonCode]` 那句人话（前端可直接展示，也可自己映射）。
 */
import { z } from "zod";
import { AuthenticatedSession } from "./auth";
import { OrgRole } from "./identity";

export const ProjectInvitationKind = z.enum(["email", "link"]);

/** 存储态四值；`list` 里的 `status` 已按 `expiresAt` 派生（pending 且已过期 ⇒ expired）。 */
export const ProjectInvitationStatus = z.enum(["pending", "accepted", "revoked", "expired"]);

/** 邀请授予的项目角色。只有一档；与 `project.NonWorkshopMemberRole` 的 `collaborator` 同值。 */
export const ProjectInvitationRole = z.enum(["collaborator"]);

/**
 * 邮件没发出去的归类（写进 `last_send_error`，也回给前端）。是枚举码不是异常文本。
 *   MAIL_NOT_CONFIGURED   部署没配好事务邮件（发不了，不是这次没发出去）
 *   MAIL_SEND_FAILED      配了但这次没发出去（超时 / 网络 / 服务商 5xx）
 *   MAIL_RECIPIENT_REJECTED  服务商明确拒收（多半是地址不可投递）
 */
export const ProjectInvitationSendError = z.enum(["MAIL_NOT_CONFIGURED", "MAIL_SEND_FAILED", "MAIL_RECIPIENT_REJECTED"]);

export const ProjectInvitationReason = z.enum([
  /* 与 `addNonWorkshopMember` 同一道门的拒绝面 */
  "NO_PROJECT_ROLE",
  "PROJECT_ROLE_INSUFFICIENT",
  "ORG_ROLE_INSUFFICIENT",
  "AUTH_SERVICE_UNAVAILABLE",
  "PROJECT_ARCHIVED",
  /* 负责人一侧 */
  "INVITATION_NOT_FOUND",
  "INVITATION_NOT_RESENDABLE",
  "INVITATION_EXPIRED",
  "INVITATION_ALREADY_ACCEPTED",
  "RESEND_TOO_SOON",
  "RESEND_LIMIT_REACHED",
  "DAILY_CAP_REACHED",
  /* 受邀人一侧 */
  "INVITATION_INVALID",
  "INVITATION_EMAIL_MISMATCH",
  "LOGIN_REQUIRED",
  "EMAIL_REQUIRED",
  "EMAIL_INVALID",
  "SEAT_QUOTA_EXHAUSTED",
]);

/**
 * 限频与上限的**唯一**声明点（domain / 仓储 / 文案都读它，不另写数字）。
 * 文案里的数字由这里插值，不手写。
 */
export const PROJECT_INVITATION_LIMITS = {
  /** 邀请有效期（天）。 */
  ttlDays: 7,
  /** 单次请求最多邀请多少个邮箱。 */
  emailsPerRequest: 20,
  /** 每个项目每 24 小时最多创建多少条邀请（邮箱 + 链接合计）。 */
  dailyCapPerProject: 50,
  /** 同一条邮箱邀请两次发送之间的最小间隔（秒）。 */
  resendCooldownSeconds: 60,
  /** 同一条邮箱邀请最多发送几次（含首次）。 */
  maxSendsPerInvitation: 5,
} as const;

/** 每个码对应的人话（中文）。前后端共用这一份，不在别处再抄。 */
export const PROJECT_INVITATION_REASON_TEXT: Readonly<Record<z.infer<typeof ProjectInvitationReason>, string>> = {
  NO_PROJECT_ROLE: "你不在这个项目里，无法管理邀请。",
  PROJECT_ROLE_INSUFFICIENT: "只有项目负责人可以邀请成员。",
  ORG_ROLE_INSUFFICIENT: "你没有权限管理这个项目的邀请。",
  AUTH_SERVICE_UNAVAILABLE: "权限服务暂时不可用，请稍后再试。",
  PROJECT_ARCHIVED: "项目已归档，无法再邀请成员。",
  INVITATION_NOT_FOUND: "没有找到这条邀请，可能已被删除。",
  INVITATION_NOT_RESENDABLE: "这条邀请不能重发。只有待接受的邮件邀请可以重发。",
  INVITATION_EXPIRED: "邀请已过期，请重新发起邀请。",
  INVITATION_ALREADY_ACCEPTED: "对方已经接受了这条邀请，无法撤销。如需移除成员，请在成员列表中操作。",
  RESEND_TOO_SOON: `刚刚已经发送过，请 ${PROJECT_INVITATION_LIMITS.resendCooldownSeconds} 秒后再重发。`,
  RESEND_LIMIT_REACHED: `这条邀请已经发送了 ${PROJECT_INVITATION_LIMITS.maxSendsPerInvitation} 次，不能再重发。请撤销后重新邀请，或把邀请链接直接发给对方。`,
  DAILY_CAP_REACHED: `今天这个项目发出的邀请已达上限（${PROJECT_INVITATION_LIMITS.dailyCapPerProject} 条），请明天再试。`,
  INVITATION_INVALID: "邀请链接无效或已失效，请联系邀请你的人重新发送。",
  INVITATION_EMAIL_MISMATCH: "这条邀请发给了另一个邮箱。请退出后用收到邀请的邮箱账号登录。",
  LOGIN_REQUIRED: "这个邮箱已经注册过了，请先登录，登录后再接受邀请。",
  EMAIL_REQUIRED: "请填写你的邮箱。",
  EMAIL_INVALID: "邮箱格式不正确，请检查后重试。",
  SEAT_QUOTA_EXHAUSTED: "该组织的成员席位已满，暂时无法加入。请联系组织管理员。",
};

/** 邮件发送失败的人话。前端展示 `lastSendError` 时用。 */
export const PROJECT_INVITATION_SEND_ERROR_TEXT: Readonly<Record<z.infer<typeof ProjectInvitationSendError>, string>> = {
  MAIL_NOT_CONFIGURED: "邮件服务暂未配置，邮件没有发出。请联系管理员，或改用邀请链接。",
  MAIL_SEND_FAILED: "邮件发送失败，请稍后点「重发」再试。",
  MAIL_RECIPIENT_REJECTED: "对方的邮箱拒收了这封邮件，请确认邮箱地址是否正确。",
};


/**
 * 因接受邀请而新成为组织成员的人，得到的组织角色。
 *
 * 四种组织角色里权限最小的一档：`admin`（全组织管理）、`lead`（创建/管理项目）、`compliance`
 * （审计链与合规运营入口）都比它多，`consultant` 是没有任何管理职能的普通成员。
 * 写成常量而不是「取枚举最后一个」：枚举顺序不是权限序。
 */
export const INVITED_ORG_ROLE = "consultant" as const satisfies z.infer<typeof OrgRole>;

const ProjectId = z.string().min(1);
const InvitationId = z.string().min(1);
const Iso = z.string().datetime();

export const ProjectInvitationListItem = z
  .object({
    invitationId: z.string(),
    kind: ProjectInvitationKind,
    /** 仅 kind='email'。 */
    email: z.string().nullable(),
    role: ProjectInvitationRole,
    /** 已按过期时间派生。 */
    status: ProjectInvitationStatus,
    expiresAt: Iso,
    createdAt: Iso,
    invitedByName: z.string(),
    lastSentAt: Iso.nullable(),
    sendAttempts: z.number().int().min(0),
    lastSendError: ProjectInvitationSendError.nullable(),
    /** 现在点「重发」会不会被接受（仅邮件邀请、待接受、未过期、未到上限；冷却期内仍为 true，点了会被限频提示）。 */
    canResend: z.boolean(),
  })
  .strict();

export const CreateEmailInvitationOutcome = z.enum([
  /** 已创建并发出邮件。 */
  "sent",
  /** 已创建，但邮件没发出去（见 `lastSendError`）；可稍后重发。 */
  "send_failed",
  /** 该邮箱在这个项目里已有一条待接受的邀请（没有新建；用重发）。 */
  "already_pending",
  /** 该邮箱对应的账号已经在这个项目里。 */
  "already_member",
  /** 邮箱格式不对，没有创建。 */
  "invalid_email",
]);

export const operations = {
  /**
   * `createProjectInvitations` —— 批量邮箱邀请。权限：项目 owner（同 `addNonWorkshopMember`）。
   * 每个邮箱各自成败（见 `outcome`），只有整批超出每日上限才整体拒绝（`DAILY_CAP_REACHED`）。
   * 邮件在创建后立即发送；发送失败**可见**：`outcome: "send_failed"` + `lastSendError`。
   */
  createProjectInvitations: {
    method: "POST",
    path: "/projects/:projectId/invitations",
    in: z
      .object({
        projectId: ProjectId,
        emails: z.array(z.string().min(1).max(254)).min(1).max(PROJECT_INVITATION_LIMITS.emailsPerRequest),
      })
      .strict(),
    out: z
      .object({
        invitations: z.array(
          z
            .object({
              /** 原样回显（已 trim；大小写保持请求里的样子）。 */
              email: z.string(),
              invitationId: z.string().nullable(),
              outcome: CreateEmailInvitationOutcome,
              lastSendError: ProjectInvitationSendError.nullable(),
            })
            .strict(),
        ),
      })
      .strict(),
    err: ["NO_PROJECT_ROLE", "PROJECT_ROLE_INSUFFICIENT", "ORG_ROLE_INSUFFICIENT", "PROJECT_ARCHIVED", "DAILY_CAP_REACHED", "AUTH_SERVICE_UNAVAILABLE"] as const,
  },

  /**
   * `issueProjectInviteLink` —— 签发 / 重置项目邀请链接。首次调用创建；已有在世链接时，
   * 旧的作废（`replacedInvitationId`）并签新的。`inviteUrl` 只在这一次响应里出现。
   */
  issueProjectInviteLink: {
    method: "POST",
    path: "/projects/:projectId/invitations/link",
    in: z.object({ projectId: ProjectId }).strict(),
    out: z
      .object({
        invitationId: z.string(),
        /** `${APP_PUBLIC_URL}/projects/join?invite=<token>`。⚠ 只出现这一次。 */
        inviteUrl: z.string(),
        expiresAt: Iso,
        replacedInvitationId: z.string().nullable(),
      })
      .strict(),
    err: ["NO_PROJECT_ROLE", "PROJECT_ROLE_INSUFFICIENT", "ORG_ROLE_INSUFFICIENT", "PROJECT_ARCHIVED", "DAILY_CAP_REACHED", "AUTH_SERVICE_UNAVAILABLE"] as const,
  },

  /** `listProjectInvitations` —— 本项目的邀请（新的在前，最多 200 条，含已接受 / 撤销 / 过期的历史）。恒不含令牌。 */
  listProjectInvitations: {
    method: "GET",
    path: "/projects/:projectId/invitations",
    in: z.object({ projectId: ProjectId }).strict(),
    out: z.object({ invitations: z.array(ProjectInvitationListItem) }).strict(),
    err: ["NO_PROJECT_ROLE", "PROJECT_ROLE_INSUFFICIENT", "ORG_ROLE_INSUFFICIENT", "AUTH_SERVICE_UNAVAILABLE"] as const,
  },

  /**
   * `resendProjectInvitation` —— 重发一条邮件邀请（轮换令牌：旧邮件里的链接失效）。
   * 限频：两次发送至少间隔 `resendCooldownSeconds`；一条邀请最多发 `maxSendsPerInvitation` 次。
   * 过期 / 已撤销 / 已接受 / 链接邀请都不可重发。
   */
  resendProjectInvitation: {
    method: "POST",
    path: "/projects/:projectId/invitations/:invitationId/resend",
    in: z.object({ projectId: ProjectId, invitationId: InvitationId }).strict(),
    out: z
      .object({
        invitationId: z.string(),
        outcome: z.enum(["sent", "send_failed"]),
        lastSendError: ProjectInvitationSendError.nullable(),
        sendAttempts: z.number().int().min(1),
        lastSentAt: Iso,
        /** 还能再重发几次。 */
        remainingSends: z.number().int().min(0),
      })
      .strict(),
    err: [
      "NO_PROJECT_ROLE", "PROJECT_ROLE_INSUFFICIENT", "ORG_ROLE_INSUFFICIENT", "PROJECT_ARCHIVED",
      "INVITATION_NOT_FOUND", "INVITATION_NOT_RESENDABLE", "INVITATION_EXPIRED", "RESEND_TOO_SOON", "RESEND_LIMIT_REACHED",
      "AUTH_SERVICE_UNAVAILABLE",
    ] as const,
  },

  /** `revokeProjectInvitation` —— 撤销一条邀请（邮箱或链接）。幂等：已撤销再撤销仍成功。已接受的撤不了。 */
  revokeProjectInvitation: {
    method: "POST",
    path: "/projects/:projectId/invitations/:invitationId/revoke",
    in: z.object({ projectId: ProjectId, invitationId: InvitationId }).strict(),
    out: z.object({ invitationId: z.string(), status: z.literal("revoked") }).strict(),
    err: [
      "NO_PROJECT_ROLE", "PROJECT_ROLE_INSUFFICIENT", "ORG_ROLE_INSUFFICIENT", "PROJECT_ARCHIVED",
      "INVITATION_NOT_FOUND", "INVITATION_ALREADY_ACCEPTED", "AUTH_SERVICE_UNAVAILABLE",
    ] as const,
  },

  /**
   * `previewProjectInvitation` —— 落地页预览（**匿名可调**；带会话时会按会话给出下一步）。
   * 令牌用 POST body 传，不进 URL / 访问日志。无效令牌 ⇒ 200 + `valid: false`、其余字段全 null
   * （不区分不存在 / 过期 / 撤销 / 已用）。有效时只返回落地页必需的这几样，别无其他。
   *
   * `nextStep`：
   *   accept            已登录且可以直接接受
   *   already_member    已登录且已经在这个项目里
   *   email_mismatch    已登录，但这是发给另一个邮箱的邀请
   *   login             邮箱邀请、该邮箱已注册、当前未登录 ⇒ 去登录，回来再接受
   *   register          邮箱邀请、该邮箱未注册、当前未登录 ⇒ 设置姓名和口令（`activate`）
   *   login_or_register 链接邀请、当前未登录 ⇒ 登录后接受，或填邮箱 + 姓名 + 口令注册
   */
  previewProjectInvitation: {
    method: "POST",
    path: "/project-invitations/preview",
    in: z.object({ token: z.string().min(1) }).strict(),
    out: z
      .object({
        valid: z.boolean(),
        kind: ProjectInvitationKind.nullable(),
        projectName: z.string().nullable(),
        inviterName: z.string().nullable(),
        /** 仅邮箱邀请；链接邀请恒为 null。 */
        invitedEmail: z.string().nullable(),
        nextStep: z.enum(["accept", "already_member", "email_mismatch", "login", "register", "login_or_register"]).nullable(),
      })
      .strict(),
    err: ["AUTH_SERVICE_UNAVAILABLE"] as const,
  },

  /**
   * `acceptProjectInvitation` —— 已登录用户接受邀请。邮箱邀请必须与登录账号的邮箱一致。
   * 用户还不是项目所在组织的成员时，同时以 `INVITED_ORG_ROLE` 加入该组织（`joinedOrg: true`）；
   * 项目所在组织可能不是会话当前组织——前端据 `orgId` 切换组织后再进项目。
   * 已在项目里 ⇒ 幂等成功（`alreadyMember: true`，不降级已有的 owner）。
   */
  acceptProjectInvitation: {
    method: "POST",
    path: "/project-invitations/accept",
    in: z.object({ token: z.string().min(1) }).strict(),
    out: z
      .object({
        projectId: z.string(),
        orgId: z.string(),
        joinedOrg: z.boolean(),
        alreadyMember: z.boolean(),
      })
      .strict(),
    err: ["INVITATION_INVALID", "INVITATION_EMAIL_MISMATCH", "PROJECT_ARCHIVED", "SEAT_QUOTA_EXHAUSTED", "AUTH_SERVICE_UNAVAILABLE"] as const,
  },

  /**
   * `activateProjectInvitation` —— 全新用户（匿名）接受邀请：建账号 + 加入组织（`INVITED_ORG_ROLE`）
   * + 成为项目 collaborator，一个事务。
   *
   *   · 邮箱邀请：邮箱取自邀请（请求里的 `email` 被忽略）；令牌经邮件到达即证明邮箱所有权 ⇒
   *     账号直接是已验证的，返回会话（`verificationRequired: false`）。
   *   · 链接邀请：`email` 必填，走既有的邮箱验证流程——账号未验证、**不返回会话**
   *     （`sessionId` / `session` 为 null，`verificationRequired: true`），验证邮件已入队，
   *     验证后用邮箱 + 口令登录即可。
   *   · 邮箱已注册 ⇒ `LOGIN_REQUIRED`（前端引导去登录，登录后走 `acceptProjectInvitation`）。
   * 口令强度复用注册的同一条策略；不合格 ⇒ 字段级 400（`profile.password` 路径同组织激活），不是邀请失效。
   */
  activateProjectInvitation: {
    method: "POST",
    path: "/project-invitations/activate",
    in: z
      .object({
        token: z.string().min(1),
        name: z.string().trim().min(1).max(80),
        password: z.string().min(1).max(200),
        /** 仅链接邀请必填；邮箱邀请忽略。 */
        email: z.string().max(254).optional(),
      })
      .strict(),
    out: z
      .object({
        userId: z.string(),
        orgId: z.string(),
        projectId: z.string(),
        verificationRequired: z.boolean(),
        sessionId: z.string().nullable(),
        session: AuthenticatedSession.nullable(),
      })
      .strict(),
    err: [
      "INVITATION_INVALID", "LOGIN_REQUIRED", "EMAIL_REQUIRED", "EMAIL_INVALID", "PROJECT_ARCHIVED", "SEAT_QUOTA_EXHAUSTED",
      "AUTH_SERVICE_UNAVAILABLE",
    ] as const,
  },
} as const;

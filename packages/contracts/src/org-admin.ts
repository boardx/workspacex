/**
 * 契约束 `org-admin` — ③ API 契约（**唯一事实源**）
 *
 * ADR-020：这一份生成四样东西，任何一样都不许手写第二份——
 *   后端 DTO + ValidationPipe · 前端 client 类型 · OpenAPI · 前端 mock。
 *
 * 覆盖 feature：见 `contracts/org-admin/design-signoff.md` frontmatter `covers:`（权威）。
 * 依据：同目录 `usecases.md`（本文件是它逐条的落地）、`domain.md`。
 *
 * ## 本束的两条形状纪律
 *
 * ⚠ **两层正交角色**：组织角色（`identity.OrgRole`：管理员 / 项目负责人 / 顾问 / 合规）
 *   × 项目角色（`identity.ProjectRole`：引导师 / 组长 / 组员 / 观察者）。
 *   **后者只属工作坊**（人类 2026-07-30 裁决，与 `project` 束 U-1 同源）——
 *   本束凡出现项目角色的操作，其对象都是工作坊；研究项目 / 用户洞察走 `project` 束的
 *   `NonWorkshopMemberRole`（**那边今天还没有操作**，见 `project.KNOWN_CONTRACT_GAPS.P2`）。
 *
 * ⚠ **管理员不是超级用户，但 `purpose:"audit"` 是「放行 + 留痕」不是 403**。
 *   这条断言方向被 **O-04 反转过一次**：照旧稿写 `expect(403)` 会写出**方向错误的绿灯**——
 *   测试全绿，而实现里那条审计读取路径根本没被实现过，因为没人断言过它应该成功。
 *   ⇒ `recordAdminProjectAccess` 的正例是 **200 + 恰好一条日志 + 该日志对项目负责人可见**；
 *   `ADMIN_NOT_SUPERUSER` 只用于**无项目角色下的常规内容读取**（`purpose:"work"`）。
 *
 * ## 失败码归属（usecases.md 第零节逐字）
 * 权限类**一律复用** phase-00 `identity.PermissionReason`，本束不另立一套；
 * 下方 `_sharedWithIdentity` 是这条纪律的**编译期门控**。
 * 本束新增的只有业务类码。
 */
import { z } from "zod";
import { OrgRole, PermissionReason, PermissionDecision, ProjectRole } from "./identity";
import { AUTH_POLICY } from "./auth";

/* ─────────────────────────── 枚举 ─────────────────────────── */

/**
 * 邀请生命周期。`awaiting-review` 是 O-28 ⑥ 双人复核的落点：
 * **`orgRole = "admin"` 的邀请在被另一名管理员批准前不签发 token**（I-3）。
 *
 * ⚠ 刻意**没有** `accepted`：激活成功后邀请行的终态是 `used`，
 *   而「这个人现在是不是成员」的事实在 `org_members`，不在邀请表。两处会漂移。
 */
export const OrgInviteStatus = z.enum(["pending", "awaiting-review", "revoked", "used", "send-failed"]);

/** 团队的三种变更。**一个操作三个分支**，不是三条路由——删除要做占用校验（I-7） */
export const TeamOp = z.enum(["create", "rename", "delete"]);

/**
 * 参与者身份四选（`upsertParticipantRoster` / `issueInviteLink`）。
 *
 * ⚠ `coFacilitator` 是**展示别名**，落库 `projectRole = "facilitator"`（O-03 / I-17），
 *   **不产生第五种取值**。因此本枚举与 `identity.ProjectRole` **不是同一个东西**：
 *   前者是界面上的四选，后者是入库的四值。合并会让「协同引导师」变成第五个角色。
 */
export const ParticipantIdentityChoice = z.enum(["member", "groupLead", "observer", "coFacilitator"]);

/** 邀请链接三种有效期（R10 链接有效期统一表）。⚠ `once` = 一次性令牌 */
export const InviteLinkValidity = z.enum(["24h", "7d", "once"]);

/** 主链接 / 分组链接。分组链接必带 `groupId` */
export const InviteLinkKind = z.enum(["main", "group"]);

/** 群发渠道 */
export const BroadcastChannel = z.enum(["sms", "email", "both"]);

/**
 * 议程环节的四种终止方式（`expireTemporaryAccess`）。
 *
 * ⚠ **四种各一条断言**（I-28）：只测「正常结束」会漏掉跳过 / 合并 / 提前结束三条路径，
 *   而临时提权在那三条上同样必须**立即**失效。
 * ⚠ 与 `project.AgendaSegmentAdvanceAction` **不是同一个枚举**：那边是**动作词**
 *   （`advance` / `closeEarly` / `skip` / `merge`），这边是**终止事实**。
 *   本束是 `StageEventSource` 的**消费者不是定义者**（usecases.md 第六节逐字）。
 */
export const StageTerminationKind = z.enum(["completed", "skipped", "merged", "early-ended"]);

/**
 * 本束的失败面。分两段：
 *   ① 与 phase-00 `identity` 束**同码同义**（`_sharedWithIdentity` 是编译期门控）
 *   ② 本束新增的**业务类**码（`usecases.md` 第零节表格逐条，**这里不许多一条**）
 *
 * ⚠ 每一个成员都在下方某个操作的 `err` 里出现——
 *   一个不会被任何路径抛出的错误码读起来像覆盖，而它什么都没覆盖。
 */
export const OrgAdminError = z.enum([
  /* ── ① identity 束同码同义 ─────────────────────────────────── */
  "NO_ORG_MEMBERSHIP",
  "ORG_SCOPE_DENIED",
  /** ⚠ **正常状态不是异常**（identity I-11）；与「无项目上下文」禁止合并 */
  "NO_PROJECT_ROLE",
  "PROJECT_ROLE_INSUFFICIENT",
  /** ⚠ 只用于 `purpose:"work"` 的越权读；`purpose:"audit"` 是放行 + 留痕（O-04 反转） */
  "ADMIN_NOT_SUPERUSER",
  "PERSONAL_LAYER_CLOSED",
  /** ⚠ 判定服务不可用**一律拒绝，不得降级放行** */
  "AUTH_SERVICE_UNAVAILABLE",

  /* ── ② 本束新增（usecases.md 第零节）────────────────────────── */
  /**
   * 邀请令牌无效 / 过期 / 已使用 / 已撤销。
   * ⚠ **四种情况必须返回逐字节相同的响应**（V10 防枚举），
   *   响应体**不含组织名与任何成员信息**——否则它就是一个组织存在性探测器。
   */
  "INVITE_NOT_FOUND",
  "INVITE_ALREADY_MEMBER",
  /** 并发：两名管理员同时邀同一邮箱，**恰好一条成功**（I-5），第二路收到它 */
  "INVITE_DUPLICATE",
  /** 管理员邀请待另一名管理员批准，**此时链接尚未签发** */
  "INVITE_AWAITING_REVIEW",
  /** 发起人不可自批（I-4） */
  "INVITE_SELF_REVIEW_FORBIDDEN",
  /** ⚠ 响应**必须**含直达 `[调整]` 的入口标识——阻断要伴随可执行的下一步 */
  "QUOTA_EXHAUSTED",
  /** ⚠ 响应**必须列出占用项**；**不做级联删除**（I-7） */
  "TEAM_IN_USE",
  /** O-06：令牌是必需的不是装饰。去掉 `?t=` 直接访问被拒 */
  "LINK_TOKEN_REQUIRED",
  /** ⚠ 三码对**参与者**统一渲染为「找引导师重发」，不泄露项目/组是否存在（E1） */
  "LINK_REVOKED",
  "LINK_EXPIRED",
  "LINK_ALREADY_USED",
  /** ⚠ **不是错误页**，是「门口页」+ `[向引导师申请加入]`（E2） */
  "PHONE_NOT_ON_ROSTER",
  /** 申请加入待批中。⚠ 待批期间读任何本组资源**返回 0 行**（I-21，不是「界面上没渲染」） */
  "JOIN_PENDING_APPROVAL",
  /** ⚠ **不得静默成功**；须给「让引导师直接把我加进来」兜底路径（E5/V9） */
  "SMS_UNAVAILABLE",
  /** 邀请记录标 `send-failed` 并可重试，**不产生可激活链接的假象**（V12） */
  "MAIL_UNAVAILABLE",
  /** ⚠ 阈值**不写死**：`AUTH_POLICY.resendCooldownSeconds` / `resendDailyMax`（O-28 ④） */
  "RATE_LIMITED",
  /** 临时读权已随议程环节失效 */
  "STAGE_GRANT_EXPIRED",
  /** 乐观并发：目标已被他人修改，**不静默覆盖** */
  "VERSION_CHANGED",
  /**
   * 群发部分失败。⚠ **不是错误，是一等返回形态**——
   * `broadcastInvites.out` 同时带 `delivered` 与 `failed`，失败项可单条重试。
   * 它出现在 `err` 里，是为了让「整批成功」这种呈现在契约上就不合法（E4）。
   */
  "PARTIAL_DELIVERY",
  /** 目标处于撤回/待删除队列中。⚠ 撤回中的对象**不得被新引用** */
  "WITHDRAWAL_IN_PROGRESS",

  /* ── ③ org-profile-membership delta（#363 收拢 + 组织资料编辑）──────────── */
  /** `uploadOrgAvatar`：服务端重新算出的实际字节数超限（不信任客户端声明的 `sizeBytes`）。 */
  "FILE_TOO_LARGE",
  /** `uploadOrgAvatar`：magic-byte 嗅探结果与声明的 `contentType` 不一致，或不在白名单内。 */
  "UNSUPPORTED_CONTENT_TYPE",
  /** `updateOrganization`：`avatarArtifactId` 不是这个组织通过 `uploadOrgAvatar` 产出的。 */
  "AVATAR_ARTIFACT_NOT_OWNED",
]);

type OrgAdminErrorT = z.infer<typeof OrgAdminError>;
type PermissionReasonT = z.infer<typeof PermissionReason>;

/**
 * **跨束同码同义的编译期门控**（`pnpm --filter @repo/contracts run typecheck` 会红）。
 *
 * 交集类型 `PermissionReasonT & OrgAdminErrorT` 只接受**两个枚举都有**的字面量：
 * 任何一侧改名、拼错、或有人在本束「另起一份名字」，这里立刻不通过类型检查。
 *
 * ⚠ 为什么不直接 import 枚举本身：`identity` 是更内层的束，
 *   直接 import 会让本束的失败面随它变动。这里要的是「同名是刻意的」的**证明**，
 *   不是依赖（同 `auth.ts` 对 `NO_ORG_MEMBERSHIP` 的处理、同 `project.ts`）。
 */
const _sharedWithIdentity = [
  "NO_ORG_MEMBERSHIP",
  "ORG_SCOPE_DENIED",
  "NO_PROJECT_ROLE",
  "PROJECT_ROLE_INSUFFICIENT",
  "ADMIN_NOT_SUPERUSER",
  "PERSONAL_LAYER_CLOSED",
  "AUTH_SERVICE_UNAVAILABLE",
] as const satisfies readonly (PermissionReasonT & OrgAdminErrorT)[];

/**
 * **邀请与验证码的策略数值一律从 `auth.AUTH_POLICY` 读，本束不写死。**
 *
 * `usecases.md` 里出现的「7 天」「60 秒冷却 / 每日 5 次」「≥12 位」「14 位邀请码」
 * 全部已在 phase-00 `AUTH_POLICY` 声明过一次。在这里再写一遍就是第六次
 * 「同一事实声明在两处」，而漂移方向是**有人改了 AUTH_POLICY，本束纹丝不动**。
 *
 * ⚠ 这个 re-export 是**引用不是副本**：改 `AUTH_POLICY` 这里跟着变。
 * ⚠ 唯一一个**没有**出处的数值是「组织邀请链接 7 天有效期」——
 *   `AUTH_POLICY` 里只有 `resetLinkHours: 1`（重置密码），没有邀请链接的天数。
 *   见 `KNOWN_CONTRACT_GAPS.OA3`。
 */
export const ORG_ADMIN_POLICY = AUTH_POLICY;

/**
 * D-15 两级撤回 SLA 的**可计算**形态（F14）。
 *
 * ⚠ 这不是第六次「同一事实两处声明」：唯一的**展示字符串**事实源仍然是
 *   `apps/web/lib/withdrawal-flow.ts` 的 `WITHDRAWAL_SLA_SUMMARY`
 *   （`"≤5 分钟"` / `"≤30 天"`，由 `lint-withdrawal-flow.mjs` 门控它在前端不出现第二份）。
 *   那份是**给人看的**，不能拿来做 `deadline = queuedAt + ?` 的日期运算。
 *   这里是同一条 D-15 裁决换算成毫秒的**唯一**数值形态，后端（`withdraw-participant-phone.ts`）
 *   算两个 deadline 只从这里取，不再手写 `5 * 60_000` / `30 * 86_400_000`。
 * ⚠ 若 D-15 改期，这两处都要跟着改；但改的永远是「同一个数字的两种表达」
 *   （字符串 vs 毫秒），而不是两个可能互相打架的裁决来源。
 */
export const WITHDRAWAL_SLA_MS = {
  /** ≤5 分钟：逻辑失效（关联可识别信息退出检索 + 报告段落标失效的触发）。 */
  logicalRetire: 5 * 60_000,
  /** ≤30 天：物理删除并出回执。 */
  physicalDelete: 30 * 24 * 60 * 60_000,
} as const;

/* ─────────────────────────── 实体 ─────────────────────────── */

/** 一条组织邀请的对外形状。⚠ **不含 token**——token 只在签发响应里出现一次 */
export const OrgInvite = z
  .object({
    inviteId: z.string(),
    orgId: z.string(),
    email: z.string(),
    orgRole: OrgRole,
    teamId: z.string(),
    status: OrgInviteStatus,
    invitedBy: z.string(),
    /** null = 尚未发出（`awaiting-review`）或发送失败 */
    sentAt: z.string().nullable(),
  })
  .strict();

/** 名单条目引用。⚠ 观察者视角下**不含手机号明文**（I-16），由 RLS/投影保证 */
export const ParticipantRef = z
  .object({
    participantId: z.string(),
    /** 脱敏展示值，例如 `138 •••• 2049`。**不是原值** */
    masked: z.string(),
    identity: ParticipantIdentityChoice,
    /** 落库的项目角色。⚠ `coFacilitator` 在这里恒为 `facilitator`（O-03） */
    projectRole: ProjectRole,
    groupId: z.string().nullable(),
  })
  .strict();

/** 现场议程环节的位置。⚠ 结构来自 06-现场协作，本束**只读不定义** */
export const StagePosition = z
  .object({ id: z.string(), index: z.number().int().nonnegative(), total: z.number().int().positive() })
  .strict();

/** 管理员项目读取日志。⚠ 三方（管理员本人 / 项目负责人 / 审计）查到的是**同一条**（I-29） */
export const AdminAccessLogEntry = z
  .object({
    logId: z.string(),
    adminId: z.string(),
    projectId: z.string(),
    objectRef: z.string(),
    readAt: z.string(),
  })
  .strict();

/**
 * **禁止存在的路由**（本束）。
 *
 * ⚠ 这一条是写本文件时**撞出来**的，不是抄来的：
 *   `RemoveOrgMember` 的自然 REST 形状是 `DELETE /organizations/:orgId/members/:userId`，
 *   而 `tests/no-forbidden-routes.test.ts` 已有一条 `^DELETE\s+\/organizations` 的禁令
 *   （UC-0.5 I-2/I-3：个人本地组织不可删、不可退出）。那条禁令是**前缀**匹配，
 *   于是「移除成员」会被它误伤。
 *   ⇒ 本束把移除成员写成 `POST …/remove`。**这不是风格选择**：
 *     把禁令收窄成「只匹配组织本身」会让 `DELETE /organizations/:id/…` 整片重新开放，
 *     而那正是它想守住的东西。用动词路由避开，比放宽禁令便宜。
 */
export const ORG_ADMIN_FORBIDDEN_ROUTES = [
  {
    route: "DELETE /organizations/:orgId",
    why: "UC-0.5 I-2/I-3：个人本地组织恒定存在、不可删除、不可退出、不可转让。已由 no-forbidden-routes.test.ts 守住。",
  },
] as const;

/* ─────────────────────────── 操作 ─────────────────────────── */

export const operations = {
  /* ══ 一、组织成员邀请与激活（UC-1.6）══════════════════════════ */

  /**
   * `InviteOrgMember` —— 管理员邀请一个人进组织
   *
   * ⚠ **`orgRole = "admin"` 时返回 `awaiting-review` 而不是 `pending`，且此时不签发 token**
   *   （I-3 / O-28 ⑥）：提权动作被单个被盗账号执行即等于整个组织沦陷。
   * ⚠ 幂等：同 `(orgId, email)` 重复提交返回既有 `inviteId`，**不新建行、不重复扣额度**。
   */
  inviteOrgMember: {
    method: "POST",
    path: "/organizations/:orgId/invites",
    in: z
      .object({ orgId: z.string(), email: z.string().min(1), orgRole: OrgRole, teamId: z.string() })
      .strict(),
    out: z
      .object({
        inviteId: z.string(),
        status: OrgInviteStatus,
        /** 本次预留的未分配额度条数。⚠ 幂等重放时为 0（不重复扣） */
        quotaReserved: z.number().int().nonnegative(),
        /** ⚠ 恒为 false 当 `status = "awaiting-review"`——双人复核前不签发（I-3） */
        tokenIssued: z.boolean(),
      })
      .strict(),
    err: [
      "PROJECT_ROLE_INSUFFICIENT",
      "INVITE_ALREADY_MEMBER",
      "INVITE_DUPLICATE",
      "QUOTA_EXHAUSTED",
      "MAIL_UNAVAILABLE",
      "VERSION_CHANGED",
      "AUTH_SERVICE_UNAVAILABLE",
    ] as const,
  },

  /**
   * `ReviewAdminInvite` —— 双人复核（O-28 ⑥）
   *
   * ⚠ **组织内只有一名管理员时该邀请停在待批队列**，提示需平台运营方协助——
   *   **不得因无人复核而退化为单人可批**，否则规则形同虚设。
   *   ⇒ 契约面的表现是：这里**没有**「唯一管理员可自批」的入参分支。
   */
  reviewAdminInvite: {
    method: "POST",
    path: "/organizations/:orgId/invites/:inviteId/review",
    in: z
      .object({
        orgId: z.string(),
        inviteId: z.string(),
        decision: z.enum(["approve", "reject"]),
        reason: z.string().nullable(),
      })
      .strict(),
    out: z.object({ status: OrgInviteStatus, tokenIssued: z.boolean() }).strict(),
    err: [
      "INVITE_SELF_REVIEW_FORBIDDEN",
      "PROJECT_ROLE_INSUFFICIENT",
      "INVITE_NOT_FOUND",
      "VERSION_CHANGED",
      "AUTH_SERVICE_UNAVAILABLE",
    ] as const,
  },

  /**
   * `ResendOrgInvite` —— **重发 = 签发新令牌 + 作废旧令牌**（I-6）
   *
   * ⚠ 它**不是**「把同一条链接再发一次」，所以**不幂等**，
   *   故受 `RATE_LIMITED` 保护（`AUTH_POLICY.resendCooldownSeconds` / `resendDailyMax`）。
   */
  resendOrgInvite: {
    method: "POST",
    path: "/organizations/:orgId/invites/:inviteId/resend",
    in: z.object({ orgId: z.string(), inviteId: z.string() }).strict(),
    out: z.object({ newTokenIssued: z.boolean(), cooldownSec: z.number().int().nonnegative() }).strict(),
    err: [
      "RATE_LIMITED",
      "INVITE_NOT_FOUND",
      "PROJECT_ROLE_INSUFFICIENT",
      "MAIL_UNAVAILABLE",
      "VERSION_CHANGED",
      "AUTH_SERVICE_UNAVAILABLE",
    ] as const,
  },

  /** `RevokeOrgInvite` —— **撤销是幂等的**：重复撤销返回同一 `revoked` 状态 */
  revokeOrgInvite: {
    method: "POST",
    path: "/organizations/:orgId/invites/:inviteId/revoke",
    in: z.object({ orgId: z.string(), inviteId: z.string() }).strict(),
    out: z.object({ status: OrgInviteStatus }).strict(),
    err: ["INVITE_NOT_FOUND", "PROJECT_ROLE_INSUFFICIENT", "VERSION_CHANGED", "AUTH_SERVICE_UNAVAILABLE"] as const,
  },

  /**
   * `ActivateOrgMember` —— 受邀人点开激活链接
   *
   * 🔴 **本用例最大的越权面**：链接里明文写着组织与角色，客户端可改。
   *   ⇒ 请求里携带的 `orgId` / `orgRole` / `teamId` **一律忽略**，
   *     实际授予恒为**服务端记录值**（I-2），篡改尝试写安全审计。
   *   ⇒ 契约面的落地：`in` 里**根本没有**这三个字段。
   *     「忽略一个字段」是实现纪律（会被忘），「字段不存在」是契约事实。
   *
   * ⚠ 部分成功**禁止**：核销令牌 + 建 `org_member` + 写角色团队 + 初始化配额
   *   必须在**同一事务**内（I-1）。事务失败后 token 仍未核销。
   * ⚠ 幂等重放：同一 token 第二次调用返回 `INVITE_NOT_FOUND`，**不返回「已激活成功」**。
   * ⚠ 口令策略复用 phase-00（`AUTH_POLICY.passwordMinLen` + 弱口令库），**不另写一份**。
   */
  activateOrgMember: {
    method: "POST",
    path: "/org-invites/activate",
    in: z
      .object({
        token: z.string().min(1),
        mode: z.enum(["new-account", "existing-account"]),
        /** 仅 `new-account`。⚠ 口令长度门槛读 `AUTH_POLICY.passwordMinLen`，不在此写死 */
        profile: z.object({ name: z.string().min(1), password: z.string() }).strict().nullable(),
        /** 仅 `existing-account` */
        sessionId: z.string().nullable(),
      })
      .strict(),
    out: z
      .object({
        userId: z.string(),
        orgId: z.string(),
        orgRole: OrgRole,
        teamId: z.string(),
        sessionId: z.string(),
      })
      .strict(),
    err: ["INVITE_NOT_FOUND", "INVITE_ALREADY_MEMBER", "VERSION_CHANGED", "AUTH_SERVICE_UNAVAILABLE"] as const,
  },

  /**
   * `MutateTeam` —— 团队增 / 删 / 改（O-29 ④）
   *
   * ⚠ **rename 不改 id**，已有 `acl_binding` 不受影响；**不做级联删除**。
   * ⚠ 删除被占用的团队时，`TEAM_IN_USE` 的响应**必须列出占用项**（I-7）——
   *   一个只说「删不掉」的错误会让管理员去猜是谁在用。
   *   ⇒ 占用项作为 `out.blocked` 返回**同时**抛该码：错误体带结构化数据是本束的形状。
   */
  mutateTeam: {
    method: "POST",
    path: "/organizations/:orgId/teams",
    in: z
      .object({
        orgId: z.string(),
        op: TeamOp,
        /** `create` 时为 null */
        teamId: z.string().nullable(),
        /** `delete` 时为 null */
        name: z.string().nullable(),
      })
      .strict(),
    out: z
      .object({
        team: z.object({ teamId: z.string(), name: z.string() }).strict().nullable(),
        /** 仅 `delete` 被阻断时非空。⚠ `items` **不得为空数组**——空数组等于没说明原因 */
        blocked: z
          .object({
            memberCount: z.number().int().nonnegative(),
            aclBindingCount: z.number().int().nonnegative(),
            items: z.array(z.object({ kind: z.string(), id: z.string(), label: z.string() }).strict()),
          })
          .strict()
          .nullable(),
      })
      .strict(),
    err: ["TEAM_IN_USE", "PROJECT_ROLE_INSUFFICIENT", "VERSION_CHANGED", "AUTH_SERVICE_UNAVAILABLE"] as const,
  },

  /**
   * `listTeams` —— 团队列表只读（#639 delta，迭代 1）
   *
   * ⚠ 本轮组织管理页"团队"标签页只需要**列表**，CRUD（`mutateTeam`）动作留空/禁用态，
   *   迭代 2 再接前端。任何有组织成员资格的人都可以读列表——这是查看，不是管理动作，
   *   不复用 `mutateTeam` 的 admin-only 授权收窄（见该 delta §4①，仅约束写操作）。
   *
   * `memberCount` **现查** `COUNT(*) FROM org_memberships WHERE team_id = $1`，
   *   不额外维护计数列——避免引入第二份"团队人数"事实源（delta §2）。
   */
  listTeams: {
    method: "GET",
    path: "/organizations/:orgId/teams",
    in: z.object({ orgId: z.string() }).strict(),
    out: z.object({
      teams: z.array(z.object({
        teamId: z.string(), name: z.string(), memberCount: z.number().int().nonnegative(),
      }).strict()),
    }).strict(),
    err: ["NO_ORG_MEMBERSHIP", "AUTH_SERVICE_UNAVAILABLE"] as const,
  },

  /**
   * `RemoveOrgMember` —— 移除组织成员（O-29 ②）
   *
   * ⚠ **与 UC-17.2 的授权撤回结果相反，不得共用代码路径**：
   *   这里是「停用访问」，那里是「删除数据」。
   * ⚠ **停用访问 ≠ 删除产出**（I-8）：历史产出保留并归属组织、**署名保留**，
   *   界面显示「已离职」标记而非匿名化——匿名化会让历史决策失去可问责性。
   * ⚠ 路由是 `POST …/remove` 不是 `DELETE`：见 `ORG_ADMIN_FORBIDDEN_ROUTES` 的长注。
   * ⚠ `out.pendingTasks` 是**契约的一部分**：确认弹窗要显示「他还负责着哪些未完成任务」。
   */
  removeOrgMember: {
    method: "POST",
    path: "/organizations/:orgId/members/:userId/remove",
    in: z.object({ orgId: z.string(), userId: z.string() }).strict(),
    out: z
      .object({
        revokedSessions: z.number().int().nonnegative(),
        revokedInvites: z.number().int().nonnegative(),
        quotaReleased: z.number().int().nonnegative(),
        pendingTasks: z.array(z.object({ kind: z.string(), id: z.string(), label: z.string() }).strict()),
      })
      .strict(),
    err: ["PROJECT_ROLE_INSUFFICIENT", "VERSION_CHANGED", "AUTH_SERVICE_UNAVAILABLE"] as const,
  },

  /* ══ 一.五、组织资料 + 成员/邀请列表读（#363 delta，org-profile-membership）════ */

  /**
   * `listOrgMembers` —— 成员列表只读（delta §2：任何组织成员可读，不限 admin）。
   *
   * ⚠ delta §4① 的裁决落在这里：与 `listTeams` 同一处置——「看到组织里有谁」不是
   *   敏感操作，比它更敏感的操作（改角色、移除成员）本来就已经有 admin 限制。
   * ⚠ `err` 用 `NO_ORG_MEMBERSHIP`（非成员）而不是 delta 草案里写的泛化 `FORBIDDEN`——
   *   本束目前没有字面量 `FORBIDDEN` 这个码，`NO_ORG_MEMBERSHIP` 是同语义的既有码
   *   （`listTeams.err` 的先例）；见文件头「同一事实不得声明在两处」。
   */
  listOrgMembers: {
    method: "GET",
    path: "/organizations/:orgId/members",
    in: z.object({ orgId: z.string() }).strict(),
    out: z
      .object({
        members: z.array(
          z
            .object({
              userId: z.string(),
              displayName: z.string(),
              email: z.string(),
              orgRole: OrgRole,
              teamId: z.string().nullable(),
              joinedAt: z.string(),
              status: z.enum(["active", "suspended"]),
            })
            .strict(),
        ),
      })
      .strict(),
    err: ["NO_ORG_MEMBERSHIP", "AUTH_SERVICE_UNAVAILABLE"] as const,
  },

  /**
   * `listOrgInvites` —— 邀请列表只读（delta §2：**仅组织 admin**，与成员列表权限不同）。
   *
   * ⚠ delta §4① 逐字：「未接受的邀请邮箱是否该让所有成员看到」——裁决收紧为仅
   *   admin，与 `listOrgMembers` **不共用同一条授权判定**（用例层各自判一次）。
   * ⚠ `err` 同上一条的映射理由：`PROJECT_ROLE_INSUFFICIENT` 是「是成员但不是 admin」
   *   的既有码（`mutateTeam.err` 的先例），`NO_ORG_MEMBERSHIP` 是「根本不是成员」。
   */
  listOrgInvites: {
    method: "GET",
    path: "/organizations/:orgId/invites",
    in: z.object({ orgId: z.string() }).strict(),
    out: z
      .object({
        invites: z.array(
          z
            .object({
              inviteId: z.string(),
              email: z.string(),
              status: OrgInviteStatus,
              invitedBy: z.string(),
              expiresAt: z.string(),
            })
            .strict(),
        ),
      })
      .strict(),
    err: ["NO_ORG_MEMBERSHIP", "PROJECT_ROLE_INSUFFICIENT", "AUTH_SERVICE_UNAVAILABLE"] as const,
  },

  /**
   * `uploadOrgAvatar` —— 组织头像上传的**第一步**（delta §1 ⚠②：同 `uploadOwnAvatar` 的
   * 纪律——对象存储 + PG 元数据，服务端重新做 magic-byte 嗅探，不信任客户端声明的
   * `contentType`/`sizeBytes`）。仅落对象存储与一张归属登记表，**不写 `organizations`
   * 行本身**——真正生效要靠第二步 `updateOrganization` 带着这里返回的
   * `orgAvatarArtifactId` 提交（与 `identity.updateOwnProfile` 的两步形状一致）。
   *
   * ⚠ 契约的 `in` 只有声明的元数据，**没有字节字段**——zod 只能验证 JSON 请求体，
   *   图片字节走请求的原始二进制体（`Content-Type` = 声明的 `contentType`），
   *   元数据经查询串传入后按本 schema 校验。这是一处记录在案的裁定（同
   *   `KNOWN_CONTRACT_GAPS` 的既有先例，如 F04 对 `saveDraft` 的处理），不是绕过——
   *   controller 侧的实现与理由见 `apps/api/src/interface/controllers/
   *   org-admin-management.controller.ts` 的 `uploadAvatar` 方法。
   */
  uploadOrgAvatar: {
    method: "POST",
    path: "/organizations/:orgId/avatar",
    in: z
      .object({
        orgId: z.string(),
        filename: z.string().min(1),
        sizeBytes: z
          .number()
          .int()
          .positive()
          .max(5 * 1024 * 1024),
        sha256: z.string(),
        contentType: z.enum(["image/png", "image/jpeg", "image/webp"]),
      })
      .strict(),
    out: z.object({ orgAvatarArtifactId: z.string(), avatarUrl: z.string() }).strict(),
    err: ["NO_ORG_MEMBERSHIP", "PROJECT_ROLE_INSUFFICIENT", "FILE_TOO_LARGE", "UNSUPPORTED_CONTENT_TYPE"] as const,
  },

  /**
   * `updateOrganization` —— 组织资料编辑（名称/简介/头像提交），**仅组织 admin**
   * （delta §2，与 team-crud 先例一致）。
   *
   * ⚠ 简介**纯文本**（delta §4②裁决），前端不做 markdown 渲染，服务端也不做任何
   *   HTML/markdown 转换——存什么就是什么，长度上限 500 由 schema 断言。
   */
  updateOrganization: {
    method: "PATCH",
    path: "/organizations/:orgId",
    in: z
      .object({
        orgId: z.string(),
        name: z.string().min(1).optional(),
        description: z.string().max(500).optional(),
        avatarArtifactId: z.string().nullable().optional(),
      })
      .strict(),
    out: z
      .object({
        name: z.string(),
        description: z.string().nullable(),
        avatarUrl: z.string().nullable(),
      })
      .strict(),
    err: ["NO_ORG_MEMBERSHIP", "PROJECT_ROLE_INSUFFICIENT", "AVATAR_ARTIFACT_NOT_OWNED"] as const,
  },

  /* ══ 二、项目邀请链接（UC-1.3）══════════════════════════════ */

  /**
   * `UpsertParticipantRoster` —— 按邮箱/手机号批量邀请
   *
   * ⚠ **部分成功是一等返回形态**（E3）：格式非法 / 重复项逐条标出并允许改正后重提，
   *   **不整批失败，也不静默丢弃**。所以 `out` 三段齐全，`err` 里**没有**「批量失败」的码。
   */
  upsertParticipantRoster: {
    method: "POST",
    path: "/projects/:projectId/participants",
    in: z
      .object({
        projectId: z.string(),
        /** 「邮箱或手机号，逗号分隔」拆开后的数组 */
        recipients: z.array(z.string()),
        identity: ParticipantIdentityChoice,
      })
      .strict(),
    out: z
      .object({
        created: z.array(ParticipantRef),
        /** 按 A2 去重掉的原始值 */
        deduped: z.array(z.string()),
        invalid: z.array(z.object({ value: z.string(), reason: z.string() }).strict()),
      })
      .strict(),
    err: ["NO_PROJECT_ROLE", "PROJECT_ROLE_INSUFFICIENT", "VERSION_CHANGED", "AUTH_SERVICE_UNAVAILABLE"] as const,
  },

  /**
   * `IssueInviteLink` —— 签发主链接 / 分组链接 / 邀请码
   *
   * ⚠ 幂等：同 `(projectId, kind, groupId, identity, validity)` 返回**同一条**有效链接，
   *   不每次新签——否则「单条撤销」会被稀释成「撤销其中一条」。
   * ⚠ `token` 恒非空（I-10）；`?r=member` 只是展示层可读参数，
   *   **权威在服务端的 `linkId → projectRole` 映射**。
   * ⚠ **观察者的只读约束落在服务端角色判定上**（identity 束 `authorize`），
   *   **不为链接单做一套过滤**——两处会漂移。
   * ⚠ 邀请码长度读 `AUTH_POLICY.inviteCodeLength`，**本束不写死**。
   */
  issueInviteLink: {
    method: "POST",
    path: "/projects/:projectId/invite-links",
    in: z
      .object({
        projectId: z.string(),
        kind: InviteLinkKind,
        /** `kind: "group"` 时非空 */
        groupId: z.string().nullable(),
        identity: ParticipantIdentityChoice,
        validity: InviteLinkValidity,
      })
      .strict(),
    out: z
      .object({
        linkId: z.string(),
        url: z.string(),
        /** ⚠ 恒非空（I-10）。没有令牌的链接不是链接，是一个公开入口 */
        token: z.string().min(1),
        inviteCode: z.string().nullable(),
        qrPayload: z.string().nullable(),
      })
      .strict(),
    err: ["NO_PROJECT_ROLE", "PROJECT_ROLE_INSUFFICIENT", "VERSION_CHANGED", "AUTH_SERVICE_UNAVAILABLE"] as const,
  },

  /**
   * `BroadcastInvites` —— 群发
   *
   * 🔴 **不得把部分失败呈现为整批成功**（E4）。`delivered` 与 `failed` **同时**返回，
   *   失败项可单条重试。`PARTIAL_DELIVERY` 在 `err` 里，是为了让「整批成功」在契约上不合法。
   * ⚠ 渠道与模板尚未定（uc-1-3 R10 `[待确认]`）→ `KNOWN_CONTRACT_GAPS.OA5`。
   */
  broadcastInvites: {
    method: "POST",
    path: "/projects/:projectId/invite-links/broadcast",
    in: z
      .object({ projectId: z.string(), participantIds: z.array(z.string()), channel: BroadcastChannel })
      .strict(),
    out: z
      .object({
        delivered: z.array(z.string()),
        failed: z.array(z.object({ id: z.string(), reason: z.string() }).strict()),
      })
      .strict(),
    err: [
      "PARTIAL_DELIVERY",
      "SMS_UNAVAILABLE",
      "MAIL_UNAVAILABLE",
      "RATE_LIMITED",
      "PROJECT_ROLE_INSUFFICIENT",
    ] as const,
  },

  /**
   * `RevokeInviteLink` / `ResetAllInviteLinks` —— **一个操作两个语义**（`linkId` 省略 = 重置全部）
   *
   * ⚠ **撤销作用于令牌，不作用于人**（I-12 ~ I-15）：
   *   · 新访问 ≤5 秒内失效
   *   · **已在场者不被立即踢出**，其 `LiveSession` 保留至 `survivesUntilStageId` 结束
   *   · `[重置全部]` 与逐人移出**立即生效，不等环节结束**（紧急手段）
   * ⚠ `out.onsiteSessions` 是**契约的一部分**：二次确认弹层要显示
   *   「已在场的 N 人不会被踢出，但这 M 条链接的新访问将立即失效」——
   *   没有这个数，那句话就得由前端猜。
   */
  revokeInviteLink: {
    method: "POST",
    path: "/projects/:projectId/invite-links/revoke",
    in: z.object({ projectId: z.string(), linkId: z.string().nullable() }).strict(),
    out: z
      .object({
        revokedLinkIds: z.array(z.string()),
        onsiteSessions: z.number().int().nonnegative(),
        /** null = 无在场会话需要保留到某环节结束 */
        survivesUntilStageId: z.string().nullable(),
      })
      .strict(),
    err: ["NO_PROJECT_ROLE", "PROJECT_ROLE_INSUFFICIENT", "VERSION_CHANGED", "AUTH_SERVICE_UNAVAILABLE"] as const,
  },

  /**
   * `GetCheckinBoard` —— 分组与签到
   *
   * ⚠ **管理面与现场面共用同一份数据**，不得实现成两套链接（uc-1-3 R8）。
   * ⚠ 观察者视角下 `roster` **不含任何手机号与令牌明文**（I-16），至多脱敏聚合。
   *   ⇒ `ParticipantRef.masked` 是脱敏值不是原值；这一条靠**投影**保证，不靠前端不渲染。
   * ⚠ 实时通道不可用时降级轮询并**显示「非实时」**——`realtime: false` 就是那个显示位。
   *   不得伪装已同步。
   */
  getCheckinBoard: {
    method: "GET",
    path: "/projects/:projectId/checkin-board",
    in: z.object({ projectId: z.string() }).strict(),
    out: z
      .object({
        groups: z.array(
          z
            .object({
              groupId: z.string(),
              title: z.string(),
              present: z.number().int().nonnegative(),
              total: z.number().int().nonnegative(),
              links: z.array(z.object({ url: z.string(), qrPayload: z.string().nullable() }).strict()),
              roster: z.array(
                z.object({ alias: z.string(), attendance: z.enum(["present", "absent"]) }).strict(),
              ),
            })
            .strict(),
        ),
        overall: z
          .object({ present: z.number().int().nonnegative(), total: z.number().int().nonnegative() })
          .strict(),
        /** false = 已降级为轮询，界面**必须**显示「非实时」 */
        realtime: z.boolean(),
      })
      .strict(),
    err: ["NO_PROJECT_ROLE", "PROJECT_ROLE_INSUFFICIENT", "AUTH_SERVICE_UNAVAILABLE"] as const,
  },

  /* ══ 三、免注册进场（UC-1.2）════════════════════════════════ */

  /**
   * `RequestJoinCode` —— 落地页填手机号取验证码
   *
   * ⚠ 验证码仅用于**证明手机号本人持有**，**不构成账号认证**，
   *   且**不得用于登录正式账号**（正式登录只走 phase-00 auth）。
   * ⚠ 三种链接失效对参与者渲染为**同一句**「找引导师重发」，
   *   不泄露该项目/组是否存在（E1）——三个码在契约上分开，在**呈现上合并**。
   * ⚠ 频率上限阈值见 `AUTH_POLICY`，本束不另立数值。
   */
  requestJoinCode: {
    method: "POST",
    path: "/live/join-code",
    in: z.object({ linkToken: z.string().min(1), phone: z.string().min(1) }).strict(),
    out: z
      .object({
        sent: z.literal(true),
        /** 例：`138 •••• 2049`。⚠ **不回显原值** */
        maskedPhone: z.string(),
        cooldownSec: z.number().int().nonnegative(),
      })
      .strict(),
    err: [
      "LINK_TOKEN_REQUIRED",
      "LINK_REVOKED",
      "LINK_EXPIRED",
      "LINK_ALREADY_USED",
      "RATE_LIMITED",
      "SMS_UNAVAILABLE",
    ] as const,
  },

  /**
   * `JoinByGroupLink` —— 免注册进场（D-01 名单实名 + O-06 令牌）
   *
   * 🔴 **两个条件同时成立才放行**（I-19）：令牌有效 ∧ 手机号在本场名单内。
   *   只验令牌 = 链接一转发全网可进；只验名单 = 令牌成了装饰。
   * ⚠ **不创建账号**（I-18）——验收断言是「账号表行数前后相等」，不是「界面没跳注册」。
   * ⚠ 落地组号恒取**名单条目**的 `groupId`（I-20）；打开别组链接**不报错**，
   *   `redirectedFromLinkGroup = true` 并提示「你在第 2 组」（AC3）。
   * ⚠ 已是组织成员者直接免登，其项目角色仍由链接授予，
   *   **不因组织角色自动升级**（承接「管理员不是超级用户」）。
   * ⚠ 部分成功**禁止**：建身份 + 授项目角色 + 写到场状态在同一事务。
   */
  joinByGroupLink: {
    method: "POST",
    path: "/live/join",
    in: z
      .object({
        linkToken: z.string().min(1),
        phone: z.string().nullable(),
        code: z.string().nullable(),
        /** 已是组织成员时走免登分支，不再要手机号 */
        existingSessionId: z.string().nullable(),
      })
      .strict(),
    out: z
      .object({
        guestIdentityId: z.string(),
        projectId: z.string(),
        groupId: z.string(),
        projectRole: ProjectRole,
        alias: z.string(),
        stage: StagePosition,
        redirectedFromLinkGroup: z.boolean(),
      })
      .strict(),
    err: [
      "LINK_TOKEN_REQUIRED",
      "LINK_REVOKED",
      "LINK_EXPIRED",
      "LINK_ALREADY_USED",
      "PHONE_NOT_ON_ROSTER",
      "RATE_LIMITED",
      "SMS_UNAVAILABLE",
      "AUTH_SERVICE_UNAVAILABLE",
      "WITHDRAWAL_IN_PROGRESS",
    ] as const,
  },

  /**
   * `ApplyForJoin` —— 名单外访客申请加入
   *
   * ⚠ **批准前该访客不进入任何组、读不到任何内容**（I-21）——
   *   断言是「返回 0 行」而不是「界面上没渲染」。
   */
  applyForJoin: {
    method: "POST",
    path: "/live/join-applications",
    in: z.object({ linkToken: z.string().min(1), phone: z.string().min(1) }).strict(),
    out: z
      .object({ applicationId: z.string(), status: z.enum(["pending", "approved", "rejected"]) })
      .strict(),
    err: ["JOIN_PENDING_APPROVAL", "LINK_TOKEN_REQUIRED", "LINK_REVOKED", "LINK_EXPIRED", "RATE_LIMITED"] as const,
  },

  /** `ReviewJoinApplication` —— 引导师批准或拒绝。批准 = 写入名单并指定组号 */
  reviewJoinApplication: {
    method: "POST",
    path: "/projects/:projectId/join-applications/:applicationId/review",
    in: z
      .object({
        projectId: z.string(),
        applicationId: z.string(),
        decision: z.enum(["approve", "reject"]),
        /** `approve` 时必填 */
        groupId: z.string().nullable(),
      })
      .strict(),
    out: z
      .object({ applicationId: z.string(), status: z.enum(["pending", "approved", "rejected"]) })
      .strict(),
    err: ["PROJECT_ROLE_INSUFFICIENT", "VERSION_CHANGED", "AUTH_SERVICE_UNAVAILABLE"] as const,
  },

  /**
   * `ResumeLiveSession` —— 掉线 / 换设备
   *
   * ⚠ **不依赖浏览器 Cookie**（I-23）：恢复凭据是「已验证手机号 + 名单条目」。
   *   依赖 Cookie 的实现在换设备时必然失败，而那正是本用例存在的理由。
   * ⚠ 换设备接管后**旧设备会话立即失效并提示**。
   */
  resumeLiveSession: {
    method: "POST",
    path: "/live/resume",
    in: z
      .object({
        linkToken: z.string().min(1),
        phone: z.string().min(1),
        code: z.string().min(1),
        deviceId: z.string().min(1),
      })
      .strict(),
    out: z
      .object({
        guestIdentityId: z.string(),
        groupId: z.string(),
        stage: StagePosition,
        /** 被接管的旧设备；null = 未发生接管 */
        takeoverOf: z.string().nullable(),
      })
      .strict(),
    err: [
      "LINK_TOKEN_REQUIRED",
      "LINK_REVOKED",
      "LINK_EXPIRED",
      "LINK_ALREADY_USED",
      "PHONE_NOT_ON_ROSTER",
      "RATE_LIMITED",
      "SMS_UNAVAILABLE",
      "AUTH_SERVICE_UNAVAILABLE",
      "WITHDRAWAL_IN_PROGRESS",
    ] as const,
  },

  /**
   * `SetMicrophoneState` —— 麦克风开关
   *
   * ⚠ **拒绝或关闭麦克风不阻断进场**（I-25），只关闭本人语音转写；
   *   工作台需**常驻可见**的开关与当前状态。
   *   ⇒ `transcribing` 与 `enabled` 是**两个布尔**：麦克风开着但转写服务挂了是一种真实状态。
   */
  setMicrophoneState: {
    method: "POST",
    path: "/live/microphone",
    in: z.object({ guestIdentityId: z.string(), enabled: z.boolean() }).strict(),
    out: z.object({ enabled: z.boolean(), transcribing: z.boolean() }).strict(),
    err: ["NO_PROJECT_ROLE", "AUTH_SERVICE_UNAVAILABLE"] as const,
  },

  /**
   * `ArchiveGuestIdentities` —— 项目结束，免注册身份自动归档
   *
   * ⚠ 归档后该身份**不可再进场**，其产出仍按项目留存策略保留并可追溯到名单条目（I-24）。
   *   归档**不是删除**（同 `project.archiveProject` 的取向）。
   */
  archiveGuestIdentities: {
    method: "POST",
    path: "/projects/:projectId/guest-identities/archive",
    in: z.object({ projectId: z.string() }).strict(),
    out: z.object({ archived: z.number().int().nonnegative() }).strict(),
    err: ["VERSION_CHANGED", "AUTH_SERVICE_UNAVAILABLE"] as const,
  },

  /**
   * `WithdrawParticipantPhone` —— 手机号纳入撤回与删除范围（D-01 + D-13/D-15）
   *
   * ⚠ **两个时限一律引用 D-13/D-15 的单一事实源**（`apps/web/lib/withdrawal-flow.ts`，
   *   由 `lint-withdrawal-flow.mjs` 门控），**本束不另立数值**——
   *   撤回链 SLA 已经是本仓五次「同一事实两处声明」中的一次。
   * ⚠ 级联引擎本体属 22-files 与 17-gov，本束只负责**触发与手机号接入**。
   * ⚠ `ackImpact` 必须为 true：界面须先展示影响范围并由本人勾选。
   *   ⇒ 用 `z.literal(true)` 而不是 `z.boolean()`：**false 在契约上就不合法**。
   */
  withdrawParticipantPhone: {
    method: "POST",
    path: "/projects/:projectId/participants/:participantId/withdraw",
    in: z
      .object({
        projectId: z.string(),
        participantId: z.string(),
        requestedBy: z.enum(["data-subject", "facilitator"]),
        ackImpact: z.literal(true),
      })
      .strict(),
    out: z
      .object({
        queuedAt: z.string(),
        /** ⚠ 两个 deadline 的**数值**来自 withdrawal-flow 单源，此处只搬运不定义 */
        logicalRetireDeadline: z.string(),
        physicalDeleteDeadline: z.string(),
        affectedReportSegments: z.array(z.object({ kind: z.string(), id: z.string() }).strict()),
      })
      .strict(),
    err: ["WITHDRAWAL_IN_PROGRESS", "NO_PROJECT_ROLE", "AUTH_SERVICE_UNAVAILABLE"] as const,
  },

  /* ══ 四、角色可见性与管理员边界（UC-1.4）══════════════════════ */

  /**
   * `RenderRoleView` —— 同一套屏按项目角色裁剪
   *
   * ⚠ **本操作不抛错**（usecases.md 逐字）：无权限时返回 `allowed=false` 的
   *   `PermissionDecision`——沿用 identity 束的取向，**鉴权结果是可解释的数据不是异常**。
   *   ⇒ `err` 是空数组。这不是「作者没想过失败模式」，是这条设计本身。
   * ⚠ **越权字段在响应体中键不存在**（I-27），不是置空、不是前端隐藏。
   *   ⇒ `visibleBlocks` / `actionEndpoints` 是**白名单数组**而不是带 `visible` 布尔的全集。
   * ⚠ 观察者的 `actionEndpoints` **恒为空集**（I-26）。
   * ⚠ `roleBanner` 同时显示两层身份「顾问 · 能源组 ｜ 本项目：组长 · 第 2 组」——
   *   **原型未画，需补**（签核第 ① 件的待补项）。
   */
  renderRoleView: {
    method: "GET",
    path: "/projects/:projectId/role-view",
    in: z.object({ projectId: z.string(), orgId: z.string(), screen: z.string() }).strict(),
    out: z
      .object({
        /** 四种角色**同一套**骨架——裁剪的是块与端点，不是屏 */
        skeleton: z.object({ screen: z.string(), slots: z.array(z.string()) }).strict(),
        visibleBlocks: z.array(z.string()),
        actionEndpoints: z.array(z.string()),
        roleBanner: z
          .object({
            orgRole: OrgRole.nullable(),
            teamName: z.string().nullable(),
            projectRole: ProjectRole.nullable(),
            groupLabel: z.string().nullable(),
          })
          .strict(),
        decision: PermissionDecision,
      })
      .strict(),
    err: [] as const,
  },

  /**
   * `PreviewAsRole` —— 视角切换器
   *
   * 🔴 **切换视角不改数据，只改可见范围**（I-30）：
   *   · **不得因此获得任何超出真实角色的读权**
   *   · **不得以被预览角色的身份写入** —— 预览态下全部写端点返回 `PROJECT_ROLE_INSUFFICIENT`
   *   · 预览动作本身留痕
   * ⚠ 第二条是最容易漏的：一个「只改前端渲染」的实现在读侧全绿，
   *   而写侧会真的以引导师身份写下去。
   */
  previewAsRole: {
    method: "GET",
    path: "/projects/:projectId/role-view/preview",
    in: z.object({ projectId: z.string(), asRole: ProjectRole }).strict(),
    out: z
      .object({
        skeleton: z.object({ screen: z.string(), slots: z.array(z.string()) }).strict(),
        visibleBlocks: z.array(z.string()),
        /** ⚠ 预览态下这里可以非空（被预览角色看得见按钮），但**调用它们必拒** */
        actionEndpoints: z.array(z.string()),
        previewing: z.literal(true),
        exitTo: z.string(),
        auditEventId: z.string(),
      })
      .strict(),
    err: ["PROJECT_ROLE_INSUFFICIENT", "AUTH_SERVICE_UNAVAILABLE"] as const,
  },

  /**
   * `GrantTemporaryAccess` —— 临时提权，按议程环节自动失效
   *
   * ⚠ 失效条件是**流程节点不是时间点**（I-28）。写成 `expiresAt: timestamp` 就错了：
   *   环节被提前结束时时间戳还没到，权限还在。
   * ⚠ 授予、每次使用、失效**三个时刻**都写审计；失效事件通知授予人。
   */
  grantTemporaryAccess: {
    method: "POST",
    path: "/projects/:projectId/temporary-access",
    in: z
      .object({
        projectId: z.string(),
        subjectId: z.string(),
        object: z.object({ kind: z.string(), id: z.string() }).strict(),
        /** ⚠ **环节 id 不是时间戳**——这是本用例的核心形状 */
        expiresAtStageId: z.string(),
      })
      .strict(),
    out: z.object({ grantId: z.string(), auditEventId: z.string() }).strict(),
    err: [
      "PROJECT_ROLE_INSUFFICIENT",
      "STAGE_GRANT_EXPIRED",
      "VERSION_CHANGED",
      "AUTH_SERVICE_UNAVAILABLE",
    ] as const,
  },

  /**
   * `ExpireTemporaryAccess` —— **服务端在环节状态机变更时主动收回**
   *
   * 🔴 **不得依赖前端或定时轮询兜底**（I-28）。这是一个由 `StageEventSource`
   *   驱动的入站操作，不是用户动作。
   * ⚠ **四种终止方式各一条断言**：`completed` / `skipped` / `merged` / `early-ended`。
   *   只测第一种会漏掉三条路径，而后三条正是「非正常结束」——权限最该被收回的时候。
   * ⚠ 反向断言同样必须写：**环节仍进行时该权限有效**。
   *   没有它，一个「从不授权」的实现在四条正向断言下全绿。
   */
  expireTemporaryAccess: {
    method: "POST",
    path: "/projects/:projectId/temporary-access/expire",
    in: z.object({ projectId: z.string(), stageId: z.string(), terminationKind: StageTerminationKind }).strict(),
    out: z
      .object({ expiredGrantIds: z.array(z.string()), auditEventIds: z.array(z.string()) })
      .strict(),
    err: ["PROJECT_ROLE_INSUFFICIENT", "STAGE_GRANT_EXPIRED", "VERSION_CHANGED", "AUTH_SERVICE_UNAVAILABLE"] as const,
  },

  /**
   * `RecordAdminProjectAccess` —— 管理员权力边界（D-18）
   *
   * 🔴 **这条的断言方向被 O-04 反转过一次。照旧稿写 `expect(403)` 会写出方向错误的绿灯。**
   *   · `purpose: "audit"` ⇒ **放行 + 留痕**（本操作返回 200 与 `logId`）
   *   · `purpose: "work"`（管理员在无项目角色的项目里做常规内容读取）⇒ `ADMIN_NOT_SUPERUSER`
   *   两条都要断言。只断言后者，那条审计读取路径可以从来没被实现过而测试全绿。
   * ⚠ 管理员每次项目层读取产生**恰好一条**日志，且该条**同时**对项目负责人与管理员本人可见
   *   （I-29）——三方查询查到的是**同一条**，不是三份副本。
   */
  recordAdminProjectAccess: {
    method: "POST",
    path: "/projects/:projectId/admin-access-log",
    in: z
      .object({ projectId: z.string(), objectRef: z.string(), purpose: z.enum(["work", "audit"]) })
      .strict(),
    out: z.object({ logId: z.string() }).strict(),
    err: ["ADMIN_NOT_SUPERUSER", "NO_PROJECT_ROLE", "AUTH_SERVICE_UNAVAILABLE"] as const,
  },

  /** `ListMyAccessLog` —— 管理员看自己读过谁。⚠ 与下一个操作查到的是同一批行 */
  listMyAccessLog: {
    method: "GET",
    path: "/admin-access-log/mine",
    in: z.object({}).strict(),
    out: z.object({ entries: z.array(AdminAccessLogEntry) }).strict(),
    err: ["NO_ORG_MEMBERSHIP", "AUTH_SERVICE_UNAVAILABLE"] as const,
  },

  /**
   * `ListProjectAccessLog` —— 「谁读过我的项目」
   *
   * ⚠ 调用者是该项目的**项目负责人**。
   * ⚠ **原型未画，需补**（uc-1-4 R8）——签核第 ① 件的待补项，不是本文件能补的。
   * ⚠ 「个人层只见计数」不在本束重复声明（phase-00 identity I-8）；
   *   `PERSONAL_LAYER_CLOSED` 出现在这里是因为管理员可能把个人层对象当项目对象来查。
   */
  listProjectAccessLog: {
    method: "GET",
    path: "/projects/:projectId/admin-access-log",
    in: z.object({ projectId: z.string() }).strict(),
    out: z.object({ entries: z.array(AdminAccessLogEntry) }).strict(),
    err: ["PERSONAL_LAYER_CLOSED", "NO_PROJECT_ROLE", "PROJECT_ROLE_INSUFFICIENT", "AUTH_SERVICE_UNAVAILABLE"] as const,
  },

  /**
   * `ResolveResourceScope` —— 资源可见性范围过滤
   *
   * ⚠ 拒绝原因**必须标明是组织层限制**（`ORG_SCOPE_DENIED`），不是项目层（V6）——
   *   报成项目层会让人去项目成员页找，那里什么也改不了。
   * ⚠ 团队单一归属（O-12）⇒ 判定是**相等比较**不是集合包含。
   * ⚠ MCP 的「授权范围」（仅项目负责人 / 全体成员 / 待安全评审）是**另一套枚举**，
   *   **禁止与团队可见性合并成同一字段**。⇒ 本操作的 `out` 只带 `scopeLayer`，不碰 MCP。
   * ⚠ 判定实现属 phase-00 identity 的 `authorize`；本操作是它在本束场景下的**调用契约**，
   *   **不是第二个实现**——所以 `out` 直接是 `PermissionDecision`，不另造形状。
   */
  resolveResourceScope: {
    method: "GET",
    path: "/organizations/:orgId/resource-scope",
    in: z
      .object({ orgId: z.string(), resource: z.object({ kind: z.string(), id: z.string() }).strict() })
      .strict(),
    out: PermissionDecision,
    err: ["ORG_SCOPE_DENIED", "AUTH_SERVICE_UNAVAILABLE"] as const,
  },

  /* ══ 五、设备与会话（UC-1.1）════════════════════════════════ */

  /**
   * `ListDeviceSessions`
   *
   * ⚠ **整块能力在原型中是「原型确认缺失」**（uc-1-1 R8 逐字）：
   *   30 天有效期、设备指纹、踢下线三项全部出自 `[Backlog]`。
   *   **在补画并裁决前不得当作已确认需求实现。** ⇒ `KNOWN_CONTRACT_GAPS.OA1`。
   * ⚠ 只能列/踢**自己**的会话——管理员踢别人是 `removeOrgMember` 的事，不是这里。
   */
  listDeviceSessions: {
    method: "GET",
    path: "/me/sessions",
    in: z.object({}).strict(),
    out: z
      .object({
        sessions: z.array(
          z
            .object({
              id: z.string(),
              device: z.string(),
              location: z.string().nullable(),
              lastActiveAt: z.string(),
              current: z.boolean(),
            })
            .strict(),
        ),
      })
      .strict(),
    err: ["NO_ORG_MEMBERSHIP", "AUTH_SERVICE_UNAVAILABLE"] as const,
  },

  /**
   * `KickDeviceSession`
   *
   * ⚠ 被踢会话的**下一次请求即失效**，不等自然过期；
   *   吊销是**写标记不是删行**（沿用 phase-00 auth I-7）——删行会让「被踢了」与
   *   「会话从来不存在」不可分辨，而用户需要分辨。
   * ⚠ `confirmed: z.literal(true)`：二次确认并说明影响范围，在契约上不可绕。
   */
  kickDeviceSession: {
    method: "POST",
    path: "/me/sessions/:targetSessionId/revoke",
    in: z.object({ targetSessionId: z.string(), confirmed: z.literal(true) }).strict(),
    out: z.object({ revokedAt: z.string(), affectedDevice: z.string() }).strict(),
    err: ["NO_ORG_MEMBERSHIP", "VERSION_CHANGED", "AUTH_SERVICE_UNAVAILABLE"] as const,
  },
} as const;

/**
 * 本束落地时撞到的契约缺口，逐条登记在契约自己身上。
 *
 * ⚠ 这不是 TODO 列表，是**需要人类签核才能补**的东西
 * （`design-signoff.md` 的 `status` 只能由人类改，agent 不许动）。
 */
export const KNOWN_CONTRACT_GAPS = {
  /**
   * **设备与会话整块（UC-1.1 / F03）是「原型确认缺失」。**
   * 30 天有效期、设备指纹、踢下线三项全部出自 `[Backlog]`，登录页与后台各屏
   * 已逐字段抽取、无任何设备/会话入口。`usecases.md` 自己写着
   * 「在补画并裁决前不得当作已确认需求实现」。
   * ⇒ `listDeviceSessions` / `kickDeviceSession` 的形状**是提案不是裁决**。
   */
  OA1: "device/session management (UC-1.1, F03) is 'prototype confirmed missing'; the 30-day validity, device fingerprint and kick-session capabilities all originate from [Backlog] and the two operations here are a proposal, not a ruling",
  /**
   * **「合规负责人」这个角色在四值项目角色枚举里缺位。**
   * `identity.OrgRole` 有 `compliance`（组织角色），`identity.ProjectRole` 只有四值。
   * `files` 束的待删除队列、legal hold 都要求「合规负责人」，本束的 `withdrawParticipantPhone`
   * 同样触及。**它是组织角色还是项目角色，没有出处。**
   * ⇒ 本束把撤回触发的 `pre` 留在 `NO_PROJECT_ROLE` 一档，**不发明第五个项目角色**。
   */
  OA2: "the 'compliance owner' actor required by withdrawal / legal-hold flows has no home: identity.OrgRole has `compliance` but identity.ProjectRole is a closed four-value set; whether it is an org role or a project role is unsourced",
  /**
   * **组织邀请链接的 7 天有效期 —— 2026-07-31 已裁：域常量即单一事实源，现状不动。**
   * （yanbin shen，经会话记录，2026-07-31T14:56:11+08:00）
   * 不并入 `AUTH_POLICY`：那会是第二处策略数值声明点，且 `AUTH_POLICY` 管的是
   * 认证凭据类策略（密码重置），邀请链接是组织管理类策略，语义域不同。
   * 权威落在 `apps/api/src/domain/auth/org-invite.ts` 与 `invite-link.ts` 各自的域常量，
   * 两处常量值须相等（已有断言钉住）。本条目保留在此仅作历史索引，不再是「待裁缺口」。
   */
  OA3: "[裁定] the 7-day org-invite link validity is authoritative as a domain constant in apps/api/src/domain/auth/{org-invite,invite-link}.ts; not merged into AUTH_POLICY (different policy domain: auth-credential vs org-management)",
  /**
   * **`?r=member` 这类展示层可读参数与服务端映射的关系，只在散文里说过。**
   * `usecases.md` 写「权威在服务端的 `linkId → projectRole` 映射」，
   * 但契约里**没有任何东西**能让「前端读了 `?r=` 就当真」这件事变红。
   * ⇒ 需要一条断言：同一 `linkId` 在 `?r=` 被篡改后授予的角色不变。本契约表达不了它。
   */
  OA4: "no contract-level assertion prevents trusting the display-only `?r=` query param; the 'authority is the server-side linkId→projectRole map' rule lives only in prose",
  /**
   * **群发的渠道与模板未定**（uc-1-3 R10 `[待确认]`，与 uc-1-2 的短信服务商同一条）。
   * `broadcastInvites.in.channel` 三取值是**形状上的占位**，不是裁决。
   */
  OA5: "broadcast channel/template is [待确认] (uc-1-3 R10); the three-value channel enum is a placeholder shape, not a ruling",
  /**
   * **两处「原型未画，需补」直接落在本束的响应体上。**
   * ① `renderRoleView.out.roleBanner` 的两层身份条；② `listProjectAccessLog` 的
   * 「谁读过我的项目」视图。两者的字段在这里已经定形，**但没有界面材料支撑**——
   * 签核第 ① 件通过时请一并确认，否则这是「后端契约在画界面时被顺手创造出来」的原样复现。
   */
  OA6: "two response shapes here (roleBanner two-layer identity strip; the project-owner 'who read my project' view) have no UI material — signoff item ① must cover them explicitly",
  /**
   * **`RATE_LIMITED` 的阈值在参与者侧（免注册进场）没有出处。**
   * `AUTH_POLICY.resendCooldownSeconds` / `resendDailyMax` 是**正式账号**侧的策略；
   * `usecases.md` 的 `RequestJoinCode` 明写「阈值见 domain [待定 B]」。
   * ⇒ 本束复用 `AUTH_POLICY` 是**取其默认值**，不是说两条策略已确认相同。
   */
  OA7: "the guest-side (registration-free entry) rate-limit thresholds are [待定 B]; reusing AUTH_POLICY here is taking its default, not a ruling that the two policies are the same",
  /**
   * **`once` 这一档有没有时间上限，没有出处。**
   * `InviteLinkValidity` 三档里，`24h` / `7d` 的时长写在成员名字本身
   * （`domain/auth/invite-link.ts` 直接解析字面量，因此不存在第二份数值），
   * 而 `once` 只说了「按次失效」。原型的有效期三档同样只有这三个选项、无时限说明。
   * ⇒ 实现取「一次性链接不按时间失效」，迁移 0025 有 CHECK 钉住
   *   `validity = 'once' ⇒ expires_at IS NULL`。**这是缺席不是裁定**：
   *   若安全上要求一次性链接也有兜底时限，那是新增一条策略数值，需人裁。
   */
  OA8: "whether a `once` invite link additionally expires by time is unsourced; 24h/7d carry their duration in the enum literal itself, `once` carries none, and the implementation takes 'no time bound' as the absence of a ruling, not as one",
  /**
   * **项目邀请码的长度与形态与 `AUTH_POLICY.inviteCodeLength` 对不上。**
   * `inviteCodeLength: 14` 的出处是 UC-1.5 / O-29 ①，那是**建组织**的邀请码；
   * 而原型上的项目邀请码 `KCK-8F21-EU24` 是 **12 个字母数字**分成 3 组、带连字符。
   * `issueInviteLink` 的注释要求「长度读 AUTH_POLICY.inviteCodeLength，本束不写死」，
   * 实现照办（生成 14 位），连字符仅作展示、不进库、不参与比较。
   * ⇒ **两个数字都有出处，出处不同**，需人裁：要么它们本来就是同一枚码，
   *   要么 `AUTH_POLICY` 需要第二个字段。agent 不在这里替人选边。
   */
  OA9: "the project invite code's length/shape is contradictory: AUTH_POLICY.inviteCodeLength = 14 comes from UC-1.5 (the org-creation code) while the prototype's project code `KCK-8F21-EU24` is 12 alphanumerics in three dashed groups; the implementation follows the contract's 'read AUTH_POLICY.inviteCodeLength' instruction and treats dashes as display-only",
  /**
   * **F11 落地时撞到的三处「契约里没有专属码/字段」，逐条裁定而不是发明新东西。**
   *
   * ① `removeOrgMember` 的 `pre`（`userId ≠ actorId`，不可自移）没有专属错误码——
   *    `err` 只有 `PROJECT_ROLE_INSUFFICIENT` / `VERSION_CHANGED` / `AUTH_SERVICE_UNAVAILABLE`
   *    三个。实现复用 `PROJECT_ROLE_INSUFFICIENT`（「你无权对这个目标执行这个操作」）。
   * ② `removeOrgMember` 与 `mutateTeam` 的 `in` 都**没有版本字段**，但 `err` 都声明了
   *    `VERSION_CHANGED`。实现把它映射到「目标（成员行 / teamId）在并发下已不存在」——
   *    对 `mutateTeam` 的 `rename`/`delete` 是「指向的 teamId 已被并发删除」；
   *    `removeOrgMember` 本身不需要这个映射（不存在即幂等重放，见下一条），
   *    该码在 `removeOrgMember` 上目前**没有可达路径**，是本次实现的诚实缺口。
   * ③ `removeOrgMember.out.pendingTasks` 恒为空数组——phase-01 还没有任务系统，
   *    同 `inviteOrgMember.quotaReserved`（F10）与 `revokeInviteLinks.onsiteSessions`
   *    （F15）的处置：空数组是「没有任务概念可查」这一真话，不是占位。
   *
   * 三条都需要人裁专属码/字段时才能真正关闭；agent 不在这里替人选边。
   */
  OA10: "F11: three 'contract has no dedicated code/field' gaps hit during implementation — (1) removeOrgMember's self-removal precondition reuses PROJECT_ROLE_INSUFFICIENT for lack of a dedicated code; (2) removeOrgMember/mutateTeam declare VERSION_CHANGED but their `in` carries no version token, so the implementation maps 'target vanished under concurrency' to it for mutateTeam's rename/delete and leaves it unreached on removeOrgMember (repeat removal is idempotent replay, not a version conflict); (3) removeOrgMember.out.pendingTasks is always [] because phase-01 has no task system yet, same treatment as inviteOrgMember.quotaReserved (F10) and revokeInviteLinks.onsiteSessions (F15)",
  /**
   * **org-profile-membership delta（#363）落地时撞到的四处裁定，逐条记录。**
   *
   * ① delta §1 草案的 `err` 写的是泛化 `FORBIDDEN`——本束里从未存在过这个字面量。
   *    `listOrgMembers`/`listOrgInvites`/`uploadOrgAvatar`/`updateOrganization` 全部
   *    改用既有码：非成员 `NO_ORG_MEMBERSHIP`（`listTeams` 先例），是成员但权限不够
   *    `PROJECT_ROLE_INSUFFICIENT`（`mutateTeam` 先例）——不新造第二套授权错误语义。
   * ② `uploadOrgAvatar.in` 只有声明的元数据（filename/sizeBytes/sha256/contentType），
   *    **没有字节字段**——zod 只验证 JSON 请求体，图片字节走请求的原始二进制体，
   *    元数据经查询串传入后按同一 schema 校验（controller 侧 `uploadAvatar` 方法有实现
   *    与理由）。这是记录在案的裁定，不是「以后再补」。
   * ③ `listOrgMembers.out` 要求 `joinedAt`/`status`，但 `org_memberships`（0003）当时
   *    没有这两列。迁移新增 `joined_at`（回填为迁移执行时刻，早于本次迁移的真实入会
   *    时间不可考——诚实缺口，不是精确值）；`status` 恒为 `"active"`——这张表目前没有
   *    「停用但保留记录」的概念（`removeOrgMember` 是硬删除该行），`"suspended"` 是
   *    契约里**当前没有任何路径能产生**的保留值，同 `TEMPLATE_SWITCH_FORBIDDEN_AFTER_START`
   *    的处置（T10）。
   * ④ `listOrgInvites.out.expiresAt` 非空，但 `org_invites` 表本身没有过期时间列——
   *    时效活在 `org_invite_tokens.expires_at`。实现取该邀请**最近一枚令牌**的
   *    `expires_at`；一枚令牌都未签发过的邀请（如 `awaiting-review`）取
   *    `created_at + ORG_INVITE_LINK_VALIDITY_MS`（domain/auth/org-invite.ts 的既有
   *    常量，OA3 已裁定为单一事实源）作为估计值，不新造第二份有效期数字。
   */
  OA11: "org-profile-membership delta (#363): (1) contract.md's draft used a literal 'FORBIDDEN' that never existed in this bundle's error vocabulary — implemented as NO_ORG_MEMBERSHIP (non-member, listTeams precedent) / PROJECT_ROLE_INSUFFICIENT (member but insufficient role, mutateTeam precedent); (2) uploadOrgAvatar.in carries metadata only, no bytes field — zod validates JSON only, image bytes travel as the request's raw binary body, metadata arrives via query string validated against the same schema; (3) listOrgMembers.out needs joinedAt/status but org_memberships (0003) had neither — migration adds joined_at backfilled to migration-run time (true historical join time is unrecoverable, an honest gap not a precise value), status is always 'active' since this table has no 'deactivated but recorded' concept (removeOrgMember hard-deletes the row) — 'suspended' is a reserved value with no reachable path today, same treatment as TEMPLATE_SWITCH_FORBIDDEN_AFTER_START (T10); (4) listOrgInvites.out.expiresAt is required but org_invites has no expiry column — implementation reads the invite's most recent org_invite_tokens.expires_at, falling back to created_at + ORG_INVITE_LINK_VALIDITY_MS (OA3's already-ruled single source) for invites that never had a token issued",
} as const;

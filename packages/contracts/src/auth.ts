/**
 * 契约束 `auth` — ③ API 契约（**唯一事实源**）
 *
 * ADR-020：这一份生成四样东西，任何一样都不许手写第二份——
 *   ├─→ 后端 DTO + `ZodBodyPipe` 的运行时校验
 *   ├─→ 前端 client 类型
 *   ├─→ OpenAPI
 *   └─→ 前端 mock 数据
 *
 * 覆盖 feature：**F19 F20 F21 F22**（12 点）
 * 领域模型见 `phases/phase-00-shared-kernel/contracts/auth/domain.md`
 * 用例接口见 同目录 `usecases.md`；R12 映射见 `coverage.md`
 *
 * ⚠ **本文件由 F19 与 F20/F21 并行写入。** 新增只许**追加**，不许改写他人段落。
 *   F20/F21 段：`login` / `requestPasswordReset` / `completePasswordReset`
 *   F19/F22 段：`registerNewAccount`（2026-08-24 前叫 `redeemInviteAndCreateOrg`，
 *   已被 open-self-serve-registration delta 移除并取代，见 issue #1929）/
 *   `switchOrgAtLogin`（见文件末尾占位）
 */
import { z } from "zod";
/**
 * ⚠ 跨束 import，且是刻意的（F22）。
 *
 * `switchOrgAtLogin` 的响应里那个「组织」与 `identity.switchOrganization` 返回的
 * **是同一个东西**——本用例只做会话侧的那一半然后调用它（usecases.md）。
 * 在这里重新写一遍 `z.object({ id, name, kind, ... })` 就是第二份副本，
 * 而漂移的方向已经有先例：`identity.Organization` 后来加了 `modelPolicy`，
 * 副本不会跟着加，于是同一个组织对象在两个端点上字段不一样，两边都不报错。
 */
import { Organization } from "./identity";

/* ─────────────────────── 策略常量（O-28 裁决，全仓唯一副本）─────────────────────── */

/**
 * O-28 / O-29 裁决出的认证策略数值。**这是全仓唯一一份。**
 *
 * ⚠ 收敛于 2026-07-29（F20）：这些数字原本在 `apps/web/lib/mock/entry.ts` 里
 * 手写了一份（`AUTH_POLICY`），而后端马上要写第二份。本项目已**五次**因
 * 「同一事实声明在两处」而漂移（设计 token / 字号档位 / 丢弃原因枚举 /
 * 撤回链 SLA / 估点），这将是第六次。⇒ 前端改为从这里 re-export，
 * 后端从这里 import，`apps/web/tests/single-source-of-truth.test.ts` 加机械门控。
 *
 * 出处逐条：
 * · `sessionDays`            UC-1.1 R3 第 2 步（[Backlog] 数字，非原型实测）
 * · `passwordMinLen`         O-28 ①（NIST 取向：长度 + 弱口令库 > 字符类组合）
 * · `resetLinkHours`         O-28 ④ + R10 链接有效期统一表
 * · `lockAfterFails` / `lockWindowMinutes` / `lockDurationMinutes`   O-28 ③
 * · `resendCooldownSeconds` / `resendDailyMax`                       O-28 ④
 * · `inviteCodeLength`       UC-1.5 / O-29 ①（原先只写在登录页组件的注释里）
 */
export const AUTH_POLICY = {
  sessionDays: 30,
  passwordMinLen: 12,
  resetLinkHours: 1,
  verificationLinkHours: 24,
  lockAfterFails: 5,
  lockWindowMinutes: 15,
  lockDurationMinutes: 15,
  resendCooldownSeconds: 60,
  resendDailyMax: 5,
  inviteCodeLength: 14,
  /**
   * 组织停用后数据保留多少天才销毁（O-29 ③ 的「留存期」，取值来自 **O-01 的材料保留期 180 天**）。
   *
   * ⚠ **这是全仓唯一一份，且刻意不在 SQL 里出现。**
   * `organizations.retention_until` 由 application 层算好再写库，
   * 迁移里**没有** `DEFAULT now() + interval '180 days'`——一旦有，它就是第二份副本，
   * 而漂移的方向是「有人改了 TS 常量，库里的默认值纹丝不动」，
   * 表现为**新停用的组织按新策略、旧代码路径按老策略**，两边都没有报错。
   * `tests/auth/org-disabled-readonly.test.ts` 断言库里落下的日期 = 本常量推出来的日期。
   *
   * ⚠ O-01 的裁决把留存期定成「可配置五参数」之一；这里写死 180 是**取其默认值**，
   * 参数化（按组织覆盖）不在 phase-00 范围，见 `KNOWN_CONTRACT_GAPS.C10`。
   */
  orgRetentionDays: 180,
} as const;

/* ─────────────────────────────── 枚举 ─────────────────────────────── */

/**
 * 统一失败枚举（usecases.md）。**封闭性是要守的性质，成员数不是**
 * （硬规则 7：`toHaveLength(n)` 会拦下一次经评审的正当新增）。
 *
 * ⚠ 三处刻意的「不可分辨」，每一处都是安全属性不是文案疏漏：
 * · `INVALID_CREDENTIAL`   邮箱不存在 **与** 密码错误共用（I-1）
 * · `INVITE_CODE_INVALID`  不存在 **与** 已核销共用（否则 14 位码的爆破空间被按命中率剪枝）
 * · `RESET_TOKEN_INVALID`  过期 **与** 伪造共用
 *
 * ⚠ 刻意**没有** `INVITE_CODE_REDEEMED` 与 `EMAIL_NOT_FOUND`。加回去就是枚举通道。
 */
export const AuthReason = z.enum([
  "INVALID_CREDENTIAL",
  "ACCOUNT_LOCKED",
  "EMAIL_NOT_VERIFIED",
  "INVITE_CODE_INVALID",
  "RESET_TOKEN_INVALID",
  "SESSION_EXPIRED",
  /** 与 SESSION_EXPIRED 分开：用户需要分辨「被踢了」还是「太久没用」 */
  "SESSION_REVOKED",
  "EMAIL_TAKEN",
  "VERIFICATION_LINK_INVALID",
  /** Redis / 认证依赖不可用。⚠ **一律拒绝，不得降级放行**（同 identity 的同名码） */
  "AUTH_SERVICE_UNAVAILABLE",
  /** 数据库已有任意账号；首用户无邀请码入口从此永久关闭。 */
  "BOOTSTRAP_UNAVAILABLE",

  /* ── F22 追加。⚠ 只许追加，不许改写上面的成员 ────────────────────────── */

  /**
   * 切到一个自己不属于的组织（usecases.md `SwitchOrgAtLogin.err` 明写这一条）。
   *
   * ⚠ 与 `identity.PermissionReason.NO_ORG_MEMBERSHIP` **同名但不是同一个枚举**。
   * 两个束的失败面本来就是两套（一个答「你是谁」、一个答「你能做什么」），
   * 而这条码在两处都被各自的 usecases.md 点名要求。不合并的理由：
   * 合并意味着 `auth` 要 import `identity` 的枚举，于是 auth 的失败面从此随 identity 变动，
   * 而 auth 是更内层的束。**同名是刻意的，含义也刻意一致**，
   * `tests/auth/multi-org-membership.test.ts` 断言两处的字面量相等——
   * 有第二份副本就必须有机械门控，这是那道门控。
   */
  "NO_ORG_MEMBERSHIP",

  /**
   * 组织已停用，处于只读降级（O-29 ③ / UC-1.5 V12 ①）。
   *
   * ⚠ 它**不是**鉴权失败：请求者的身份与角色都没问题，是**组织本身**被冻结了。
   * 分开一个码是因为界面要显示的是常驻的「组织已停用·只读」条，
   * 而不是「你没有权限」——后者会让管理员去找权限设置，那里什么也改不了。
   */
  "ORG_DISABLED",
]);

/** 口令被拒的原因。⚠ 刻意**没有** `MISSING_UPPERCASE` 之类——O-28 ① 明确不强制字符类 */
export const PasswordRejection = z.enum([
  "TOO_SHORT",
  /** 命中常见泄露口令字典 */
  "WEAK_COMMON",
]);

/* ─────────────────────────────── 实体 ─────────────────────────────── */

/**
 * 邮箱地址的**唯一**服务端权威校验形状（invite-link-and-reads delta，#638/#639 ③）。
 *
 * 本文件里所有 `z.string().email()` 的内联出现表达的就是这同一个事实；抽成具名
 * schema 是为了让**别的束**（org-admin `inviteOrgMember.in.email`）能引用同一份，
 * 而不是各自手写第二份「什么算邮箱」——那正是「同一事实声明在两处」的第七次候选。
 * ⚠ 刻意不自造更严的正则：zod `.email()` 已拒 `a@`、裸词、缺域名等垃圾输入，
 *   更严的那份没有出处，且会误伤合法的少见形状。
 */
export const EmailAddress = z.string().email();

/**
 * 凭据。**注意这里没有 `passwordHash`。**
 *
 * 契约描述的是**协议上会出现的形状**；口令哈希从不离开服务端，把它写进契约
 * 就等于宣布存在一条能读到它的路径。哈希的算法与参数是契约的一部分
 * （domain I-2），但它是**存储侧**的契约，声明在 migration 与 `PasswordHasher`
 * 端口上，不在这里。
 */
export const Credential = z.object({
  userId: z.string(),
  /** **唯一**，小写规范化后比较（domain 一节） */
  email: z.string().email(),
  /** null = 未验证。未验证不得登录（I-8 / UC-1.5 R7） */
  emailVerifiedAt: z.string().datetime().nullable(),
});

/**
 * 会话。
 *
 * ⚠ `revokedAt` 是**写标记不是删行**（I-7）：删了就再也查不出「谁在什么时候被踢的」，
 * 而那正是 UC-1.1 R6 要求进审计的四类事件之一。
 */
export const Session = z.object({
  /** 不可猜（UUID，不得是序列）——I-6，同 identity A-1 */
  id: z.string(),
  userId: z.string(),
  currentOrgId: z.string().nullable(),
  issuedAt: z.string().datetime(),
  /** issuedAt + AUTH_POLICY.sessionDays */
  expiresAt: z.string().datetime(),
  /** null = 有效 */
  revokedAt: z.string().datetime().nullable(),
});

/* ───────────────────────────── 操作 ───────────────────────────── */

/**
 * 邀请码形态。**14 位**（UC-1.5 / domain.md `InviteCode.code`）。
 *
 * ⚠ **字母表刻意未收窄**。domain.md 只说「14 位」，没说取值集合；
 * 在这里写死一个 `[A-Z0-9]{14}` 就是**在契约之外发明约束**——
 * 而线下签发的码（O-29：平台运营方线下签发）一旦用了别的字母表，
 * 校验管道会在服务端把一枚**合法的码**判成格式错误，
 * 表现为「运营发出去的码客户用不了」，且服务端日志里只有一条 400。
 * ⇒ 只断言长度。字母表要收窄的话，先写进 domain.md 再改这里。
 */
export const InviteCodeValue = z.string().length(14);

/**
 * 口令策略 —— **O-28 的唯一落点**。
 *
 * 裁决原文：**长度 ≥12 字符、不强制字符类组合、必须查弱口令库、不强制定期更换**
 * （NIST 现行取向）。UC-1.5 R9 明写「本用例的注册表单与 UC-1.1 的登录/重置
 * **共用同一份策略实现，不得各写一套**」——所以它在契约里，只有一份。
 *
 * ⚠ **「查弱口令库」不在这个 schema 里，也无法在这里表达**：zod 校验是纯函数，
 * 弱口令库是一份数据。F19 未实现该检查——**这是如实登记的缺口，不是悄悄降级**，
 * 见 `KNOWN_CONTRACT_GAPS.C4`。写成 `.min(12)` 然后声称满足 O-28 才是最坏的做法。
 */
export const PasswordPolicy = z.string().min(12);

/* ─────────────────────── 组织生命周期（F22 / O-29 ③）─────────────────────── */

/**
 * 组织的生命周期状态。**恰好两个值，且刻意没有第三个。**
 *
 * ⚠ **没有 `purged`（已销毁）。** O-29 ③ 说数据「留存期届满再销毁」，
 * 而 phase-00 **没有实现任何销毁调度器**——没有定时任务、没有清理作业、
 * 没有任何东西会在 `retentionUntil` 过去之后动一下。
 * 加一个 `purged` 取值，会让契约看起来覆盖了那条链路，而它是空的：
 * 任何读到这个枚举的人（包括写界面的人）都会以为销毁已经存在。
 * ⇒ 缺的东西就让它缺着并写下来，见 `KNOWN_CONTRACT_GAPS.C13`。
 *
 * ⚠ 也**没有** `deleting` / `deleted`：硬删除明确不在 phase-1 范围（O-29 ③）。
 */
export const OrgStatus = z.enum(["active", "disabled"]);

/**
 * 停用事实。`disabled` 的三个字段**同生共死**——
 * 停用时间在而留存截止不在，不是「更宽松的状态」，是一个**答不出「什么时候能删」的状态**，
 * 而那正是 O-29 ③ 唯一要求记住的东西。库里由一条 CHECK 保证（迁移 0012）。
 */
export const OrgLifecycle = z.object({
  status: OrgStatus,
  /** null ⟺ status === "active" */
  disabledAt: z.string().datetime().nullable(),
  /**
   * `disabledAt + AUTH_POLICY.orgRetentionDays`。null ⟺ status === "active"。
   *
   * ⚠ **由 application 层算出来再写库**，库里没有 `DEFAULT ... interval`。
   * 理由见 `AUTH_POLICY.orgRetentionDays` 的长注：那会是第二份副本。
   */
  retentionUntil: z.string().datetime().nullable(),
}).strict();

/**
 * 每个操作 = { method, path, in, out, err }。
 * `err` 穷举失败模式——**「失败长什么样」是契约的一半**。
 * 本束的失败面尤其重要：**认证的失败面就是它的攻击面**。
 */
export const operations = {
  /**
   * `Login`（F20）— UC-1.1 R3 / V7 V8 V9，coverage V4
   *
   * ⚠ **未找到用户时也要跑一次等价开销的假哈希**（I-1 的耗时半边）。
   * 「邮箱不存在」走一条不做哈希校验的短路径，「密码错误」要跑一次慢哈希——
   * 两者耗时差一个数量级，响应体一模一样也没用：攻击者拿秒表就能枚举。
   *
   * ⚠ 这行代码看起来像纯粹的浪费，**极容易在 code review 里被删掉**
   * （coverage.md 第五节第 4 条点名了这个风险）。断言写在
   * `tests/auth/login-enumeration-guard.test.ts`，并且写清了理由。
   */
  login: {
    method: "POST", path: "/auth/login",
    in: z.object({
      email: z.string().email(),
      /**
       * ⚠ 登录时**不**校验口令强度：策略变严之后老账号仍须能登录，
       * 而且「你的密码太短」这句话本身就把「这个邮箱有账号」说出去了。
       * 强度校验只发生在**设置口令**时（注册 / 重置）。
       */
      password: z.string().min(1),
    }),
    /** ⚠ 只给组织 id，**不给角色**（I-9：本束不产生任何权限判定） */
    out: z.object({
      sessionToken: z.string(),
      userId: z.string(),
      orgs: z.array(z.string()),
      expiresAt: z.string().datetime(),
    }).strict(),
    err: ["INVALID_CREDENTIAL", "ACCOUNT_LOCKED", "EMAIL_NOT_VERIFIED", "AUTH_SERVICE_UNAVAILABLE"] as const,
  },

  /**
   * `RequestPasswordReset`（F21）— UC-1.1 R4 A2 步骤 2 / coverage V10
   *
   * ⚠ **无论邮箱是否存在都返回 `{ sent: true }`**——否则这个端点就是一个
   * 不需要任何凭据的枚举接口：攻击者拿一份邮箱名单跑一遍就知道谁是客户。
   *
   * `sent` 写成 `z.literal(true)` 而不是 `z.boolean()`，是为了让「有没有可能返回 false」
   * 这个问题在**类型层**就没有答案——`z.boolean()` 会诱导后来者加一条 `sent: false` 分支。
   */
  requestPasswordReset: {
    method: "POST", path: "/auth/password-reset/request",
    in: z.object({ email: z.string().email() }),
    out: z.object({ sent: z.literal(true) }).strict(),
    err: [] as const,
  },

  /**
   * `CompletePasswordReset`（F21）— UC-1.1 R4 A2 步骤 5 / AC3 / coverage V11
   *
   * ⚠ `revokedSessionCount` 是**契约的一部分**，不是调试字段：
   * UC-1.1 R4 要求重置后吊销该账号**全部**既有会话，而「吊销了几个」是那条要求
   * **唯一可被断言、也是唯一能让用户看见**的形式。
   * **最常见的做错方式是只吊销当前会话**——而只吊销当前会话时，
   * 「重置成功」的响应与正确实现**完全一样**，除了这个数字。
   */
  completePasswordReset: {
    method: "POST", path: "/auth/password-reset/complete",
    in: z.object({
      token: z.string().min(1),
      /**
       * 强度在服务端按 `domain/auth/password-policy` 校验并返回字段级错误。
       * 这里只挡住空串——**长度阈值不在这里写死**，否则它就是第二份副本
       * （`AUTH_POLICY.passwordMinLen` 是唯一那份）。
       */
      newPassword: z.string().min(1),
    }),
    out: z.object({
      /** ⚠ 重置前建立的会话数，全部已 revoke。只吊销当前会话的实现这里会返回 1 */
      revokedSessionCount: z.number().int().nonnegative(),
    }).strict(),
    err: ["RESET_TOKEN_INVALID", "AUTH_SERVICE_UNAVAILABLE"] as const,
  },

  /**
   * `InspectPasswordResetThrottle`（issue #2632）—— 平台超管专用的只读诊断：
   * `requestPasswordReset` 对这个邮箱当前会不会因为冷却/每日上限而**跳过发信**。
   *
   * ⚠ 只有这个端点允许说"这个邮箱没有注册"——调用方已经是白名单超管，不是匿名探测者，
   * `requestPasswordReset` 的防枚举顾虑（I-1）在这里不适用。
   */
  inspectPasswordResetThrottle: {
    method: "POST", path: "/auth/password-reset/inspect-throttle",
    in: z.object({ email: z.string().email() }),
    out: z.object({
      registered: z.boolean(),
      /** 过去 24 小时（滚动窗口，不是"今天"）内已发起的次数。 */
      issuedInLast24h: z.number().int().nonnegative(),
      dailyCap: z.number().int().positive(),
      overDailyCap: z.boolean(),
      lastIssuedAt: z.string().datetime().nullable(),
      cooldownSeconds: z.number().int().positive(),
      cooling: z.boolean(),
      cooldownEndsAt: z.string().datetime().nullable(),
    }).strict(),
    err: ["NOT_PLATFORM_SUPERUSER"] as const,
  },

  /**
   * `ValidateSession` — F18 的 `PrincipalResolverPort` 的**真实实现**。
   *
   * 它现在是 `HeaderPrincipalResolver`（测试注入，生产不可达）。F20 之后
   * 生产路径走 `SessionTokenPrincipalResolver`，凭据形态 = 不透明 token + Redis
   * （domain 第三节①：JWT 与 I-5「立即失效」**正面冲突**）。
   *
   * ⚠ 刻意**不开放 HTTP 路由**：会话校验是 Guard 的内部动作，
   * 给它一个端点等于给攻击者一个免费的 token 有效性预言机。
   * 这里登记形状是为了让端口签名与契约同源。
   */
  validateSession: {
    method: "INTERNAL", path: "(guard)",
    in: z.object({ sessionToken: z.string() }),
    out: z.object({ userId: z.string(), currentOrgId: z.string().nullable() }).strict().nullable(),
    err: ["SESSION_EXPIRED", "SESSION_REVOKED", "AUTH_SERVICE_UNAVAILABLE"] as const,
  },

  /* ── F19 段（合并自并行 feature），2026-08-24 起被 open-self-serve-registration
   * delta 改写：`redeemInviteAndCreateOrg` 已移除，见下方 `registerNewAccount`。
   * switchOrgAtLogin (F22): ⚠ 不重新实现切换，调 identity.switchOrganization
   */

  /**
   * `RegisterNewAccount`（open-self-serve-registration delta，issue #1929）
   * —— 取代已移除的 `redeemInviteAndCreateOrg`：不再需要邀请码，任何人直接
   * 自助建一个新组织并成为其 owner。防滥用手段收敛为邮箱验证（未验证不能登录，
   * 复用既有 `EMAIL_NOT_VERIFIED` 登录闸门，见 `login.ts`）。
   *
   * ⚠ 路径与 `/auth/register`（旧邀请码端点，已移除）刻意分开，不共用路径下
   * 靠 body 里有没有 `code` 分支——那种分支会让"要不要建新账号"由一个可伪造的
   * 请求体字段决定。
   */
  registerNewAccount: {
    method: "POST",
    path: "/auth/register-open",
    in: z.object({
      email: z.string().email(),
      password: PasswordPolicy,
      displayName: z.string().min(1),
      orgName: z.string().min(1),
    }).strict(),
    /**
     * ⚠ `.strict()` —— 沿用 F19 对 `redeemInviteAndCreateOrg` 的同一条发现：
     * 响应体最常见的漂移方向是"多一个字段"，plain zod object 默认剥离未知键，
     * `safeParse` 对这个方向是瞎的。见 `KNOWN_CONTRACT_GAPS.C7`。
     */
    out: z
      .object({
        userId: z.string(),
        orgId: z.string(),
        /** 事务内可靠入队；不虚报供应商已接收。 */
        verificationDelivery: z.literal("queued"),
      })
      .strict(),
    /** 没有 `INVITE_CODE_INVALID`——没有码可判（design-signoff 已裁）。 */
    err: ["EMAIL_TAKEN"] as const,
  },

  /**
   * 冷启动唯一入口。它与邀请注册刻意分开：只有整个 credentials 表为空时可成功，
   * 且该判断与建号在同一数据库事务内串行化。首人即完成邮箱验证并可立即登录。
   */
  bootstrapFirstUser: {
    method: "POST",
    path: "/auth/bootstrap",
    in: z.object({
      email: z.string().email(),
      password: PasswordPolicy,
      displayName: z.string().min(1),
      orgName: z.string().min(1),
    }),
    out: z.object({
      userId: z.string(),
      orgId: z.string(),
      emailVerified: z.literal(true),
    }).strict(),
    err: ["BOOTSTRAP_UNAVAILABLE", "EMAIL_TAKEN"] as const,
  },

  confirmEmailVerification: {
    method: "POST", path: "/auth/email-verifications/confirm",
    in: z.object({ token: z.string().min(40) }).strict(),
    out: z.object({ status: z.literal("completed") }).strict(),
    err: ["VERIFICATION_LINK_INVALID"] as const,
  },

  resendEmailVerification: {
    method: "POST", path: "/auth/email-verifications/resend",
    in: z.object({ email: z.string().email() }).strict(),
    out: z.object({ verificationDelivery: z.literal("queued") }).strict(),
    err: [] as const,
  },

  /* ── F22 段 ──────────────────────────────────────────────────────────
   * 契约文件头部的占位写着「F19/F22 段：redeemInviteAndCreateOrg / switchOrgAtLogin」，
   * 这里是 F22 那一半，外加 O-12 与 O-29 ③ 落地必需的两个操作。
   */

  /**
   * `SwitchOrgAtLogin`（F22）— usecases.md 的 F22 用例，coverage V5
   *
   * ## ⚠ 它**不重新实现切换**
   *
   * `identity.switchOrganization` 已经有完整的副作用语义（清项目上下文、清鉴权缓存、
   * 按新组织重新求值，O-12），本用例只做**会话侧的那一半**然后调用它。
   * usecases.md 逐字写着「两处各写一遍就是第八次漂移」。
   * `tests/auth/multi-org-membership.test.ts` 解析实现文件，断言它确实调用了
   * `switchOrganization`，且**没有**自己调 `clearProjectScoped` / `invalidateUser` / `setOrg`——
   * 「不重新实现」是可机械判定的，就不该只写在注释里。
   *
   * ## 「会话侧的那一半」具体是什么，以及为什么非有不可
   *
   * `identity.switchOrganization` 写的是 identity 的 `SessionStore`（按 user 存的
   * 项目级上下文）。**它碰不到 Redis 里那条 bearer 会话记录**，而 `validateSession`
   * 正是从那条记录里取 `currentOrgId` 交给 Guard 当 principal。
   * ⇒ 只调 `/identity/switch-org` 的话，**principal 的组织根本没变**：
   * 界面切过去了，服务端认的还是旧组织。这是 F22 实现时查出来的既有缺陷，
   * 见 `KNOWN_CONTRACT_GAPS.C8`。
   *
   * ## `in` 与 usecases.md 的差异（刻意）
   *
   * usecases.md 写 `in: { sessionToken, toOrgId }`。**application 层的签名正是那个**，
   * 但 HTTP 的 `in` 只有 `toOrgId`：`sessionToken` 走 Authorization 头。
   * 把 bearer token 放进请求体，它就会出现在每一条访问日志、每一次抓包回放、
   * 以及任何把 body 打进日志的中间件里——而 `validateSession` 同样把它标成 INTERNAL，
   * 理由是一样的。
   */
  switchOrgAtLogin: {
    method: "POST", path: "/auth/switch-org",
    in: z.object({ toOrgId: z.string() }).strict(),
    /**
     * ⚠ 只有 `org`，**没有** `capabilities`——与 `identity.switchOrganization` 的响应刻意不同。
     * 那份能力清单是 identity 那个操作的契约产出（F15 的 post-effect），
     * 在这里再返回一份，就等于同一份数据有两个来源、两条更新路径。
     */
    out: z.object({ org: Organization }).strict(),
    err: ["NO_ORG_MEMBERSHIP", "SESSION_EXPIRED", "SESSION_REVOKED", "AUTH_SERVICE_UNAVAILABLE"] as const,
  },

  /**
   * `JoinOrgWithInvite`（F22）— O-12 / UC-1.5 R10 / V10
   *
   * ## 为什么必须是一个**独立**的操作
   *
   * O-12 逐字写着：「**已有账号再次使用一枚新邀请码创建第二个组织是合法路径**，
   * 不得因『该邮箱已注册』而拒绝；此时**不新建账号**」。
   * 而 `redeemInviteAndCreateOrg` 对已注册邮箱的回答恰恰是 `EMAIL_TAKEN`——
   * 它**必须**这么答（那条路径上调用者是匿名访客，不能凭一个邮箱就往已有账号上挂组织）。
   *
   * ⇒ 两条路径的区别不是参数，是**调用者是谁**：
   * 一条是匿名 + 邀请码，一条是**已登录会话** + 邀请码。
   * 用一个带可选 userId 的操作合并它们，等于让「要不要建新账号」由请求体里的一个字段决定——
   * 那个字段一旦可伪造，就是「拿一枚码把自己挂进别人账号」。
   *
   * ⚠ 本操作**不在** usecases.md 的操作表里。coverage.md 的 V5 只映到 `SwitchOrgAtLogin`，
   * 而切换器切不出一个不存在的成员关系。登记在 `KNOWN_CONTRACT_GAPS.C9`。
   */
  joinOrgWithInvite: {
    method: "POST", path: "/auth/join-org",
    in: z.object({
      code: InviteCodeValue,
      orgName: z.string().min(1),
    }).strict(),
    /**
     * ⚠ 没有 `userId`：调用者就是它自己，服务端把它回述一遍毫无信息量，
     * 却让「响应里的 userId 与会话里的不一致」成为一种可表达的状态。
     */
    out: z.object({ orgId: z.string() }).strict(),
    err: ["INVITE_CODE_INVALID", "EMAIL_NOT_VERIFIED", "SESSION_EXPIRED", "SESSION_REVOKED"] as const,
  },

  /**
   * `ExportOrganization`（F22）— O-29 ③「停用期间**仅管理员可导出**」/ UC-1.5 V12 ②
   *
   * ## ⚠ 这个操作让 `auth` 越了自己的界，如实说明
   *
   * domain.md 第零节：「**本束不得自己做权限判定**」。而「仅管理员可导出」就是一条判定。
   * coverage.md 的缺口 A-2 早就点名了这件事——V6 有验收无操作，
   * 「不定的话 F22 会带着一条无法判定的验收」。
   * 两条路：把验收留成判不了的，或者在 auth 里做这条判定并**大声登记**。
   * 取后者，且判定收敛成 `domain/auth/org-lifecycle.ts` 里**一个纯函数**，
   * 不散在 controller 与 repository 里。见 `KNOWN_CONTRACT_GAPS.C11`。
   *
   * ## `out` 是**清单**不是内容转储，且这个词是认真的
   *
   * 返回的是组织自身的行、成员列表、以及按表的行数——**没有一条业务内容**。
   * 真正的内容导出（材料/产出/审计链打包）不在 phase-00，见 `KNOWN_CONTRACT_GAPS.C12`。
   * 把它叫「导出」而返回内容为空，才是最坏的做法：验收会绿，而用户拿不到数据。
   */
  exportOrganization: {
    method: "GET", path: "/auth/org-export",
    in: z.object({ orgId: z.string() }).strict(),
    out: z.object({
      org: Organization,
      lifecycle: OrgLifecycle,
      /** 每张携带租户键的表在本组织下有多少行。⚠ 数组元素也要 `.strict()`，它不继承 */
      tables: z.array(
        z.object({ table: z.string(), rowCount: z.number().int().nonnegative() }).strict(),
      ),
    }).strict(),
    err: ["NO_ORG_MEMBERSHIP", "SESSION_EXPIRED", "SESSION_REVOKED"] as const,
  },
} as const;

export type Operations = typeof operations;
export type OperationName = keyof Operations;


/* ── 以下自 F19（注册侧）并入 ────────────────────────────────────
 * 两个并行 feature 各自建了一份 auth 地基。合并时以 F20 那份为底（它更完整：
 * 会话、锁定、重置都在里面），再把 F19 独有的搬过来——而不是二选一。
 */



/**
 * 口令哈希的**可接受形态** —— 不变量 I-2 的机器可判定形式。
 *
 * I-2 原文：「口令只以**慢哈希**存储（argon2id 或 bcrypt cost ≥ 12），
 * **任何地方不得出现明文或可逆编码**」。
 *
 * ⚠ 为什么这条正则在**契约**里而不是在后端：断言 I-2 的测试、生成哈希的实现、
 * 以及数据库的 CHECK 约束是三处，三处各写一份「什么算慢哈希」必然漂移——
 * 而漂移的方向是**放松**（有人为了让测试过，把 cost 从 12 调到 10 并顺手改正则）。
 * 现在三处都从这一份派生：实现用它自检、测试用它断言、迁移里的 CHECK 是它的 SQL 投影
 * （SQL 投影无法从 TS 生成，故在迁移里逐字重复并注明来源——那是本项目唯一允许的
 * 「第二份副本」形式：一份带出处标注的机械投影，且有测试断言两者同时接受/拒绝同一组样本）。
 *
 * 两支：
 *   · bcrypt   `$2a$12$…` / `$2b$…` / `$2y$…`，cost 必须 ≥ 12（两位数 12-99）
 *   · argon2id `$argon2id$v=19$m=…,t=…,p=…$salt$hash`
 */
export const PasswordHashFormat = z
  .string()
  .regex(
    /^(\$2[aby]\$(1[2-9]|[2-9]\d)\$[./A-Za-z0-9]{53}|\$argon2id\$v=\d+\$m=\d+,t=\d+,p=\d+\$[^$]+\$[^$]+)$/,
    "password hash must be bcrypt cost>=12 or argon2id (invariant I-2)",
  );

/**
 * F19 实现时撞到的契约缺口，逐条登记在契约自己身上。
 *
 * 放在这里而不是放在某个 report 里：report 会随着会话结束消失，
 * 而下一个动这份契约的人一定会打开这个文件。
 *
 * ⚠ 这不是 TODO 列表，是**签核后才发现、需要重新签核才能补**的东西
 * （`design-signoff.md` 的 status 只能由人类改，agent 不许动）。
 */
export const KNOWN_CONTRACT_GAPS = {
  /** `EMAIL_TAKEN` 出现在操作的 err 里，却不在 usecases.md 的 `AuthReason` 表里。本文件已补进枚举。 */
  C2: "EMAIL_TAKEN declared by the operation but absent from the AuthReason table in usecases.md",
  /** O-28 的「必须查弱口令库」无法用 zod 表达，F19 未实现该检查。 */
  C4: "O-28 requires a weak-password dictionary check; not expressible here and not implemented",
  /**
   * 组织 ID 形态两处不一致：UC 写 `org_8f21`（含下划线），
   * 而既有的 `domain/org-id.ts` 的 `OrgId` 正则是 `^[a-z0-9][a-z0-9-]{0,63}$`（**不含下划线**）。
   * F19 按既有 `OrgId` 生成（它是 RLS 的输入，改它影响所有租户表），UC 的示例形态未采用。
   */
  C5: "UC-1.5 shows org ids like `org_8f21`, but domain/org-id.ts forbids underscores; the existing OrgId wins",
  /** UC-1.5 R7/V8 要求建组织、核销、授管理员三个事件进审计，契约里没有对应产出（`provenanceEventId` 之类）。 */
  C6: "UC-1.5 R7/V8 requires audit events for org creation / redemption / admin grant; the contract returns no audit handle",
  /**
   * **不是本束的缺口，是全仓的**：contract-design.md 硬规则 6 的落法
   * （`out.safeParse()` 逐条断言）对「响应多出契约没描述的字段」完全无效——
   * zod object 默认剥离未知键，多字段照样 success。见上方 `out` 的 `.strict()` 长注。
   * 其余契约束（identity / artifact / context-pack / provenance）的 `out` 都还没 strict。
   */
  C7: "hard rule 6's out.safeParse() cannot detect EXTRA response fields; every other bundle's `out` is still non-strict",

  /* ── F22 实现时撞到的（2026-07-29）────────────────────────────────── */

  /**
   * **`/identity/switch-org` 换不掉 principal 的组织。**
   *
   * `identity.switchOrganization` 写的是 identity 的 `SessionStore`（按 user 存的项目级上下文），
   * 而 Guard 的 principal 来自 `validateSession`，后者读的是 Redis 里那条 bearer 会话记录的
   * `currentOrgId`——两者互不相干。于是切换之后：界面按新组织渲染，
   * 服务端每一次鉴权用的还是**登录时那一个**组织。
   *
   * 这条缺陷在 F22 之前不可见：phase-00 里没有第二个组织可切，
   * `orgs[0]` 恒等于唯一那个，两个来源永远一致。
   *
   * F22 的处理：新增 `switchOrgAtLogin`，它补上会话侧那一半再调 identity 的用例。
   * ⚠ **`/identity/switch-org` 仍然存在且仍然是半截的**——改它属于 `identity` 束的签核范围，
   * 本 feature 不越界改别人的契约（同 F19 对 C7 的处理）。
   */
  C8: "POST /identity/switch-org does not update the bearer session's currentOrgId, so the Guard's principal keeps the OLD org after a successful switch",
  /**
   * **已有账号用新邀请码加入第二个组织，契约里没有操作。**
   * O-12 逐字规定了这条路径合法，UC-1.5 V10 逐条列了它的验收，
   * 而 usecases.md 的 F22 只有 `SwitchOrgAtLogin`——切换器切不出一个不存在的成员关系。
   * coverage.md 第四节的「无孤儿操作」反向检查同样查不出缺的操作（与 C1 同一个盲区）。
   * F22 新增了 `joinOrgWithInvite`，**它是签核后新增的，需要重新签核**。
   */
  C9: "O-12 / UC-1.5 V10 require an existing account to redeem a NEW code into a SECOND org; usecases.md has no such operation (only SwitchOrgAtLogin)",
  /** O-01 把留存期定成可配置五参数之一；这里只取默认值 180 天，没有按组织覆盖的机制。 */
  C10: "org retention is O-01's configurable parameter; only the 180-day default is implemented, with no per-organization override",
  /**
   * **`exportOrganization` 让 `auth` 做了一条权限判定**，
   * 而 domain.md 第零节明写本束不得做判定。coverage.md 的 A-2 预告了这个两难
   * （V6 有验收无操作）。取「做，并登记」而不是「留一条判不了的验收」。
   */
  C11: "exportOrganization performs an ORG-LAYER authorization (admin only), which domain.md §0 forbids this bundle from doing; A-2 predicted this",
  /** 「导出」目前返回清单（组织行 + 成员 + 按表行数），**不含任何业务内容**。 */
  C12: "exportOrganization returns a MANIFEST, not a content dump; packaging materials/outputs/audit chain is not in phase-00",
  /**
   * **「留存期后销毁」没有实现。** 有 `retentionUntil` 这个日期，
   * 没有任何东西会在它过去之后动一下——没有调度器、没有清理作业、没有 `purged` 状态。
   * ⚠ 这是**如实登记的缺口**：`OrgStatus` 刻意只有两个值，就是为了不让契约替这条链路背书。
   */
  C13: "retention-elapsed DESTRUCTION is not implemented: retentionUntil is stored and nothing ever acts on it (no scheduler, no purged state)",
} as const;

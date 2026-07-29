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
 *   F19/F22 段：`redeemInviteAndCreateOrg` / `switchOrgAtLogin`（见文件末尾占位）
 */
import { z } from "zod";

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
  lockAfterFails: 5,
  lockWindowMinutes: 15,
  lockDurationMinutes: 15,
  resendCooldownSeconds: 60,
  resendDailyMax: 5,
  inviteCodeLength: 14,
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
  /** Redis / 认证依赖不可用。⚠ **一律拒绝，不得降级放行**（同 identity 的同名码） */
  "AUTH_SERVICE_UNAVAILABLE",
]);

/** 口令被拒的原因。⚠ 刻意**没有** `MISSING_UPPERCASE` 之类——O-28 ① 明确不强制字符类 */
export const PasswordRejection = z.enum([
  "TOO_SHORT",
  /** 命中常见泄露口令字典 */
  "WEAK_COMMON",
]);

/* ─────────────────────────────── 实体 ─────────────────────────────── */

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
    }),
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
    out: z.object({ sent: z.literal(true) }),
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
    }),
    err: ["RESET_TOKEN_INVALID", "AUTH_SERVICE_UNAVAILABLE"] as const,
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
    out: z.object({ userId: z.string(), currentOrgId: z.string().nullable() }).nullable(),
    err: ["SESSION_EXPIRED", "SESSION_REVOKED", "AUTH_SERVICE_UNAVAILABLE"] as const,
  },

  /* ── F19 / F22 段（并行开发，在此追加）───────────────────────────
   * redeemInviteAndCreateOrg: { ... }
   * switchOrgAtLogin:         { ... }   ⚠ 不重新实现切换，调 identity.switchOrganization
   */
} as const;

export type Operations = typeof operations;
export type OperationName = keyof Operations;

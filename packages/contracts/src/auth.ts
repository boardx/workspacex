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

  /* ── F19 段（合并自并行 feature）─────────────────────────────────
   * switchOrgAtLogin (F22): ⚠ 不重新实现切换，调 identity.switchOrganization
   */
  redeemInviteAndCreateOrg: {
    method: "POST",
    path: "/auth/register",
    in: z.object({
      code: InviteCodeValue,
      email: z.string().email(),
      password: PasswordPolicy,
      displayName: z.string().min(1),
      orgName: z.string().min(1),
    }),
    /**
     * ⚠ `.strict()` —— **F19 实现时发现的、影响整条 ADR-020 返回链的问题**。
     *
     * 硬规则 6 的落法是「每条路由的响应体在测试里 `out.safeParse()` 逐条断言」。
     * 但 zod 的 object **默认剥离未知字段**：服务端多返回一个契约没描述的字段时，
     * `safeParse` 依然 success ——**返回方向的门控对「多字段」是瞎的**。
     *
     * 这不是推测。F19 做反证时，把 `orgName` 加进响应体，`safeParse` 照样绿；
     * 只有另写的「键集合必须恰好是这三个」那条断言拦下了它。
     * 而「多一个字段」正是响应体最常见的漂移方向——少字段前端会崩，多字段没人会崩，
     * 于是它一直在，直到某天那个字段是租户内容。
     *
     * ⇒ 本操作的 `out` 显式 strict。⚠ 其余契约束的 `out` **都还不是**，
     * 那是本仓一处普遍缺口，F19 只能报告，不能替别的束改（那是它们各自的签核范围）。
     */
    out: z
      .object({
        userId: z.string(),
        /** [原型] 形如 `org_8f21`；⚠ 实际形态受 `domain/org-id.ts` 的 `OrgId` 约束，见 C5 */
        orgId: z.string(),
        /** 恒 true —— 见上方长注。发不出去就不是这个响应 */
        emailVerificationSent: z.literal(true),
      })
      .strict(),
    /**
     * ⚠ **穷举不全，且这是已知缺口不是疏漏**：UC-1.5 E4 / V6 要求
     * 「邮件服务不可用时界面明确失败」，但这里没有对应的码。
     * F19 的处理与登记见 `KNOWN_CONTRACT_GAPS.C3`——**没有自己发明一个码**。
     */
    err: ["INVITE_CODE_INVALID", "EMAIL_TAKEN"] as const,
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
  /**
   * **没有「完成邮箱验证」这个操作。**
   *
   * `Credential.emailVerifiedAt` 是契约字段，I-8 说未验证不能登录，V4 要求断言它——
   * 但 usecases.md 的操作表里**没有任何操作能把 `emailVerifiedAt` 从 null 变成非 null**，
   * coverage.md 第四节「无孤儿操作」的反向检查也没发现这个反方向的洞：
   * 它查的是「有没有多余的操作」，查不出「有没有缺的操作」。
   *
   * 后果如果不补：**任何账号都永远无法登录**，而 F19 与 F20 各自的验收都能全绿——
   * F19 断言「新账号未验证」通过，F20 断言「未验证账号被拒」也通过。
   *
   * F19 的处理：在 application 层实现了 `confirmEmailVerification`（域规则来自
   * UC-1.5 R9 / O-28：24 小时、一次性），但**没有开 HTTP 路由、没有在此新增操作**——
   * 那需要人类重新签核。
   */
  C1: "no ConfirmEmailVerification operation; emailVerifiedAt can never become non-null through contracted surface",
  /** `EMAIL_TAKEN` 出现在操作的 err 里，却不在 usecases.md 的 `AuthReason` 表里。本文件已补进枚举。 */
  C2: "EMAIL_TAKEN declared by the operation but absent from the AuthReason table in usecases.md",
  /** UC-1.5 E4/V6「邮件服务不可用」没有失败码。F19 用「同事务入队」规避了这个失败面，见实现注释。 */
  C3: "no failure code for mailer-unavailable, though UC-1.5 E4 and V6 both require it to be visible",
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
} as const;

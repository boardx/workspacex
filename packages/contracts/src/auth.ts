/**
 * 契约束 `auth` — ③ API 契约（**唯一事实源**）
 *
 * ADR-020：这一份生成四样东西，任何一样都不许手写第二份——
 *   ├─→ 后端 DTO + ZodBodyPipe 的运行时校验
 *   ├─→ 前端 client 类型
 *   ├─→ OpenAPI
 *   └─→ 前端 mock 数据
 *
 * 覆盖 feature：**F19 F20 F21 F22**
 * 领域模型见 `phases/phase-00-shared-kernel/contracts/auth/domain.md`
 * 用例接口见 同目录 `usecases.md`；UC 覆盖见 `coverage.md`
 *
 * ⚠ **本文件被四个 feature 共用，改动必须是加法**。F19 建凭据，F20 校验凭据并签发会话，
 * F21 重置口令，F22 切组织。谁把共用的 `Credential` / `Session` 改成不兼容的形状，
 * 另外三件当场断——而它们各自的测试都是绿的。
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * 【F19 实现时发现、并在此登记的契约缺陷】——见文件末尾 `KNOWN_CONTRACT_GAPS`
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { z } from "zod";

/* ─────────────────────────── 统一失败枚举 ─────────────────────────── */

/**
 * `AuthReason` —— 认证域的统一失败枚举（usecases.md 第一节）。
 *
 * ⚠ **这里刻意没有 `INVITE_CODE_REDEEMED`**，而且这不是遗漏。
 *
 * 「这个码存在但已被用掉」会告诉攻击者**哪些码是真的**，从而把 14 位码的爆破空间
 * 按命中率剪枝——攻击者只要能分辨「不存在」与「已用」，枚举成本就从「猜出一个可用码」
 * 降到「猜出一个曾经存在的码」，而后者的密度高得多。
 * ⇒ 与「不存在」共用 `INVITE_CODE_INVALID`。
 *
 * ⚠ 代价：真实用户重复点击时看到的提示不够精确（「邀请码无效」而不是「这个码已经用过了」）。
 * 这是**刻意的取舍**，写在这里是为了让下一个觉得「用户体验不好」的人先读到理由，
 * 而不是顺手加一个码。防枚举这条最容易被「更好的用户体验」侵蚀。
 *
 * ⚠ **`EMAIL_TAKEN` 与「防枚举」的关系不同，不要类推**：
 * 它确实泄露「这个邮箱注册过」，但注册接口无法避免——不告诉用户邮箱被占用，
 * 用户就永远不知道该去登录（UC-1.5 A2 明写要提示「该邮箱已注册，请登录后使用邀请码创建组织」）。
 * 邮箱枚举的正确防线在**登录**与**找回密码**那两个接口（I-1 与 `RequestPasswordReset`
 * 恒返回 sent:true），不在这里。
 */
export const AuthReason = z.enum([
  /** 邮箱不存在与密码错误**共用这一个码**（I-1）。分开就是枚举通道 */
  "INVALID_CREDENTIAL",
  /** 锁定期内**正确口令也返回它**（I-3） */
  "ACCOUNT_LOCKED",
  "EMAIL_NOT_VERIFIED",
  /** **不区分「不存在」与「已被用」**——见上方长注 */
  "INVITE_CODE_INVALID",
  /**
   * ⚠ **usecases.md 的枚举表里没有它，但 `RedeemInviteAndCreateOrg.err` 里有**。
   * F19 实现时发现的契约不自洽：操作声明了一个统一枚举里不存在的码。
   * 收敛方向只能是「补进枚举」——因为操作的 err 是界面必须渲染的东西，
   * 而枚举是给界面看的那份清单。见 `KNOWN_CONTRACT_GAPS.C2`。
   */
  "EMAIL_TAKEN",
  /** 过期与伪造共用一个码 */
  "RESET_TOKEN_INVALID",
  "SESSION_EXPIRED",
  /** 与过期分开：用户需要知道是「被踢了」还是「太久没用」 */
  "SESSION_REVOKED",
]);

/* ─────────────────────────── 值对象 / 策略 ─────────────────────────── */

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

/* ─────────────────────────────── 实体 ─────────────────────────────── */

/**
 * `Credential` —— F19 创建它，F20 校验它，F21 改它的哈希。
 *
 * ⚠ **刻意不含 `passwordHash`**，尽管 domain.md 的实体表里有这个字段。
 *
 * 理由：本文件生成前端类型、mock 与 OpenAPI。把 `passwordHash` 放进**线路形态**，
 * 等于给「哪天有人把它塞进响应体」开了一条合法通道，而且 mock 生成器会当场
 * 把一个假哈希写进前端代码库。domain.md 描述的是**存储实体**，本文件描述的是
 * **可以离开服务端的东西**——两者不是同一个集合，这个差集就是 `passwordHash`。
 *
 * 哈希的形态约束由 `PasswordHashFormat` 单独表达（它约束的是存储，不是响应体）。
 */
export const Credential = z.object({
  userId: z.string(),
  /** **唯一**，小写规范化后比较（domain.md）。规范化在服务端做，不信任客户端 */
  email: z.string().email(),
  displayName: z.string(),
  /** null = 未验证。未验证的账号**不能登录**（I-8） */
  emailVerifiedAt: z.string().datetime().nullable(),
});

/**
 * `Session` —— **F20 拥有它**（签发与校验）。F19 不签发会话，只把形状定在这里，
 * 免得两件各写一份（同一事实两处 = 本项目已踩过五次的坑）。
 *
 * ⚠ `revokedAt` 存在的意义是「吊销是**写标记不是删行**」（I-7）——
 * 删了行就查不出「谁在什么时候被踢的」。所以这个字段不是可选的软删除风格，
 * 它是不变量的载体。
 */
export const Session = z.object({
  /** 不可猜：UUID，**不得是序列**（I-6 / A-1） */
  id: z.string().uuid(),
  userId: z.string(),
  /** 未选定组织时为 null（A3：账号已可用但无组织归属） */
  currentOrgId: z.string().nullable(),
  issuedAt: z.string().datetime(),
  /** 有效期 30 天（UC-1.3 / V12） */
  expiresAt: z.string().datetime(),
  /** null = 有效 */
  revokedAt: z.string().datetime().nullable(),
});

/* ───────────────────────────── 操作 ───────────────────────────── */

/**
 * 每个操作 = { method, path, in, out, err }。
 * `err` 穷举失败模式——**「失败长什么样」是契约的一半**，界面的异常态全靠它。
 *
 * ⚠ **`path` 是本文件新增的信息**：usecases.md 只给了用例签名，没给 HTTP 路径。
 * `identity` 束的 ③ 件里路径是契约的一部分（前端据此发请求），所以这里必须有；
 * 取值按该束既有惯例（`/identity/*`）平移为 `/auth/*`。若产品侧另有路由规划，
 * 改这里一处即可，前后端同时跟随。
 */
export const operations = {
  /**
   * `RedeemInviteAndCreateOrg`（**F19**）
   *
   * ```
   * in:  { code, email, password, displayName, orgName }
   * out: { userId, orgId, emailVerificationSent: true }
   * err: INVITE_CODE_INVALID | EMAIL_TAKEN
   * ```
   *
   * ## 事务边界是契约的一部分（I-4）
   *
   * **核销、建组织、建 owner 成员、建凭据在同一个事务里**。任何一步失败，
   * 整体回滚——**不留下半个组织**。
   *
   * ## 并发语义（V3，F19 最容易做错的一点）
   *
   * 两路同时用同一个码，必须**恰好一个成功**。落法：
   * ```sql
   * UPDATE invite_codes SET redeemed_by = $1 WHERE code = $2 AND redeemed_by IS NULL
   * ```
   * 并断言影响行数 === 1。**不要先 SELECT 再 UPDATE**，那中间有窗口。
   *
   * ⚠ 做错时**不抛异常**：它会建出**两个组织**，两边都「登录正常」，
   * 没有任何东西会报。所以这条只能靠**真正并发的**断言证明，顺序调用两次证明不了它。
   *
   * ## `emailVerificationSent` 为什么是 `z.literal(true)` 而不是 boolean
   *
   * UC-1.5 E4：「**邮件发送失败必须显式提示，不得静默成功**」。
   * 写成 boolean，服务端就可以返回 200 + `false`——而那正是「静默成功」的形状：
   * 状态码是成功的，界面照着 happy path 走，用户以为注册完成了。
   * 写成字面量 true，「没发出去」在协议层**无法表达**，只能变成一个失败响应。
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

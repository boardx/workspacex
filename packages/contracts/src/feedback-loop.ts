/**
 * 契约束 `feedback-loop` — ③ API 契约（**唯一事实源**）
 *
 * ADR-020：这一份是前后端类型、运行时校验、OpenAPI 的共同来源，任何一样都不许手写第二份。
 *
 * 覆盖 feature：**FB-2（软件/能力反馈采集）+ FB-3（后台真栈化）**，
 * 见 `docs/proposals/PROP-FEEDBACK-LOOP-E2E-001.md` §2。
 * 依据 UC：`phases/phase-03-reuse-and-governance/contracts/feedback-loop/usecases.md`（R1–R12）。
 * 领域模型：同目录 `domain.md`。
 *
 * ## 本文件**只管一半**，另一半在 `skills.ts`
 *
 * 「反馈与迭代」有两条来源，形状完全不同，所以是两份契约而不是一份：
 *
 *   · **人主动提的**（本文件）—— 一次显式动作：填标题、填正文、选类型。
 *     它可以指向产品本身，也可以指向某个 agent / skill。
 *   · **从消息级评价聚合出来的**（`skills.ts` 第六节，F68，已签核）——
 *     👍/👎 是一次**被动**的、无正文的信号，靠服务端归因和结构性聚合成建议。
 *
 * ⚠ **本文件不重新声明 `rateMessage` / `listSuggestions` / `getSatisfaction` /
 *   `getLoopMetrics` 那九条**。它们已在 `skills.ts` 里签核过；在这里再写一遍
 *   就是本项目已栽过五次的「同一事实声明在两处」。后台反馈屏右列吃的是那九条，
 *   左列吃的是本文件——**一块屏，两个契约来源**，这是刻意的。
 *
 * ## 三条不变量（改它们等于改产品）
 *
 *   · **I-F1 上下文是服务端与客户端各出一半，且分列存放**（不是一个 jsonb 口袋）：
 *     `occurredRoute` / `appVersion` 由客户端给（服务端不可能知道用户浏览器上跑的是哪个
 *     构建、他站在哪一屏），`submittedBy` / `createdAt` 由服务端给，**不入参**。
 *     一个「什么都能塞」的 jsonb 到排查时什么都查不到。
 *   · **I-F2 票数是 `COUNT(*)`，没有 `voteCount` 列**。存一列计数就是立刻多出第二份
 *     可能对不上的事实，而且对不上的时候没有任何东西会报。
 *   · **I-F3 反馈**不进任何满意度分子分母**。指向某个 skill 的一条文字反馈**不是**
 *     一次 👎——满意度的口径是 `👍/(👍+👎)`（O-37，`skills.ts` 逐字），
 *     让文字反馈也参与进去，会让同一个不满被计两次，而两个数字看起来都很正常。
 *
 * ## ⚠ 本文件刻意**没有**的东西（缺了是结论，不是遗漏）
 *
 *   · **附件**——D4 已裁（2026-08-15，人类）：第一版纯文字 + 自动上下文。
 *     附件牵扯 E2 的脱敏阻断（含客户数据的附件推给开发 Agent 前必须脱敏），
 *     那是 FB-4 的工作量。留半个 `attachments: []` 字段会让前端长出一个
 *     点了没反应的回形针按钮——本束第一条纪律就是不许留那种按钮。
 *   · **`[打开迭代看板]` / `[导出]` 的后端**——UC-17.6 的 A1/A2 逐字写着
 *     「按钮存在，但点击后无目标屏（原型待补）」。没有契约操作 ⇒ 前端也不许有按钮。
 *   · **反馈正文的编辑/删除**——反馈是一条历史事实。提交人事后改正文，会让已经据此
 *     分诊、已经生成 PR 的那条链路指向一段不再存在的文字。要补充就再提一条。
 *   · **`skillVersionId`**——见 `FeedbackTarget` 的注释。
 */
import { z } from "zod";

/* ─────────────────────────── 枚举 ─────────────────────────── */

/**
 * 反馈类型。**闭集，只有两个值。**
 *
 * ⚠ 没有「其他」。一个「其他」桶会立刻装走一半的反馈，而分诊的人拿到「其他」时
 *   得到的信息量等于零——他还是要读完正文才知道这是坏了还是想要。
 *   两个值都不合适时，正确的做法是在这里加**第三个具名值**并说明它管什么，
 *   而不是让一个万能桶替所有人做决定。
 */
export const FeedbackKind = z.enum(["缺陷", "需求"]);
export type FeedbackKind = z.infer<typeof FeedbackKind>;

/**
 * 反馈状态机。**四态，转移规则在 `domain.md` §3，不在这里。**
 *
 * ⚠ `不做` 不是「已修复」的同义词，也不是软删除。没有这个终态时，
 *   「我们不打算做这条」的唯一表达方式是把它永远留在 `待处理` 里——
 *   于是待处理队列变成一个只增不减的坟场，而提反馈的人永远等不到答复。
 *   D3 的可见性裁决让提交人**能看见自己那条被判了 `不做`**，所以它必须带理由
 *   （`TRIAGE_REASON_REQUIRED`）：一个没有理由的「不做」比不答复更伤人。
 */
export const FeedbackStatus = z.enum(["待处理", "已进入迭代", "已修复", "不做"]);
export type FeedbackStatus = z.infer<typeof FeedbackStatus>;

/**
 * 反馈指向谁。**判别联合，不是一个可空的 targetId 字符串。**
 *
 * ⚠ 写成 `{ targetKind: string; targetId: string | null }` 时，
 *   `{ kind: "product", id: "skill-7" }` 与 `{ kind: "skill", id: null }` 都能通过校验，
 *   而两者都是没有意义的东西。判别联合让它们在**编译期**就构造不出来。
 *
 * ⚠ **skill 只带 `skillId`，不带 `skillVersionId`**。这与 `rateMessage` 的归因
 *   （服务端从 `agent_runs` 查出恰好一个版本）是**两条不同的规则**，不是这里偷懒：
 *   👍/👎 是对**某一次具体回答**的评价，那次回答确实用了某个确定的版本；
 *   而「我想给这个 skill 提个意见」是对**这个 skill 这件事**说的，用户心里没有版本。
 *   服务端在提交时替他填一个「当前生效版本」，会让这条意见看起来是针对那个版本的，
 *   而它并不是——那是一个凭空生成的、没人能反驳的归属。
 *
 * ⚠ `agentId` / `skillId` **来自客户端**，且这是安全的：本条反馈不参与任何计数指标
 *   （I-F3）。它唯一的后果是这段文字出现在某个 agent/skill 的反馈列表里。
 *   对比 `rateMessage`——那条**绝不能**收客户端归因，因为它直接进满意度分母。
 */
export const FeedbackTarget = z.discriminatedUnion("kind", [
  /** 产品本身（导航栏「反馈」入口的默认目标） */
  z.object({ kind: z.literal("product") }).strict(),
  z.object({ kind: z.literal("agent"), agentId: z.string().min(1) }).strict(),
  z.object({ kind: z.literal("skill"), skillId: z.string().min(1) }).strict(),
]);
export type FeedbackTarget = z.infer<typeof FeedbackTarget>;

/**
 * 错误码。⚠ **每一个成员都在下方某个操作的 `err` 里出现**——
 * 一个不会被任何路径抛出的错误码读起来像覆盖，而它什么都没覆盖。
 */
export const FeedbackError = z.enum([
  /** 不存在**或不可见**。⚠ 同 `SKILL_NOT_FOUND` 的纪律：404 非 403，不泄露存在性 */
  "FEEDBACK_NOT_FOUND",
  /** 分诊 / 读他人正文的权限被撤销或从未有过 */
  "PERMISSION_REVOKED",
  /** 转 `不做` 时未给理由。见 `FeedbackStatus` 注释 */
  "TRIAGE_REASON_REQUIRED",
  /** 超时/网络/下游不可用。⚠ 已保留当前输入，可安全重试 */
  "DEPENDENCY_UNAVAILABLE",
]);
export type FeedbackError = z.infer<typeof FeedbackError>;

/* ─────────────────────── 投影（读模型）─────────────────────── */

/**
 * 列表项。**同一个 shape 服务两种读者**（提交人自己 / 组织管理员 / 旁观成员），
 * 差异只体现在 `detail` 是不是 null。
 *
 * ## D3（2026-08-15 人类裁决）：标题+票数对全组织可见，正文仅管理员与提交人
 *
 * ⚠ `detail: null` **恒等于「你没有权限看正文」**，绝不等于「正文是空的」——
 *   这是靠 `submitFeedback.in.detail` 的 `.min(1)` 保证的：一条落库的反馈不可能
 *   有空正文。两者若可混淆，界面就只能写一句模棱两可的「暂无内容」，
 *   而用户分不清是没写还是不给看。**所以那个 `.min(1)` 是这条语义的载体，不是手滑。**
 */
export const FeedbackItem = z
  .object({
    id: z.string(),
    kind: FeedbackKind,
    target: FeedbackTarget,
    /** ⚠ 目标的**当时**名字（`chat` 的 agent 可能后来改名/停用）。展示用，不作标识 */
    targetLabel: z.string().nullable(),
    title: z.string(),
    /** ⚠ null ⟺ 无权查看正文（D3）。**不是**「正文为空」——见本类型头注 */
    detail: z.string().nullable(),
    status: FeedbackStatus,
    /** ⚠ 只有 `不做` 必然非 null；其余三态可有可无 */
    statusReason: z.string().nullable(),
    /** I-F2：`COUNT(*)` 派生，不是存下来的列 */
    votes: z.number().int().nonnegative(),
    /** 当前请求者投过没有——**同一个人不许把票数顶上去** */
    votedByMe: z.boolean(),
    submittedByMe: z.boolean(),
    /** I-F1：客户端给的复现上下文，分列存 */
    occurredRoute: z.string().nullable(),
    appVersion: z.string().nullable(),
    createdAt: z.string(),
  })
  .strict();
export type FeedbackItem = z.infer<typeof FeedbackItem>;

/**
 * 列表的读取口径。
 *
 * ⚠ 三个值**不是三种过滤器**，是三种**权限形状**：
 *   · `mine`   —— 我提的。任何人都能读，正文恒可见（是自己写的）。
 *   · `org`    —— 全组织的。任何成员都能读，但正文按 D3 门控。
 *   · `target` —— 某个 agent/skill 的。同 `org` 的门控，额外按目标过滤。
 * 把它做成一个可空的 `targetId` + 一个 `onlyMine` 布尔，会产生
 * `{ onlyMine: true, targetId: "x" }` 这种没人定义过语义的组合。
 */
export const FeedbackScope = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("mine") }).strict(),
  z.object({ kind: z.literal("org") }).strict(),
  z.object({ kind: z.literal("target"), target: FeedbackTarget }).strict(),
]);
export type FeedbackScope = z.infer<typeof FeedbackScope>;

/* ─────────────────────────── 操作 ─────────────────────────── */

export const operations = {
  /**
   * 提交一条反馈（FB-2 的唯一写入口，导航栏弹层 / chat 内 agent·skill 按钮共用）。
   *
   * ⚠ `in` 里**没有** `submittedBy`、没有 `status`、没有 `createdAt`。
   *   提交人由服务端从 principal 取；状态恒从 `待处理` 起步——让客户端传一个初始状态，
   *   等于让任何人把自己的反馈直接标成「已修复」。
   *
   * ⚠ `occurredRoute` / `appVersion` **可空但不可伪装成必填**：
   *   有些入口（如后台里直接提的）确实没有有意义的「发生位置」。
   *   `.nullable()` 让「没有」是一个可表达的值，而不是靠一个空字符串糊过去。
   */
  submitFeedback: {
    method: "POST",
    path: "/feedback",
    in: z
      .object({
        kind: FeedbackKind,
        target: FeedbackTarget,
        title: z.string().min(1).max(120),
        /** ⚠ `.min(1)` 是 `FeedbackItem.detail: null ⟺ 无权` 那条语义的载体，见该类型头注 */
        detail: z.string().min(1).max(4000),
        occurredRoute: z.string().nullable(),
        appVersion: z.string().nullable(),
      })
      .strict(),
    out: z
      .object({
        feedbackId: z.string(),
        /** 恒 `待处理`。写成常量而不是省略：调用方据此渲染「已收到，待处理」而不必猜 */
        status: FeedbackStatus,
      })
      .strict(),
    err: ["DEPENDENCY_UNAVAILABLE"] as const,
  },

  /**
   * 读反馈列表。三种口径见 `FeedbackScope`。
   *
   * ⚠ **不分页**。第一版故意的：反馈量级是「一个组织一周几十条」，
   *   分页会引入游标契约、稳定排序、总数口径三件事，而它们此刻一件都没有被需要。
   *   量级上来时补分页是加参数，不是改语义。
   */
  listFeedback: {
    method: "GET",
    path: "/feedback",
    in: z.object({ orgId: z.string(), scope: FeedbackScope }).strict(),
    out: z.object({ items: z.array(FeedbackItem) }).strict(),
    err: ["PERMISSION_REVOKED", "DEPENDENCY_UNAVAILABLE"] as const,
  },

  /**
   * 投票 / 撤票（I-F2）。
   *
   * ⚠ 一个操作带 `voted: boolean`，而不是 POST/DELETE 两条路由：
   *   界面上它是**一个可切换的按钮**，两条路由会让前端自己判断该发哪条，
   *   而那个判断依据的是它本地那份可能已经过期的 `votedByMe`。
   * ⚠ 幂等：把已投的再投一次是 no-op（返回同一个票数），不是错误、也不是 +1。
   *   落点是 `UNIQUE (feedback_id, voter_id)`，不只是用例里的一次查询。
   * ⚠ **提交人可以给自己的反馈投票**。刻意允许：票数的口径是「有多少人也遇到了」，
   *   提交人显然也遇到了。禁止自投会让「1 人遇到」显示成 0。
   */
  voteFeedback: {
    method: "POST",
    path: "/feedback/:feedbackId/vote",
    in: z.object({ feedbackId: z.string(), voted: z.boolean() }).strict(),
    out: z
      .object({
        feedbackId: z.string(),
        votes: z.number().int().nonnegative(),
        votedByMe: z.boolean(),
      })
      .strict(),
    err: ["FEEDBACK_NOT_FOUND", "DEPENDENCY_UNAVAILABLE"] as const,
  },

  /**
   * 分诊：改状态（**组织管理员**）。
   *
   * ⚠ 合法转移由 `domain.md` §3 的状态机裁决，**不在这里用 zod 表达**——
   *   zod 校验的是「这一次请求的形状」，它看不到当前状态，因此表达不了
   *   「从 A 只能到 B 或 C」。写一半在这里、一半在 domain，就是把同一条规则
   *   劈成两份且只有一份会被执行。
   * ⚠ 状态变更**append-only 地留痕**（`feedback_status_events`）：
   *   「谁在什么时候把它从待处理改成不做、理由是什么」是这条闭环里唯一
   *   能回答「为什么我的反馈没人管」的东西。
   *
   * ## 2026-08-30 新增两个副作用，均挂在这一个操作上（不是新增操作）
   *
   *   · **转 `已进入迭代`**（"转开发"）时，可以附一份 `issueDraft`——管理员在弹层里
   *     编辑过的 GitHub issue 标题/正文/标签。它**只在这个目标状态下**被使用；
   *     其余转移带这个字段没有意义，用例层会忽略。不用判别联合去强绑"状态 ⇒ 是否
   *     允许 issueDraft"，是因为那会让"转已修复时误传了 issueDraft"变成一个类型
   *     错误而不是一个被忽略的字段——调用方（前端）只在渲染那一个按钮时才拼得出
   *     这个字段，类型层面强绑反而更脆。
   *   · **任意转移**都会尽力给提交人发一封「你的反馈状态变了」的邮件——**不是**
   *     这里新增的字段能开关的，而是用例内部恒定的行为（见 `triage-feedback.ts`
   *     头注）。`out.notified` 只是如实回报"这次到底发没发出去"，不是入参。
   *
   * ⚠ `issueDraft` 是 `.nullable().optional()`——对 `.strict()` 契约新增字段的唯一
   *   向后兼容方式（ADR-020）：旧调用方不传这个字段，契约照样过；新字段绝不能变成
   *   必填，否则今天能发的请求明天就发不出去。
   */
  triageFeedback: {
    method: "PUT",
    path: "/feedback/:feedbackId/status",
    in: z
      .object({
        feedbackId: z.string(),
        status: FeedbackStatus,
        /** ⚠ 转 `不做` 时必填，否则 `TRIAGE_REASON_REQUIRED`。跨字段规则在 domain 判 */
        reason: z.string().nullable(),
        /**
         * "转开发"弹层里管理员编辑过的 GitHub issue 草稿。**只在
         * `status === "已进入迭代"` 且管理员确实走了那个弹层时**才会非 null——
         * 其余转移不需要它，传了也不会被使用。
         * ⚠ 这是**管理员编辑之后**的最终文案，不是反馈本身的 `title`/`detail`——
         *   用例层不会用反馈原文覆盖它，否则"可编辑"就是一句空话。
         */
        issueDraft: z
          .object({
            title: z.string().min(1),
            body: z.string(),
            labels: z.array(z.string()),
          })
          .strict()
          .nullable()
          .optional(),
      })
      .strict(),
    out: z
      .object({
        feedbackId: z.string(),
        status: FeedbackStatus,
        /**
         * 提交人状态变更邮件**这一次**是否真的发出去了（best-effort，见用例头注）。
         * ⚠ 不是"配置了邮件功能"的布尔——一次配置齐全但供应商超时的调用，这里也是
         *   `false`。调用方（后台屏）据此决定要不要提示"邮件没发出去，状态已经变了"。
         */
        notified: z.boolean(),
        /** 本次是否真的创建了 GitHub issue（只有转 `已进入迭代` 且带 `issueDraft` 时才可能非 null）。 */
        githubIssueUrl: z.string().nullable().optional(),
      })
      .strict(),
    err: [
      "FEEDBACK_NOT_FOUND",
      "PERMISSION_REVOKED",
      "TRIAGE_REASON_REQUIRED",
      "DEPENDENCY_UNAVAILABLE",
    ] as const,
  },

  /**
   * 后台左列的分状态计数（FB-3）。
   *
   * ⚠ **一次查询派生全部四个数**，不是前端拿完整列表自己 `filter().length`——
   *   那样做的话「本周 12 条 / 5 条待处理」这两个数字会在不分页假设失效的那天
   *   静默变成「当前页里的 12 条」。
   * ⚠ 与 `skills.getLoopMetrics`（F68 已签核）**口径不同且不重叠**：
   *   那条数的是「评价→建议→PR→上线」的转化，本条数的是软件反馈的状态分布。
   *   两条都存在不是重复，把它们合成一条才是——合了之后没有任何一个数字说得清自己是什么。
   */
  getFeedbackCounts: {
    method: "GET",
    path: "/feedback/counts",
    in: z.object({ orgId: z.string() }).strict(),
    out: z
      .object({
        total: z.number().int().nonnegative(),
        待处理: z.number().int().nonnegative(),
        已进入迭代: z.number().int().nonnegative(),
        已修复: z.number().int().nonnegative(),
        不做: z.number().int().nonnegative(),
      })
      .strict(),
    err: ["PERMISSION_REVOKED", "DEPENDENCY_UNAVAILABLE"] as const,
  },
} as const;

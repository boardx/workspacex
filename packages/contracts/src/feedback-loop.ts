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
/**
 * `已归档`（2026-09-04，issue #2681）：把已经走到终态（`已修复` / `不做`）的反馈收起来，
 * 不让收件箱越集越长。**不是**第三个终态入口——只能从 `已修复`/`不做` 进入，
 * 不能从 `待处理`/`已进入迭代` 直接跳过去（那两者还没有"完成"，谈不上收起来）。
 * 转移表见 `apps/api/src/domain/feedback/product-feedback.ts` 的 `ALLOWED_TRANSITIONS`。
 */
export const FeedbackStatus = z.enum(["待处理", "已进入迭代", "已修复", "不做", "已归档"]);
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
  /**
   * 查状态 / 发评论时，这条反馈还没有关联的 GitHub issue（`githubIssueUrl === null`）。
   * 不是 `FEEDBACK_NOT_FOUND`——反馈本身存在，只是这一步的前提条件不成立。
   */
  "NO_GITHUB_ISSUE",
  /** 发评论时正文为空/全空白。同 `TRIAGE_REASON_REQUIRED` 的理由：一条空评论没有信息量 */
  "COMMENT_BODY_REQUIRED",
  /** FB-5：附件字节体积超过 `FEEDBACK_ATTACHMENT_SIZE_LIMIT_BYTES`（8MB） */
  "FILE_TOO_LARGE",
  /** FB-5：声明的类型不在白名单（png/jpeg/webp）、或与实际字节嗅探结果不符 */
  "UNSUPPORTED_CONTENT_TYPE",
  /** FB-5：命中恶意签名（同 `uploadArtifact` 的 `MALWARE_DETECTED`） */
  "MALWARE_DETECTED",
  /** FB-5：语音转结构化反馈——模型调用/解析失败，转录文字本身仍在输入框里未丢失 */
  "STRUCTURING_FAILED",
  /** UC-17.8 B1：草稿不存在**或不是你的**（草稿是提交人私有物，同 404 非 403 纪律） */
  "DRAFT_NOT_FOUND",
  /** UC-17.8 B1：草稿正文为空时提交——`submitFeedback.in.detail.min(1)` 的语义在草稿提交口同样成立 */
  "DRAFT_EMPTY",
]);
export type FeedbackError = z.infer<typeof FeedbackError>;

/**
 * FB-5 —— 提交反馈时可以带的图片附件（先各自上传，再把返回的 id 塞进
 * `submitFeedback.attachmentIds`；见 `uploadFeedbackAttachment` 头注）。
 *
 * ⚠ **这一版没有脱敏**（人类 2026-09-02 明确裁决：先出功能，登记为已知限制）——
 *   见 `apps/api/src/application/feedback/upload-feedback-attachment.ts` 头注。
 * ⚠ `attachments` 与 `detail` 走**同一条** D3 可见性门控（图片是正文的一部分，
 *   不是标题/票数那类恒对全组织可见的展示性上下文）——见 `list-feedback.ts` 的
 *   `ListFeedbackDeps.attachments` 头注。
 */
/**
 * UC-17.8 D3（2026-09-04 人类裁决）：附件类型从「三种图片」扩到 **图片 + PDF + 纯文本/Markdown**
 * （复现日志、截图转 PDF 常见）。⚠ **音视频 / zip 不在其中**——它们的病毒扫描路径与存储成本
 * 本轮未验证，留给 `design-ai-collab` 束（语音附件）一起做。加类型 = 在这里加一个值并同步
 * `upload-feedback-attachment.ts` 的 magic-byte 嗅探；不许在任何地方写第二份白名单。
 */
export const FeedbackAttachmentMime = z.enum([
  "image/png",
  "image/jpeg",
  "image/webp",
  "application/pdf",
  "text/plain",
  "text/markdown",
]);
export type FeedbackAttachmentMime = z.infer<typeof FeedbackAttachmentMime>;

/** UC-17.8 D3：一条反馈最多带几个附件。PDF §5.1「上限 5 个，超过后上传入口自动隐藏」。 */
export const FEEDBACK_ATTACHMENT_MAX = 5;

export const FeedbackAttachment = z
  .object({
    id: z.string(),
    url: z.string(),
    mime: FeedbackAttachmentMime,
  })
  .strict();
export type FeedbackAttachment = z.infer<typeof FeedbackAttachment>;

/**
 * UC-17.8 D1（2026-09-04 人类裁决）：**结构化补充字段**。
 *
 * PDF §5.1 要求缺陷 / 需求各自一组结构化字段。2026-09-02 的裁决「没有独立标题字段，
 * 标题从正文派生」**继续有效**——这里补的是更丰富的*内容*字段，不是标题框。
 *
 * ⚠ 存法是**一列 jsonb**（`product_feedback.structured`），不是每字段一列。理由与 I-F1 并不冲突：
 *   I-F1 反对的是「什么都能塞的口袋」；这里的形状由本 schema 闭合（`.strict()`），字段集随
 *   `kind` 定，排查时每个键都有名字。按 `kind` 扩字段 = 在这里加一个键，不是一次迁移。
 * ⚠ 全部 `.optional()`：用户可以只填正文不填结构化字段（PDF：「用户可以直接填写」），
 *   一个 `{}` 与不传等价。**正文 `detail` 仍是唯一必填**，它承载 `detail: null ⟺ 无权` 那条语义。
 * ⚠ 两个对象键集**不相交**，所以 `z.union` 能无歧义地判别，无需再塞一个 `kind` 进去重复上层。
 */
export const BugStructuredFields = z
  .object({
    /** 复现频率 · 环境（「每次 / 偶发 · Chrome 128 / iOS」） */
    reproFrequencyEnv: z.string().max(500).optional(),
    expectedResult: z.string().max(2000).optional(),
    actualResult: z.string().max(2000).optional(),
    /** 复现步骤，多行；AI 填充时是「1. 2. 3.」编号步骤 */
    reproSteps: z.string().max(4000).optional(),
  })
  .strict();
export const ReqStructuredFields = z
  .object({
    useScenario: z.string().max(2000).optional(),
    expectedCapability: z.string().max(2000).optional(),
    /** 优先级 · 影响范围（「P1 · 全部项目」） */
    priorityScope: z.string().max(500).optional(),
  })
  .strict();
export const FeedbackStructured = z.union([BugStructuredFields, ReqStructuredFields]);
export type FeedbackStructured = z.infer<typeof FeedbackStructured>;
export type BugStructuredFields = z.infer<typeof BugStructuredFields>;
export type ReqStructuredFields = z.infer<typeof ReqStructuredFields>;

/**
 * GitHub 那边的真实状态——**只在需要时现查，从不落库**。
 *
 * ⚠ 本仓的单一事实源纪律（AGENTS.md「同一事实不得声明在两处」）：issue 是不是
 *   still open、有没有 PR 关联它，事实源只有 GitHub 一处。落一份到我们数据库，
 *   等于开了第二个会漂移的副本——今天 GitHub 上关了，我们这边不主动同步就一直显示
 *   "open"，而没人会想到去核对。所以这一段**只出现在 `getFeedbackGithubIssue` 的
 *   `out` 里**，不出现在 `FeedbackItem`、不进任何一张表。
 */
export const GithubIssueLinkedPullRequestState = z.enum(["open", "closed", "merged"]);
export type GithubIssueLinkedPullRequestState = z.infer<typeof GithubIssueLinkedPullRequestState>;

export const GithubIssueLinkedPullRequest = z
  .object({
    number: z.number().int().positive(),
    url: z.string(),
    title: z.string(),
    state: GithubIssueLinkedPullRequestState,
  })
  .strict();
export type GithubIssueLinkedPullRequest = z.infer<typeof GithubIssueLinkedPullRequest>;

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
    /**
     * FB-5——同 `detail` 一条门控：`detail === null` 的行这里恒是空数组，不是
     * "这条反馈没有图"——见 `FeedbackAttachment` 头注、`list-feedback.ts` 的
     * `ListFeedbackDeps.attachments` 头注。
     */
    attachments: z.array(FeedbackAttachment),
    /**
     * UC-17.8 D1——与 `detail` 同一条 D3 门控：`detail === null` 的行这里恒 `null`。
     * 正文可见时，`null` 表示提交人没填任何结构化字段（它们是正文的补充，不是独立事实）。
     */
    structured: FeedbackStructured.nullable(),
    status: FeedbackStatus,
    /** ⚠ 只有 `不做` 必然非 null；其余三态可有可无 */
    statusReason: z.string().nullable(),
    /** I-F2：`COUNT(*)` 派生，不是存下来的列 */
    votes: z.number().int().nonnegative(),
    /** 当前请求者投过没有——**同一个人不许把票数顶上去** */
    votedByMe: z.boolean(),
    submittedByMe: z.boolean(),
    /**
     * 提交人的显示名（后台列表/详情用，2026-09-02 新后台设计）。⚠ 与 `detail` 同一条
     * D3 门控：`detail === null` 的行这里恒是 `null`——提交人身份与正文一样只对管理员与
     * 本人给出。`null` 也可能是账号已注销查不到显示名；两者对读者都表现为「匿名用户」。
     */
    submitterName: z.string().nullable(),
    /** I-F1：客户端给的复现上下文，分列存 */
    occurredRoute: z.string().nullable(),
    appVersion: z.string().nullable(),
    createdAt: z.string(),
    /**
     * "转开发"时建的 GitHub issue。**null ⟺ 还没建过**（不是「建失败」——建失败时
     * `triageFeedback` fail closed，状态压根没转成 `已进入迭代`，见该操作头注①）。
     * 两个字段总是同生同灭：`githubIssueUrl` 非 null 时 `githubIssueNumber` 必非 null。
     * ⚠ 只是**存下来的**创建结果（url/number 本身不变）；issue 当前是开是关、有没有
     *   关联 PR 是 GitHub 那边的事实，**不在这里**——见 `getFeedbackGithubIssue`。
     */
    githubIssueUrl: z.string().nullable(),
    githubIssueNumber: z.number().int().positive().nullable(),
    /**
     * UC-17.8 B4——这条反馈被哪个 PM 设计方案解决了（`pushToInbox` 时回写，见迁移
     * `20260904150000_uc178_design_workbench.sql` 头注）。**不走 D3 门控**：同
     * `title`/`votes` 一样是恒对全组织可见的展示性事实（"已生成方案"这件事本身，
     * 不是方案内容），不是正文的一部分。
     */
    resolvedByDesignId: z.string().nullable(),
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

/**
 * UC-17.8 B1 —— 草稿上的一条对话。`kind` 区分「用户说的」/「AI 回执」/「正文被编辑」三种记录，
 * 见 `updateFeedbackDraft` 头注（追加不覆盖）。`at` 由服务端给。
 */
export const FeedbackDraftChatTurn = z
  .object({
    role: z.enum(["user", "ai"]),
    kind: z.enum(["message", "edit"]),
    text: z.string().min(1).max(4000),
    at: z.string(),
  })
  .strict();
export type FeedbackDraftChatTurn = z.infer<typeof FeedbackDraftChatTurn>;

/**
 * UC-17.8 B1 —— 反馈草稿（提交人私有）。
 *
 * ⚠ 与 `FeedbackItem` 是**两个类型**，不是一个带 `isDraft` 布尔的联合：草稿没有状态机、没有票、
 *   没有 D3 可见性（只有 owner 能读，正文恒可见）、没有 GitHub——把它们合在一起会让每个字段都要
 *   解释「草稿时这个是什么意思」。
 * ⚠ `title` 是服务端按与提交口相同的规则从 `detail` 派生的**预览**，空正文时为 `null`。
 */
export const FeedbackDraft = z
  .object({
    id: z.string(),
    kind: FeedbackKind,
    target: FeedbackTarget,
    title: z.string().nullable(),
    detail: z.string(),
    structured: FeedbackStructured.nullable(),
    attachments: z.array(FeedbackAttachment),
    chat: z.array(FeedbackDraftChatTurn),
    /** 「继续完善」浮层首次打开时是否已由服务端追加过 AI 澄清问题（只追加一次） */
    refineSeeded: z.boolean(),
    occurredRoute: z.string().nullable(),
    appVersion: z.string().nullable(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .strict();
export type FeedbackDraft = z.infer<typeof FeedbackDraft>;

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
   *
   * ⚠ FB-5：`attachmentIds` 是**已经**上传过的附件 id（先调 `uploadFeedbackAttachment`
   *   拿到 id，再塞进这里）——这条操作本身不接字节。`.optional()` 是对 `.strict()`
   *   契约新增字段的唯一向后兼容方式（同 `issueDraft` 的既有先例）：旧调用方不传，
   *   契约照样过。
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
        attachmentIds: z.array(z.string()).max(FEEDBACK_ATTACHMENT_MAX).optional(),
        /** UC-17.8 D1：结构化补充字段，可不传。见 `FeedbackStructured` 头注 */
        structured: FeedbackStructured.optional(),
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
   * ## 2026-09-02 新增第三个副作用：**跟着状态同步 GitHub issue 的开关**（best-effort）
   *
   *   这条反馈**已经**挂着 issue（`githubIssueUrl !== null`，不论是不是这次转移建的）
   *   时，转 `已修复` 关闭并标 `completed`，转 `不做` 关闭并标 `not_planned`，转回
   *   `待处理`/`已进入迭代` 重新打开。**跟①（建 issue）不是同一条纪律**——建 issue
   *   fail closed 是因为"状态改了但没人知道 issue 建没建成"是假象；而这里 GitHub
   *   issue 的开关**从属于**反馈状态这个已经落库的事实，不是反过来，所以失败只记日志、
   *   不影响这次转移本身（同②发邮件的理由）。没有新增字段来暴露"这次同步成不成
   *   功"——管理员想知道 GitHub 那边真实状态，调 `getFeedbackGithubIssue` 现查，
   *   不靠这次响应里的某个布尔（那个布尔只能代表"这次调用有没有报错"，不能代表
   *   "GitHub 上现在到底是什么状态"，两者一混就是又一份可能对不上的副本）。
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
        /**
         * 2026-09-04——建 issue 时,这条反馈的哪些图片附件没能真的推到 GitHub、
         * 内嵌进正文（best-effort，见用例 `triageFeedback` 头注⑥）。恒是数组
         * （可能为空），不是 `undefined`：没有走「转开发」这条分支时天然没有
         * 图片要传，是"没有警告"而不是"没检查"。调用方（后台屏）据此提示
         * "issue 已创建 #N，但以下图片未能内嵌"，不阻塞"转开发"本身成功这件事实。
         */
        imageUploadWarnings: z.array(z.string()),
      })
      .strict(),
    err: [
      "FEEDBACK_NOT_FOUND",
      "PERMISSION_REVOKED",
      "TRIAGE_REASON_REQUIRED",
      "DEPENDENCY_UNAVAILABLE",
      /**
       * 2026-08-31（PR #2431 二轮独立审查阻断项①）：并发的两次"转开发"请求，
       * 后到的那个在原子认领（`claimGithubIssueCreation`）这一步就会被拒绝——
       * 不是下游依赖不可用（`DEPENDENCY_UNAVAILABLE`），是这件事正被另一个
       * 请求同时处理。调用方据此提示"请刷新后再看"，而不是无脑重试。
       */
      "ISSUE_CREATION_IN_PROGRESS",
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

  /**
   * 现查这条反馈挂着的 GitHub issue：开/关状态 + 关联它的 PR。**组织管理员**——
   * 和分诊同一批人用它，同一条权限纪律（`canTriage`）。
   *
   * ⚠ **不落库、每次都真的打一次 GitHub**（人类决策，2026-09-02）：见
   *   `GithubIssueLinkedPullRequest` 头注。前端只在管理员真的展开一条反馈的
   *   GitHub 状态时才调这条，不随 `listFeedback` 一起批量拉——避免每次刷新列表
   *   都对 GitHub API 发 N 个请求。
   * ⚠ `linkedPullRequests` 是「引用过这个 issue 的 PR」，**不是**「关闭这个 issue 的
   *   PR」——一个 issue 可以被多个 PR 提到（讨论、部分实现、最终合入），把它收窄成
   *   只认 `Closes #N` 那一个会在关联 PR 还没写上 `Closes` 关键字的过渡期里显示"没有
   *   关联 PR"，而人工在 GitHub 页面上明明看得到那个 PR。
   * ⚠ **`linkedPullRequestsAvailable: false` ≠ `linkedPullRequests: []`**（2026-09-02
   *   独立审查 P1 指出的真实 bug 已修）：issue 本身的开关状态与"关联 PR 列表"是两次
   *   独立的 GitHub 请求（issue 详情 + timeline），可用性不一样——issue 详情失败时
   *   整个操作 `DEPENDENCY_UNAVAILABLE`，但 timeline 单独失败（限流/超时/权限）不该
   *   连坐 issue 状态本身查不到，此时 `linkedPullRequests` 是空数组、
   *   `linkedPullRequestsAvailable` 是 `false`——调用方必须先看后者，为 `false` 时
   *   渲染"取不到，不是没有"，不能把它读成"真的没有 PR 引用"。
   */
  getFeedbackGithubIssue: {
    method: "GET",
    path: "/feedback/:feedbackId/github-issue",
    in: z.object({ feedbackId: z.string() }).strict(),
    out: z
      .object({
        feedbackId: z.string(),
        url: z.string(),
        number: z.number().int().positive(),
        state: z.enum(["open", "closed"]),
        /** 只有 `state === "closed"` 时可能非 null——GitHub 自己的关闭理由分类 */
        stateReason: z.enum(["completed", "not_planned"]).nullable(),
        linkedPullRequests: z.array(GithubIssueLinkedPullRequest),
        /** 见本操作头注最后一条⚠：`false` 时 `linkedPullRequests` 不代表真实事实 */
        linkedPullRequestsAvailable: z.boolean(),
      })
      .strict(),
    err: ["FEEDBACK_NOT_FOUND", "PERMISSION_REVOKED", "NO_GITHUB_ISSUE", "DEPENDENCY_UNAVAILABLE"] as const,
  },

  /**
   * 一条反馈**完整的状态流水**——含每一步「有没有真的发邮件通知提交人、发的是什么」。
   * 给后台看板的 detail 弹层用（人类原话：邮件的 update 需要可以在 detail 的界面看到）。
   *
   * ⚠ **组织管理员**，与 `getFeedbackGithubIssue` 同一条权限纪律（`canTriage`）——
   *   不是「管理员 OR 提交人」（D3 只裁决了反馈正文，从没裁决过分诊历史；这条历史里
   *   混着谁经手过，不该暴露给提交人）。见 `list-feedback-events.ts` 头注。
   * ⚠ `notified: false` 时 `emailSubject`/`emailText` 恒为 `null`——不是「没发」加一句
   *   「本来想发的文案」，那样调用方分不清「真没发」和「文案生成了但发送失败」。
   */
  listFeedbackStatusEvents: {
    method: "GET",
    path: "/feedback/:feedbackId/events",
    in: z.object({ feedbackId: z.string() }).strict(),
    out: z
      .object({
        events: z.array(
          z
            .object({
              id: z.string(),
              fromStatus: FeedbackStatus.nullable(),
              toStatus: FeedbackStatus,
              reason: z.string().nullable(),
              actorId: z.string(),
              notified: z.boolean(),
              emailSubject: z.string().nullable(),
              emailText: z.string().nullable(),
              createdAt: z.string(),
            })
            .strict(),
        ),
      })
      .strict(),
    err: ["FEEDBACK_NOT_FOUND", "PERMISSION_REVOKED"] as const,
  },

  /**
   * 往这条反馈挂着的 GitHub issue 下面发一条评论。**组织管理员**，手动输入、手动
   * 提交——不是状态转移的副作用（那条是 `triageFeedback` 内部恒定行为，见其头注，
   * 会自动带一条系统评论；这条是管理员想额外补充说明时用的，两者不是一回事）。
   */
  commentOnFeedbackGithubIssue: {
    method: "POST",
    path: "/feedback/:feedbackId/github-issue/comments",
    in: z
      .object({
        feedbackId: z.string(),
        /** ⚠ `.min(1)` 校验的是"非空字符串"，用例层再判一次"trim 后非空白"（同一理由） */
        body: z.string().min(1).max(4000),
      })
      .strict(),
    out: z.object({ feedbackId: z.string(), commentUrl: z.string() }).strict(),
    err: [
      "FEEDBACK_NOT_FOUND",
      "PERMISSION_REVOKED",
      "NO_GITHUB_ISSUE",
      "COMMENT_BODY_REQUIRED",
      "DEPENDENCY_UNAVAILABLE",
    ] as const,
  },

  /**
   * FB-5 —— 上传一张图片附件，拿到的 `attachmentId` 再塞进 `submitFeedback.
   * attachmentIds` 一起提交。**任何组织成员都能用**（提反馈本身不限管理员）。
   *
   * ⚠ 这条 `in` 只是**元数据**——同 `identity.uploadOwnAvatar` 的既有先例：真正的
   *   字节走同一个 HTTP 请求的 `multipart/form-data`，一个 `meta` 字段（JSON，须与
   *   这份 zod 校验一致）+ 一个 `file` 字段（二进制），controller 用 multer 解析。
   *   服务端**必须对实际字节重新做校验**（体积、magic-byte 与声明的 contentType
   *   一致），声明的 `sizeBytes`/`contentType` 不是真相来源——见
   *   `upload-feedback-attachment.ts`。
   * ⚠ 这一版**没有脱敏**——见 `FeedbackAttachment` 头注、该用例的文件头注（已知限制，
   *   登记在案，不是遗漏）。
   */
  uploadFeedbackAttachment: {
    method: "POST",
    path: "/feedback/attachments",
    in: z
      .object({
        sizeBytes: z.number().int().positive().max(8 * 1024 * 1024),
        contentType: FeedbackAttachmentMime,
      })
      .strict(),
    out: z.object({ attachmentId: z.string(), url: z.string() }).strict(),
    err: ["FILE_TOO_LARGE", "UNSUPPORTED_CONTENT_TYPE", "MALWARE_DETECTED", "DEPENDENCY_UNAVAILABLE"] as const,
  },

  /**
   * FB-5 —— 把一段语音转录出来的自由文本整理成 `{kind, title, detail}`，填进
   * "提交反馈"表单、人工再改再提交。**任何组织成员都能用**，同 `submitFeedback`。
   *
   * ⚠ **语音本身不是这条操作管的**——转录复用既有的 chat composer 麦克风实时转写
   *   通路（`WS /chat/asr-draft`），这条操作接手的起点是转录**完成之后**的文字。
   *   见 `structure-feedback-draft.ts` 头注。
   * ⚠ 失败（模型不可用/超时/输出解析不出）**不丢用户已经说出口的话**——转录文字
   *   本身已经在前端输入框里，这条操作失败只是「没帮你整理」，调用方据此提示
   *   「AI 整理失败，你可以手动填」而不是清空表单。
   */
  structureFeedbackDraft: {
    method: "POST",
    path: "/feedback/structure-draft",
    in: z.object({ transcript: z.string().min(1).max(8000) }).strict(),
    out: z
      .object({
        kind: FeedbackKind,
        title: z.string(),
        detail: z.string(),
        /**
         * UC-17.8 B2.4：模型按 `kind` 拆出的结构化字段；模型没拆出来 / 旧模型配置 ⇒ `null`，
         * 调用方只填正文。`detail` 仍是完整原文，结构化字段是它的补充。
         */
        structured: FeedbackStructured.nullable(),
      })
      .strict(),
    err: ["STRUCTURING_FAILED", "DEPENDENCY_UNAVAILABLE"] as const,
  },

  /* ─────────── UC-17.8 B1 · 反馈草稿（提交人私有，未进收件箱）─────────── */

  /**
   * 建一条草稿。**任何组织成员都能用**。草稿是提交人的私有物：只有 owner 能列、改、删、提交。
   *
   * ⚠ 草稿**不是**一条反馈：不进 `product_feedback`，不计票、不进分诊队列、不进「我提过的」。
   *   它只是一个「还没想清楚」的中间态；进收件箱的唯一途径是 `submitFeedbackDraft`。
   * ⚠ `detail` 允许空——草稿的意义正是「先占个位」；空正文的草稿在 `submitFeedbackDraft` 时被
   *   `DRAFT_EMPTY` 拒绝，而不是在这里。
   * ⚠ `attachmentIds` 同 `submitFeedback`：先 `uploadFeedbackAttachment` 拿 id，再挂到草稿上
   *   （`feedback_attachments.draft_id`），提交时随草稿一起迁给反馈。
   */
  createFeedbackDraft: {
    method: "POST",
    path: "/feedback/drafts",
    in: z
      .object({
        kind: FeedbackKind,
        target: FeedbackTarget,
        detail: z.string().max(4000),
        structured: FeedbackStructured.optional(),
        occurredRoute: z.string().nullable(),
        appVersion: z.string().nullable(),
        attachmentIds: z.array(z.string()).max(FEEDBACK_ATTACHMENT_MAX).optional(),
      })
      .strict(),
    out: z.object({ draftId: z.string() }).strict(),
    err: ["DEPENDENCY_UNAVAILABLE"] as const,
  },

  /** 我的草稿列表（按 `updatedAt` 倒序）。⚠ 只有自己的——没有 `scope`，草稿没有「全组织」口径。 */
  listMyFeedbackDrafts: {
    method: "GET",
    path: "/feedback/drafts",
    in: z.object({}).strict(),
    out: z.object({ items: z.array(FeedbackDraft) }).strict(),
    err: ["DEPENDENCY_UNAVAILABLE"] as const,
  },

  /** 草稿数——导航徽标用。同 `getFeedbackCounts` 的分离理由：徽标每次路由都要，不该拉整个列表。 */
  getMyFeedbackDraftCount: {
    method: "GET",
    path: "/feedback/drafts/count",
    in: z.object({}).strict(),
    out: z.object({ count: z.number().int().nonnegative() }).strict(),
    err: ["DEPENDENCY_UNAVAILABLE"] as const,
  },

  /**
   * 改草稿：类型 / 正文 / 结构化字段，以及**追加一条对话**（「继续完善」浮层每发一句都追加）。
   *
   * ⚠ 对话是**追加**不是覆盖（PDF §7 已知模拟点：编辑覆盖会丢原始轨迹）：正文编辑追加一条
   *   `{ role: "user", kind: "edit" }` 的记录，`detail` 才是当前值。
   * ⚠ 至少要给一个字段；四个都不传是空操作，契约层不拦（`.optional()` 全体），用例层原样返回。
   */
  updateFeedbackDraft: {
    method: "PATCH",
    path: "/feedback/drafts/:draftId",
    in: z
      .object({
        draftId: z.string(),
        kind: FeedbackKind.optional(),
        detail: z.string().max(4000).optional(),
        structured: FeedbackStructured.nullable().optional(),
        appendChat: FeedbackDraftChatTurn.omit({ at: true }).optional(),
      })
      .strict(),
    out: z.object({ draft: FeedbackDraft }).strict(),
    err: ["DRAFT_NOT_FOUND", "DEPENDENCY_UNAVAILABLE"] as const,
  },

  /** 删草稿。硬删——草稿没有历史价值；它上面挂的附件回到「未认领」并随清理任务回收。 */
  deleteFeedbackDraft: {
    method: "DELETE",
    path: "/feedback/drafts/:draftId",
    in: z.object({ draftId: z.string() }).strict(),
    out: z.object({ draftId: z.string() }).strict(),
    err: ["DRAFT_NOT_FOUND", "DEPENDENCY_UNAVAILABLE"] as const,
  },

  /**
   * 把草稿提交成一条反馈：事务内 **建反馈（同 `submitFeedback` 全部规则）→ 附件改挂到反馈 → 删草稿**。
   *
   * ⚠ 标题由**服务端**从正文派生（首行、≤120 字），与前端 `deriveFeedbackTitle` 同一规则——
   *   草稿提交口没有客户端参与标题，规则不能在两端各写一份，所以服务端这份是权威，
   *   前端那份只是预览。
   * ⚠ 对话记录**不进反馈正文**：正文 = `detail` 当前值。对话是提交人与 AI 把边界谈清楚的过程，
   *   谈清楚的结果应当已经被写回 `detail`/`structured`；把整段对话塞进正文会让分诊的人读一段聊天。
   */
  submitFeedbackDraft: {
    method: "POST",
    path: "/feedback/drafts/:draftId/submit",
    in: z.object({ draftId: z.string() }).strict(),
    out: z
      .object({
        feedbackId: z.string(),
        /** 恒 `待处理`，同 `submitFeedback` */
        status: FeedbackStatus,
      })
      .strict(),
    err: ["DRAFT_NOT_FOUND", "DRAFT_EMPTY", "DEPENDENCY_UNAVAILABLE"] as const,
  },
} as const;

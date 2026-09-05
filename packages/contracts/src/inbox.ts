/**
 * 契约束 `inbox-unified` — ③ API 契约（**唯一事实源**）
 *
 * ADR-020：这一份是前后端类型、运行时校验、OpenAPI 的共同来源，任何一样都不许手写第二份。
 *
 * 覆盖：**UC-17.8 Sprint 2 · B3.1「统一收件箱」**，
 * 见 `phases/phase-03-reuse-and-governance/requirements/17-gov/uc-17-8-go-live-backlog.md` §B3，
 * 需求 R4.3（`uc-17-8-研发闭环-反馈到设计到排期.md`）。
 * D2 裁决（2026-09-04）：收件箱**替换**旧 `/platform-admin/feedback` 三 tab——它是同一状态机的
 * 新投影，两屏并存 = 同一事实两处声明。
 *
 * ## 这份契约**只读、不存**——它是投影，不是第二套存储
 *
 * 收件箱把两条（将来三条）来源折成一张列表：
 *
 *   · **反馈**（`feedback-loop.ts` 的 `FeedbackItem`，状态机 `FeedbackStatus` 四态）
 *   · **系统异常**（`system-error-logs.ts` 的 `SystemErrorLogItem`，状态机 `SystemErrorStatus` 三态）
 *   · **设计方案**（`kind: "design"`）——**本轮只保留枚举值，没有数据**。B4（束 `design-workbench`）
 *     才有 `design_projects` 表与推送动作；在那之前 `listInbox` 永远不会返回 `kind === "design"`
 *     的条目，`getInboxCounts.byKind.design` 恒为 0。现在就把值留在枚举里，是为了让前端筛选 Chip
 *     的闭集（全部 / 缺陷 / 需求 / 系统异常 / 设计方案）今天就能按契约渲染，而不是 B4 时再改一次枚举。
 *
 * ## `InboxStage` 是**派生的只读投影**，唯一映射表在这里
 *
 * 两个源各有自己的状态枚举与状态机；收件箱的四列（待处理 → 进行中 → 已完成 → 不做）只是给它们
 * 一个**统一的显示位置**，不是一列新的存储状态。映射表全仓只有这一份，实现只有 `stageOf` 一处：
 *
 *   | 源                   | 源状态       | stage      |
 *   |----------------------|--------------|------------|
 *   | `FeedbackStatus`     | 待处理       | `backlog`  |
 *   | `FeedbackStatus`     | 已进入迭代   | `doing`    |
 *   | `FeedbackStatus`     | 已修复       | `done`     |
 *   | `FeedbackStatus`     | 不做         | `archived` |
 *   | `FeedbackStatus`     | 已归档       | `archived` |
 *   | `SystemErrorStatus`  | 待处理       | `backlog`  |
 *   | `SystemErrorStatus`  | 已转入开发   | `doing`    |
 *   | `SystemErrorStatus`  | 不做         | `archived` |
 *
 *   ⚠ **`已归档` 与 `不做` 共用 `archived` 列**（issue #2681）——两者都是"已经有结论、
 *     不再需要占用活跃视图"的反馈，`InboxStage` 只有四列，不为 `已归档` 单开一列；
 *     两者在源状态机（`feedback-loop.ts`）里仍是不同的状态，`archived` 只是它们在
 *     这张统一投影上共享的显示位置，不是把两者合并成一个状态。
 *   ⚠ **系统异常没有 `done`**——`SystemErrorStatus` 就是三态（见该文件 `status` 头注的状态机），
 *     收件箱不替它发明一个「已修复」。看板把一条系统异常拖进「已完成」列时，前端**没有**可调的
 *     迁移，按钮必须不存在（本束沿用 feedback-loop 的纪律：没有契约操作 ⇒ 前端不许有按钮）。
 *   ⚠ `api` 与 `web` **都只许调 `stageOf`**，不许各抄一份 switch——本仓已五次因「同一事实两处
 *     声明」漂移，`.harness/scripts/lint-contract-source.mjs` 会抓手写副本。
 *
 * ## 状态迁移**不新建接口**
 *
 *   · 反馈 → `feedbackLoop.operations.triageFeedback`（`PUT /feedback/:feedbackId/status`），
 *     含 `TRIAGE_REASON_REQUIRED`、`issueDraft`（创建 GitHub Issue）、邮件通知、issue 开关同步。
 *   · 系统异常 → `systemErrorLogs.operations.updateSystemErrorLifecycle`（`PUT /system/error-logs/:id`），
 *     含 `REASON_REQUIRED` / `INVALID_TRANSITION` / `CONCURRENT_UPDATE`。**只对平台超管放行**。
 *   · 投票 → `feedbackLoop.operations.voteFeedback`；GitHub Issue 现查 →
 *     `feedbackLoop.operations.getFeedbackGithubIssue`；评论 → `commentOnFeedbackGithubIssue`；
 *     drawer 时间线 → `feedbackLoop.operations.listFeedbackStatusEvents`。
 *   前端拿到一条 `InboxItem` 后按 `kind` 选上面那条操作，`id` 就是源对象的 id（反馈的 `feedbackId`
 *   / 系统异常的 `id`）。在这里再包一层 `PUT /inbox/:id/status` 只会让同一条状态机多一个入口、
 *   多一份错误码映射，而两个入口的行为迟早对不上。
 *
 * ## 谁能打开收件箱：**本组织任何成员**；正文仍按 D3 逐行判
 *
 *   `listInbox` / `getInboxCounts` 只对**不是本组织成员**的请求者 `PERMISSION_REVOKED`。
 *   B3.2 起曾收紧到组织管理员（`canTriage`），B3.6 让收件箱**替换**旧三 tab 屏之后，这道门
 *   把已签核的 D3「标题+票数对全组织可见」收回去了——非管理员连标题都看不到，且提交/存草稿
 *   后的默认导航把他们直接导到 403（backlog D8）。2026-09-05 人类裁决 D8 取方案 ③：放宽读路径。
 *   放宽的**只是读**：反馈条目的 `body`/`structured` 仍逐行走 `feedback-loop` 的 D3 判定
 *   （非管理员、非提交人 ⇒ `null`，见 `InboxItem.body` 头注）；系统异常那一半仍只对平台超管
 *   （下一节）；分诊/投票/深化各自的契约操作各自判权限，本契约不替它们放行。
 *
 * ## 系统异常源对非超管：**不报错，只是不含**
 *
 *   `error_logs` 没有 `org_id`（见 `system-error-logs.ts` 文件头：跨租户泄露风险），读它需要
 *   平台超管身份。组织管理员打开收件箱时，`listInbox` **不能**因此 `NOT_PLATFORM_SUPERUSER`
 *   ——他有权看反馈那一半。所以：结果里不含 `exception` 条目，并用 `sources.exception: "withheld"`
 *   如实说出来，前端据此在「系统异常」Chip 旁提示「仅平台运维可见」，而不是显示一个空列表让人
 *   以为系统零异常。`getInboxCounts` 同一条规则（`byKind.exception` 为 0 且 `sources` 同样标 withheld）。
 *
 * ## ⚠ 本文件刻意**没有**的东西
 *
 *   · **`PUT /inbox/:id/status`**——见上。
 *   · **`design` 的任何字段以外的东西**（`linkedFeedbackId` / `resolvedByDesignId` 本轮恒 null）——
 *     B4 才有数据；留字段是为了 B4 不改 `.strict()` 形状，不是为了现在就渲染关联标。
 *   · **反馈的 `severe`**——需求说「由反馈标签派生」，而反馈今天没有标签（`FeedbackItem` 无 `tags`）。
 *     恒 `false` 是诚实的，把票数或 `kind === "缺陷"` 硬当「严重」是编一个口径。
 */
import { z } from "zod";
import { FeedbackAttachment, FeedbackKind, FeedbackStatus, FeedbackStructured } from "./feedback-loop";
import { SystemErrorStatus } from "./system-error-logs";

/* ─────────────────────────── 枚举 ─────────────────────────── */

/**
 * 条目来源。**闭集三值**；`design` 本轮无数据（见文件头）。
 * 反馈内部的「缺陷 / 需求」不在这里——那是 `feedbackKind`，同一条目的第二维。
 */
export const InboxKind = z.enum(["feedback", "exception", "design"]);
export type InboxKind = z.infer<typeof InboxKind>;

/**
 * 四列显示位置。**派生值，不落库**——映射表见文件头，实现见 `stageOf`。
 * 顺序即看板列顺序（R4.3：待处理 → 进行中 → 已完成 → 不做）。
 */
export const InboxStage = z.enum(["backlog", "doing", "done", "archived"]);
export type InboxStage = z.infer<typeof InboxStage>;

/**
 * 源状态 → stage 的**唯一实现**。api（聚合查询）与 web（乐观更新时算目标列）都只调它。
 *
 * ⚠ `design` 本轮没有源状态枚举，传进来一律抛错——这是「B4 还没到」的显式信号，
 *   不是返回一个默认列把没定义的东西糊过去。
 * ⚠ 不用 `Record<string, InboxStage>` 查表：那会让 `stageOf("feedback", "已转入开发")` 在
 *   编译期通过。重载让「哪个 kind 配哪套状态」在类型层就成立。
 */
export function stageOf(kind: "feedback", status: FeedbackStatus): InboxStage;
export function stageOf(kind: "exception", status: SystemErrorStatus): InboxStage;
export function stageOf(kind: InboxKind, status: string): InboxStage;
export function stageOf(kind: InboxKind, status: string): InboxStage {
  if (kind === "feedback") {
    switch (status as FeedbackStatus) {
      case "待处理":
        return "backlog";
      case "已进入迭代":
        return "doing";
      case "已修复":
        return "done";
      case "不做":
        return "archived";
      case "已归档":
        return "archived";
    }
  }
  if (kind === "exception") {
    switch (status as SystemErrorStatus) {
      case "待处理":
        return "backlog";
      case "已转入开发":
        return "doing";
      case "不做":
        return "archived";
    }
  }
  throw new Error(`stageOf: no mapping for kind=${kind} status=${status}`);
}

/**
 * 系统异常判「严重」的次数阈值：同一条 `msg` 在 `error_logs` 里的出现次数（`exception.count`）
 * `>=` 这个数即 `severe`。**只在这里声明一次**，api 聚合与 web 展示都读它。
 *
 * ⚠ 需求原文是「次数阈值 **或** level=error」。`error_logs` 没有 `level` 列——表里每一行**本来就是**
 *   一次未处理异常（见 `20260901024515_error_logs.sql`），「level=error」对它恒真，加进口径等于
 *   把所有系统异常都标红，红标就没有信息量了。所以本轮口径**只有次数**；将来若上报口带了 level，
 *   在这里补条件，不在别处另写一份。
 */
export const INBOX_EXCEPTION_SEVERE_COUNT_THRESHOLD = 10;

/**
 * 错误码。⚠ 每一个成员都在下方某个操作的 `err` 里出现。
 *
 * 没有 `NOT_PLATFORM_SUPERUSER`：非超管**不是错误**，见文件头「不报错，只是不含」。
 */
export const InboxError = z.enum([
  /** 连组织内的反馈都无权读（不是组织成员 / 权限被撤销） */
  "PERMISSION_REVOKED",
  /** 超时/网络/下游不可用。⚠ 可安全重试（只读操作） */
  "DEPENDENCY_UNAVAILABLE",
]);
export type InboxError = z.infer<typeof InboxError>;

/* ─────────────────────── 投影（读模型）─────────────────────── */

/**
 * GitHub 徽标（R4.3：`Issue #142 · Open` / `PR #145 · Draft` / `PR #130 · Merged`）。
 *
 * ## 派生规则（服务端，单一实现）
 *
 *   · **反馈**：`githubIssueUrl === null` ⇒ `null`。否则 `listInbox` **只用存下来的**
 *     `githubIssueUrl` / `githubIssueNumber` 给出 `{ kind: "issue", number, url, state }`，其中
 *     `state` 由 `sourceStatus` 推得：`已修复` / `不做` / `已归档` ⇒ `closed`，其余 ⇒ `open`——这正是
 *     `triageFeedback` 第三个副作用（跟着状态同步 issue 开关）**应当**让 GitHub 处于的状态。
 *     列表**不打 GitHub**（feedback-loop 的纪律：不随列表批量拉，避免 N 个请求）。
 *   · drawer 展开后前端调 `getFeedbackGithubIssue` 现查，若 `linkedPullRequestsAvailable` 且
 *     `linkedPullRequests` 非空，徽标**升级为 PR**：取优先级 `merged` > `open` > `closed` 的第一条
 *     （`draft` 由 GitHub PR 的 draft 标记给出，现查结果里今天没有这个位——`getFeedbackGithubIssue`
 *     的 `GithubIssueLinkedPullRequestState` 是三值；`draft` 留在这里的枚举里是为了 B3.5 补那一位时
 *     不改本形状）。issue 真实开关也以现查为准覆盖列表里的推断值。
 *   · **系统异常 / 设计方案**：本轮恒 `null`（系统异常「转开发」没有建 issue 的动作）。
 */
export const InboxGithubRef = z
  .object({
    kind: z.enum(["issue", "pr"]),
    number: z.number().int().positive(),
    url: z.string(),
    state: z.enum(["open", "draft", "merged", "closed"]),
  })
  .strict();
export type InboxGithubRef = z.infer<typeof InboxGithubRef>;

/**
 * 系统异常特有的元信息（R4.3 drawer：位置 / 次数 / 影响用户）。
 *
 *   · `location`：发生位置——前端上报的 `url`，或后端异常的请求路径；取不到为 `null`。
 *   · `count`：同一条 `msg` 在 `error_logs` 里的出现次数（含本条），`>= 1`。`severe` 的依据。
 *   · `affectedUsers`：受影响的不同用户数。⚠ `error_logs` 今天**没有用户列**（很多异常发生在
 *     租户上下文确定之前），所以本轮恒 `null`——`null` = 「源说不出来」，**不是** 0。
 */
export const InboxExceptionMeta = z
  .object({
    location: z.string().nullable(),
    count: z.number().int().positive(),
    affectedUsers: z.number().int().nonnegative().nullable(),
  })
  .strict();
export type InboxExceptionMeta = z.infer<typeof InboxExceptionMeta>;

/**
 * 收件箱条目。**一个 shape 服务三种来源**，差异靠 `kind` + 「仅某类非 null」的字段表达。
 *
 * ## 展示编号 `code`
 *
 *   `B-n`（缺陷）/ `R-n`（需求）/ `E-n`（系统异常）/ `D-n`（设计方案）。`n` 由服务端按
 *   **同前缀在该 org 内的创建顺序**（`createdAt`，同刻按 id）计算——**不新增列**，它是
 *   `ROW_NUMBER()` 的结果，不是存下来的编号。系统异常没有 org，按全平台顺序。
 *   ⚠ 只做展示与搜索（`q` 命中它）；跳转/定位一律用 `id`。同一 org 内一条记录的 `code` 稳定
 *     （只增不删，历史事实），但它**不是**跨 org 唯一的标识。
 *
 * ## 「仅某类」字段一览（其余情况的值是契约的一部分，不是「随便」）
 *
 *   | 字段              | feedback                         | exception                   | design（B4） |
 *   |-------------------|----------------------------------|-----------------------------|--------------|
 *   | `body`            | `detail`（D3 门控：无权 ⇒ null）  | `msg`                       | —            |
 *   | `structured`      | `FeedbackStructured \| null`     | `null`                      | `null`       |
 *   | `feedbackKind`    | `缺陷 \| 需求`                   | `null`                      | `null`       |
 *   | `sourceStatus`    | `FeedbackStatus` 的值            | `SystemErrorStatus` 的值    | —            |
 *   | `severe`          | 恒 `false`（见文件头）           | `count >= 阈值`             | —            |
 *   | `votes`           | `COUNT(*)`（I-F2）               | `0`                         | `0`          |
 *   | `reporter`        | `submitterName`（D3 门控）       | `null`                      | —            |
 *   | `github`          | 见 `InboxGithubRef`              | `null`                      | `null`       |
 *   | `attachments`     | `FeedbackAttachment[]`（D3 门控） | `[]`                        | `[]`         |
 *   | `exception`       | `null`                           | `InboxExceptionMeta`        | `null`       |
 *   | `votedByMe`       | 真值                             | `false`                     | `false`      |
 *   | `submittedByMe`   | 真值                             | `false`                     | —            |
 */
export const InboxItem = z
  .object({
    /** 源对象的 id：反馈的 `feedbackId` / 系统异常的 `id`。状态迁移时原样传给源操作 */
    id: z.string(),
    kind: InboxKind,
    /** 展示编号，见头注 */
    code: z.string().regex(/^[BRED]-\d+$/),
    /** 反馈 = 反馈标题；系统异常 = `aiTitle ?? msg`（AI 标题没生成时退回原始消息，不留空） */
    title: z.string(),
    /** ⚠ 反馈的 `null` ⟺ 无权看正文（D3），**不是**正文为空——同 `FeedbackItem.detail` */
    body: z.string().nullable(),
    /** 仅反馈；与 `body` 同一条 D3 门控（`body === null` ⇒ 恒 `null`） */
    structured: FeedbackStructured.nullable(),
    /** 仅反馈 */
    feedbackKind: FeedbackKind.nullable(),
    /** 原始状态字符串（`FeedbackStatus` 或 `SystemErrorStatus` 的值）。drawer 的状态标签显示它 */
    sourceStatus: z.string(),
    /** `stageOf(kind, sourceStatus)`——服务端算好，前端不再算第二次 */
    stage: InboxStage,
    /** 只有 `不做` 必然非 null（两个源都是这条规则） */
    statusReason: z.string().nullable(),
    /** 系统异常：`exception.count >= INBOX_EXCEPTION_SEVERE_COUNT_THRESHOLD`；反馈：恒 `false` */
    severe: z.boolean(),
    votes: z.number().int().nonnegative(),
    /** `submitterName`，D3 门控；非反馈恒 `null` */
    reporter: z.string().nullable(),
    createdAt: z.string(),
    github: InboxGithubRef.nullable(),
    /**
     * 仅反馈：附件（与 `body` 同一条 D3 门控——`body === null` ⇒ 恒 `[]`；非反馈恒 `[]`）。
     * 2026-09-05 加：「转入开发」的 issue 确认表单要让管理员**看见**哪些文件会随 issue 上传，
     * 不再是"看不见的附件区块"。形状直接复用 feedback-loop 的 `FeedbackAttachment`。
     */
    attachments: z.array(FeedbackAttachment),
    /** B4：设计方案「源自 B-3」——指向那条反馈的 `id`。本轮恒 `null` */
    linkedFeedbackId: z.string().nullable(),
    /** B4：反馈「已生成 D-2」——指向那条设计方案的 `id`。本轮恒 `null` */
    resolvedByDesignId: z.string().nullable(),
    /** 仅系统异常 */
    exception: InboxExceptionMeta.nullable(),
    submittedByMe: z.boolean(),
    votedByMe: z.boolean(),
  })
  .strict();
export type InboxItem = z.infer<typeof InboxItem>;

/**
 * 来源可见性。`withheld` = 请求者不是平台超管，系统异常那一半**没有被查询**——不是查了为空。
 * 前端据此显示「系统异常仅平台运维可见」。
 */
export const InboxSources = z
  .object({
    exception: z.enum(["included", "withheld"]),
  })
  .strict();
export type InboxSources = z.infer<typeof InboxSources>;

/** `listInbox` 的分页默认值 / 上限——只在这里声明一次，api 的 `??` 与 web 的 `pageSize` 都读它 */
export const INBOX_LIST_DEFAULT_LIMIT = 50;
export const INBOX_LIST_MAX_LIMIT = 200;

/* ─────────────────────────── 操作 ─────────────────────────── */

export const operations = {
  /**
   * 收件箱列表（组织管理员；系统异常那一半另按平台超管门控，见文件头）。
   *
   * ⚠ **分页**（与 `listFeedback` 不同）：这张表把系统异常也折了进来，量级不再是「一周几十条」。
   *   排序 `createdAt` 倒序、同刻按 `kind` + `id`；`cursor` 是服务端签发的不透明字符串
   *   （编码上一页最后一条的排序键），客户端**不解析、不构造**，`nextCursor === null` 即到底。
   *   不用 `offset`：`error_logs` 持续写入，offset 会跳行/重复行（同 `listSystemErrorLogs` 的理由）。
   * ⚠ `q` 匹配 `title` 与 `code`（「B-12」能搜到），**不搜正文**——正文受 D3 门控，按无权看的内容
   *   过滤会把「有没有」这件事泄露出去。
   * ⚠ `kind` / `stage` 都是单选（R4.3：Chip 互斥单选）；不传 = 全部。
   * ⚠ `in` 里没有 `orgId`：收件箱是后台屏，org 从 principal 的当前组织取（与 `listSystemErrorLogs`
   *   同一形状），传一个客户端说了算的 orgId 只会多一条要核对的输入。
   */
  listInbox: {
    method: "GET",
    path: "/inbox",
    in: z
      .object({
        kind: InboxKind.optional(),
        stage: InboxStage.optional(),
        q: z.string().max(200).optional(),
        /** 默认 `INBOX_LIST_DEFAULT_LIMIT`（50），最大 `INBOX_LIST_MAX_LIMIT`（200） */
        limit: z.number().int().min(1).max(INBOX_LIST_MAX_LIMIT).optional(),
        cursor: z.string().min(1).optional(),
      })
      .strict(),
    out: z
      .object({
        items: z.array(InboxItem),
        /** `null` ⟺ 没有下一页 */
        nextCursor: z.string().nullable(),
        sources: InboxSources,
      })
      .strict(),
    err: ["PERMISSION_REVOKED", "DEPENDENCY_UNAVAILABLE"] as const,
  },

  /**
   * 四列条数 + 各类型条数 + 总数（看板列头与 Chip 徽标用）。
   *
   * ⚠ **一次查询派生全部数字**，不是前端拿一页 `filter().length`——分页之后那样算出来的只是
   *   「当前页里的」（同 `getFeedbackCounts` 的理由）。
   * ⚠ 不带 `kind` / `stage` / `q` 过滤：这组数字是「收件箱整体」的口径。Chip 与列头同时显示时，
   *   一个受筛选影响、一个不受，用户分不清哪个是哪个；要「筛选后的条数」读 `listInbox` 的结果。
   * ⚠ `byKind.design` 本轮恒 0；`sources.exception === "withheld"` 时 `byKind.exception` 恒 0
   *   且四列数字**不含**系统异常。
   */
  getInboxCounts: {
    method: "GET",
    path: "/inbox/counts",
    in: z.object({}).strict(),
    out: z
      .object({
        byStage: z
          .object({
            backlog: z.number().int().nonnegative(),
            doing: z.number().int().nonnegative(),
            done: z.number().int().nonnegative(),
            archived: z.number().int().nonnegative(),
          })
          .strict(),
        byKind: z
          .object({
            feedback: z.number().int().nonnegative(),
            exception: z.number().int().nonnegative(),
            design: z.number().int().nonnegative(),
          })
          .strict(),
        total: z.number().int().nonnegative(),
        sources: InboxSources,
      })
      .strict(),
    err: ["PERMISSION_REVOKED", "DEPENDENCY_UNAVAILABLE"] as const,
  },
} as const;

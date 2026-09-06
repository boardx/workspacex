/**
 * 契约束 `design-workbench` — ③ API 契约（**唯一事实源**）
 *
 * ADR-020：这一份是前后端类型、运行时校验、OpenAPI 的共同来源，任何一样都不许手写第二份。
 *
 * 覆盖：**UC-17.8 Sprint 3 · B4.1「PM 设计工作台」**，
 * 见 `phases/phase-03-reuse-and-governance/requirements/17-gov/uc-17-8-go-live-backlog.md` §B4，
 * 需求 R4.4（`uc-17-8-研发闭环-反馈到设计到排期.md`）。
 * B4.2（迁移：`design_projects`/`design_project_chat_messages`/双向外键）、B4.3（API 事务）、
 * B4.4（「用 PM 设计工作台深化」真栈）都在本契约打的地基上做，字段与错误码在此一次定齐。
 *
 * ## 与 `inbox.ts` 的关系：**复用它预留的关联字段，不另造一套**
 *
 * `InboxItem.linkedFeedbackId` / `resolvedByDesignId` 本轮之前恒 `null`，是专门给 B4 留的位。
 * 本契约的 `DesignProject.linkedFeedbackId` 就是同一个概念在设计侧的镜像——B4.3 落地后：
 *   · 一条反馈「深化」出一个设计项目 ⇒ `DesignProject.linkedFeedbackId = <反馈 id>`，
 *     同时那条反馈对应的 `InboxItem.resolvedByDesignId` 回填为这个项目推送后生成的收件箱条目 id。
 *   · 双向关联在 DB 只有一对外键 + 唯一约束（B4.2），这里的两个字段是它的读投影，不是两份事实。
 *
 * ## 【待确认点 1】设计项目要不要 D3 门控（组织内谁能看见谁的项目）
 *
 * `feedback-loop.ts` 的 D3 门控是「反馈正文默认仅提交人与超管可见，仅摘要对外」，服务的是
 * 「反馈可能包含吐槽/隐私」这个动机。R4.4 与 R5 都没有对设计项目提出同等诉求：
 *   · R5 原文只把「PM 设计工作台」整体划给 PM/运营角色，**没有**在角色内部再分「谁能看谁的项目」。
 *   · R4.4 的操作描述（编辑/删除、推送）通篇是「项目」而非「我的项目」，首页卡片网格也没有
 *     提到按 owner 过滤——这与草稿（`FeedbackDraft`，明确「提交人私有」）的措辞形成对照。
 *   · 设计项目本身是**内部协作产出**（问题描述、验收标准、原型画布），不是像反馈正文那样可能
 *     携带的一次性吐槽；同一 PM 团队互相看得见彼此在做什么设计，反而符合「工作台」的协作语义。
 * 需求没有把这一点说清楚，所以这里**做出选择**：**组织内全员可读，仅 owner 可改/删/推送**——
 * 比照 D3 的保守版本会让「列出所有项目」这个最基础的操作也要过一层可见性判断，而这层判断
 * 需求完全没有描述该按什么规则收窄（不像反馈有「提交人 vs 非提交人」这个天然二分）。
 * `listMyProjects` 之所以叫「My」是 R4.4 的用户视角（「我的设计项目」按名称过滤），不是权限
 * 边界；它的 `ownerId` 过滤在应用层做，不代表别人的项目查不到——那是另一个尚未定义的操作。
 * 若将来需要「查看任意项目详情」，加一个不带 owner 过滤的读操作即可，不改这里的可见性口径。
 *
 * ## 【待确认点 2】首次默认引导语是展示层行为还是要落库的第一条消息
 *
 * R4.4 原文：「左侧固定 360px 对话面板……无历史时一条默认引导语」——用词是「无历史时**展示**」，
 * 不是「首次打开时**追加**一条」。对照草稿的「继续完善」浮层，PDF 原文是「首次打开自动**追加**
 * 一条 AI 澄清问题」，`FeedbackDraft.refineSeeded` 就是为了让服务端「只追加一次」这件事可判断
 * 而存在的标记；R4.4 描述设计项目引导语时**没有**用「追加」，也没有类似 `refineSeeded` 的「只出现
 * 一次」措辞——因为它的条件是「`chat` 为空」本身，`chat.length === 0` 就是天然的、不需要额外
 * 标记的判据。所以这里选**展示层**：`DesignProject` 不含引导语这条记录，`chat` 初始为 `[]`；
 * 前端在 `chat.length === 0` 时本地渲染 `DESIGN_WORKBENCH_CHAT_INTRO`（本文件常量导出，api/web
 * 同源）。一旦用户发送第一条消息，`appendProjectChat` 按「用户消息 + 固定回执」写入，引导语依旧
 * 不入库——它不是对话的一部分，只是空状态的占位提示，把它落库会让「第一条消息」在 UI 上和在
 * 数据里对不上（用户看到的第一条是引导语，数据库里第一条却是回执之后自己那条）。
 *
 * ## 推送幂等选的是 **upsert**，不是拒绝重复
 *
 * `pushToInbox` 的幂等键是 `projectId` 本身（`design_projects` 一行至多对应一条收件箱条目，
 * B4.2 的唯一约束保证）。选 upsert 而不是「已推送过就 `ALREADY_PUSHED` 拒绝」：
 *   · 需求把「推送到收件箱」按钮的态叫「已推送到收件箱」而不是禁用态——按钮点了一次以后
 *     还在，暗示它是可以再点的（比如改了 `note` 想重新说明一次给工程的备注）。
 *   · 拒绝重复会把「网络超时后用户手滑点了第二次」变成一个用户需要理解的错误，而这次操作
 *     本该是无害的——upsert 让重试天然安全，这正是幂等设计要解决的问题。
 *   · 因此 `DesignWorkbenchError` 里没有 `ALREADY_PUSHED`；`pushed`/`pushedAt`/`note`（收件箱
 *     条目那侧的说明）在重复推送时被最新一次调用覆盖，`inboxCode` 保持不变（同一条目的编号
 *     一旦生成不再改变，即使内容被更新）。
 *
 * ## ⚠ 本文件刻意**没有**的东西
 *
 *   · **`chat[]` 的独立查询接口**——同 `FeedbackDraft.chat` 的先例，直接嵌在实体里；B4.2 会建
 *     `design_project_chat_messages` 表，但那是存储层拆分，投影仍是 `DesignProject.chat`。
 *   · ~~画布/原型内容的字段~~——2026-09-06 人类决策推翻「B5.3 out of scope」：`prototype` 是按位置
 *     对应 `frames[i]` 的结构化组件树（`design-prototype.ts`），仍**只能经模型写回**，不接受前端传入。
 *   · **`PUT /pm-designs/:id/status`**——`go-live-backlog.md` §B3.1 提过这个假设路径，但
 *     设计方案没有状态机（`pushed: boolean` 就是它唯一的二态），状态迁移不需要单独接口；
 *     进收件箱后的状态机是 `InboxItem`/`system-error-logs` 那一套四态，属于 B3 契约，不在这里。
 */
import { z } from "zod";
import { AiReplySource, DesignChatReply } from "./design-ai-collab";
import { PrototypeNode } from "./design-prototype";

/* ─────────────────────────── 枚举与常量 ─────────────────────────── */

/**
 * 设计项目模板（PDF §5.4 首页三类入口）。**闭集三值**，同现有原型 mock `ProjectTemplate`。
 */
export const ProjectTemplate = z.enum(["mobile", "ui", "wireframe"]);
export type ProjectTemplate = z.infer<typeof ProjectTemplate>;

/**
 * 验收标准固定文案（R4.4：「说明」Tab 固定三条）。**服务端在创建时填入**，不接受前端传入——
 * 这三条是产品对「什么算做完」的统一定义，不是每个项目各自填写的自由文本。api 与 web 都读这份
 * 常量，不各写一份（本仓已因「同一事实两处声明」漂移五次）。
 */
export const DESIGN_PROJECT_INITIAL_CRITERIA: readonly string[] = [
  "明确问题与目标范围",
  "给出交互方案与边界情况处理",
  "列出验收标准供工程对齐",
];

/**
 * 画布页标签默认值（R4.4：画布 Tab 下的横向标签条）。新建项目时服务端填入，B5.3 之前
 * 画布内容本身是占位块，标签就是「页」这个概念此刻唯一的载体。
 */
export const DESIGN_PROJECT_INITIAL_FRAMES: readonly string[] = ["草稿页 1", "草稿页 2", "草稿页 3"];

/**
 * 对话面板空状态引导语（R4.4：「无历史时一条默认引导语」）。**展示层文案，不落库**——
 * 选择理由见文件头【待确认点 2】。api 不会在任何响应里返回这段文字当作一条 `chat` 记录；
 * 前端在 `chat.length === 0` 时本地渲染它。
 */
export const DESIGN_WORKBENCH_CHAT_INTRO =
  "把你想解决的问题说清楚，我会顺着它更新右边的原型画布和验收标准。可以先从「谁在什么场景下会用到」讲起。";

/**
 * 对话面板发送后的固定回执。D7（2026-09-02）上线时它是唯一路径；**UC-17.8 B5.2 起它是模型
 * 不可用/超时/输出为空时的退路**（`DesignProjectChatTurn.source: "fallback"`，见
 * `design-ai-collab.ts` 头注）。同 `feedback-loop.ts` 的纪律，回执文案在这里只声明一次。
 */
export const DESIGN_WORKBENCH_CHAT_REPLY = "好的，我记下了这个调整，稍后会更新原型画布。";

/* ─────────────────────────── 实体 ─────────────────────────── */

/**
 * 设计项目对话轮次。形状同 `feedback-loop.ts` 的 `FeedbackDraftChatTurn`，但没有 `kind`
 * （设计项目的对话没有「编辑正文」这个来源分支，草稿有）。
 */
export const DesignProjectChatTurn = z
  .object({
    role: z.enum(["user", "ai"]),
    text: z.string().min(1).max(4000),
    at: z.string(),
    /** B5.2：`role: "ai"` 的记录带来源（模型 / 退路）；`user` 记录与 B5.2 之前的旧记录没有 */
    source: AiReplySource.optional(),
  })
  .strict();
export type DesignProjectChatTurn = z.infer<typeof DesignProjectChatTurn>;

/**
 * UC-17.8 B4 —— PM 设计项目。
 *
 * ⚠ 可见性口径见文件头【待确认点 1】：**组织内全员可读，仅 owner 可改/删/推送**。
 *   `ownerName` 可为 `null`——同 `InboxItem.reporter` 的 D3 口径写法：调用方拿不到姓名时
 *   （比如 owner 已离开组织）不是错误，是「说不出来」，与「没有 owner」（不存在，本类型没有
 *   这种情况——项目恒有 owner）区分开。
 * ⚠ `criteria` / `frames` 是创建时由服务端按 `DESIGN_PROJECT_INITIAL_CRITERIA` /
 *   `DESIGN_PROJECT_INITIAL_FRAMES` 填入的**快照**，不是每次读取都重算的常量引用——
 *   将来若默认文案改版，已创建项目的验收标准不应该跟着变。
 *   UC-17.8 B5.2 起，`problem`/`criteria`/`frames` 可由 `appendProjectChat` 里的模型回复
 *   **经服务端**写回（`DesignChatWriteback` 严格解析）；用户仍不能直接编辑 `criteria`/`frames`。
 * ⚠ B5.3：`prototype[i]` 是 `frames[i]` 那一页的组件树。不变量：长度为 0（还没生成，画布显示
 *   占位块）或恰等于 `frames.length`——由下方 `superRefine` 机械门控，任何一端违反都解析失败。
 */
export const DesignProject = z
  .object({
    id: z.string(),
    name: z.string().min(1).max(200),
    template: ProjectTemplate,
    /** 背景/上下文（问题与目标）。可空字符串——新建时未填，不是 `null`（同 `FeedbackDraft.detail`） */
    problem: z.string().max(4000),
    criteria: z.array(z.string()),
    frames: z.array(z.string()),
    prototype: z.array(PrototypeNode),
    pushed: z.boolean(),
    pushedAt: z.string().nullable(),
    /** 本项目是否深化自某条反馈；见文件头「与 inbox.ts 的关系」 */
    linkedFeedbackId: z.string().nullable(),
    /**
     * 2026-09-05「转开发」——这个方案对应的 GitHub issue。两个字段**同生同灭**
     * （要么都非空，要么都为 `null`），由 `createDesignGithubIssue` 一次写入。
     *
     * ⚠ 这里**没有** issue 的开关状态（`open`/`closed`）。设计方案不落 `dev_status`
     *   列——那会与 GitHub 上那张 issue 的真实状态构成第二份事实源（见迁移
     *   `20260905180000_design_project_github_issue.sql` 头注「为什么不顺手加一个
     *   dev_status 列」）。收件箱据「有没有 issue」派生 stage，见 `inbox.ts`。
     */
    githubIssueUrl: z.string().nullable(),
    githubIssueNumber: z.number().int().positive().nullable(),
    chat: z.array(DesignProjectChatTurn),
    ownerId: z.string(),
    /** 见上方可见性口径注释 */
    ownerName: z.string().nullable(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .strict()
  .superRefine((p, ctx) => {
    if (p.prototype.length !== 0 && p.prototype.length !== p.frames.length) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "prototype must be empty or one tree per frame", path: ["prototype"] });
    }
  });
export type DesignProject = z.infer<typeof DesignProject>;

/* ─────────────────────────── 错误码 ─────────────────────────── */

/**
 * 错误码。⚠ 每一个成员都在下方某个操作的 `err` 里出现。
 *
 * 没有 `ALREADY_PUSHED`——`pushToInbox` 是 upsert，重复推送不是错误，见文件头「推送幂等」。
 */
export const DesignWorkbenchError = z.enum([
  /** 项目不存在，或存在但请求者所在组织与项目不一致 */
  "PROJECT_NOT_FOUND",
  /** `name` 为空或超过 200 字（`createProject`/`updateProject` 共用） */
  "NAME_REQUIRED",
  /** 改/删/推送时请求者不是该项目的 owner。见文件头【待确认点 1】：读操作不受此限 */
  "NOT_PROJECT_OWNER",
  /** 超时/网络/下游不可用 */
  "DEPENDENCY_UNAVAILABLE",
  /**
   * B4.4「用 PM 设计工作台深化」——源反馈不存在或不在本组织。
   * 同 `feedback-loop.ts` 的 `FEEDBACK_NOT_FOUND` 纪律：404 非 403，不泄露存在性。
   */
  "FEEDBACK_NOT_FOUND",
  /**
   * B4.4——请求者对这条反馈没有 D3 正文可见权（`feedback-detail-decision.ts`）。「深化」要把
   * 正文抄进 `problem`，看不到正文就不可能有意义地深化；同 `feedback-loop.ts` 的
   * `PERMISSION_REVOKED` 同一语义，这里不复用那个枚举（跨文件枚举会让"闭集在哪"分裂成两处）。
   */
  "FEEDBACK_DETAIL_NOT_VISIBLE",
  /**
   * 2026-09-05「转开发」——这个方案还没有推送到收件箱。转开发是**运维动作**，
   * 前提是这个方案已经作为收件箱条目存在；给一个还在草台上的私人方案建 issue
   * 会让 GitHub 上出现一张收件箱里找不到对应条目的票。
   */
  "PROJECT_NOT_PUSHED",
  /**
   * 2026-09-05——这个方案已经有 issue 了。**不是** upsert：`pushToInbox` 能 upsert
   * 是因为它写的是自己这张表的两列；建 issue 是一次不可回滚的外部副作用，
   * 「重复调用返回已有的那张」与「再建一张」都不对——前者悄悄吞掉一次明确的用户意图，
   * 后者让一个方案挂两张票。所以显式报错，让调用方看到已有的那张。
   */
  "DESIGN_ISSUE_ALREADY_EXISTS",
  /** 2026-09-05——另一个并发请求正在给这个方案建 issue（乐观锁未抢到，见迁移头注）。 */
  "DESIGN_ISSUE_IN_PROGRESS",
  /** 2026-09-05——GitHub 那一侧建失败（超时/鉴权/限流）。fail closed：库里不会留下半个 issue。 */
  "DESIGN_ISSUE_CREATION_FAILED",
]);
export type DesignWorkbenchError = z.infer<typeof DesignWorkbenchError>;

/* ─────────────────────────── 操作 ─────────────────────────── */

export const operations = {
  /**
   * 新建设计项目（首页「新建」弹窗 + B4.4「用 PM 设计工作台深化」共用）。
   *
   * ⚠ `criteria`/`frames`/`chat` 不接受前端传入：服务端按 `DESIGN_PROJECT_INITIAL_CRITERIA` /
   *   `DESIGN_PROJECT_INITIAL_FRAMES` 填入、`chat` 恒为 `[]`（见文件头【待确认点 2】）。
   * ⚠ `linkedFeedbackId` 可选：B4.4「深化」时由调用方（`POST /feedback/:id/deepen` 的服务端
   *   实现，不是前端直接传任意 id）传入；首页新建弹窗不传，恒为 `null`。契约层不校验这个 id
   *   指向的反馈是否存在/属于同一组织——那是 B4.3 用例层的职责（含回写 `resolvedByDesignId`）。
   */
  createProject: {
    method: "POST",
    path: "/pm-designs",
    in: z
      .object({
        name: z.string().min(1).max(200),
        template: ProjectTemplate,
        problem: z.string().max(4000).optional(),
        linkedFeedbackId: z.string().optional(),
      })
      .strict(),
    out: z.object({ project: DesignProject }).strict(),
    err: ["NAME_REQUIRED", "DEPENDENCY_UNAVAILABLE"] as const,
  },

  /**
   * 我的设计项目列表（R4.4 首页：卡片网格，支持按名称过滤）。
   *
   * ⚠ **不分页**，同 `listMyFeedbackDrafts` 的理由：个人/团队级项目量级小（同一 PM 团队，
   *   不是全组织反馈那种体量）。
   * ⚠ 「我的」是 R4.4 的用户视角过滤，不是可见性边界——见文件头【待确认点 1】。
   */
  listMyProjects: {
    method: "GET",
    path: "/pm-designs",
    in: z.object({ q: z.string().max(200).optional() }).strict(),
    out: z.object({ items: z.array(DesignProject) }).strict(),
    err: ["DEPENDENCY_UNAVAILABLE"] as const,
  },

  /**
   * 编辑项目（R4.4「编辑」弹窗：只改名称/模板/背景，同新建弹窗字段集）。
   *
   * ⚠ 不改 `criteria`/`frames`/`chat`——那些走详情页各自的操作（本轮 `criteria`/`frames`
   *   没有独立的用户编辑操作：用户不能直接改它们，B5.2 起只能经对话由模型写回，见 `appendProjectChat`）。
   * ⚠ 仅 owner：非 owner 调用 → `NOT_PROJECT_OWNER`。
   */
  updateProject: {
    method: "PATCH",
    path: "/pm-designs/:projectId",
    in: z
      .object({
        projectId: z.string(),
        name: z.string().min(1).max(200).optional(),
        template: ProjectTemplate.optional(),
        problem: z.string().max(4000).optional(),
      })
      .strict(),
    out: z.object({ project: DesignProject }).strict(),
    err: ["PROJECT_NOT_FOUND", "NAME_REQUIRED", "NOT_PROJECT_OWNER", "DEPENDENCY_UNAVAILABLE"] as const,
  },

  /**
   * 追加一条对话（详情页左侧「设计协作」面板发送）。
   *
   * ⚠ UC-17.8 B5.2：回复由模型按**本项目**上下文（`name/template/problem/criteria/frames` +
   *   本项目完整 `chat`——每项目独立 thread，thread 身份即 `projectId`）生成。服务端在同一次
   *   调用里追加两条：`{role:"user", text}` 与 `{role:"ai", text, source}`。模型不可用/超时/
   *   输出为空 ⇒ 退回 `DESIGN_WORKBENCH_CHAT_REPLY`、`source: "fallback"`，**不**让这次追加失败。
   * ⚠ **写回选的是「直接写回 + 返回 `applied`」，不是「返回建议等用户确认」**：模型输出里
   *   通过 `DesignChatWriteback` 严格解析的 `problem`/`criteria`/`frames` 由服务端直接写进项目
   *   （走与 `updateProject` 同一条 owner 谓词），`reply.applied` 如实列出写了哪些，返回的
   *   `project` 已是写回后的。理由：R4.4 原文「我会顺着它更新右边的原型画布和验收标准」——
   *   对话面板的产品语义就是「说一句、右边跟着变」；多一次确认弹窗会把它变成表单。写回
   *   前的值仍在 `chat` 历史里可追溯（用户那句 + 模型那句），owner 不满意再说一句即可改回。
   *   `frames` 只是画布页标签文案，画布内容仍是占位块（B5.3 out of scope）。
   * ⚠ 首次引导语**不**在这里插入——见文件头【待确认点 2】，它是展示层，`chat` 为空时前端
   *   本地渲染 `DESIGN_WORKBENCH_CHAT_INTRO`，不经过这个接口。
   * ⚠ 仅 owner 可发送：设计协作是该项目 owner 的工作区，不是任意组织成员都能往里写消息
   *   （同「仅 owner 可改」的口径——见文件头【待确认点 1】）。非 owner 不调模型、不写回。
   */
  appendProjectChat: {
    method: "POST",
    path: "/pm-designs/:projectId/chat",
    in: z.object({ projectId: z.string(), text: z.string().min(1).max(4000) }).strict(),
    out: z.object({ project: DesignProject, reply: DesignChatReply }).strict(),
    err: ["PROJECT_NOT_FOUND", "NOT_PROJECT_OWNER", "DEPENDENCY_UNAVAILABLE"] as const,
  },

  /** 删项目。硬删——仅 owner；未推送/已推送均可删（需求未对已推送项目的删除设限）。 */
  deleteProject: {
    method: "DELETE",
    path: "/pm-designs/:projectId",
    in: z.object({ projectId: z.string() }).strict(),
    out: z.object({ projectId: z.string() }).strict(),
    err: ["PROJECT_NOT_FOUND", "NOT_PROJECT_OWNER", "DEPENDENCY_UNAVAILABLE"] as const,
  },

  /**
   * 推送到收件箱（R4.4：推送确认弹窗 → 生成一条「设计方案」收件箱条目）。
   *
   * ⚠ **幂等 = upsert**，幂等键是 `projectId`（`design_projects` 一行至多对应一条收件箱条目，
   *   B4.2 唯一约束）。重复推送更新同一条收件箱条目的 `note`/`pushedAt`，`inboxCode` 不变。
   *   理由见文件头「推送幂等选的是 upsert」。
   * ⚠ 仅 owner 可推送。
   * ⚠ 若项目 `linkedFeedbackId` 非空，B4.3 用例层在同一事务里回写来源反馈的
   *   `resolved_by_design_id` 并追加一条状态事件「已生成 D-X」（`inbox.ts` 头注已预留这两个
   *   投影字段，这里不重复声明）——本契约只负责这次调用本身的 `in`/`out`。
   */
  pushToInbox: {
    method: "POST",
    path: "/pm-designs/:projectId/push",
    in: z.object({ projectId: z.string(), note: z.string().max(2000).optional() }).strict(),
    out: z
      .object({
        project: DesignProject,
        /** 生成/复用的收件箱条目编号，如 `D-2`（同 `inbox.ts` 的 `InboxItem.code` 前缀规则） */
        inboxCode: z.string().regex(/^D-\d+$/),
      })
      .strict(),
    err: ["PROJECT_NOT_FOUND", "NOT_PROJECT_OWNER", "DEPENDENCY_UNAVAILABLE"] as const,
  },

  /**
   * B4.4——反馈列表/详情「更复杂？去 PM 设计工作台深化」→ 直接建一个设计项目，跳到它的详情页
   * （PDF §9 建议；原型是跳工作台首页，这里按 PDF 收窄）。
   *
   * ⚠ **不接受调用方传 `name`/`problem`/`template`**——同 `createProject` 头注对
   *   `linkedFeedbackId` 的纪律反过来：这次是反过来的方向,调用方只给 `feedbackId`,
   *   `name`=反馈 `title`、`problem`=反馈 `detail`、`template` 恒 `"wireframe"`
   *   （backlog B4.4 原文三个等号），服务端读反馈行自己填,不接受前端各自拼一份可能对不上的值。
   * ⚠ **幂等，幂等键是 `feedbackId`**——同 `pushToInbox` 的 upsert 哲学，但形状不同：这里不是
   *   "覆盖同一行"，是"同一条反馈只产生一个设计项目"（`design_projects` 对 `linkedFeedbackId`
   *   的唯一约束保证,见迁移）。重复调用（用户手滑点两次「深化」、或网络重试）返回**已存在**的
   *   那个项目,不建第二个——第二个项目会让"这条反馈对应哪个方案"变成一对多,而前端要跳转的
   *   详情页只能选一个,选哪个没有依据。`out.created` 告诉调用方这次是新建还是复用（用于日志/
   *   埋点区分，不影响跳转行为——两种情况都跳同一个 `project.id`）。
   * ⚠ 权限：读正文要过 D3（`FEEDBACK_DETAIL_NOT_VISIBLE`）——「深化」把正文原样抄进
   *   `problem`,对正文没有可见权的人不能把它抄出来,即使抄的目的地只是同一组织内可读的
   *   设计项目（后者的可见性口径本身更宽,但不能绕开前者的门）。**没有** `NOT_PROJECT_OWNER`
   *   这个错误码：新建的项目 owner 恒是发起深化的人（同 `createProject`），不存在"深化别人
   *   已深化出的项目"这回事——命中已存在的项目时直接把它返回,不判断请求者是不是它的 owner
   *   （读操作对全组织放开,同文件头【待确认点 1】）。
   */
  deepenFeedback: {
    method: "POST",
    path: "/feedback/:feedbackId/deepen",
    in: z.object({ feedbackId: z.string() }).strict(),
    out: z
      .object({
        project: DesignProject,
        /** 这次调用是不是真的新建了项目（`false` = 命中了已有的深化结果，见上方幂等说明） */
        created: z.boolean(),
      })
      .strict(),
    err: ["FEEDBACK_NOT_FOUND", "FEEDBACK_DETAIL_NOT_VISIBLE", "DEPENDENCY_UNAVAILABLE"] as const,
  },

  /**
   * 2026-09-05「转开发」——把一个已推送的设计方案变成一张 GitHub issue。
   *
   * ## 这一条补的是「原型 → 开发」那一段
   *
   * 在它之前，设计方案推送到收件箱之后就没有下一步了：`inbox.ts` 的 `InboxGithubRef`
   * 头注写着「设计方案：本轮恒 `null`」，收件箱 drawer 对 `kind === "design"` 的条目
   * 不给任何操作。方案能被看见，但交不出去。这条操作是那一步。
   *
   * ## 形状照抄 `triageFeedback` 的 `issueDraft`，不发明第二套
   *
   * `draft` 的三个字段（`title`/`body`/`labels`）与 `feedbackLoop.operations.
   * triageFeedback.in.issueDraft` **逐字相同**，语义也相同：服务端按方案内容拼一份
   * 建议正文交给前端，人类在弹层里改完再提交，用例层原样使用、不用方案原文覆盖它
   * （否则"可编辑"是空话——同那条操作头注的原话）。
   *
   * ⚠ **不复用 `feedback-loop.ts` 的那个 zod 对象**：两个契约文件互不 import 是本仓既有
   *   边界（`design-ai-collab.ts` 才是两束共享词汇的所在地）。形状相同但归属不同，
   *   一方将来要加字段时不应该被另一方绑住。
   *
   * ## 权限：owner，同 `pushToInbox`
   *
   * 不是「组织管理员」：设计方案的可见性口径是"组织内全员可读，仅 owner 可改/删/推送"
   * （文件头【待确认点 1】），转开发是写侧动作，跟着写侧的口径走。
   *
   * ## 前置：必须已推送（`PROJECT_NOT_PUSHED`）
   *
   * 见该错误码的说明。这条前置让「GitHub 上的每一张设计票都能在收件箱里找到对应条目」
   * 成为一条结构性保证，而不是靠调用方自觉。
   *
   * ## 不幂等，重复调用报错
   *
   * 见 `DESIGN_ISSUE_ALREADY_EXISTS`。并发由 `github_issue_claimed_at` 乐观锁挡住
   * （`DESIGN_ISSUE_IN_PROGRESS`），失败释放认领、fail closed，全部照抄
   * `product_feedback` 那一套已经过二轮独立审查的形状。
   */
  createDesignGithubIssue: {
    method: "POST",
    path: "/pm-designs/:projectId/github-issue",
    in: z
      .object({
        projectId: z.string(),
        draft: z
          .object({
            title: z.string().min(1),
            body: z.string(),
            labels: z.array(z.string()),
          })
          .strict(),
      })
      .strict(),
    out: z
      .object({
        /** 回填之后的整个项目（`githubIssueUrl`/`githubIssueNumber` 已非空） */
        project: DesignProject,
      })
      .strict(),
    err: [
      "PROJECT_NOT_FOUND",
      "NOT_PROJECT_OWNER",
      "PROJECT_NOT_PUSHED",
      "DESIGN_ISSUE_ALREADY_EXISTS",
      "DESIGN_ISSUE_IN_PROGRESS",
      "DESIGN_ISSUE_CREATION_FAILED",
      "DEPENDENCY_UNAVAILABLE",
    ] as const,
  },
} as const;

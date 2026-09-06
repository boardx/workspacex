/**
 * 契约束 `chat` — ③ API 契约（**唯一事实源**）
 *
 * ADR-020：这一份生成四样东西（后端 DTO / 前端类型 / OpenAPI / mock），任何一样都不许手写第二份。
 *
 * ## 🔴 2026-08-06 · #594 · 修订已签核束（人类本人直接推翻此前裁决，方案 A）
 *
 * 人类原话：「不需要新建项目也应该新建一个 chat，开始使用 skills 和 agent」，
 * 二选一确认为方案 A（`projectId` 全链路可空），非方案 B（隐式默认项目）。
 * coord-main 视为签核已完成——登记于本束 `MIGRATION-IMPACT.md`，未走另一轮
 * design-delta 流程（人类本次直接确认视为等价，见该文件头注）。
 *
 * 本次改动的**全部**契约面变更：
 *   · `resolveVisibility.in.projectId`：`z.string()` → `z.string().nullable()`
 *   · `getThread.out.thread.projectId`：`z.string()` → `z.string().nullable()`
 *   · 新增操作 `listPersonalThreads`（GET `/chat/threads`，path 上没有 `:projectId`
 *     —— 既有 `listThreads` 的 path 是 `/chat/projects/:projectId/threads`，
 *     `projectId` 在 URL 路径段上，天生表达不了「没有项目」，所以不是放宽
 *     既有操作，是新增一条）
 *   · `mutateThread.in.projectId` **不用改**——它从 F109 落地起就是
 *     `z.string().nullable()`，只是实现单方面把 `null` 拒了（见 `MIGRATION-IMPACT.md`
 *     「这条矛盾早就在契约里」一节）
 *   · `ChatVisibility` 五值**不新增**：个人线程复用既有的 `private`
 *     （原语义「研究阶段：仅创建者」延伸覆盖「无项目：仅创建者」——两者本来就是
 *     同一句话，见下方枚举定义处的头注）
 *
 * 覆盖 feature：F108–F115（phase-01，8 个）
 * 依据 UC：`uc-8-1`（线程生命周期）· `uc-8-2`（AI 团队 / 工具链 / 批准闸门）
 *         · `uc-8-3`（产出落地）· `uc-8-4`（预设对话）· `uc-8-5`（可见性判定）
 * 领域不变量见 `phases/phase-01-run-a-project/contracts/chat/domain.md` 的 `I-n`。
 *
 * **跨束委托**（本束只调用，不实现）：
 *   · 角色枚举与两层判定 → phase-00 `identity`
 *   · 三模式绑定 / 定版 / 引用资格门 → phase-00 `artifact`（`referenceForDownstream` 是**同一个门**，I-34）
 *   · Context Pack 取用与 `omissions[].reason` 七类枚举 → phase-00 `context-pack`（S-12）
 *   · 模型 / 单价 / 用途策略 → `agent-runtime`；后台任务 → 11-task
 *
 * 核心不变量：
 *   · **每一个读端口都先过 `resolveVisibility`**，没有例外；`NOT_VISIBLE` 与「不存在」
 *     **逐字节相同**（I-3）
 *   · `AUTHZ_UNAVAILABLE` / `AUDIT_SINK_UNAVAILABLE` **一律拒绝，不得降级放行**
 *   · 引用必须落在**本次 Context Pack 内的证据**上——那个门是 phase-00
 *     `context-pack.CITATION_OUT_OF_PACK`，**本束引用它，不另起**（见文件末尾编译期断言）
 */
import { z } from "zod";
// #946 · V9-a F151：消息挂附件。`Attachment` / `ATTACHMENT_LIMITS` 的唯一事实源在
// chat-file-upload.ts（单向依赖，无环——该文件只 import z）。这里复用，不另立第二份形状。
import { Attachment, ATTACHMENT_LIMITS } from "./chat-file-upload";
import { PermissionReason, ProjectRole, VisibilityScope } from "./identity";
import { ArtifactError } from "./artifact";
import { ContextPackReason } from "./context-pack";
import { AsrStreamErrorReason as RecordingAsrStreamErrorReason } from "./recording";

/* ─────────────────────────── 枚举（对应 domain.md）─────────────────────────── */

/**
 * 对话可见范围 —— **五值封闭，新增必须走 ADR**（domain I-1 / uc-8-5 R6）。
 *
 * ⚠ **与 `identity.VisibilityScope`（2 值：`org-wide` / `team-only`）同名不同义，
 *   已改名分离，别再合并。** 那一个是**组织层的资源准入**（这份材料对谁开放），
 *   这一个是**一条对话线程的归属范围**（这个线程属于谁的会话空间）。
 *   合并意味着「组员私聊」与「团队可见的材料」共用一个取值集合，
 *   于是任何一侧新增取值都会污染另一侧的判定——本仓已五次因「同一名字两处含义」漂移。
 *
 * ⚠ **2026-08-06（#594）：`private` 的语义扩大，不是新增第六个值。**
 *   原文案「研究阶段：仅创建者」现在也覆盖「个人线程（无项目）：仅创建者」——
 *   两者本来就是**同一条规则**（`actor.userId === thread.createdBy`，见
 *   `apps/api/src/domain/chat/thread-visibility.ts` 的 `scopeAllows`/
 *   `decidePersonalThreadRead`），只是触发它的场景从一种变成两种。
 *   没有新增枚举值：五值封闭这条不变量原样成立。
 */
export const ChatVisibility = z.enum([
  "member-private", // 组员私聊：本人 + 本组组长 + 引导师
  "group-shared",   // 本组共享：全组可见
  "plenary",        // 全场：项目内全员
  "team-visible",   // 团队可见：研究阶段，同（组织）团队可见
  "private",        // 私有：仅创建者（研究阶段的线程 / #594 起也含无项目的个人线程）
]);

/** 线程阶段——决定右栏是否显示转录（uc-8-2 E1） */
export const ThreadPhase = z.enum(["onsite", "research"]);

/** 消息作者类别 */
export const AuthorKind = z.enum(["human", "agent"]);

/** Wave 2 durable message projection. Legacy pre-Wave-2 rows may lack linkage fields. */
export const DurableMessage = z.object({
  id: z.string(),
  authorKind: AuthorKind,
  authorId: z.string(),
  agentId: z.string().nullable(),
  text: z.string(),
  clientMessageId: z.string().uuid().nullable(),
  agentRunId: z.string().nullable(),
  replyToMessageId: z.string().nullable(),
  createdAt: z.string().datetime(),
  // #946 · V9-a F151：该消息挂的附件投影（listMessages 回读）。可选——既有不带附件的消息
  // 与 agentProactiveSpeak 等其它 DurableMessage 生产者不受影响；缺省即无附件。
  attachments: z.array(Attachment).optional(),
}).strict();

/**
 * `listMessages` 分页游标的**唯一编码实现**（issue #728 D 组 round 2 独立评分发现的
 * H3 阻塞回归根因修复）。此前 `apps/api/.../message-roundtrip.ts` 与前端各自认知
 * 「翻页游标」——服务端把它编进 `nextCursor` 字段，且**只在 `hasMore` 为真时才给**
 * （`hasMore` 为假时 `nextCursor` 恒为 `null`，语义是「翻页按钮该消失了」，从未打算
 * 兼职表达「这是可以继续追新的位置」）。
 *
 * `chat-live-message-panel.tsx`（#1726）把发送后/run 终态/生成画像后的「软重读」从
 * 硬编码 `cursor=null` 改成了传当前 `nextCursor`，让翻过页之后新消息追得上——但线程
 * 一旦被追到底（`hasMore` 变假 ⇒ `nextCursor` 塌成 `null`），下一次软重读传的
 * `cursor=null` 会被服务端理解成"从头再来"（`decodeCursor(undefined) → null` ⇒
 * 拉第一页），把 `nextCursor` 重新弹回非空——「加载更早之后的消息」按钮因此在几次
 * 软重读之间反复挂载/卸载，真实浏览器里表现为 Playwright 点它时无限
 * `element was detached from the DOM, retrying`（round 2 独评复现，
 * `chat-diagram-save-reopen-roundtrip.spec.ts:82`）。
 *
 * 修法：软重读不再依赖服务端 `nextCursor`（它的语义是「还有没有下一页可翻」，不是
 * 「继续追新该从哪起」，硬把两件事塞进一个字段才是这次回归的根）。改成**本地用
 * 已加载消息列表自己的尾部**算出追新起点——只要至少加载过一条消息，这个游标就
 * 永远存在、永远单调前进，不会像 `nextCursor` 那样在"翻到底"那一刻塌成 `null`。
 * 编码算法与服务端 `encodeCursor`（`message-roundtrip.ts`）**逐字节相同**（对同一行
 * `{createdAt, id}` 算出来的游标必须相等，否则服务端 `decodeCursor` 解不出正确的
 * `after` 位置）——两边共享这一份实现，不允许出现第二份（AGENTS.md「同一事实不得
 * 声明在两处」），服务端据此把自己原来手写的那份删掉，改 import 这里。
 *
 * ⚠ **不用 `Buffer.from(...).toString("base64url")`**——这份函数现在是**浏览器**代码
 * 也会真正执行到的路径（`chat-live-message-panel.tsx` 在客户端调用它算追新起点），
 * 而 webpack/Next 给浏览器打的 `buffer` polyfill 不认 `"base64url"` 这个 encoding
 * 名字，真机实测直接炸 `TypeError: Unknown encoding: base64url`（round 2 独评复现，
 * 第一版用 native `"base64url"` 的实现在 `chat-diagram-save-reopen-roundtrip.spec.ts`
 * 里把「无限 detach 重试」换成了「首屏 Unhandled Runtime Error」，仍然是没修好）。
 * 改用 Node 与浏览器 `buffer` polyfill **都支持**的 `"base64"` 编码，再手动做
 * base64 → base64url 的字符替换（`+`→`-`、`/`→`_`、去掉 `=` padding）——这是
 * base64url 的标准定义本身，产出的字节与 Node 原生 `"base64url"` 逐字节相同，
 * 服务端 `decodeCursor` 用 Node 原生 `Buffer.from(value, "base64url")` 解码
 * 不受影响（Node 原生解码器认标准 base64url 字符集）。
 */
export function encodeMessageCursor(row: { createdAt: string; id: string }): string {
  return Buffer.from(JSON.stringify([row.createdAt, row.id]), "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/** 消息徽标。⚠ **标在发生它的那条消息上**，不折叠进别处（AC5 / 原型状态 4.5） */
export const MessageBadge = z.enum(["degraded", "review-pending"]);

/** agent 在场状态。三值封闭（I-17） */
export const AgentPresence = z.enum(["present", "away", "off"]);

/** 工具调用状态。⚠ `running` 是**正常返回值**，不是 pending 错误（I-25） */
export const ToolCallStatus = z.enum(["done", "reuse", "running", "failed"]);

/** 引用锚点的判别 kind */
export const CitationAnchorKind = z.enum(["page", "transcript", "message"]);

/** 批准请求的三出口。⚠ `decline` 后动作**永不执行**，并记审计 */
export const ApprovalExit = z.enum(["approve", "reparam", "decline"]);

/** 批准请求状态。⚠ `paused` 期间目标系统**无任何写入**（I-27，动作零副作用） */
export const ApprovalStatus = z.enum([
  "paused", "approved", "reparamed", "declined", "expired",
]);

/** 后台任务状态。⚠ `needs-input` 是**状态不是终止**（预算耗尽走它，O-36 / V4b） */
export const TaskStatus = z.enum([
  "queued", "running", "needs-input", "done", "failed", "cancelled",
]);

/**
 * 产出落地的三模式。
 * ⚠ **机制委托 phase-00 `artifact.BindingMode`**（D-38）：本束**不另立版本机制**。
 *   这里重列取值是为了本束端口自洽，同码同义由文件末尾的编译期断言守着。
 */
export const LandingMode = z.enum(["draft", "live", "pinned"]);

/**
 * 下游引用用途。
 * ⚠ 四个 purpose × 三种 mode 的 **12 格矩阵**是引用资格门的验收面（UC-21）。
 * ⚠ 取值与 phase-00 `artifact.DownstreamPurpose` **不完全同名**
 *   （那边是 `report-final` / `acceptance` / `decision-reference` / `graph-writeback` /
 *   `brain-promotion`，五个）——`usecases.md` 逐字写的是下面四个。
 *   差异**登记为缺口**而不是就地改名，见 `KNOWN_CONTRACT_GAPS.C_CHAT_2`。
 */
export const ChatDownstreamPurpose = z.enum([
  "report-final", "submit-acceptance", "decision-evidence", "write-back-kg",
]);

/** 右栏五标签。⚠ **恒五个**，计数为 0 时不隐藏标签（V14） */
export const RightTab = z.enum([
  "transcript", "execution", "insight", "artifact", "material",
]);

/**
 * 本束失败模式全集。
 * ⚠ 拒绝形状统一：`NOT_VISIBLE` 与「资源不存在」**逐字节相同**（I-3），内部记 `deniedLayer`。
 */
export const ChatError = z.enum([
  /** 越权 / 不存在的统一出口（I-3）。跨组、私聊非三方、草稿产出非创建者全走它 */
  "NOT_VISIBLE",
  /** ⚠ **一律拒绝，不得降级为放行**（uc-8-5 V10）。这是本束唯一「依赖失败即拒绝」的语义 */
  "AUTHZ_UNAVAILABLE",
  /** 判定与下发之间角色被撤 ⇒ 立即终止后续写（V11 / E3 / E4） */
  "ROLE_REVOKED_MIDFLIGHT",
  "THREAD_ARCHIVED_READONLY",
  /** 🔗 与 `identity.PermissionReason` 同码同义 */
  "NO_PROJECT_ROLE",
  "NO_WRITE_ROLE",
  "NOT_ORG_ADMIN",
  /** ⚠ **写不下审计就不给内容**——「可读」与「必留痕」是同一个原子动作（I-8） */
  "AUDIT_SINK_UNAVAILABLE",
  "AUDIT_QUERY_UNAVAILABLE",
  "INVALID_GRANT_SCOPE",
  "VERSION_CHANGED",
  "IDEMPOTENCY_CONFLICT",
  "TITLE_INVALID",
  "FILE_NOT_MATERIALIZED",
  "STORAGE_UNAVAILABLE",
  "AGENT_REGISTRY_UNAVAILABLE",
  "AGENT_OUT_OF_SCOPE",
  "AGENT_NOT_FOUND",
  "SKILL_OUT_OF_SCOPE",
  "CONTEXT_API_UNAVAILABLE",
  "TRANSCRIPT_SERVICE_UNAVAILABLE",
  /** 幂等出口：重复 stop 不报错、返回同一 `stoppedAt` */
  "ALREADY_STOPPED",
  "PROVENANCE_UNAVAILABLE",
  /** ⚠ 不是「暂时找不到」——它意味着**这条引用不合格**（I-24），上游定版必须被拒 */
  "ANCHOR_UNRESOLVABLE",
  "SOURCE_ARTIFACT_DELETED",
  "PACK_NOT_RECORDED",
  /** ⚠ 含机密时的模型约束**在服务端拒绝**，不是界面提示（I-32）。🔴 判定口径待裁，裁决前不得写死 */
  "MODEL_POLICY_VIOLATION",
  /** model registry 不可用 ⇒ **不出卡**。不得回落到硬编码价目「先让卡显示出来」（I-31 的反例） */
  "REGISTRY_UNAVAILABLE",
  /** ⚠ 这是一个**状态**，不是终止：转「等待输入」求追加预算，既不硬停也不继续执行（O-36 / V4b） */
  "BUDGET_EXHAUSTED",
  "RISK_TABLE_MISSING",
  "NO_APPROVAL_ROLE",
  /** 并发：两人同点批准只有一个生效（I-29 / V17） */
  "APPROVAL_STATUS_CHANGED",
  /** 过期后调批准接口被拒，状态「已过期 · 未执行」，**不得静默执行**（E1e / V4） */
  "APPROVAL_EXPIRED",
  /** 批准成功但入队失败 ⇒ 请求**留在 paused**，否则会出现「已批准但没有任务」的无主状态 */
  "TASK_QUEUE_UNAVAILABLE",
  "TASK_NOT_FOUND",
  "MISSING_PROVENANCE_BACKLINK",
  /** 有任一引用不可定位 ⇒ **只能落草稿，不得定版**（V4d） */
  "CITATION_UNRESOLVABLE_REQUIRES_DRAFT",
  /**
   * 个人线程落地硬锁 draft（人类裁决，2026-08-21，issue #728 round 16 P10）——
   * `live`/`pinned` 会打开项目专属的下游流转语义（`isEligibleForDownstream`），
   * 个人线程没有这个维度。与 `CITATION_UNRESOLVABLE_REQUIRES_DRAFT` 分开码：
   * 那条是「引用凑不齐所以降级」，这条是「这条线程类型压根不适用非 draft 模式」，
   * 前端要展示的文案不同（后者不该建议用户"补引用再试"）。
   */
  "PERSONAL_THREAD_REQUIRES_DRAFT",
  "STUDIO_RUN_NOT_FOUND",
  /** 🔗 与 `artifact.ArtifactError` 同码同义（引用资格门是 phase-00 的那一个，I-34） */
  "REQUIRES_PINNED",
  /** 定版是**必要不充分**条件——需验收的产出还须过 UC-13.2 */
  "REQUIRES_ACCEPTANCE",
  /** 🔗 与 `artifact.ArtifactError` 同码同义 */
  "SNAPSHOT_IMMUTABLE",
  /** 🔗 **与 `context-pack.ContextPackReason` 同码同义，本束不另起**：
   *  对话产出的引用必须落在**本次 Context Pack 内的证据**上（phase-00 F12 已 passing） */
  "CITATION_OUT_OF_PACK",
  /** 预设**不得预先批准任何高影响动作**（I-41） */
  "PRESET_PREAPPROVAL_FORBIDDEN",
  /** 不得预置绕过权限或同意位的检索范围（O-05） */
  "PRESET_SCOPE_BYPASS_FORBIDDEN",
  "PRESET_NOT_FOUND",
  "NOT_DISPATCHED_TO_ACTOR",
  "PRESET_VERSION_SUPERSEDED",
  /** #946 · V9-a F151：createMessage 的 attachmentIds 里有 id 不属本线程 / 已挂过别的
   *  消息 / 不存在。整条消息连同挂附件是一个原子事务，任一不合格即整体拒（422）。 */
  "ATTACHMENT_NOT_PENDING",
]);

/* ─────────────────────────────── 值对象 ─────────────────────────────── */

/**
 * 引用角标 —— **三段结构，缺一不可**（uc-8-2 R7）。
 * ⚠ `anchor` 的三形态用可空字段表达而非 `z.union`：union 会让 mock 生成器只取第一支。
 */
export const Citation = z.object({
  citationId: z.string(),
  index: z.number().int().positive(),
  sourceFullName: z.string(),
  anchor: z.object({
    kind: CitationAnchorKind,
    page: z.number().int().positive().nullable(),
    range: z.string().nullable(),
    messageId: z.string().nullable(),
  }).strict(),
}).strict();

/**
 * 线程卡上的**任务状态** —— 五值封闭。
 *
 * 🔴 issue #2094（人类裁决落地，回指 #2068）：线程卡此前的第二行是 `agentSummary`，
 * 一个自由字符串，取值由 `threadAgentSummary()` 产出 `` `${agentCount} 个 agent` ``。
 * 人类 2026-08-26 审计原话：
 *
 * > 对话列表不可辨认——大量「新对话」，只显示 `0 个 agent`，无法寻找历史任务。
 * > 改进方向：自动生成任务标题、状态、产物数量和更新时间。
 *
 * 裁决把那一行换成**三个结构化事实**：`title`（自动命名）、`status`（本枚举）、
 * `artifactCount`。**不再是自由字符串**——自由字符串正是「0 个 agent」能长期活在
 * 屏幕上、而没有任何门控发现它的原因（`ThreadCard.agentSummary` 是 `z.string()`，
 * 装什么都合法）。
 *
 * ⚠ 五个取值**全部有真实数据源**，没有一个是画出来给人看的：
 *   · `not-started` ⇐ 该线程一条消息都没有（devapp 实测 58 条线程里 36 条如此）
 *   · `running` ⇐ 最近一次 `agent_runs.status ∈ {queued, running, writeback_pending}`
 *   · `awaiting-approval` ⇐ 最近一次 run `status = awaiting_tool_permission`（HITL 停在人这里）
 *   · `failed` ⇐ 最近一次 run `status = failed`
 *   · `done` ⇐ 最近一次 run `status = succeeded`；或有消息但一次 run 都没有
 *
 * ⚠ 枚举值是**领域取值，不是界面文案**。文案的唯一一处映射在
 *   `apps/web/components/chat/thread-list-shell.tsx` 的 `THREAD_STATUS_LABEL`——
 *   裸枚举词直接印上界面已被验收卡 `TW-COPY-1` 黑名单挡住（本仓 #728 栽过一次）。
 */
export const ThreadCardStatus = z.enum([
  "paused",
  "not-started",
  "running",
  "awaiting-approval",
  "failed",
  "done",
]);

/** 线程卡。研究阶段与现场分组返回**完全一致的字段结构**，只有数据不同（AC1） */
export const ThreadCard = z.object({
  id: z.string(),
  title: z.string(),
  subtitle: z.string(),
  badges: z.array(MessageBadge),
  /** 🔴 #2094：取代 `agentSummary`。见 `ThreadCardStatus` 头注。 */
  status: ThreadCardStatus,
  /** 🔴 #2094：本线程已落地的产物数 ⇐ `chat_artifact_landings`，按调用者可见性过滤后计数。 */
  artifactCount: z.number().int().nonnegative(),
  lastActivityAt: z.string(),
  visibilityScope: ChatVisibility,
  /**
   * 2026-09-03（rev-uiux 差距分析点 P1-4，人类直接指令走 ad-hoc、不经
   * `design-signoff.md`）—— 置顶，服务端持久化，取代此前 `apps/web/lib/
   * chat-pinned-threads.ts` 的 `localStorage` 方案（那份实现头注原话「跨设备需
   * 签核」）。是这条字段本身把契约从「create/rename/delete 三值封闭」改成了四值，
   * 所以老老实实当作一次契约变更记录：**先落地，后补人类追认**，不是绕开变更、
   * 假装它不是契约变更——`mutateThread.in.op` 同轮加了 `pin`/`unpin` 两个动作，
   * 见下方。默认 `false`：既有线程迁移时全部未置顶，不假装历史数据本就置顶过。
   */
  pinned: z.boolean(),
}).strict();

/**
 * 一条消息。
 * ⚠ 观察者视角下 `rawTranscript` / 私聊消息 / 任何写能力标记**根本不在响应体里**（I-5）——
 *   不是返回后由前端过滤。
 */
export const Message = z.object({
  id: z.string(),
  authorKind: AuthorKind,
  agentId: z.string().nullable(),
  skill: z.string().nullable(),
  thinkingSummary: z.string().nullable(),
  badges: z.array(MessageBadge),
  citations: z.array(Citation),
  toolCallSummary: z.string().nullable(),
  card: z.string().nullable(),
}).strict();

/** 一次工具调用。⚠ **是 `provenance_events` 的投影，不是第二张表**（I-22） */
export const ToolCall = z.object({
  function: z.string(),
  args: z.string(),
  hitCount: z.number().int().nonnegative().nullable(),
  reuseFlag: z.boolean().nullable(),
  status: ToolCallStatus,
  tokens: z.number().int().nonnegative(),
  callerAgentId: z.string(),
  model: z.string(),
  pipelineVersion: z.string(),
  provenanceEventId: z.string(),
}).strict();

/**
 * 一次工具调用写进 `provenance_events.detail` 的存储形状（F111 · uc-8-2 UC-14）。
 * ⚠ 与 `ToolCall`（对外投影）不是同一个形状：`detail` 里是 `messageId`
 *   （借用 thread target 之后用来在同一线程的多条消息间区分归属，见
 *   `tool-call-projection.ts` 文件头），投影时替换成 `provenanceEventId`。
 */
export const ToolCallDetail = z.object({
  messageId: z.string(),
  function: z.string().min(1),
  args: z.string(),
  hitCount: z.number().int().nonnegative().nullable(),
  reuseFlag: z.boolean().nullable(),
  status: ToolCallStatus,
  tokens: z.number().int().nonnegative(),
  callerAgentId: z.string().min(1),
  model: z.string().min(1),
  pipelineVersion: z.string().min(1),
}).strict();

/** 批准卡的数据范围条目。`confidential` 触发模型策略判定（I-32） */
export const ApprovalDataScope = z.object({
  name: z.string(),
  confidential: z.boolean(),
}).strict();

/* ───────────────────────────── 操作 ───────────────────────────── */

export const operations = {
  /* ── 零、可见性判定（F108 · uc-8-5）───────────────────────────── */

  /**
   * resolveVisibility —— **每一个读端口的前置，没有例外**。
   * ⚠ `AUTHZ_UNAVAILABLE` **一律拒绝，不得降级为放行**（V10）。
   *   把它写成「重试期间先放行」就是安全事故。
   * ⚠ `deniedLayer` 只在内部记录 / 审计里出现；**对外拒绝响应与「不存在」逐字节相同**（I-3）。
   */
  resolveVisibility: {
    method: "POST", path: "/chat/visibility/resolve",
    in: z.object({
      actorId: z.string(),
      // 🔴 #594：`null` = 判定走个人线程分支（仅创建者可读），不是「没填」。
      projectId: z.string().nullable(),
      threadId: z.string().nullable(),
      resourceKind: z.enum(["thread", "message", "transcript", "file"]),
    }).strict(),
    out: z.object({
      allowed: z.boolean(),
      scope: ChatVisibility,
      decisionId: z.string(),
      deniedLayer: z.enum(["organization", "project"]).nullable(),
    }).strict(),
    err: ["AUTHZ_UNAVAILABLE"] as const,
  },

  /**
   * getThread —— 读线程详情（含四视角投影）。
   * ⚠ **观察者投影是「响应体里没有」而不是「返回了但标了不可见」**（I-5）。
   * ⚠ **部分成功**：右栏某标签数据源失败 ⇒ 该标签标依赖失败，**其余标签仍返回**，
   *   且计数**不得伪装成 0**（否则违反 I-20「计数与列表长度一致」）。
   */
  getThread: {
    method: "GET", path: "/chat/threads/:threadId",
    in: z.object({
      threadId: z.string(),
      /** 仅预览手段，**生产构建下不可达** */
      viewAs: ProjectRole.optional(),
    }).strict(),
    out: z.object({
      thread: z.object({
        id: z.string(),
        /** 🔴 #594：`null` = 个人线程，不挂靠任何项目。 */
        projectId: z.string().nullable(),
        groupId: z.string().nullable(),
        visibilityScope: ChatVisibility,
        phase: ThreadPhase,
        archived: z.boolean(),
        createdBy: z.string(),
        lastActivityAt: z.string(),
        version: z.number().int().nonnegative(),
      }).strict(),
      messages: z.array(Message),
      rightTabs: z.array(z.object({
        tab: RightTab,
        count: z.number().int().nonnegative(),
        /** 该标签自己的依赖失败，**不整体失败** */
        failed: z.boolean(),
      }).strict()),
      capabilities: z.array(z.string()),
    }).strict(),
    err: [
      "NOT_VISIBLE", "THREAD_ARCHIVED_READONLY", "AUTHZ_UNAVAILABLE", "ROLE_REVOKED_MIDFLIGHT",
    ] as const,
  },

  /**
   * adminAuditRead —— 管理员审计读。
   * ⚠ 组织管理员**不要求持有项目角色**（O-04）；
   *   `layer: "personal"` **只返计数、无正文**——个人层对任何人封闭。
   * ⚠ `AUDIT_SINK_UNAVAILABLE`：**写不下审计就不给内容**，不允许「读到了但没留痕」。
   */
  adminAuditRead: {
    method: "POST", path: "/chat/threads/:threadId/admin-audit-read",
    in: z.object({
      threadId: z.string(),
      projectId: z.string(),
      layer: z.enum(["project", "personal"]),
    }).strict(),
    out: z.object({
      /** layer=project 时非空 */
      messages: z.array(Message),
      /** layer=personal 时非空；正文恒不返回 */
      itemCount: z.number().int().nonnegative().nullable(),
      auditEventId: z.string(),
    }).strict(),
    err: ["NOT_ORG_ADMIN", "AUDIT_SINK_UNAVAILABLE"] as const,
  },

  /**
   * grantObserverRead —— 给观察者授予临时读权。
   * ⚠ **幂等重放**：同一 `(observerId, scopeRef, stageId)` 重复授予返回同一 `grantId`，
   *   **不叠加有效期**。⚠ 环节结束后自动失效（V7）；触发点未定，见 KNOWN_CONTRACT_GAPS。
   */
  grantObserverRead: {
    method: "POST", path: "/chat/observer-grants",
    in: z.object({
      observerId: z.string(),
      scopeRef: z.string(),
      expiresOn: z.literal("stage-end"),
    }).strict(),
    out: z.object({ grantId: z.string(), auditEventId: z.string() }).strict(),
    err: ["NO_PROJECT_ROLE", "INVALID_GRANT_SCOPE", "AUDIT_SINK_UNAVAILABLE"] as const,
  },

  /* ── 一、线程列表与生命周期（F109 · uc-8-1）────────────────────── */

  /**
   * listThreads —— 今天/本周分组。
   * ⚠ **空态返回 `groups: []`，不生成示例线程**（V4）。
   * ⚠ **不泄露**：无可见对话时不得泄露「存在但不可见」的条目数（V9）。
   * ⚠ 「更早」分组无契约（待裁决第 11 条），本端口**只返回今天/本周两组**。
   */
  listThreads: {
    method: "GET", path: "/chat/projects/:projectId/threads",
    in: z.object({
      projectId: z.string(),
      filter: z.enum(["all", "project", "my-agents"]).optional(),
      includeArchived: z.boolean().optional(),
    }).strict(),
    out: z.object({
      groups: z.array(z.object({
        label: z.enum(["今天", "本周"]),
        cards: z.array(ThreadCard),
      }).strict()),
      /**
       * 项目级能力集合（#489）。与 `getThread.out.capabilities` **同一个事实源**
       * ——服务端 `capabilitiesFor(projectRole)`——只是在这个读端口也下发一次。
       *
       * 为什么这里必须也有：`getThread` 只在**选中某条线程**时才被调用。项目
       * **零会话**时它永远不会被调用 ⇒ 前端拿不到任何写权依据 ⇒「新建会话」按钮
       * 不渲染 ⇒ **新注册的管理员永远建不出第一条会话**。实测死在「注册 → 登录 →
       * Chat 新增」的第三步。
       *
       * ⚠ 前端**不得**按角色自行重算，也不得拿 `composer.send` 之类去推断
       * `thread.mutate`——那会造出第二个事实源。本仓已因「同一事实声明在两处」漂移五次。
       */
      capabilities: z.array(z.string()),
    }).strict(),
    err: ["NOT_VISIBLE", "AUTHZ_UNAVAILABLE"] as const,
  },

  /**
   * 🔴 #594 —— 个人线程（无项目）的列表。**新增操作，不是 `listThreads` 加可选参数**：
   * `listThreads` 的 path 是 `/chat/projects/:projectId/threads`，`projectId` 在
   * URL 路径段上，路径参数天生表达不了「没有项目」——给它加一个「projectId 可以是
   * 某个哨兵字符串」的特例，等于在路由层发明一个新的隐式协议，比新增一个操作更贵。
   *
   * `capabilities` 恒下发且与调用者是否已有线程无关（同上面 `listThreads` 的 #489
   * 理由：零线程时也要能建第一条）。
   */
  listPersonalThreads: {
    method: "GET", path: "/chat/threads",
    in: z.object({
      includeArchived: z.boolean().optional(),
    }).strict(),
    out: z.object({
      groups: z.array(z.object({
        label: z.enum(["今天", "本周"]),
        cards: z.array(ThreadCard),
      }).strict()),
      capabilities: z.array(z.string()),
    }).strict(),
    err: ["AUTHZ_UNAVAILABLE"] as const,
  },

  /**
   * mutateThread —— 新建 / 改名 / 删除 / 置顶 / 取消置顶。
   * ⚠ 观察者恒无写权（按钮不渲染**且**接口拒绝——两侧都要验收）。
   * ⚠ **并发**（V7）：`expectedVersion` 不匹配即 `VERSION_CHANGED`，**不静默覆盖**。
   * ⚠ **删除是可追溯动作**：返回 `impactScope`，审计必写；**越权尝试也要有安全审计记录**（V8）。
   * ⚠ `pin`/`unpin`（2026-09-03，ad-hoc、无 `design-signoff.md`，见 `ThreadCard.pinned`
   *   头注）—— 同样过 `expectedVersion` 乐观并发、同样写审计，与 `rename` 走同一套
   *   纪律，不是"轻量所以不用管这些"的第二等操作。
   */
  mutateThread: {
    method: "POST", path: "/chat/threads/mutate",
    in: z.object({
      op: z.enum(["create", "rename", "delete", "pin", "unpin"]),
      projectId: z.string().nullable(),
      threadId: z.string().nullable(),
      groupId: z.string().nullable(),
      title: z.string().nullable(),
      visibilityScope: ChatVisibility.nullable(),
      expectedVersion: z.number().int().nonnegative().nullable(),
      reason: z.string().nullable(),
    }).strict(),
    out: z.object({
      threadId: z.string(),
      version: z.number().int().nonnegative(),
      auditEventId: z.string(),
      impactScope: z.string().nullable(),
    }).strict(),
    err: [
      "NOT_VISIBLE", "NO_WRITE_ROLE", "VERSION_CHANGED", "THREAD_ARCHIVED_READONLY",
      "TITLE_INVALID", "AUDIT_SINK_UNAVAILABLE",
    ] as const,
  },

  /**
   * getThreadMessagesFile —— 取 `messages.jsonl`（file-first）。
   * ⚠ **这个端口存在的意义就是证明文件浏览器不是权限旁路**：
   *   它的越权断言与 `getThread` 必须**同源**（同一套 `acl_bindings`，I-12）。
   *   若它自己判一次权，就是第二份可见性实现。
   */
  getThreadMessagesFile: {
    method: "GET", path: "/chat/threads/:threadId/messages-file",
    in: z.object({ threadId: z.string() }).strict(),
    out: z.object({
      objectKey: z.string(),
      sha256: z.string(),
      sizeBytes: z.number().int().nonnegative(),
      downloadUrl: z.string(),
    }).strict(),
    err: ["NOT_VISIBLE", "FILE_NOT_MATERIALIZED", "STORAGE_UNAVAILABLE"] as const,
  },

  /* ── 二、AI 团队与消息流（F110 / F113 · uc-8-2）─────────────────── */

  /**
   * getAgentPanel —— 读 AI 团队面板。
   * ⚠ **依赖失败返回错误而不是空面板**——空面板会被读成「没有 agent」。
   * ⚠ 两个计数分离（I-18）：`presentCount`（在场）与 `rosterCount`（编制）不是一回事。
   *
   * ## 🟡 `rosterVersion` 于 #513 补上，**该字段所在契约面待人类补签**
   *
   * 2026-08-05 coord-main 在人类不在场时代裁「先做」并同时把它**登记为待补签**——
   * 照 #496 `createTemplate` 的先例（见 `canvas.ts` 该操作的文件头）。判据与
   * #489（`listThreads.out` 加 capabilities）**同型**：它不新增用户可见语义，只是把
   * 服务端**早已持有**的同一个 `chat_threads.roster_version` 在读端口也下发一次，
   * 按既有 `chat` 束的自然延伸处理，**不另起 design-delta**。
   * 人类回来后要么补签、要么要求改形状。**没有任何 `design-signoff.md` 被改动**
   * ——签核是人的动作，agent 不得代做。
   */
  getAgentPanel: {
    method: "GET", path: "/chat/threads/:threadId/agents",
    in: z.object({ threadId: z.string() }).strict(),
    out: z.object({
      agents: z.array(z.object({
        id: z.string(),
        abbr: z.string(),
        name: z.string(),
        /** ⚠ 非空（I-17）：一个说不出职责的 agent 在面板里等于噪音 */
        duty: z.string(),
        /**
         * #1705（#728 D-1，人类裁决见 issue #831 2026-08-09 + #1705 2026-08-21 补裁）——
         * 简短角色头衔（如「战略分析师」），D2 编制区渲染成「{name} · {roleLabel}」，
         * `duty` 仍是第二行的一句话能力描述。⚠ 与 `agentRuntime.AgentRow.role`
         * （「职责一句话」）不是同一个字段——那个字段投影到这里的 `duty`，
         * 这里的 `roleLabel` 投影自 `agentRuntime.AgentRow.roleLabel`。
         * 非空（同 `duty` 一样的 I-17 纪律，见 CHECK
         * `capability_listings_agent_needs_role_label`）。
         */
        roleLabel: z.string(),
        presence: AgentPresence,
      }).strict()),
      presentCount: z.number().int().nonnegative(),
      rosterCount: z.number().int().nonnegative(),
      marketEntry: z.string().nullable(),
      /**
       * 🟡 #513，**待人类补签**（见本操作文件头）。
       *
       * 编制的乐观锁版本号，**与 `updateAgentRoster.out.rosterVersion`
       * （本文件下方同名字段）是同一个字段、同一个事实源**——都投影
       * `chat_threads.roster_version`，不是第二个版本号概念。
       *
       * 存在的理由：`updateAgentRoster.in.expectedRosterVersion` 是**必填**的乐观锁。
       * 在 #513 之前它只由写端口的出参下发 ⇒ 客户端只有刚写过一次才知道版本号，
       * **页面一刷新就无从填起**，跨页面加载的编制变更必然 409（PR #510 在 e2e 里
       * 实测撞上并把现状钉成了断言）。
       *
       * ⛔ 调用方**不得**用「读不到就传 0 / -1 / 省略」兜底：乐观锁的意义就是拒绝
       *   盲写，兜底等于把锁摘了。读不到版本号时**不提交**。
       */
      rosterVersion: z.number().int().nonnegative(),
    }).strict(),
    err: ["NOT_VISIBLE", "AGENT_REGISTRY_UNAVAILABLE"] as const,
  },

  /**
   * updateAgentRoster —— 改本线程的 agent 编制。
   * ⚠ **部分成功即整体拒绝**：`add` 里有一个越范围 ⇒ 全拒，
   *   不做「加进去 2 个、拒了 1 个」的半成品。
   * ⚠ `[编制]` 在原型里是空按钮（R3 步骤 2 [原型待补]），本端口的形状是 `[设计]`——
   *   见 `KNOWN_CONTRACT_GAPS.C_CHAT_4`。
   */
  updateAgentRoster: {
    method: "POST", path: "/chat/threads/:threadId/agents",
    in: z.object({
      threadId: z.string(),
      add: z.array(z.string()),
      remove: z.array(z.string()),
      expectedRosterVersion: z.number().int().nonnegative(),
    }).strict(),
    out: z.object({
      rosterVersion: z.number().int().nonnegative(),
      agents: z.array(z.object({
        id: z.string(), abbr: z.string(), name: z.string(),
        duty: z.string(),
        /** #1705——同 `getAgentPanel.out.agents[].roleLabel`，同一个字段同一份注释。 */
        roleLabel: z.string(),
        presence: AgentPresence,
      }).strict()),
      auditEventId: z.string(),
    }).strict(),
    err: [
      "NOT_VISIBLE", "NO_WRITE_ROLE", "AGENT_OUT_OF_SCOPE",
      "VERSION_CHANGED", "AGENT_NOT_FOUND", "AUDIT_SINK_UNAVAILABLE",
    ] as const,
  },

  /**
   * listMessages —— 读消息流。
   * ⚠ **必须分页/增量**（R9），禁止一次加载整个项目历史。
   * ⚠ 空态返回 `messages: []`，**不生成示例对话**（V14）。
   */
  listMessages: {
    method: "GET", path: "/chat/threads/:threadId/messages",
    in: z.object({
      threadId: z.string(),
      cursor: z.string().optional(),
      limit: z.number().int().positive().max(100).optional(),
    }).strict(),
    out: z.object({
      messages: z.array(DurableMessage), nextCursor: z.string().nullable(),
    }).strict(),
    err: ["NOT_VISIBLE", "AUTHZ_UNAVAILABLE"] as const,
  },

  /** Wave 2: persist the human message and queued run; never return a synthetic reply. */
  createMessage: {
    method: "POST", path: "/chat/threads/:threadId/messages",
    in: z.object({
      threadId: z.string(),
      clientMessageId: z.string().uuid(),
      text: z.string().trim().min(1),
      agentId: z.string().trim().min(1),
      // #946 · V9-a F151：把已上传的 pending 附件挂到这条消息上。可选、去重、上限取自
      // 单源 ATTACHMENT_LIMITS。每个 id 必须属本线程且未挂过别的消息，否则整条拒
      // （ATTACHMENT_NOT_PENDING），发消息与挂附件是一个原子事务。
      attachmentIds: z.array(z.string()).max(ATTACHMENT_LIMITS.maxAttachmentsPerMessage).optional(),
    }).strict(),
    out: z.object({
      message: DurableMessage,
      agentRunId: z.string(),
      runStatus: z.literal("queued"),
    }).strict(),
    err: [
      "NOT_VISIBLE", "NO_WRITE_ROLE", "AGENT_NOT_FOUND", "IDEMPOTENCY_CONFLICT",
      // #946 · V9-a F151：attachmentIds 里有 id 不属本线程 / 已挂过别的消息 / 不存在。
      "ATTACHMENT_NOT_PENDING",
    ] as const,
  },

  /**
   * agentProactiveSpeak —— AI 主动发言。
   * ⚠ **取不到来源时是「正常返回但不发言」，不是错误**（I-19 / V6）。
   *   做成 `throw NO_SOURCE` 会让上游 catch 住之后「兜底发一条」——那正是要防的。
   *   所以 `emitted: false` 走 `out` 而不是 `err`。
   */
  agentProactiveSpeak: {
    method: "POST", path: "/chat/threads/:threadId/agent-speak",
    in: z.object({
      threadId: z.string(), agentId: z.string(), trigger: z.string(),
    }).strict(),
    out: z.object({
      emitted: z.boolean(),
      /** `emitted: false` 时非空，取值目前只有 `no-source` */
      reason: z.literal("no-source").nullable(),
      messageId: z.string().nullable(),
    }).strict(),
    err: ["CONTEXT_API_UNAVAILABLE"] as const,
  },

  /**
   * getRightTabs —— 右栏五标签。⚠ **恒五个**，各标签独立失败**不整体失败**。
   * ⚠ 研究阶段转录标签隐藏或置空，默认落「材料」（E1）；观察者的转录卡与批准卡
   *   **不在响应体里**（I-5）。
   */
  getRightTabs: {
    method: "GET", path: "/chat/threads/:threadId/right-tabs",
    in: z.object({ threadId: z.string(), phase: ThreadPhase }).strict(),
    out: z.object({
      tabs: z.array(z.object({
        tab: RightTab,
        count: z.number().int().nonnegative(),
        failed: z.boolean(),
        hidden: z.boolean(),
      }).strict()),
    }).strict(),
    err: ["NOT_VISIBLE", "AUTHZ_UNAVAILABLE"] as const,
  },

  /** suggestReassignment —— 改派建议。⚠ 无建议时返回空对象**不是错误**；`reason` 恒非空（I-21） */
  suggestReassignment: {
    method: "POST", path: "/chat/threads/:threadId/reassignment-suggestion",
    in: z.object({ threadId: z.string(), messageDraft: z.string() }).strict(),
    out: z.object({
      suggested: z.object({
        agentId: z.string(), reason: z.string(),
      }).strict().nullable(),
    }).strict(),
    err: [] as const,
  },

  /**
   * controlTranscriptCard —— 转录卡控制。
   * ⚠ 计时必须是**真实录制时长**，不是页面计时器。
   * ⚠ `ALREADY_STOPPED` 是**幂等出口**：重复 stop 不报错、返回同一 `stoppedAt`。
   */
  controlTranscriptCard: {
    method: "POST", path: "/chat/threads/:threadId/transcript-card",
    in: z.object({ threadId: z.string(), action: z.literal("stop") }).strict(),
    out: z.object({
      transcriptSessionId: z.string(),
      elapsedSeconds: z.number().int().nonnegative(),
      stoppedAt: z.string(),
    }).strict(),
    err: [
      "NOT_VISIBLE", "NO_WRITE_ROLE", "TRANSCRIPT_SERVICE_UNAVAILABLE", "ALREADY_STOPPED",
    ] as const,
  },

  /* ── 三、工具调用链与引用（F111 · uc-8-2）─────────────────────── */

  /**
   * expandToolCallChain —— 展开工具调用链。
   * ⚠ **是 `provenance_events` 的投影**：`calls.length === provenanceEvents.length`（I-22）。
   *   **不另建调用日志表**——两套会漂移。
   * ⚠ **失败条不隐藏**（I-25）：`summary.callCount === calls.length` 恒成立；
   *   失败条带原因，基于它的结论标 `incomplete`。
   */
  expandToolCallChain: {
    method: "GET", path: "/chat/messages/:messageId/tool-calls",
    in: z.object({ messageId: z.string() }).strict(),
    out: z.object({
      summary: z.object({
        callCount: z.number().int().nonnegative(),
        readVolume: z.number().int().nonnegative(),
        tokens: z.number().int().nonnegative(),
      }).strict(),
      calls: z.array(ToolCall),
    }).strict(),
    err: ["NOT_VISIBLE", "PROVENANCE_UNAVAILABLE"] as const,
  },

  /**
   * locateCitation —— 定位一条引用。
   * ⚠ 取来源与目标中**更严格**的可见性（I-11）。
   * ⚠ `ANCHOR_UNRESOLVABLE` 意味着**这条引用不合格**（I-24），上游若正在定版则定版必须被拒。
   * ⚠ `CITATION_OUT_OF_PACK`：引用落在**本次 Context Pack 之外**的证据上 ⇒ 拒绝并记录。
   *   这个码**属 phase-00 `context-pack`**（F12 已 passing），本束**引用它，不另起**。
   */
  locateCitation: {
    method: "GET", path: "/chat/citations/:citationId",
    in: z.object({ citationId: z.string() }).strict(),
    out: z.object({
      index: z.number().int().positive(),
      sourceFullName: z.string(),
      anchor: z.object({
        kind: CitationAnchorKind,
        page: z.number().int().positive().nullable(),
        range: z.string().nullable(),
        messageId: z.string().nullable(),
      }).strict(),
      locatable: z.literal(true),
    }).strict(),
    err: [
      "NOT_VISIBLE", "ANCHOR_UNRESOLVABLE", "SOURCE_ARTIFACT_DELETED", "CITATION_OUT_OF_PACK",
    ] as const,
  },

  /**
   * replayContextPack —— 重放某轮的 Context Pack。
   * ⚠ `omissions[].reason` 的七类枚举**不由本束定义**（S-12，属 `context-pack` 束），
   *   所以这里的 `reason` 是**透传字符串**——本束不复制那份枚举。
   */
  replayContextPack: {
    method: "GET", path: "/chat/agent-runs/:agentRunId/context-pack",
    in: z.object({ agentRunId: z.string() }).strict(),
    out: z.object({
      contextPackId: z.string(),
      items: z.array(z.object({
        itemId: z.string(), kind: z.string(),
      }).strict()),
      omissions: z.array(z.object({
        /** ⚠ 单源在 `context-pack` 束；本束**只透传不重列** */
        reason: z.string(),
        count: z.number().int().nonnegative(),
      }).strict()),
    }).strict(),
    err: ["NOT_VISIBLE", "PACK_NOT_RECORDED", "CONTEXT_API_UNAVAILABLE"] as const,
  },

  /* ── 四、批准闸门（F112 · uc-8-2 · 产品的信任核心）──────────────── */

  /**
   * createApprovalRequest —— 高影响动作 → 批准请求。
   * ⚠ **动作零副作用**（I-27）：`paused` 期间目标系统**无任何写入**。
   * ⚠ **六项披露全非空**（I-28），缺一即失败：调用链 / 模型 / 预算 / 数据范围 / 出口 / 时限。
   * ⚠ `REGISTRY_UNAVAILABLE` ⇒ **不出卡**。**不得回落到硬编码价目**「先让卡显示出来」——
   *   那会做出 I-31 的反例。
   */
  createApprovalRequest: {
    method: "POST", path: "/chat/threads/:threadId/approval-requests",
    in: z.object({
      threadId: z.string(),
      agentId: z.string(),
      action: z.string(),
      dataScope: z.array(ApprovalDataScope),
      proposedModels: z.array(z.string()),
      estimatedTokens: z.number().int().nonnegative(),
    }).strict(),
    out: z.object({
      requestId: z.string(),
      status: z.literal("paused"),
      callChain: z.array(z.string()),
      models: z.array(z.string()),
      budget: z.object({
        tokens: z.number().int().nonnegative(),
        amount: z.number(),
        currency: z.string(),
      }).strict(),
      dataScope: z.array(ApprovalDataScope),
      exits: z.array(ApprovalExit),
      expiresAt: z.string(),
      backgroundHint: z.string(),
    }).strict(),
    err: [
      "MODEL_POLICY_VIOLATION", "REGISTRY_UNAVAILABLE", "BUDGET_EXHAUSTED", "RISK_TABLE_MISSING",
    ] as const,
  },

  /**
   * decideApproval —— 走三个出口之一。**这一段是产品的信任核心，逐条都要有独立断言。**
   *
   * ⚠ **并发**（V17 / I-29）：两人同时点批准只有一个生效，另一个 `APPROVAL_STATUS_CHANGED`。
   * ⚠ **幂等重放**：同一 `(requestId, expectedStatus)` 的重复 approve 返回**同一 `taskId`**，
   *   **不得产生第二个后台任务**（否则「批准一次执行两次」）。
   * ⚠ **超时**：过期后调批准被拒，状态「已过期 · 未执行」，**不得静默执行**。
   *   默认时限现场 5 分钟 / 非现场 24 小时（O-36，可配）——**数值不写进契约**。
   * ⚠ **改参不就地改写**（I-30）：生成新请求，原请求存档为「已改参」，**字节不变**。
   * ⚠ **部分成功**：批准成功但入队失败 ⇒ `TASK_QUEUE_UNAVAILABLE`，请求**留在 `paused`**
   *   （不能转 approved），否则会出现「已批准但没有任务」的无主状态。
   */
  decideApproval: {
    method: "POST", path: "/chat/approval-requests/:requestId/decide",
    in: z.object({
      requestId: z.string(),
      exit: ApprovalExit,
      expectedStatus: z.literal("paused"),
      newModels: z.array(z.string()).nullable(),
      newBudget: z.object({
        tokens: z.number().int().nonnegative(),
        amount: z.number(),
        currency: z.string(),
      }).strict().nullable(),
      newDataScope: z.array(ApprovalDataScope).nullable(),
    }).strict(),
    out: z.object({
      /** approve 时非空 */
      taskId: z.string().nullable(),
      etaMinutes: z.number().int().nonnegative().nullable(),
      /** reparam 时非空——**新请求**，不是就地改写 */
      newRequestId: z.string().nullable(),
      supersedesRequestId: z.string().nullable(),
      auditEventId: z.string(),
    }).strict(),
    err: [
      "NOT_VISIBLE", "NO_APPROVAL_ROLE", "APPROVAL_STATUS_CHANGED", "APPROVAL_EXPIRED",
      "MODEL_POLICY_VIOLATION", "TASK_QUEUE_UNAVAILABLE", "AUDIT_SINK_UNAVAILABLE",
    ] as const,
  },

  /**
   * getBackgroundTask —— 查后台任务回流。
   * ⚠ 节点恢复时**副作用必须幂等**（LangGraph `interrupt()` 的 HITL 恢复语义）。
   * ⚠ **界面断连不得导致任务丢失或重复执行**——服务端 run/event 是权威，
   *   CopilotKit / AG-UI 只是 presentation protocol（R7 编排边界）。
   */
  getBackgroundTask: {
    method: "GET", path: "/chat/tasks/:taskId",
    in: z.object({ taskId: z.string() }).strict(),
    out: z.object({
      status: TaskStatus, resultMessageId: z.string().nullable(),
    }).strict(),
    err: ["NOT_VISIBLE", "TASK_NOT_FOUND", "TASK_QUEUE_UNAVAILABLE"] as const,
  },

  /* ── 五、产出落地（F114 · uc-8-3）─────────────────────────────── */

  /**
   * landAsArtifact —— 把一条结论 / 产物卡落地为 Artifact。
   * ⚠ **机制委托**（D-38）：三模式绑定与定版调 phase-00 `artifact` 的
   *   `bindToProjectStep` / `pinVersion`。**本束不另立版本机制。**
   * ⚠ 出处回链三项非空（I-33）；`mode = pinned` 还要求 **100% 引用可定位**。
   * ⚠ `CITATION_UNRESOLVABLE_REQUIRES_DRAFT`：有任一引用不可定位 ⇒ **只能落草稿，不得定版**（V4d）。
   * ⚠ `CITATION_OUT_OF_PACK`：引用落在本次 Pack 之外 ⇒ 拒绝。**这是 phase-00 的码，不另起。**
   * ⚠ **部分成功**：Artifact 已建但绑定失败 ⇒ 整体回滚或落 `draft`，
   *   **不得留下一个绑不上的孤儿产出**。
   */
  landAsArtifact: {
    method: "POST", path: "/chat/threads/:threadId/artifacts",
    in: z.object({
      threadId: z.string(),
      messageId: z.string(),
      mode: LandingMode,
      title: z.string(),
      payloadRef: z.string(),
    }).strict(),
    out: z.object({
      artifactId: z.string(),
      versionId: z.string().nullable(),
      contentHash: z.string().nullable(),
      mode: LandingMode,
      hasSource: z.boolean(),
      /** 三项非空是 I-33 的接口投影 */
      provenanceBacklink: z.object({
        conversationId: z.string(),
        messageId: z.string(),
        citations: z.array(Citation),
      }).strict(),
    }).strict(),
    err: [
      "NOT_VISIBLE", "NO_WRITE_ROLE", "MISSING_PROVENANCE_BACKLINK",
      "CITATION_UNRESOLVABLE_REQUIRES_DRAFT", "PERSONAL_THREAD_REQUIRES_DRAFT", "CITATION_OUT_OF_PACK",
      "STUDIO_RUN_NOT_FOUND", "VERSION_CHANGED", "STORAGE_UNAVAILABLE", "AUDIT_SINK_UNAVAILABLE",
    ] as const,
  },

  /**
   * summarizePersonaFromThread —— ✅ **已人类签核**（design-delta
   * `chat-persona-roundtrip`，confirmed 2026-08-18；原 🟡 待补签状态与两个开放
   * 问题的裁决见 `KNOWN_CONTRACT_GAPS.C_CHAT_11`）。
   *
   * 把内置 canvas 模板 `persona`（`canvas.BUILTIN_CANVAS_TEMPLATES.persona`）「在 chat
   * 里用起来」——扫描线程里已经真实写出的画像信息，落地成一份 Artifact。**机制委托**
   * 同 `landAsArtifact`（D-38）：本操作只是在调用 `landAsArtifact` 之前，先把
   * `title` / `payloadRef` 从线程正文里如实收敛出来，不新起一套落地机制。
   *
   * ⚠ **不编造**：字段/分区只在线程正文里出现过 `persona` 模板自己的文本语法
   *   （`字段: 值` / `## 分区名` / `- 要点`，见 `@repo/fabric-markdown` 的
   *   `parseTemplateText`）时才会被采纳；线程里一条都没有时，`sufficient: false`
   *   且落地内容是明说「信息不足」的占位模板，不是虚构的画像。
   * ⚠ mode 恒为 `draft`（`landAsArtifact.in` 的 `LandingMode` 三选一里最不需要
   *   前置条件的一档）——这个操作产出的是「AI 从对话里读出来的草稿」，不是人已经
   *   确认过的定论，定版留给使用者之后手动走 `landAsArtifact`。签核裁决：**恒 draft，
   *   不开放 live/pinned**（design-delta chat-persona-roundtrip，confirmed 2026-08-18）。
   * ⚠ **产出同时以 assistant 消息进入线程**（同一次签核的行为约定）：正文为一个
   *   ```mermaid mindmap 围栏——根节点 = 画像名，六个一级分支 = persona 模板
   *   `PERSONA_SECTIONS` 六分区（权威源 `@repo/fabric-markdown`），分支下挂线程里
   *   真实收敛出的要点；`sufficient: false` 时六分支下各挂一个「信息不足」占位节点，
   *   不编造。`out.resultMessageId` 即那条消息的 id（命名沿用 `getBackgroundTask.out.
   *   resultMessageId` 的既有先例），供前端定位渲染，不必整线程重拉。
   */
  summarizePersonaFromThread: {
    method: "POST", path: "/chat/threads/:threadId/persona-summary",
    in: z.object({
      threadId: z.string(),
      messageId: z.string(),
    }).strict(),
    out: z.object({
      artifactId: z.string(),
      versionId: z.string().nullable(),
      contentHash: z.string().nullable(),
      mode: LandingMode,
      hasSource: z.boolean(),
      /** 线程里有没有找到任何可辨认的画像信息——false 时落地内容是「信息不足」占位。 */
      sufficient: z.boolean(),
      /**
       * 画像以 assistant 消息进入线程（正文为 ```mermaid mindmap 围栏，见操作头注）。
       * 本字段是那条消息的 id，供前端定位渲染，不必整线程重拉。
       */
      resultMessageId: z.string(),
      provenanceBacklink: z.object({
        conversationId: z.string(),
        messageId: z.string(),
        citations: z.array(Citation),
      }).strict(),
    }).strict(),
    err: ["NOT_VISIBLE", "NO_WRITE_ROLE", "STORAGE_UNAVAILABLE"] as const,
  },

  /**
   * recommendCanvasTemplates —— 2026-09-06，设计增量，**🟡 待人类补签**（同 #496/#988/
   * `suggestTemplateSections` 的先例：人类当面交办「可否变为一个动态的、更具上下文来
   * 推荐可视化模板的地方，而不只是用户画像」，本操作是那句话的契约面）。
   *
   * 签核材料已备齐，等人类改那一行 `status`：
   * `phases/phase-01-run-a-project/design-deltas/canvas-template-recommendations/`
   * （三件：contract.md / verification.md / design-signoff.md）。⚠ **唯一的签核门是
   * 那份 `design-signoff.md`**，不是这段注释——本注释一度写成"已签核"，而机械签核链上
   * 没有任何对应记录（PR #2856 codex review P1 指出，属实，已回退）。
   *
   * ## 它替换掉的是什么
   *
   * chat 建议行里那条「生成用户画像」chip 此前是前端一个写死的常量
   * （`copilotkit-v2-panel-body.tsx` 的 `personaSuggestions`）：19 个内置 + 组织自建的
   * 画布模板里只有 `persona` 一个进得了建议行，文案永远相同，后台 template-admin 里
   * 新建/改名/停用一个模板对它毫无影响。本操作把「现在该推荐哪几个画布模板」变成一次
   * **服务端按当前线程内容 + 当前已发布模板库**算出来的答案。
   *
   * ## 两件输入事实，都读真实状态，不猜
   *
   * ① **线程里已经产出过哪些模板**——扫这条线程已落库消息正文里的 ```` ```canvas ````/
   *    ```` ```persona ```` 围栏（`模板: <key>` 行），这是 `buildCanvasTemplateGuidance`
   *    （issue #1493）指导模型写出来的那个格式，不是为本操作新发明的标记；再加上
   *    `PERSONA_SUMMARY_AUTHOR_ID` 那条产出（它落的是 mindmap 围栏，扫不出来）。
   * ② **模板自己配的推荐关系**——已发布模板行的 `recommendAfter`
   *    （`canvas.updateTemplateMetadata.in.recommendAfter`，后台可改）。
   *
   * ## 排序是**三个梯队依次兜底**，直到凑够 `items` 或没得推为止
   *
   *   ① 已画过的模板明确配了的下一步（按被推荐次数、模板库顺序）——后台配置，最强信号；
   *   ② 起点模板里还没画的（推荐图入度为 0 者，之间按出度排）——方法论上的开场；
   *   ③ 其余还没画过的已发布模板，按模板库顺序——最弱信号：至少它是一张能画的模板。
   *
   * 库里每一张都画过了 ⇒ `items` 为空（不推荐一件用户刚做完的事），除此之外**每一轮
   * 都给得出下一步**。梯队②③是 2026-09-06 人类实测「第二轮以后就没有了，每一轮都要有
   * 推荐的下一步的动作」之后加的：组织自建模板的 `recommend_after` 是空的（没人配过，
   * 而内置默认表只对 `builtin` 行兜底），只有梯队①时，模型一画出这类模板就再也拿不到
   * 任何建议。
   *
   * ⚠ 这套排序语义 **schema 表达不了**（`out.items` 只是一个有序数组），所以它的唯一
   *   权威描述是这段散文 + `domain/canvas/template-recommendation.ts` 里那个纯函数与
   *   它的测试。改行为时这三处一起改——本操作下方 `KNOWN_CONTRACT_GAPS.C_CHAT_12`
   *   记的是"待人类拍板的取舍"，不是第二份行为说明。
   *
   * ⚠ **不调模型**。这是一次纯粹的读取 + 集合运算，几毫秒返回，可以在面板挂载时直接
   *   调用；建议行里另一半（CopilotKit 的追问建议）才是模型生成的。把它做成模型调用
   *   会让一排 chip 的出现时间取决于模型排队情况，而它本质上只是"模板库里配好的下一步"。
   * ⚠ **本操作不产出任何画布**。点击一条建议之后发生什么由前端决定（`persona` 走既有
   *   `summarizePersonaFromThread`，其余走一条普通用户消息，由 issue #1493 已经注入
   *   system prompt 的那段 canvas 指引带模型产出围栏）——本操作只回答"推荐什么"。
   * ⚠ `projectId` 走 **query** 且可缺省（缺省 = 个人线程），与 `getThread` 逐字同套，
   *   见 🔴 #594 那条注释。
   */
  recommendCanvasTemplates: {
    method: "GET", path: "/chat/threads/:threadId/canvas-template-recommendations",
    in: z.object({
      threadId: z.string(),
      projectId: z.string().nullable(),
    }).strict(),
    out: z.object({
      items: z.array(z.object({
        /** 已发布模板行的 key，如 `journey-map`。 */
        key: z.string(),
        /** 后台配的显示名，chip 文案直接用它——前端不另存一份中文名映射。 */
        displayName: z.string(),
        /**
         * 点这条 chip 要发出去的那句话。服务端拼，前端原样发——「怎么让模型照这个
         * 模板产出围栏」是后端 `buildCanvasTemplateGuidance` 那套格式约定的一部分，
         * 前端再拼一遍就是同一条规则的第二份副本。
         */
        prompt: z.string(),
      }).strict()).max(4),
    }).strict(),
    /** 不可见/不存在同一个出口（同 `getThread`）。模板库读不到时返回空 `items`，不报错。 */
    err: ["NOT_VISIBLE"] as const,
  },

  /**
   * generateFollowUpSuggestions —— UIUX 对标 CopilotKit gap #2（issue #712）：把线程
   * composer 下方的「追问建议」chip 从纯前端确定性规则换成一次真实模型推理。
   *
   * ⚠ **这不是 chat 主回复**：不写入 `chat_messages`、不占用 `agent_runs` 状态机，
   *   只读线程最近若干轮正文、拼一段简短 system prompt、调一次
   *   `ModelCallPort.complete`，把回复解析成 2-3 条追问问题。`agentId` 由调用方
   *   （composer 当前选中的 Agent）传入，与 `acceptHumanMessage.in.agentId` 同一信任级别。
   * ⚠ **失败即失败，不在这里编造兜底句**：模型没配置/调用失败/回复解不出结构化建议，
   *   一律 `AGENT_DEPENDENCY_FAILED`（503）。「没有真实建议时展示什么」是前端
   *   `computeFollowUpSuggestions` 自己的既有确定性规则要接手的事，不是这个操作的职责。
   * ⚠ `suggestions` 可能少于 3 条（模型只给了 1-2 条时如实返回），但不会是空数组——
   *   空结果在用例层已经归入失败（`FollowUpSuggestionsDependencyFailedError`）。
   */
  generateFollowUpSuggestions: {
    method: "POST", path: "/chat/threads/:threadId/followup-suggestions",
    in: z.object({
      threadId: z.string(),
      agentId: z.string(),
    }).strict(),
    out: z.object({
      suggestions: z.array(z.string()).min(1).max(3),
    }).strict(),
    err: ["NOT_VISIBLE", "AGENT_DEPENDENCY_FAILED"] as const,
  },

  /**
   * checkDownstreamEligibility —— 引用资格门。
   * ⚠ **这个门必须是 phase-00 `artifact.referenceForDownstream` 那一个**（I-34）——
   *   对话侧**不自己判「是不是快照」**。本端口是那个门的**投影**，不是第二道门。
   * ⚠ `REQUIRES_ACCEPTANCE`：定版是**必要不充分**条件——需验收的产出还须过 UC-13.2。
   */
  checkDownstreamEligibility: {
    method: "POST", path: "/chat/artifacts/:artifactId/downstream-eligibility",
    in: z.object({
      artifactId: z.string(), purpose: ChatDownstreamPurpose,
    }).strict(),
    out: z.object({
      allowed: z.literal(true), versionId: z.string(),
    }).strict(),
    err: [
      "REQUIRES_PINNED", "REQUIRES_ACCEPTANCE", "NOT_VISIBLE", "SNAPSHOT_IMMUTABLE",
    ] as const,
  },

  /**
   * listThreadArtifacts —— 右栏「产物」列表。
   * ⚠ **草稿仅创建者可见 → 其余 404**（I-36），走 `NOT_VISIBLE` 的同一形状。
   * ⚠ 空态计数为 0 且显示真实空态，**不生成伪产出**（V7）。
   */
  listThreadArtifacts: {
    method: "GET", path: "/chat/threads/:threadId/artifacts",
    in: z.object({ threadId: z.string() }).strict(),
    out: z.object({
      items: z.array(z.object({
        artifactId: z.string(),
        title: z.string(),
        mode: LandingMode,
        version: z.number().int().positive().nullable(),
        pinnedBy: z.string().nullable(),
        pinnedAt: z.string().nullable(),
        hasSource: z.boolean(),
        /**
         * 该产物落地时的来源消息（`chat_artifact_landings.message_id`，列本身
         * NOT NULL）。签核裁决：**严格 `z.string()`，不留 nullable 预留**——未来
         * 真出现非 landing 来源的行，届时走一次正式契约改动（design-delta
         * chat-persona-roundtrip，confirmed 2026-08-18）。与 `landAsArtifact.out.
         * provenanceBacklink.messageId` 是同一事实的两个读投影，权威源同一单列。
         */
        messageId: z.string(),
      }).strict()),
    }).strict(),
    err: ["NOT_VISIBLE"] as const,
  },

  /**
   * getThreadArtifactSource —— 取回一次落地的源 markdown，供图表 modal 重开时用
   * 最新保存版初始化（design-delta chat-persona-roundtrip G1b，confirmed 2026-08-18）。
   * ⚠ 草稿仅创建者可见 → 其余 NOT_VISIBLE（I-36 的同一形状，与 `listThreadArtifacts`
   *   同码同语义：同一条草稿在 list 里不可见 ∧ source 读不到，不发明新码，也不
   *   区分「不存在」与「不可见」）。
   * ⚠ 只读端口，不新起版本机制（D-38 延续）：markdown 从 phase-00 `materializeArtifact`
   *   已写下的字节读回，本操作不写任何东西。同一 `(threadId, artifactId)` 若有多条
   *   landing 行，取 `created_at` 最新一条（签核：多次保存不去重、读回按最新，不在
   *   契约层暴露版本选择）。
   * ⚠ `STORAGE_UNAVAILABLE`：字节从对象存储读回，存储不可用是真实失败面（503）——
   *   签核裁决明确加上这个码。
   */
  getThreadArtifactSource: {
    method: "GET", path: "/chat/threads/:threadId/artifacts/:artifactId/source",
    in: z.object({ threadId: z.string(), artifactId: z.string() }).strict(),
    out: z.object({
      markdown: z.string(),
      /** 与 `listThreadArtifacts` 同义：draft 无冻结版本 ⇒ null。 */
      version: z.number().int().positive().nullable(),
      /** ISO 时间戳，读回提示条「X 时间前」的数据源（landing 行的 created_at）。 */
      savedAt: z.string(),
      /** `chat_artifact_landings.created_by`。 */
      savedBy: z.string(),
    }).strict(),
    err: ["NOT_VISIBLE", "STORAGE_UNAVAILABLE"] as const,
  },

  /* ── 六、预设对话（F115 · uc-8-4）─────────────────────────────── */

  /**
   * upsertPreset —— 创建 / 编辑预设。
   * ⚠ 预设定义按 `artifact_versions` 管理、**不可变**；编辑生成新版本。
   * ⚠ `PRESET_PREAPPROVAL_FORBIDDEN`：**预设不得预先批准任何高影响动作**（I-41）——
   *   否则「批准闸门」可以被一份预设一次性绕过，那道门就白做了。
   */
  upsertPreset: {
    method: "POST", path: "/chat/projects/:projectId/presets",
    in: z.object({
      projectId: z.string(),
      presetId: z.string().nullable(),
      openingPrompt: z.string(),
      skills: z.array(z.string()),
      agents: z.array(z.string()),
      expectedVersion: z.number().int().nonnegative().nullable(),
    }).strict(),
    out: z.object({
      presetId: z.string(), version: z.number().int().positive(),
    }).strict(),
    err: [
      "NO_PROJECT_ROLE", "VERSION_CHANGED",
      "PRESET_PREAPPROVAL_FORBIDDEN", "PRESET_SCOPE_BYPASS_FORBIDDEN",
    ] as const,
  },

  /**
   * dispatchPreset —— 下发预设：**引导师 → 组长/组员**。
   *
   * ⚠ 三条逐字答死的语义（原型，不是待裁）：
   *   ① 下发方向恒为**引导师 → 组长/组员**，没有反向；
   *   ② **被下发者能改**——实例是各人私有的对话，改它不回写预设定义；
   *   ③ 这是**上架供取用，不是推送**：下发只让预设对目标**可见可取**，
   *      **不代替目标点「开始」**。所以 `out` 里只有 `targetCount`（能取的人数），
   *      **没有** `createdInstanceIds`——下发**不创建任何实例**。
   *      实例只由 `startPresetInstance` 由本人触发产生。
   *
   * ⚠ **越范围在下发接口即拒绝，不是下发后失败**（I-40）；错误须标明是组织层还是项目层限制。
   * ⚠ **原子性**：拒绝时**不得已经创建部分实例或发出部分通知**。
   * ⚠ **幂等重放**：同一 `(presetId, targets, version)` 重复下发返回同一 `dispatchId`。
   */
  dispatchPreset: {
    method: "POST", path: "/chat/presets/:presetId/dispatch",
    in: z.object({
      presetId: z.string(),
      targets: z.object({
        plenary: z.boolean().nullable(),
        groupIds: z.array(z.string()).nullable(),
        roles: z.array(ProjectRole).nullable(),
      }).strict(),
    }).strict(),
    out: z.object({
      dispatchId: z.string(),
      /** 能取用的人数。⚠ **不是已创建实例数**——下发不创建实例 */
      targetCount: z.number().int().nonnegative(),
    }).strict(),
    err: [
      "NO_PROJECT_ROLE", "AGENT_OUT_OF_SCOPE", "SKILL_OUT_OF_SCOPE",
      "PRESET_NOT_FOUND", "VERSION_CHANGED",
    ] as const,
  },

  /**
   * startPresetInstance —— 开始一个预设实例（**由取用者本人触发**）。
   * ⚠ 打开即带好开场提示、agent 与 skill，**无需任何配置动作**。
   * ⚠ 实例是**各人私有的对话**，可见性由 `resolveVisibility` 判定（I-39）；
   *   **被下发者能改**自己的实例。
   * ⚠ **并发/幂等**：同一人重复点「开始」返回**同一 `instanceId`**，不产生两个实例——
   *   否则使用计数（I-38）会被刷高。
   */
  startPresetInstance: {
    method: "POST", path: "/chat/presets/:presetId/instances",
    in: z.object({ presetId: z.string() }).strict(),
    out: z.object({ threadId: z.string(), instanceId: z.string() }).strict(),
    err: [
      "NOT_DISPATCHED_TO_ACTOR", "PRESET_VERSION_SUPERSEDED", "AGENT_OUT_OF_SCOPE",
    ] as const,
  },

  /** getPresetUsage —— ⚠ `usageCount` = **真实实例数，不按下发人数估算**（I-38） */
  getPresetUsage: {
    method: "GET", path: "/chat/presets/:presetId/usage",
    in: z.object({ presetId: z.string() }).strict(),
    out: z.object({ usageCount: z.number().int().nonnegative() }).strict(),
    err: ["NOT_VISIBLE", "PRESET_NOT_FOUND"] as const,
  },

  /* ── 七、审计（横切，F108–F115）───────────────────────────────── */

  /**
   * queryChatAuditEvents —— 检索对话侧审计事件。
   * ⚠ **越权尝试也必须有安全审计记录**——四份 UC 各自重复写了这一条。
   * ⚠ 这个查询面**跨束**（X-2）：与 phase-00 `artifact` / `identity` 的 `queryProvenance`
   *   **必须是同一个查询面**，不得各造一个。本端口是那个面的**对话侧筛选投影**，
   *   不是第二张表——见 `KNOWN_CONTRACT_GAPS.C_CHAT_5`。
   */
  queryChatAuditEvents: {
    method: "GET", path: "/chat/projects/:projectId/audit-events",
    in: z.object({
      projectId: z.string(),
      actor: z.string().optional(),
      triggerAgent: z.string().optional(),
      timeRangeFrom: z.string().optional(),
      timeRangeTo: z.string().optional(),
      objectRef: z.string().optional(),
      result: z.string().optional(),
    }).strict(),
    out: z.object({
      events: z.array(z.object({
        id: z.string(),
        type: z.string(),
        actor: z.string(),
        triggerAgent: z.string().nullable(),
        at: z.string(),
        objectRef: z.string(),
        result: z.string(),
        impactScope: z.string(),
      }).strict()),
    }).strict(),
    err: ["NOT_VISIBLE", "AUDIT_QUERY_UNAVAILABLE"] as const,
  },
} as const;

export type Operations = typeof operations;
export type OperationName = keyof Operations;

/* ────────────── issue #726：composer 麦克风的「草稿」ASR 流式面 ────────────── */

/**
 * `streamAsrDraft` —— composer 麦克风按钮的语音转录，**不落库**。
 *
 * 与 `recording.streamOperations.streamAsr`（issue #466）复用**同一个**服务端
 * `AsrProviderPort`/`ConfiguredRealtimeAsrProvider`（同一份服务端代理、同一把阿里云 key、
 * 同样"未配置就诚实报错"的纪律，见 `apps/api/src/application/recording/asr-ports.ts`），
 * 但语义不同，因此**不是同一条面**：
 *
 *   · `streamAsr` 锚在一个已存在的 `recording_sessions` 行 + 一条消息，`asr.final`
 *     由服务端调 `ingestTranscriptSegment` 落库后才回帧（`asr.final.segmentId` 是
 *     数据库主键）——语义是"这场会话的正式转录记录"。
 *   · `streamAsrDraft` 没有 sessionId、没有 messageId，用户此刻可能连消息都还没开始写。
 *     转录结果只回给发起请求的浏览器，填进 composer 输入框，**不进任何持久化表**——
 *     语义是"用语音代替打字"，草稿态，最终由用户手动编辑、手动点发送才成为一条真消息。
 *
 * 把两者合并成一条面（例如给 `streamAsr` 加"sessionId 可选"）会让"这段转录到底有没有
 * 落库"变成一个只有调用参数能回答的隐式状态——那正是 contract.md §2 要求单一写路径想
 * 避免的模糊态，这里选择拆成两条职责单一的面。
 *
 * ⚠ 与 `streamAsr` 相同：浏览器**永远不直连**上游 ASR（阿里云 key 只在服务端），
 *   鉴权同样走 `Sec-WebSocket-Protocol` 子协议携带的 bearer（不走 query string）。
 */

/**
 * `summarizePersonaFromThread` 落地的 assistant 消息的 `author_id`（`agent_id`
 * 恒 NULL，见该操作头注「G2 assistant 消息的 author_id」）——单一事实源：后端
 * 落库时写这个值（`summarize-persona-from-thread.ts`），前端用它从
 * `listMessages`/`DurableMessage.authorId` 里判断"这条线程后端是否已经落库过一份
 * 画像产物"（issue #2694 修复：建议 chip 的出现条件从只看本地 session 状态
 * `personaGeneratedOnce`，改成同时读这份后端已落库的事实），两边不各自维护一份
 * 字符串字面量。
 */
export const PERSONA_SUMMARY_AUTHOR_ID = "persona-summary";

/**
 * 草稿 ASR 的 `asr.error` 原因——`recording.AsrStreamErrorReason` 的一个**真子集**。
 *
 * 刻意不包含 `SESSION_ENDED`／`NO_PROJECT_ROLE`／`CONFIDENTIAL_SCOPE_FORBIDS_EXTERNAL_ASR`：
 * 那三个原因的前提是"存在一个 recording_sessions 行、一个项目、一次机密域判定"，
 * 而草稿流没有这些概念——没有会话可以"已结束"，没有项目角色可以"没有"。
 * 字符串字面量与 `recording.AsrStreamErrorReason` 里同名的三个**同码同义**
 * （下方编译期断言钉住），不是巧合撞名。
 */
export const ChatAsrDraftErrorReason = z.enum([
  "ASR_PROVIDER_UNAVAILABLE",
  "ASR_NOT_CONFIGURED",
  "AUDIO_FORMAT_REJECTED",
]);

/** 上游要求的音频格式——与 `recording.ASR_AUDIO_FORMAT` 数值相同（同一个上游、同一份契约）。 */
export const CHAT_ASR_DRAFT_AUDIO_FORMAT = {
  sampleRate: 16_000,
  channels: 1,
  encoding: "pcm16le",
} as const;

/** 客户端 → 服务端。没有 `trackId`/`messageId`/`idempotencyKeyPrefix`——草稿流不落库，不需要幂等键。 */
export const ChatAsrDraftClientFrame = z.discriminatedUnion("type", [
  z.object({ type: z.literal("asr.start") }).strict(),
  z.object({ type: z.literal("asr.finish") }).strict(),
]);

/** 服务端 → 客户端。`asr.final` 没有 `segmentId`——它不是任何数据库行的投影。 */
export const ChatAsrDraftServerFrame = z.discriminatedUnion("type", [
  z.object({ type: z.literal("asr.partial"), text: z.string() }).strict(),
  z.object({ type: z.literal("asr.final"), text: z.string() }).strict(),
  z.object({ type: z.literal("asr.error"), reason: ChatAsrDraftErrorReason }).strict(),
  z.object({ type: z.literal("asr.finished") }).strict(),
]);

export const streamOperations = {
  streamAsrDraft: {
    path: "/chat/asr-draft",
    /** 与 `recording.streamOperations.streamAsr` 相同的前缀字面量——同一种鉴权机制。 */
    bearerSubprotocolPrefix: "bearer.",
    audio: CHAT_ASR_DRAFT_AUDIO_FORMAT,
    client: ChatAsrDraftClientFrame,
    server: ChatAsrDraftServerFrame,
    err: ChatAsrDraftErrorReason,
  },
} as const;

export type StreamOperations = typeof streamOperations;

/**
 * 机械钉住上面注释里那句「同码同义」——`ChatAsrDraftErrorReason` 的三个值必须真的是
 * `recording.AsrStreamErrorReason` 里同名值的**同一件事**，不是撞名。任一侧改了字面量、
 * 或两边对同一个字符串给出不同含义，这里就编译失败，而不是留到运行时才发现两条 ASR
 * 面对同一个错误码的解释不一致。
 */
type RecordingAsrStreamErrorReasonT = z.infer<typeof RecordingAsrStreamErrorReason>;
type ChatAsrDraftErrorReasonT = z.infer<typeof ChatAsrDraftErrorReason>;
export const CHAT_ASR_DRAFT_SHARED_WITH_RECORDING_ASR = [
  "ASR_PROVIDER_UNAVAILABLE",
  "ASR_NOT_CONFIGURED",
  "AUDIO_FORMAT_REJECTED",
] as const satisfies readonly (RecordingAsrStreamErrorReasonT & ChatAsrDraftErrorReasonT)[];

/* ────────────── 跨束「同码同义」的编译期门控（硬要求 ②）────────────── */

type PermissionReasonT = z.infer<typeof PermissionReason>;
type ArtifactErrorT = z.infer<typeof ArtifactError>;
type ContextPackReasonT = z.infer<typeof ContextPackReason>;
type ChatErrorT = z.infer<typeof ChatError>;

export const CHAT_SHARED_WITH_IDENTITY = [
  "NO_PROJECT_ROLE",
] as const satisfies readonly (PermissionReasonT & ChatErrorT)[];

export const CHAT_SHARED_WITH_ARTIFACT = [
  "REQUIRES_PINNED",
  "SNAPSHOT_IMMUTABLE",
] as const satisfies readonly (ArtifactErrorT & ChatErrorT)[];

/**
 * ⚠ **`CITATION_OUT_OF_PACK` 的单源在 `context-pack` 束**（phase-00 F12 已 passing）。
 * 本束**引用它，不另起**。这条断言是那句话的机械落点：
 * 若哪天有人在 context-pack 里把它改名，`tsc` 会在这里红，
 * 而不是等到「对话产出引用越界」这道门在生产里静默失效。
 */
export const CHAT_SHARED_WITH_CONTEXT_PACK = [
  "CITATION_OUT_OF_PACK",
] as const satisfies readonly (ContextPackReasonT & ChatErrorT)[];

/**
 * `ChatVisibility` 与 `identity.VisibilityScope` **必须保持分离**。
 *
 * 两者同名不同义（见 `ChatVisibility` 的模块注释），2026-07-30 已改名分离。
 * 这条断言把「分离」变成**会红的东西**：交集必须为 `never`。
 * 一旦有人往任一侧加了另一侧已有的取值（例如给 `ChatVisibility` 补一个 `team-only`
 * 「顺手对齐一下」），`AssertNever` 立刻编译失败。
 *
 * ⚠ 用 `AssertNever` 而不是 `[] as const satisfies readonly never[]`：
 *   后者写法**空数组永远通过**，是一条空转的断言——本仓已九次「全绿但空转」。
 */
type AssertNever<T extends never> = T;
export type ChatVisibilityMustNotOverlapIdentity = AssertNever<
  z.infer<typeof ChatVisibility> & z.infer<typeof VisibilityScope>
>;

/* ─────────────────────── 已知契约缺陷（如实登记）─────────────────────── */

export const KNOWN_CONTRACT_GAPS = {
  /**
   * **`ChatVisibility` 与 `identity.VisibilityScope` 的关系没有转换函数。**
   *
   * 两者已改名分离，但一条线程的内容落地成 Artifact 时，
   * artifact 的 `scope`（`org-wide` / `team-only`）要从线程的五值里**导出来**——
   * `landAsArtifact` 的 `in` 里没有 scope 字段，`out` 里也没有，
   * 于是「`member-private` 的线程产出，artifact 的 scope 是什么」**没有任何地方回答**。
   *
   * 本束**没有编一个映射表**（那会是第二处声明，且五→二的映射必然有损）。
   * 需人类裁决后放进**单一事实源**。
   */
  C_CHAT_1: "no defined mapping from ChatVisibility (5) to artifact/identity VisibilityScope (2) when a thread output lands as an Artifact",

  /**
   * **`ChatDownstreamPurpose`（4 值）与 `artifact.DownstreamPurpose`（5 值）取值对不上。**
   *
   * · chat（`usecases.md` UC-21 逐字）：`report-final` / `submit-acceptance` /
   *   `decision-evidence` / `write-back-kg`
   * · artifact（phase-00 已签）：`report-final` / `acceptance` / `decision-reference` /
   *   `graph-writeback` / `brain-promotion`
   *
   * 只有 `report-final` 同名。而 I-34 明写**引用资格门必须是 phase-00 那一个**——
   * 也就是说 chat 的四个 purpose 最终要翻译成 artifact 的五个之一，**翻译表不存在**。
   * 本束**不就地改名**（那是改别人签过的 UC），也不编翻译表。
   * ⇒ `checkDownstreamEligibility` 到 `referenceForDownstream` 的透传在 purpose 一项上**断了**。
   */
  C_CHAT_2: "ChatDownstreamPurpose (4) and artifact.DownstreamPurpose (5) share only one literal; no translation table exists though I-34 requires delegating to artifact's gate",

  /**
   * **「环节结束」的触发点未定**（domain 待裁决第 10 条）。
   *
   * `grantObserverRead` 的 `expiresOn: "stage-end"` 是唯一取值，
   * 但**没有任何操作定义「stage-end 何时发生」**。于是这条临时授权在契约层
   * 是一张**永不到期的票**——V7 要求的「环节结束后同一请求被拒」**无从断言**。
   */
  C_CHAT_3: "expiresOn: 'stage-end' has no defined trigger; the observer grant is effectively non-expiring at the contract layer",

  /**
   * **`updateAgentRoster` 的形状是 `[设计]` 而非 `[原型]`。**
   *
   * uc-8-2 R3 步骤 2 记着 `[编制]` 在原型里是**空按钮**。
   * `add` / `remove` / `expectedRosterVersion` 这个形状是契约作者推的，
   * 不是从任何已建成界面派生的。签核时须确认；
   * 尤其「整体拒绝而非部分成功」这条是本束定的策略。
   */
  C_CHAT_4: "updateAgentRoster shape is designed, not derived: the [编制] button is empty in the prototype archive",

  /**
   * **`queryChatAuditEvents` 与 phase-00 `queryProvenance` 的关系只是一句话，没有机械保证。**
   *
   * X-2 要求两者是**同一个查询面**，但本端口有自己的 `in` / `out` 形状，
   * `events[].type` 是开放字符串而不是 `provenance.ProvenanceEventType`。
   * ⇒ 「不得各造一个」目前**只靠人记得**。
   * 收敛方向：把本端口改成 `provenance.queryProvenance` 的带筛选包装，
   * 或者让 `ProvenanceEventType` 涵盖 chat 的十一类事件——两者都是跨束改动。
   */
  C_CHAT_5: "queryChatAuditEvents duplicates the provenance query surface in shape; event type is an open string, so the 'same surface' rule has no gate",

  /**
   * **本节（预设对话，F115）全部形状来自 `[Backlog]` 文档，无任何原型证据**
   * （domain 待裁决第 12 条）。
   *
   * 三条语义（下发方向 引导师→组长/组员 · 被下发者能改 · 上架供取用不是推送）
   * 是原型逐字答死的，**不是待裁**；但端口形状（`targets` 三选一、`dispatchId`、
   * `instanceId` 的幂等键）是推的。
   *
   * ⚠ 尤其：`dispatchPreset.out` 刻意**没有** `createdInstanceIds`——
   * 「上架不是推送」这条在契约里就是靠这个缺失表达的。任何人想加它之前请先重读这条。
   */
  C_CHAT_6: "F115 preset shapes are derived from Backlog text with no prototype evidence; only the three dispatch semantics are prototype-confirmed",

  /**
   * **`MODEL_POLICY_VIOLATION` 的判定口径待裁**（domain 第 1 条，🔴）。
   *
   * 契约能表达「含机密时在服务端拒绝」，表达不了「什么算含机密」。
   * `ApprovalDataScope.confidential` 是个 boolean，**谁把它置 true 没有定义**。
   * 裁决前实现方**不得写死**一套判定。
   */
  C_CHAT_7: "MODEL_POLICY_VIOLATION's confidentiality criterion is undecided; ApprovalDataScope.confidential has no defined producer",

  /**
   * **`createApprovalRequest.in` 不携带调用方链信息**（F112，实现中发现）。
   *
   * 六项披露里的「调用链」（domain.md I-28）字面要求 O-36「agent 互调深度上限 2」
   * 能被断言，前提是知道"谁调用了谁"。但 `in` 只有 `{threadId, agentId, action,
   * dataScope, proposedModels, estimatedTokens}`——没有一个字段能表达"这次调用是被
   * 哪个上一层 agent 触发的"。`apps/api/src/application/chat/create-approval-request.ts`
   * 的实现把 `callChain` 恒设为 `[agentId]`，满足 I-28 的"非空"但语义单薄，
   * 是一个已登记的已知简化，不是完整实现。
   */
  C_CHAT_8: "createApprovalRequest.in carries no caller-chain information; O-36's two-level agent call depth cannot be asserted from this shape alone",

  /**
   * **`decideApproval` 的并发语义与幂等重放语义在契约现有输入形状下互不相容**
   * （F112，实现中发现）。
   *
   * `chat.ts` 本文件的注释同时要求：① I-29「并发两次 approve 只有一个生效，
   * 另一个收到状态已变化」；② "同一 (requestId, expectedStatus) 的重复 approve
   * 返回同一 taskId，不产生第二个任务"（幂等重放）。`in` 没有携带任何幂等键
   * （nonce / idempotency-key），单靠 `(requestId, expectedStatus="paused")`
   * 无法区分"同一调用方在重试"与"另一个调用方在竞争"——这两件事在契约现有
   * 输入下是同一个观测。`apps/api/src/application/chat/decide-approval.ts`
   * 取①（domain.md I-29 的"怎么断言"逐条写明的是这一种），未做重试识别；
   * 这是一个已登记的简化，不是对两条注释的调和。
   */
  C_CHAT_9: "decideApproval's concurrency semantics (I-29) and its 'idempotent replay' comment are jointly unsatisfiable without an idempotency key in `in`; the implementation picked I-29 and does not attempt retry detection",

  /**
   * **`landAsArtifact.in` 没有 `agendaSegmentId`，所以 UC-20/21 没有走
   * phase-00 `bindToProjectStep` / `referenceForDownstream`**（F114，实现中发现）。
   *
   * `usecases.md` 逐字要求"三模式绑定与定版调 phase-00 `artifact` 的
   * `bindToProjectStep` / `pinVersion`"、"引用资格门必须是 `referenceForDownstream`
   * 那一个，对话侧不自己判"。但 `bindToProjectStep` 要求一个真实的
   * `agendaSegmentId`（把产出提交到项目议程的某个环节），而本操作的 `in` 只有
   * `{threadId, messageId, mode, title, payloadRef}`——没有这个字段，也没有理由
   * 现在就有：对话里落一条草稿不应该预先决定"这对应项目议程哪一环节"，
   * 更不应该被 `bindToProjectStep` 内部 `group.submitOutput` 的项目角色门槛挡住
   * （会让"组员"这个 uc-8-3 的 Actor 之一连给自己存草稿都不行）。
   *
   * `apps/api/src/application/chat/land-as-artifact.ts` 因此只复用
   * `materializeArtifact`（F04，真实字节与版本血缘），三模式状态与 `checkDownstreamEligibility`
   * 的资格判断（`mode === "pinned"`）落在本束自己的 `chat_artifact_landings` 表，
   * 是一个已登记的简化，不是"同一个门"的完整落地。
   */
  C_CHAT_10: "landAsArtifact.in carries no agendaSegmentId, so UC-20/21 do not route through phase-00 bindToProjectStep/referenceForDownstream; mode-gating is reimplemented on chat's own landing table instead",

  /**
   * **`summarizePersonaFromThread` 已由人类补签**（design-delta `chat-persona-roundtrip`，
   * confirmed 2026-08-18；同 canvas 束 C_CANVAS_8 被 #988 解决后的登记方式——条目不删，
   * 改写为已裁决）。
   *
   * 当年 coord-main 代裁「先做、登记待补签」的两个开放问题，签核裁决为：
   *   ① mode **恒 `draft`，不开放 `live`/`pinned`**；
   *   ② `sufficient: false` 时**维持落「信息不足」占位**，不改为拒绝——让「AI 尝试过、
   *     但线程里没有材料」这件事本身留痕。
   * 同一次签核追加了 `out.resultMessageId` 与「产出以 assistant 消息进入线程、正文为
   * mermaid mindmap 围栏」的行为约定（见操作自身注释），并落地 G1 读回闭环
   * （`listThreadArtifacts.out.items[].messageId` + `getThreadArtifactSource`）。
   */
  C_CHAT_11: "summarizePersonaFromThread is signed off (design-delta chat-persona-roundtrip, confirmed 2026-08-18): mode stays draft-only, insufficient data keeps landing a placeholder instead of rejecting, and the same signoff added out.resultMessageId plus the assistant-message mindmap-fence behavior and the G1 readback loop (items[].messageId + getThreadArtifactSource)",

  /**
   * **`recommendCanvasTemplates` 🟡 待人类补签**（2026-09-06，issue #2825；同 #496/#988/
   * `suggestTemplateSections` 的先例——人类当面交办、实现先行、登记待补签）。
   *
   * 交办原话：「可否变为一个动态的、更具上下文来推荐可视化模板的地方，而不只是用户
   * 画像，比如上面是用户画像，就可以推荐用户旅程图、同理心地图等，主要渲染我们在
   * 后台定义好的画布模板」。落地成两件：canvas 侧模板注册表新增可编辑的
   * `recommendAfter`（`canvas.updateTemplateMetadata`），chat 侧新增本只读操作。
   *
   * ## 签核材料在哪，以及为什么不在这里
   *
   * `phases/phase-01-run-a-project/design-deltas/canvas-template-recommendations/`。
   * **唯一的签核门是那份 `design-signoff.md`**（AGENTS.md「设计签核（三件、一处签）」
   * + ADR-023），`status` 只能由人类改。本条目一度被写成"已签核"——依据只是会话里的
   * 一句口头确认，而机械签核链上没有任何对应记录：那正是本仓「静态痕迹 ≠ 动态事实」
   * 点名的形状（一段写得越笃定的注释，读起来越像权威）。已回退。
   *
   * ## 等人类拍板的两处取舍（实现已按下述先做，改判只需改一处纯函数）
   *
   * ① **推荐是三个梯队依次兜底**（后台配的下一步 → 起点模板 → 其余没画过的），
   *    起点模板之间按出度启发式排序，见 `domain/canvas/template-recommendation.ts`
   *    的两处头注。梯队②③是 2026-09-06 人类实测「第二轮以后就没有了，每一轮都要有
   *    推荐的下一步的动作」之后加的——没有它们，一个没配过任何推荐关系的组织（自建
   *    模板的 `recommend_after` 是空的，内置兜底只对 builtin 行生效）画完第一张画布
   *    之后就再也拿不到任何建议。
   *
   *    替代方案「没配过就不推」（去掉梯队②③）的取舍写在 delta 的 contract.md §5，
   *    一并留在这里免得下一个人重推：对没配过任何推荐关系的组织，**梯队②本身就等于
   *    整个库**（没有边时所有模板入度为 0、全部算起点），所以梯队③只在"已经配了推荐图、
   *    且起点模板都画过了"这一种情况下兜一次底。
   * ② **一次最多推 3 条**（契约上限 4）。建议行里还并排渲染 CopilotKit 的模型追问
   *    建议，两边加起来超过一行会把 composer 顶下去。
   */
  C_CHAT_12: "recommendCanvasTemplates (issue #2825) is a design delta pending human signoff (materials: phases/phase-01-run-a-project/design-deltas/canvas-template-recommendations/, whose design-signoff.md is the only signoff gate): read-only, no model call; recommends canvas templates in three fallback tiers (configured recommendAfter of what the thread drew, then entry templates, then any undrawn published template) so every turn offers a next step; open questions are that tier cascade with its entry out-degree ordering, and the 3-chip display cap",
} as const;

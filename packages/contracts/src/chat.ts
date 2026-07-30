/**
 * 契约束 `chat` — ③ API 契约（**唯一事实源**）
 *
 * ADR-020：这一份生成四样东西（后端 DTO / 前端类型 / OpenAPI / mock），任何一样都不许手写第二份。
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
import { PermissionReason, ProjectRole, VisibilityScope } from "./identity";
import { ArtifactError } from "./artifact";
import { ContextPackReason } from "./context-pack";

/* ─────────────────────────── 枚举（对应 domain.md）─────────────────────────── */

/**
 * 对话可见范围 —— **五值封闭，新增必须走 ADR**（domain I-1 / uc-8-5 R6）。
 *
 * ⚠ **与 `identity.VisibilityScope`（2 值：`org-wide` / `team-only`）同名不同义，
 *   已改名分离，别再合并。** 那一个是**组织层的资源准入**（这份材料对谁开放），
 *   这一个是**一条对话线程的归属范围**（这个线程属于谁的会话空间）。
 *   合并意味着「组员私聊」与「团队可见的材料」共用一个取值集合，
 *   于是任何一侧新增取值都会污染另一侧的判定——本仓已五次因「同一名字两处含义」漂移。
 */
export const ChatVisibility = z.enum([
  "member-private", // 组员私聊：本人 + 本组组长 + 引导师
  "group-shared",   // 本组共享：全组可见
  "plenary",        // 全场：项目内全员
  "team-visible",   // 团队可见：研究阶段，同（组织）团队可见
  "private",        // 私有：研究阶段，仅创建者
]);

/** 线程阶段——决定右栏是否显示转录（uc-8-2 E1） */
export const ThreadPhase = z.enum(["onsite", "research"]);

/** 消息作者类别 */
export const AuthorKind = z.enum(["human", "agent"]);

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

/** 线程卡。研究阶段与现场分组返回**完全一致的字段结构**，只有数据不同（AC1） */
export const ThreadCard = z.object({
  id: z.string(),
  title: z.string(),
  subtitle: z.string(),
  badges: z.array(MessageBadge),
  agentSummary: z.string(),
  lastActivityAt: z.string(),
  visibilityScope: ChatVisibility,
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
      projectId: z.string(),
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
        projectId: z.string(),
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
    }).strict(),
    err: ["NOT_VISIBLE", "AUTHZ_UNAVAILABLE"] as const,
  },

  /**
   * mutateThread —— 新建 / 改名 / 删除。
   * ⚠ 观察者恒无写权（按钮不渲染**且**接口拒绝——两侧都要验收）。
   * ⚠ **并发**（V7）：`expectedVersion` 不匹配即 `VERSION_CHANGED`，**不静默覆盖**。
   * ⚠ **删除是可追溯动作**：返回 `impactScope`，审计必写；**越权尝试也要有安全审计记录**（V8）。
   */
  mutateThread: {
    method: "POST", path: "/chat/threads/mutate",
    in: z.object({
      op: z.enum(["create", "rename", "delete"]),
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
        presence: AgentPresence,
      }).strict()),
      presentCount: z.number().int().nonnegative(),
      rosterCount: z.number().int().nonnegative(),
      marketEntry: z.string().nullable(),
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
        duty: z.string(), presence: AgentPresence,
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
      limit: z.number().int().positive(),
    }).strict(),
    out: z.object({
      messages: z.array(Message), nextCursor: z.string().nullable(),
    }).strict(),
    err: ["NOT_VISIBLE", "AUTHZ_UNAVAILABLE"] as const,
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
      "CITATION_UNRESOLVABLE_REQUIRES_DRAFT", "CITATION_OUT_OF_PACK",
      "STUDIO_RUN_NOT_FOUND", "VERSION_CHANGED", "STORAGE_UNAVAILABLE", "AUDIT_SINK_UNAVAILABLE",
    ] as const,
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
      }).strict()),
    }).strict(),
    err: ["NOT_VISIBLE"] as const,
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
} as const;

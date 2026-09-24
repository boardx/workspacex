/**
 * `chat-knowledge-graph` 契约束 —— zod 单一事实源（签核第 ③ 件）。
 *
 * 权威规格（不重抄正文，只落地形状）：
 *   phases/phase-18-org-brain-knowledge-graph/signoff-draft/chat-knowledge-graph/{domain,usecases,coverage,design-signoff}.md（人类签核后移入 contracts/）
 * 需求：phases/phase-18-org-brain-knowledge-graph/requirements/uc-18-1…uc-18-5
 * 架构：docs/proposals/PROP-ORG-BRAIN-KG-001.md §3、ADR-114（AGE 图投影）
 *
 * ## 覆盖 / 不覆盖
 *
 * 覆盖：会话（L0）与个人空间（L1）两级的知识读取、人工编辑动作、晋升、重新整理，
 * 以及领域枚举（实体类型、结论类型、关系、作用域、三态投影）和封闭错误码。
 *
 * 不覆盖：
 * - 召回本身。召回是 agent run 内部行为，走 `context-pack` 束的 `ContextPack`（`items[].channels`
 *   已有 `graph` / `vector` 两路，本束不另造第二份检索结果形状）。
 * - 删除级联的入口。删除仍走 `chat` / `files` 束各自的操作，本束只实现 `files` 束已声明的
 *   出站端口 `OUTBOUND_PORTS.invalidateOntologyEdges`（usecases.md UC-KG-8）。
 * - `ClaimStatus` 五值。直接复用 `context-pack.ts` 的 `ClaimStatus`，**不建第二份**。
 */
import { z } from "zod";
import { ClaimStatus, FilterAction, RetrievalChannel } from "./context-pack";

type ClaimStatusValue = z.infer<typeof ClaimStatus>;

/* ────────────────────────────────────────────────────────────────────── *
 * 一、领域枚举（domain.md 一）
 * ────────────────────────────────────────────────────────────────────── */

/** 作用域阶梯。本阶段只开放前两级；后三级在对应阶段放开，**枚举成员现在就在**（外扩不改表）。 */
export const KgScopeKind = z.enum(["chat_session", "personal", "project", "org", "platform"]);
export type KgScopeKind = z.infer<typeof KgScopeKind>;

/** Phase 18 允许写入 / 读取的作用域。其余成员在本阶段一律 `KG_SCOPE_NOT_ENABLED`。 */
export const KG_SCOPES_ENABLED_PHASE_18 = ["chat_session", "personal"] as const satisfies readonly KgScopeKind[];

/** 实体类型：封闭枚举（uc-18-1 R7-1、S0-5）。新增走 ADR。 */
export const KgObjectKind = z.enum([
  "person", "organization", "project", "product", "concept", "term", "metric", "event",
]);
export type KgObjectKind = z.infer<typeof KgObjectKind>;

/** 结论类型：封闭枚举（uc-18-1 R7-2、S0-5）。 */
export const KgClaimKind = z.enum(["fact", "hypothesis", "decision", "todo", "risk"]);
export type KgClaimKind = z.infer<typeof KgClaimKind>;

/**
 * 关系：两个封闭枚举，按端点类型分开。
 * - 结论↔结论：uc-9-1 的五类语义（被证据支持 / 可能缩短 / 阻碍 / 硬约束 / 候选方案）。
 * - 结构类：实体与结论之间、以及跨作用域的溯源。
 */
export const KgClaimRelation = z.enum(["supported_by", "may_shorten", "blocks", "hard_constraint", "candidate_for"]);
export type KgClaimRelation = z.infer<typeof KgClaimRelation>;

export const KgStructuralRelation = z.enum(["mentions", "about", "derived_from", "supersedes", "belongs_to", "decided_by"]);
export type KgStructuralRelation = z.infer<typeof KgStructuralRelation>;

export const KgRelation = z.union([KgClaimRelation, KgStructuralRelation]);
export type KgRelation = z.infer<typeof KgRelation>;

/**
 * 决策七态（O-25，PROP-ORG-BRAIN-KG-001 §3.5）：决策类结论在决策流程里的位置。
 * 不是第二个生命周期字段（生命周期只有 `claims.status`）。本阶段不写入，
 * 枚举与数据库列先就位（迁移 20260924180000 的 claims_decision_state_chk 与本枚举逐项对账）。
 */
export const KgDecisionState = z.enum([
  "leading", "discussing", "to_verify", "awaiting_decision", "conflict", "vetoed", "suggested",
]);
export type KgDecisionState = z.infer<typeof KgDecisionState>;

/** 谁产生的：沿用 context-engine `claims.created_by` 三值。 */
export const KgCreatedBy = z.enum(["human", "model", "import"]);
export type KgCreatedBy = z.infer<typeof KgCreatedBy>;

/**
 * 证据视角三态 —— **`ClaimStatus` 的展示投影，不是第二个状态字段**（PROP §3.5、S0-6）。
 * L0 / L1 只用这三态；`superseded` 不渲染。
 */
export const KgTriState = z.enum(["pending", "confirmed", "conflict"]);
export type KgTriState = z.infer<typeof KgTriState>;

/**
 * 三态中文文案，单一事实源（前端不得另建映射表）。
 * 用词来自 `requirements/06-user-experience.md` 第五节「说人话」：界面不出现「待确认 / 三态」这类内部词。
 */
export const KG_TRI_STATE_LABEL_ZH: Record<KgTriState, string> = {
  pending: "AI 记下的",
  confirmed: "你确认过",
  conflict: "有矛盾",
};

/** `ClaimStatus` → 三态。`superseded` 返回 null（不渲染）。唯一实现，前后端共用。 */
export function claimTriState(status: ClaimStatusValue): KgTriState | null {
  switch (status) {
    case "proposed":
    case "reviewed":
      return "pending";
    case "accepted":
      return "confirmed";
    case "contested":
      return "conflict";
    case "superseded":
      return null;
    default: {
      const exhaustive: never = status;
      return exhaustive;
    }
  }
}

/** 入图任务状态（uc-18-1 R3/R4）。 */
export const KgIngestionState = z.enum(["queued", "running", "done", "failed", "rejected"]);
export type KgIngestionState = z.infer<typeof KgIngestionState>;

/* ────────────────────────────────────────────────────────────────────── *
 * 二、值对象（domain.md 二）
 * ────────────────────────────────────────────────────────────────────── */

export const KgScope = z.object({
  kind: KgScopeKind,
  /** chat_session → threadId；personal → userId */
  id: z.string().min(1),
}).strict();
export type KgScope = z.infer<typeof KgScope>;

/** 证据锚点：指回原消息或附件片段（引用完整性，S1）。 */
export const KgEvidenceAnchor = z.object({
  segmentId: z.string(),
  stance: z.enum(["supporting", "contradicting"]),
  sourceKind: z.enum(["chat_message", "attachment"]),
  /** chat_message → messageId；attachment → artifactVersionId */
  sourceRef: z.string(),
  /** 可读摘录（≤ 280 字），不是全文 */
  excerpt: z.string().max(280),
  /** 附件页码 / 时间码等，消息则为 null */
  locator: z.object({
    page: z.number().int().positive().optional(),
    startMs: z.number().int().nonnegative().optional(),
  }).strict().nullable(),
  /** 源已删除 / 撤回（uc-18-5）时为 true —— 此时整条证据不应再被召回 */
  revoked: z.boolean(),
}).strict();
export type KgEvidenceAnchor = z.infer<typeof KgEvidenceAnchor>;

export const KgObject = z.object({
  id: z.string(),
  scope: KgScope,
  kind: KgObjectKind,
  name: z.string().min(1),
  aliases: z.array(z.string()),
  createdBy: KgCreatedBy,
  /** 引用它的有效结论数；0 = 孤立（uc-18-5 A1），不渲染 */
  claimCount: z.number().int().nonnegative(),
}).strict();
export type KgObject = z.infer<typeof KgObject>;

export const KgClaim = z.object({
  id: z.string(),
  scope: KgScope,
  kind: KgClaimKind,
  statement: z.string().min(1),
  status: ClaimStatus,
  /** `claimTriState(status)` 的结果，服务端算好下发；superseded 的结论不下发 */
  triState: KgTriState,
  confidence: z.number().min(0).max(1),
  createdBy: KgCreatedBy,
  reviewedBy: z.string().nullable(),
  supersedesClaimId: z.string().nullable(),
  /** L1 副本指回 L0 原结论（uc-18-4 R7-1）；L0 为 null */
  derivedFromClaimId: z.string().nullable(),
  aboutObjectIds: z.array(z.string()),
  supportingCount: z.number().int().nonnegative(),
  contradictingCount: z.number().int().nonnegative(),
  createdAt: z.string(),
}).strict();
export type KgClaim = z.infer<typeof KgClaim>;

export const KgEdge = z.object({
  id: z.string(),
  src: z.object({ kind: z.enum(["object", "claim"]), id: z.string() }).strict(),
  dst: z.object({ kind: z.enum(["object", "claim"]), id: z.string() }).strict(),
  relation: KgRelation,
  createdBy: KgCreatedBy,
}).strict();
export type KgEdge = z.infer<typeof KgEdge>;

/** 入图进度摘要（知识面板头部的「整理中 / 失败 N 条」） */
export const KgIngestionSummary = z.object({
  queued: z.number().int().nonnegative(),
  running: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  /** 失败条目：源 + 原因，供单条重试 */
  failures: z.array(z.object({
    sourceKind: z.enum(["chat_message", "attachment"]),
    sourceRef: z.string(),
    reason: z.enum(["model_unavailable", "rejected_by_executor", "source_restricted", "retries_exhausted"]),
  }).strict()),
}).strict();
export type KgIngestionSummary = z.infer<typeof KgIngestionSummary>;

/** 编辑动作（uc-18-3 R3），**人的动作**：执行器只接受人类会话调用，Agent 身份一律拒绝。 */
export const KgHumanAction = z.discriminatedUnion("type", [
  z.object({ type: z.literal("confirmClaim"), claimId: z.string() }).strict(),
  /** U-2「全部确认」：批量，逐条语义与 confirmClaim 相同；有一条是冲突态则整批拒绝 */
  z.object({ type: z.literal("confirmClaims"), claimIds: z.array(z.string()).min(1).max(50) }).strict(),
  z.object({ type: z.literal("reviseClaim"), claimId: z.string(), statement: z.string().min(1).max(2000) }).strict(),
  z.object({ type: z.literal("revokeClaim"), claimId: z.string(), reason: z.string().max(500).optional() }).strict(),
  z.object({ type: z.literal("markContested"), claimIds: z.tuple([z.string(), z.string()]) }).strict(),
  /**
   * U-5 矛盾提醒卡的三个出口（uc-18-6 D）：
   * - keep_new：旧条目被新条目取代（supersedes）
   * - keep_both：两条都留，各写一句适用条件，结束冲突态
   * - ignore：保持冲突态，但同一对不再提醒
   */
  z.object({
    type: z.literal("resolveConflict"),
    promptId: z.string(),
    resolution: z.enum(["keep_new", "keep_both", "ignore"]),
    conditions: z.object({ newer: z.string().max(200), older: z.string().max(200) }).strict().optional(),
  }).strict(),
  z.object({ type: z.literal("mergeObjects"), keepObjectId: z.string(), mergeObjectId: z.string() }).strict(),
  z.object({ type: z.literal("splitObject"), objectId: z.string(), newName: z.string().min(1), moveClaimIds: z.array(z.string()).min(1) }).strict(),
  z.object({ type: z.literal("renameObject"), objectId: z.string(), name: z.string().min(1).max(200) }).strict(),
]);
export type KgHumanAction = z.infer<typeof KgHumanAction>;

/** 晋升逐条结果（uc-18-4 R3-5 / R4-E4：部分成功，不整批回滚） */
export const KgPromotionItemResult = z.discriminatedUnion("outcome", [
  z.object({ claimId: z.string(), outcome: z.literal("promoted"), personalClaimId: z.string() }).strict(),
  z.object({ claimId: z.string(), outcome: z.literal("merged_into_existing"), personalClaimId: z.string() }).strict(),
  z.object({ claimId: z.string(), outcome: z.literal("coexisting"), personalClaimId: z.string() }).strict(),
  z.object({ claimId: z.string(), outcome: z.literal("needs_choice"), existingPersonalClaimId: z.string() }).strict(),
  z.object({ claimId: z.string(), outcome: z.literal("rejected"), code: z.lazy(() => KgPromotionRejectCode) }).strict(),
]);
export type KgPromotionItemResult = z.infer<typeof KgPromotionItemResult>;

/** U-6 可见范围（界面文案见 KG_VISIBILITY_LABEL_ZH） */
export const KgVisibility = z.enum(["owner_only", "thread_members"]);
export type KgVisibility = z.infer<typeof KgVisibility>;
export const KG_VISIBILITY_LABEL_ZH: Record<KgVisibility, string> = {
  owner_only: "仅你可见",
  thread_members: "会话成员可见",
};

/** U-5 矛盾提醒（uc-18-6 D）。一轮最多一张（R7-3）；被 ignore 的同一对不再出现 */
export const KgConflictPrompt = z.object({
  promptId: z.string(),
  newerClaim: z.object({ id: z.string(), statement: z.string() }).strict(),
  olderClaim: z.object({ id: z.string(), statement: z.string(), saidAt: z.string() }).strict(),
}).strict();
export type KgConflictPrompt = z.infer<typeof KgConflictPrompt>;

/**
 * U-4 对话里的「记住 / 忘掉」确认卡（uc-18-6 A/B）。
 * **Agent 只生成卡片，不执行**：执行只经 `actOnMemoryCard`，身份是点击的人（I-15）。
 */
export const KgMemoryCard = z.object({
  cardId: z.string(),
  kind: z.enum(["remember", "forget"]),
  items: z.array(z.object({
    /** remember 且内容尚未入图时为 null（执行时按 statement 新建一条 human 结论） */
    claimId: z.string().nullable(),
    statement: z.string().min(1).max(2000),
  }).strict()).min(1).max(20),
  state: z.enum(["open", "done", "dismissed", "stale"]),
}).strict();
export type KgMemoryCard = z.infer<typeof KgMemoryCard>;

/**
 * 本轮回答用到的一条记忆（uc-18-2 R8 引用 chip 与「为什么用到它」、uc-18-4 R3-6「来自你 {日期} 的对话」）。
 * 读取时按查看者重新过滤：只返回现在仍然有效、且查看者本人看得到的条目。
 * `graphPath` 是召回实际走过的边，端点已换成可读名字；任何一端对查看者不可见时整条为 null。
 */
export const KgRecalledMemory = z.object({
  claimId: z.string(),
  statement: z.string(),
  triState: KgTriState,
  scope: z.enum(["chat_session", "personal"]),
  /** 这条最早被说出来的时间（ISO）；个人空间的条目界面显示为「来自你 {日期} 的对话」 */
  saidAt: z.string().nullable(),
  channels: z.array(RetrievalChannel),
  retrievalReasons: z.array(FilterAction),
  score: z.number(),
  graphPath: z.array(z.object({ from: z.string(), relation: KgRelation, to: z.string() }).strict()).nullable(),
}).strict();
export type KgRecalledMemory = z.infer<typeof KgRecalledMemory>;

/** U-1 回答下方的单行「已记下 N 条 · 查看 · 撤销」，加上本轮的主动卡片（最多一张，E8） */
export const KgTurnMemory = z.object({
  messageId: z.string(),
  captured: z.array(z.object({ claimId: z.string(), statement: z.string() }).strict()),
  /** 仍在整理中 —— 界面显示「正在记…」，不阻塞正文 */
  pending: z.boolean(),
  prompt: z.discriminatedUnion("type", [
    z.object({ type: z.literal("conflict"), conflict: KgConflictPrompt }).strict(),
    z.object({ type: z.literal("memory_card"), card: KgMemoryCard }).strict(),
  ]).nullable(),
  /** 本轮回答用到的记忆（按召回名次）；没用到记忆时为空数组 */
  recalled: z.array(KgRecalledMemory),
  /** 本轮计划走关联查询（图）但它没能执行：界面显示「这次没能查全你的记忆…」那一行（R4-E1） */
  recallDegraded: z.boolean(),
}).strict();
export type KgTurnMemory = z.infer<typeof KgTurnMemory>;

/**
 * 「大脑」页（/brain）的一行会话记忆概况：本人的一个会话里记下了多少、有多少待确认 / 有矛盾。
 * 只有计数与会话标题，不带结论正文——正文照旧从 `getThreadKnowledge` 读（同一道可见性判定）。
 */
export const KgThreadKnowledgeSummary = z.object({
  threadId: z.string(),
  /** null = 个人线程 */
  projectId: z.string().nullable(),
  title: z.string(),
  lastActivityAt: z.string(),
  /** 活结论总数（= pending + confirmed + conflict） */
  claims: z.number().int().nonnegative(),
  pending: z.number().int().nonnegative(),
  confirmed: z.number().int().nonnegative(),
  conflict: z.number().int().nonnegative(),
  /** 有活结论引用的实体数 */
  objects: z.number().int().nonnegative(),
}).strict();
export type KgThreadKnowledgeSummary = z.infer<typeof KgThreadKnowledgeSummary>;

/**
 * 个人空间（L1）一条结论是从哪个会话记过来的（derived_from → L0 原结论所在会话）。
 * 只列查看者**现在**仍看得到的会话；一条 L1 结论合并过多个会话时有多行。
 */
export const KgPersonalClaimOrigin = z.object({
  personalClaimId: z.string(),
  /** 会话里的原结论（L0）——跳回会话后据此打开它的来源抽屉 */
  sourceClaimId: z.string(),
  threadId: z.string(),
  projectId: z.string().nullable(),
  threadTitle: z.string(),
}).strict();
export type KgPersonalClaimOrigin = z.infer<typeof KgPersonalClaimOrigin>;

/** 大脑页最多列出的会话数（按最近活动倒序）。 */
export const KG_BRAIN_THREADS_LIMIT = 50;

/* ────────────────────────────────────────────────────────────────────── *
 * 三、封闭错误码（usecases.md 各 UC 的 err 行）
 * ────────────────────────────────────────────────────────────────────── */

export const KgErrorCode = z.enum([
  "KG_THREAD_NOT_FOUND",
  "KG_NOT_VISIBLE",
  "KG_NOT_OWNER",
  "KG_REVISION_CHANGED",
  "KG_CLAIM_NOT_FOUND",
  "KG_OBJECT_NOT_FOUND",
  "KG_CONTESTED_NEEDS_RESOLUTION",
  "KG_ACTOR_NOT_HUMAN",
  "KG_SCOPE_NOT_PERSONAL",
  "KG_SCOPE_NOT_ENABLED",
  "KG_EVIDENCE_REVOKED",
  "KG_PROMOTE_BATCH_TOO_LARGE",
  "KG_REINDEX_ALREADY_RUNNING",
  "KG_CARD_NOT_FOUND",
  "KG_CARD_STALE",
  "KG_PROMPT_NOT_FOUND",
]);
export type KgErrorCode = z.infer<typeof KgErrorCode>;

/** 晋升逐条拒绝码 —— `KgErrorCode` 的子集（同一失败同一个码，不另起名）。 */
export const KgPromotionRejectCode = KgErrorCode.extract([
  "KG_EVIDENCE_REVOKED",
  "KG_CONTESTED_NEEDS_RESOLUTION",
  "KG_CLAIM_NOT_FOUND",
]);
export type KgPromotionRejectCode = z.infer<typeof KgPromotionRejectCode>;

export const KgError = z.object({ code: KgErrorCode, message: z.string() }).strict();

/** 单次晋升上限（uc-18-4 R9） */
export const KG_PROMOTE_MAX_BATCH = 50;

/** 图视图单次最多渲染节点数（uc-18-3 R3-1），超出折叠为簇 */
export const KG_GRAPH_VIEW_MAX_NODES = 200;

/* ────────────────────────────────────────────────────────────────────── *
 * 四、API 操作（usecases.md UC-KG-1 … UC-KG-7）
 * ────────────────────────────────────────────────────────────────────── */

export const knowledgeGraph = {
  /** UC-KG-1：读本会话知识（列表 + 图共用同一份读模型） */
  getThreadKnowledge: {
    method: "GET", path: "/knowledge-graph/threads/:threadId",
    in: z.object({ threadId: z.string() }).strict(),
    out: z.object({
      scope: KgScope,
      revision: z.number().int().nonnegative(),
      objects: z.array(KgObject),
      claims: z.array(KgClaim),
      edges: z.array(KgEdge),
      ingestion: KgIngestionSummary,
      /** 调用者是否会话所有者 —— 前端据此渲染编辑入口（非所有者只读，uc-18-3 R5） */
      canEdit: z.boolean(),
      /** 会话是否个人线程 —— 前端据此渲染「存入个人空间」（uc-18-4 E2） */
      canPromote: z.boolean(),
      /** U-6：面板头部常驻的可见范围说明 —— 仅你可见 / 会话成员可见 */
      visibility: KgVisibility,
    }).strict(),
    err: ["KG_THREAD_NOT_FOUND", "KG_NOT_VISIBLE"] as const,
  },

  /** UC-KG-2：读一条结论的来源（来源抽屉） */
  getClaimSources: {
    method: "GET", path: "/knowledge-graph/claims/:claimId/sources",
    in: z.object({ claimId: z.string() }).strict(),
    out: z.object({
      claim: KgClaim,
      evidence: z.array(KgEvidenceAnchor),
      provenance: z.array(z.object({
        at: z.string(),
        actor: z.object({ kind: z.enum(["human", "system"]), id: z.string() }).strict(),
        action: z.string(),
        pipelineVersion: z.string().nullable(),
      }).strict()),
    }).strict(),
    err: ["KG_CLAIM_NOT_FOUND", "KG_NOT_VISIBLE"] as const,
  },

  /** UC-KG-3：人工编辑动作（确认 / 改写 / 删除 / 标冲突 / 合并 / 拆分 / 改名） */
  applyHumanAction: {
    method: "POST", path: "/knowledge-graph/threads/:threadId/actions",
    in: z.object({
      threadId: z.string(),
      basedOnRevision: z.number().int().nonnegative(),
      action: KgHumanAction,
    }).strict(),
    out: z.object({
      revision: z.number().int().nonnegative(),
      /** 本动作写入的 `ontology_actions` 行 id（审计可查） */
      actionId: z.string(),
    }).strict(),
    err: [
      "KG_THREAD_NOT_FOUND", "KG_NOT_VISIBLE", "KG_NOT_OWNER", "KG_ACTOR_NOT_HUMAN",
      "KG_REVISION_CHANGED", "KG_CLAIM_NOT_FOUND", "KG_OBJECT_NOT_FOUND", "KG_CONTESTED_NEEDS_RESOLUTION",
      "KG_PROMPT_NOT_FOUND",
    ] as const,
  },

  /** UC-KG-4：重新整理本会话 / 重试失败条目 */
  requestReindex: {
    method: "POST", path: "/knowledge-graph/threads/:threadId/reindex",
    in: z.object({
      threadId: z.string(),
      /** 省略 = 整个会话；给出 = 只重试这些源 */
      sourceRefs: z.array(z.string()).optional(),
    }).strict(),
    out: z.object({ queued: z.number().int().nonnegative() }).strict(),
    err: ["KG_THREAD_NOT_FOUND", "KG_NOT_VISIBLE", "KG_NOT_OWNER", "KG_REINDEX_ALREADY_RUNNING"] as const,
  },

  /**
   * UC-KG-5：晋升到个人空间（L0 → L1，复制 + derived_from 连边）。
   * U-3：「AI 记下的」（proposed / reviewed）也可以晋升——人点这个按钮本身就算确认，
   * 同一个人的同一个动作里先 confirm 再 promote。仍然拒绝：冲突态、来源已删。
   */
  promoteToPersonal: {
    method: "POST", path: "/knowledge-graph/threads/:threadId/promote",
    in: z.object({
      threadId: z.string(),
      claimIds: z.array(z.string()).min(1).max(KG_PROMOTE_MAX_BATCH),
      /** 对 `needs_choice` 的条目给出的选择；首次调用通常为空 */
      choices: z.array(z.object({
        claimId: z.string(),
        choice: z.enum(["merge", "coexist"]),
      }).strict()).optional(),
    }).strict(),
    out: z.object({ results: z.array(KgPromotionItemResult) }).strict(),
    err: [
      "KG_THREAD_NOT_FOUND", "KG_NOT_VISIBLE", "KG_NOT_OWNER", "KG_ACTOR_NOT_HUMAN",
      "KG_SCOPE_NOT_PERSONAL", "KG_PROMOTE_BATCH_TOO_LARGE",
    ] as const,
  },

  /** UC-KG-6：AI 提名「值得记住」（只提名，不执行；uc-18-4 A1） */
  listPromotionNominations: {
    method: "GET", path: "/knowledge-graph/threads/:threadId/nominations",
    in: z.object({ threadId: z.string() }).strict(),
    out: z.object({
      nominations: z.array(z.object({
        claimId: z.string(),
        rationale: z.string().max(280),
      }).strict()),
    }).strict(),
    err: ["KG_THREAD_NOT_FOUND", "KG_NOT_VISIBLE", "KG_NOT_OWNER", "KG_SCOPE_NOT_PERSONAL"] as const,
  },

  /** UC-KG-11：一轮回答的记忆摘要（U-1 已记下 N 条 + U-4/U-5 主动卡片） */
  getTurnMemory: {
    method: "GET", path: "/knowledge-graph/threads/:threadId/messages/:messageId/memory",
    in: z.object({ threadId: z.string(), messageId: z.string() }).strict(),
    out: KgTurnMemory,
    err: ["KG_THREAD_NOT_FOUND", "KG_NOT_VISIBLE"] as const,
  },

  /** UC-KG-12：对「记住 / 忘掉」确认卡做决定（人的动作；Agent 身份拒绝） */
  actOnMemoryCard: {
    method: "POST", path: "/knowledge-graph/cards/:cardId",
    in: z.object({
      cardId: z.string(),
      decision: z.enum(["accept", "dismiss"]),
      /** forget 卡：用户取消勾选后剩下的条目；省略 = 卡上全部 */
      claimIds: z.array(z.string()).optional(),
      /** remember 卡：用户改过的文字；省略 = 卡上原文 */
      editedStatement: z.string().min(1).max(2000).optional(),
    }).strict(),
    out: z.object({ card: KgMemoryCard, actionIds: z.array(z.string()) }).strict(),
    err: ["KG_CARD_NOT_FOUND", "KG_CARD_STALE", "KG_NOT_OWNER", "KG_ACTOR_NOT_HUMAN", "KG_CONTESTED_NEEDS_RESOLUTION"] as const,
  },

  /** UC-KG-7：读本人个人空间（L1）的知识 —— 只有本人 */
  getPersonalKnowledge: {
    method: "GET", path: "/knowledge-graph/personal",
    in: z.object({}).strict(),
    out: z.object({
      scope: KgScope,
      revision: z.number().int().nonnegative(),
      objects: z.array(KgObject),
      claims: z.array(KgClaim),
      edges: z.array(KgEdge),
    }).strict(),
    /** 调用者不是（或已不是）当前组织成员（HTTP 403）。空间里没有内容不是错误，返回空。 */
    err: ["KG_NOT_VISIBLE"] as const,
  },

  /**
   * UC-KG-13 大脑页（/brain）概况：本人创建的、记下了知识的会话（每个会话一行计数），
   * 以及个人空间结论各自来自哪个会话。只读聚合；每个会话逐个经会话可见性判定，
   * 看不见的会话（被移出项目等）不出现。2026-09-24 人类指令「取消所有的 mockup 的数据」。
   * `err` 为空：不是组织成员时每个会话都判为不可见 ⇒ 返回空的两个数组，不是错误
   * （判定依赖不可用时同全束一样是 503，不在业务错误码里）。
   */
  getBrainOverview: {
    method: "GET", path: "/knowledge-graph/me/overview",
    in: z.object({}).strict(),
    out: z.object({
      threads: z.array(KgThreadKnowledgeSummary).max(KG_BRAIN_THREADS_LIMIT),
      personalOrigins: z.array(KgPersonalClaimOrigin),
    }).strict(),
    err: [] as const,
  },
} as const;

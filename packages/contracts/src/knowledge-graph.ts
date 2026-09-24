/**
 * `chat-knowledge-graph` 契约束 —— zod 单一事实源（签核第 ③ 件）。
 *
 * 权威规格（不重抄正文，只落地形状）：
 *   phases/phase-18-org-brain-knowledge-graph/contracts/chat-knowledge-graph/{domain,usecases,coverage,design-signoff}.md
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
import { ClaimStatus } from "./context-pack";

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

/** 谁产生的：沿用 context-engine `claims.created_by` 三值。 */
export const KgCreatedBy = z.enum(["human", "model", "import"]);
export type KgCreatedBy = z.infer<typeof KgCreatedBy>;

/**
 * 证据视角三态 —— **`ClaimStatus` 的展示投影，不是第二个状态字段**（PROP §3.5、S0-6）。
 * L0 / L1 只用这三态；`superseded` 不渲染。
 */
export const KgTriState = z.enum(["pending", "confirmed", "conflict"]);
export type KgTriState = z.infer<typeof KgTriState>;

/** 三态中文文案，单一事实源（前端不得另建映射表）。 */
export const KG_TRI_STATE_LABEL_ZH: Record<KgTriState, string> = {
  pending: "待确认",
  confirmed: "已确认",
  conflict: "冲突",
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
  z.object({ type: z.literal("reviseClaim"), claimId: z.string(), statement: z.string().min(1).max(2000) }).strict(),
  z.object({ type: z.literal("revokeClaim"), claimId: z.string(), reason: z.string().max(500).optional() }).strict(),
  z.object({ type: z.literal("markContested"), claimIds: z.tuple([z.string(), z.string()]) }).strict(),
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
  "KG_PROMOTE_REQUIRES_ACCEPTED",
  "KG_EVIDENCE_REVOKED",
  "KG_PROMOTE_BATCH_TOO_LARGE",
  "KG_REINDEX_ALREADY_RUNNING",
]);
export type KgErrorCode = z.infer<typeof KgErrorCode>;

/** 晋升逐条拒绝码 —— `KgErrorCode` 的子集（同一失败同一个码，不另起名）。 */
export const KgPromotionRejectCode = KgErrorCode.extract([
  "KG_PROMOTE_REQUIRES_ACCEPTED",
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

  /** UC-KG-5：晋升到个人空间（L0 → L1，复制 + derived_from 连边） */
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
    err: [] as const,
  },
} as const;

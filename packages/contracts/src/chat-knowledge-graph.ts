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
/** 项目中枢 R7（2026-09-27，用户直接交办）放开第三级 `project`（L2）：项目线程的结论可晋升到项目记忆、项目内对话可召回。 */
/** B2-S4（issue #4428）放开第四级 `org`（L3）：组织 lead / admin 可把项目记忆晋升到组织记忆，组织成员可读。 */
export const KG_SCOPES_ENABLED_PHASE_18 = ["chat_session", "personal", "project", "org"] as const satisfies readonly KgScopeKind[];

/** 实体类型：封闭枚举（uc-18-1 R7-1、S0-5）。新增走 ADR。 */
export const KgObjectKind = z.enum([
  "person", "organization", "project", "product", "concept", "term", "metric", "event",
]);
export type KgObjectKind = z.infer<typeof KgObjectKind>;

/**
 * 结论类型：封闭枚举（uc-18-1 R7-2、S0-5）。
 *
 * issue #4343（人类决定 2026-09-27）加 `goal` / `preference` 两类：用户**本人**明确说出的目标 / 意图
 * （「我的目标是…」「我想…」「我希望…」）与偏好（「我更喜欢…」）。之前的五类里没有它们，于是「我的目标是探索
 * 未来教育」抽取跑完一条都没记下。分成两类而不是合一：界面标签（目标 / 偏好）与模型判别都更清楚，
 * 数据库 CHECK（迁移 20260927310000）与本枚举逐项对账。
 */
export const KgClaimKind = z.enum(["fact", "hypothesis", "decision", "todo", "risk", "goal", "preference"]);
export type KgClaimKind = z.infer<typeof KgClaimKind>;
/**
 * 结论种类的中文文案，单一事实源（用词表：结论 → 事实 / 猜测 / 决定 / 待办 / 风险 / 目标 / 偏好）。前端面板与
 * 「你记得我什么」的分组、后端给模型的记忆清单（#4361）都用这一份，不另建映射表。
 */
export const KG_CLAIM_KIND_LABEL_ZH: Record<KgClaimKind, string> = {
  fact: "事实",
  hypothesis: "猜测",
  decision: "决定",
  todo: "待办",
  risk: "风险",
  // issue #4343：本人说的目标 / 意图、偏好
  goal: "目标",
  preference: "偏好",
};
/**
 * 按种类分组显示 / 计数的先后（会话记忆面板、/brain 与「你记得我什么」同一个次序）：决定最先，其次本人的目标、
 * 偏好，再是事实……漏排一个类型 = 那一类永远不渲染（#4343 之前的五值表就会这样吞掉目标）；单测拿枚举逐项核对。
 */
export const KG_CLAIM_KIND_DISPLAY_ORDER: readonly KgClaimKind[] = ["decision", "goal", "preference", "fact", "todo", "risk", "hypothesis"];

/**
 * issue #4363（S6）：待办的状态。只有 `kind = todo` 的结论有（其余为 null）；新记下的待办是 open。
 * 数据库 CHECK（迁移 20260928170000 claims_todo_state_chk）与本枚举逐项对账。
 */
export const KgTodoStatus = z.enum(["open", "done", "dropped"]);
export type KgTodoStatus = z.infer<typeof KgTodoStatus>;

/** 待办状态的界面文案（单源，同 KG_TRI_STATE_LABEL_ZH）。 */
export const KG_TODO_STATUS_LABEL_ZH: Record<KgTodoStatus, string> = {
  open: "还没做",
  done: "做完了",
  dropped: "不做了",
};

/**
 * issue #4343：「本人意向类」结论——作者本人说的会自动记进本人个人空间（同 #4283 的决定），并在每一轮强制召回
 * （同 #4181 的决定，名额另计）。唯一事实源：抽取、自动复制、召回都从这里判，不各写一份。
 */
export const KG_SELF_INTENT_CLAIM_KINDS = ["goal", "preference"] as const satisfies readonly KgClaimKind[];
export function isSelfIntentClaimKind(kind: KgClaimKind | null | undefined): boolean {
  return kind != null && (KG_SELF_INTENT_CLAIM_KINDS as readonly KgClaimKind[]).includes(kind);
}

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
  /**
   * issue #4363（S6）：有效期的终点（ISO，左闭右开：到这一刻就不再成立）；长期有效为 null。
   * 抽取时由原话里的时间说法（「这周」「到年底」）换算。可选：旧客户端 / 不带时间维度的读口省略。
   */
  validUntil: z.string().nullable().optional(),
  /** issue #4363（S6）：服务端按读的那一刻算好的「已过期」（validUntil 已过）。过期的仍在列表里（标「已过期」），只是不再被召回。 */
  expired: z.boolean().optional(),
  /** issue #4363（S6）：待办状态（只有 kind = todo 有）；其余类别为 null。 */
  todoStatus: KgTodoStatus.nullable().optional(),
  /** issue #4363（S6）：待办的截止日期（ISO，左闭右开）；没说截止为 null。 */
  dueAt: z.string().nullable().optional(),
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
  /**
   * Issue #4290：撤销一次「明确改口」的自动取代（`KgSupersedeNotice` 那一行的「撤销」）。
   * 旧决定恢复为生效、新决定仍在；同一条新决定之后不会再被自动取代。
   */
  z.object({ type: z.literal("undoSupersede"), noticeId: z.string() }).strict(),
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

/**
 * U-5 矛盾提醒（uc-18-6 D）。一轮最多一张（R7-3）；被 ignore 的同一对不再出现。
 * `kind`（issue #4290，人类决定 2026-09-26「高把握自动、低把握弹卡」）：
 * - `conflict`：F16 的矛盾提醒——两条已转「有矛盾」，三个出口 keep_new / keep_both（各写适用条件）/ ignore；
 * - `possible_change`：本人低把握的改口（只有框架动词相同）——卡上问「用〈新〉取代〈旧〉？」，两条都**不改状态**、
 *   照常召回，直到人选：[取代] = `keep_new`，[两条都保留] = `keep_both`（不带 conditions，只关卡）；界面上不给 ignore
 *   （直接调用时同样只关卡、两条状态不动）。
 */
export const KgConflictPromptKind = z.enum(["conflict", "possible_change"]);
export type KgConflictPromptKind = z.infer<typeof KgConflictPromptKind>;
export const KgConflictPrompt = z.object({
  promptId: z.string(),
  kind: KgConflictPromptKind,
  newerClaim: z.object({ id: z.string(), statement: z.string() }).strict(),
  olderClaim: z.object({ id: z.string(), statement: z.string(), saidAt: z.string() }).strict(),
}).strict();
export type KgConflictPrompt = z.infer<typeof KgConflictPrompt>;

/**
 * Issue #4290（人类决定 2026-09-26）：本人明确改口（「改成 / 换成 / 不再……」）时，新决定自动取代本人主题相同的旧决定。
 * 会话里显示一行「已用〈新〉取代〈旧〉 · 撤销」；撤销（`applyHumanAction{undoSupersede}`）后旧决定恢复，读作 `undone`。
 * 只给看得到两条结论的人（旧决定在个人空间时只有本人）。
 */
export const KgSupersedeNotice = z.object({
  noticeId: z.string(),
  newerClaim: z.object({ id: z.string(), statement: z.string() }).strict(),
  olderClaim: z.object({ id: z.string(), statement: z.string() }).strict(),
  state: z.enum(["applied", "undone"]),
}).strict();
export type KgSupersedeNotice = z.infer<typeof KgSupersedeNotice>;

/**
 * U-4 对话里的「记住 / 忘掉」确认卡（uc-18-6 A/B）。
 * **Agent 只生成卡片，不执行**：执行只经 `actOnMemoryCard`，身份是点击的人（I-15）。
 *
 * Issue #4361（phase-18 S4「在对话里管理记忆」，**待签核、先按已批准执行**，见 evidence/phase-18/r10/README.md）：
 * - `kind = overview`：「你记得我什么」——本人个人空间里的记忆清单（最多 20 条），按种类分组显示、每条带来源会话；
 *   没有任何动作（`actOnMemoryCard` 对它答 KG_INVALID_REQUEST），`state` 恒为 open；读的时候按现在的事实过滤（忘掉的不再列）。
 *   这种卡的条目带 `claimKind` 与 `source`；其余两种卡不带。
 * - `state = undone`：忘掉卡生效之后点了「撤销」（`undoMemoryCard`），忘掉的那些已恢复。
 * - 忘掉卡与 overview 卡只在请求者本人的个人线程里出现，条目只来自本人个人空间（长期记忆 + 本人全部个人线程），
 *   不碰项目层与别人的记忆。
 */
export const KgMemoryCard = z.object({
  cardId: z.string(),
  kind: z.enum(["remember", "forget", "overview"]),
  items: z.array(z.object({
    /** remember 且内容尚未入图时为 null（执行时按 statement 新建一条 human 结论） */
    claimId: z.string().nullable(),
    statement: z.string().min(1).max(2000),
    /** overview：这条记忆的种类（界面按它分组） */
    claimKind: KgClaimKind.optional(),
    /** overview：这条记忆来自本人的哪个对话（跳过去看原话）；来源对话已不在 / 看不到 ⇒ null */
    source: z.object({ threadId: z.string(), title: z.string() }).strict().nullable().optional(),
  }).strict()).min(1).max(20),
  state: z.enum(["open", "done", "dismissed", "stale", "undone"]),
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
  /** issue #4343：引用 chip 上标类型（目标 / 偏好 / 决定 …）；库里 claim_kind 为空的旧行按 fact。 */
  kind: KgClaimKind,
  triState: KgTriState,
  /** S10（#4367）起含 `project`：项目会话里用到的项目记忆（全体项目成员可见）。 */
  scope: z.enum(["chat_session", "personal", "project"]),
  /** 这条最早被说出来的时间（ISO）；个人空间的条目界面显示为「来自你 {日期} 的对话」 */
  saidAt: z.string().nullable(),
  /**
   * S10（#4367）：项目记忆里由某人从**个人记忆**分享来的那条 ⇒ 分享人的显示名（没有显示名为空串，界面说「项目成员」），
   * 界面标「由 X 分享自个人记忆」；其余（本会话、个人空间、从项目对话记进项目大脑的）省略或 null。
   */
  sharedByName: z.string().nullable().optional(),
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
  /** #4290：这一轮的改口取代提示（一行，不是卡片，不占 `prompt` 的名额）；没有为 null */
  supersede: KgSupersedeNotice.nullable(),
  /** 本轮回答用到的记忆（按召回名次）；没用到记忆时为空数组 */
  recalled: z.array(KgRecalledMemory),
  /** 本轮计划走关联查询（图）但它没能执行：界面显示「这次没能查全你的记忆…」那一行（R4-E1） */
  recallDegraded: z.boolean(),
  /**
   * S7（#4364，待签核：按已批准处理、事后补签）：这条回答**真的用到了**的那几条（引用 chip），按召回名次。
   * 服务端对账：恒为 `recalled[].claimId` 的子集——模型在回答里提到的、却不在本轮召回集合里的说法不会出现在这里
   * （判据见 apps/api/src/domain/knowledge-graph/citation.ts）。可省略只为兼容 S7 之前的读者：省略 ⇒ 按 `recalled` 全部。
   */
  cited: z.array(z.string()).optional(),
  /**
   * S7 review F6：查看者能不能在这一轮的引用上点「这条不对」/「已过时」——是这条对话的所有者、**且**是这一轮的提问人
   * （服务端 `correctCitation` 同一判据）。这是「这一轮」的判据，不是每一条的：能不能改某一条还看它的作用域——
   * 本对话的、查看者本人长期记忆 / 本人其他个人对话的可以改；项目 / 组织记忆（L2 / L3）不能在这里改（服务端拒）。
   * 今天 `recalled` 只会出现前两种（读侧 `readTurnRecall` 的可见性过滤不放 L2 / L3），界面仍按作用域再挡一次
   * （`CITATION_CORRECTABLE_SCOPES`），免得日后召回里放进了 L2 / L3 却给出点了会被拒的按钮（delta review L5）。
   * 省略 ⇒ 按 false（不给入口，免得点了被拒）。
   */
  canCorrect: z.boolean().optional(),
}).strict();
export type KgTurnMemory = z.infer<typeof KgTurnMemory>;

/**
 * S7（#4364）：回答下引用 chip 上的两个纠正动作（只给对话所有者、且是这一轮的提问人）。
 * - `wrong`「这条不对」：没给 `replacement` ⇒ 忘掉（同 F17 忘掉卡的效果）；给了 ⇒ 用新说法取代旧的（旧的不再召回）。
 * - `expired`「已过时」：这条过期了（`expireClaim`）。S6（#4363）的 `valid_until` 落地前，按撤回执行。
 * 两种都记一条纠正事件：纠正率 = 纠正次数 / 被引用次数（`getCitationMetrics`）。
 */
export const KgCitationCorrectionKind = z.enum(["wrong", "expired"]);
/** 引用 chip 上能被纠正的结论作用域（`KgRecalledMemory.scope`）；其余一律不给纠正入口（服务端同样拒）。 */
export const CITATION_CORRECTABLE_SCOPES = ["chat_session", "personal"] as const satisfies readonly KgRecalledMemory["scope"][];
export type KgCitationCorrectionKind = z.infer<typeof KgCitationCorrectionKind>;

/**
 * issue #4180 —— 这条消息（用户自己发的那条）刚被抽取出的、还活着的结论：发送下方
 * 「已记下：{claim 摘要} · 撤销」的信号源。与 `KgTurnMemory.captured` 不是一件事——那个键在
 * **回答**下方、按「回答 + 它前面紧邻的用户消息」这一整轮算；这个键在**发送的那条消息自己**
 * 下方，只认这一条消息自己的证据（不做「向前找最近一条人类消息」的扩展匹配）。没有新结论（含
 * 抽取关闭 / 未配置、还没抽完、抽出的东西已撤销或被取代）⇒ 空数组，不是错误。
 */
export const KG_MESSAGE_EXTRACTION_STATUSES = ["pending", "written", "empty", "skipped", "failed", "none"] as const;
export type KgMessageExtractionStatus = (typeof KG_MESSAGE_EXTRACTION_STATUSES)[number];

export const KgMessageExtraction = z.object({
  claims: z.array(z.object({
    claimId: z.string(),
    statement: z.string(),
    /** issue #4343：反馈条上标类型（「已记下 · 目标：…」）；库里 claim_kind 为空的旧行按 fact。 */
    kind: KgClaimKind,
    /**
     * issue #4283（人类决定 2026-09-26）：这条是作者本人说的「决定」（#4343 起也含目标 / 偏好），已自动记进**请求者本人**的个人空间，
     * 且那一份仍是「AI 记下的」（未确认）——反馈条显示「已记入个人记忆」、撤销走 `undoAutoPersonalCopy`。
     * 其余情况（不是决定类、不是请求者本人说的、副本已撤销 / 已确认、看的人不是作者）⇒ null。
     */
    personalCopyClaimId: z.string().nullable(),
  }).strict()),
  /**
   * issue #4352（人类决定 2026-09-27；**契约字段先行实现、签核后补**，见 evidence/phase-18/r10/README.md §3.2）：
   * 这条消息的抽取走到哪了。发送下方「这句没有需要记的 · 记一条」只在 `empty` 且 `claims` 为空时出现。
   * - `pending`  还在队列里（排队 / 进行中 / 退避中）；
   * - `written`  抽出了东西（可能已被撤销，所以 `claims` 仍可能为空）；
   * - `empty`    抽完了，没有可记的；
   * - `skipped`  有意不抽（项目会话里用过个人记忆的那一轮 agent 回答，#4284）；
   * - `failed`   重试次数用完；
   * - `none`     从没排进抽取（抽取关着时发的、原始转录、比会话更窄的可见范围……），或消息不在。
   */
  status: z.enum(KG_MESSAGE_EXTRACTION_STATUSES),
}).strict();
export type KgMessageExtraction = z.infer<typeof KgMessageExtraction>;

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
  /**
   * issue #4302：原结论最早被说出来的时间（ISO，支撑它的最早一条消息）——界面显示「来自你 {M/D} 的对话」，
   * 与 `KgRecalledMemory.saidAt` 同一口径；读不到（原话只剩附件片段）为 null。
   */
  saidAt: z.string().nullable(),
  /**
   * issue #4302：这一个来源是系统自动记下的（#4283，derived_from 边由模型建立），不是人点「记到我的长期记忆」。
   * 大脑页「忘掉这条」据此选既有动作：仍是「AI 记下的」且来源是自动记下的 ⇒ `undoAutoPersonalCopy`（只拿掉长期记忆里那份）；
   * 其余 ⇒ 在来源对话里 `applyHumanAction{revokeClaim}`（F07 级联让长期记忆里那份一起失效）。
   */
  autoCopied: z.boolean(),
}).strict();
export type KgPersonalClaimOrigin = z.infer<typeof KgPersonalClaimOrigin>;

/**
 * issue #4302（人类决定 2026-09-26「折叠的历史」）：长期记忆里被**改口取代**的一条，折叠在取代它的那条活记忆下面
 * （界面一行「取代了：〈旧〉」）。被忘掉 / 撤回 / 原话被删的不在这里（不显示）。只读查看者本人的个人空间。
 * 旧的那条没有第二个状态字段：它就是 `status = superseded` 的那条（`claimTriState` 为 null，不进 `claims`）。
 */
export const KgPersonalReplacedClaim = z.object({
  /** 取代它的那条（`getPersonalKnowledge.claims` 里活着的一条） */
  byClaimId: z.string(),
  replaces: z.object({ claimId: z.string(), statement: z.string() }).strict(),
  /**
   * 能撤销时：说出改口的那个对话（查看者本人的个人对话）与那次取代的提示（`KgSupersedeNotice.noticeId`）——
   * 「撤销取代」= 在那个对话上 `applyHumanAction{undoSupersede, noticeId}`，与对话里那一行「撤销」同一个动作。
   * 不是自动取代（矛盾卡上选了「以新的为准」）、或那个对话已不是本人的 ⇒ null（只显示，不给撤销）。
   */
  undo: z.object({ threadId: z.string(), noticeId: KgSupersedeNotice.shape.noticeId }).strict().nullable(),
  /**
   * issue #4363（S6）：链式取代历史（211 → 985 → 清华）里这一条离活记忆有几步：1 = 直接被 `byClaimId` 取代，
   * 2 = 被「取代了它的那条」再取代……同一 `byClaimId` 下按 step 从小到大就是从新到旧。只有 step = 1 的可能给撤销
   * （撤销更早的一环，要先撤销后面那一环——同 #4302：不引向一次注定落空的撤销）。省略 = 1（旧服务端）。
   */
  step: z.number().int().min(1).optional(),
  /** issue #4363（S6）：直接取代它的那一条（step = 1 时就是 `byClaimId` 那条；更早的一环是链上下一条，已不再生效）。 */
  replacedBy: z.object({ claimId: z.string(), statement: z.string() }).strict().optional(),
}).strict();
export type KgPersonalReplacedClaim = z.infer<typeof KgPersonalReplacedClaim>;

/**
 * S10（#4367）「分享到项目…」的一个目标项目 + 范围预览：确认之前先说清**谁会看到**。
 * `audience` 最多 `KG_SHARE_AUDIENCE_PREVIEW_MAX` 人（按显示名排序），`audienceCount` 是全部成员数（含观察者：项目记忆给全体成员看）。
 */
export const KG_SHARE_AUDIENCE_PREVIEW_MAX = 50;
export const KgProjectShareTarget = z.object({
  projectId: z.string(),
  name: z.string(),
  audience: z.array(z.object({ userId: z.string(), displayName: z.string() }).strict()).max(KG_SHARE_AUDIENCE_PREVIEW_MAX),
  audienceCount: z.number().int().nonnegative(),
  /** 已经分享到这个项目 ⇒ 项目里那份的 id（可撤回）；没分享 ⇒ null */
  sharedClaimId: z.string().nullable(),
}).strict();
export type KgProjectShareTarget = z.infer<typeof KgProjectShareTarget>;

/**
 * S10（#4367）：分享来的项目记忆的出处说法——「由 X 分享自个人记忆」（没有显示名说「项目成员」）。
 * 单一事实源：给模型的【记忆】材料（api domain/knowledge-graph/recall.ts）与界面（引用 chip、项目大脑）都用这一个。
 */
export function sharedFromPersonalLabelZh(name: string): string {
  const n = name.trim();
  return `由 ${n === "" ? "项目成员" : n} 分享自个人记忆`;
}

/** S10（#4367）：项目记忆里一条由成员从个人记忆分享来的结论 ⇒ 分享人显示名（没有显示名为空串）。 */
export const KgProjectSharedFrom = z.object({ claimId: z.string(), sharedByName: z.string() }).strict();
export type KgProjectSharedFrom = z.infer<typeof KgProjectSharedFrom>;

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
  /** 项目中枢 R7：`promoteToProject` 只对项目线程（个人线程没有项目可记）。 */
  "KG_SCOPE_NOT_PROJECT",
  "KG_SCOPE_NOT_ENABLED",
  "KG_EVIDENCE_REVOKED",
  "KG_PROMOTE_BATCH_TOO_LARGE",
  "KG_REINDEX_ALREADY_RUNNING",
  "KG_CARD_NOT_FOUND",
  "KG_CARD_STALE",
  "KG_PROMPT_NOT_FOUND",
  /** S10（#4367）「分享到项目…」：目标项目不存在，或分享人不是它的成员（同一个出口，不泄露存在性；HTTP 404）。 */
  "KG_PROJECT_NOT_FOUND",
  /** S10（#4367）：分享人在目标项目里只是观察者（只有 read.published），或项目已归档（HTTP 403）。 */
  "KG_PROJECT_READ_ONLY",
  /** issue #4178 —— `setKnowledgeExtractionSetting` 仅组织 admin，同 `plan-permissions`
   *  `StandingToolGrantError.NOT_ORG_ADMIN` 同一判据（`org_memberships.orgRole !== 'admin'`）。 */
  "KG_NOT_ORG_ADMIN",
  /** S8（#4365）：要撤销的整合运行不存在 / 不是本人的 / 已经撤销过（同一个出口，不区分——不能借它探测别人的运行）。 */
  "KG_CONSOLIDATION_RUN_NOT_FOUND",
  /** S8：部署的记忆整合开关关着（默认关），「现在整合一次」不跑。 */
  "KG_CONSOLIDATION_DISABLED",
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

/**
 * issue #4178（`deploymentCapable` 的口径用户直接交办更正于 2026-09-25）—— 记忆抽取的
 * 组织开关。两个布尔分别回答两件不同的事，UI 好分别提示：
 * - `deploymentCapable`：**部署有没有配置抽取用的模型 provider AND 部署开关打开了**
 *   （`KgExtractionModelConfig.enabled`（provider 是否配置）与
 *   `KgDeploymentExtractionSettingsPort.getEnabled()`（部署开关现值）两者相与）——部署级、
 *   只读（不受本束任何写操作影响；要改部署开关，走下面 `getPlatformExtractionSetting` /
 *   `setPlatformExtractionSetting` 这一对平台级操作，不是这里）。
 * - `orgEnabled`：本组织有没有打开（`kg_org_extraction_settings.enabled`）——组织级、
 *   admin 可写、admin 没设置过时为 true（默认开，见 `KgOrgExtractionSettingsPort.getEnabled`）。
 * 两者都为真，新消息才会被排进抽取队列（`kg_enqueue_extraction` 的三道闸门：provider 已配置、
 * 部署开关打开、组织开关打开）。
 */
export const KgExtractionSetting = z.object({
  deploymentCapable: z.boolean(),
  orgEnabled: z.boolean(),
}).strict();
export type KgExtractionSetting = z.infer<typeof KgExtractionSetting>;

/** `setKnowledgeExtractionSetting` 的入参：只有目标值，组织从调用者当前会话取，不接受调用方指定别的组织。 */
export const SetKnowledgeExtractionSettingInput = z.object({
  enabled: z.boolean(),
}).strict();
export type SetKnowledgeExtractionSettingInput = z.infer<typeof SetKnowledgeExtractionSettingInput>;

/**
 * 用户直接交办（2026-09-25，ad-hoc）—— 平台级抽取开关（`kg_extraction_state`，全库单例）
 * 的读出形状。与组织级 `KgExtractionSetting` 分开声明，即便字段名很像也不合并：这是
 * 两个不同权限层级各自的完整答案，`providerConfigured` 是这一层唯一多出来的、组织级
 * 视角看不到的基础设施事实（组织级只看得到两者相与后的 `deploymentCapable`）。
 */
export const KgDeploymentExtractionSetting = z.object({
  /** 这次部署有没有配置抽取用的模型 provider（`KgExtractionModelConfig.enabled`）——只读，
   *  这个平台级操作束也改不了它，它是启动参数。 */
  providerConfigured: z.boolean(),
  /** 部署开关的现值（`kg_extraction_state.enabled`）——平台管理员可来回切换。 */
  enabled: z.boolean(),
}).strict();
export type KgDeploymentExtractionSetting = z.infer<typeof KgDeploymentExtractionSetting>;

/** `setPlatformExtractionSetting` 的入参：只有目标值，没有 orgId——这是部署级、非租户开关。 */
export const SetPlatformExtractionSettingInput = z.object({
  enabled: z.boolean(),
}).strict();
export type SetPlatformExtractionSettingInput = z.infer<typeof SetPlatformExtractionSettingInput>;

/**
 * S8（#4365，epic #4359）—— 个人空间的记忆整合。一次「运行」= 对一个人个人空间的一次整合，每处改动一条：
 * - `claim_merge`：两条说的是同一件事，保留 `kept`，`other` 合进来（来源全部保留，`other` 软失效）；
 * - `entity_merge`：同一实体的两种写法，`other` 合进 `kept`（边改指向、别名并入）；
 * - `conflict_opened`：两条彼此矛盾，开了一张 F16 冲突卡（`kept` = 旧的，`other` = 新的），**不裁决**，等人在卡上选。
 * 每处改动都能撤销（`undoConsolidationRun` 按运行整体撤销）；前提变了的那一处记 `undo_skipped` + 原因。
 */
export const KgConsolidationChangeKind = z.enum(["claim_merge", "entity_merge", "conflict_opened"]);
export type KgConsolidationChangeKind = z.infer<typeof KgConsolidationChangeKind>;

export const KgConsolidationChange = z.object({
  changeId: z.string(),
  kind: KgConsolidationChangeKind,
  state: z.enum(["applied", "undone", "undo_skipped"]),
  /** 结论去重的依据：exact（归一后相同）/ semantic（向量 + 字面）/ lexical（只看字面）；实体为 name；矛盾为 conflict。 */
  basis: z.string().nullable(),
  kept: z.object({ id: z.string(), text: z.string().nullable() }).strict(),
  other: z.object({ id: z.string(), text: z.string().nullable() }).strict(),
  /** 矛盾卡挂在哪个对话（本人的个人对话）；其余为 null。 */
  threadId: z.string().nullable(),
  /** 撤销时这一处没能还原的原因（人话）。 */
  undoNote: z.string().nullable(),
}).strict();
export type KgConsolidationChange = z.infer<typeof KgConsolidationChange>;

export const KgConsolidationRun = z.object({
  runId: z.string(),
  createdAt: z.string(),
  state: z.enum(["applied", "undone", "partially_undone"]),
  undoneAt: z.string().nullable(),
  /** 判出矛盾、但新的那条在本人个人对话里找不到来源、没法挂卡的对数（只计数，不裁决）。 */
  conflictsUnsurfaced: z.number().int().nonnegative(),
  changes: z.array(KgConsolidationChange),
}).strict();
export type KgConsolidationRun = z.infer<typeof KgConsolidationRun>;

/** 本人整合记录一次最多列出的运行数。 */
export const KG_CONSOLIDATION_RUNS_LIMIT = 20;

/** S8：部署级记忆整合开关（`kg_consolidation_state`，**默认关**，平台运营准入可切换）。 */
export const KgConsolidationSetting = z.object({ enabled: z.boolean() }).strict();
export type KgConsolidationSetting = z.infer<typeof KgConsolidationSetting>;

/** 平台「现在整合一次」的结果：处理了几个人、落了几处改动。只有计数，不含任何人的内容。 */
export const KgConsolidationPassResult = z.object({
  users: z.number().int().nonnegative(),
  claimMerges: z.number().int().nonnegative(),
  entityMerges: z.number().int().nonnegative(),
  conflicts: z.number().int().nonnegative(),
  conflictsUnsurfaced: z.number().int().nonnegative(),
  failedUsers: z.number().int().nonnegative(),
}).strict();
export type KgConsolidationPassResult = z.infer<typeof KgConsolidationPassResult>;

/**
 * S8：记忆抽取 SLO（平台运营准入可读）。延迟 / 失败率 / 门控计数是**本实例**最近一小时（进程内，重启归零）；
 * 卡住的租约、死信、积压是全库现数。`alerts` 非空 ⇒ 超阈值（管理页出横幅，worker 记 error 日志）。
 */
export const KgExtractionSloMetric = z.enum(["p95_latency", "failure_rate", "stuck_leases"]);
export type KgExtractionSloMetric = z.infer<typeof KgExtractionSloMetric>;
export const KgExtractionSlo = z.object({
  windowSeconds: z.number().int().positive(),
  processed: z.number().int().nonnegative(),
  modelJobs: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  p95LatencyMs: z.number().nonnegative().nullable(),
  failureRate: z.number().min(0).max(1).nullable(),
  stuckLeases: z.number().int().nonnegative(),
  deadLetters: z.number().int().nonnegative(),
  backlog: z.number().int().nonnegative(),
  oldestPendingSeconds: z.number().int().nonnegative(),
  gate: z.object({
    skippedByReason: z.object({
      greeting: z.number().int().nonnegative(),
      acknowledgement: z.number().int().nonnegative(),
      pure_question: z.number().int().nonnegative(),
      model_not_worth: z.number().int().nonnegative(),
    }).strict(),
    modelCallsSaved: z.number().int().nonnegative(),
    modelCalls: z.number().int().nonnegative(),
    gateModelEnabled: z.boolean(),
    gateModelChecks: z.number().int().nonnegative(),
    gateModelErrors: z.number().int().nonnegative(),
  }).strict(),
  thresholds: z.object({
    p95LatencyMs: z.number().positive(),
    failureRate: z.number().min(0).max(1),
    stuckLeases: z.number().int().nonnegative(),
  }).strict(),
  alerts: z.array(z.object({ metric: KgExtractionSloMetric, value: z.number(), threshold: z.number() }).strict()),
}).strict();
export type KgExtractionSlo = z.infer<typeof KgExtractionSlo>;

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
      /** 项目中枢 R7：「记到项目大脑」入口——项目线程，且调用者是创建者或本项目引导师。旧响应无此字段 ⇒ 视为 false。 */
      canPromoteToProject: z.boolean().optional(),
      /** U-6：面板头部常驻的可见范围说明 —— 仅你可见 / 会话成员可见 */
      visibility: KgVisibility,
      /**
       * issue #4178 —— 这个会话所在组织，此刻是否真的在抽取新消息：部署具备能力
       * （`KgExtractionModelConfig.enabled`）AND 该组织打开了（`kg_org_extraction_settings`）。
       * 面板的 `IngestionStatus` 靠它区分「队列空 = 已整理到最新」与「队列恒空是因为抽取压根没开」——
       * 后者此前会误报「已整理到最新」（关闭状态下的假象，见 `kg-extraction-worker.ts` 头注更正）。
       */
      extractionActive: z.boolean(),
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

  /**
   * S10（#4367）「分享到项目…」第一步：这条个人结论能分享到哪些项目、每个项目里**谁会看到**（范围预览）。
   * 只有这条个人结论的主人能读；别人的个人结论与不存在同一个出口 `KG_CLAIM_NOT_FOUND`（404，人类决定 2026-09-27）。
   * `targets`：本人是成员（且不是观察者）、未归档的项目；`sharedClaimId` 非空 ⇒ 已经分享过，项目里那份可撤回。
   */
  listProjectShareTargets: {
    method: "GET", path: "/knowledge-graph/personal/claims/:claimId/share-targets",
    in: z.object({ claimId: z.string() }).strict(),
    out: z.object({
      claimId: z.string(),
      statement: z.string(),
      targets: z.array(KgProjectShareTarget),
    }).strict(),
    err: ["KG_CLAIM_NOT_FOUND"] as const,
  },

  /**
   * S10（#4367）：把本人的一条个人结论**显式**分享到项目记忆（L1 → L2 派生副本，derived_from 连回，保留作者）。
   * 个人空间原件不动。已经分享过 ⇒ `already_shared`，交回那一份（幂等）。
   */
  shareToProject: {
    method: "POST", path: "/knowledge-graph/personal/claims/:claimId/share",
    in: z.object({ claimId: z.string(), projectId: z.string() }).strict(),
    out: z.object({ projectClaimId: z.string(), outcome: z.enum(["shared", "already_shared"]) }).strict(),
    err: [
      "KG_CLAIM_NOT_FOUND", "KG_PROJECT_NOT_FOUND", "KG_PROJECT_READ_ONLY", "KG_CONTESTED_NEEDS_RESOLUTION", "KG_ACTOR_NOT_HUMAN",
      "KG_SCOPE_NOT_ENABLED",
    ] as const,
  },

  /**
   * S10（#4367）：撤回分享——项目里那份失效（F07 级联收掉它的边），个人空间原件不动。
   * 只有主人能撤；没分享过 / 已撤回 ⇒ `KG_CLAIM_NOT_FOUND`。
   */
  unshareFromProject: {
    method: "POST", path: "/knowledge-graph/personal/claims/:claimId/unshare",
    in: z.object({ claimId: z.string(), projectId: z.string() }).strict(),
    out: z.object({ projectClaimId: z.string() }).strict(),
    err: ["KG_CLAIM_NOT_FOUND", "KG_ACTOR_NOT_HUMAN"] as const,
  },

  /**
   * 项目中枢 R7：晋升到**项目记忆**（L0 → L2，复制 + derived_from 连边，与 `promoteToPersonal` 同构）。
   * 只对项目线程；创建者或本项目引导师可做（同 R5 分享的判据：看得见 ≠ 能替项目记下）。
   * 结果形状复用 `KgPromotionItemResult`——`personalClaimId` 字段在这里装的是**项目层**结论 id（不另开一套形状）。
   */
  promoteToProject: {
    method: "POST", path: "/knowledge-graph/threads/:threadId/promote-to-project",
    in: z.object({
      threadId: z.string(),
      claimIds: z.array(z.string()).min(1).max(KG_PROMOTE_MAX_BATCH),
      choices: z.array(z.object({
        claimId: z.string(),
        choice: z.enum(["merge", "coexist"]),
      }).strict()).optional(),
    }).strict(),
    out: z.object({ results: z.array(KgPromotionItemResult) }).strict(),
    err: [
      "KG_THREAD_NOT_FOUND", "KG_NOT_VISIBLE", "KG_NOT_OWNER", "KG_ACTOR_NOT_HUMAN",
      "KG_SCOPE_NOT_PROJECT", "KG_PROMOTE_BATCH_TOO_LARGE",
    ] as const,
  },

  /**
   * B2-S4（issue #4428）：晋升到**组织记忆**（L2 → L3，复制 + derived_from 连边，与 `promoteToProject` 同构）。
   * 来源是一个项目的项目记忆里的结论（`claimIds` 是 `getProjectKnowledge.claims` 里的 id）；只有本组织 lead / admin
   * 可做（`KG_NOT_OWNER`）——组织记忆是替整个组织记下，项目引导师也不够。`KG_NOT_VISIBLE`：调用者看不到这个项目。
   * 结果形状复用 `KgPromotionItemResult`——`personalClaimId` 字段在这里装的是**组织层**结论 id；不在项目记忆里的
   * 条目逐条 `KG_CLAIM_NOT_FOUND`。
   */
  promoteToOrg: {
    method: "POST", path: "/knowledge-graph/projects/:projectId/promote-to-org",
    in: z.object({
      projectId: z.string(),
      claimIds: z.array(z.string()).min(1).max(KG_PROMOTE_MAX_BATCH),
      choices: z.array(z.object({
        claimId: z.string(),
        choice: z.enum(["merge", "coexist"]),
      }).strict()).optional(),
    }).strict(),
    out: z.object({ results: z.array(KgPromotionItemResult) }).strict(),
    err: [
      "KG_NOT_VISIBLE", "KG_NOT_OWNER", "KG_ACTOR_NOT_HUMAN", "KG_CLAIM_NOT_FOUND", "KG_PROMOTE_BATCH_TOO_LARGE",
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

  /**
   * issue #4180：这条消息（发送方自己的）是否刚被抽取出新结论。前端只在这条消息是本会话
   * 真的发出去的那条时才轮询（不对整段历史消息各自常驻轮询）。
   */
  getMessageExtraction: {
    method: "GET", path: "/knowledge-graph/threads/:threadId/messages/:messageId/extraction",
    in: z.object({ threadId: z.string(), messageId: z.string() }).strict(),
    out: KgMessageExtraction,
    err: ["KG_THREAD_NOT_FOUND", "KG_NOT_VISIBLE"] as const,
  },

  /**
   * UC-KG-14（issue #4283）：撤销系统自动记进**本人**个人空间的那一份决定（人的动作；Agent 身份拒绝）。
   * `claimId` 是会话里的原结论（反馈条上那一条）。只撤仍是「AI 记下的」那份：副本只有这一个来源 ⇒ `revoked`；
   * 同一决定在别处也说过、合并在一起 ⇒ 只摘掉这一个来源（`detached`），副本由其余来源继续支撑。
   * 别人的空间 / 不存在 / 已确认过 / 已撤销 ⇒ 同一个 `KG_CLAIM_NOT_FOUND`。
   */
  undoAutoPersonalCopy: {
    method: "POST", path: "/knowledge-graph/threads/:threadId/claims/:claimId/personal-copy/undo",
    in: z.object({ threadId: z.string(), claimId: z.string() }).strict(),
    out: z.object({ personalClaimId: z.string(), outcome: z.enum(["revoked", "detached"]) }).strict(),
    err: ["KG_THREAD_NOT_FOUND", "KG_NOT_VISIBLE", "KG_CLAIM_NOT_FOUND", "KG_ACTOR_NOT_HUMAN"] as const,
  },

  /**
   * issue #4363（S6）：改一条待办的状态（open / done / dropped；人的动作，Agent 身份拒绝）。**只有所有者**：
   * 会话里的待办 = 会话创建者，个人空间的 = 空间主人。同一件待办在会话与个人空间各有一份（derived_from 相连）时一起改，
   * `claimIds` 列出实际改到的（含它自己）。不存在 / 不是待办 / 已失效 / 不是所有者 ⇒ 同一个 `KG_CLAIM_NOT_FOUND`
   * （不让人探测别人的会话或空间里有没有这条）。对话里说「那个做完了」尚未接线（后续工作：S4 的改口意图应调用同一个领域操作）。
   */
  setTodoStatus: {
    method: "POST", path: "/knowledge-graph/claims/:claimId/todo-status",
    in: z.object({ claimId: z.string(), status: KgTodoStatus }).strict(),
    out: z.object({ claimId: z.string(), status: KgTodoStatus, claimIds: z.array(z.string()) }).strict(),
    err: ["KG_CLAIM_NOT_FOUND", "KG_ACTOR_NOT_HUMAN"] as const,
  },

  /**
   * S7（#4364，待签核：按已批准处理、事后补签）：纠正回答下的一条引用（「这条不对」/「已过时」）。人的动作；
   * 只给对话所有者、且是这一轮的提问人（`KG_NOT_OWNER`）。`claimId` 必须是这一轮**对账后**的引用之一
   * （`getTurnMemory.cited`），否则同一个 `KG_CLAIM_NOT_FOUND`（不泄露别的结论是否存在）。
   * `replacement` 只配 `wrong`（配 `expired` ⇒ 400 `KG_INVALID_REQUEST`）。结果：`forgotten`（忘掉）/ `superseded`（新说法 `newClaimId` 取代旧的）/ `expired`。
   */
  correctCitation: {
    method: "POST", path: "/knowledge-graph/threads/:threadId/messages/:messageId/citations/:claimId/correction",
    in: z.object({
      threadId: z.string(),
      messageId: z.string(),
      claimId: z.string(),
      kind: KgCitationCorrectionKind,
      replacement: z.string().trim().min(1).max(2000).optional(),
    }).strict(),
    out: z.object({
      outcome: z.enum(["forgotten", "superseded", "expired"]),
      newClaimId: z.string().nullable(),
    }).strict(),
    err: ["KG_THREAD_NOT_FOUND", "KG_NOT_VISIBLE", "KG_NOT_OWNER", "KG_CLAIM_NOT_FOUND", "KG_ACTOR_NOT_HUMAN"] as const,
  },

  /**
   * S7（#4364，待签核：按已批准处理、事后补签）：本人的引用纠正率——质量信号（黄金集 / 北极星面板读它）。
   * 口径：最近 `windowDays` 天里本人提问的回答，`citedUses` = 对账后的引用条数合计（同 `getTurnMemory.cited` 的判据），
   * `corrections` = 本人对引用点的「这条不对」/「已过时」次数；`correctionRate` = 纠正 / 引用，没有引用时为 null。
   * 只读本人的（个人空间的结论只给本人，I-14）；不是组织成员 ⇒ 全 0，不是错误。
   */
  getCitationMetrics: {
    method: "GET", path: "/knowledge-graph/me/citation-metrics",
    in: z.object({}).strict(),
    out: z.object({
      windowDays: z.number().int().positive(),
      citedUses: z.number().int().nonnegative(),
      corrections: z.object({
        wrong: z.number().int().nonnegative(),
        expired: z.number().int().nonnegative(),
      }).strict(),
      correctionRate: z.number().min(0).nullable(),
    }).strict(),
    err: [] as const,
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

  /**
   * UC-KG-12b（issue #4361）：撤销一张已生效的「忘掉」卡（人的动作；Agent 身份拒绝）。只恢复这张卡忘掉的、
   * 现在仍是「因忘掉而失效」的那些（连同 F07 级联一起收掉的长期记忆副本与关系）；卡转 `undone`。
   * 别人的卡 / 不存在的卡同一个出口 KG_CARD_NOT_FOUND（404，不泄露存在性）；已撤销 / 没生效 / 不是忘掉卡 ⇒ KG_CARD_STALE。
   */
  undoMemoryCard: {
    method: "POST", path: "/knowledge-graph/cards/:cardId/undo",
    in: z.object({ cardId: z.string() }).strict(),
    out: z.object({ card: KgMemoryCard, actionIds: z.array(z.string()) }).strict(),
    err: ["KG_CARD_NOT_FOUND", "KG_CARD_STALE", "KG_NOT_OWNER", "KG_ACTOR_NOT_HUMAN"] as const,
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
      /** issue #4302：被改口取代的旧记忆，各自挂在取代它的活记忆下（折叠显示）；撤回 / 忘掉的不在里面 */
      replaced: z.array(KgPersonalReplacedClaim),
    }).strict(),
    /** 调用者不是（或已不是）当前组织成员（HTTP 403）。空间里没有内容不是错误，返回空。 */
    err: ["KG_NOT_VISIBLE"] as const,
  },

  /**
   * 项目中枢 R8：**项目大脑**只读——一个项目的项目记忆（L2：由「记到项目大脑」晋升来的结论 / 实体 / 边）。
   * 项目成员可读（含观察者：项目记忆本就是给全体成员的）；非成员 `KG_NOT_VISIBLE`（403，同个人空间：
   * 项目的存在性由项目自己的路由回答，这里不再泄露第二次）。空项目返回空数组，不是错误。
   */
  getProjectKnowledge: {
    method: "GET", path: "/knowledge-graph/projects/:projectId",
    in: z.object({ projectId: z.string() }).strict(),
    out: z.object({
      scope: KgScope,
      revision: z.number().int().nonnegative(),
      objects: z.array(KgObject),
      claims: z.array(KgClaim),
      edges: z.array(KgEdge),
      /** B2-S4：调用者是本组织 lead / admin，可以把这里的条目记到组织记忆（`promoteToOrg`）；缺省 = 不能（旧响应）。 */
      canPromoteToOrg: z.boolean().optional(),
      /** S10（#4367）：`claims` 里由成员从个人记忆分享来的那些 ⇒ 分享人（界面标「由 X 分享自个人记忆」）；缺省 = 没有（旧响应） */
      sharedFromPersonal: z.array(KgProjectSharedFrom).optional(),
    }).strict(),
    err: ["KG_NOT_VISIBLE"] as const,
  },

  /**
   * B2-S4（issue #4428）：**组织大脑**只读——本组织的组织记忆（L3：由 `promoteToOrg` 晋升来的结论 / 实体 / 边）。
   * 任何组织成员可读；不是（或已不是）组织成员 `KG_NOT_VISIBLE`（403）。空组织返回空数组，不是错误。
   */
  getOrgKnowledge: {
    method: "GET", path: "/knowledge-graph/org",
    in: z.object({}).strict(),
    out: z.object({
      scope: KgScope,
      revision: z.number().int().nonnegative(),
      objects: z.array(KgObject),
      claims: z.array(KgClaim),
      edges: z.array(KgEdge),
    }).strict(),
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

  /**
   * issue #4178 —— 记忆抽取的组织开关（从部署启动参数 + 全库单例，改成按组织落库、
   * admin 可来回切换）。读写拆两个操作，同 #3068 `listStandingToolGrants` /
   * `revokeStandingToolGrant` 的读写分权理由：读是「这个组织现在抽不抽」这件事本身，
   * 任何组织成员都该看得到（不是要按内容披露的租户数据）；写改变全组织行为，仅 admin。
   */
  getKnowledgeExtractionSetting: {
    method: "GET", path: "/knowledge-graph/extraction-setting",
    in: z.object({}).strict(),
    out: KgExtractionSetting,
    err: [] as const,
  },
  /** 仅组织 admin；判据同 `plan-permissions.StandingToolGrantError.NOT_ORG_ADMIN`。 */
  setKnowledgeExtractionSetting: {
    method: "PUT", path: "/knowledge-graph/extraction-setting",
    in: SetKnowledgeExtractionSettingInput,
    out: KgExtractionSetting,
    err: ["KG_NOT_ORG_ADMIN"] as const,
  },

  /**
   * 用户直接交办（2026-09-25，ad-hoc）—— 平台级抽取开关（`kg_extraction_state`）的读，
   * 与组织级 `getKnowledgeExtractionSetting` 是不同的权限层级、不同的路由：这一对只回答
   * "整个部署"要不要跑抽取，不针对任何一个组织。任何平台运营准入（`PlatformOperatorGuard`：
   * 平台超管，或落库的 `platform_admins`）都可读——同 `platform-members.listPlatformMembers`
   * 的授权面，这一层再往下没有"只读"与"可写"的区分（不像组织级还有"任何成员可读、仅
   * admin 可写"两级，平台运营准入已经是能接触这条路由的最低门槛）。
   */
  getPlatformExtractionSetting: {
    method: "GET", path: "/platform/knowledge-graph/extraction-setting",
    in: z.object({}).strict(),
    out: KgDeploymentExtractionSetting,
    err: ["NOT_PLATFORM_SUPERUSER"] as const,
  },
  /** 同上；写。同样要求平台运营准入——这一层没有比它更低的可写门槛。 */
  setPlatformExtractionSetting: {
    method: "PUT", path: "/platform/knowledge-graph/extraction-setting",
    in: SetPlatformExtractionSettingInput,
    out: KgDeploymentExtractionSetting,
    err: ["NOT_PLATFORM_SUPERUSER"] as const,
  },

  /** S8（#4365）：记忆抽取 SLO（p95 延迟、失败率、卡住的租约 + 门控省下的调用）。平台运营准入。 */
  getPlatformExtractionSlo: {
    method: "GET", path: "/platform/knowledge-graph/extraction-slo",
    in: z.object({}).strict(),
    out: KgExtractionSlo,
    err: ["NOT_PLATFORM_SUPERUSER"] as const,
  },
  /** S8：部署级记忆整合开关（默认关）。平台运营准入读写。 */
  getPlatformConsolidationSetting: {
    method: "GET", path: "/platform/knowledge-graph/consolidation-setting",
    in: z.object({}).strict(),
    out: KgConsolidationSetting,
    err: ["NOT_PLATFORM_SUPERUSER"] as const,
  },
  setPlatformConsolidationSetting: {
    method: "PUT", path: "/platform/knowledge-graph/consolidation-setting",
    in: KgConsolidationSetting,
    out: KgConsolidationSetting,
    err: ["NOT_PLATFORM_SUPERUSER"] as const,
  },
  /** S8：现在整合一次（与定时任务同一条路径；开关关着 ⇒ `KG_CONSOLIDATION_DISABLED` 409）。只回计数。 */
  runPlatformConsolidation: {
    method: "POST", path: "/platform/knowledge-graph/consolidation/run",
    in: z.object({}).strict(),
    out: KgConsolidationPassResult,
    err: ["NOT_PLATFORM_SUPERUSER", "KG_CONSOLIDATION_DISABLED"] as const,
  },
  /** S8：本人的整合记录（只有本人；空不是错误）。 */
  listMyConsolidationRuns: {
    method: "GET", path: "/knowledge-graph/me/consolidations",
    in: z.object({}).strict(),
    out: z.object({ runs: z.array(KgConsolidationRun).max(KG_CONSOLIDATION_RUNS_LIMIT) }).strict(),
    err: ["KG_NOT_VISIBLE"] as const,
  },
  /** S8：撤销一次整合（人的动作；只有本人）。前提变了的那几处记 `undo_skipped`，其余照常还原。 */
  undoConsolidationRun: {
    method: "POST", path: "/knowledge-graph/me/consolidations/:runId/undo",
    in: z.object({ runId: z.string() }).strict(),
    out: z.object({ run: KgConsolidationRun }).strict(),
    err: ["KG_NOT_VISIBLE", "KG_CONSOLIDATION_RUN_NOT_FOUND", "KG_ACTOR_NOT_HUMAN"] as const,
  },
} as const;

/**
 * Phase 18 知识图谱的端口。应用层定义、基础设施实现（依赖倒置）。
 */
import type { knowledgeGraph as KG } from "@repo/contracts";
import type { z } from "zod";
import type { OrgId } from "../../domain/org-id";
import type { Guarded } from "../security/permission-filter";
import type { OntologyBatch, OntologyRejectCode } from "../../domain/knowledge-graph/ontology-batch";
import type { ExtractionResult, KnownObject } from "../../domain/knowledge-graph/extraction";
import type { GraphHit, GraphHop, RecallClaim, RecallObject } from "../../domain/knowledge-graph/recall";
import type { ConfirmedClaim, ConflictPair, FreshClaim } from "../../domain/knowledge-graph/conflict";

export interface AppliedBatch {
  readonly actionId: string;
  /** 同一 `(sourceRef, pipelineVersion, actionType)` 已成功处理过 ⇒ true，本次什么都没写（I-7）。 */
  readonly deduplicated: boolean;
  readonly objects: number;
  readonly claims: number;
  readonly edges: number;
}

export interface RejectedBatch {
  readonly code: OntologyRejectCode;
  readonly reason: string;
}

/**
 * 本体的唯一写入口（I-3）。实现只允许经数据库里的 `kg_apply_batch` 落表，
 * 不许在实现里直接 INSERT —— 数据库那一侧也会拒（`kg_scoped_write_guard`）。
 */
export interface OntologyStorePort {
  /** 数据库复核不变量失败时，返回 `{ rejected }` 而不是抛出。 */
  apply(
    orgId: OrgId,
    currentUserId: string | null,
    batch: OntologyBatch,
  ): Promise<{ readonly applied: AppliedBatch } | { readonly rejected: RejectedBatch }>;
  /** 被拒的动作也留痕（uc-18-1 E2）。 */
  recordRejected(orgId: OrgId, currentUserId: string | null, batch: OntologyBatch, rejected: RejectedBatch): Promise<void>;
}

export const ONTOLOGY_STORE_PORT = Symbol("OntologyStorePort");

/**
 * AGE 投影（F04）。实现只调数据库里的 `kg_project_pending` / `kg_projection_pending_orgs`，
 * 投影规则（哪些行进图）只在迁移 20260924200000 的 `kg_live_vertices` / `kg_live_edges` 里。
 */
export interface GraphProjectionPort {
  /** 有待投影行的 org。只有 id，不带任何内容。 */
  pendingOrgs(): Promise<readonly OrgId[]>;
  /** 投影本 org 的待处理行，返回处理条数。AGE 不可用时抛错，待处理行原样保留。 */
  projectPending(orgId: OrgId, limit: number): Promise<number>;
  /** 超过重试上限、不再自动投影的目标数（全局，只有数字）。 */
  deadCount(): Promise<number>;
}

export const GRAPH_PROJECTION_PORT = Symbol("GraphProjectionPort");

// ─────────────────────────────── F06 抽取 ───────────────────────────────

export interface KgExtractionJob {
  readonly orgId: OrgId;
  readonly messageId: string;
  readonly threadId: string;
  /** 含本次在内已经尝试的次数。 */
  readonly attempts: number;
}

/** 抽取队列（消息落库时由触发器排队，见迁移 20260924210000）。 */
export interface KgExtractionQueuePort {
  /** 抽取在这个库上开着：从此新消息才排队（关着时不排，免得永远没人消费的行无限增长）。 */
  enable(): Promise<void>;
  pendingOrgs(): Promise<readonly OrgId[]>;
  /** 认领本 org 的一批任务（带租约：worker 崩了，租约过期后别的 worker 可以重新认领）。 */
  claim(orgId: OrgId, limit: number): Promise<readonly KgExtractionJob[]>;
  complete(orgId: OrgId, messageId: string): Promise<void>;
  fail(orgId: OrgId, messageId: string, error: string): Promise<void>;
}

export interface KgMessage {
  readonly id: string;
  readonly threadId: string;
  readonly body: string;
  readonly authorKind: "human" | "agent";
}

export interface KgExtractionSourcePort {
  /** 这条消息，外加它之前的若干条（给模型消解「他」「这个版本」之类的指代）。消息不在了 ⇒ null。 */
  loadMessage(orgId: OrgId, messageId: string, contextTurns: number): Promise<{ readonly message: KgMessage; readonly context: readonly KgMessage[] } | null>;
  /** 本会话已有的实体（实体解析用）。 */
  knownObjects(orgId: OrgId, threadId: string): Promise<readonly KnownObject[]>;
}

export interface KnowledgeExtractorPort {
  /** 模型调用失败 ⇒ 抛错（任务稍后重试）；模型回了东西但解析不出 ⇒ 返回空结果（不重试）。 */
  extract(input: { readonly message: KgMessage; readonly context: readonly KgMessage[] }): Promise<ExtractionResult>;
}

export const KG_EXTRACTION_QUEUE_PORT = Symbol("KgExtractionQueuePort");
export const KG_EXTRACTION_SOURCE_PORT = Symbol("KgExtractionSourcePort");
export const KNOWLEDGE_EXTRACTOR_PORT = Symbol("KnowledgeExtractorPort");

// ─────────────────────────────── F09 读取（知识面板 / 来源抽屉 / 每轮记忆行） ───────────────────────────────

/** 读模型的形状直接取契约的 out（单一事实源），这里只起别名。 */
export type ThreadKnowledgeData = Pick<
  z.infer<typeof KG.knowledgeGraph.getThreadKnowledge.out>,
  "revision" | "objects" | "claims" | "edges" | "ingestion"
>;
export type ClaimSourcesData = z.infer<typeof KG.knowledgeGraph.getClaimSources.out>;
export type TurnMemoryData = z.infer<typeof KG.knowledgeGraph.getTurnMemory.out>;

/** 读知识需要的线程事实（来自 chat 的可见性判定，不含正文）。 */
export interface KnowledgeThreadRef {
  readonly threadId: string;
  readonly projectId: string | null;
}

/**
 * 知识的读口。每个返回内容的方法都返回 `Guarded`——内容只有交出可见性判定后才拿得到
 * （同 chat 的 findMessages，application/security/permission-filter 的守卫读路径）。
 * `claimRoute` 只回路由事实（作用域），不回内容：判定要先知道这条结论属于哪个会话。
 */
export interface KnowledgeReadPort {
  threadKnowledge(orgId: OrgId, userId: string, thread: KnowledgeThreadRef): Promise<Guarded<ThreadKnowledgeData>>;
  claimRoute(orgId: OrgId, userId: string, claimId: string): Promise<{ readonly scopeKind: KG.KgScopeKind; readonly scopeId: string } | null>;
  /**
   * `onlyThreads`（F12，个人空间结论）：消息证据只取这些会话里的（调用方逐个判过可见性的）；
   * 附件证据此时不返回（附件有自己的可见性判定，L1 抽屉暂不展示）。
   */
  claimSources(orgId: OrgId, userId: string, claimId: string, thread: KnowledgeThreadRef, onlyThreads?: readonly string[]): Promise<Guarded<ClaimSourcesData> | null>;
  /** F12：一条结论的消息证据分布在哪些会话（只回会话 id，路由事实，不回内容）。 */
  claimEvidenceThreads(orgId: OrgId, userId: string, claimId: string): Promise<readonly string[]>;
  turnMemory(orgId: OrgId, userId: string, thread: KnowledgeThreadRef, messageId: string): Promise<Guarded<TurnMemoryData>>;
}

export const KNOWLEDGE_READ_PORT = Symbol("KnowledgeReadPort");

// ─────────────────────────────── F08 会话知识召回（喂给对话模型） ───────────────────────────────

export interface KnowledgeRecallPort {
  /** 本会话的活结论与实体（候选集）。读身份 = 发起这轮对话的人。 */
  candidates(orgId: OrgId, userId: string, threadId: string): Promise<{
    readonly claims: readonly RecallClaim[];
    readonly objects: readonly RecallObject[];
  }>;
  /** AGE 邻域（只有 id 与关系）。AGE 不可用时抛错——调用方记为图路不可用。 */
  graphNeighbors(orgId: OrgId, seedKeys: readonly string[]): Promise<readonly GraphHit[]>;
  /** F13：记下这一轮用到了哪些记忆（只存 id 与召回理由），回答下方的引用从这里读。 */
  recordTurn(orgId: OrgId, record: TurnRecallRecord): Promise<void>;
}

export interface TurnRecallRecord {
  readonly runId: string;
  readonly threadId: string;
  readonly userId: string;
  readonly items: readonly {
    readonly claimId: string;
    readonly channels: readonly string[];
    readonly retrievalReasons: readonly string[];
    readonly score: number;
    readonly graphPath: readonly GraphHop[] | null;
  }[];
  readonly graphDegraded: boolean;
}

export const KNOWLEDGE_RECALL_PORT = Symbol("KnowledgeRecallPort");

// ─────────────────────────────── F10 人工编辑动作 ───────────────────────────────

export type KgHumanAction = z.infer<typeof KG.KgHumanAction>;

/** 执行器拒绝人工动作时的码（契约 applyHumanAction.err 的子集）。 */
export type KgHumanActionErrorCode =
  | "KG_NOT_OWNER" | "KG_ACTOR_NOT_HUMAN" | "KG_REVISION_CHANGED" | "KG_CLAIM_NOT_FOUND"
  | "KG_OBJECT_NOT_FOUND" | "KG_CONTESTED_NEEDS_RESOLUTION" | "KG_PROMPT_NOT_FOUND"
  | "KG_SCOPE_NOT_PERSONAL" | "KG_EVIDENCE_REVOKED" | "KG_PROMOTE_BATCH_TOO_LARGE"
  // F17 确认卡（actOnMemoryCard.err）；KG_INVALID_REQUEST 不是契约码——请求本身不成立（改完的字全是空白），接口回 400
  | "KG_CARD_NOT_FOUND" | "KG_CARD_STALE" | "KG_INVALID_REQUEST";

export interface HumanActionPort {
  /** 数据库复核所有者 / 版本 / 作用域后执行；被拒时抛 `KgHumanActionError`。 */
  apply(orgId: OrgId, userId: string, input: {
    readonly actionId: string;
    readonly threadId: string;
    readonly basedOnRevision: number;
    readonly action: KgHumanAction;
  }): Promise<{ readonly revision: number; readonly actionId: string }>;
}

export class KgHumanActionError extends Error {
  constructor(readonly code: KgHumanActionErrorCode, message?: string) {
    super(message ?? code);
  }
}

export const HUMAN_ACTION_PORT = Symbol("HumanActionPort");

// ─────────────────────────────── F11 晋升到个人空间 ───────────────────────────────

export type PromotionItemResult = z.infer<typeof KG.KgPromotionItemResult>;

export interface PromotionPort {
  /**
   * 读方法都返回 `Guarded`：调用方交出会话可见性判定（同读接口的 guard ref）才拿得到内容。
   * 本人个人空间里的活结论（去重用）、会话里这些结论的原文、AI 提名候选。
   */
  personalClaims(orgId: OrgId, userId: string, thread: KnowledgeThreadRef): Promise<Guarded<readonly { readonly id: string; readonly statement: string }[]>>;
  /** `sourceGone`：这条因为原话被删而失效了（F07），晋升时逐条报 KG_EVIDENCE_REVOKED。 */
  threadClaims(orgId: OrgId, userId: string, thread: KnowledgeThreadRef, claimIds: readonly string[]): Promise<Guarded<readonly { readonly id: string; readonly statement: string; readonly sourceGone: boolean }[]>>;
  nominationCandidates(orgId: OrgId, userId: string, thread: KnowledgeThreadRef): Promise<Guarded<readonly {
    readonly id: string; readonly kind: string; readonly status: string; readonly statement: string;
  }[]>>;
  /** 执行一条晋升；被拒时抛 KgHumanActionError（码见 kg_promote_claim）。返回 L1 结论 id。 */
  promote(orgId: OrgId, userId: string, input: {
    readonly actionId: string; readonly threadId: string; readonly claimId: string;
    readonly mode: "new" | "merge"; readonly targetClaimId?: string;
  }): Promise<string>;
}

export const PROMOTION_PORT = Symbol("PromotionPort");

// ─────────────────────────────── F16 矛盾提醒 ───────────────────────────────

/**
 * 矛盾判定的读写口（迁移 20260924290000）。实现只调数据库函数：候选范围（本会话 + 个人线程里所有者本人的
 * 个人空间）与复核都在 `kg_conflict_candidates` / `kg_open_conflicts` 里，判定规则在 domain/knowledge-graph/conflict.ts。
 */
export interface KgConflictPort {
  /** 这条消息刚抽出的结论 + 「你确认过」的结论。消息不是人说的、不在本会话 ⇒ 两边都空。 */
  candidates(orgId: OrgId, threadId: string, messageId: string): Promise<{
    readonly fresh: readonly FreshClaim[];
    readonly confirmed: readonly ConfirmedClaim[];
  }>;
  /** 复核后开卡（两条转 contested），返回开了几张；复核不过的一对跳过。 */
  open(orgId: OrgId, input: {
    readonly actionId: string;
    readonly threadId: string;
    readonly messageId: string;
    readonly pairs: readonly ConflictPair[];
  }): Promise<number>;
  /**
   * 结束冲突的待办（触发器拿不到锁时放进去的卡）：哪些 org 有活（只回 id），以及排空本 org 的一张
   * （true = 处理了一张，false = 空了）。一张一个事务。
   */
  pendingCloseOrgs(): Promise<readonly OrgId[]>;
  drainCloseOne(orgId: OrgId): Promise<boolean>;
}

export const KG_CONFLICT_PORT = Symbol("KgConflictPort");

// ─────────────────────────────── F17 对话里「记住 / 忘掉」确认卡 ───────────────────────────────

export type MemoryCardData = z.infer<typeof KG.KgMemoryCard>;

/** 开卡的结果：只有 opened 出卡；其余对话照常，只是不出卡（E1 / 文字不出自这句话 / 长期记忆只在个人线程 / A2）。 */
export type MemoryCardOpenOutcome = "opened" | "not_owner" | "not_from_message" | "not_personal" | "no_items";

/**
 * 确认卡的读写口（迁移 20260924300000）。实现只调数据库函数，不写表名 SQL：
 * 开卡的复核（所有者本人说的、记住卡只在个人线程、忘掉卡的条目在召回范围里）在 `kg_open_memory_card`，
 * 人的决定在 `kg_act_on_memory_card`（actor_kind 必须是 human、所有者、会话锁 → 个人空间锁、卡片与结论行上锁）。
 * 卡片内容给用户看走 getTurnMemory 的守卫读路径（pg-knowledge-read.ts）。
 */
export interface MemoryCardPort {
  /** 执行器（系统身份）开一张 open 的卡（I-17：Agent 只能创建 open 状态的卡片）。 */
  open(orgId: OrgId, input: {
    readonly cardId: string;
    readonly threadId: string;
    readonly runId: string;
    readonly messageId: string;
    readonly requesterUserId: string;
    readonly kind: "remember" | "forget";
    readonly statement?: string;
    /** 忘掉卡：用户说要忘掉的那段话（数据库核对它出自这条消息） */
    readonly target?: string;
    readonly claimIds?: readonly string[];
  }): Promise<{ readonly outcome: MemoryCardOpenOutcome; readonly cardId: string | null }>;
  /** 路由事实：卡属于哪个会话（不回内容）；查不到 ⇒ null。 */
  cardThread(orgId: OrgId, userId: string, cardId: string): Promise<string | null>;
  /** 人的决定；被拒时抛 `KgHumanActionError`。 */
  act(orgId: OrgId, userId: string, input: {
    readonly actionId: string;
    readonly cardId: string;
    readonly decision: "accept" | "dismiss";
    readonly actorKind: "human" | "agent";
    readonly claimIds?: readonly string[];
    readonly editedStatement?: string;
  }): Promise<{ readonly card: MemoryCardData; readonly actionIds: readonly string[] }>;
}

export const MEMORY_CARD_PORT = Symbol("MemoryCardPort");

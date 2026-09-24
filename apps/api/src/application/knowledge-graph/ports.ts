/**
 * Phase 18 知识图谱的端口。应用层定义、基础设施实现（依赖倒置）。
 */
import type { knowledgeGraph as KG } from "@repo/contracts";
import type { z } from "zod";
import type { OrgId } from "../../domain/org-id";
import type { Guarded } from "../security/permission-filter";
import type { OntologyBatch, OntologyRejectCode } from "../../domain/knowledge-graph/ontology-batch";
import type { ExtractionResult, KnownObject } from "../../domain/knowledge-graph/extraction";

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
  claimSources(orgId: OrgId, userId: string, claimId: string, thread: KnowledgeThreadRef): Promise<Guarded<ClaimSourcesData> | null>;
  turnMemory(orgId: OrgId, userId: string, thread: KnowledgeThreadRef, messageId: string): Promise<Guarded<TurnMemoryData>>;
}

export const KNOWLEDGE_READ_PORT = Symbol("KnowledgeReadPort");

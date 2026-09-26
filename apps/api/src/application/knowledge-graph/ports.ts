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
import type { LiveDecision, SupersedeFresh } from "../../domain/knowledge-graph/decision-supersede";

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

/**
 * ⚠ 用户直接交办更正（2026-09-25，ad-hoc）：`enabled` 现在只回答**这次部署有没有配置抽取
 *   用的模型 provider**（`KERNEL_MODEL_PROVIDER` 非空）——纯粹的基础设施事实，没有 provider
 *   就没有任何东西能跑抽取，这件事没法、也不该放进平台管理员可写的表里。`KG_EXTRACTION_
 *   ENABLED` 环境变量**已从这里的判定里彻底退休**，不再读、也不作为任何 fallback：过去它和
 *   provider 一起决定这个位，现在"这次部署要不要跑抽取"整个搬到了
 *   `KgDeploymentExtractionSettingsPort`——落库、平台管理员可来回切换，不必再靠改部署配置
 *   + 重启（env var + 重启这条路径真的在生产上卡过一次：部署流水线本身坏掉时，没有任何
 *   办法把开关从关翻成开，见该端口头注）。
 *
 * 接口定义搬到 application 层：`knowledge-graph.controller.ts`（interface 层）需要读它的
 * `enabled` 位来回答 `getKnowledgeExtractionSetting` 的 `deploymentCapable`，而 interface 层
 * 不能直接 import infrastructure 的具体实现（ADR-020，`lint-arch-deps.mjs`）。真正的读取逻辑
 * （`readKgExtractionModelConfig()`）仍在 `infrastructure/knowledge-graph/kg-extraction-model-config.ts`，
 * 那里只是 re-export 这个接口与令牌，不重复声明第二份。
 */
export interface KgExtractionModelConfig {
  /** 这次部署有没有配置抽取用的模型 provider——只回答这一件事，"要不要跑"不再掺在这里。 */
  readonly enabled: boolean;
  readonly provider: string;
  readonly modelId: string;
}

export const KG_EXTRACTION_MODEL_CONFIG = Symbol("KgExtractionModelConfig");

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
  /**
   * round 7（#4284 收口）：这条消息若是**项目会话里 agent 的回答**，产出它的那个 run 在这一轮召回（`kg_turn_recalls`）里
   * 用到了多少条**不能证明属于本会话**的记忆（本会话 = `chat_session` 作用域、`scope_id` = 该消息的 thread）。
   * 个人空间条目在这里一律算「不能证明」（worker 不以任何用户身份读，RLS 本来就不放 personal 行）——fail closed。
   * 不是 agent 回答 / 不在项目会话 / 这一轮没有召回记录 ⇒ 0。只回一个数，不回任何内容。
   */
  projectAnswerOutsideRecallCount(orgId: OrgId, messageId: string): Promise<number>;
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
  "revision" | "objects" | "claims" | "edges" | "ingestion" | "extractionActive"
>;
export type ClaimSourcesData = z.infer<typeof KG.knowledgeGraph.getClaimSources.out>;
export type TurnMemoryData = z.infer<typeof KG.knowledgeGraph.getTurnMemory.out>;
/** issue #4180：一条消息自己刚被抽取出的新结论。 */
export type MessageExtractionData = z.infer<typeof KG.knowledgeGraph.getMessageExtraction.out>;

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
  /**
   * issue #4180：这一条消息自己（不做 `turnMemory` 那种「向前找最近一条人类消息」的扩展匹配）
   * 抽取出的、还活着的结论——发送下方「已记下：{摘要}·撤销」的信号源。
   */
  messageExtraction(orgId: OrgId, userId: string, thread: KnowledgeThreadRef, messageId: string): Promise<Guarded<MessageExtractionData>>;
  /**
   * UC-KG-7：本人个人空间（L1）的活结论 / 实体 / 边。guard ref 是本人的个人空间
   * （`project:personal:<userId>`，同 resolve-visibility 个人线程的合成 id）；调用方交出
   * 「查看者就是这个空间的主人」的判定才拿得到。
   */
  personalKnowledge(orgId: OrgId, userId: string): Promise<Guarded<PersonalKnowledgeData>>;
  /**
   * 大脑页：本人创建的、有活结论的会话（候选，最近活动倒序，从第 `offset` 个起最多 `limit` 个）。
   * 分页是为了让调用方在可见性过滤**之后**凑够上限。
   * `threadId` 是路由事实（同 `claimRoute`）；计数按该会话的 guard ref 包好——调用方逐个判会话可见性后才拿得到。
   */
  threadKnowledgeSummaries(orgId: OrgId, userId: string, limit: number, offset: number): Promise<readonly {
    readonly threadId: string; readonly counts: Guarded<ThreadKnowledgeCounts>;
  }[]>;
  /** 大脑页：本人个人空间结论 → 会话原结论（derived_from）。每行按原结论所在会话的 guard ref 包好。 */
  personalClaimOrigins(orgId: OrgId, userId: string): Promise<readonly {
    readonly threadId: string; readonly origin: Guarded<PersonalClaimOriginRow>;
  }[]>;
}

export type PersonalKnowledgeData = Omit<z.infer<typeof KG.knowledgeGraph.getPersonalKnowledge.out>, "scope">;

/** 一个会话的知识计数（标题等展示字段在判定通过后另取）。 */
export interface ThreadKnowledgeCounts {
  readonly threadId: string;
  readonly projectId: string | null;
  readonly pending: number;
  readonly confirmed: number;
  readonly conflict: number;
  readonly objects: number;
}

export interface PersonalClaimOriginRow {
  readonly personalClaimId: string;
  readonly sourceClaimId: string;
  readonly threadId: string;
  readonly projectId: string | null;
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

// ─────────────────────────────── issue #4283 本人的决定自动记进本人个人空间 ───────────────────────────────

/** 数据库拒绝一次自动复制的码（迁移 20260926131000 `kg_auto_copy_decision`）。逐条记日志、跳过，不让整条抽取任务失败。 */
export type KgAutoCopyRejectCode =
  | "KG_NOT_AUTHOR" | "KG_NOT_OWNER" | "KG_CLAIM_NOT_FOUND" | "KG_CONTESTED_NEEDS_RESOLUTION"
  | "KG_EVIDENCE_REVOKED" | "KG_SCOPE_NOT_ENABLED";

export class KgAutoCopyRejected extends Error {
  constructor(readonly code: KgAutoCopyRejectCode, message?: string) {
    super(message ?? code);
  }
}

/**
 * 系统把「作者本人说的决定」复制到作者本人个人空间，以及本人撤销那份副本。实现只调数据库函数：
 * 目标空间由数据库从证据消息的作者推出（调用方给不出、也改不了），见迁移头注。
 */
export interface KgAutoCopyPort {
  /**
   * 这条消息刚抽出的、可以复制的结论（模型提出、全部证据都是作者本人的话、还没复制过），以及作者本人
   * 个人空间的活结论（去重用）。消息不是成员本人说的 ⇒ `author = null`、两边都空。
   */
  candidates(orgId: OrgId, threadId: string, messageId: string): Promise<{
    readonly author: string | null;
    readonly fresh: readonly { readonly id: string; readonly statement: string }[];
    readonly personal: readonly { readonly id: string; readonly statement: string }[];
  }>;
  /** 执行一次复制；被数据库拒绝时抛 `KgAutoCopyRejected`。返回个人空间那条的 id（merge 时 = 目标）。 */
  copy(orgId: OrgId, input: {
    readonly actionId: string; readonly threadId: string; readonly messageId: string; readonly claimId: string;
    readonly mode: "new" | "merge"; readonly targetClaimId?: string;
  }): Promise<string>;
  /**
   * 人的动作：撤销本人个人空间里由 `claimId`（会话原结论）自动记下、仍是「AI 记下的」那一份。
   * 找不到（别人的 / 不存在 / 已确认过 / 已撤销）⇒ `KgHumanActionError("KG_CLAIM_NOT_FOUND")`。
   */
  undo(orgId: OrgId, userId: string, input: { readonly actionId: string; readonly threadId: string; readonly claimId: string }): Promise<{
    readonly personalClaimId: string; readonly outcome: "revoked" | "detached";
  }>;
}

export const KG_AUTO_COPY_PORT = Symbol("KgAutoCopyPort");

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
  /**
   * Issue #4290：明确改口的取代（迁移 20260926140000）。候选 = 这条消息刚抽出的决定（带消息作者）+ 还活着的旧决定
   * （本会话的；个人线程里再加所有者本人个人空间的，各带作者）。判定在 domain/knowledge-graph/decision-supersede.ts。
   */
  supersedeCandidates(orgId: OrgId, threadId: string, messageId: string): Promise<{
    readonly fresh: readonly SupersedeFresh[];
    readonly live: readonly LiveDecision[];
  }>;
  /**
   * 复核后落表，返回开了几张（取代提示 + 卡）；复核不过的跳过。
   * `supersedes`（高把握）：旧决定 superseded、开一张可撤销的取代提示；
   * `prompts`（低把握 frame_only）：只开一张 F16 卡（kind = possible_change），两条都不改状态。
   */
  applySupersedes(orgId: OrgId, input: {
    readonly actionId: string;
    readonly threadId: string;
    readonly messageId: string;
    readonly supersedes: readonly { readonly newer: string; readonly olders: readonly string[] }[];
    readonly prompts: readonly { readonly newer: string; readonly older: string }[];
  }): Promise<number>;
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

// ─────────────────────────────── issue #4178 组织级抽取开关 ───────────────────────────────

/**
 * `kg_org_extraction_settings` 的读写口。这张表背后没有 `ObjectRef` 能表达的 ACL 对象——
 * 是组织配置元数据（这个组织要不要让对话内容被抽取），不是要按内容披露的租户数据，
 * 同 `ToolPermissionGrantStore.listStanding`/`revokeStanding`（#3068）一样不经 `guard()`：
 * 塞进去只会退化成 DEFAULT_SCOPE 组织级、对每个成员恒真。
 *
 * 判据在应用层：`getEnabled` 任何组织成员可调（controller 只判「是不是本组织」），
 * `setEnabled` 仅组织 admin（`knowledge-graph.controller.ts` 的 `requireOrgAdmin`，
 * 与 `tool-permission-grant.controller.ts` 同名方法同一实现思路）。
 */
export interface KgOrgExtractionSettingsPort {
  /**
   * 没有行 = 从未设置过 = **默认开**（人类指令「默认是打开的」，迁移 20260926100000；
   * 触发器 `kg_enqueue_extraction` 同一条件：只有显式 `enabled = false` 的行才拦）。
   * 这是「组织级默认值」的唯一说明处，其余注释只引用这里。
   */
  getEnabled(orgId: OrgId): Promise<boolean>;
  /** upsert；返回写入后的现值（防御性——不假设调用方传的就是落库的）。 */
  setEnabled(orgId: OrgId, enabled: boolean, updatedByUserId: string): Promise<boolean>;
}

export const KG_ORG_EXTRACTION_SETTINGS_PORT = Symbol("KgOrgExtractionSettingsPort");

// ─────────────────────────────── 部署级抽取开关（用户直接交办，2026-09-25，ad-hoc） ───────────────────────────────

/**
 * `kg_extraction_state` 单例行的读写口——这次部署要不要让消息排进抽取队列。与
 * `KgOrgExtractionSettingsPort`（组织级）同一形状、少一个 `orgId`：这张表全库只有一行，
 * 不是租户数据，没有 RLS。
 *
 * ## 为什么要落库、为什么不再是「改环境变量 + 重启」
 *
 * 迁移 20260924210000 把它设计成全库单例、只能靠部署方设 `KG_EXTRACTION_ENABLED=1` +
 * 重启才能打开——一次真实事故把这条路径的成本暴露出来：devapp 的部署流水线坏了好几天，
 * 当时没有任何办法把这个开关从关翻成开（这台机器的凭据按本项目约定不出机器，没法远程
 * SSH 上去手改）。一个纯粹的功能开关，因为被绑死在部署配置上，在部署本身坏掉时变得
 * 不可操作。这个端口把「翻转它」的路径从「改部署配置」搬到「平台管理员调一次后台接口」，
 * 不再需要重启、也不再需要碰这台机器。
 *
 * ## 判据在应用层，不在这里
 *
 * 与 `KgOrgExtractionSettingsPort` 同一条纪律：这里不经 `guard()`（没有 `ObjectRef` 能表达
 * 的 ACL 对象）。真正的裁决是"调用者是不是平台运营准入"——由 interface 层的
 * `PlatformOperatorGuard` 判（见新增的平台级抽取设置 controller），这个端口本身对谁能调
 * 一无所知，和 `KgOrgExtractionSettingsPort` 的读写口对「谁是组织 admin」一无所知同一个理由。
 *
 * ## 默认值
 *
 * 迁移 20260925120000 把这一行的默认值、以及既有的单例行都改成了 `true`——继续默认关
 * 只是把"忘了开"这个坑从"忘了设环境变量"换成"忘了调一次后台接口"，没有解决问题；真正
 * 配置了模型 provider 的部署（`KgExtractionModelConfig.enabled`），绝大多数打算就是要用
 * 知识图谱。
 */
export interface KgDeploymentExtractionSettingsPort {
  /** `kg_extraction_state` 单例行的现值。 */
  getEnabled(): Promise<boolean>;
  /** 双向切换；返回写入后的现值（防御性——同 `KgOrgExtractionSettingsPort.setEnabled`）。 */
  setEnabled(enabled: boolean, updatedByUserId: string): Promise<boolean>;
}

export const KG_DEPLOYMENT_EXTRACTION_SETTINGS_PORT = Symbol("KgDeploymentExtractionSettingsPort");

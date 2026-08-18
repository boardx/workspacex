/**
 * 对话读取的存储端口。定义在这里，由 `infrastructure` 实现。
 *
 * `findThreadFacts` / `findMessages` 的拆分与 F03 的 `findItemFacts` / `findItemBody`
 * 同一个理由：判定要用的属性和**正文**分两次取，正文只在判定说「可以」之后才进内存。
 * 一次性把正文取到手，再靠后面每条分支记得别返回它，就是把「有没有泄露」
 * 押在未来每一次修改上。
 */
import type { OrgId } from "../../domain/org-id";
import type { MessageFacts, ThreadFacts } from "../../domain/chat/thread-visibility";
import type { AgentPanelAgent } from "../../domain/chat/agent-presence";
import type { Guarded } from "../security/permission-filter";

/** 一条消息的正文与作者信息。**只在判定通过后取**。 */
export interface ChatMessageRow extends MessageFacts {
  readonly authorKind: "human" | "agent";
  readonly authorId: string;
  readonly agentId: string | null;
  readonly body: string;
  /**
   * I-13 的唯一事实源（迁移 0029 的 `chat_messages.review_pending`）。
   * 列表的「N 条待复核」与详情的「待复核 N」都只经 `messageBadges()` 读它。
   */
  readonly reviewPending: boolean;
  readonly createdAt: string;
}

/** 只用于展示的线程字段。判定用不到它们，所以判定也不该拿到它们。 */
export interface ThreadPresentation {
  readonly phase: "onsite" | "research";
  readonly lastActivityAt: string;
  readonly version: number;
}

/**
 * 列表用的线程行（F109）。
 *
 * ⚠ 这里**没有**任何徽标字段：徽标由 `domain/chat/thread-badges.ts` 一处算出（I-13）。
 *   仓储给的是**事实**（有没有在录的转录会话、有没有待复核的消息），不是**结论**。
 *   把 `reviewPendingCount` 做成一次 SQL 聚合会更快，也会立刻产生第二处计算：
 *   SQL 那份与 `messageBadges()` 那份，在「哪些消息算待复核」上早晚分家。
 */
export interface ThreadListRow extends ThreadFacts {
  readonly title: string;
  readonly agentPrivate: boolean;
  readonly lastActivityAt: string;
  readonly version: number;
  /** I-14：**事实**——存在一个 `stopped_at IS NULL` 的转录会话。不是由时间推断的。 */
  readonly transcribing: boolean;
}

/** 线程的 `messages.jsonl` 指针（I-16）。**不是第二个文件表**——见迁移 0029 头部。 */
export interface ThreadFileRecord {
  readonly artifactId: string;
  readonly objectKey: string;
  readonly sha256: string;
  readonly sizeBytes: number;
}

export interface NewThreadInput {
  readonly orgId: OrgId;
  readonly threadId: string;
  /** 🔴 #594：`null` = 个人线程，不挂靠任何项目。 */
  readonly projectId: string | null;
  readonly groupId: string | null;
  readonly title: string;
  readonly visibilityScope: string;
  readonly createdBy: string;
}

/* ── F110：AI 团队面板 / 编制（chat 束 domain.md I-17 / I-18）─────────────── */

/** 编制读出的整包：agent 列表 + 乐观并发用的 roster 版本号。 */
export interface AgentRosterState {
  readonly agents: readonly AgentPanelAgent[];
  readonly rosterVersion: number;
}

/**
 * `updateAgentRoster` 的结果。**判别联合，不是布尔 + 抛异常**——
 * 三种拒绝（版本变了 / agent 越范围 / agent 不存在）在仓储层是三个不同的数据事实
 * （版本比对 / 目录里查不到 / 编制里没有这一行），仓储只负责报告事实，
 * 由 `application/chat/update-agent-roster.ts` 决定映射成哪个错误类型——
 * 与 `renameThread` 返回 `null` 表示版本变了同一个理由，只是这里有三种事实要分。
 */
export type UpdateAgentRosterOutcome =
  | { readonly kind: "ok"; readonly rosterVersion: number; readonly agents: readonly AgentPanelAgent[] }
  | { readonly kind: "version-changed" }
  | { readonly kind: "agent-out-of-scope"; readonly agentId: string }
  | { readonly kind: "agent-not-found"; readonly agentId: string };

export interface ChatRepository {
  /** 判定所需的线程属性，不含正文。线程不存在返回 null。 */
  findThreadFacts(orgId: OrgId, threadId: string): Promise<ThreadFacts | null>;

  /** 展示字段。**判定通过后**才调用。 */
  findThreadPresentation(orgId: OrgId, threadId: string): Promise<ThreadPresentation | null>;

  /**
   * 该线程的全部消息（含正文），包在 `Guarded` 里。
   *
   * 不是裸数组：`Guarded<T>` 里取不出 `T`，除非交出一个 `PermissionDecision`
   * （`discloseDecided`）。于是「忘了判权」从一个疏漏变成一个类型错误——
   * 这正是 F02 的守卫读路径存在的理由，对话正文没有理由例外。
   */
  findMessages(orgId: OrgId, threadId: string): Promise<Guarded<ChatMessageRow[]> | null>;

  /**
   * 消息条数。COUNT，不是取回列表再数长度——
   * 「只返计数、不返正文」最可靠的实现方式是正文根本没被加载（I-8）。
   */
  countMessages(orgId: OrgId, threadId: string): Promise<number>;

  /* ── F109 ─────────────────────────────────────────────────────────── */

  /**
   * 一个项目下的**候选**线程行。
   *
   * ⚠ 「候选」是要点：这里**不做可见性过滤**。过滤由 `resolveVisibility` 逐条判，
   *   与 `getThread` 走同一个门（I-12 的同源要求对列表一样成立）。
   *   在 SQL 里写一句「只返回我看得见的」会更快，也会是第二份可见性实现——
   *   `pg-chat-repository.ts` 头部那条规矩对列表不例外。
   *
   * `includeArchived === false` 时不返回归档线程（I-15：默认筛选不返回）。
   */
  listProjectThreads(
    orgId: OrgId,
    projectId: string,
    opts: { includeArchived: boolean },
  ): Promise<readonly ThreadListRow[]>;

  /**
   * 🔴 #594 —— 一个用户自己名下的**候选**个人线程行（`project_id IS NULL AND
   * created_by = userId`）。与 `listProjectThreads` 同一条纪律：**不做可见性过滤**，
   * 过滤仍然逐条经 `resolveVisibility`（`application/chat/list-personal-threads.ts`）。
   * 这里 WHERE 里的 `created_by = userId` 不是「过滤」，是缩小候选集合的**性能**手段
   * ——个人线程本来就只有创建者能看，不查这一列会让每个用户在每次列表时把全组织
   * 的个人线程都判一遍权，答案不会错但会很慢。真正决定「能不能看」的判断仍在
   * `resolveVisibility` 里，不在这条 WHERE 里。
   */
  listPersonalThreads(
    orgId: OrgId,
    userId: string,
    opts: { includeArchived: boolean },
  ): Promise<readonly ThreadListRow[]>;

  /** 在本线程发过言的不同 agent id（`agentCount` 的事实来源）。 */
  findSpeakingAgentIds(orgId: OrgId, threadId: string): Promise<readonly string[]>;

  createThread(input: NewThreadInput): Promise<void>;

  /**
   * 改名 / 删除。乐观并发：`expectedVersion` 不匹配返回 `null`，**不静默覆盖**（V7）。
   * 匹配时返回新版本号。
   */
  renameThread(
    orgId: OrgId,
    threadId: string,
    title: string,
    expectedVersion: number,
  ): Promise<number | null>;

  /** 删除。返回 `null` 表示版本已变；返回条数用于 `impactScope`（删除是可追溯动作）。 */
  deleteThread(
    orgId: OrgId,
    threadId: string,
    expectedVersion: number,
  ): Promise<{ messageCount: number } | null>;

  findThreadFile(orgId: OrgId, threadId: string): Promise<ThreadFileRecord | null>;

  /**
   * 登记线程的 `messages.jsonl` 指针。**主键是 `thread_id`** ⇒ 第二次登记同一线程
   * 会撞主键（I-16「恰好一个」由数据库回答，不由这里的 if 回答）。
   */
  recordThreadFile(orgId: OrgId, threadId: string, file: ThreadFileRecord): Promise<void>;

  /* ⚠ 这里**没有**转录会话的开/停方法，是刻意的：转录卡控制是 F113 的
   *   `controlTranscriptCard`（契约里已有那个端口）。F109 只**读**这个状态。
   *   在这里补一对写方法，会让下一个做 F113 的人以为开停已经有实现了，
   *   于是他要么在别处再写一份，要么把一个从未被调用过的方法当成已验证的。 */

  /* ── F110：AI 团队面板 / 编制 ─────────────────────────────────────── */

  /**
   * 读线程的 agent 编制。线程不存在返回 `null`（与其余读端口同一个「不存在」出口，
   * 由调用方并入 `ThreadNotVisibleError`）。
   *
   * ⚠ 这里返回**全部**编制行，presence 三值都在——I-18 的两个计数由
   *   `domain/chat/agent-presence.ts` 的 `agentPanelCounts()` 对这份列表算，
   *   仓储不在 SQL 里算计数（同 F109 `listProjectThreads` 的态度：候选给全，判定/计数在别处）。
   */
  findAgentRoster(orgId: OrgId, threadId: string): Promise<AgentRosterState | null>;

  /**
   * 改编制：一次原子操作里加一批、移一批。
   *
   * ⚠ **部分成功即整体拒绝**（契约 `updateAgentRoster` 注释逐字）：`add` 里第一个
   *   越范围的 agent 就让整个调用连同已经"验证通过"的其余 add/remove 一起回滚，
   *   不做"加进去 2 个、拒了 1 个"的半成品——实现方式是整个方法在**一个事务**里跑完
   *   校验与写入，校验失败直接返回拒绝态、不执行任何 INSERT/DELETE/UPDATE。
   */
  updateAgentRoster(
    orgId: OrgId,
    threadId: string,
    add: readonly string[],
    remove: readonly string[],
    expectedRosterVersion: number,
  ): Promise<UpdateAgentRosterOutcome>;

  /* ── F111：工具调用链与引用（chat 束 domain.md D 组）───────────────────── */

  /**
   * 一条消息所属的线程与项目。**判权与查询都要从它起步**——`expandToolCallChain` /
   * `locateCitation` 的契约输入只有 `messageId`（没有 `projectId`/`threadId`），
   * 而 `resolveVisibility` 要这两者才能判。消息不存在返回 `null`。
   */
  findMessageLocation(orgId: OrgId, messageId: string): Promise<MessageLocation | null>;

  /**
   * 落一条 assistant 消息进线程（design-delta chat-persona-roundtrip G2，confirmed
   * 2026-08-18）：`summarizePersonaFromThread` 把画像 mindmap 围栏以 assistant 消息
   * 写进消息流。列语义与 `commitWriteback`（agent 回复写回）同一张表同一批列：
   * `author_kind='agent'`；`agent_id` 为 null——这不是某个已发布 Agent 的回复，
   * 是 persona 汇总端口自己的产出，`authorId` 用调用方传入的稳定端口标识。
   * `replyToMessageId` = 触发汇总的锚点消息（同一条出处回链事实的消息侧投影）。
   * 判权**不在这里**（与本仓储其余写方法同一条纪律）——调用方已过 `resolveVisibility`。
   */
  insertAssistantMessage(
    orgId: OrgId,
    input: {
      readonly id: string;
      readonly threadId: string;
      readonly authorId: string;
      readonly body: string;
      readonly replyToMessageId: string | null;
    },
  ): Promise<void>;

  /**
   * 引用锚点 kind 为 `message` 时，被指的那条消息**是否存在于本组织**（同租户即可，
   * 不额外判可见性——I-24 问的是"能不能定位到原件"，不是"当前请求者能不能读"）。
   */
  messageExists(orgId: OrgId, messageId: string): Promise<boolean>;

  /** 一条引用的完整记录。不存在返回 `null`。 */
  findCitation(orgId: OrgId, citationId: string): Promise<ChatCitationRow | null>;

  /**
   * 一条消息挂着的全部引用（F114 · uc-8-3）。**这是 `hasSource` 与"100% 可定位"
   * 两条判定共同的数据来源**——`landAsArtifact` 用它算 `citationCount` 与逐条
   * 定位，不另开一条"数一下有没有引用"的查询：两处若各查一次，字段名或过滤条件
   * 早晚在某次改动里分家。
   */
  findCitationsForMessage(orgId: OrgId, messageId: string): Promise<readonly ChatCitationRow[]>;

  /**
   * 引用的来源材料是否仍然存在（`SOURCE_ARTIFACT_DELETED`）。
   * `sourceArtifactId` 为 `null` 时不适用，调用方不应调这个方法。
   */
  artifactExists(orgId: OrgId, artifactId: string): Promise<boolean>;

  /* ── F112：批准闸门（chat 束 domain.md E 组，uc-8-2）───────────────────── */

  /** 落一条新的批准请求，恒以 `paused` 落库（I-27）。 */
  createApprovalRequest(orgId: OrgId, input: NewApprovalRequestInput): Promise<ApprovalRequestRow>;

  /** 读一条批准请求。不存在返回 `null`。 */
  findApprovalRequest(orgId: OrgId, requestId: string): Promise<ApprovalRequestRow | null>;

  /**
   * 状态转移的唯一写口——`UPDATE ... WHERE status = 'paused'`，**乐观并发由数据库回答**
   * （I-29：单向且一次性）。0 行受影响即返回 `null`，由 application 层判定是「已终态」
   * 还是「已过期」并映射成对应的对外错误。
   *
   * ⚠ **approve/decline 就地改写这一行的 `status`；reparam 额外插入一行新请求**
   * （I-30：原请求六项披露字节不变，只改 `status` 与 `superseded_by_request_id`）。
   * 三种出口共用一次原子写，调用方（`decide-approval.ts`）负责准备好
   * `ApprovalDecisionWrite` 描述的全部字段，仓储不做任何决策。
   */
  decideApprovalRequest(
    orgId: OrgId,
    requestId: string,
    write: ApprovalDecisionWrite,
  ): Promise<ApprovalRequestRow | null>;

  /** 批准后转的后台任务。见迁移文件头：11-task 队列未落地前的最小占位实现。 */
  createBackgroundTask(orgId: OrgId, input: NewBackgroundTaskInput): Promise<void>;

  findBackgroundTask(orgId: OrgId, taskId: string): Promise<BackgroundTaskRow | null>;
}

/** 批准卡的数据范围条目——与契约 `ApprovalDataScope` 同形，仓储层只转述不重定义。 */
export interface ApprovalDataScopeRow {
  readonly name: string;
  readonly confidential: boolean;
}

export interface NewApprovalRequestInput {
  readonly id: string;
  readonly threadId: string;
  readonly agentId: string;
  readonly action: string;
  readonly callChain: readonly string[];
  readonly proposedModels: readonly string[];
  readonly dataScope: readonly ApprovalDataScopeRow[];
  readonly estimatedTokens: number;
  readonly expiresAt: string;
}

export type ApprovalRequestStatusRow = "paused" | "approved" | "reparamed" | "declined" | "expired";

export interface ApprovalRequestRow {
  readonly id: string;
  readonly threadId: string;
  readonly agentId: string;
  readonly action: string;
  readonly status: ApprovalRequestStatusRow;
  readonly callChain: readonly string[];
  readonly proposedModels: readonly string[];
  readonly dataScope: readonly ApprovalDataScopeRow[];
  readonly estimatedTokens: number;
  readonly expiresAt: string;
  readonly taskId: string | null;
  readonly supersedesRequestId: string | null;
  readonly supersededByRequestId: string | null;
}

/** 一次状态转移的写入描述——`decide-approval.ts` 组装，仓储只负责原子写。 */
export type ApprovalDecisionWrite =
  | { readonly kind: "approve"; readonly decidedBy: string; readonly taskId: string }
  | { readonly kind: "decline"; readonly decidedBy: string }
  | {
      readonly kind: "reparam";
      readonly decidedBy: string;
      readonly newRequest: NewApprovalRequestInput;
    }
  | { readonly kind: "expire" };

export interface NewBackgroundTaskInput {
  readonly taskId: string;
  readonly approvalRequestId: string;
  readonly etaMinutes: number;
}

export type BackgroundTaskStatusRow =
  "queued" | "running" | "needs-input" | "done" | "failed" | "cancelled";

export interface BackgroundTaskRow {
  readonly taskId: string;
  readonly status: BackgroundTaskStatusRow;
  readonly resultMessageId: string | null;
}

export const CHAT_REPOSITORY = Symbol("ChatRepository");

/* ══════════════════ F115：预设对话（chat 束 domain.md G 组，uc-8-4）══════════════════ */

/** 预设的持久化形状。**版本按 `chat_presets.version` 管理**，见迁移文件头对
 * 「为什么不接 `artifact_versions`」的说明——这是本 feature 的一处已知简化。 */
export interface PresetRecord {
  readonly id: string;
  readonly projectId: string;
  readonly openingPrompt: string;
  readonly skills: readonly string[];
  readonly agents: readonly string[];
  readonly version: number;
  readonly createdBy: string;
}

/**
 * `upsertPreset` 的仓储结果。**判别联合，不是布尔 + 抛异常**——与
 * `UpdateAgentRosterOutcome`（F110）同一个理由：版本冲突是仓储层的一个数据事实
 * （`UPDATE ... WHERE version = $expected` 影响 0 行），由 application 层决定
 * 映射成哪个对外错误。
 */
export type UpsertPresetOutcome =
  | { readonly kind: "ok"; readonly presetId: string; readonly version: number }
  | { readonly kind: "version-changed" };

export interface UpsertPresetRepoInput {
  readonly presetId: string;
  readonly isNew: boolean;
  readonly openingPrompt: string;
  readonly skills: readonly string[];
  readonly agents: readonly string[];
  readonly expectedVersion: number | null;
  readonly createdBy: string;
}

/** 下发记录（幂等重放的落点，契约「同一 (presetId, targets, version) 返回同一 dispatchId」）。 */
export interface PresetDispatchRecord {
  readonly dispatchId: string;
  readonly targetCount: number;
}

/** 一次实例（预设的一次「开始」），与 `chat_threads` 的一行绑定（I-39 复用既有可见性）。 */
export interface PresetInstanceRecord {
  readonly threadId: string;
  readonly instanceId: string;
}

export interface ChatPresetRepository {
  findPreset(orgId: OrgId, presetId: string): Promise<PresetRecord | null>;

  /**
   * 创建 / 编辑预设。**不可变的是每一个历史版本**：编辑生成新版本号，不覆盖旧版本的语义
   * （已知简化：本表不像 F04 那样另存每个历史版本的完整快照，只保留当前版本 + 版本号
   * 单调递增，见迁移文件头「为什么不接 artifact_versions」）。
   */
  upsertPreset(
    orgId: OrgId,
    projectId: string,
    input: UpsertPresetRepoInput,
  ): Promise<UpsertPresetOutcome>;

  /**
   * agent/skill 是否存在于组织目录（`org_agents` / `org_skills`，同 F110 的占位纪律，
   * 见迁移文件头）。返回第一个不在目录里的 id；全部存在则两者皆 null。
   *
   * ⚠ 这**不是** I-40 要求的「下发对象可见性范围」判定——那份数据来自 F15，跨分片依赖
   *   未落地（见 `domain/chat/preset-dispatch-scope.ts` 文件头）。这里只做「存不存在」，
   *   `dispatchPreset` 用它顶替真正的范围判定，是已登记的已知简化，不是结论。
   */
  findOutOfScopeResource(
    orgId: OrgId,
    agentIds: readonly string[],
    skillIds: readonly string[],
  ): Promise<{ readonly kind: "agent" | "skill"; readonly id: string } | null>;

  /** 下发对象命中的用户数（`targetCount`——能取用的人数，不是已创建实例数）。 */
  countDispatchTargets(
    orgId: OrgId,
    projectId: string,
    targets: { readonly plenary: boolean; readonly groupIds: readonly string[]; readonly roles: readonly string[] },
  ): Promise<number>;

  /** 幂等重放：同一 (presetId, targetsFingerprint, version) 已下发过就返回原记录。 */
  findExistingDispatch(
    orgId: OrgId,
    presetId: string,
    targetsFingerprint: string,
    version: number,
  ): Promise<PresetDispatchRecord | null>;

  recordDispatch(
    orgId: OrgId,
    presetId: string,
    targetsFingerprint: string,
    version: number,
    targetCount: number,
    targets: { readonly plenary: boolean; readonly groupIds: readonly string[]; readonly roles: readonly string[] },
  ): Promise<PresetDispatchRecord>;

  /** 该 actor 是否在某次下发的目标范围内（`NOT_DISPATCHED_TO_ACTOR` 判定用）。 */
  isActorDispatchTarget(
    orgId: OrgId,
    presetId: string,
    projectId: string,
    actorId: string,
  ): Promise<boolean>;

  /** 幂等重放：同一人重复「开始」返回同一实例（I-38）。 */
  findInstanceForActor(
    orgId: OrgId,
    presetId: string,
    actorId: string,
  ): Promise<PresetInstanceRecord | null>;

  /**
   * 落一个新实例：**建一行普通线程**（复用 F108/F109 既有的可见性与生命周期机制，
   * `visibilityScope: "private"` ⇒ 仅创建者可读，I-39 天然成立，不另立第二套判定）
   * 加一行 `chat_preset_instances` 登记。两者在**同一个事务**里完成。
   */
  createPresetInstance(
    orgId: OrgId,
    presetId: string,
    actorId: string,
    newThread: NewThreadInput,
  ): Promise<PresetInstanceRecord>;

  /** 该预设的全部实例事实（`startedBy` 用于 I-38 的 usageCount 计算）。 */
  listPresetInstances(
    orgId: OrgId,
    presetId: string,
  ): Promise<ReadonlyArray<{ readonly instanceId: string; readonly startedBy: string }>>;
}

export const CHAT_PRESET_REPOSITORY = Symbol("ChatPresetRepository");

/** 见上面 `findMessageLocation`。 */
export interface MessageLocation {
  readonly threadId: string;
  readonly projectId: string;
}

/**
 * 一条引用的落库形状（F111）。**这是 `chat.Citation` 唯一的持久化点**——消息读路径
 * （`get-thread.ts` 的 `toMessage`）目前把 `citations` 写死成 `[]`，是已登记的缺口
 * （契约没有消息创建端口，写入侧还没有着落）；本表存在的意义是让 `locateCitation`
 * 有一个真实的"原件"可定位，而不是让这条链路整体停在 mock 阶段。
 */
export interface ChatCitationRow {
  readonly citationId: string;
  readonly messageId: string;
  readonly index: number;
  readonly sourceFullName: string;
  readonly anchorKind: "page" | "transcript" | "message";
  readonly anchorPage: number | null;
  readonly anchorRange: string | null;
  readonly anchorMessageId: string | null;
  /** 引用来源的 artifact，非空时才需要判 `SOURCE_ARTIFACT_DELETED`。 */
  readonly sourceArtifactId: string | null;
}

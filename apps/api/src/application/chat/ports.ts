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
  readonly projectId: string;
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
}

export const CHAT_REPOSITORY = Symbol("ChatRepository");

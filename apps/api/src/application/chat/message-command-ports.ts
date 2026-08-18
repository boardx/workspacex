import type { OrgId } from "../../domain/org-id";
import type { Guarded } from "../security/permission-filter";

export interface PublishedAgentSnapshot {
  readonly agentId: string;
  readonly agentVersionId: string;
  readonly skillVersionIds: readonly string[];
  readonly modelProvider: string;
  readonly modelId: string;
  /**
   * The pinned version's system instructions.
   *
   * Added for `trialRunAgent` (agent-runtime bundle, #595 Line A), which needs the same
   * "one published Agent version, resolved by id" fact this port already answers for the
   * Chat acceptance path -- just with one more column read off the same row. The acceptance
   * path (`pg-chat-message-command-repository.ts`'s `accept`) does not read this field; it
   * only exists here so trial run does not open a second query path to `agent_versions`.
   */
  readonly instructions: string;
}

/** Consumer boundary implemented by the durable Agent catalog from #417. */
export interface PublishedAgentReader {
  resolvePublished(orgId: OrgId, agentId: string): Promise<PublishedAgentSnapshot | null>;
}

export const PUBLISHED_AGENT_READER = Symbol("PublishedAgentReader");

/**
 * #1559 —— **会话内临时挂载（F65）在 run 构建路径上的读口。**
 *
 * ## 为什么它在这里，而不是复用 `ThreadMountStorePort`
 *
 * `ThreadMountStorePort`（`application/skill/ports.ts`）的形状是「读出整份列表 →
 * 用例算 → 写回」，服务的是挂载/摘除这两个写用例。run 构建要的是另一个问题的答案：
 * **这条线程此刻生效、且运行时读得到的那些 skill 版本 id**。用前者会把「哪些行
 * 运行时读得到」这个判定散到调用方去（见下条），而那正是 #1559 的形状。
 *
 * ## 返回值只含**模型 A**（`skills` / `skill_versions`）的版本 id
 *
 * `readPinnedSkills`（`pg-agent-run-repository.ts`）只读模型 A。把一条模型 B 的存量
 * 挂载塞进 `agent_runs.skill_version_ids`，`execute-run.ts` 会因为「钉了 N 个、读回
 * M < N 个」以 `SKILL_VERSION_UNAVAILABLE` 让整次 run 失败——把一个存量数据问题
 * 变成一次用户可见故障。判别发生在适配器的那条 SQL 里（JOIN 得上 `skill_versions`
 * + `skills` 就是模型 A），与运行时自己的可达性条件同源，不是第二份规则。
 * 为什么不是一个库级外键 / 判别列：见适配器
 * `pg-thread-mounted-skill-reader.ts` 头注——#1534（已合入）已把那件事裁给应用层。
 *
 * ⚠ 这**不是**静默 fallback：被排除的只有运行时**结构上**读不到的存量模型 B 行
 *   （F190 之后不可能新增），它们在挂载列表里照常显示。模型 A 的挂载不筛
 *   `published`：版本被取消发布时那次 run 应该明确失败，不该被悄悄过滤掉。
 *
 * 顺序：`mounted_at, mount_id` 升序（先挂的在前）——`skillVersionIds` 的顺序是语义
 * 属性（`execute-run.ts` 的 `buildSystemPrompt` 头注），所以它必须是确定的。
 */
export interface ThreadMountedSkillReader {
  /**
   * ⚠ 返回 `Guarded`，与本文件其余读口（`findAccepted` / `page`）同一条纪律：
   *   调用方必须先 `discloseDecided` 才拿得到值。判权其实已经在
   *   `acceptHumanMessage` 的 `authorize()` 里做完了，但「已经判过了」是一句
   *   **约定**——`lint-permission-paths.mjs` 只认结构（仓储 import 了
   *   `permission-filter` 才算走在受判读路径上），而它是对的：一个返回裸数组的
   *   租户读口，下一个调用方就能在没判权的地方用上它。
   *
   * `projectId` 与本文件其余读口一样只是 `Guarded` 的描述性元数据；个人线程
   *   （`projectId === null`）用合成 id，同 `findAccepted` 的先例。
   */
  activeMountedSkillVersionIds(
    orgId: OrgId,
    input: { projectId: string | null; threadId: string },
  ): Promise<Guarded<readonly string[]>>;
}

export const THREAD_MOUNTED_SKILL_READER = Symbol("ThreadMountedSkillReader");

export interface AcceptedHumanMessage {
  readonly id: string;
  readonly threadId: string;
  readonly authorId: string;
  readonly text: string;
  readonly clientMessageId: string;
  readonly requestedAgentId: string;
  readonly createdAt: string;
  readonly agentRunId: string;
  readonly runStatus: "queued";
}

/**
 * #946 · V9-a F151：消息挂的附件投影（listMessages 回读一份）。形状与契约 `Attachment`
 * 一致（id/filename/mime/bytes/createdAt），是那份的**运行时映射**，不另立第二事实源。
 */
export interface MessageAttachment {
  readonly id: string;
  readonly filename: string;
  readonly mime: string;
  readonly bytes: number;
  readonly createdAt: string;
}

/**
 * #946 · V9-a F151：`accept` 里挂附件时，attachmentIds 有 id 不属本线程 / 已挂过别的消息 /
 * 不存在——由仓储在**同一事务内**抛出，回滚整条消息写入（原子）。用例 catch 后转
 * `MessageAttachmentNotPendingError`，控制器映射 422 `ATTACHMENT_NOT_PENDING`。
 */
export class AttachmentNotPendingError extends Error {
  constructor() {
    super("ATTACHMENT_NOT_PENDING");
    this.name = "AttachmentNotPendingError";
  }
}

export interface MessagePageRow {
  readonly id: string;
  readonly authorKind: "human" | "agent";
  readonly authorId: string;
  readonly agentId: string | null;
  readonly text: string;
  readonly clientMessageId: string | null;
  readonly agentRunId: string | null;
  readonly replyToMessageId: string | null;
  readonly rawTranscript: boolean;
  readonly visibilityScope: string | null;
  readonly createdAt: string;
}

export type AcceptMessageOutcome =
  | { readonly kind: "created" | "replay"; readonly accepted: AcceptedHumanMessage }
  | { readonly kind: "conflict" };

/**
 * 🔴 #594：三处 `projectId` 全部改成 `string | null`——`null` = 消息挂在一条
 * 个人线程上。仓储实现只把它当一个可为空的过滤/落库字段用，**不做任何判权**
 * （判权已经在 `message-roundtrip.ts` 调 `resolveVisibility` 那一步做完了，
 * 见 `ports.ts` 文件头「正文只在判定通过后取」）。
 */
export interface ChatMessageCommandRepository {
  findAccepted(
    orgId: OrgId,
    input: { projectId: string | null; threadId: string; actorId: string; clientMessageId: string },
  ): Promise<Guarded<AcceptedHumanMessage | null>>;

  accept(
    orgId: OrgId,
    input: {
      threadId: string;
      projectId: string | null;
      actorId: string;
      clientMessageId: string;
      text: string;
      selectedAgentId: string;
      messageId: string;
      runId: string;
      snapshot: PublishedAgentSnapshot;
      /**
       * #946 · V9-a F151：挂到这条消息上的 pending 附件 id（已去重、≤10）。在**同一事务内**
       * set message_id；任一 id 不属本线程/已挂过/不存在 ⇒ 抛 `AttachmentNotPendingError`
       * 回滚整条消息（消息与挂附件是一个原子动作）。空/缺省 = 不挂附件。
       */
      attachmentIds?: readonly string[];
    },
  ): Promise<Guarded<AcceptMessageOutcome>>;

  /**
   * #946 · V9-a F151：按消息 id 批量回读附件（listMessages 投影）。返回 messageId → 附件数组
   * （按 createdAt,id 升序）。无附件的消息不在 map 里。
   */
  attachmentsByMessage(
    orgId: OrgId,
    messageIds: readonly string[],
  ): Promise<ReadonlyMap<string, readonly MessageAttachment[]>>;

  page(
    orgId: OrgId,
    input: {
      threadId: string;
      projectId: string | null;
      after: { createdAt: string; messageId: string } | null;
      limit: number;
    },
  ): Promise<Guarded<{ rows: readonly MessagePageRow[]; hasMore: boolean }>>;
}

export const CHAT_MESSAGE_COMMAND_REPOSITORY = Symbol("ChatMessageCommandRepository");

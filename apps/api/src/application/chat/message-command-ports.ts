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

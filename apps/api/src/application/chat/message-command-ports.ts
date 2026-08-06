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
    },
  ): Promise<Guarded<AcceptMessageOutcome>>;

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

import type { OrgId } from "../../domain/org-id";
import type { Guarded } from "../security/permission-filter";

export interface PublishedAgentSnapshot {
  readonly agentId: string;
  readonly agentVersionId: string;
  readonly skillVersionIds: readonly string[];
  readonly modelProvider: string;
  readonly modelId: string;
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

export interface ChatMessageCommandRepository {
  findAccepted(
    orgId: OrgId,
    input: { projectId: string; threadId: string; actorId: string; clientMessageId: string },
  ): Promise<Guarded<AcceptedHumanMessage | null>>;

  accept(
    orgId: OrgId,
    input: {
      threadId: string;
      projectId: string;
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
      projectId: string;
      after: { createdAt: string; messageId: string } | null;
      limit: number;
    },
  ): Promise<Guarded<{ rows: readonly MessagePageRow[]; hasMore: boolean }>>;
}

export const CHAT_MESSAGE_COMMAND_REPOSITORY = Symbol("ChatMessageCommandRepository");

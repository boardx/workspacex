import { randomUUID } from "node:crypto";
import type { OrgId } from "../../domain/org-id";
import { observerMayReadMessage } from "../../domain/chat/thread-visibility";
import type { ResolveVisibilityDeps } from "./resolve-visibility";
import { resolveVisibility } from "./resolve-visibility";
import type {
  AcceptedHumanMessage, ChatMessageCommandRepository, MessagePageRow, PublishedAgentReader,
} from "./message-command-ports";
import { discloseDecided, isDisclosed } from "../security/permission-filter";

export class MessageThreadNotVisibleError extends Error {}
export class MessageNoWriteRoleError extends Error {}
export class MessageThreadArchivedError extends Error {}
export class AgentNotPublishedError extends Error {}
export class MessageIdempotencyConflictError extends Error {}
export class InvalidMessageCursorError extends Error {}

interface Deps extends ResolveVisibilityDeps {
  readonly commands: ChatMessageCommandRepository;
  readonly publishedAgents: PublishedAgentReader;
}

async function authorize(deps: Deps, input: { userId: string; orgId: OrgId; threadId: string }) {
  const facts = await deps.chat.findThreadFacts(input.orgId, input.threadId);
  if (facts === null) throw new MessageThreadNotVisibleError();
  const outcome = await resolveVisibility(deps, { ...input, projectId: facts.projectId });
  if (outcome.kind !== "allow") throw new MessageThreadNotVisibleError();
  return outcome;
}

function samePayload(
  accepted: AcceptedHumanMessage,
  input: { text: string; selectedAgentId: string },
): boolean {
  return accepted.text === input.text && accepted.requestedAgentId === input.selectedAgentId;
}

export async function acceptHumanMessage(
  deps: Deps,
  input: {
    userId: string; orgId: OrgId; threadId: string; clientMessageId: string;
    text: string; agentId: string;
  },
): Promise<AcceptedHumanMessage> {
  const visibility = await authorize(deps, input);
  if (visibility.actor.projectRole === "observer") throw new MessageNoWriteRoleError();
  if (visibility.thread.archived) throw new MessageThreadArchivedError();

  const key = {
    projectId: visibility.thread.projectId, threadId: input.threadId,
    actorId: input.userId, clientMessageId: input.clientMessageId,
  };
  const guardedExisting = await deps.commands.findAccepted(input.orgId, key);
  const disclosedExisting = discloseDecided(guardedExisting, visibility.base);
  if (!isDisclosed(disclosedExisting)) throw new MessageThreadNotVisibleError();
  const existing = disclosedExisting.payload;
  if (existing) {
    if (!samePayload(existing, { text: input.text, selectedAgentId: input.agentId })) {
      throw new MessageIdempotencyConflictError();
    }
    return existing;
  }

  const snapshot = await deps.publishedAgents.resolvePublished(input.orgId, input.agentId);
  if (snapshot === null) throw new AgentNotPublishedError();
  const guardedOutcome = await deps.commands.accept(input.orgId, {
    ...key,
    text: input.text,
    selectedAgentId: input.agentId,
    messageId: randomUUID(),
    runId: randomUUID(),
    snapshot,
  });
  const disclosedOutcome = discloseDecided(guardedOutcome, visibility.base);
  if (!isDisclosed(disclosedOutcome)) throw new MessageThreadNotVisibleError();
  const outcome = disclosedOutcome.payload;
  if (outcome.kind === "conflict") throw new MessageIdempotencyConflictError();
  return outcome.accepted;
}

function encodeCursor(row: MessagePageRow): string {
  return Buffer.from(JSON.stringify([row.createdAt, row.id]), "utf8").toString("base64url");
}

function decodeCursor(value: string | undefined): { createdAt: string; messageId: string } | null {
  if (value === undefined || value === "") return null;
  try {
    const parsed: unknown = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    if (!Array.isArray(parsed) || parsed.length !== 2 ||
        typeof parsed[0] !== "string" || Number.isNaN(Date.parse(parsed[0])) ||
        typeof parsed[1] !== "string" || parsed[1] === "") {
      throw new Error("invalid");
    }
    return { createdAt: new Date(parsed[0]).toISOString(), messageId: parsed[1] };
  } catch {
    throw new InvalidMessageCursorError();
  }
}

export async function listMessagePage(
  deps: Deps,
  input: { userId: string; orgId: OrgId; threadId: string; cursor?: string; limit?: number },
) {
  const visibility = await authorize(deps, input);
  const limit = Math.min(100, Math.max(1, input.limit ?? 50));
  const guardedPage = await deps.commands.page(input.orgId, {
    projectId: visibility.thread.projectId, threadId: input.threadId,
    after: decodeCursor(input.cursor), limit,
  });
  const disclosedPage = discloseDecided(guardedPage, visibility.base);
  if (!isDisclosed(disclosedPage)) throw new MessageThreadNotVisibleError();
  const page = disclosedPage.payload;
  const rows = visibility.actor.projectRole === "observer"
    ? page.rows.filter((row) => observerMayReadMessage({
      id: row.id, rawTranscript: row.rawTranscript,
      visibilityScope: row.visibilityScope as typeof visibility.thread.visibilityScope | null,
    }, visibility.thread))
    : page.rows;
  return {
    messages: rows.map((row) => ({
      id: row.id,
      authorKind: row.authorKind,
      authorId: row.authorId,
      agentId: row.agentId,
      text: row.text,
      clientMessageId: row.clientMessageId,
      agentRunId: row.agentRunId,
      replyToMessageId: row.replyToMessageId,
      createdAt: row.createdAt,
    })),
    nextCursor: page.hasMore && page.rows.length > 0 ? encodeCursor(page.rows.at(-1)!) : null,
  };
}

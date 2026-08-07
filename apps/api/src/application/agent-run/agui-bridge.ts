/**
 * `runAguiBridgeTurn` -- the orchestration behind the AG-UI SSE bridge (#654 Phase 1b).
 *
 * ## What this is, and is not
 *
 * This is NOT a new way to run an Agent. It composes three EXISTING, already-authorized
 * application functions in the order the Chat HTTP surface already uses them:
 *
 *   1. `mutateThread` (op:"create", projectId:null) -- only when the caller has no thread
 *      yet, to give a fresh AG-UI session a place to write into. Identical to what
 *      `PersonalChatScreen` does for a first message (#594).
 *   2. `acceptHumanMessage` -- the ONE place a run gets created (see `execute-run.ts`
 *      file head: "no POST that starts a run" -- a run always has a human message
 *      attached to it). Then `executor.kick(orgId)`, exactly like `ChatController.
 *      createMessage`.
 *   3. `readAgentRun`, polled with bounded attempts, until a TERMINAL status
 *      (`succeeded` | `failed`). `writeback_pending` is NOT terminal (`ports.ts`
 *      `AgentRunStore.commitWriteback` doc).
 *
 * No model call happens here, no queue row is written directly, and no assistant text is
 * invented: the returned text is read back from the persisted Chat message the writeback
 * step created (`resultMessageId`), via `listMessagePage` -- the same read path the Chat UI
 * uses. If the poll budget is exhausted before a terminal state, this reports `timeout` and
 * does NOT fabricate a reply.
 *
 * ## Why polling, not a push from the executor
 *
 * §5 says Wave 2's run transport is polling, not SSE (`agent-run.controller.ts` file head).
 * This function still HANDS BACK an SSE response to the CopilotKit client -- but the
 * translation happens at the interface layer once this function already has the final
 * text. Phase 2 (token-level streaming) would replace the inside of this function, not
 * its callers' contract with the interface layer.
 */
import type { OrgId } from "../../domain/org-id";
import type { IdentityRepository, DecisionIdFactory } from "../../application/identity/ports";
import type { ChatRepository } from "../chat/ports";
import type { ProvenanceWriter } from "../provenance/ports";
import type { IdFactory } from "../artifact/ports";
import {
  acceptHumanMessage, listMessagePage,
  AgentNotPublishedError, MessageThreadNotVisibleError, MessageNoWriteRoleError,
  MessageThreadArchivedError, MessageIdempotencyConflictError,
} from "../chat/message-roundtrip";
import type { ChatMessageCommandRepository, PublishedAgentReader } from "../chat/message-command-ports";
import { mutateThread, TitleInvalidError } from "../chat/mutate-thread";
import { readAgentRun, AgentRunNotVisibleError } from "./read-run";
import type { AgentRunStore, AgentRunExecutorPort } from "./ports";

export { AgentNotPublishedError, MessageThreadNotVisibleError, MessageNoWriteRoleError,
  MessageThreadArchivedError, MessageIdempotencyConflictError, AgentRunNotVisibleError,
  TitleInvalidError };

/** The run reached a terminal status but has neither text nor a stable failure code. */
export class AguiBridgeResultUnreadableError extends Error {}

export interface AguiBridgeDeps {
  readonly repo: IdentityRepository;
  readonly ids: DecisionIdFactory;
  readonly chat: ChatRepository;
  readonly provenance: ProvenanceWriter;
  readonly artifactIds: IdFactory;
  readonly commands: ChatMessageCommandRepository;
  readonly publishedAgents: PublishedAgentReader;
  readonly runs: AgentRunStore;
  readonly executor: AgentRunExecutorPort;
}

export interface AguiBridgeInput {
  readonly userId: string;
  readonly orgId: OrgId;
  readonly agentId: string;
  readonly text: string;
  readonly clientMessageId: string;
  /** Omitted/null = start a fresh personal thread for this AG-UI session (see file head). */
  readonly threadId?: string | null;
  /** Test seam only -- production callers use the defaults. */
  readonly pollIntervalMs?: number;
  readonly maxPolls?: number;
}

export type AguiBridgeOutcome =
  | {
    readonly kind: "succeeded";
    readonly threadId: string;
    readonly runId: string;
    readonly messageId: string;
    readonly text: string;
  }
  | { readonly kind: "failed"; readonly threadId: string; readonly runId: string; readonly error: string }
  | { readonly kind: "timeout"; readonly threadId: string; readonly runId: string };

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

async function resolveThreadId(deps: AguiBridgeDeps, input: AguiBridgeInput): Promise<string> {
  if (typeof input.threadId === "string" && input.threadId.trim() !== "") return input.threadId;
  const created = await mutateThread(deps, {
    userId: input.userId, orgId: input.orgId, op: "create", projectId: null,
    threadId: null, groupId: null, title: `CopilotKit ${new Date().toISOString()}`,
    visibilityScope: null, expectedVersion: null, reason: null,
  });
  return created.threadId;
}

export async function runAguiBridgeTurn(
  deps: AguiBridgeDeps,
  input: AguiBridgeInput,
): Promise<AguiBridgeOutcome> {
  const threadId = await resolveThreadId(deps, input);

  const accepted = await acceptHumanMessage(deps, {
    userId: input.userId, orgId: input.orgId, threadId,
    clientMessageId: input.clientMessageId, text: input.text, agentId: input.agentId,
  });
  deps.executor.kick(input.orgId);

  const pollIntervalMs = input.pollIntervalMs ?? 400;
  const maxPolls = input.maxPolls ?? 75; // ~30s bound at the default interval.
  const runId = accepted.agentRunId;

  for (let attempt = 0; attempt < maxPolls; attempt += 1) {
    const projection = await readAgentRun(deps, { userId: input.userId, orgId: input.orgId, runId });
    if (projection.status === "succeeded") {
      if (projection.resultMessageId === null) throw new AguiBridgeResultUnreadableError();
      const page = await listMessagePage(deps, {
        userId: input.userId, orgId: input.orgId, threadId, limit: 100,
      });
      const message = page.messages.find((m) => m.id === projection.resultMessageId);
      if (message === undefined) throw new AguiBridgeResultUnreadableError();
      return { kind: "succeeded", threadId, runId, messageId: message.id, text: message.text };
    }
    if (projection.status === "failed") {
      return { kind: "failed", threadId, runId, error: projection.error ?? "UNKNOWN" };
    }
    await sleep(pollIntervalMs);
  }
  return { kind: "timeout", threadId, runId };
}

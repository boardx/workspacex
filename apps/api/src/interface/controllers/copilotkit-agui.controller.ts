/**
 * `POST /copilotkit/agui` -- the AG-UI SSE bridge (#654 Phase 1b).
 *
 * ## Scope, on purpose
 *
 * This wraps the EXISTING agent-run create+poll flow (`agui-bridge.ts`) and translates its
 * ONE final outcome into a short AG-UI event sequence over SSE. It is deliberately NOT
 * token-level streaming: `execute-run.ts` makes exactly one non-streaming model call per
 * run (Wave 2 §5), so there is no token stream to relay yet. Phase 2 is what replaces the
 * inside of `runAguiBridgeTurn` with something that CAN stream; this controller's contract
 * (one `RunAgentInput`-shaped POST body in, an AG-UI SSE event sequence out) does not need
 * to change for that.
 *
 * ## Event shapes
 *
 * Typed against `@ag-ui/core`'s `EventType` enum and event schemas directly (already a
 * transitive dependency via `apps/web`'s CopilotKit packages, so declaring it here added
 * no new download) -- `RUN_STARTED` / `TEXT_MESSAGE_START` / `TEXT_MESSAGE_CONTENT` /
 * `TEXT_MESSAGE_END` / `RUN_FINISHED` / `RUN_ERROR`. Field names (`delta`, `messageId`,
 * `code`) are read off `@ag-ui/core`'s zod schemas, not guessed.
 *
 * ## `threadId` / `runId`: client-facing vs. backend Chat thread
 *
 * AG-UI's `threadId`/`runId` are the CLIENT's correlation ids -- `HttpAgent` mints them
 * and expects them echoed back on every event for the SAME turn. They are NOT this app's
 * Chat `chat_threads.id`: a client-generated UUID has no membership row, no visibility
 * scope, nothing `resolveVisibility` could authorize. So the two are kept deliberately
 * separate: the client's `threadId`/`runId` from the request body are echoed verbatim in
 * every emitted event, while `runAguiBridgeTurn` always opens a FRESH personal Chat thread
 * server-side to run the message through (single-round scope, see file head) and returns
 * its own server-side ids for logging/debugging only -- they never appear on the wire.
 *
 * ## Why this is a new controller, not a method on `ChatController`
 *
 * `chat.controller.ts` is already the busiest controller in the app (~1080 lines) and the
 * most frequently touched by concurrent feature work (see git status at the time this was
 * written). Reusing its `messageDeps`-shaped ports here means duplicating the injection,
 * not the port implementations -- a plain function call into `agui-bridge.ts` with the same
 * five ports, constructed once for this controller instead of piled onto that file.
 *
 * ## Contract status -- registered, not signed (ADR-023 contract-delta)
 *
 * This endpoint's request/response shape has NO entry yet in any `contracts/<bundle>/`
 * design-signoff. Per the human ruling on issue #654 (point 3), the minimal shape is
 * defined and registered as PENDING in `phases/phase-01-run-a-project/contracts/chat/
 * agui-bridge-delta.md`, not blocked on a full signoff round. Do not treat this route's
 * shape as stable until that file is marked signed.
 */
import { Controller, Inject, Post, Body, Query, Res, UnprocessableEntityException } from "@nestjs/common";
import type { Response } from "express";
import { randomUUID } from "node:crypto";
import { EventType } from "@ag-ui/core";
import { CurrentPrincipal } from "../current-principal.decorator";
import { assertPrincipal, type Principal } from "../../domain/principal";
import { toOrgId } from "../../domain/org-id";
import { DECISION_ID_FACTORY, IDENTITY_REPOSITORY, type DecisionIdFactory, type IdentityRepository } from "../../application/identity/ports";
import { CHAT_REPOSITORY, type ChatRepository } from "../../application/chat/ports";
import { AuthzUnavailableError } from "../../application/chat/resolve-visibility";
import { PROVENANCE_WRITER, type ProvenanceWriter } from "../../application/provenance/ports";
import { ID_FACTORY, type IdFactory } from "../../application/artifact/ports";
import {
  CHAT_MESSAGE_COMMAND_REPOSITORY, PUBLISHED_AGENT_READER,
  type ChatMessageCommandRepository, type PublishedAgentReader,
} from "../../application/chat/message-command-ports";
import {
  AGENT_RUN_STORE, AGENT_RUN_EXECUTOR, type AgentRunStore, type AgentRunExecutorPort,
} from "../../application/agent-run/ports";
import {
  runAguiBridgeTurn, AgentNotPublishedError, MessageThreadNotVisibleError, MessageNoWriteRoleError,
  MessageThreadArchivedError, MessageIdempotencyConflictError, AgentRunNotVisibleError,
  TitleInvalidError, AguiBridgeResultUnreadableError,
} from "../../application/agent-run/agui-bridge";

/** The minimal slice of AG-UI's `RunAgentInput` this bridge reads. Everything else in a
 * real `RunAgentInput` (tools, context, state, forwardedProps) is ignored -- Phase 1b is
 * single-turn text only (see file head). */
interface AguiRunInput {
  readonly threadId?: string;
  readonly runId?: string;
  readonly messages?: readonly { readonly role: string; readonly content: string }[];
}

type AguiEvent =
  | { readonly type: EventType.RUN_STARTED; readonly threadId: string; readonly runId: string }
  | { readonly type: EventType.TEXT_MESSAGE_START; readonly messageId: string; readonly role: "assistant" }
  | { readonly type: EventType.TEXT_MESSAGE_CONTENT; readonly messageId: string; readonly delta: string }
  | { readonly type: EventType.TEXT_MESSAGE_END; readonly messageId: string }
  | { readonly type: EventType.RUN_FINISHED; readonly threadId: string; readonly runId: string }
  | { readonly type: EventType.RUN_ERROR; readonly message: string; readonly code?: string };

function lastUserText(input: AguiRunInput): string | null {
  const messages = input.messages ?? [];
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i]?.role === "user") return messages[i]!.content;
  }
  return null;
}

@Controller()
export class CopilotkitAguiController {
  constructor(
    @Inject(IDENTITY_REPOSITORY) private readonly repo: IdentityRepository,
    @Inject(DECISION_ID_FACTORY) private readonly ids: DecisionIdFactory,
    @Inject(CHAT_REPOSITORY) private readonly chat: ChatRepository,
    @Inject(PROVENANCE_WRITER) private readonly provenance: ProvenanceWriter,
    @Inject(ID_FACTORY) private readonly artifactIds: IdFactory,
    @Inject(CHAT_MESSAGE_COMMAND_REPOSITORY) private readonly messageCommands: ChatMessageCommandRepository,
    @Inject(PUBLISHED_AGENT_READER) private readonly publishedAgents: PublishedAgentReader,
    @Inject(AGENT_RUN_STORE) private readonly runs: AgentRunStore,
    @Inject(AGENT_RUN_EXECUTOR) private readonly executor: AgentRunExecutorPort,
  ) {}

  private get deps() {
    return {
      repo: this.repo, ids: this.ids, chat: this.chat, provenance: this.provenance,
      artifactIds: this.artifactIds, commands: this.messageCommands,
      publishedAgents: this.publishedAgents, runs: this.runs, executor: this.executor,
    };
  }

  /**
   * `agentId` travels as a query param, not in the AG-UI body: AG-UI's `RunAgentInput` has
   * no standard field for "which Agent" in this codebase's sense (a published Agent
   * version), and this app has no served "list agents" route yet to resolve one implicitly
   * (see `personal-chat-screen.tsx` file head -- same gap, same reason: not inventing a
   * default here silently). The CopilotKit client passes it explicitly instead.
   */
  @Post("/copilotkit/agui")
  async bridge(
    @CurrentPrincipal() principal: Principal,
    @Body() body: AguiRunInput,
    @Query("agentId") agentIdParam: string | undefined,
    @Res() response: Response,
  ): Promise<void> {
    assertPrincipal(principal);
    const agentId = agentIdParam?.trim();
    if (agentId === undefined || agentId === "") {
      throw new UnprocessableEntityException("AGENT_NOT_FOUND");
    }
    const text = lastUserText(body);
    if (text === null || text.trim() === "") {
      throw new UnprocessableEntityException("MESSAGE_INVALID");
    }

    response.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    const write = (event: AguiEvent): void => {
      response.write(`data: ${JSON.stringify(event)}\n\n`);
    };

    // Client-facing correlation ids -- see file head "threadId / runId" section. `HttpAgent`
    // always sends both; the fallback only covers a hand-rolled test/curl client.
    const clientThreadId = body.threadId ?? randomUUID();
    const clientRunId = body.runId ?? randomUUID();

    try {
      const outcome = await runAguiBridgeTurn(this.deps, {
        userId: principal.userId, orgId: toOrgId(principal.orgId), agentId, text,
        clientMessageId: randomUUID(), threadId: null,
      });
      write({ type: EventType.RUN_STARTED, threadId: clientThreadId, runId: clientRunId });

      if (outcome.kind === "succeeded") {
        write({ type: EventType.TEXT_MESSAGE_START, messageId: outcome.messageId, role: "assistant" });
        write({ type: EventType.TEXT_MESSAGE_CONTENT, messageId: outcome.messageId, delta: outcome.text });
        write({ type: EventType.TEXT_MESSAGE_END, messageId: outcome.messageId });
        write({ type: EventType.RUN_FINISHED, threadId: clientThreadId, runId: clientRunId });
      } else if (outcome.kind === "failed") {
        write({ type: EventType.RUN_ERROR, message: outcome.error, code: outcome.error });
      } else {
        write({ type: EventType.RUN_ERROR, message: "AGENT_RUN_TIMEOUT", code: "AGENT_RUN_TIMEOUT" });
      }
    } catch (e) {
      if (e instanceof MessageThreadNotVisibleError || e instanceof AgentRunNotVisibleError) {
        write({ type: EventType.RUN_ERROR, message: "THREAD_NOT_VISIBLE", code: "THREAD_NOT_VISIBLE" });
      } else if (e instanceof MessageNoWriteRoleError) {
        write({ type: EventType.RUN_ERROR, message: "NO_WRITE_ROLE", code: "NO_WRITE_ROLE" });
      } else if (e instanceof MessageThreadArchivedError) {
        write({ type: EventType.RUN_ERROR, message: "THREAD_ARCHIVED_READONLY", code: "THREAD_ARCHIVED_READONLY" });
      } else if (e instanceof AgentNotPublishedError) {
        write({ type: EventType.RUN_ERROR, message: "AGENT_NOT_FOUND", code: "AGENT_NOT_FOUND" });
      } else if (e instanceof MessageIdempotencyConflictError) {
        write({ type: EventType.RUN_ERROR, message: "IDEMPOTENCY_CONFLICT", code: "IDEMPOTENCY_CONFLICT" });
      } else if (e instanceof TitleInvalidError) {
        write({ type: EventType.RUN_ERROR, message: "TITLE_INVALID", code: "TITLE_INVALID" });
      } else if (e instanceof AguiBridgeResultUnreadableError) {
        write({ type: EventType.RUN_ERROR, message: "RESULT_UNREADABLE", code: "RESULT_UNREADABLE" });
      } else if (e instanceof AuthzUnavailableError) {
        write({ type: EventType.RUN_ERROR, message: "AUTHZ_UNAVAILABLE", code: "AUTHZ_UNAVAILABLE" });
      } else {
        write({ type: EventType.RUN_ERROR, message: "INTERNAL_ERROR", code: "INTERNAL_ERROR" });
        response.end();
        throw e;
      }
    }
    response.end();
  }
}

/**
 * `POST /copilotkit/agui` -- the AG-UI SSE bridge (#654 Phase 1b, streaming since 阶段2b).
 *
 * ## Scope, on purpose
 *
 * This wraps the EXISTING agent-run create+poll flow (`agui-bridge.ts`). Since 阶段2b it
 * relays `runAguiBridgeTurn`'s `onDelta` callback as real `TEXT_MESSAGE_CONTENT` events
 * WHILE the run is still in flight, not just its one final outcome -- when the underlying
 * `ModelCallPort` streamed (`KERNEL_MODEL_STREAM_ENABLED=1` and the routed provider
 * supports it, see `configured-model-provider.ts`). When it did not stream (the default,
 * or a provider that cannot), zero deltas ever arrive and this controller falls straight
 * back to 阶段1b's behaviour: one `TEXT_MESSAGE_CONTENT` carrying the whole final text.
 * That fallback is not a special case in the code below -- it falls out of `sawAnyDelta`
 * staying `false`.
 *
 * ## `messageId` is minted HERE now, not read off the persisted Chat message
 *
 * 阶段1b used the writeback's real `chat_messages.id` as the AG-UI `messageId`, because it
 * was only ever used once the run had already succeeded. Streaming deltas arrive WHILE the
 * run is `running` -- long before that id exists -- so this controller now mints its own
 * correlation id up front. AG-UI's `messageId` is a wire-level correlation id for `HttpAgent`
 * to group `TEXT_MESSAGE_START`/`_CONTENT`/`_END` into one bubble; nothing in the AG-UI
 * protocol requires it to equal any backend row id, and this app's own persisted message id
 * is never looked up over this connection anyway (the controller only ever HAD it after
 * `outcome.kind === "succeeded"`, i.e. too late to have used it for the first delta).
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
  CHAT_MESSAGE_COMMAND_REPOSITORY, PUBLISHED_AGENT_READER, THREAD_MOUNTED_SKILL_READER,
  type ChatMessageCommandRepository, type PublishedAgentReader,
  type ThreadMountedSkillReader,
} from "../../application/chat/message-command-ports";
import {
  AGENT_RUN_STORE, AGENT_RUN_EXECUTOR, type AgentRunStore, type AgentRunExecutorPort,
} from "../../application/agent-run/ports";
import {
  runAguiBridgeTurn, AgentNotPublishedError, MessageThreadNotVisibleError, MessageNoWriteRoleError,
  MessageThreadArchivedError, MessageIdempotencyConflictError, AgentRunNotVisibleError,
  TitleInvalidError, AguiBridgeResultUnreadableError, type RunStepPublic,
} from "../../application/agent-run/agui-bridge";
import { parseWriteTodosSnapshot, type JsonPatchOp } from "@repo/contracts/agui-state-events";

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
  | { readonly type: EventType.RUN_ERROR; readonly message: string; readonly code?: string }
  // #789 -- native AG-UI tool-call visibility (chat-ux-acceptance-criteria.md items 2/3),
  // field names read off `@ag-ui/core`'s zod schemas (`ToolCallStartEventSchema` etc.),
  // not guessed, same discipline the file head already documents for the six event types
  // above. Every `RunStepPublic` this controller receives is ALREADY COMPLETE by the time
  // `onStep` fires (`agui-bridge.ts`'s own doc: steps are durable before a run can reach a
  // terminal status) -- so a step becomes this whole sequence in one shot, never a partial
  // "started, might still be running" state the client has to reconcile later.
  | { readonly type: EventType.STEP_STARTED; readonly stepName: string }
  | { readonly type: EventType.TOOL_CALL_START; readonly toolCallId: string; readonly toolCallName: string }
  | { readonly type: EventType.TOOL_CALL_ARGS; readonly toolCallId: string; readonly delta: string }
  | { readonly type: EventType.TOOL_CALL_END; readonly toolCallId: string }
  | {
    readonly type: EventType.TOOL_CALL_RESULT; readonly messageId: string; readonly toolCallId: string;
    readonly content: string; readonly role: "tool";
  }
  | { readonly type: EventType.STEP_FINISHED; readonly stepName: string }
  // DA-17（UX-9 Line D2）-- 状态轴与自定义事件轴，架构裁决（coord-architecture，
  // 2026-08-23）：DA-13 双栏的小而频 UI 状态走 STATE_DELTA（RFC 6902），DA-15 文件
  // 事件走 CUSTOM {name,value}，两轴并用不 fork 协议。字段名逐字取自 `@ag-ui/core`
  // 的 `StateSnapshotEventSchema`/`StateDeltaEventSchema`/`CustomEventSchema`，与
  // ag-ui 官方 docs/concepts/events.mdx 一致——同上，不凭记忆。
  //
  // 当前唯一的生产者是 `writeToolCallStep` 里的 write_todos → STATE_SNAPSHOT；
  // STATE_DELTA / CUSTOM 本轮只落 wire 类型（DA-13/DA-15 的传输前提），**没有真实
  // 数据源之前不许 write 它们**——空事件/编造事件违反本仓反空转纪律。
  | { readonly type: EventType.STATE_SNAPSHOT; readonly snapshot: unknown }
  | { readonly type: EventType.STATE_DELTA; readonly delta: readonly JsonPatchOp[] }
  | { readonly type: EventType.CUSTOM; readonly name: string; readonly value: unknown };

function lastUserText(input: AguiRunInput): string | null {
  const messages = input.messages ?? [];
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i]?.role === "user") return messages[i]!.content;
  }
  return null;
}

/**
 * #789 -- one `RunStepPublic` (a REAL, already-executed `tool_call` step, see
 * `agui-bridge.ts`'s own doc on `onStep`) becomes this fixed AG-UI event sequence:
 *
 *   STEP_STARTED(stepName)
 *   → [ a small assistant text bubble carrying `planningNote`, IF the model said one --
 *       chat-ux-acceptance-criteria.md item 2 ("可见的规划步骤") wants the model's OWN
 *       words visible as readable text, not only encoded into a tool-call event a client
 *       without custom rendering would silently drop ]
 *   → TOOL_CALL_START → TOOL_CALL_ARGS (only if there IS an args summary; the schema's
 *       `delta` is a required string, so this is skipped rather than sent as `""` when the
 *       step never captured one) → TOOL_CALL_END
 *   → TOOL_CALL_RESULT (content is the result summary, or a stock failure string when
 *       `step.status === "failed"` -- chat-ux-acceptance-criteria.md item 7, "错误处理
 *       透明度": a failed tool call must be visible AS a failure, not silently empty)
 *   → STEP_FINISHED(stepName)
 *
 * `toolCallId`/planning-note `messageId` are minted fresh per step -- nothing downstream
 * (this app's own persisted `chat_messages`/`agent_run_steps`) is looked up over these
 * ids, same discipline the file head already documents for the main answer's `messageId`.
 */
function writeToolCallStep(write: (event: AguiEvent) => void, step: RunStepPublic): void {
  const stepName = step.toolName ?? "未知工具";
  write({ type: EventType.STEP_STARTED, stepName });

  if (step.planningNote !== null && step.planningNote.trim() !== "") {
    const planningMessageId = randomUUID();
    write({ type: EventType.TEXT_MESSAGE_START, messageId: planningMessageId, role: "assistant" });
    write({ type: EventType.TEXT_MESSAGE_CONTENT, messageId: planningMessageId, delta: step.planningNote });
    write({ type: EventType.TEXT_MESSAGE_END, messageId: planningMessageId });
  }

  const toolCallId = randomUUID();
  write({ type: EventType.TOOL_CALL_START, toolCallId, toolCallName: stepName });
  if (step.toolArgsSummary !== null && step.toolArgsSummary !== "") {
    write({ type: EventType.TOOL_CALL_ARGS, toolCallId, delta: step.toolArgsSummary });
  }
  write({ type: EventType.TOOL_CALL_END, toolCallId });

  const resultContent = step.status === "failed"
    ? (step.toolResultSummary ?? `技能「${stepName}」执行失败。`)
    : (step.toolResultSummary ?? "");
  write({
    type: EventType.TOOL_CALL_RESULT, messageId: randomUUID(), toolCallId,
    content: resultContent, role: "tool",
  });

  write({ type: EventType.STEP_FINISHED, stepName });

  // DA-17 -- 状态轴的首个真实生产者：write_todos 的参数就是结构化的计划账本
  // （TodoListMiddleware 语义：每次调用都是全量），所以每个 write_todos step 之后
  // 下发一次全量 STATE_SNAPSHOT，客户端按序应用、最后一次即当前计划——与
  // `agent-plan-panel.tsx` 的 derivePlanTodos「取最后一次 write_todos」等价，解析
  // 纪律也逐条同一（单一事实源在 `@repo/contracts/agui-state-events`）：坏 JSON、
  // 空 todos、非法条目 → 一律不发，绝不发编造的空快照。失败的 write_todos 调用
  // 不代表账本推进了，同样不发。
  if (step.status === "succeeded" && step.toolName === "write_todos" && step.toolArgsSummary !== null) {
    const snapshot = parseWriteTodosSnapshot(step.toolArgsSummary);
    if (snapshot !== null) {
      write({ type: EventType.STATE_SNAPSHOT, snapshot });
    }
  }
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
    // #1559：`acceptHumanMessage` 的必填依赖，见该函数 Deps 上的说明。
    @Inject(THREAD_MOUNTED_SKILL_READER) private readonly threadMounts: ThreadMountedSkillReader,
    @Inject(AGENT_RUN_STORE) private readonly runs: AgentRunStore,
    @Inject(AGENT_RUN_EXECUTOR) private readonly executor: AgentRunExecutorPort,
  ) {}

  private get deps() {
    return {
      repo: this.repo, ids: this.ids, chat: this.chat, provenance: this.provenance,
      artifactIds: this.artifactIds, commands: this.messageCommands,
      publishedAgents: this.publishedAgents, threadMounts: this.threadMounts,
      runs: this.runs, executor: this.executor,
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
    // #654 阶段2b -- minted here, not read off the persisted Chat message. See file head.
    const messageId = randomUUID();
    let sawAnyDelta = false;

    try {
      const outcome = await runAguiBridgeTurn(this.deps, {
        userId: principal.userId, orgId: toOrgId(principal.orgId), agentId, text,
        clientMessageId: randomUUID(), threadId: null,
        // Fires once the run genuinely exists -- see `agui-bridge.ts`'s own doc for why
        // this, and not "before the call" or "after it resolves", is the right place:
        // a request that fails validation before a run exists (bad agent id, …) never
        // gets a RUN_STARTED at all, exactly like 阶段1b; a request that streams gets it
        // before the first `onDelta`, never after (which would arrive out of order).
        onStarted: () => write({ type: EventType.RUN_STARTED, threadId: clientThreadId, runId: clientRunId }),
        onDelta: (delta) => {
          if (!sawAnyDelta) {
            sawAnyDelta = true;
            write({ type: EventType.TEXT_MESSAGE_START, messageId, role: "assistant" });
          }
          write({ type: EventType.TEXT_MESSAGE_CONTENT, messageId, delta });
        },
        // #789 -- a tool_call step arrives ALREADY COMPLETE (see `AguiEvent`'s own comment
        // above), so it becomes one full STEP_STARTED → [planning note text] →
        // TOOL_CALL_START/ARGS/END/RESULT → STEP_FINISHED sequence per step, not a
        // multi-poll partial state.
        onStep: (step) => writeToolCallStep(write, step),
      });

      if (outcome.kind === "succeeded") {
        if (sawAnyDelta) {
          // Every fragment already went out via `onDelta` above -- resending
          // `outcome.text` here would duplicate the assistant bubble's content.
          write({ type: EventType.TEXT_MESSAGE_END, messageId });
        } else {
          // 阶段1b's exact fallback: streaming was off, or the routed provider does not
          // support it, so the whole answer arrives as one chunk instead of many.
          write({ type: EventType.TEXT_MESSAGE_START, messageId, role: "assistant" });
          write({ type: EventType.TEXT_MESSAGE_CONTENT, messageId, delta: outcome.text });
          write({ type: EventType.TEXT_MESSAGE_END, messageId });
        }
        write({ type: EventType.RUN_FINISHED, threadId: clientThreadId, runId: clientRunId });
      } else if (outcome.kind === "failed") {
        if (sawAnyDelta) write({ type: EventType.TEXT_MESSAGE_END, messageId });
        write({ type: EventType.RUN_ERROR, message: outcome.error, code: outcome.error });
      } else {
        if (sawAnyDelta) write({ type: EventType.TEXT_MESSAGE_END, messageId });
        write({ type: EventType.RUN_ERROR, message: "AGENT_RUN_TIMEOUT", code: "AGENT_RUN_TIMEOUT" });
      }
    } catch (e) {
      if (sawAnyDelta) write({ type: EventType.TEXT_MESSAGE_END, messageId });
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

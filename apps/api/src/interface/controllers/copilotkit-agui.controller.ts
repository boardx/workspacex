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
 * every emitted event, while `runAguiBridgeTurn` resolves the Chat thread to actually run
 * the message through -- REUSING `body.forwardedProps.chatThreadId` when the caller sent
 * one, or opening a fresh personal Chat thread otherwise (single-round default, see file
 * head).
 *
 * ## DA-19a -- real cross-turn continuation, via AG-UI's OWN `forwardedProps` passthrough
 *
 * `runAguiBridgeTurn` already supported reusing an existing Chat thread
 * (`AguiBridgeInput.threadId`) before this controller ever plumbed it through -- see that
 * file's own doc. The gap was entirely HERE: this controller always passed `threadId: null`
 * (阶段1b/2b's "every turn opens a fresh thread" scope), so the capability existed but no
 * caller could reach it. DA-19a closes that gap using AG-UI's protocol-native
 * `RunAgentInput.forwardedProps` field (`@ag-ui/core`'s own "arbitrary app data forwarded to
 * the backend" escape hatch -- not a bespoke header or a second id-mapping table): a client
 * that wants continuation reads the Chat thread id back off the `CUSTOM` event below and
 * echoes it forward as `forwardedProps.chatThreadId` on the NEXT turn. Reusing the SAME Chat
 * thread id also makes `deep-agent-model-provider.ts`'s `deriveRemoteThreadId` derive the
 * SAME remote deep-agent thread deterministically (see that function's own doc) -- so this
 * is genuine cross-turn memory at the underlying agent, not merely "the same row in our own
 * `chat_messages` table".
 *
 * `CUSTOM {name:"chat_thread_id"}` is the SECOND real producer on the wire's already-declared
 * `EventType.CUSTOM` variant (the first is DA-17's `STATE_SNAPSHOT` for `write_todos`) --
 * same discipline as that one: only write it once genuinely resolved, never a placeholder.
 * `agui-bridge.ts`'s `onThreadResolved` fires BEFORE `onStarted` (thread resolution and "a
 * run genuinely exists" are two separate moments, see that file's own doc) -- but the id it
 * hands back is only WRITTEN TO THE WIRE right after `RUN_STARTED`, never before: a real
 * `@ag-ui/client` `HttpAgent` enforces "the first event on a stream must be RUN_STARTED"
 * (`verify.ts`) and rejects the whole stream otherwise -- this file's own test caught that
 * the naive "emit as soon as resolved" ordering breaks a real client, not a hypothetical one.
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
import { toOrgId, type OrgId } from "../../domain/org-id";
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
  runAguiBridgeTurn, resumeAguiBridgeTurn, NoAwaitingApprovalRunError,
  AgentNotPublishedError, MessageThreadNotVisibleError, MessageNoWriteRoleError,
  MessageThreadArchivedError, MessageIdempotencyConflictError, MessageAttachmentNotPendingError,
  AgentRunNotVisibleError,
  TitleInvalidError, AguiBridgeResultUnreadableError, AgentRunNotAwaitingApprovalError,
  type RunStepPublic,
} from "../../application/agent-run/agui-bridge";
import { parseWriteTodosSnapshot, type JsonPatchOp } from "@repo/contracts/agui-state-events";
import { chatFileUpload } from "@repo/contracts";

/**
 * chat-parity-attachments (issue #2022) -- validate+cap `forwardedProps.attachmentIds`
 * the same way the REST track's contract already bounds a message's attachment count
 * (`ATTACHMENT_LIMITS.maxAttachmentsPerMessage`, `chat-file-upload.ts`'s single source of
 * truth) -- not a new number invented for this bridge. Malformed entries (non-string,
 * blank) are dropped rather than rejecting the whole turn: `acceptHumanMessage` itself is
 * still the authority (unknown/foreign/already-attached ids throw
 * `MessageAttachmentNotPendingError`, mapped below to `ATTACHMENT_NOT_PENDING`).
 */
function parseForwardedAttachmentIds(value: unknown): readonly string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const ids = value.filter((v): v is string => typeof v === "string" && v.trim() !== "");
  if (ids.length === 0) return undefined;
  return ids.slice(0, chatFileUpload.ATTACHMENT_LIMITS.maxAttachmentsPerMessage);
}

/** The minimal slice of AG-UI's `RunAgentInput` this bridge reads. Everything else in a
 * real `RunAgentInput` (tools, context, state) is ignored -- Phase 1b is single-turn text
 * only (see file head). `forwardedProps` is the one exception, and only its
 * `chatThreadId` key (DA-19a, see file head "real cross-turn continuation").
 *
 * DA-19g -- `messages[].role` can now also be `"tool"` (with `toolCallId`/`content`), the
 * shape `@copilotkit/core`'s frontend-tool machinery synthesizes once `useHumanInTheLoop`'s
 * `respond(result)` resolves (see file head "HITL resume"). `toolCallId` itself is never
 * read here -- see `isHitlResumeRequest`'s own doc for why the LAST message's role alone is
 * already an unambiguous enough signal for this bridge's one-thread-one-pending-run
 * invariant, without needing to correlate a specific id. */
interface AguiRunInput {
  readonly threadId?: string;
  readonly runId?: string;
  readonly messages?: readonly {
    readonly role: string; readonly content?: string; readonly toolCallId?: string;
  }[];
  /** DA-19a -- see file head "real cross-turn continuation". Three keys are read --
   * `chatThreadId`, (chat-parity-attachments, issue #2022) `attachmentIds`, and
   * (issue #2021) `toolChoice` -- any other key a real AG-UI client puts in
   * `forwardedProps` is ignored, same as this bridge already ignores
   * `tools`/`context`/`state` (see `AguiRunInput`'s own doc).
   *
   * `attachmentIds`: pending attachment ids from the SAME
   * `POST /chat/threads/:threadId/attachments` upload endpoint the REST track uses --
   * see `parseForwardedAttachmentIds`.
   *
   * `toolChoice` is read for one purpose only: recognising `@copilotkit/core`'s
   * `SuggestionEngine.generateSuggestions` runs (it forces
   * `toolChoice: {type:"function", function:{name:"copilotkitSuggest"}}` on every
   * suggestion request -- read from `dist/index.mjs`, not guessed). See
   * `isSuggestionRequest`'s own doc for why these must be short-circuited. */
  readonly forwardedProps?: {
    readonly chatThreadId?: string;
    readonly attachmentIds?: unknown;
    readonly toolChoice?: { readonly function?: { readonly name?: string } };
  };
}

/**
 * issue #2021 -- a `SuggestionEngine` run, NOT a user turn. Before this guard existed,
 * every suggestions generation (fired automatically by `CopilotKitCore.runAgent` after
 * each real turn, see `FollowUpSuggestions` in `copilotkit-v2-panel.tsx`) arrived here as
 * an ordinary fresh turn: no `chatThreadId` in its `forwardedProps` -> `resolveThreadId`
 * created a brand-new `chat_threads` row AND ran the full agent -- one phantom thread per
 * message sent, polluting the (new, issue #2021) thread list and burning a real deep-agent
 * run whose output nobody could consume (this bridge does not implement forced tool
 * calls, so `extractSuggestions` never finds its `copilotkitSuggest` call -- the known
 * DA-19e gap recorded in `copilotkit-v2-suggestions.spec.ts`'s file head).
 *
 * Until forced-tool-call support lands, the honest response is an immediately-finished
 * empty run: RUN_STARTED -> RUN_FINISHED, no thread created, no message persisted, no
 * agent run. The client's suggestion list stays empty -- exactly what it got before, minus
 * the side effects. This is detection, not implementation-by-half: the DA-19e spec's
 * assertions (request reaches this same connection, no error banner) still hold.
 */
function isSuggestionRequest(body: AguiRunInput): boolean {
  return body.forwardedProps?.toolChoice?.function?.name === "copilotkitSuggest";
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
    if (messages[i]?.role === "user") return messages[i]!.content ?? null;
  }
  return null;
}

/**
 * DA-19g -- is this request `useHumanInTheLoop`'s `respond()` follow-up, not a fresh human
 * turn? `@copilotkit/core`'s frontend-tool machinery (`packages/react-core/src/v2/hooks/
 * use-human-in-the-loop.tsx`, traced in this task's own research) inserts exactly ONE new
 * `{role:"tool", toolCallId, content}` message right after the assistant's dangling tool
 * call once `respond(result)` resolves, THEN re-invokes `runAgent` with the full, updated
 * history -- so on a genuine resume, that tool message is always the LAST entry (nothing
 * legitimate gets appended after a tool RESULT before the next round-trip). A `"tool"` role
 * message can never appear on a fresh turn (阶段1b/2b never emit one, and this bridge is
 * still single-round per `AguiRunInput`'s own doc for every OTHER field) -- so this check
 * has no false-positive path against ordinary chat traffic.
 *
 * This is why `resumeAguiBridgeTurn` does not need the message's `toolCallId` for
 * correlation (see `AguiRunInput`'s own doc): a Chat thread has at most one
 * `awaiting_approval` run at a time (`findAwaitingApprovalRunId`'s own doc), so "the last
 * message is a tool result" is already enough to know WHICH run this resumes, once
 * `forwardedProps.chatThreadId` says WHICH thread.
 */
function isHitlResumeRequest(input: AguiRunInput): boolean {
  const messages = input.messages ?? [];
  return messages.length > 0 && messages[messages.length - 1]?.role === "tool";
}

/** The decision-shaped payload a "tool" role message about the ONE tool this bridge ever
 * asks the frontend to execute (`send_email`, `SendEmailApprovalDialog`) can carry is
 * limited to what `SendEmailApprovalDialog`'s three actions call `respond(...)` with
 * (`copilotkit-v2-panel.tsx`): the literal strings `"approved"`/`"denied"`, or a JSON object
 * (the edited args, already validated client-side by `parseEditDraft`). Anything else is
 * neither -- a malformed/unexpected payload this bridge has never produced and should not
 * guess at (fail closed, same discipline `EditDecision`'s own JSON parsing on the deep-agent
 * provider side already uses for edited args -- see `decide-agent-run.ts` file head). */
function parseHitlDecision(
  content: string,
):
  | { readonly kind: "approve" | "reject" }
  | { readonly kind: "edit"; readonly editedArgs: Readonly<Record<string, unknown>> }
  | null {
  if (content === "approved") return { kind: "approve" };
  if (content === "denied") return { kind: "reject" };
  try {
    const parsed: unknown = JSON.parse(content);
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      return { kind: "edit", editedArgs: parsed as Readonly<Record<string, unknown>> };
    }
  } catch {
    // Falls through to `null` below -- not valid JSON, not one of the two literal strings.
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
function writeToolCallStep(
  write: (event: AguiEvent) => void, step: RunStepPublic, isPendingApproval: boolean,
): void {
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

  // DA-19g -- ONLY the step that IS the pending HITL interrupt (DA-07b's
  // `awaiting_approval`, `isPendingApproval` -- see `agui-bridge.ts`'s `onStep` doc for why
  // `step.status === "in_progress"` alone is not enough signal: an ORDINARY multi-step tool
  // call also reports an `"in_progress"` announcement frame while the run is still plain
  // `"running"`, #742 Gap 1's semantics apply to every tool call, not only ones that pause
  // for a human) withholds `TOOL_CALL_RESULT`. Sending it immediately for a step that has
  // NOT been decided yet used to be this bridge's core HITL bug: CopilotKit's
  // `useHumanInTheLoop` treats "no result event after `TOOL_CALL_END`" as ITS signal that a
  // tool call is still awaiting a frontend decision (`ToolCallStatus.Executing`) -- sending
  // one immediately, even an empty one, told the client the opposite: this call already
  // finished, nothing to wait for. An ordinary in-flight tool call (not a HITL interrupt)
  // keeps the ORIGINAL behaviour unchanged -- real e2e regression this task's own
  // verification caught (`copilotkit-v2-tool-rendering.spec.ts`'s `search_documents` card
  // never reaching its `"complete"` state): that flow relies on THIS SAME immediate-result
  // announcement to advance a generic tool-progress card, and it is not paused for anyone.
  //
  // ⚠ `STEP_FINISHED` is NOT held back the same way even for a genuine interrupt -- a first
  // attempt at this fix did, and a real `@ag-ui/client` (`verify.ts`'s own protocol checker)
  // rejected the whole stream with "Cannot send 'RUN_FINISHED' while steps are still active:
  // <name>" the moment the bridge tried to end the turn (real browser e2e caught this, not a
  // hypothetical). AG-UI's `STEP_STARTED`/`STEP_FINISHED` bracket is a DIFFERENT concept
  // from the tool call's own `TOOL_CALL_START`/`_END`/`_RESULT` triplet -- a step can
  // legitimately finish ("the model decided what to call and is done producing output for
  // this turn") while the tool call it announced is still dangling (no `_RESULT` yet,
  // because nothing has executed it). Only the tool-call-result half stays withheld here --
  // that is the actual signal `useHumanInTheLoop` reads (see above), and it is what
  // `resumeAguiBridgeTurn` supplies later once `decideAgentRun` produces a genuine terminal
  // outcome for the step.
  if (step.status === "in_progress" && isPendingApproval) {
    write({ type: EventType.STEP_FINISHED, stepName });
    return;
  }

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
  /**
   * DA-19g -- HITL resume correlation cache, keyed by the AG-UI CLIENT's own `threadId`
   * (`AbstractAgent.threadId`, minted once per browser `HttpAgent`/`useAgent` instance and
   * sent unconditionally on EVERY `runAgent()` call -- `prepareRunAgentInput` in `@ag-ui/
   * client` includes `threadId: this.threadId` on every request with no way to omit it,
   * traced directly in that package's source, not assumed).
   *
   * Real browser e2e (this task's own verification) found DA-19a's existing continuation
   * channel -- `forwardedProps.chatThreadId`, echoed back by the CALLING CODE that built
   * `copilotkit-v2-panel.tsx`'s own `send()` -- does NOT carry over to the follow-up
   * `runAgent()` call `useHumanInTheLoop`'s `respond()` triggers: that call is made
   * INTERNALLY by `@copilotkit/core`'s `processAgentResult` (`this.runAgent({agent, ...
   * runId})`), which never threads `forwardedProps` through at all -- the wire capture this
   * task ran showed `"forwardedProps":{}` on that exact request. There is no product code to
   * fix on the CopilotKit side (it is not this bridge's package) and no hook exposed to make
   * that internal call pass a custom `forwardedProps` -- so this bridge falls back to the one
   * channel the framework DOES guarantee: the client's own stable `threadId`.
   *
   * Every successful turn/resume records `clientThreadId -> resolved Chat thread id` here;
   * a resume with empty `forwardedProps.chatThreadId` (i.e. every real `useHumanInTheLoop`
   * resume today) looks itself up by the SAME `clientThreadId` the wire already carries.
   *
   * ⚠ Known scope limitation, stated plainly: this is single-process, in-memory state. A
   * process restart between a run entering `awaiting_approval` and the human deciding loses
   * the correlation (the run itself is still safely parked in Postgres -- `agent_runs.
   * status='awaiting_approval'` -- only the "which client threadId maps to it" fact is
   * lost, and the resume falls back to `forwardedProps.chatThreadId` if present, else
   * `NoAwaitingApprovalRunError`, an honest failure, not silent data loss). Multi-instance
   * deployment has the same gap. Fixing this for real (persisting the correlation, or
   * deriving it without one) is out of this task's scope -- registered as a follow-up, not
   * silently left unstated.
   */
  private readonly resolvedChatThreadIdByClientThreadId = new Map<string, string>();

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
      // DA-19g -- `decideAgentRun` (reused verbatim by `resumeAguiBridgeTurn`, see that
      // function's own doc) wants a plain `kick`, not the whole executor port -- same shape
      // `agent-run.controller.ts`'s REST decision route already injects it as.
      kick: (orgId: OrgId) => this.executor.kick(orgId),
    };
  }

  /**
   * `agentId` travels as a query param, not in the AG-UI body: AG-UI's `RunAgentInput` has
   * no standard field for "which Agent" in this codebase's sense (a published Agent
   * version), and this app has no served "list agents" route yet to resolve one implicitly
   * (see `personal-chat-screen.tsx` file head -- same gap, same reason: not inventing a
   * default here silently). The CopilotKit client passes it explicitly instead.
   *
   * DA-19g -- one more case this route now handles: a `useHumanInTheLoop` `respond()`
   * follow-up (`isHitlResumeRequest`). It still needs `agentId` (query-string validation
   * happens before that branch splits off) even though the resumed run already knows its
   * own agent -- this route has no other way to learn the caller believes it is still
   * talking to the same published Agent, and validating it up front keeps the two branches'
   * error shape for a missing/blank `agentId` identical rather than only enforced on one.
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

    // issue #2021 -- suggestion runs short-circuit BEFORE any thread/message machinery.
    // See `isSuggestionRequest`'s own doc: an immediately-finished empty run, no thread
    // created, no agent run. Placed before the resume/text validation so a suggestion
    // request can never be misread as either of those two real shapes.
    if (isSuggestionRequest(body)) {
      response.writeHead(200, {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      });
      const suggestionThreadId = body.threadId ?? randomUUID();
      const suggestionRunId = body.runId ?? randomUUID();
      response.write(`data: ${JSON.stringify({ type: EventType.RUN_STARTED, threadId: suggestionThreadId, runId: suggestionRunId })}\n\n`);
      response.write(`data: ${JSON.stringify({ type: EventType.RUN_FINISHED, threadId: suggestionThreadId, runId: suggestionRunId })}\n\n`);
      response.end();
      return;
    }

    // DA-19g -- see `isHitlResumeRequest`'s own doc. Checked BEFORE `lastUserText`'s
    // MESSAGE_INVALID guard below: a resume request legitimately has no NEW user-role
    // message at all (its last message is the synthesized tool result), so running that
    // guard first would 422 every resume before it ever reached the branch that handles it.
    const resumeRequest = isHitlResumeRequest(body);
    let decision: NonNullable<ReturnType<typeof parseHitlDecision>> | null = null;
    let text: string | null = null;
    if (resumeRequest) {
      const lastMessage = body.messages?.[body.messages.length - 1];
      decision = parseHitlDecision(lastMessage?.content ?? "");
      if (decision === null) {
        throw new UnprocessableEntityException("HITL_DECISION_INVALID");
      }
    } else {
      text = lastUserText(body);
      if (text === null || text.trim() === "") {
        throw new UnprocessableEntityException("MESSAGE_INVALID");
      }
    }

    response.writeHead(200, {
      // DA-17（UX-9 Line D3）实测发现：不带 `charset` 时，Chromium 的 CDP 网络检查层
      // （Playwright `response.text()`/`response.body()` 走的正是这条路径，不是页面
      // 自己 `fetch()` + `TextDecoder` 那条）会把这条 SSE 流当非 UTF-8 解码，中文内容
      // 全部乱码——`copilotkit-agui-state-snapshot.spec.ts` 抓 wire 字节时踩到。页面内
      // `HttpAgent` 自己读流不受影响（`TextDecoder` 默认按 UTF-8），但显式声明
      // charset 是 SSE 响应本该做的事（避免任何中间层/工具凭猜测解码），不是单纯为了
      // 迁就测试。
      "Content-Type": "text/event-stream; charset=utf-8",
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
    // DA-19a -- the CALLER's persisted Chat thread id, echoed forward via `forwardedProps`
    // (see file head "real cross-turn continuation"). Empty/whitespace-only is treated the
    // same as omitted -- a client that sends `""` gets a fresh thread, not a lookup error.
    const requestedChatThreadId = body.forwardedProps?.chatThreadId?.trim();
    // chat-parity-attachments (issue #2022) -- see `parseForwardedAttachmentIds`'s own doc.
    const requestedAttachmentIds = parseForwardedAttachmentIds(body.forwardedProps?.attachmentIds);
    // DA-19a -- captured by `onThreadResolved` (fires before `onStarted`, see
    // `agui-bridge.ts`'s own doc), but NOT written to the wire there: a real `@ag-ui/client`
    // `HttpAgent` enforces "first event must be RUN_STARTED" (`verify.ts`'s own check, hit
    // by this file's own test the first time this was tried with the naive ordering) --
    // writing CUSTOM before RUN_STARTED would make every real client reject the whole
    // stream. So this is buffered here and flushed by `onStarted` immediately AFTER
    // RUN_STARTED, never before, and never at all on the failure paths where `onStarted`
    // itself never fires (bad agent id, no write role, … -- exactly the paths that already
    // skip RUN_STARTED, see that field's own comment below).
    let resolvedThreadId: string | null = null;

    try {
      // DA-19g -- both branches share the SAME `onStarted`/`onDelta`/`onStep` wire
      // translation; only how the underlying run is reached differs (fresh turn vs.
      // resuming one already parked on `awaiting_approval`, see `agui-bridge.ts`'s doc on
      // `runAguiBridgeTurn` vs. `resumeAguiBridgeTurn`).
      const sharedCallbacks = {
        // Fires once the run genuinely exists/resumes -- see `agui-bridge.ts`'s own doc for
        // why this, and not "before the call" or "after it resolves", is the right place:
        // a request that fails validation before a run exists (bad agent id, …) never
        // gets a RUN_STARTED at all, exactly like 阶段1b; a request that streams gets it
        // before the first `onDelta`, never after (which would arrive out of order).
        onStarted: () => {
          write({ type: EventType.RUN_STARTED, threadId: clientThreadId, runId: clientRunId });
          // DA-19a -- `CUSTOM` is this event type's SECOND real producer (DA-17's
          // `STATE_SNAPSHOT` for `write_todos` is the first) -- same discipline: only ever
          // write it with a genuinely resolved id, right after the RUN_STARTED a real
          // client's protocol verifier requires to come first.
          if (resolvedThreadId !== null) {
            write({ type: EventType.CUSTOM, name: "chat_thread_id", value: resolvedThreadId });
            // DA-19g -- see `resolvedChatThreadIdByClientThreadId`'s own doc: record the
            // mapping on EVERY successful resolution (fresh turn or resume alike), so the
            // NEXT request on this same client `threadId` -- including a `respond()`
            // follow-up whose `forwardedProps` the framework never populates -- can still
            // find its way back to the right Chat thread.
            this.resolvedChatThreadIdByClientThreadId.set(clientThreadId, resolvedThreadId);
          }
        },
        onDelta: (delta: string) => {
          if (!sawAnyDelta) {
            sawAnyDelta = true;
            write({ type: EventType.TEXT_MESSAGE_START, messageId, role: "assistant" });
          }
          write({ type: EventType.TEXT_MESSAGE_CONTENT, messageId, delta });
        },
        // #789 -- a `"succeeded"`/`"failed"` tool_call step arrives ALREADY COMPLETE (see
        // `AguiEvent`'s own comment above), so it becomes one full STEP_STARTED →
        // [planning note text] → TOOL_CALL_START/ARGS/END/RESULT → STEP_FINISHED sequence
        // per step. DA-19g: an `"in_progress"` one (a pending HITL interrupt) stops short of
        // RESULT/STEP_FINISHED instead -- see `writeToolCallStep`'s own doc.
        onStep: (step: RunStepPublic, isPendingApproval: boolean) => writeToolCallStep(write, step, isPendingApproval),
      };

      // DA-19g -- `forwardedProps.chatThreadId` is the PRIMARY source (an explicit caller
      // like `copilotkit-preview-panel.tsx` that echoes it forward itself still wins), but a
      // real `useHumanInTheLoop` resume never carries one (see
      // `resolvedChatThreadIdByClientThreadId`'s own doc) -- fall back to the correlation
      // cache keyed by this same client's stable `threadId` before giving up.
      const resumeChatThreadId = requestedChatThreadId !== undefined && requestedChatThreadId !== ""
        ? requestedChatThreadId
        : this.resolvedChatThreadIdByClientThreadId.get(clientThreadId);
      // DA-19g -- resume already KNOWS its thread id synchronously (unlike a fresh turn's
      // `resolveThreadId`, which may still create one) -- set it before `onStarted` fires
      // rather than threading a matching `onThreadResolved` callback through
      // `resumeAguiBridgeTurn` for a value the caller already had in hand.
      if (resumeRequest && resumeChatThreadId !== undefined) {
        resolvedThreadId = resumeChatThreadId;
      }
      const outcome = resumeRequest
        ? await resumeAguiBridgeTurn(this.deps, {
          userId: principal.userId, orgId: toOrgId(principal.orgId),
          // Resume ALWAYS needs a real Chat thread id -- there is no "create one" fallback
          // here the way a fresh turn has (`resolveThreadId`'s `null` branch): a resume
          // with nowhere to look up the paused run is not a request this bridge can invent
          // an answer to. `findAwaitingApprovalRunId` throws `NoAwaitingApprovalRunError`
          // on an empty string exactly like it would on any other thread with no pending
          // run, so this is deliberately NOT special-cased into its own error code.
          threadId: resumeChatThreadId ?? "",
          decision: decision!, // non-null: validated above, `resumeRequest` implies it.
          ...sharedCallbacks,
        })
        : await runAguiBridgeTurn(this.deps, {
          userId: principal.userId, orgId: toOrgId(principal.orgId), agentId, text: text!,
          clientMessageId: randomUUID(),
          threadId: requestedChatThreadId !== undefined && requestedChatThreadId !== ""
            ? requestedChatThreadId : null,
          attachmentIds: requestedAttachmentIds,
          onThreadResolved: (threadId) => { resolvedThreadId = threadId; },
          ...sharedCallbacks,
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
      } else if (outcome.kind === "awaiting_approval") {
        // DA-19g -- NOT an error. `onStep` above already wrote the dangling
        // TOOL_CALL_START/ARGS/END triplet for the pending tool call (no RESULT, see
        // `writeToolCallStep`'s own doc) -- ending the run normally here, exactly like a
        // genuine AG-UI frontend-tool call, is what lets `useHumanInTheLoop` recognise
        // `status: "executing"` and render `respond`. The NEXT `POST /copilotkit/agui` this
        // client makes (once a human decides) is `resumeAguiBridgeTurn`'s job, not this
        // request's -- this SSE stream's job stops at "yielded control".
        if (sawAnyDelta) write({ type: EventType.TEXT_MESSAGE_END, messageId });
        write({ type: EventType.RUN_FINISHED, threadId: clientThreadId, runId: clientRunId });
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
      } else if (e instanceof MessageAttachmentNotPendingError) {
        // chat-parity-attachments (issue #2022) -- same fact the REST track's 422 reports
        // (`message-roundtrip.ts` "仓储在事务内因附件不合格回滚"): an id that is not a
        // pending attachment of THIS thread (foreign, already-attached, or unknown).
        write({ type: EventType.RUN_ERROR, message: "ATTACHMENT_NOT_PENDING", code: "ATTACHMENT_NOT_PENDING" });
      } else if (e instanceof TitleInvalidError) {
        write({ type: EventType.RUN_ERROR, message: "TITLE_INVALID", code: "TITLE_INVALID" });
      } else if (e instanceof AguiBridgeResultUnreadableError) {
        write({ type: EventType.RUN_ERROR, message: "RESULT_UNREADABLE", code: "RESULT_UNREADABLE" });
      } else if (e instanceof AuthzUnavailableError) {
        write({ type: EventType.RUN_ERROR, message: "AUTHZ_UNAVAILABLE", code: "AUTHZ_UNAVAILABLE" });
      } else if (e instanceof NoAwaitingApprovalRunError) {
        // DA-19g -- see that error class's own doc: nothing left to resume (already
        // decided elsewhere, or a stray/duplicate follow-up). Honest, stable code -- not
        // folded into INTERNAL_ERROR, and not silently treated as a no-op success.
        write({ type: EventType.RUN_ERROR, message: "NO_PENDING_APPROVAL", code: "NO_PENDING_APPROVAL" });
      } else if (e instanceof AgentRunNotAwaitingApprovalError) {
        // DA-19g -- `decideAgentRun` found a run id but it raced out of `awaiting_approval`
        // between `findAwaitingApprovalRunId` and the decision itself (concurrent decision,
        // already terminal, …) -- same "as-real" conflict the REST route already reports.
        write({
          type: EventType.RUN_ERROR, message: "AGENT_RUN_NOT_AWAITING_APPROVAL",
          code: "AGENT_RUN_NOT_AWAITING_APPROVAL",
        });
      } else {
        write({ type: EventType.RUN_ERROR, message: "INTERNAL_ERROR", code: "INTERNAL_ERROR" });
        response.end();
        throw e;
      }
    }
    response.end();
  }
}

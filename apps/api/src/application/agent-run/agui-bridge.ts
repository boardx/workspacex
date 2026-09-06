import type { ExecutionEvent } from "@repo/contracts/execution-journal";
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
 *
 * ## #654 阶段2b -- `onDelta` is additive, the polling loop and the return contract do not change
 *
 * The loop still polls `readAgentRun` for the terminal status exactly as阶段1b left it.
 * What 阶段2b adds is a SECOND poll, each iteration, of `readModelDeltas` -- forwarding any
 * fragment not yet seen through the caller's optional `onDelta` BEFORE checking the run's
 * status that same iteration. That ordering is load-bearing, not incidental:
 * `execute-run.ts`'s `executeClaimed` only transitions a run out of `running` (into
 * `writeback_pending`) AFTER `completeStream` has fully resolved, which is AFTER every
 * delta for that call is already committed. So "read deltas, then read status" in the
 * same iteration can never observe a terminal status with an unread delta still pending --
 * there is no extra "catch-up" poll needed after the loop exits.
 *
 * When `onDelta` is omitted, OR when the run never streamed anything (streaming disabled,
 * or the routed provider does not support it -- see `ports.ts`'s own `completeStream` doc),
 * zero deltas are ever forwarded and this function's behaviour is byte-for-byte 阶段1b's:
 * the caller falls back to relaying `outcome.text` as one chunk, exactly as before.
 *
 * ## Phase 14 F03 -- this file's polling loop is UNCHANGED, on purpose, for now
 *
 * `run-event-bus.ts`/`execute-run-events.ts` added a real, in-process, event-driven WS
 * transport (`interface/ws/agent-run-events.gateway.ts`) that `execute-run.ts` now
 * publishes onto for every run. This file's OWN relay (`pollAguiRunToOutcome` below) could
 * in principle subscribe to that SAME bus instead of sleeping and re-polling
 * `readAgentRun`/`readModelDeltas` -- they run in the same process, so it is mechanically
 * possible. It deliberately does NOT do that in this feature:
 *
 *   1. This loop's poll budget (`poll-budget.ts`) is itself a hard-won regression fix for
 *      two REAL 2026-08-29 devapp incidents (see that file's own head and
 *      `tests/agent-runtime/poll-budget-covers-deep-agent-timeout.test.ts`) -- replacing
 *      the mechanism risks reopening either one without the same regression coverage in
 *      place for the new shape.
 *   2. R9 requires a ONE-TIME cutover ("一次性切换,不保留旧轮询兼容层"), not a dual-path
 *      transport -- rewiring this file alone, before the frontend it serves
 *      (`copilotkit-agui.controller.ts`'s CopilotKit AG-UI SSE bridge, a DIFFERENT wire
 *      protocol than the new WS endpoint) is ready to consume it, would leave production
 *      running an unfinished half-migration rather than either the old or the new shape
 *      cleanly.
 *
 * So: `wave2-runtime.ts`'s `operations` head comment (the CONTRACT'S claim that this
 * transport is "polling-only, no push variant") has been corrected -- a real push
 * transport now exists. This file's OWN mechanism has not yet been cut over to it; that is
 * tracked as follow-up work, not silently done here.
 */
import type { OrgId } from "../../domain/org-id";
import type { IdentityRepository, DecisionIdFactory } from "../../application/identity/ports";
import type { ChatRepository } from "../chat/ports";
import type { ProvenanceWriter } from "../provenance/ports";
import type { IdFactory } from "../artifact/ports";
import {
  acceptHumanMessage, listMessagePage,
  AgentNotPublishedError, MessageThreadNotVisibleError, MessageNoWriteRoleError,
  MessageThreadArchivedError, MessageIdempotencyConflictError, MessageAttachmentNotPendingError,
} from "../chat/message-roundtrip";
import type {
  ChatMessageCommandRepository, EnabledSkillVersionReader, PublishedAgentReader, ThreadMountedSkillReader,
} from "../chat/message-command-ports";
import { mutateThread, TitleInvalidError } from "../chat/mutate-thread";
import { readAgentRun, AgentRunNotVisibleError } from "./read-run";
import { DEFAULT_RUN_POLL_INTERVAL_MS, DEFAULT_RUN_MAX_POLLS } from "./poll-budget";
import type { AguiRunPhase } from "@repo/contracts/agui-state-events";
import {
  decideAgentRun, AgentRunNotAwaitingToolPermissionError, type DecideAgentRunDeps,
} from "./decide-agent-run";
// issue #2767 -- F06 四选一决策，见 `resumeAguiBridgeTurnToolPermission` 自己的文档。
import { decideToolPermission, type DecideToolPermissionDeps } from "./decide-tool-permission";
import type { ToolPermissionDecisionKind } from "@repo/contracts/plan-permissions";
import type { AgentRunStore, AgentRunExecutorPort } from "./ports";
// 2026-08-27：`acceptHumanMessage` 的自动命名叠加模型摘要，见 `generate-thread-title.ts`
// 头注。这条轨道（AG-UI bridge）与 REST 轨道（`chat.controller.ts`）共用同一份
// `acceptHumanMessage`，缺这三个字段编译期就会红——不是运行时才发现漏注入。
import type { GenerateThreadTitleDeps } from "../chat/generate-thread-title";

export { AgentNotPublishedError, MessageThreadNotVisibleError, MessageNoWriteRoleError,
  MessageThreadArchivedError, MessageIdempotencyConflictError, MessageAttachmentNotPendingError,
  AgentRunNotVisibleError,
  TitleInvalidError, AgentRunNotAwaitingToolPermissionError, type DecideAgentRunDeps };

/** The run reached a terminal status but has neither text nor a stable failure code. */
export class AguiBridgeResultUnreadableError extends Error {}

export interface AguiBridgeDeps extends GenerateThreadTitleDeps {
  readonly repo: IdentityRepository;
  readonly ids: DecisionIdFactory;
  readonly chat: ChatRepository;
  readonly provenance: ProvenanceWriter;
  readonly artifactIds: IdFactory;
  readonly commands: ChatMessageCommandRepository;
  readonly publishedAgents: PublishedAgentReader;
  /** #1559：`acceptHumanMessage` 的必填依赖——线程级临时挂载进入 run 快照的读口。 */
  readonly threadMounts: ThreadMountedSkillReader;
  /** #2514：同上——agent 默认加载全部已启用 skill 的读口。 */
  readonly enabledSkills: EnabledSkillVersionReader;
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
  /**
   * chat-parity-attachments (issue #2022) -- pending attachment ids (already uploaded via
   * the SAME `POST /chat/threads/:threadId/attachments` endpoint the REST track uses,
   * see `chat-file-upload.ts`) to attach to this turn's human message. Threaded straight
   * into `acceptHumanMessage`'s existing `attachmentIds` parameter -- this bridge does not
   * invent a second attachment pipeline. Once attached, the EXISTING `execute-run.ts`
   * `withAttachmentNotice`/`readThreadHistory` machinery (already shared by both tracks)
   * folds the extraction excerpt into the model's context automatically; nothing else in
   * this file needs to know about attachment CONTENT, only ids.
   */
  readonly attachmentIds?: readonly string[];
  /** Test seam only -- production callers use the defaults. */
  readonly pollIntervalMs?: number;
  readonly maxPolls?: number;
  /**
   * DA-19a -- fired ONCE, right after `resolveThreadId` decides which Chat thread this turn
   * writes into (a REUSED `input.threadId`, or a freshly `mutateThread`-created one when it
   * was omitted) -- strictly BEFORE `acceptHumanMessage`, so a caller learns the thread id
   * even on a turn that goes on to fail validation (bad agent id, no write role, …). This is
   * the ONLY new plumbing DA-19a adds: the Chat thread id itself was already resolved and
   * returned on every `AguiBridgeOutcome` branch before this hook existed (see below) -- the
   * bridge always supported continuation via `input.threadId`, nothing upstream of the
   * `POST /copilotkit/agui` controller was rebuilt to get it. A caller that persists this
   * value and echoes it back as next turn's `threadId` gets real cross-turn continuation
   * (same Chat thread → `deep-agent-model-provider.ts`'s `deriveRemoteThreadId` derives the
   * SAME remote deep-agent thread id deterministically, so the underlying agent literally
   * remembers prior turns) without a second id-mapping table anywhere.
   */
  readonly onThreadResolved?: (threadId: string) => void;
  /**
   * #654 阶段2b. Fired ONCE, right after `acceptHumanMessage` + `kick` succeed and BEFORE
   * the poll loop's first iteration -- i.e. exactly when there is a real, running Agent
   * Run to report, never for a request that failed validation (bad agent id, thread not
   * visible, …) before one existed. A caller emitting an AG-UI `RUN_STARTED` from this hook
   * gets it in the right place: after the run genuinely started, but strictly before any
   * `onDelta` fragment (the loop that calls `onDelta` cannot begin until this already ran).
   */
  readonly onStarted?: () => void;
  /**
   * #654 阶段2b. Fired, in `seq` order, for every model-output fragment observed while
   * polling -- BEFORE this function returns, never after. Omit it to get 阶段1b's exact
   * behaviour (see file head). Errors thrown by this callback propagate out of
   * `runAguiBridgeTurn` exactly like a transport error would -- a caller that persists or
   * forwards deltas downstream (e.g. writing them onto an SSE response) does not want a
   * failed write silently swallowed here.
   */
  readonly onExecutionEvent?: (event: ExecutionEvent) => void;
  readonly onDelta?: (delta: string) => void;
  /**
   * #789 -- fired, in `seq` order, for every `tool_call` step observed while polling
   * (i.e. real progress: #742/#756's `ModelCallProgressEvent`s that `execute-run.ts`
   * already turns into durable `AppendedRunStep` rows for #740/#788's
   * `DeepAgentModelProvider.completeWithProgress`, AND the pre-existing #725 TS tool
   * loop's steps -- this reads the SAME `RunProjection.steps` either mechanism appends
   * to, so it needs no notion of which one produced a given step). Omit it to get the
   * exact behaviour before this field existed.
   *
   * Unlike `onDelta`, this needs NO separate read and NO end-of-loop flush: `steps` comes
   * off the SAME `readAgentRun` call this loop already makes every iteration to check
   * `status`, and `execute-run.ts`'s writeback pipeline guarantees every `tool_call` step
   * for a run is durable strictly BEFORE that run can reach `succeeded`/`failed` (the
   * writeback transaction is a later, separate step -- see `AgentRunStore.commitWriteback`'s
   * own doc). There is no read-then-read race here the way `onDelta`'s file-head comment
   * describes for deltas, because there is only ONE read.
   *
   * DA-19g -- the second argument is `true` only for a step reported in the SAME poll
   * iteration where the run's overall status is `"awaiting_tool_permission"` -- i.e., only for
   * the ONE `"in_progress"` step that IS the pending interrupt, never for an ordinary
   * multi-step tool call's own "announced, still executing" progress frame (a run in
   * plain `"running"` status can ALSO report `"in_progress"` steps -- #742 Gap 1's
   * announce-before-resolve semantics apply to every tool call, not only ones that pause
   * for a human -- so `step.status === "in_progress"` alone is not enough signal; see
   * `writeToolCallStep`'s own doc for why this distinction matters). `false` for every
   * other step, matching the exact behaviour before this parameter existed.
   */
  readonly onStep?: (step: RunStepPublic, isPendingApproval: boolean) => void;
  /**
   * 2026-09-02 —— run 在第一个工具调用 / 第一个 token 之前的两个真实阶段（见
   * `@repo/contracts/agui-state-events` 的 `AGUI_RUN_PHASE_EVENT_NAME` 头注）：
   *   · `context_building`：本轮询第一次看到 `status === "running"`（执行器已认领）；
   *   · `model_thinking`：账本里第一次出现 `context_built` 步骤。
   * 每个阶段最多触发一次；与 `onStep` 读的是同一次 `readAgentRun`，没有额外查询。
   * 省略时行为与此前逐字相同。
   */
  readonly onPhase?: (phase: AguiRunPhase) => void;
}

/** The subset of a `tool_call` `AppendedRunStep` an AG-UI consumer needs -- `runId`/`seq`
 * are already implicit in "this run, this poll's steps array", and every OTHER step kind
 * (`context_built`/`model_called`/`chat_writeback`) is internal bookkeeping this bridge has
 * never surfaced (see 阶段1b/2b: only `TEXT_MESSAGE_*`/`RUN_*` ever crossed the wire before
 * this field), so `onStep` only ever fires for `kind === "tool_call"`. */
export interface RunStepPublic {
  /** #742 Gap 1: `"in_progress"` joined the two terminal values -- an AG-UI consumer of
   * `onStep` now sees a tool call announced BEFORE it resolves, not only once it has. */
  readonly status: "succeeded" | "failed" | "in_progress";
  readonly toolName: string | null;
  readonly toolArgsSummary: string | null;
  readonly toolResultSummary: string | null;
  readonly planningNote: string | null;
}

export type AguiBridgeOutcome =
  | { readonly kind: "paused"; readonly threadId: string; readonly runId: string }
  | {
    readonly kind: "succeeded";
    readonly threadId: string;
    readonly runId: string;
    readonly messageId: string;
    readonly text: string;
  }
  | { readonly kind: "failed"; readonly threadId: string; readonly runId: string; readonly error: string }
  | { readonly kind: "timeout"; readonly threadId: string; readonly runId: string }
  /**
   * DA-19g -- the run halted on a real interrupt (DA-07b's `awaiting_tool_permission`), not a
   * timeout and not a failure. `onStep` already delivered the pending `tool_call` step
   * (status `"in_progress"`) to the caller in THIS SAME poll iteration (`onStep` fires
   * before the terminal-status branches below, same ordering discipline as `succeeded`/
   * `failed`) -- so by the time a caller sees this outcome kind, it already knows WHICH
   * tool call is pending. This is why the outcome itself carries no `pendingApproval`
   * payload of its own: it would just be `projection.pendingApproval` duplicated through a
   * second channel, and this file's own discipline elsewhere (`onDelta`/`onStep`) is "one
   * fact, one channel".
   */
  | { readonly kind: "awaiting_tool_permission"; readonly threadId: string; readonly runId: string };

async function readExecutionCursor(runs: AgentRunStore, orgId: OrgId, runId: string): Promise<number> {
  let cursor = -1;
  if (!runs.readExecutionEvents) return cursor;
  while (true) {
    const events = await runs.readExecutionEvents(orgId, runId, cursor);
    cursor = events.at(-1)?.seq ?? cursor;
    if (events.length < 1000) return cursor;
  }
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** The run reached `awaiting_tool_permission` again immediately after a resume without ever
 * making it back to `running` from this bridge's point of view. Not expected on the happy
 * path (a resumed run either completes or hits a NEW interrupt further down its own logic),
 * but a second interrupt on the very next tool call is a legitimate agent behaviour, not a
 * bug -- `resumeAguiBridgeTurn`'s poll loop below handles it exactly like the first one. */

/** Shared polling tail of both `runAguiBridgeTurn` (fresh turn) and `resumeAguiBridgeTurn`
 * (HITL resume, DA-19g) -- everything AFTER a run genuinely exists and is executing. Kept
 * as one function so the two entry points cannot drift on poll cadence, delta/step
 * ordering, or the `awaiting_tool_permission`/`succeeded`/`failed`/`timeout` outcome mapping. */
async function pollAguiRunToOutcome(
  deps: AguiBridgeDeps,
  input: {
    readonly userId: string;
    readonly orgId: OrgId;
    readonly threadId: string;
    readonly runId: string;
    readonly pollIntervalMs?: number;
    readonly maxPolls?: number;
    readonly onExecutionEvent?: (event: ExecutionEvent) => void;
  readonly onDelta?: (delta: string) => void;
    readonly onStep?: (step: RunStepPublic, isPendingApproval: boolean) => void;
    readonly onPhase?: (phase: AguiRunPhase) => void;
    /**
     * DA-19g -- where THIS call's cursors start from, not always "the beginning of the
     * run's own history". A fresh turn (`runAguiBridgeTurn`) has nothing to skip -- the run
     * was just created, so the defaults (`-1`/`0`, "nothing reported yet") are correct. A
     * RESUME (`resumeAguiBridgeTurn`) is polling a run whose `steps`/deltas ALREADY include
     * everything this bridge already streamed to the client during the turn that hit the
     * interrupt (`RunProjection.steps`/`readModelDeltas` are the run's FULL history, not
     * "history since this poll call started", see those ports' own docs) -- without this,
     * a resume's first iteration would re-report the interrupt's own planning text, tool
     * call, and every prior delta a second time (a real browser e2e bug this task's own
     * verification caught: the pending tool call's announcement bubble and the model's
     * initial answer chunk both duplicated in the UI after approving). Omitted = the fresh-
     * turn defaults, unchanged from before this field existed.
     */
    readonly initialLastSeenDeltaSeq?: number;
    readonly initialExecutionSeq?: number;
    readonly initialReportedStepCount?: number;
  },
): Promise<AguiBridgeOutcome> {
  const { threadId, runId } = input;
  const pollIntervalMs = input.pollIntervalMs ?? DEFAULT_RUN_POLL_INTERVAL_MS;
  // See `poll-budget.ts` -- this used to default to 75 (~30s), independently of
  // `stream-run.ts`'s ~90s budget, and a slower run (e.g. a multi-block canvas template)
  // could time out here well before it actually finished server-side.
  const maxPolls = input.maxPolls ?? DEFAULT_RUN_MAX_POLLS;
  let lastSeenDeltaSeq = input.initialLastSeenDeltaSeq ?? -1;
  let reportedStepCount = input.initialReportedStepCount ?? 0;
  let lastExecutionSeq = input.initialExecutionSeq ?? -1;
  let reportedRunning = false;
  let reportedContextBuilt = false;

  const flushExecutionEvents = async (): Promise<void> => {
    if (!input.onExecutionEvent || !deps.runs.readExecutionEvents) return;
    while (true) {
      const events = await deps.runs.readExecutionEvents(input.orgId, runId, lastExecutionSeq);
      for (const event of events) { input.onExecutionEvent(event); lastExecutionSeq = event.seq; }
      if (events.length < 1000) return;
    }
  };

  // See `runAguiBridgeTurn`'s file-head comment on the 2026-08-08 CI-only race this closes.
  const flushRemainingDeltas = async (): Promise<void> => {
    if (!input.onDelta) return;
    const deltas = await deps.runs.readModelDeltas(input.orgId, runId, lastSeenDeltaSeq);
    for (const delta of deltas) {
      input.onDelta(delta.text);
      lastSeenDeltaSeq = delta.seq;
    }
  };

  for (let attempt = 0; attempt < maxPolls; attempt += 1) {
    await flushExecutionEvents();
    if (input.onDelta) {
      const deltas = await deps.runs.readModelDeltas(input.orgId, runId, lastSeenDeltaSeq);
      for (const delta of deltas) {
        input.onDelta(delta.text);
        lastSeenDeltaSeq = delta.seq;
      }
    }
    const projection = await readAgentRun(deps, { userId: input.userId, orgId: input.orgId, runId });
    if (input.onPhase) {
      if (!reportedRunning && projection.status !== "queued") {
        reportedRunning = true;
        if (projection.status === "running") input.onPhase("context_building");
      }
      if (!reportedContextBuilt
        && projection.steps.slice(reportedStepCount).some((step) => step.kind === "context_built")) {
        reportedContextBuilt = true;
        if (projection.status === "running") input.onPhase("model_thinking");
      }
    }
    if (input.onStep) {
      // DA-19g -- `true` only when THIS iteration's run status is genuinely
      // `"awaiting_tool_permission"` -- see `AguiBridgeInput.onStep`'s own doc for why
      // `step.status === "in_progress"` alone conflates a real interrupt with an ordinary
      // multi-step tool call's own "announced, still executing" progress frame.
      const isPendingApproval = projection.status === "awaiting_tool_permission";
      for (const step of projection.steps.slice(reportedStepCount)) {
        if (step.kind === "tool_call") input.onStep(step, isPendingApproval);
      }
      reportedStepCount = projection.steps.length;
    }
    if (projection.status === "succeeded") {
      await flushRemainingDeltas();
      await flushExecutionEvents();
      if (projection.resultMessageId === null) throw new AguiBridgeResultUnreadableError();
      const page = await listMessagePage(deps, {
        userId: input.userId, orgId: input.orgId, threadId, limit: 100,
      });
      const message = page.messages.find((m) => m.id === projection.resultMessageId);
      if (message === undefined) throw new AguiBridgeResultUnreadableError();
      return { kind: "succeeded", threadId, runId, messageId: message.id, text: message.text };
    }
    if (projection.status === "paused") {
      await flushExecutionEvents();
      return { kind: "paused", threadId, runId };
    }
    if (projection.status === "failed") {
      await flushRemainingDeltas();
      await flushExecutionEvents();
      if (await deps.runs.isPausedAtCheckpoint?.(input.orgId, runId)) return { kind: "paused", threadId, runId };
      return { kind: "failed", threadId, runId, error: projection.error ?? "UNKNOWN" };
    }
    // DA-19g -- run halted on a real interrupt, not a failure and not "still working": the
    // pending `tool_call` step (status `"in_progress"`) was already handed to `onStep`
    // above, in THIS SAME iteration, before this check -- same ordering discipline
    // `succeeded`/`failed` already get. Returning immediately here (instead of falling
    // through to `sleep()` and re-polling until `maxPolls`) is the fix for the bug this
    // file's own `onStep` doc used to describe as "never designed to cover this": a run
    // parked on a human decision is not progress that should keep being polled for, and it
    // is definitely not a timeout.
    if (projection.status === "awaiting_tool_permission") {
      await flushRemainingDeltas();
      await flushExecutionEvents();
      return { kind: "awaiting_tool_permission", threadId, runId };
    }
    await sleep(pollIntervalMs);
  }
  return { kind: "timeout", threadId, runId };
}

async function resolveThreadId(deps: AguiBridgeDeps, input: AguiBridgeInput): Promise<string> {
  if (typeof input.threadId === "string" && input.threadId.trim() !== "") return input.threadId;
  // issue #2039（UIUX 第 2 轮 gap #1）—— 标题此前是 `CopilotKit ${ISO 时间戳}`：
  // 厂商词 + 机器时间戳直接成为左栏线程卡的用户可见标题（#1830 同类裁决：用户可见
  // 文案不出现开发者词汇）。传 `null` 走 `titleForPersonalCreate` 的既有默认
  // `DEFAULT_PERSONAL_THREAD_TITLE`（「新对话」）——与旧轨道「新建对话」同一个
  // 文案事实源，不在这里再写一份字符串。时间信息本来就在卡片副行（lastActivityAt）。
  const created = await mutateThread(deps, {
    userId: input.userId, orgId: input.orgId, op: "create", projectId: null,
    threadId: null, groupId: null, title: null,
    visibilityScope: null, expectedVersion: null, reason: null,
  });
  return created.threadId;
}

export async function runAguiBridgeTurn(
  deps: AguiBridgeDeps,
  input: AguiBridgeInput,
): Promise<AguiBridgeOutcome> {
  const threadId = await resolveThreadId(deps, input);
  input.onThreadResolved?.(threadId);

  const accepted = await acceptHumanMessage(deps, {
    userId: input.userId, orgId: input.orgId, threadId,
    clientMessageId: input.clientMessageId, text: input.text, agentId: input.agentId,
    attachmentIds: input.attachmentIds,
    onAccepted: () => deps.executor.kick(input.orgId),
  });

  // #2693 -- `accepted.reused` means this call's `clientMessageId` was a RETRY that
  // reattached to a run an EARLIER request already started polling (the controller
  // deliberately reuses `clientMessageId` on retry so `acceptHumanMessage`'s idempotency
  // guard hands back the same run -- see `copilotkit-agui.controller.ts`'s file head,
  // issue #2321 round 2). Without this, this fresh `pollAguiRunToOutcome` call would start
  // its cursors at the defaults (nothing reported yet) and re-announce every `onStep`/
  // `onDelta` fragment the run already has -- including a still-`in_progress` HITL
  // interrupt step -- under a BRAND NEW `toolCallId` (`writeToolCallStep` mints one per
  // call), which is what made "确认一下我的理解，再开始" render two/three times for one
  // logical interrupt. Snapshotting "what's already there" BEFORE this poll starts is the
  // exact same fix `resumeAguiBridgeTurn` already applies for the HITL-resume path below
  // (see that function's own comment on `initialReportedStepCount`/`initialLastSeenDeltaSeq`
  // for the sibling browser e2e bug this mirrors).
  let initialReportedStepCount: number | undefined;
  let initialLastSeenDeltaSeq: number | undefined;
  if (accepted.reused === true) {
    const preRetryProjection = await readAgentRun(deps, {
      userId: input.userId, orgId: input.orgId, runId: accepted.agentRunId,
    });
    initialReportedStepCount = preRetryProjection.steps.length;
    const preRetryDeltas = input.onDelta
      ? await deps.runs.readModelDeltas(input.orgId, accepted.agentRunId, -1)
      : [];
    initialLastSeenDeltaSeq = preRetryDeltas.length > 0
      ? preRetryDeltas[preRetryDeltas.length - 1]!.seq
      : -1;
  }

  input.onStarted?.();

  return pollAguiRunToOutcome(deps, {
    userId: input.userId, orgId: input.orgId, threadId, runId: accepted.agentRunId,
    pollIntervalMs: input.pollIntervalMs, maxPolls: input.maxPolls,
    onExecutionEvent: input.onExecutionEvent, onDelta: input.onDelta, onStep: input.onStep, onPhase: input.onPhase,
    initialReportedStepCount, initialLastSeenDeltaSeq,
  });
}

/** The run this Chat thread is currently paused on is not `awaiting_tool_permission` any more --
 * either it never was (a stray/duplicate resume call), or someone else already resolved it
 * (double-click, a second browser tab, a retried request). Either way there is nothing left
 * to resume, and this is NOT the same fact as `AgentRunNotAwaitingToolPermissionError` (that one
 * fires once a specific run id is already in hand and its state changed out from under a
 * `decideAgentRun` call already in flight -- this one fires before a run id was even found). */
export class NoAwaitingToolPermissionRunError extends Error {}

/**
 * DA-19g -- resumes a run the AG-UI/CopilotRuntime bridge previously reported as
 * `awaiting_tool_permission` (`AguiBridgeOutcome.kind === "awaiting_tool_permission"`), driven by
 * CopilotKit's `useHumanInTheLoop` `respond()` follow-up `runAgent` call. See
 * `copilotkit-agui.controller.ts`'s file head for the full wire-level story of why that
 * follow-up carries a Chat thread id (`forwardedProps.chatThreadId`) and a decision-shaped
 * tool-result message, but no run id of its own.
 *
 * This DELIBERATELY reuses `decideAgentRun` (DA-07b, `decide-agent-run.ts`) -- the exact
 * same function `POST /agent-runs/:runId/decision` calls -- rather than re-implementing
 * approve/edit/reject against `AgentRunStore` a second time. Everything downstream of "the
 * run is back in `queued` with a `pending_decision`" (claim, `command.resume`, resuming the
 * SAME remote deep-agent thread, writeback) is the SAME machinery the REST path already
 * exercises; this function's own job stops at finding the run id and handing the decision
 * to that shared function, then polling the outcome back out with the SAME
 * `pollAguiRunToOutcome` tail `runAguiBridgeTurn` uses for a fresh turn.
 */
export async function resumeAguiBridgeTurn(
  deps: AguiBridgeDeps & DecideAgentRunDeps,
  input: {
    readonly userId: string;
    readonly orgId: OrgId;
    readonly threadId: string;
    readonly decision:
      | { readonly kind: "approve" | "reject" }
      | { readonly kind: "edit"; readonly editedArgs: Readonly<Record<string, unknown>> };
    readonly onStarted?: () => void;
    readonly onExecutionEvent?: (event: ExecutionEvent) => void;
  readonly onDelta?: (delta: string) => void;
    readonly onStep?: (step: RunStepPublic, isPendingApproval: boolean) => void;
    readonly onPhase?: (phase: AguiRunPhase) => void;
    readonly pollIntervalMs?: number;
    readonly maxPolls?: number;
  },
): Promise<AguiBridgeOutcome> {
  const runId = await deps.runs.findAwaitingToolPermissionRunId(input.orgId, input.threadId);
  if (runId === null) throw new NoAwaitingToolPermissionRunError();

  // DA-19g -- snapshot "what has already been reported" BEFORE `decideAgentRun` requeues
  // and kicks the run, so `pollAguiRunToOutcome` below starts its cursors from HERE, not
  // from the run's true beginning. A run parked on `awaiting_tool_permission` already has the
  // pending tool_call step (and every delta up to the interrupt) durable -- those were
  // already streamed to the client during the turn that hit the interrupt (see
  // `pollAguiRunToOutcome`'s own doc on `initialLastSeenDeltaSeq`/`initialReportedStepCount`
  // for the real browser e2e bug this closes: without it, resuming re-announces the SAME
  // pending tool call and re-streams the SAME initial answer chunk a second time). Reading
  // this before the decision (not after) is deliberate too: `decideAgentRun` can trigger
  // `kick` -> the executor may start producing NEW steps/deltas immediately after it
  // returns, and this snapshot must be the boundary strictly BEFORE that, never after.
  const preDecisionProjection = await readAgentRun(deps, { userId: input.userId, orgId: input.orgId, runId });
  const preDecisionDeltas = input.onDelta
    ? await deps.runs.readModelDeltas(input.orgId, runId, -1)
    : [];
  const initialExecutionSeq = await readExecutionCursor(deps.runs, input.orgId, runId);
  const initialReportedStepCount = preDecisionProjection.steps.length;
  const initialLastSeenDeltaSeq = preDecisionDeltas.length > 0
    ? preDecisionDeltas[preDecisionDeltas.length - 1]!.seq
    : -1;

  await decideAgentRun(deps, {
    userId: input.userId, orgId: input.orgId, runId,
    ...(input.decision.kind === "edit"
      ? { decision: "edit" as const, editedArgs: input.decision.editedArgs }
      : { decision: input.decision.kind }),
  });
  // `decideAgentRun` already performed the ENTIRE decision (state transition + `kick`,
  // including `reject`'s terminal `failRun`) before returning -- unlike `runAguiBridgeTurn`'s
  // `onStarted`, which fires right as a run begins, this fires right as one resumes. A
  // rejected run is already `failed` by the time this poll loop's first iteration reads it;
  // it costs one extra `readAgentRun` round trip to discover that, not a real wait.
  input.onStarted?.();

  return pollAguiRunToOutcome(deps, {
    userId: input.userId, orgId: input.orgId, threadId: input.threadId, runId,
    pollIntervalMs: input.pollIntervalMs, maxPolls: input.maxPolls,
    onExecutionEvent: input.onExecutionEvent, onDelta: input.onDelta, onStep: input.onStep, onPhase: input.onPhase,
    initialReportedStepCount, initialLastSeenDeltaSeq, initialExecutionSeq,
  });
}

/**
 * issue #2767 -- 同 `resumeAguiBridgeTurn` 的整体结构（找 runId → 快照已报告到哪里 →
 * 裁决 → 轮询到终态），但裁决走 F06 的 `decideToolPermission`（四选一：once/run/
 * forever/deny）而不是旧 DA-07b 的 `decideAgentRun`（approve/edit/reject）——两者是
 * `decide-tool-permission.ts` 自己文档说的"迁移期共存的两条并行出口"，`deny` 与旧
 * `reject` 的终态语义不同（`deny` 让 run 回到 `queued`、内核收到拒绝结果后自己调整
 * 计划继续跑，不是直接 `failRun`，见 R3 步骤 6），所以不能把两条路径合成一条。
 *
 * `call_skill` 的 `ToolPermissionCard`（`components/chat/chat-host-tool-permission.tsx`）
 * `respond()` 这四个字面量时落在这条函数上，见 `copilotkit-agui.controller.ts`
 * `parseHitlDecision` 自己的文档。三个具名虚拟工具（`confirm_task_intent`/
 * `fill_run_params`/`choose_execution_option`）仍然用 `respond("approved")`/编辑对象，
 * 继续走上面的 `resumeAguiBridgeTurn`，不受影响。
 */
export async function resumeAguiBridgeTurnToolPermission(
  deps: AguiBridgeDeps & DecideToolPermissionDeps,
  input: {
    readonly userId: string;
    readonly orgId: OrgId;
    readonly threadId: string;
    readonly decision: ToolPermissionDecisionKind;
    /** `decideToolPermission` 收下这个字段但不参与判定（同一个 run 同一时刻只可能有
     *  一个待批工具调用，见该函数自己的文档）——这里传 AG-UI 消息里带的
     *  `toolCallId`（拿不到就传空串），只为了错误信息里能回显真实值。 */
    readonly toolCallId: string;
    readonly onStarted?: () => void;
    readonly onExecutionEvent?: (event: ExecutionEvent) => void;
  readonly onDelta?: (delta: string) => void;
    readonly onStep?: (step: RunStepPublic, isPendingApproval: boolean) => void;
    readonly onPhase?: (phase: AguiRunPhase) => void;
    readonly pollIntervalMs?: number;
    readonly maxPolls?: number;
  },
): Promise<AguiBridgeOutcome> {
  const runId = await deps.runs.findAwaitingToolPermissionRunId(input.orgId, input.threadId);
  if (runId === null) throw new NoAwaitingToolPermissionRunError();

  // 同 `resumeAguiBridgeTurn` 的既有纪律：裁决之前先快照"已经报告到哪里"，
  // `decideToolPermission` 内部的 `kick` 可能让执行器立刻产生新内容。
  const preDecisionProjection = await readAgentRun(deps, { userId: input.userId, orgId: input.orgId, runId });
  const preDecisionDeltas = input.onDelta
    ? await deps.runs.readModelDeltas(input.orgId, runId, -1)
    : [];
  const initialExecutionSeq = await readExecutionCursor(deps.runs, input.orgId, runId);
  const initialReportedStepCount = preDecisionProjection.steps.length;
  const initialLastSeenDeltaSeq = preDecisionDeltas.length > 0
    ? preDecisionDeltas[preDecisionDeltas.length - 1]!.seq
    : -1;

  await decideToolPermission(deps, {
    userId: input.userId, orgId: input.orgId, runId,
    toolCallId: input.toolCallId, decision: input.decision,
  });
  input.onStarted?.();

  return pollAguiRunToOutcome(deps, {
    userId: input.userId, orgId: input.orgId, threadId: input.threadId, runId,
    pollIntervalMs: input.pollIntervalMs, maxPolls: input.maxPolls,
    onExecutionEvent: input.onExecutionEvent, onDelta: input.onDelta, onStep: input.onStep, onPhase: input.onPhase,
    initialReportedStepCount, initialLastSeenDeltaSeq, initialExecutionSeq,
  });
}

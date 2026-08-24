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
import type {
  ChatMessageCommandRepository, PublishedAgentReader, ThreadMountedSkillReader,
} from "../chat/message-command-ports";
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
  /** #1559：`acceptHumanMessage` 的必填依赖——线程级临时挂载进入 run 快照的读口。 */
  readonly threadMounts: ThreadMountedSkillReader;
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
   */
  readonly onStep?: (step: RunStepPublic) => void;
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
  input.onThreadResolved?.(threadId);

  const accepted = await acceptHumanMessage(deps, {
    userId: input.userId, orgId: input.orgId, threadId,
    clientMessageId: input.clientMessageId, text: input.text, agentId: input.agentId,
  });
  deps.executor.kick(input.orgId);
  input.onStarted?.();

  const pollIntervalMs = input.pollIntervalMs ?? 400;
  const maxPolls = input.maxPolls ?? 75; // ~30s bound at the default interval.
  const runId = accepted.agentRunId;
  let lastSeenDeltaSeq = -1;
  // #789: `RunProjection.steps` is the run's FULL step list so far, oldest-first
  // (`ORDER BY seq, started_at`, `pg-agent-run-repository.ts`'s `readRun`), append-only --
  // a plain length cursor is enough to find "steps this poll hasn't reported yet" without
  // needing each entry's own `seq` (which `RunProjection.steps`'s own type omits).
  let reportedStepCount = 0;

  /**
   * ⚠ 2026-08-08 CI 实测（不是本地——本地机器上 5/5 绿，CI 上稳定红，正是竞态的
   * 典型指纹：窗口够窄时快机器几乎踩不中，调度更粗的环境几乎每次踩中）：
   * 「读增量、读状态」在同一轮循环里是**两次独立的 await**，中间有一个真实的时间
   * 窗口。`execute-run.ts` 保证的只是"增量的写入顺序早于 succeeded 的写入顺序"，
   * 不保证"本轮读增量的那一刻"与"本轮读状态的那一刻"看到的是同一个快照——如果
   * 最后一条增量恰好在这两次读之间才提交，这一轮的增量读就已经完成、不会重试，
   * 而这一轮的状态读却已经能看到终态，于是最后一条增量被跳过、再也没有下一轮
   * 循环去补读它。
   *
   * 修复：一旦观测到终态，在真正返回之前**再补读一次**增量（`flushRemainingDeltas`）。
   * 终态本身不会消失（`agent_runs` 状态机没有"回退"），补读只会把恰好卡在两次读
   * 之间的那一条追上，不会引入新的竞态。
   */
  const flushRemainingDeltas = async (): Promise<void> => {
    if (!input.onDelta) return;
    const deltas = await deps.runs.readModelDeltas(input.orgId, runId, lastSeenDeltaSeq);
    for (const delta of deltas) {
      input.onDelta(delta.text);
      lastSeenDeltaSeq = delta.seq;
    }
  };

  for (let attempt = 0; attempt < maxPolls; attempt += 1) {
    if (input.onDelta) {
      // Read BEFORE checking status this same iteration -- see file head "ordering is
      // load-bearing" for why a terminal status can never leave a delta MORE THAN ONE
      // POLL INTERVAL stale here. (It does NOT, on its own, rule out losing the very
      // last delta to the read-then-read race described above -- that is what the
      // `flushRemainingDeltas()` calls below close.)
      const deltas = await deps.runs.readModelDeltas(input.orgId, runId, lastSeenDeltaSeq);
      for (const delta of deltas) {
        input.onDelta(delta.text);
        lastSeenDeltaSeq = delta.seq;
      }
    }
    const projection = await readAgentRun(deps, { userId: input.userId, orgId: input.orgId, runId });
    // #789: report BEFORE the terminal-status branches below -- a step that lands in the
    // SAME poll a run turns terminal must still reach the caller before RUN_FINISHED/
    // RUN_ERROR, same ordering discipline `onDelta` above already keeps for text.
    if (input.onStep) {
      for (const step of projection.steps.slice(reportedStepCount)) {
        if (step.kind === "tool_call") input.onStep(step);
      }
      reportedStepCount = projection.steps.length;
    }
    if (projection.status === "succeeded") {
      await flushRemainingDeltas();
      if (projection.resultMessageId === null) throw new AguiBridgeResultUnreadableError();
      const page = await listMessagePage(deps, {
        userId: input.userId, orgId: input.orgId, threadId, limit: 100,
      });
      const message = page.messages.find((m) => m.id === projection.resultMessageId);
      if (message === undefined) throw new AguiBridgeResultUnreadableError();
      return { kind: "succeeded", threadId, runId, messageId: message.id, text: message.text };
    }
    if (projection.status === "failed") {
      await flushRemainingDeltas();
      return { kind: "failed", threadId, runId, error: projection.error ?? "UNKNOWN" };
    }
    await sleep(pollIntervalMs);
  }
  return { kind: "timeout", threadId, runId };
}

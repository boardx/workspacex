/**
 * Ports for the minimal no-tool AgentRun (Wave 2 delta §5, #414).
 *
 * ## There is exactly one model port, and it takes no provider choice
 *
 * `ModelCallPort.complete` receives the run's PINNED `modelProvider`/`modelId` and either
 * performs that one call or refuses. It has no "try the next one" parameter, no candidate
 * list and no default. §5 says one configured provider and no fallback; a port shaped to
 * accept alternatives would make that a discipline every future caller has to remember,
 * and the failure mode of forgetting is silent -- a run answered by a model nobody pinned.
 *
 * ## The snapshot is an INPUT to this layer, never something it resolves
 *
 * Everything the executor needs about the Agent arrives on `ClaimedAgentRun`, read from
 * the run row that #415 wrote at acceptance. Nothing here can ask for "the Agent's current
 * version": there is no method for it. That is deliberate -- §4 says an Agent's published
 * head moves while existing runs keep their stored version id, and a port that could
 * resolve a head is a port through which that invariant leaks.
 */
import { wave2Runtime as C } from "@repo/contracts";
import type { z } from "zod";
import type { OrgId } from "../../domain/org-id";
import type { Guarded } from "../security/permission-filter";

/** Derived from the contract's enums, never restated (ADR-020). */
export type RunFailureCode = z.infer<typeof C.AgentRunError>;
export type RunStepKind = z.infer<typeof C.AgentRunStepKind>;
export type RunLifecycleStatus = z.infer<typeof C.AgentRunStatus>;

/**
 * The outcome of claiming one run.
 *
 * A union rather than "return only the good ones", because a claim already moved the row
 * out of `queued`: dropping the unresolvable ones on the floor would leave them `running`
 * with no step and no terminal state -- a message that is simply never answered, and the
 * one outcome an operator cannot act on. The executor fails them explicitly.
 */
export type ClaimOutcome =
  | { readonly kind: "executable"; readonly run: ClaimedAgentRun }
  | { readonly kind: "unresolvable"; readonly runId: string };

/**
 * V9-b 前置 A（#970）—— 一条消息挂着的附件**元数据**（文件名 + MIME，不含内容）。
 * V9-a 只上传+存储附件；附件**内容**进上下文是 B（F153/anydoc）。A 让模型至少*知道*
 * 有附件、能诚实说「我看到你传了 X（image/png），但还读不了它的内容」，而不是矢口否认。
 */
export interface HistoryAttachmentMeta {
  readonly filename: string;
  readonly mime: string;
  /**
   * V9-b（F153）—— 抽取状态：`pending` | `extracted` | `unsupported` | `failed`
   * （缺省视为 pending：尚未抽取/旧数据）。决定 `withAttachmentNotice` 怎么向模型交代这个附件。
   */
  readonly extractionStatus?: string;
  /**
   * V9-b（F153）—— 抽取内容的**有界摘录**（`extractionStatus==='extracted'` 时有；域
   * `boundedExcerpt` 已按 `EXTRACTED_EXCERPT_MAX_CHARS` 截断）。这就是折进模型上下文的正文。
   */
  readonly extractedExcerpt?: string;
}

/** One queued run, claimed for execution, carrying its whole acceptance snapshot. */
export interface ClaimedAgentRun {
  readonly runId: string;
  readonly threadId: string;
  readonly projectId: string;
  readonly inputMessageId: string;
  readonly inputText: string;
  /**
   * V9-b 前置 A（#970）—— 触发这次运行的那条人类消息挂的附件（元数据）。触发消息**不在**
   * `readThreadHistory` 里（它以 `inputText` 单独进模型），所以它的附件也要单独带，否则「刚
   * 传完就问」这条最常见路径恰好看不到附件。没有附件时是空数组。
   */
  readonly inputAttachments: readonly HistoryAttachmentMeta[];
  /**
   * F159 —— 谁触发了这次 run。`agent_runs` 没有这一列，值取自触发它的那条人类消息的
   * 作者（`chat_messages.author_id`，与 claim 同一次 JOIN 带出）。计量必须归属到人：
   * 配额是按人分配的，只有组织级总数的话「成员与配额」那一屏无从填。
   */
  readonly requesterUserId: string;
  readonly agentId: string;
  readonly agentVersionId: string;
  readonly instructions: string;
  /** In the snapshot's order. The order is part of the pinned fact, not a set. */
  readonly skillVersionIds: readonly string[];
  readonly modelProvider: string;
  readonly modelId: string;
}

export interface PinnedSkillContent {
  readonly versionId: string;
  readonly content: string;
  /**
   * The Skill's stable, tool-name-shaped identifier (#725). Matches the contract's
   * `StableName` pattern (`^[a-z0-9][a-z0-9-]*$`), a strict subset of what an OpenAI-style
   * function name allows -- used AS the tool name a run's orchestrator model sees, so a
   * skill's tool identity does not drift from the identity it already has everywhere else.
   */
  readonly stableName: string;
  /** Display name, for the tool description a human/model reads -- never the tool name itself. */
  readonly name: string;
}

export interface AppendedRunStep {
  readonly runId: string;
  readonly seq: number;
  readonly kind: RunStepKind;
  readonly status: "succeeded" | "failed";
  readonly startedAt: string;
  readonly endedAt: string;
  readonly inputDigest: string | null;
  readonly outputDigest: string | null;
  readonly failureCode: RunFailureCode | null;
  /** `tool_call` steps only (#725) -- see `AgentRunStep`'s own doc comment for why these are
   * short summaries rather than digests. `null` for every other step kind. */
  readonly toolName: string | null;
  readonly toolArgsSummary: string | null;
  readonly toolResultSummary: string | null;
  /** `tool_call` steps only (#731 follow-up) -- see `AgentRunStep.planningNote`'s own doc
   * comment. `null` when the model called the tool with no accompanying explanation. */
  readonly planningNote: string | null;
}

/**
 * One token-level increment of a run's model output (#654 阶段2a).
 *
 * Deliberately NOT an `AppendedRunStep`/`RunStepKind` variant -- see the migration's own
 * header (`20260808120000_i654_agent_run_deltas.sql`) for why the two shapes do not share
 * a table: steps are four coarse, statused phases mirrored 1:1 with a contract enum;
 * deltas are dozens-to-hundreds of plain text fragments with no status of their own. The
 * run's `model_called` step still records success/failure exactly as before -- deltas are
 * an ADDITIONAL, purely observational trail, never a second source of truth for whether
 * the call succeeded.
 */
export interface AppendedRunDelta {
  readonly runId: string;
  readonly seq: number;
  readonly text: string;
}

/** One delta read back, in `seq` order. */
export interface RunDelta {
  readonly seq: number;
  readonly text: string;
  readonly createdAt: string;
}

/** What `GET /agent-runs/:runId` projects, once the requester has been cleared. */
export interface RunProjection {
  readonly runId: string;
  readonly threadId: string;
  readonly inputMessageId: string;
  readonly agentId: string;
  readonly agentVersionId: string;
  readonly skillVersionIds: readonly string[];
  readonly modelProvider: string;
  readonly modelId: string;
  readonly status: RunLifecycleStatus;
  readonly error: RunFailureCode | null;
  readonly resultMessageId: string | null;
  readonly steps: readonly Omit<AppendedRunStep, "runId" | "seq">[];
  readonly createdAt: string;
}

/** Ids only -- enough to ASK the visibility question, never enough to answer it. */
export interface RunLocator {
  readonly threadId: string;
  readonly projectId: string;
}

/**
 * A run whose model output is stored and whose Chat writeback has not committed yet (§6).
 *
 * `text` is the output #414 stored on the run, not a fresh completion: a retry must write
 * back the answer the single model call produced, never call the provider again. That is
 * why this carries the text instead of enough context to regenerate it.
 */
export interface PendingWriteback {
  readonly runId: string;
  readonly threadId: string;
  readonly inputMessageId: string;
  readonly agentId: string;
  readonly text: string;
  /** Attempts already spent from the bounded budget. */
  readonly attempts: number;
}

export interface AgentRunStore {
  /**
   * Atomically move up to `limit` of this tenant's `queued` runs to `running` and return
   * their snapshots. The claim IS the exactly-once guarantee: two concurrent executors
   * cannot both leave `queued`, so the single model call cannot be made twice.
   */
  claimQueued(orgId: OrgId, limit: number): Promise<readonly ClaimOutcome[]>;

  /**
   * The pinned Skill versions' root `SKILL.md`, in the order asked for.
   *
   * Returns fewer entries than requested when a pinned version is unreachable; the caller
   * fails the run. It must NOT silently substitute a newer version or drop the entry --
   * that would turn "runs never resolve a mutable latest" (§3) into a best-effort claim.
   */
  readPinnedSkills(
    orgId: OrgId,
    versionIds: readonly string[],
  ): Promise<readonly PinnedSkillContent[]>;

  appendStep(orgId: OrgId, step: AppendedRunStep): Promise<void>;

  /**
   * Append one token-level delta (#654 阶段2a). Callers pass a monotonically increasing
   * `seq` starting at 0 per run; the unique `(org_id, run_id, seq)` constraint is what
   * makes a duplicate append (e.g. a retried write) a no-op collision rather than a second
   * copy of the same fragment.
   */
  appendModelDelta(orgId: OrgId, delta: AppendedRunDelta): Promise<void>;

  /** Deltas for one run, in `seq` order, strictly after `afterSeq` (`-1` = from the start). */
  readModelDeltas(orgId: OrgId, runId: string, afterSeq: number): Promise<readonly RunDelta[]>;

  /**
   * Store the model call's output and enter `writeback_pending` (§6's first step).
   *
   * `finalStepSeq` is the `seq` the caller recorded the terminal `model_called` step under
   * (#725: no longer always `3` -- a tool-calling run's `model_called` step lands after
   * however many `tool_call` steps the loop recorded). #413's writeback step and any #519
   * retry are appended AFTER it (`finalStepSeq + 1 + retryCount`, computed in the SQL
   * layer): the alternative, a hardcoded `4`, is exactly the number a tool-calling run's
   * variable step count would silently collide with.
   */
  storeOutputAwaitingWriteback(
    orgId: OrgId,
    runId: string,
    output: { readonly text: string; readonly finalStepSeq: number },
  ): Promise<void>;

  /** Terminal failure with a stable, enumerated code. There is no free-text variant. */
  failRun(orgId: OrgId, runId: string, code: RunFailureCode): Promise<void>;

  /** Runs sitting in `writeback_pending`, including ones stranded by a process restart. */
  claimWritebackPending(orgId: OrgId, limit: number): Promise<readonly PendingWriteback[]>;

  /**
   * The §6 transaction: insert the ONE assistant message, append the `chat_writeback` step,
   * and move the run to `succeeded` -- all or nothing.
   *
   * Returns the message id, which on a retry is the EXISTING row's: the unique
   * `agent_run_id` index is what makes the second attempt a no-op rather than a second
   * reply. There is no separate "did it already exist" flag, because no caller may behave
   * differently -- an implementation that can tell the two apart is one that can be made to
   * write a second message.
   */
  commitWriteback(
    orgId: OrgId,
    input: {
      readonly runId: string;
      readonly threadId: string;
      readonly inputMessageId: string;
      readonly agentId: string;
      readonly text: string;
      readonly startedAt: string;
      readonly endedAt: string;
      readonly outputDigest: string;
    },
  ): Promise<{ readonly messageId: string }>;

  /**
   * Spend one attempt from the bounded budget and report the new total.
   *
   * Its own transaction: the attempt that failed rolled back, so an increment written
   * inside it would be lost and the run would retry without bound.
   */
  recordWritebackAttempt(orgId: OrgId, runId: string): Promise<number>;

  /**
   * Reopen an exhausted writeback for one more bounded budget (#519). Returns whether a run
   * was actually reopened.
   *
   * A boolean rather than a throw, and the state test lives in the SQL rather than in the
   * caller: "is this run retryable?" read in the application and acted on in a later
   * statement is a race whose loser reopens a run that just succeeded. The predicate and the
   * write are one statement, and the database's transition trigger refuses the move
   * independently -- see `20260805190000_i519_agent_run_retry.sql`.
   *
   * It reopens to `writeback_pending`, NOT to `queued`: the model was already called once
   * and its output is stored, so re-queueing would make a second provider call for one human
   * message. What ran out was the writeback budget, so the writeback is what resumes.
   */
  reopenForWritebackRetry(orgId: OrgId, runId: string): Promise<boolean>;

  /** The failed `chat_writeback` step written once, when the budget is exhausted. */
  appendWritebackFailure(
    orgId: OrgId,
    input: { readonly runId: string; readonly startedAt: string; readonly endedAt: string },
  ): Promise<void>;

  findLocator(orgId: OrgId, runId: string): Promise<RunLocator | null>;

  readRun(orgId: OrgId, runId: string): Promise<Guarded<RunProjection> | null>;

  /**
   * Prior turns in this run's thread, strictly before `beforeMessageId`, in CHRONOLOGICAL
   * order (oldest of the kept window first). Only the most recent `limit` are returned --
   * the caller (`execute-run.ts`) applies its own character budget on top of this row cap,
   * but the row cap exists so a very long thread never asks Postgres to sort/return
   * thousands of rows just to throw most of them away one layer up (#709 multi-turn context).
   *
   * `beforeMessageId` must belong to the same thread; a message id from elsewhere yields an
   * empty result rather than an error -- this is prior conversation context, not a fact the
   * run's correctness depends on, so "found nothing" is a safe, quiet answer.
   */
  readThreadHistory(
    orgId: OrgId,
    threadId: string,
    beforeMessageId: string,
    limit: number,
  ): Promise<readonly ThreadHistoryMessage[]>;

  /** F154 L2 —— 读该线程的持久滚动摘要状态（`thread_context_state`）。还没摘要过 → null。 */
  readThreadContextState(orgId: OrgId, threadId: string): Promise<ThreadContextState | null>;

  /**
   * F154 L2 —— 增量 upsert 该线程的滚动摘要。`expectedVersion` 做乐观并发：撞并发（version 已变）
   * **不静默覆盖**，跳过本次写回并回 `false`。L2 是降级安全的（摘要没写成不 fail run，见
   * execute-run 组装），所以并发冲突安全放弃即可。首次写入传 `expectedVersion: 0`。
   */
  upsertThreadContextState(
    orgId: OrgId,
    threadId: string,
    state: {
      readonly summary: string;
      readonly summarizedThroughId: string | null;
      readonly summarizedThroughAt: string | null;
      readonly expectedVersion: number;
    },
  ): Promise<boolean>;
}

/**
 * One prior turn, already collapsed from `chat_messages.author_kind` ("human"/"agent") to
 * the `user`/`assistant` vocabulary every `ModelCallPort` implementation speaks -- the
 * repository does that mapping once here, so it is not re-decided at each of the three
 * provider implementations that read `ModelCallInput.history`.
 */
/**
 * F154 L2 —— 一条对话的持久滚动摘要状态（`thread_context_state` 一行）。L1（近 N 条逐字）之外的
 * 更早历史被折进 `summary`，组装时前置成一条 assistant 伪消息，打破 `HISTORY_MAX_MESSAGES` 硬上限。
 * `summarizedThrough{Id,At}` 是「已折到哪」的边界游标（(created_at,id) 单调）：下次只摘这之后的新消息。
 * `version` 是乐观并发的写回条件（读到多少就以多少为条件 upsert，撞并发不静默覆盖）。
 */
export interface ThreadContextState {
  readonly summary: string;
  readonly summarizedThroughId: string | null;
  readonly summarizedThroughAt: string | null;
  readonly version: number;
}

export interface ThreadHistoryMessage {
  readonly role: "user" | "assistant";
  readonly content: string;
  /**
   * V9-b 前置 A（#970）—— 这条历史消息挂的附件（元数据；见 `HistoryAttachmentMeta`）。
   * 空/缺省 = 没有附件。B（F153/anydoc）会在此之外再补抽取内容——A 是 B 的地基，不重做。
   */
  readonly attachments?: readonly HistoryAttachmentMeta[];
}

/**
 * #741 -- `ToolDefinition`/`ToolCallRequest`/`ToolExchangeTurn` (#725) retired along with
 * the TS in-process tool loop they only existed to serve (see `execute-run.ts`'s own
 * header for the replacement). They are gone from this file, not merely unused: nothing
 * produces a `ToolDefinition` or reads a `ToolCallRequest` anymore, and AGENTS.md's own
 * "same fact must not be declared in two places" discipline treats a type nobody
 * populates as exactly the kind of look-alive-but-dead surface that rule exists to catch.
 * `AppendedRunStep`'s `toolName`/`toolArgsSummary`/`toolResultSummary`/`planningNote`
 * fields (and the `tool_call` `RunStepKind`) are NOT part of this retirement -- those
 * belong to the run-step persistence schema and the Chat UI that renders it (#730-#734),
 * a broader, still-live surface this PR does not touch.
 */
/**
 * #742 -- one structured progress signal surfaced WHILE a run is still in flight, for a
 * provider whose "how does it get smarter" mechanism is a REMOTE, multi-step planning loop
 * rather than the in-process TS tool loop (#725) `execute-run.ts` otherwise runs. Today's
 * only intended implementer is `DeepAgentModelProvider` (issue #740/#747, talking to
 * `apps/deep-agent-service`'s `deepagents` graph, #739) -- see that file's own header
 * (once it lands) for how a real LangGraph run's intermediate state maps to this shape.
 *
 * Deliberately reuses the EXACT fields `AppendedRunStep`'s `tool_call` kind already
 * carries (`toolName`/`toolArgsSummary`/`toolResultSummary`/`planningNote`, see that
 * type's own doc comment) rather than inventing a second "what did a step look like"
 * vocabulary -- the Chat UI (#730-#734) already knows how to render exactly this shape,
 * so a provider that emits these needs ZERO frontend work to become visible.
 *
 * ⚠ #742 (investigation: issue #742's own comment thread) -- the mapping from a REAL
 * `deepagents`/LangGraph run's actual wire shape to this event has not been verified
 * end-to-end (no environment in this session could run Python ≥3.11, which `deepagents`
 * requires). What IS verified: `execute-run.ts`'s handling of a stream of these events
 * (recording each as a real `tool_call` step, in order, before the run's terminal state)
 * against a fake `ModelCallPort` -- see `completeWithProgress`'s own doc comment and
 * `execute-run-progress.test.ts`. This type and the plumbing around it are the "connect
 * once the real service can be observed" layer the human asked for; they are not, on
 * their own, proof `DeepAgentModelProvider` will populate them correctly.
 */
export interface ModelCallProgressEvent {
  readonly toolName: string;
  readonly toolArgsSummary: string | null;
  readonly toolResultSummary: string | null;
  readonly planningNote: string | null;
}

export interface ModelCallInput {
  readonly modelProvider: string;
  readonly modelId: string;
  readonly system: string;
  readonly user: string;
  /**
   * Prior turns of the SAME thread, oldest first, already trimmed to this deployment's
   * token-budget policy (`execute-run.ts`'s `trimHistoryToBudget`) -- never the raw,
   * unbounded thread. OPTIONAL and not `readonly []` by default: absent means "the caller
   * has no notion of thread history for this call" (`trialRunAgent`'s scenario has no
   * thread at all), and every `ModelCallPort` implementation that cares reads it as
   * `input.history ?? []`, exactly the discipline `tokens` on the return type already
   * uses for "not reported" vs "confirmed zero" (see that field's own comment below).
   * A provider that has no notion of multi-turn context (`BailianImageProvider`'s single
   * text-to-image prompt) is free to ignore the field entirely -- accepting-but-ignoring
   * an unused input is not the same failure as silently dropping one it was asked to use.
   */
  readonly history?: readonly ThreadHistoryMessage[];
  /**
   * The run's pinned Skills, structured (#740) -- the SAME list `readPinnedSkills` already
   * resolved, passed through as-is. Exists for `DeepAgentModelProvider`: a `deepagents` run
   * executes Skills INSIDE the remote LangGraph service (its `call_skill` tool, see
   * `apps/deep-agent-service/src/deep_agent_service/tools.py`) -- that service has no
   * access to this deployment's database, so the Skill content has to arrive as data on the
   * request instead. `DeepAgentModelProvider` forwards this verbatim into the LangGraph
   * run's `config.configurable.org_skills`; every provider that does not care simply never
   * reads this field, same "absent/unused is not a regression" discipline `history` uses.
   */
  readonly skills?: readonly PinnedSkillContent[];
}

/**
 * A refusal or failure from the one configured provider.
 *
 * It carries a `code` from the contract's enumeration and a `detail` that is for the
 * SERVER LOG only. Keeping the two on one object rather than putting the provider's text
 * into `message` is what makes the interface layer's job unmistakable: there is nothing
 * on this error a handler could pass through to a client by accident.
 */
export class ModelCallError extends Error {
  constructor(
    readonly code: RunFailureCode,
    readonly detail: string,
    /**
     * F159（coord-main 2026-08-12 裁决②的修正）—— 失败响应里上游报回来的用量。
     *
     * 部分 4xx 上游照样计费 prompt tokens 并在错误体里回 `usage`；把失败一律记 0
     * 会让那部分钱在账上凭空消失。⚠ 只取 `usage` 里的**数字**，错误体的文本一个字
     * 都不进来——`detail` 那条「provider 的话到此为止」的纪律不因为这个字段松动。
     */
    readonly usage?: ReportedUsage,
  ) {
    super(code);
    this.name = "ModelCallError";
  }
}

export interface ModelCallPort {
  /**
   * Perform the single model call for a pinned provider/model.
   *
   * Throws `ModelCallError("MODEL_PROVIDER_NOT_CONFIGURED")` when `modelProvider` is not
   * the one provider this deployment configured. It does not substitute the configured
   * one: answering with a model the Agent version does not name is the failure §5 forbids.
   *
   * `tokens` is OPTIONAL and reports whatever usage figure the provider's own response
   * included (e.g. an OpenAI-compatible `usage.total_tokens`), never a locally computed
   * estimate -- this codebase has no tokenizer, and a heuristic word/char count presented
   * as "tokens" would be a fabricated measurement wearing a real one's name. Wave 2's own
   * `AgentRunStep` never stored it and still doesn't; the field exists for callers that DO
   * need a usage figure (`trialRunAgent`, #595 Line A) and treat its absence as `0`, which
   * reads as "not reported", not "confirmed zero".
   */
  complete(input: ModelCallInput): Promise<
    { readonly text: string; readonly tokens?: number; readonly promptTokens?: number; readonly completionTokens?: number }
  >;

  /**
   * OPTIONAL streaming variant of `complete` (#654 阶段2a).
   *
   * A port that does not support token-level streaming simply does not implement this
   * method -- `execute-run.ts` checks for its presence and falls back to `complete()`,
   * so `RoutingModelCallPort`/`DeepResearchModelProvider`/`BailianImageProvider` need
   * change nothing to keep working exactly as before. This is still "the single model
   * call" §5 requires: `onDelta` is an observational side-channel for what streamed
   * across the wire, and the returned `{ text, tokens }` is the SAME final answer
   * `complete()` would have returned -- no fallback, no retry, no second call.
   *
   * `onDelta` fires once per provider-reported fragment, in order, BEFORE this promise
   * resolves. A rejection from `onDelta` (e.g. the store append failed) propagates and
   * fails the call exactly like a transport error would -- deltas are not "best effort".
   */
  completeStream?(
    input: ModelCallInput,
    onDelta: (delta: string) => Promise<void>,
  ): Promise<{ readonly text: string; readonly tokens?: number; readonly promptTokens?: number; readonly completionTokens?: number }>;

  /**
   * #742 -- OPTIONAL, and MUTUALLY EXCLUSIVE with `completeStream` in practice (a provider
   * implements one or the other, never both): for a provider whose run is a remote,
   * multi-step planning loop rather than a single token stream, this is how it reports
   * "something real happened" before the final answer is known. See
   * `ModelCallProgressEvent`'s own doc comment for the shape and its unverified mapping to
   * any real service.
   *
   * `execute-run.ts` checks for this method's presence BEFORE the TS tool loop / plain
   * `complete()` branches -- a provider that implements it opts fully out of both of those,
   * the same way implementing `completeStream` opts a provider into streaming instead of
   * the plain call. `onProgress` fires once per event, in order, strictly BEFORE this
   * promise resolves; a rejection propagates and fails the call, same discipline
   * `completeStream`'s `onDelta` already established -- an event that failed to persist is
   * not "best effort", it is a run whose recorded steps would otherwise silently
   * under-report what happened.
   *
   * The returned `{ text, tokens }` is still the ONE final answer, same contract
   * `completeStream` already keeps: `onProgress` is an observational side-channel for the
   * steps taken to reach it, never a second source of truth for whether the call
   * succeeded.
   */
  completeWithProgress?(
    input: ModelCallInput,
    onProgress: (event: ModelCallProgressEvent) => Promise<void>,
  ): Promise<{ readonly text: string; readonly tokens?: number; readonly promptTokens?: number; readonly completionTokens?: number }>;

  /**
   * 2026-08-09 hotfix (#798) -- OPTIONAL per-run capability query, only meaningful for a
   * port that fronts MORE THAN ONE underlying provider (today: `RoutingModelCallPort`). A
   * single-provider port's own `completeWithProgress` presence is already the accurate
   * answer for every run it serves, so it has no reason to implement this -- `execute-run.ts`
   * treats an absent `supportsProgress` as "presence of `completeWithProgress` alone
   * decides it", the exact behaviour every existing single-provider port and test fake
   * already has. A router-shaped port DOES need this: its own `completeWithProgress`
   * method is present as soon as ANY registered provider needs it, but that presence says
   * nothing about the specific provider a given run is pinned to -- see
   * `RoutingModelCallPort.completeWithProgress`'s own doc comment for why conflating the
   * two would silently break token streaming for providers that don't support progress.
   */
  supportsProgress?(modelProvider: string): boolean;
}

export interface AgentRunClock {
  now(): string;
  newStepId(): string;
}

/**
 * The executor as the composition root wires it.
 *
 * `tick` runs one bounded batch for one tenant and RESOLVES when the batch is done, so
 * tests can order "publish a new head" against "execute" instead of racing it. `kick` is
 * the fire-and-forget acceptance trigger; it is a no-op when this process is not the one
 * executing runs (`KERNEL_AGENT_RUN_AUTOSTART=0`).
 */
export interface AgentRunExecutorPort {
  tick(orgId: OrgId): Promise<number>;
  kick(orgId: OrgId): void;
}

/**
 * F159 —— 一次模型调用产生的用量事实。
 *
 * ⚠ `promptTokens` / `completionTokens` 是 `null` 时表示**上游没报这一维**，不是 0。
 * OpenAI 兼容的 `usage` 对象本来就带 `prompt_tokens` / `completion_tokens`
 * （coord-main 2026-08-12 裁决③要求先实测再定，实测结果：给得到），但自研包装的
 * provider 未必报。填 0 会让「没报」在报表上等于「一个 prompt token 都没用过」。
 */
export interface TokenUsageRecord {
  readonly userId: string;
  readonly runId: string;
  readonly modelProvider: string;
  readonly modelId: string;
  /** 上游没报总数时是 0——总数是必填维度，缺失按 0 记而不是猜一个估值。 */
  readonly tokensTotal: number;
  /** null = 上游没报。 */
  readonly promptTokens: number | null;
  /** null = 上游没报。 */
  readonly completionTokens: number | null;
  readonly outcome: "succeeded" | "failed";
}

/**
 * 一次调用的用量报告，provider 从上游响应里如实解出来的那份。
 * 三个字段各自可缺——缺失一律是 `undefined`（没报），不是 0。
 */
export interface ReportedUsage {
  readonly total?: number;
  readonly prompt?: number;
  readonly completion?: number;
}

/**
 * F159 —— 计量的写入口。**产品里只有这一个**：`token_usage_events` 是成员配额、
 * 用量监控、限额事件三块的共同上游，允许第二个写入点就等于允许两处对「这次算多少
 * token」给出不同答案（AGENTS.md 顶部那条「同一事实不得声明在两处」已经栽过五次）。
 * 反证测试 `tests/auth/token-usage-single-write-path.test.ts` 扫描 `apps/api/src`，
 * 断言往那张表插行的 SQL 语句只出现在这个 port 的唯一实现里
 * （`pg-token-usage-repository.ts`）。⚠ 这里刻意不写出那条 SQL 的字面量——写出来
 * 本文件就会被自己的扫描算成第二个写入点，而放宽扫描去容忍注释，等于让反证漏掉
 * 「有人在注释旁边真的写了一条 INSERT」这种最像真的情形。
 */
export interface TokenUsageMeterPort {
  record(orgId: OrgId, usage: TokenUsageRecord): Promise<void>;
}

export const AGENT_RUN_STORE = Symbol("AgentRunStore");
export const MODEL_CALL_PORT = Symbol("ModelCallPort");
export const AGENT_RUN_EXECUTOR = Symbol("AgentRunExecutor");
export const TOKEN_USAGE_METER = Symbol("TokenUsageMeter");

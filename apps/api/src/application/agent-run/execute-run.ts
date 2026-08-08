/**
 * `executeAgentRun` -- the Wave 2 §5 slice, and nothing else.
 *
 * ## What this function is allowed to decide
 *
 * Almost nothing. The Agent version, the ordered Skill versions, the provider and the
 * model were all decided at acceptance and are read off the claimed run. This code picks
 * no model, resolves no head, retries no provider, and invents no reply. It builds one
 * prompt out of already-pinned inputs, makes one call, and records what happened.
 *
 * ## Failure is a recorded transition, never a thrown surprise
 *
 * Every failure path lands on `failRun` with an enumerated code AND appends the failed
 * step. A run that dies without either is indistinguishable from one nobody started, and
 * "the message just never got answered" is the single hardest report to act on.
 *
 * ## Empty content is a failure, not an empty reply
 *
 * If the provider returns no usable text, the run fails. Storing `""` and letting #413
 * write it back would put a blank assistant message in a human's thread and mark the run
 * succeeded -- a fabricated reply with extra steps.
 */
import { createHash } from "node:crypto";
import type { OrgId } from "../../domain/org-id";
import type {
  AgentRunClock, AgentRunStore, ClaimedAgentRun, ModelCallPort, RunFailureCode, RunStepKind,
  ThreadHistoryMessage,
} from "./ports";
import { ModelCallError } from "./ports";

/**
 * #709 -- token-budget-aware multi-turn context.
 *
 * `HISTORY_MAX_MESSAGES` bounds what `AgentRunStore.readThreadHistory` is even ASKED for
 * (a row cap enforced in SQL, see that method's own comment). `HISTORY_MAX_CHARS` is the
 * second, tighter bound applied here in application code: a deployment has no tokenizer
 * (the `tokens` field on `ModelCallPort`'s return type says so explicitly), so this project
 * has no honest way to count tokens -- inventing one would be exactly the "heuristic
 * presented as a real measurement" `ModelCallPort.complete`'s own doc comment already
 * rules out for usage reporting. A character budget is not "tokens" and is not labelled as
 * one; it is a simple, conservative proxy good enough for the one thing this MVP needs:
 * never let history grow without bound. ~4 chars/token is a common rough ratio for English
 * and CJK-mixed text (CJK runs lower, closer to ~1.5-2 chars/token, which makes this budget
 * MORE conservative for the CJK content that dominates this codebase's fixtures, not less)
 * -- `HISTORY_MAX_CHARS` at 12,000 stays comfortably under the smallest realistic context
 * window even under that denser encoding, while `HISTORY_MAX_MESSAGES` keeps a very long,
 * short-message thread (e.g. quick back-and-forth) from turning into thousands of tiny
 * history entries before the char budget even gets a chance to trim it.
 */
export const HISTORY_MAX_MESSAGES = 20;
export const HISTORY_MAX_CHARS = 12_000;

/**
 * Drop the OLDEST messages first until the remaining, still-chronologically-ordered suffix
 * fits `maxChars` of combined `content` length. `messages` is already oldest-first (what
 * `readThreadHistory` returns); the result stays oldest-first so callers never have to
 * re-sort before splicing it into a `role`-ordered messages array.
 *
 * A single message longer than `maxChars` on its own is kept whole rather than truncated
 * mid-sentence -- cutting a stored message's text would make the model see words that were
 * never actually said in that message, which is a subtly different failure from "this turn
 * wasn't included at all". The budget is enforced by DROPPING turns, never by editing one.
 */
export function trimHistoryToBudget(
  messages: readonly ThreadHistoryMessage[],
  maxChars: number,
): readonly ThreadHistoryMessage[] {
  if (maxChars <= 0) return [];
  let total = 0;
  let firstKeptIndex = messages.length;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const next = total + messages[i]!.content.length;
    // The oldest kept message is allowed to push the running total over budget by itself
    // (see the doc comment: a single long message is kept whole, not truncated) -- but a
    // SECOND message would not be added once the budget is already spent.
    if (next > maxChars && total > 0) break;
    total = next;
    firstKeptIndex = i;
  }
  return messages.slice(firstKeptIndex);
}

export interface ExecuteAgentRunDeps {
  readonly runs: AgentRunStore;
  readonly model: ModelCallPort;
  readonly clock: AgentRunClock;
  /** Server-side only. Provider detail goes here and nowhere near a response. */
  readonly log: (message: string, detail: Record<string, unknown>) => void;
}

const sha256 = (value: string): string => createHash("sha256").update(value).digest("hex");

/**
 * The prompt.
 *
 * The Skill bodies are joined in the SNAPSHOT'S order. Sorting them, deduplicating them or
 * reading them back in database order would each silently discard part of what was pinned
 * -- ordering is a property of `skillVersionIds`, which is why it is an array in both the
 * `agent_versions` column and the run row.
 *
 * Exported so `trial-run-agent.ts` (#595 Line A) builds the identical prompt shape for a
 * trial run instead of re-deriving "instructions then skills, joined by blank lines" a
 * second time -- that phrase is the one place this project's answer to "what does an Agent
 * actually see" lives, and a second copy is exactly the drift AGENTS.md calls out by name.
 */
export function buildSystemPrompt(
  instructions: string,
  skills: readonly { readonly versionId: string; readonly content: string }[],
): string {
  return [instructions, ...skills.map((s) => s.content)].join("\n\n");
}

/** The one place a step becomes durable, so no path can record half of one. */
async function record(
  deps: ExecuteAgentRunDeps,
  orgId: OrgId,
  input: {
    runId: string; seq: number; kind: RunStepKind; startedAt: string;
    inputDigest: string | null; outputDigest: string | null; failureCode: RunFailureCode | null;
  },
): Promise<void> {
  await deps.runs.appendStep(orgId, {
    runId: input.runId,
    seq: input.seq,
    kind: input.kind,
    status: input.failureCode === null ? "succeeded" : "failed",
    startedAt: input.startedAt,
    endedAt: deps.clock.now(),
    inputDigest: input.inputDigest,
    outputDigest: input.outputDigest,
    failureCode: input.failureCode,
  });
}

async function executeClaimed(
  deps: ExecuteAgentRunDeps,
  orgId: OrgId,
  run: ClaimedAgentRun,
): Promise<void> {
  /* ── step: context_built ── */
  const contextStartedAt = deps.clock.now();
  const contextInput = sha256(
    JSON.stringify([run.agentVersionId, run.skillVersionIds, run.inputMessageId]),
  );
  let system: string;
  try {
    const skills = await deps.runs.readPinnedSkills(orgId, run.skillVersionIds);
    if (skills.length !== run.skillVersionIds.length) {
      // Fail closed. A run that quietly proceeds with two of its three pinned Skills has
      // produced an answer from a configuration nobody ever approved.
      throw new ModelCallError(
        "SKILL_VERSION_UNAVAILABLE",
        `pinned ${run.skillVersionIds.length}, retrieved ${skills.length}`,
      );
    }
    system = buildSystemPrompt(run.instructions, skills);
  } catch (e) {
    // Every way of not getting the pinned context is the same fact for a client: the run
    // could not be assembled from what was pinned. The distinguishing detail is logged.
    const code: RunFailureCode = "SKILL_VERSION_UNAVAILABLE";
    deps.log("agent run context build failed", {
      runId: run.runId,
      code,
      detail: e instanceof ModelCallError ? e.detail : "pinned context source unavailable",
    });
    await record(deps, orgId, {
      runId: run.runId, seq: 2, kind: "context_built", startedAt: contextStartedAt,
      inputDigest: contextInput, outputDigest: null, failureCode: code,
    });
    await deps.runs.failRun(orgId, run.runId, code);
    return;
  }
  const systemDigest = sha256(system);
  await record(deps, orgId, {
    runId: run.runId, seq: 2, kind: "context_built", startedAt: contextStartedAt,
    inputDigest: contextInput, outputDigest: systemDigest, failureCode: null,
  });

  /*
   * #709 -- prior turns of this thread, trimmed to the token-budget policy above.
   *
   * Deliberately OUTSIDE the `context_built` try/catch and never fails the run: unlike the
   * pinned Skill content above (a fact the run's approved configuration depends on), thread
   * history is dynamic conversation context, an enhancement over the pre-#709 single-turn
   * behaviour, not a correctness requirement the acceptance snapshot pinned. A history-read
   * failure degrading to "answer without prior context" (i.e. exactly today's behaviour) is
   * a strictly safer failure mode than turning a working single-turn run into a failed one
   * because of it -- especially since #709 ships behind no flag and must not be able to
   * regress runs that never needed history in the first place.
   */
  let history: ReturnType<typeof trimHistoryToBudget> = [];
  try {
    const recent = await deps.runs.readThreadHistory(
      orgId, run.threadId, run.inputMessageId, HISTORY_MAX_MESSAGES,
    );
    history = trimHistoryToBudget(recent, HISTORY_MAX_CHARS);
  } catch (e) {
    deps.log("agent run thread history read failed, continuing without it", {
      runId: run.runId,
      detail: e instanceof Error ? e.message : "unexpected thread history read failure",
    });
  }

  /* ── step: model_called -- exactly one, no fallback, no retry ── */
  const modelStartedAt = deps.clock.now();
  let text: string;
  try {
    // #654 阶段2a: when the configured port supports streaming, use it and persist each
    // fragment as it arrives -- purely observational (see `AppendedRunDelta`'s own doc):
    // the run's success/failure is still decided by the SAME accumulated-text checks
    // below, exactly as the non-streaming path decides it. A port without `completeStream`
    // falls back to the one-shot `complete()`, unchanged from before this delta.
    let deltaSeq = 0;
    const completion = deps.model.completeStream
      ? await deps.model.completeStream(
        {
          modelProvider: run.modelProvider, modelId: run.modelId, system, user: run.inputText,
          history,
        },
        async (delta) => {
          if (delta === "") return; // Nothing to persist; not every provider fragment carries text.
          const seq = deltaSeq;
          deltaSeq += 1;
          await deps.runs.appendModelDelta(orgId, { runId: run.runId, seq, text: delta });
        },
      )
      : await deps.model.complete({
        modelProvider: run.modelProvider,
        modelId: run.modelId,
        system,
        user: run.inputText,
        history,
      });
    if (completion.text.trim() === "") {
      throw new ModelCallError("MODEL_CALL_FAILED", "provider returned empty content");
    }
    text = completion.text;
  } catch (e) {
    const code: RunFailureCode = e instanceof ModelCallError ? e.code : "MODEL_CALL_FAILED";
    // The provider's own words live here and stop here. `detail` never reaches a response;
    // the run's terminal `error` is the enumerated code above.
    deps.log("agent run model call failed", {
      runId: run.runId,
      modelProvider: run.modelProvider,
      modelId: run.modelId,
      code,
      detail: e instanceof ModelCallError ? e.detail : "unexpected model call failure",
    });
    await record(deps, orgId, {
      runId: run.runId, seq: 3, kind: "model_called", startedAt: modelStartedAt,
      inputDigest: systemDigest, outputDigest: null, failureCode: code,
    });
    await deps.runs.failRun(orgId, run.runId, code);
    return;
  }
  await record(deps, orgId, {
    runId: run.runId, seq: 3, kind: "model_called", startedAt: modelStartedAt,
    inputDigest: systemDigest, outputDigest: sha256(text), failureCode: null,
  });

  /* ── hand off to #413 ── */
  // `writeback_pending`, not `succeeded`. §6: the run may only become succeeded after the
  // Chat writeback transaction commits, and that transaction is not in this slice.
  await deps.runs.storeOutputAwaitingWriteback(orgId, run.runId, { text });
}

/**
 * Claim and execute one bounded batch of this tenant's queued runs.
 *
 * Returns how many runs were executed (successfully or not) -- the caller uses it only for
 * observability. Nothing here throws for a run-level failure; a batch is not abandoned
 * because one run's provider was down.
 */
export async function executeQueuedRuns(
  deps: ExecuteAgentRunDeps,
  input: { readonly orgId: OrgId; readonly limit?: number },
): Promise<number> {
  const claimed = await deps.runs.claimQueued(input.orgId, Math.min(20, input.limit ?? 10));
  for (const outcome of claimed) {
    if (outcome.kind === "unresolvable") {
      // The claim already moved it out of `queued`, so it cannot be left as-is.
      deps.log("agent run snapshot no longer resolvable", {
        runId: outcome.runId, code: "AGENT_VERSION_UNAVAILABLE",
      });
      await deps.runs.failRun(input.orgId, outcome.runId, "AGENT_VERSION_UNAVAILABLE");
      continue;
    }
    try {
      await executeClaimed(deps, input.orgId, outcome.run);
    } catch (e) {
      // A defect in this file, not a provider failure. Still recorded, still terminal:
      // leaving the run stuck in `running` forever is the one outcome nobody can act on.
      deps.log("agent run executor defect", {
        runId: outcome.run.runId,
        detail: e instanceof Error ? e.name : "unknown",
      });
      await deps.runs.failRun(input.orgId, outcome.run.runId, "MODEL_CALL_FAILED");
    }
  }
  return claimed.length;
}

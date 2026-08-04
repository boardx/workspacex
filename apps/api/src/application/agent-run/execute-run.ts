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
} from "./ports";
import { ModelCallError } from "./ports";

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
 */
function buildSystemPrompt(
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

  /* ── step: model_called -- exactly one, no fallback, no retry ── */
  const modelStartedAt = deps.clock.now();
  let text: string;
  try {
    const completion = await deps.model.complete({
      modelProvider: run.modelProvider,
      modelId: run.modelId,
      system,
      user: run.inputText,
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

/**
 * `writeBackPendingRuns` -- the Wave 2 §6 slice, and nothing else.
 *
 * Section number VERIFIED in
 * `phases/phase-01-run-a-project/design-deltas/wave2-runtime/contract.md`: §4 is #417's
 * Agent persistence, §5 is #414's minimal run, §6 is "Idempotent Chat writeback".
 *
 * ## Why this is a separate pass and not the tail of `executeAgentRun`
 *
 * §6 requires the run to stay non-terminal for BOUNDED RETRY when the writeback fails.
 * Inline code cannot retry a run whose process died between the model call and the insert:
 * that run is durably `writeback_pending` with its output stored, and nothing would ever
 * look at it again. A pass that selects `writeback_pending` covers the retry and the
 * crash-recovery case with one mechanism, and it costs nothing on the happy path because
 * the executor runs it in the same tick that produced the row.
 *
 * ## What makes this exactly-once
 *
 * Nothing in this file. The guarantee is `chat_messages_agent_run_idx`, the partial unique
 * index on `(org_id, agent_run_id)` that #415 already created and that §6 names verbatim.
 * This code may be entered any number of times concurrently; the second and later attempts
 * lose the insert race and read back the winner's row. No attempt counting, no lock and no
 * "have I run before?" flag appears here, because each of those would be a SECOND
 * idempotency mechanism competing with the index for the same fact.
 *
 * ## The model is never called here
 *
 * A retry writes back the output the ONE model call already produced and stored. Calling
 * the provider again would break §5's single-call rule through the back door, and would
 * make a writeback failure silently change the answer a human eventually reads.
 */
import { createHash } from "node:crypto";
import type { OrgId } from "../../domain/org-id";
import type { AgentRunClock, AgentRunStore, PendingWriteback } from "./ports";

/**
 * The bounded retry budget (§6).
 *
 * Three attempts, one per executor tick. Bounded rather than infinite because the failure
 * mode this protects against is a writeback that can never succeed (a constraint violation,
 * a revoked privilege): retrying that forever leaves the human staring at a message that
 * is neither answered nor visibly failed, which §6 explicitly rules out by making
 * exhaustion terminal.
 */
export const MAX_WRITEBACK_ATTEMPTS = 3;

export interface WritebackDeps {
  readonly runs: AgentRunStore;
  readonly clock: AgentRunClock;
  /** Server-side only. The database's own words go here and never into a response. */
  readonly log: (message: string, detail: Record<string, unknown>) => void;
}

const sha256 = (value: string): string => createHash("sha256").update(value).digest("hex");

async function writeBackOne(
  deps: WritebackDeps,
  orgId: OrgId,
  pending: PendingWriteback,
): Promise<void> {
  const startedAt = deps.clock.now();
  try {
    await deps.runs.commitWriteback(orgId, {
      runId: pending.runId,
      threadId: pending.threadId,
      inputMessageId: pending.inputMessageId,
      agentId: pending.agentId,
      text: pending.text,
      startedAt,
      endedAt: deps.clock.now(),
      outputDigest: sha256(pending.text),
    });
    return;
  } catch (e) {
    // The database's message -- which can name a role, a constraint or a column -- stops
    // here. PR #310 is the reason this is a log line and not a value on the run.
    deps.log("agent run chat writeback failed", {
      runId: pending.runId,
      attempt: pending.attempts + 1,
      detail: e instanceof Error ? e.message : "unknown writeback failure",
    });
  }

  // Only reached when the transaction above rolled back, so the increment needs its own.
  const spent = await deps.runs.recordWritebackAttempt(orgId, pending.runId);
  if (spent < MAX_WRITEBACK_ATTEMPTS) return; // Non-terminal: §6's bounded retry.

  // Exhausted. Terminal, with the step recorded before the run's status so a reader never
  // sees a failed run whose steps do not say what failed.
  await deps.runs.appendWritebackFailure(orgId, {
    runId: pending.runId, startedAt, endedAt: deps.clock.now(),
  });
  await deps.runs.failRun(orgId, pending.runId, "CHAT_WRITEBACK_FAILED");
}

/**
 * Attempt the Chat writeback for one bounded batch of this tenant's pending runs.
 *
 * Returns how many runs were attempted, for observability only. A run whose writeback
 * throws does not abandon the batch: the others are unrelated messages waiting on answers.
 */
export async function writeBackPendingRuns(
  deps: WritebackDeps,
  input: { readonly orgId: OrgId; readonly limit?: number },
): Promise<number> {
  const pending = await deps.runs.claimWritebackPending(
    input.orgId,
    Math.min(20, input.limit ?? 10),
  );
  for (const run of pending) {
    try {
      await writeBackOne(deps, input.orgId, run);
    } catch (e) {
      // A defect in this file rather than a failed writeback. The run stays
      // `writeback_pending` and the next tick retries it within the same budget.
      deps.log("agent run writeback pass defect", {
        runId: run.runId, detail: e instanceof Error ? e.name : "unknown",
      });
    }
  }
  return pending.length;
}

/**
 * `ReplayContextPack` (F13) -- "这条结论当时看了什么", recomputed rather than retrieved.
 *
 * ## The two implementations of this operation, and why only one of them is a replay
 *
 * `usecases.md` gives replay a one-line contract: `in { runId }`, `out ContextPack`, and I-5
 * says `replay(runId).items` deep-equals the original items. There are two ways to satisfy
 * that sentence:
 *
 *   A. store the pack; return it.
 *   B. store the run's INPUTS; re-run the deterministic assembly over them; check the result
 *      against the digest recorded when the run happened.
 *
 * In a test they are indistinguishable -- both are green, on the same assertion, forever. But
 * A proves nothing about the assembler: it would keep passing if `finalizePack` started
 * ordering items by `Map` iteration, if the budget cut acquired a `Date.now()` tie-break, if
 * the threshold lookup started answering with today's configuration. Every one of those makes
 * "同 run id 重放得同 items[]" false, and A cannot see any of them.
 *
 * This is B. `assembleFromRecorded` is a pure function of the recording, and its output is
 * compared with `contentHash` on every single replay -- so nondeterminism anywhere in steps
 * ⑦-⑧ turns the audit path red instead of silently rewriting history.
 *
 * ⚠ The honest scope of the claim: replay re-runs steps ⑦-⑧ (threshold → dedup → budget →
 * item construction → closure/structure checks) over a FROZEN candidate set. It does not
 * re-run retrieval, and it must not -- see `domain/context-pack/recorded-run.ts`.
 *
 * ## Why the read side of F11 and F12 comes through here too
 *
 * `ContextPackAuditStore.findAudit` (F11) and `ContextRunStore.pack` (F12) both need the same
 * items. Answering them from a different path than replay would create two answers to "what
 * was in this pack", and the discard list would be checked for closure against a set the
 * audit screen never saw. So the infrastructure implements those two by calling this.
 */
import { contextPack as CP } from "@repo/contracts";
import type { z } from "zod";
import { assertContextItemComplete } from "../../domain/context-pack/context-item";
import { packContentHash, ReplayDivergedError } from "../../domain/context-pack/pack-hash";
import type { ContextPack } from "../../domain/context-pack/pack-structure";
import {
  recordedCandidateIds,
  toContextItem,
  toScreenable,
  type RecordedRun,
} from "../../domain/context-pack/recorded-run";
import { screenCandidates } from "../../domain/context-pack/screening";
import { finalizePack } from "./finalize-pack";
import { RunNotFoundError } from "./list-omissions";
import type { ContextPackStore } from "./ports";

export type ReplayOut = z.infer<typeof CP.operations.replayContextPack.out>;

/**
 * A recorded run's manual items no longer fit the budget.
 *
 * Cannot happen for a run that was recorded successfully -- `BUDGET_EXCEEDS_MANUAL` is raised
 * at assembly and such a run never gets recorded. It is raised rather than swallowed because
 * the alternative is dropping a manually pinned item during a REPLAY, which is the silent
 * discard E2 exists to forbid, occurring in the one place nobody is watching.
 */
export class ReplayedManualOverflowError extends Error {
  readonly reason = "BUDGET_EXCEEDS_MANUAL" as const;
  constructor(readonly runId: string, readonly segmentIds: readonly string[]) {
    super(
      `replay of "${runId}" could not fit the manually pinned items ${segmentIds.join(", ")} ` +
        `into the recorded budget -- a recording that cannot reproduce itself is corrupt, not degraded`,
    );
  }
}

/**
 * The deterministic half of assembly, run again. **Pure**: no clock, no I/O, no randomness.
 *
 * `pinnedSnapshotId` is a parameter rather than part of the recording because pinning happens
 * AFTER assembly; folding it into the recording would mean rewriting a frozen row in order to
 * freeze it.
 */
export function assembleFromRecorded(
  run: RecordedRun,
  pinnedSnapshotId: string | null,
): ContextPack {
  const screened = screenCandidates({
    candidates: run.candidates.map(toScreenable),
    task: run.query.task,
    tokenBudget: run.query.tokenBudget,
    unanchorable: run.unanchorable,
    // The run's own number, never `relevanceThresholdFor(task)`. See `screening.applyThresholdValue`.
    thresholdUsed: run.thresholdUsed,
  });

  if (screened.manualOverflow.length > 0) {
    throw new ReplayedManualOverflowError(
      run.runId,
      screened.manualOverflow.map((c) => c.segmentId),
    );
  }

  const byId = new Map(run.candidates.map((c) => [c.segmentId, c]));
  const items = screened.kept.map((c) => {
    const recorded = byId.get(c.segmentId);
    if (recorded === undefined) {
      // Unreachable via `toScreenable`, asserted anyway: an item built from a candidate that
      // is not in the recording would be an item nobody can trace, which is the one thing
      // `permissionDecisionId` exists to make impossible.
      throw new Error(`screening kept "${c.segmentId}", which is not in the recording`);
    }
    const item = toContextItem(recorded);
    assertContextItemComplete(item);
    return item;
  });

  return finalizePack({
    packId: run.packId,
    runId: run.runId,
    query: run.query,
    retrievalPlan: run.retrievalPlan,
    items,
    claims: run.claims,
    // The withheld ones are already-shaped `unauthorized` omissions from the original run's
    // permission decisions; screening's are this replay's. Both halves, or the closure check
    // below runs against a smaller universe than the one that existed.
    omissions: [...run.withheld, ...screened.omissions],
    candidateIds: recordedCandidateIds(run),
    tokensUsed: screened.tokensUsed,
    pinnedSnapshotId,
  });
}

export interface ReplayDeps {
  readonly store: ContextPackStore;
}

/**
 * Replay one run.
 *
 * The digest comparison is not a belt-and-braces check, it is the operation's whole integrity
 * claim: it is the only thing that can tell "this is what the conclusion looked at" from
 * "this is what the current code would build out of the same inputs".
 */
export async function replayContextPack(
  deps: ReplayDeps,
  input: { readonly runId: string },
): Promise<ReplayOut> {
  const row = await deps.store.findRecorded(input.runId);
  if (row === null) throw new RunNotFoundError(input.runId);

  const pack = assembleFromRecorded(row.run, row.pinnedSnapshotId);
  const replayed = packContentHash(pack);
  if (replayed !== row.contentHash) {
    throw new ReplayDivergedError(input.runId, row.contentHash, replayed);
  }
  return pack;
}

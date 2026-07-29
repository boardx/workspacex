/**
 * The last gate before a Context Pack leaves the assembler (F11, step ⑧).
 *
 * F09 built the three-section structure and F10 built the retrieval that fills it. Neither can
 * check the property that matters most here, because it is a property of the two TOGETHER: the
 * discard list must close over the candidate set (I-2). Retrieval knows what it found and the
 * item builder knows what survived; only this point knows both.
 *
 * ## Why it throws rather than returning a report
 *
 * A pack that has silently dropped evidence is not degraded, it is wrong -- and it is wrong in
 * the one way nobody downstream can detect. The renderer draws the items it was given, the AI
 * cites them, the audit replays them; nothing in that chain can notice that a candidate went
 * missing without a reason. So the failure has to be loud at the only place it is visible.
 *
 * ⚠ Deliberately NOT a response-validation pipe (contract-design hard rule 6's footnote): this
 * runs inside assembly, where a violation is a bug to fix at build time, not a 500 in front of a
 * user.
 */
import { contextPack as CP } from "@repo/contracts";
import type { z } from "zod";
import { itemsCarryingOmissionTracedAction } from "../../domain/context-pack/filter-action-trace";
import { assertOmissionClosure } from "../../domain/context-pack/omission-audit";
import { parseContextPack, type ClaimRef, type ContextPack, type Omission } from "../../domain/context-pack/pack-structure";
import type { ContextItem } from "../../domain/context-pack/context-item";

export type QueryContext = z.infer<typeof CP.QueryContext>;
export type RetrievalChannelPlan = z.infer<typeof CP.RetrievalChannelPlan>;

export interface FinalizeInput {
  readonly packId: string;
  readonly runId: string;
  readonly query: QueryContext;
  readonly retrievalPlan: readonly RetrievalChannelPlan[];
  readonly items: readonly ContextItem[];
  readonly claims: readonly ClaimRef[];
  /** Retrieval's omissions (unauthorized / withdrawn) plus screening's (low-confidence / deduped / budget / unlocatable). */
  readonly omissions: readonly Omission[];
  /**
   * Every candidate that entered the pipeline, including the ones a permission decision withheld.
   *
   * Passed in rather than derived from `items ∪ omissions`, which would make the closure check
   * vacuous: a set built from the two halves being compared can never disagree with them.
   */
  readonly candidateIds: readonly string[];
  readonly tokensUsed: number;
  readonly pinnedSnapshotId?: string | null;
}

export class ItemClaimsExclusionError extends Error {
  constructor(readonly offenders: readonly { segmentId: string; action: string }[]) {
    super(
      `these items carry a filter action that only an OMISSION can carry: ` +
        offenders.map((o) => `${o.segmentId}:${o.action}`).join(", ") +
        ` -- an excluded candidate is not in items[] (KNOWN_CONTRACT_GAPS.G1)`,
    );
  }
}

/**
 * Assemble, check, and return a pack that is safe to show.
 *
 * Three checks, in this order, because each one's failure would make the next one's report
 * misleading:
 *   1. no item claims to have been excluded (G1's lie)
 *   2. the discard list closes over the candidate set (I-2)
 *   3. the structure holds -- non-empty item fields, derived `compliance`, closed reason enum
 *      (I-1 / I-3, via `parseContextPack`)
 */
export function finalizePack(input: FinalizeInput): ContextPack {
  const liars = itemsCarryingOmissionTracedAction(input.items);
  if (liars.length > 0) throw new ItemClaimsExclusionError(liars);

  assertOmissionClosure({
    candidateIds: input.candidateIds,
    itemIds: input.items.map((i) => i.segmentId),
    omissions: input.omissions,
  });

  return parseContextPack({
    packId: input.packId,
    runId: input.runId,
    query: input.query,
    retrievalPlan: [...input.retrievalPlan],
    items: [...input.items],
    claims: [...input.claims],
    omissions: [...input.omissions],
    tokensUsed: input.tokensUsed,
    pinnedSnapshotId: input.pinnedSnapshotId ?? null,
  });
}

/**
 * I-6 -- what the AI is allowed to cite, and nothing else.
 *
 * ## The property, stated precisely
 *
 * The citable set of a pack is CLOSED: it is exactly `items[].segmentId`, and membership is
 * exact string equality. Everything else in the universe -- ids from another pack, ids in this
 * pack's `omissions[]`, ids a claim mentions, a real id with a stray space, a real id in the
 * wrong case, an invented id -- is out of pack.
 *
 * That is deliberately stated as "the outside cannot get in" rather than as a size. A pack has
 * however many items retrieval gave it; a test that pinned the number would be asserting an
 * accident. What must never change is that the boundary holds.
 *
 * ## Why exact equality, with no normalisation whatsoever
 *
 * Trimming, case-folding or prefix-matching a cited id is the single easiest way to destroy
 * this feature while making every test pass. A model that hallucinates `"seg-91f3 "` or
 * `"SEG-91F3"` has not read the pack -- it has produced a string that RESEMBLES one. Accepting
 * it means the citation resolves to a segment the requester may have no right to and that the
 * assembler never disclosed, and the resulting quote gets rendered with a working "back to
 * source" link. The whole point of "100% 引用可定位" is that a link exists BECAUSE the evidence
 * was in the pack, not the other way round.
 *
 * ## What this file does NOT decide
 *
 * Whether to reject the AI's output, whether to record it, and whether an empty citation list
 * is acceptable -- application concerns. This is a set membership question and it stays one.
 */
import { contextPack as CP } from "@repo/contracts";
import type { z } from "zod";
import type { ContextPack } from "./pack-structure";

/** Derived from the contract's `out`, never restated -- a second shape is a second fact. */
export type CitationVerdict = z.infer<typeof CP.operations.verifyCitation.out>;

/** Only the part of a pack that bears on citation. Keeps callers from having to fake a pack. */
export type CitablePack = Pick<ContextPack, "items">;

/**
 * The closed set: exactly the segments this pack put in front of the model.
 *
 * Read off `items[]` and nothing else. Not `omissions[]` (those are the things deliberately NOT
 * shown -- citing one means citing evidence the requester was told they did not get), and not
 * `claims[]` (see `unciteableClaimEvidence` for the hole that opens).
 */
export function citableSegmentIds(pack: CitablePack): ReadonlySet<string> {
  return new Set(pack.items.map((i) => i.segmentId));
}

/**
 * Every cited id that is not in the pack, in first-appearance order, deduplicated.
 *
 * Order is stable and duplicates collapse so that the same rejection recorded twice is
 * byte-identical -- an audit record that differs run to run cannot be compared, and comparing
 * them is what the record is for (I-5's discipline applied to the reject path).
 */
export function verifyCitations(
  pack: CitablePack,
  citedSegmentIds: readonly string[],
): CitationVerdict {
  const citable = citableSegmentIds(pack);
  const offending: string[] = [];
  const seen = new Set<string>();
  for (const cited of citedSegmentIds) {
    // No trim, no toLowerCase, no startsWith. See the header: leniency here silently converts
    // a hallucinated citation into a working source link.
    if (citable.has(cited)) continue;
    if (seen.has(cited)) continue;
    seen.add(cited);
    offending.push(cited);
  }
  return { allowed: offending.length === 0, offendingSegmentIds: offending };
}

/**
 * ⚠ **Signed-contract gap.** The segment ids a pack's `claims[]` name that its `items[]` does
 * not contain.
 *
 * This set is not supposed to be reachable, and it is: `retrieve-candidates.ts` copies
 * `contradictingSegmentIds` through untouched and explicitly never intersects it with what
 * survived ranking, because R7 / I-12 forbid opposing evidence from being filtered out. I-6
 * then says a citation must be in `items[]`. So a pack can hand the model a claim that names
 * evidence against it, and the model is forbidden from citing that evidence.
 *
 * There is no honest fix available at this layer:
 *   - widening the citable set to claim evidence would let a segment be cited that no
 *     `PermissionDecision` was ever made about (I-11 has no answer for it, and the row was
 *     never disclosed) -- a permission hole introduced to satisfy a citation rule;
 *   - narrowing `claims[]` to items is exactly the "tidying up dangling references" that
 *     `retrieve-candidates.ts` names as the most natural-looking way to violate I-12.
 *
 * So it is measured and reported, and F12 leaves the contract as signed. Raised for the
 * `context-pack` re-signature.
 */
export function unciteableClaimEvidence(
  pack: Pick<ContextPack, "items" | "claims">,
): readonly string[] {
  const citable = citableSegmentIds(pack);
  const out: string[] = [];
  const seen = new Set<string>();
  for (const claim of pack.claims) {
    for (const id of [...claim.supportingSegmentIds, ...claim.contradictingSegmentIds]) {
      if (citable.has(id) || seen.has(id)) continue;
      seen.add(id);
      out.push(id);
    }
  }
  return out;
}

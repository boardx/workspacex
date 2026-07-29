/**
 * Where a `Guarded<SegmentRecord>` becomes a `ContextItem` -- and the only place a
 * `permissionDecisionId` can come from.
 *
 * ## What this is for
 *
 * I-11 says every item's `permissionDecisionId` points at a real authorization judgement, so
 * that "why am I being shown this" is answerable. A string field cannot enforce that; a
 * builder can. This function takes the OUTPUT of `disclose()` -- `Disclosed<T>` values, each
 * of which already carries the id of a decision that was actually made -- and there is no
 * other input from which an item's decision id is read. An assembler cannot fabricate one
 * without bypassing this module entirely, which `lint-permission-paths.mjs` then has to
 * catch on the way in.
 *
 * `path: "context-pack"` in `PROPAGATION_PATHS` is registered to F09. This is the code that
 * makes that entry true rather than reserved. It flips nothing to `live` on its own: F10
 * builds the retrieval that feeds it, and until then nothing calls it in production.
 *
 * ## What it deliberately does NOT do
 *
 * No retrieval, no scoring, no ranking, no budget, no dedup -- F10 and F11. It takes the
 * retrieval-side facts as an argument precisely so that this file has no opinion about them.
 *
 * ⚠ **It must not be fed personal-layer private notes**, and it cannot check that itself.
 * I-8 says such content appears in NEITHER `items[]` NOR `omissions[].ref`, because an
 * omission record leaks that the note EXISTS. But I-2 says everything not in `items[]` must
 * be explained in `omissions[]`. Those two invariants are only compatible if personal-layer
 * notes never enter the candidate set in the first place -- i.e. they are excluded when the
 * candidates are formed (UC-0.2 R3 step 2, "个人层私有笔记一律不进"), not when they are
 * filtered. `domain.md` does not say this anywhere, and an implementer reading I-2 alone will
 * write the omission record. Raised in the F09 report; the candidate-set construction is
 * F10's, and this note is the handoff.
 */
import { contextPack as CP, omissionReason as OR } from "@repo/contracts";
import type { z } from "zod";
import { mergeAnchors, type AnchorMapping } from "../../domain/context-pack/anchor-mapping";
import { assertContextItemComplete, type ContextItem } from "../../domain/context-pack/context-item";
import type { Omission } from "../../domain/context-pack/pack-structure";
import type { SegmentRecord } from "../artifact/ports";
import type { Disclosure } from "../security/permission-filter";

export type ContextSourceType = z.infer<typeof CP.ContextSourceType>;
export type FilterAction = z.infer<typeof CP.FilterAction>;
export type RetrievalChannel = z.infer<typeof CP.RetrievalChannel>;

/**
 * The half of an item that retrieval decides. Supplied by F10, per segment.
 *
 * `artifactVersionId` is NOT here: it comes off the segment row. Letting a caller pass it
 * would allow an item that cites a version its segment does not belong to, and that is the
 * one field a reader uses to go and check.
 */
export interface RetrievalFacts {
  readonly content: string;
  readonly sourceType: ContextSourceType;
  readonly retrievalReasons: readonly FilterAction[];
  readonly channels: readonly RetrievalChannel[];
  readonly score: number;
}

/**
 * A candidate that cannot become an item for a reason the seven-reason enum does not cover.
 *
 * I-1 says a candidate with no anchor either "goes into omissions or raises ANCHOR_MISSING".
 * The first option is not available: `OmissionReason` is a closed seven (D-U4) and none of
 * them means "this segment could not be located". Writing `out-of-scope` would be a lie that
 * renders to a person as "not in this search's scope", and adding an eighth reason requires
 * an ADR by the same ruling. So these come back separately, named, and the caller decides.
 * Flagged in the F09 report.
 */
export interface UnanchorableCandidate {
  readonly segmentId: string;
  readonly reason: z.infer<typeof CP.ContextPackReason>;
  readonly unmappedAnchors: readonly AnchorMapping[];
}

export interface BuiltItems {
  readonly items: readonly ContextItem[];
  /** One per withheld candidate, reason `unauthorized` -- a compliance discard (I-4). */
  readonly omissions: readonly Omission[];
  readonly unanchorable: readonly UnanchorableCandidate[];
}

/**
 * Build the `items[]` section from a disclosure, plus the omissions the disclosure implies.
 *
 * Withheld candidates become `unauthorized` omissions rather than vanishing. That is the
 * point of `disclose()` returning both halves: a permission filter that silently drops rows
 * leaves F11 with nothing to render and leaves "the AI did not read it because you may not"
 * indistinguishable from "the AI did not find it".
 *
 * The `explain` text comes from `OMISSION_REASONS` -- the single source -- rather than being
 * written here, because a second wording is a second fact.
 */
export function buildContextItems(
  disclosure: Disclosure<SegmentRecord>,
  facts: (segmentId: string) => RetrievalFacts | undefined,
): BuiltItems {
  const items: ContextItem[] = [];
  const omissions: Omission[] = [];
  const unanchorable: UnanchorableCandidate[] = [];

  for (const seen of disclosure.visible) {
    const segmentId = seen.ref.id;
    const f = facts(segmentId);
    if (f === undefined) {
      // A disclosed segment with no retrieval facts is a caller bug, not a discard: it means
      // the candidate set and the disclosure batch disagree. Loud, because the quiet version
      // is an item that silently never appears.
      throw new Error(
        `no retrieval facts for disclosed segment "${segmentId}" -- the candidate set and the ` +
          `disclosed batch have diverged; assembling around it would drop evidence silently`,
      );
    }
    const { anchor, unmapped } = mergeAnchors(seen.payload.anchors);
    if (anchor === null) {
      unanchorable.push({ segmentId, reason: "ANCHOR_MISSING", unmappedAnchors: unmapped });
      continue;
    }
    const item: ContextItem = {
      segmentId,
      content: f.content,
      sourceType: f.sourceType,
      artifactVersionId: seen.payload.artifactVersionId,
      anchor,
      retrievalReasons: [...f.retrievalReasons],
      channels: [...f.channels],
      score: f.score,
      permissionDecisionId: seen.permissionDecisionId,
    };
    // Refuse here rather than at the edge. An incomplete item that reaches the response has
    // already been counted, rendered and cited by the time anybody validates it.
    assertContextItemComplete(item);
    items.push(item);
  }

  for (const gone of disclosure.withheld) {
    omissions.push({
      ref: gone.ref.id,
      reason: "unauthorized",
      compliance: OR.isComplianceOmission("unauthorized"),
      explain: OR.omissionExplain("unauthorized"),
    });
  }

  return { items, omissions, unanchorable };
}

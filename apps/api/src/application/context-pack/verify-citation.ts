/**
 * `VerifyCitation` (F12) -- refuse a citation the pack does not contain, and record the refusal.
 *
 * ## The one judgement call in this file
 *
 * The signed contract describes the SAME condition twice and in two incompatible ways:
 * `out` carries `{ allowed, offendingSegmentIds }`, and `err` lists `CITATION_OUT_OF_PACK`.
 * An out-of-pack citation cannot be both a value and a thrown error. Under the `err` reading,
 * `allowed` is always `true` and `offendingSegmentIds` is always `[]` -- two dead fields, and a
 * caller that wanted to show the person WHICH citations were fabricated could not.
 *
 * ⇒ Implemented as the value: `{ allowed: false, offendingSegmentIds: [...] }`. The refusal is
 * still a refusal -- `allowed: false` is what a caller must not proceed past -- and the detail
 * survives. `CITATION_OUT_OF_PACK` is left unused by this use case, which is a visible loose end
 * rather than a silent one, and is asserted as a gap in the tests.
 *
 * ## Why a failed recording fails the call
 *
 * V1 is one sentence with two verbs: 被拒**并记录**. If the recorder throws and this function
 * returns `{ allowed: false }` anyway, the refusal happened and nothing remembers it -- and a
 * model that can fabricate citations without leaving a trace is one nobody can measure. So the
 * error propagates. The caller gets an error instead of a verdict, which is the safe direction:
 * an error is not permission to proceed.
 */
import {
  verifyCitations,
  type CitationVerdict,
} from "../../domain/context-pack/citation-integrity";
import {
  RunNotFoundError,
  type CitationRejectionRecorder,
  type ContextRunStore,
} from "./ports";

export interface VerifyCitationDeps {
  readonly runs: ContextRunStore;
  readonly rejections: CitationRejectionRecorder;
}

export interface VerifyCitationInput {
  readonly runId: string;
  readonly citedSegmentIds: readonly string[];
}

export async function verifyCitation(
  deps: VerifyCitationDeps,
  input: VerifyCitationInput,
): Promise<CitationVerdict> {
  const pack = await deps.runs.pack(input.runId);
  // A run with no pack -- unknown, or one whose retrieval failed -- has an empty citable set,
  // and answering "nothing you cited is in the pack" would be a truthful-sounding way of hiding
  // that there is no pack at all. RUN_NOT_FOUND is the contract's code for it.
  if (pack === undefined) throw new RunNotFoundError(input.runId);

  const verdict = verifyCitations(pack, input.citedSegmentIds);
  if (!verdict.allowed) {
    await deps.rejections.record({
      runId: input.runId,
      citedSegmentIds: [...input.citedSegmentIds],
      offendingSegmentIds: verdict.offendingSegmentIds,
    });
  }
  return verdict;
}

/**
 * F76 — 人工标记引述与打点 + 引述↔研究问题(RQ)绑定 + 证据性质 (uc-5-3 R3, AC1/AC3/AC4).
 *
 * ## What this file is
 *
 * `markQuote` and `bindQuoteToRq`, as pure domain functions — the same seam F69/F71 already
 * cut for `transcribe`/`checkCitability`. Neither function talks to a database: existence
 * checks for an RQ id, or whether a quote has been withdrawn, arrive as already-resolved
 * booleans through an injected policy, exactly like `TranscriptionPolicy.isLowConfidence` in
 * `transcription-core.ts`. That keeps the four-way-distinguishable rejection codes assertable
 * in-memory, with no fixture database required to prove the gate.
 *
 * ## The one door this file reuses rather than reimplements
 *
 * `checkCitability` (`transcription-core.ts`) is **the only place** `partial` /
 * `pending-manual` / `disputed` / `lowConfidence` get turned into their four distinct
 * `*_NOT_CITABLE` codes (O-13: four separate gates, not one generalised "not ready"). `markQuote`
 * calls it rather than re-deriving the same four `if`s a second time — the citation gate for
 * retrieval/Context-Pack and the citation gate for `markQuote` are declared the same door by
 * `transcription-core.ts`'s own doc comment ("三个消费方是同一个问题"), so a second copy here
 * would be exactly the kind of drift this repo has already paid for five times (see AGENTS.md).
 *
 * ## What this file deliberately does not decide
 *
 * · **`RQ_NOT_FOUND` / RQ-in-project lookups.** Research questions are owned by 06-itv, not
 *   this bundle (`domain.md` X-8: "`rqId` 的生命周期归谁需裁定"). This file asks its policy a
 *   yes/no question and acts on the answer; it does not reach into another module's storage
 *   nor invent one here.
 * · **`EVIDENCE_NATURE_INVALID`.** `EvidenceNature` is a closed `z.enum` (`C_REC_3`) — an
 *   invalid value cannot reach this function; the contract boundary (zod parse) rejects it
 *   first. Re-validating a value that is already typed `EvidenceNature` would be asserting a
 *   state the type system has already ruled out, the same non-decision F71 made for
 *   `EvidenceNature`'s and `disputed`'s open closedness question.
 * · **Anchor *presence* on the stored segment.** `I-1`/`checkAnchor` in `transcription-core.ts`
 *   already refuses to persist an anchor-less segment. `checkQuoteAnchor` here is the
 *   defense-in-depth re-check the contract explicitly keeps in `markQuote`'s own err union
 *   (`ANCHOR_MISSING`, I-29) — not a claim that segments routinely arrive without one.
 * · **Coverage aggregation.** `coverageDelta` reports only *this* binding's own delta (0 when
 *   idempotently re-binding the same RQ, 1 when the quote newly points at a different RQ than
 *   before). Turning that into the UC-6.4 coverage view is that use case's job, not this one's
 *   (`domain.md` X-8: "绑定的消费方在别束").
 */
import { recording as C } from "@repo/contracts";
import type { z } from "zod";

import { checkCitability, type TranscribedSegment } from "./transcription-core";

export type EvidenceNature = z.infer<typeof C.EvidenceNature>;
export type SegmentAnchor = z.infer<typeof C.SegmentAnchor>;
export type RecordingErrorCode = z.infer<typeof C.RecordingError>;

/** What `markQuote` needs beyond the segment's citability-relevant fields. */
export interface MarkQuoteInput {
  readonly rqId: string | null;
  readonly evidenceNature: EvidenceNature;
}

/** Everything `markQuote` refuses to look up itself, injected. */
export interface MarkQuotePolicy {
  /** `rqId` supplied but unknown to the system ⇒ `RQ_NOT_FOUND`. */
  rqExists(rqId: string): boolean;
}

/** A quote, as this function mints it. `quoteId` is assigned by the caller (id generator/store). */
export type MintedQuote = Readonly<{
  segmentId: string;
  anchor: SegmentAnchor;
  rqId: string | null;
  evidenceNature: EvidenceNature;
}>;

export type MarkQuoteResult =
  | { readonly ok: true; readonly quote: MintedQuote }
  | { readonly ok: false; readonly reason: RecordingErrorCode };

/**
 * I-29 defense-in-depth: a quote must carry a resolvable anchor. Mirrors `ANCHOR_RULES`'s
 * either/or shape in `transcription-core.ts` (timecode xor messageId) without re-deriving it
 * from `sourceType`, because at this point the anchor already belongs to a persisted segment —
 * only its *presence* is re-checked here, not its per-carrier shape.
 */
function checkQuoteAnchor(anchor: SegmentAnchor): "ANCHOR_MISSING" | null {
  const hasTimecode = anchor.startMs !== null && anchor.endMs !== null;
  const hasMessage = anchor.messageId !== null && anchor.messageId !== "";
  return hasTimecode || hasMessage ? null : "ANCHOR_MISSING";
}

/**
 * markQuote —— 标为引述 (uc-5-3 R3 step 1-3, AC1, AC3, AC4).
 *
 * Order matters: citability first (a segment that cannot be cited must never be inspected for
 * anything else — "不得先入库再说"), then anchor, then RQ existence. Anchor and RQ problems are
 * both about *this* attempt's input, not about the segment's own settledness, so they are
 * checked only once citability already cleared.
 */
export function markQuote(
  segmentId: string,
  segment: Pick<TranscribedSegment, "status" | "lowConfidence"> & { anchor: SegmentAnchor },
  input: MarkQuoteInput,
  policy: MarkQuotePolicy,
): MarkQuoteResult {
  const citabilityProblem = checkCitability(segment);
  if (citabilityProblem !== null) return { ok: false, reason: citabilityProblem };

  const anchorProblem = checkQuoteAnchor(segment.anchor);
  if (anchorProblem !== null) return { ok: false, reason: anchorProblem };

  if (input.rqId !== null && !policy.rqExists(input.rqId)) {
    return { ok: false, reason: "RQ_NOT_FOUND" };
  }

  return {
    ok: true,
    quote: {
      segmentId,
      anchor: segment.anchor,
      rqId: input.rqId,
      evidenceNature: input.evidenceNature,
    },
  };
}

/** What `bindQuoteToRq` needs to see of the quote it is re-binding. */
export interface QuoteForBinding {
  readonly rqId: string | null;
  /** E-rules / X-6: a withdrawn quote's evidence chain is closed — no new bindings onto it. */
  readonly withdrawn: boolean;
}

export interface BindQuoteToRqInput {
  readonly rqId: string;
}

/** Everything `bindQuoteToRq` refuses to look up itself, injected. */
export interface BindQuoteToRqPolicy {
  /** RQ 属于同一项目 (usecases.md 「绑定引述到研究问题」pre). */
  rqInProject(rqId: string): boolean;
}

export type BindQuoteToRqResult =
  | { readonly ok: true; readonly rqId: string; readonly coverageDelta: number }
  | { readonly ok: false; readonly reason: "RQ_NOT_IN_PROJECT" | "QUOTE_WITHDRAWN" };

/**
 * bindQuoteToRq —— 绑定引述到研究问题 (uc-5-3 R3 step 3, AC3).
 *
 * `QUOTE_NOT_FOUND` is not this function's concern — looking a quote id up (or failing to)
 * is the caller's storage-layer job, same division `SEGMENT_NOT_FOUND` gets elsewhere in this
 * bundle. This function only ever sees a quote that was already found.
 */
export function bindQuoteToRq(
  quote: QuoteForBinding,
  input: BindQuoteToRqInput,
  policy: BindQuoteToRqPolicy,
): BindQuoteToRqResult {
  if (quote.withdrawn) return { ok: false, reason: "QUOTE_WITHDRAWN" };
  if (!policy.rqInProject(input.rqId)) return { ok: false, reason: "RQ_NOT_IN_PROJECT" };

  // Idempotent re-bind to the same RQ contributes nothing new to coverage; pointing at a
  // (new-to-this-quote) RQ contributes exactly one binding. UC-6.4's aggregate view is built
  // from these deltas by that use case, not summed here.
  const coverageDelta = quote.rqId === input.rqId ? 0 : 1;
  return { ok: true, rqId: input.rqId, coverageDelta };
}

/**
 * F77 — AI 自动打点候选态 + 人工确认闸门 (uc-5-3 R3 steps 4-5, AC2, E7).
 *
 * ## What this file is
 *
 * Pure domain functions for the second half of uc-5-3's打点 model — the half F76 explicitly
 * left alone (`quotes.ts` only covers 人工标记引述与打点). Four decisions live here, each
 * traceable to one contract invariant:
 *
 *   1. **`createAiAnnotationCandidate`** mints an annotation with `origin: "ai"`,
 *      `state: "candidate"` — never anything else. An AI annotation is *never* minted
 *      `confirmed` by this module; that would defeat I-24 at the one place it matters.
 *   2. **`createHumanAnnotation`** mints `origin: "human"`, `state: "confirmed"` directly —
 *      the contract's own shape (`operations.createHumanAnnotation.out`) already encodes "人工
 *      打点恒 confirmed，直接进证据库" as literal types, so this function only *assembles* it.
 *   3. **`decideAiAnnotation`** is the only place a candidate can leave `candidate` state:
 *      `confirm`/`edit-confirm` ⇒ `confirmed`, `ignore` ⇒ `ignored` — both are terminal
 *      (`ANNOTATION_ALREADY_DECIDED` on a repeat decision), and both leave a decision behind
 *      (I-27: 忽略也留痕— the caller persists the returned decision, it is never a bare no-op).
 *   4. **`checkAnnotationReferenceable`** is I-24's gate at its only true chokepoint:
 *      whatever `referenceEvidenceDownstream` is about to hand to report/canvas/kg/decision,
 *      it asks this function first, in *this* file, not in whichever consumer bundle happens
 *      to remember to check.
 *
 * ## The one door this file reuses rather than reimplements
 *
 * None of `checkCitability`'s four codes are this file's business — an AI annotation's
 * rationale points at Context Pack items, not directly at a live `Segment`, precisely because
 * of the `[设计]` invariant this feature's spec calls out: "AI 打点候选的生成只能通过 Context
 * API 取 Context Pack，不得绕过直查 segments 或向量库". So the citability of the underlying
 * segments is Context Pack's problem when it assembles the pack, not this module's when it
 * mints a candidate from one. `DIRECT_SEGMENT_ACCESS_FORBIDDEN` is a static-check + runtime
 * concern at the port/adapter boundary (V16) — nothing in a pure function taking an already-
 * resolved `ContextPackLookup` result could ever reach a segment table directly, so there is
 * no branch for that code here; it is enforced by this file's own shape (no segment-store
 * dependency in its signature at all), the same non-decision `transcription-core.ts` makes
 * about masking rules it does not reimplement.
 *
 * ## What this file deliberately does not decide
 *
 * · **`ANNOTATION_NOT_FOUND`.** Looking an annotation id up (or failing to) is the caller's
 *   storage-layer job — same division `quotes.ts` draws for `QUOTE_NOT_FOUND` and
 *   `transcription-core.ts` draws for `SEGMENT_NOT_FOUND` elsewhere in this bundle. Every
 *   function here takes an already-resolved annotation/rationale as input.
 * · **Which segment ids count as "withdrawn".** `isRationaleWithdrawn` takes the withdrawn-id
 *   set as a parameter rather than reaching into quote-withdrawal state itself — quote
 *   withdrawal is F76's `bindQuoteToRq`'s neighbour concept (`QuoteForBinding.withdrawn`), not
 *   something this file re-derives a second way.
 * · **Audit persistence.** "忽略也留痕" (I-27) means the caller writes an audit event
 *   containing the returned `{ state, decision }`; this file only computes what the correct
 *   next state and decision record *are*, it does not write anything.
 */
import { recording as C } from "@repo/contracts";
import type { z } from "zod";

export type AnnotationOrigin = z.infer<typeof C.AnnotationOrigin>;
export type AnnotationState = z.infer<typeof C.AnnotationState>;
export type AnnotationRationale = z.infer<typeof C.AnnotationRationale>;
export type RecordingErrorCode = z.infer<typeof C.RecordingError>;

/* ───────────────────────── createAiAnnotationCandidate ───────────────────────── */

/**
 * What `createAiAnnotationCandidate` needs from the Context API. `getPack` returning `null`
 * models "no pack" and "pack expired/unknown" identically — both are `CONTEXT_PACK_REQUIRED`,
 * because from this function's vantage there is no pack to build a rationale from either way.
 * `isReplayable` is asked separately because a pack can exist yet no longer be replayable
 * (its snapshot rotted, its source segments changed underneath it) — a distinct failure the
 * contract gives its own code, `CONTEXT_PACK_NOT_REPLAYABLE`.
 */
export interface ContextPackLookup {
  getPack(contextPackId: string): { segmentIds: readonly string[]; retrievalReasons: readonly string[] } | null;
  isReplayable(contextPackId: string): boolean;
}

export interface CreateAiAnnotationInput {
  readonly sessionId: string;
  readonly contextPackId: string;
  readonly agentName: string;
}

/** An annotation, as this module mints it. `annotationId` is assigned by the caller/store. */
export type MintedAnnotation = Readonly<{
  sessionId: string;
  origin: AnnotationOrigin;
  state: AnnotationState;
  agentName: string | null;
  rationale: AnnotationRationale | null;
}>;

export type CreateAiAnnotationResult =
  | { readonly ok: true; readonly annotation: MintedAnnotation }
  | { readonly ok: false; readonly reason: RecordingErrorCode };

/**
 * createAiAnnotationCandidate —— AI 主动打点 (uc-5-3 R3 step 4, AC2, I-24, I-26).
 *
 * Order: pack existence first, then replayability — a pack that does not exist cannot be
 * asked whether it replays. Both failures reject *before* anything is minted: there is no
 * partial candidate with a dangling rationale (I-11's "部分成功不得报成功" sibling for this
 * bundle's own operation).
 */
export function createAiAnnotationCandidate(
  input: CreateAiAnnotationInput,
  lookup: ContextPackLookup,
): CreateAiAnnotationResult {
  const pack = lookup.getPack(input.contextPackId);
  if (pack === null) return { ok: false, reason: "CONTEXT_PACK_REQUIRED" };
  if (!lookup.isReplayable(input.contextPackId)) {
    return { ok: false, reason: "CONTEXT_PACK_NOT_REPLAYABLE" };
  }

  return {
    ok: true,
    annotation: {
      sessionId: input.sessionId,
      origin: "ai",
      state: "candidate",
      agentName: input.agentName,
      rationale: {
        contextPackId: input.contextPackId,
        segmentIds: [...pack.segmentIds],
        retrievalReasons: [...pack.retrievalReasons],
      },
    },
  };
}

/* ───────────────────────── createHumanAnnotation ───────────────────────── */

export interface CreateHumanAnnotationInput {
  readonly sessionId: string;
}

/**
 * createHumanAnnotation —— 人工打点 (uc-5-3 R3 step 1, contrast case for I-24/I-25).
 *
 * Always succeeds at the origin/state pairing: `origin: "human"`, `state: "confirmed"`,
 * never `candidate`. This function exists mainly so `origin`/`state` are assigned by *a*
 * function rather than scattered `{ origin: "human", state: "confirmed" }` literals at each
 * call site — the same reasoning `transcribe()` gives for being the one place all three
 * carriers mint a segment.
 */
export function createHumanAnnotation(input: CreateHumanAnnotationInput): MintedAnnotation {
  return {
    sessionId: input.sessionId,
    origin: "human",
    state: "confirmed",
    agentName: null,
    rationale: null,
  };
}

/* ───────────────────────── decideAiAnnotation ───────────────────────── */

/** What `decideAiAnnotation` needs to see of the candidate it is deciding on. */
export interface AnnotationForDecision {
  readonly state: AnnotationState;
  /** E7: the rationale's underlying evidence has since been withdrawn or rewritten. */
  readonly rationaleWithdrawn: boolean;
}

export interface DecideAiAnnotationInput {
  readonly decision: "confirm" | "edit-confirm" | "ignore";
}

export type DecideAiAnnotationResult =
  | { readonly ok: true; readonly state: AnnotationState; readonly decision: DecideAiAnnotationInput["decision"] }
  | { readonly ok: false; readonly reason: "ANNOTATION_ALREADY_DECIDED" | "ANNOTATION_RATIONALE_WITHDRAWN" };

/**
 * decideAiAnnotation —— 确认 / 编辑后确认 / 忽略 (uc-5-3 R3 step 5, AC2, I-27, E7).
 *
 * `state !== "candidate"` covers both terminal outcomes uniformly — a second `confirm` on an
 * already-`confirmed` annotation and a `confirm` on an already-`ignored` one are the same
 * violation (「已决定，不能再决定一次」), so both produce `ANNOTATION_ALREADY_DECIDED` rather
 * than two different codes that would imply `ignored` is somehow less final than `confirmed`.
 *
 * Rationale-withdrawal is checked *after* the already-decided gate: a decision that already
 * happened is not retroactively invalidated by a later withdrawal (the withdrawal instead
 * flows through `referenceEvidenceDownstream`'s `EVIDENCE_WITHDRAWN`, a separate concern for
 * already-confirmed evidence). This code path is specifically about *blocking a new decision*
 * on a candidate whose depended-on segment already withdrew before anyone acted on it.
 */
export function decideAiAnnotation(
  annotation: AnnotationForDecision,
  input: DecideAiAnnotationInput,
): DecideAiAnnotationResult {
  if (annotation.state !== "candidate") return { ok: false, reason: "ANNOTATION_ALREADY_DECIDED" };
  if (annotation.rationaleWithdrawn) return { ok: false, reason: "ANNOTATION_RATIONALE_WITHDRAWN" };

  const nextState: AnnotationState = input.decision === "ignore" ? "ignored" : "confirmed";
  return { ok: true, state: nextState, decision: input.decision };
}

/**
 * isRationaleWithdrawn —— E7 的判据：依据片段被撤回时候选自动失效。
 *
 * Takes the withdrawn-id set as a parameter rather than looking withdrawal state up itself —
 * quote/segment withdrawal is tracked elsewhere in this bundle (`QuoteForBinding.withdrawn` in
 * `quotes.ts`); this function only asks "does this rationale depend on any of those ids",
 * which is the one new fact E7 adds.
 */
export function isRationaleWithdrawn(
  rationale: Pick<AnnotationRationale, "segmentIds">,
  withdrawnSegmentIds: ReadonlySet<string>,
): boolean {
  return rationale.segmentIds.some((id) => withdrawnSegmentIds.has(id));
}

/* ───────────────────────── checkAnnotationReferenceable ───────────────────────── */

/** What `checkAnnotationReferenceable` needs to see of the annotation being referenced. */
export interface AnnotationForReference {
  readonly origin: AnnotationOrigin;
  readonly state: AnnotationState;
  /** Evidence withdrawn after having been confirmed — E7's other half, for already-live refs. */
  readonly evidenceWithdrawn: boolean;
}

export type ReferenceCheckResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: "AI_ANNOTATION_NOT_CONFIRMED" | "EVIDENCE_WITHDRAWN" };

/**
 * checkAnnotationReferenceable —— referenceEvidenceDownstream 的门 (I-24 的唯一真正卡口).
 *
 * Withdrawal is checked first regardless of origin: withdrawn evidence is withdrawn evidence,
 * human-origin or not — `EVIDENCE_WITHDRAWN` is not an AI-only concern. `AI_ANNOTATION_NOT_
 * CONFIRMED` only ever fires for `origin === "ai"` in a non-`confirmed` state — a human
 * annotation is minted `confirmed` and never passes through this branch at all, which is the
 * structural expression of I-25 ("不得混入人工打点计数"): the human path simply never touches
 * the AI-specific rejection code.
 */
export function checkAnnotationReferenceable(annotation: AnnotationForReference): ReferenceCheckResult {
  if (annotation.evidenceWithdrawn) return { ok: false, reason: "EVIDENCE_WITHDRAWN" };
  if (annotation.origin === "ai" && annotation.state !== "confirmed") {
    return { ok: false, reason: "AI_ANNOTATION_NOT_CONFIRMED" };
  }
  return { ok: true };
}

/* ───────────────────────── origin-separated counting ───────────────────────── */

/**
 * countConfirmedHumanAnnotations —— I-25 的正面断言：AI 候选/已确认打点绝不计入人工打点计数,
 * 无论其 state 为何。The filter checks `origin === "human"` first and independently of
 * `state`, so an AI annotation cannot leak into this count through any state value.
 */
export function countConfirmedHumanAnnotations(
  annotations: readonly Pick<AnnotationForReference, "origin" | "state">[],
): number {
  return annotations.filter((a) => a.origin === "human" && a.state === "confirmed").length;
}

/**
 * countAiCandidates —— 候选列表计数（角标计数用）。与人工计数完全分离的第二个计数器，
 * 而不是同一个数字按 origin 做减法——两者应各自可断言、互不依赖对方的实现细节。
 */
export function countAiCandidates(
  annotations: readonly Pick<AnnotationForReference, "origin" | "state">[],
): number {
  return annotations.filter((a) => a.origin === "ai" && a.state === "candidate").length;
}

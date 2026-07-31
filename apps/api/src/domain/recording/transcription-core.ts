/**
 * F69 — the ONE transcription implementation the three carriers share.
 *
 * ## What "three carriers share one transcription capability" has to mean
 *
 * `recording.RecordingSourceType` has three members — `workshop` / `interview` / `thread`
 * (`domain.md` §1.5, uc-5-1 R1). The feature's core invariant is that all three go through
 * **this file**, not through three lookalike pipelines that drift apart the first time
 * someone fixes a bug in one of them.
 *
 * A comment saying so is worth nothing. Two mechanisms make it structural:
 *
 *   1. **`TranscribedSegment` is branded with a non-exported `unique symbol`.** No module
 *      outside this one can write that property key, so no module outside this one can
 *      produce a value of that type. `SegmentStore.append` (application/recording/ports.ts)
 *      takes `TranscribedSegment` — therefore **a carrier that builds its own segment cannot
 *      persist it, and the failure is a `tsc` error, not a code review opinion**.
 *      Counter-proof: `apps/api/__fixtures__/rec-bypass/`, compiled in the F69 test.
 *   2. **`ANCHOR_RULES` is a `Record<SourceType, …>`.** Adding a fourth carrier to the
 *      contract without teaching this file about it is a compile error. Adding a carrier
 *      here that the contract does not have is caught by the bidirectional set assertion in
 *      `tests/rec/multi-track-no-crosstalk.test.ts` — same shape as `lint-ui-material`.
 *
 * ## What this file deliberately does NOT decide
 *
 * · **The low-confidence threshold** is `[待定 D-1]` (`domain.md` §四). O-13 downgraded it to
 *   non-blocking on the explicit condition that the implementer **not pick a number**. So the
 *   predicate arrives through `TranscriptionPolicy.isLowConfidence` and there is not a single
 *   numeric confidence literal in this file — same treatment prototype S-04 gave the three
 *   undecided numbers (`*Known: false` rather than a plausible-looking default).
 * · **`SegmentStatus` membership.** `CONTRACT_DIVERGENCES.D11` is an unresolved hard conflict:
 *   the contract has `disputed` and no `low-confidence`; `apps/web/lib/mock/rec.ts`'s
 *   `SegmentStatusView` has `low-confidence` and no `disputed`; both cite a UC. This file
 *   **derives from the contract and touches neither side of the dispute** — it never mints
 *   `disputed` (that is `markDispute`, F71) and it carries low confidence in the contract's
 *   separate `lowConfidence: boolean` field, which exists on both sides. Picking a winner
 *   here would be an implementer settling a question that is queued for a human.
 * · **PII masking rules.** X-3: the masking kernel lives in 17-gov; this bundle is the
 *   *integration point*, not a second rule set. Masking arrives as a port; unavailable ⇒
 *   `PII_MASKING_UNAVAILABLE` and **nothing is persisted** (I-21: no plaintext ever exists
 *   in a segment, not even transiently).
 */
import { recording as C } from "@repo/contracts";
import type { z } from "zod";

export type SourceType = z.infer<typeof C.RecordingSourceType>;
export type SegmentStatus = z.infer<typeof C.SegmentStatus>;
export type SegmentAnchor = z.infer<typeof C.SegmentAnchor>;
export type PiiFinding = z.infer<typeof C.PiiFinding>;
export type RecordingErrorCode = z.infer<typeof C.RecordingError>;

/**
 * The carriers, **read off the contract** rather than restated.
 *
 * `["workshop", "interview", "thread"]` written here as a literal would be the sixth copy of
 * a fact this repository has already drifted on five times.
 */
export const CARRIERS = C.RecordingSourceType.options;

/**
 * The brand. `declare const` + `unique symbol` + **not exported** is the whole gate:
 * the property key is unnameable outside this module, so the type is unforgeable outside it.
 */
declare const Transcribed: unique symbol;

/** A segment that provably came out of `transcribe()`. Nothing else can be one. */
export type TranscribedSegment = Readonly<{
  sessionId: string;
  trackId: string;
  /** Carried so downstream can assert per-carrier isolation without a second lookup. */
  sourceType: SourceType;
  anchor: SegmentAnchor;
  /** Overlap ⇒ `null`, always (I-7). The core never silently attributes an overlap. */
  speakerChannelId: string | null;
  status: SegmentStatus;
  lowConfidence: boolean;
  /** **Masked** text. The raw string never leaves this function (I-21). */
  text: string;
  piiFindings: readonly PiiFinding[];
}> & { readonly [Transcribed]: true };

/** What one chunk of recognised audio (or one thread message) offers the core. */
export interface TranscriptionInput {
  readonly sessionId: string;
  readonly trackId: string;
  readonly sourceType: SourceType;
  readonly anchor: SegmentAnchor;
  readonly rawText: string;
  readonly asrConfidence: number;
  readonly diarization: { readonly channelId: string | null; readonly overlap: boolean };
  /** The last chunk of an utterance is not yet final — uc-5-1 「正在识别」. */
  readonly draft: boolean;
  /** Session length so far, for I-2's `endMs ≤ session.durationMs`. */
  readonly sessionDurationMs: number;
}

/** Masking result. `unavailable` is a first-class outcome, not an exception (I-21 / E-rules). */
export type MaskResult =
  | { readonly available: true; readonly text: string; readonly findings: readonly PiiFinding[] }
  | { readonly available: false };

/**
 * Everything the core refuses to hardcode, in one injected object.
 *
 * This is also the seam the lockstep assertion pulls: change one field here and **all three
 * carriers move together**, because there is only one core reading it.
 */
export interface TranscriptionPolicy {
  /** `[待定 D-1]`. The core asserts "hit ⇒ flag", never "how low is low". */
  isLowConfidence(asrConfidence: number): boolean;
  /** X-3: the 17-gov masking kernel, injected. This bundle owns no masking rules. */
  mask(rawText: string): MaskResult;
}

export type TranscriptionResult =
  | { readonly ok: true; readonly segment: TranscribedSegment }
  | { readonly ok: false; readonly reason: RecordingErrorCode };

/**
 * Per-carrier anchor shape (`domain.md` §1.1 `Anchor`): audio carriers anchor on a time
 * range, a chat thread anchors on a message id. This is the **only** place carriers differ,
 * and it is a data table rather than a branch, so the difference is enumerable.
 *
 * `Record<SourceType, …>` ⇒ a new contract member breaks the build here.
 */
const ANCHOR_RULES: Record<SourceType, "timecode" | "message"> = {
  workshop: "timecode",
  interview: "timecode",
  thread: "message",
};

/** I-1 / I-2. Returns the failing contract code, or `null` when the anchor is locatable. */
function checkAnchor(input: TranscriptionInput): RecordingErrorCode | null {
  const rule = ANCHOR_RULES[input.sourceType];
  const { startMs, endMs, messageId } = input.anchor;

  if (rule === "message") {
    if (messageId === null || messageId === "") return "ANCHOR_MISSING";
    // A thread segment carrying a timecode would be a second anchor shape for one fact.
    if (startMs !== null || endMs !== null) return "ANCHOR_OUT_OF_RANGE";
    return null;
  }

  if (startMs === null || endMs === null) return "ANCHOR_MISSING";
  if (messageId !== null) return "ANCHOR_OUT_OF_RANGE";
  // I-2: 0 ≤ startMs < endMs ≤ session.durationMs. Zero-length is not a range.
  if (startMs < 0 || startMs >= endMs) return "ANCHOR_OUT_OF_RANGE";
  if (endMs > input.sessionDurationMs) return "ANCHOR_OUT_OF_RANGE";
  return null;
}

/**
 * Status derivation — the one rule table, shared by all three carriers.
 *
 * · overlap ⇒ `pending-manual`, **and the channel is dropped** (I-7 / O-13). The two are one
 *   decision: recording a channel next to "needs a human" is exactly the silent attribution
 *   O-13 forbids, and separating them is how it would come back.
 * · not yet settled ⇒ `partial`.
 * · otherwise ⇒ `final`.
 *
 * `disputed` is **not reachable from here** — it is a later human action (`markDispute`,
 * uc-5-2), and its very existence is `[待定 D-9]` / `D11`. Ingest must not create it.
 */
function deriveStatus(input: TranscriptionInput): {
  status: SegmentStatus;
  speakerChannelId: string | null;
} {
  if (input.diarization.overlap) return { status: "pending-manual", speakerChannelId: null };
  if (input.draft) return { status: "partial", speakerChannelId: input.diarization.channelId };
  return { status: "final", speakerChannelId: input.diarization.channelId };
}

/**
 * Turn one recognised chunk into a persistable segment — **for every carrier**.
 *
 * Order matters and is part of the contract: anchor first (I-1 — an unlocatable segment must
 * not even be masked, let alone stored), then masking (I-21 — the plaintext must not survive
 * into the returned value), then status.
 */
export function transcribe(
  input: TranscriptionInput,
  policy: TranscriptionPolicy,
): TranscriptionResult {
  const anchorProblem = checkAnchor(input);
  if (anchorProblem !== null) return { ok: false, reason: anchorProblem };

  const masked = policy.mask(input.rawText);
  if (!masked.available) return { ok: false, reason: "PII_MASKING_UNAVAILABLE" };

  const { status, speakerChannelId } = deriveStatus(input);

  const segment = {
    sessionId: input.sessionId,
    trackId: input.trackId,
    sourceType: input.sourceType,
    anchor: input.anchor,
    speakerChannelId,
    status,
    lowConfidence: policy.isLowConfidence(input.asrConfidence),
    text: masked.text,
    piiFindings: masked.findings,
    // The brand is minted here and only here. `as` is unavoidable at the single point of
    // creation — the gate is that this expression cannot be written in any other module,
    // because `Transcribed` is not exported.
  } as unknown as TranscribedSegment;

  return { ok: true, segment };
}

/**
 * F70 — 「正在识别」中间态的引用/检索/AI 归纳门禁 (uc-5-1 R7)。
 *
 * ⚠ **本函数只覆盖 F70 自己产生的两种不可引述状态**：`partial`（最新一句尚未定稿，
 *   「正在识别」）与 `pending-manual`（重叠段，I-7）。`SEGMENT_LOW_CONFIDENCE_NOT_CITABLE`
 *   （阈值 `[待定 D-1]`）与 `SEGMENT_DISPUTED_NOT_CITABLE`（`disputed` 状态本身 `[待定 D-9]`，
 *   见文件顶部注释）都依赖尚未裁定的东西——这两个码留给 F76 的 `markQuote` 在那些前提
 *   落地后再补，本函数不替它们下判断。
 *
 * 三个消费方是同一个问题：`markQuote`（引述）· 检索索引（`indexedSegmentIds`）·
 * Context Pack / AI 归纳（`rationaleSegmentIds`）——I-3 与本条一起断言的是**同一道门**，
 * 所以这里只有一个函数，而不是三处各自判断一次。
 */
export function checkCitability(
  segment: Pick<TranscribedSegment, "status">,
): Extract<RecordingErrorCode, "SEGMENT_PARTIAL_NOT_CITABLE" | "SEGMENT_PENDING_MANUAL_NOT_CITABLE"> | null {
  if (segment.status === "partial") return "SEGMENT_PARTIAL_NOT_CITABLE";
  if (segment.status === "pending-manual") return "SEGMENT_PENDING_MANUAL_NOT_CITABLE";
  return null;
}

/** `true` 当且仅当 `checkCitability` 放行——供索引 / Context Pack 消费点做集合过滤用。 */
export function isCitable(segment: Pick<TranscribedSegment, "status">): boolean {
  return checkCitability(segment) === null;
}

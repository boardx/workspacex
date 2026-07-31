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
 *   `disputed` (that is `markDispute`, still unimplemented — `disputed`'s formal status is
 *   `[待定 D-9]`, `KNOWN_CONTRACT_GAPS.C_REC_3`) and it carries low confidence in the contract's
 *   separate `lowConfidence: boolean` field, which exists on both sides. Picking a winner
 *   here would be an implementer settling a question that is queued for a human. F71 only
 *   extends `checkCitability` to gate on `disputed`/`lowConfidence` *once already present* —
 *   it does not decide how a segment gets there.
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
 * F70/F71 — 「正在识别」「待人工指派」「待校对」「争议」四种不可引述态的
 * 引用/检索/AI 归纳门禁 (uc-5-1 R7, uc-5-1 R4, O-13)。
 *
 * ⚠ **O-13 的核心裁定：这是四道各自独立的门，不是一个泛化的"未完成"状态。**
 *   重叠语音「待人工指派」（`status === "pending-manual"`）与低置信「待校对」
 *   （`lowConfidence === true`）是两件不同的事——前者是"归属未定"（I-7：系统不静默
 *   归给单一说话人，`speakerChannelId` 恒为 `null`，mock `seg-07` 即使有
 *   `overlapCandidates` 也不带任何默认选中的 `assignedTo`），后者是"文本本身存疑"
 *   （即便说话人早已指派清楚）。两者可以同时成立而互不掩盖，各自解除路径也不同
 *   （uc-5-2：前者只经 `splitOverlapSegment` 人工拆分，后者只经 `correctSegmentText`
 *   人工修正）——所以断言与错误码都必须分开给，合并成一个 `SEGMENT_NOT_CITABLE`
 *   会让界面给不出「去拆分」和「去校对」两个不同出口（`usecases.md` E5）。
 * ⚠ **低置信度的阈值本身 `[待定 D-1]`，本函数不判定"多低算低"**——那是
 *   `TranscriptionPolicy.isLowConfidence` 的职责（见文件顶部注释），此处只读
 *   `segment.lowConfidence` 这个已经算好的布尔标记，"命中即挂门禁"是可以立即
 *   验收的结构性断言，和数值阈值本身的裁定是两件事（O-13）。
 * ⚠ `disputed` 的正式性仍是 `[待定 D-9]`（见文件顶部注释 / `KNOWN_CONTRACT_GAPS.C_REC_3`），
 *   本函数**不负责铸造**该状态（那是尚未实现的 `markDispute`，本 feature 范围之外），
 *   只负责：**一旦**一个 segment 处于 `disputed`，它同样不可引述，且该拒绝码必须能
 *   与另外三个区分开来。
 *
 * 三个消费方是同一个问题：`markQuote`（引述）· 检索索引（`indexedSegmentIds`）·
 * Context Pack / AI 归纳（`rationaleSegmentIds`）——I-3 与本条一起断言的是**同一道门**，
 * 所以这里只有一个函数，而不是三处各自判断一次。
 */
export function checkCitability(
  segment: Pick<TranscribedSegment, "status" | "lowConfidence">,
): Extract<
  RecordingErrorCode,
  | "SEGMENT_PARTIAL_NOT_CITABLE"
  | "SEGMENT_PENDING_MANUAL_NOT_CITABLE"
  | "SEGMENT_DISPUTED_NOT_CITABLE"
  | "SEGMENT_LOW_CONFIDENCE_NOT_CITABLE"
> | null {
  // 状态类的门先判：一段既是 partial/pending-manual/disputed 又同时 lowConfidence，
  // 报告状态类的码——状态未定这件事本身就挡住了引述，无需再叠加"文本存疑"的理由。
  if (segment.status === "partial") return "SEGMENT_PARTIAL_NOT_CITABLE";
  if (segment.status === "pending-manual") return "SEGMENT_PENDING_MANUAL_NOT_CITABLE";
  if (segment.status === "disputed") return "SEGMENT_DISPUTED_NOT_CITABLE";
  // 走到这里说明状态本身已经"定"了（final）——lowConfidence 是独立于 status 的第二道门，
  // 即使说话人 / 归属都已解决，文本本身待校对也一样不可引述。
  if (segment.lowConfidence) return "SEGMENT_LOW_CONFIDENCE_NOT_CITABLE";
  return null;
}

/** `true` 当且仅当 `checkCitability` 放行——供索引 / Context Pack 消费点做集合过滤用。 */
export function isCitable(segment: Pick<TranscribedSegment, "status" | "lowConfidence">): boolean {
  return checkCitability(segment) === null;
}

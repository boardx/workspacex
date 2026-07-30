/**
 * F69 — the per-track microphone state machine, and the gaps it leaves behind.
 *
 * uc-5-1 A2 / I-4 / I-5. Shared by all three carriers for the same reason the transcription
 * core is: "this track is not recording" must mean one thing in a workshop, an interview and
 * a chat thread, or the 「未录制」 badge means three things.
 *
 * ## Why `denied` is entry-time-only and terminal
 *
 * I-4's stated assertion is `count(segments join tracks where tracks.micState='denied') === 0`.
 * That count is over **current** track state, so it is only literally true if a track can
 * never become `denied` after it has produced segments. Two readings fit uc-5-1:
 *
 *   (a) `denied` = "refused the browser permission prompt" — set once, at entry, terminal.
 *   (b) `denied` = "turned the mic off" — reachable at any time.
 *
 * (b) makes I-4 false for any track that recorded and then switched off, so this file
 * implements (a): 拒绝 ⇒ `denied` (entry, terminal), 关闭 ⇒ `paused` (any time, resumable) —
 * which is also how uc-5-1 words it (「拒绝或关闭」, two verbs) and how the prototype renders
 * it (both show 「未录制」, only one is resumable).
 *
 * ⚠ **This is an inference, not something a UC states.** It is reported on issue #48 rather
 * than buried: if a human rules the other way, I-4's assertion has to be rewritten to quantify
 * over track state *at ingest time*, and this table changes with it.
 */
import { recording as C } from "@repo/contracts";
import type { z } from "zod";

export type MicState = z.infer<typeof C.MicState>;

/**
 * A stretch of wall-clock in which this track was not being captured (I-5).
 *
 * Derived, not restated — `lint-contract-source` caught the first draft of this file writing
 * `interface GapRange { fromMs; toMs }` by hand, which is the sixth instance of the failure
 * mode AGENTS.md names five times. The gate was right; the copy is gone.
 */
export type GapRange = Readonly<z.infer<typeof C.GapRange>>;

/** An open-ended gap: paused at `fromMs`, not yet resumed. */
export interface TrackTimeline {
  readonly micState: MicState;
  readonly gapRanges: readonly GapRange[];
  readonly openGapFromMs: number | null;
}

export type MicTransitionResult =
  | { readonly ok: true; readonly timeline: TrackTimeline }
  | { readonly ok: false; readonly reason: "MIC_STATE_TRANSITION_INVALID" };

/** I-4's gate, as a predicate. Only `granted` may produce segments — `paused` leaves a gap. */
export function canProduceSegments(state: MicState): boolean {
  return state === "granted";
}

/** A track as it exists the moment `startRecording` returns. */
export function initialTimeline(micState: MicState): TrackTimeline {
  return { micState, gapRanges: [], openGapFromMs: null };
}

/**
 * Apply a `setMicState` request at `atMs`.
 *
 * Legal edges — everything else is `MIC_STATE_TRANSITION_INVALID`:
 *
 *   granted → paused    close the mic, open a gap
 *   paused  → granted   resume; the gap closes and **stays visible** (I-5: no splicing)
 *   x       → x         idempotent no-op (replayed `idempotencyKey`, or a double click)
 *
 * Explicitly illegal:
 *   · anything → `denied`      — see the header; `denied` is entry-time-only
 *   · `denied` → anything      — terminal
 *   · `granted`/`paused` from a track that was never `granted`, i.e. a `denied` track
 *     resuming, which is the `从未 granted 直接 paused` example in usecases.md
 */
export function applyMicState(
  timeline: TrackTimeline,
  next: MicState,
  atMs: number,
): MicTransitionResult {
  const from = timeline.micState;
  if (from === next) return { ok: true, timeline };
  if (from === "denied" || next === "denied") {
    return { ok: false, reason: "MIC_STATE_TRANSITION_INVALID" };
  }

  if (next === "paused") {
    return {
      ok: true,
      timeline: { micState: "paused", gapRanges: timeline.gapRanges, openGapFromMs: atMs },
    };
  }

  // paused → granted: close the gap. An open gap is required; without one there is nothing
  // to close and the timeline would silently gain a zero-length range.
  const openedAt = timeline.openGapFromMs;
  if (openedAt === null) return { ok: false, reason: "MIC_STATE_TRANSITION_INVALID" };
  return {
    ok: true,
    timeline: {
      micState: "granted",
      gapRanges: [...timeline.gapRanges, { fromMs: openedAt, toMs: atMs }],
      openGapFromMs: null,
    },
  };
}

/**
 * I-5: no segment may span a gap, and none may sit inside one.
 *
 * Without this, a `paused` stretch would be invisible in the transcript — the two sides would
 * simply abut and read as continuous speech, which is exactly the "拼接成连续假象" the
 * invariant forbids. Open gaps count: while paused, everything from `openGapFromMs` onward is
 * un-captured time.
 */
export function intersectsGap(
  timeline: TrackTimeline,
  startMs: number,
  endMs: number,
): boolean {
  for (const gap of timeline.gapRanges) {
    if (startMs < gap.toMs && endMs > gap.fromMs) return true;
  }
  const open = timeline.openGapFromMs;
  return open !== null && endMs > open;
}

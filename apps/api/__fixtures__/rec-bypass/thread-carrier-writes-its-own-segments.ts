/**
 * COUNTER-PROOF FIXTURE — must NOT compile.
 *
 * This is what "the thread carrier grew its own transcription path" looks like in code: a
 * per-carrier function that builds a segment itself and hands it to the store, skipping
 * `transcribe()` entirely. It is the exact drift F69's invariant exists to prevent, and it is
 * the thing a code review notices only if the reviewer already knows to look.
 *
 * `tests/rec/multi-track-no-crosstalk.test.ts` compiles this directory and asserts `tsc`
 * rejects it. If the brand on `TranscribedSegment` is ever removed, widened, or exported,
 * this file starts compiling and that test goes red.
 *
 * Excluded from `apps/api/tsconfig.json` (`"exclude": ["__fixtures__"]`), same as the
 * `arch-bad` fixtures.
 */
import type { SegmentStore } from "../../src/application/recording/ports";

export async function ingestThreadSegmentDirectly(
  store: SegmentStore,
): Promise<{ segmentId: string }> {
  // A perfectly plausible-looking segment. Every field is right. It still must not compile,
  // because nothing here proves the text was masked, the anchor was checked, or the overlap
  // rule was applied — which is precisely why the store refuses to take anyone's word for it.
  return store.append({
    sessionId: "rec-session-1",
    trackId: "rec-track-1",
    sourceType: "thread",
    anchor: { startMs: null, endMs: null, messageId: "msg-1" },
    speakerChannelId: "ch-A",
    status: "final",
    lowConfidence: false,
    text: "手写的第二条转写路径",
    piiFindings: [],
  });
}

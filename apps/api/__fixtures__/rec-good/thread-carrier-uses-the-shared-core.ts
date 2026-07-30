/**
 * DOES-NOT-OVER-FIRE FIXTURE — must compile.
 *
 * The same thread-carrier code, written the only legal way: go through `transcribe()`. If the
 * brand were so strict that no caller could ever store a segment, the gate would be useless
 * in the other direction (a gate nobody can pass gets deleted). This proves it can be passed.
 */
import { transcribe } from "../../src/domain/recording/transcription-core";
import type { SegmentStore } from "../../src/application/recording/ports";

export async function ingestThreadSegmentProperly(
  store: SegmentStore,
): Promise<{ segmentId: string } | { rejected: string }> {
  const result = transcribe(
    {
      sessionId: "rec-session-1",
      trackId: "rec-track-1",
      sourceType: "thread",
      anchor: { startMs: null, endMs: null, messageId: "msg-1" },
      rawText: "走共享转写核心",
      asrConfidence: 0.9,
      diarization: { channelId: "ch-A", overlap: false },
      draft: false,
      sessionDurationMs: 0,
    },
    { isLowConfidence: () => false, mask: (t) => ({ available: true, text: t, findings: [] }) },
  );
  if (!result.ok) return { rejected: result.reason };
  return store.append(result.segment);
}

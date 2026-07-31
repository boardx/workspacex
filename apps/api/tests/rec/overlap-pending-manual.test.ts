/**
 * F71 · 重叠语音「两人同时说话·待人工指派」门禁 (uc-5-1 R4, I-7, O-13).
 *
 * O-13's ruling is that "overlap ⇒ pending-manual" and "low-confidence ⇒ 待校对" are **two
 * separate gates**, not one generalised "not done yet" bucket — they have different causes
 * (归属未定 vs. 文本本身存疑), different resolution exits (`splitOverlapSegment` vs.
 * `correctSegmentText`, uc-5-2), and must produce distinguishable rejection codes so the UI
 * can offer distinct "去拆分" / "去校对" actions (`usecases.md` E5). This file asserts the
 * overlap half in isolation, building on what F70 already established in `deriveStatus`
 * (`transcription-core.ts`): overlap ⇒ `status: "pending-manual"`, `speakerChannelId: null`.
 *
 * What's new here, beyond F70's own test (`partial-segment-not-citable.test.ts`):
 *
 *   1. **No default selection.** Even when the diarization input offers candidate channel
 *      information, and even when the segment also happens to be `lowConfidence`, the overlap
 *      outcome never silently picks a speaker — mirrors the mock fixture `seg-07`
 *      (`apps/web/lib/mock/rec.ts`), which carries `overlapCandidates: ["sp-p10","sp-p11"]`
 *      but `assignedTo: null`: candidates are visible, nothing is pre-selected.
 *   2. **The two gates don't conflate.** A segment that is simultaneously `pending-manual`
 *      *and* `lowConfidence` must still report the pending-manual code — not a merged/generic
 *      code — because the *reason* it can't be cited is "who said this is unsettled", which is
 *      a stronger and different claim than "the text might be wrong". Conversely, a `final`,
 *      non-overlapping segment that is `lowConfidence` must report the low-confidence code,
 *      not "false" as if the overlap gate were the only door.
 */
import { describe, expect, it } from "vitest";
import { recording as C } from "@repo/contracts";

import {
  checkCitability,
  isCitable,
  transcribe,
  type TranscriptionInput,
  type TranscriptionPolicy,
} from "../../src/domain/recording/transcription-core";

function input(overrides: Partial<TranscriptionInput> = {}): TranscriptionInput {
  return {
    sessionId: "s-1",
    trackId: "t-1",
    sourceType: "interview",
    anchor: { startMs: 0, endMs: 900, messageId: null },
    rawText: "两位受访者同时开口",
    asrConfidence: 0.9,
    diarization: { channelId: "ch-A", overlap: false },
    draft: false,
    sessionDurationMs: 60_000,
    ...overrides,
  };
}

function policy(overrides: Partial<TranscriptionPolicy> = {}): TranscriptionPolicy {
  return {
    isLowConfidence: () => false,
    mask: (raw: string) => ({ available: true as const, text: raw, findings: [] }),
    ...overrides,
  };
}

describe("F71 · 重叠段「待人工指派」— 无默认选中 (I-7)", () => {
  it("overlap ⇒ pending-manual with speakerChannelId=null even when diarization offers a channelId", () => {
    const r = transcribe(
      input({ diarization: { channelId: "ch-A", overlap: true } }),
      policy(),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.segment.status).toBe("pending-manual");
    expect(r.segment.speakerChannelId).toBeNull();
  });

  it("no candidate speaker is silently picked — the stored shape has no assignment field at all, not even a first-candidate default", () => {
    const r = transcribe(
      input({ diarization: { channelId: "ch-A", overlap: true } }),
      policy(),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // Mirrors mock `seg-07`: candidates may exist upstream (e.g. `overlapCandidates` in the UI
    // layer), but the transcription core's own output must not encode any of "personId" /
    // "assignedTo" / "resolvedSpeaker" as a pre-selection.
    expect(Object.keys(r.segment)).not.toContain("personId");
    expect(Object.keys(r.segment)).not.toContain("assignedTo");
    expect(Object.keys(r.segment)).not.toContain("resolvedSpeaker");
  });

  it("pending-manual is not citable, distinguishably from every other rejection code", () => {
    const r = transcribe(
      input({ diarization: { channelId: "ch-A", overlap: true } }),
      policy(),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(checkCitability(r.segment)).toBe("SEGMENT_PENDING_MANUAL_NOT_CITABLE");
    expect(isCitable(r.segment)).toBe(false);
  });

  it("a pending-manual segment that is ALSO lowConfidence still reports the pending-manual code — the two gates do not merge into one generic reason", () => {
    const r = transcribe(
      input({ diarization: { channelId: "ch-A", overlap: true }, asrConfidence: 0.1 }),
      policy({ isLowConfidence: () => true }),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.segment.lowConfidence).toBe(true);
    // "Who said this is unsettled" outranks "the text might be wrong" as the reported reason:
    // the overlap/assignment gate is not subsumed by, nor subsumes, the low-confidence gate.
    expect(checkCitability(r.segment)).toBe("SEGMENT_PENDING_MANUAL_NOT_CITABLE");
  });

  it("SEGMENT_PENDING_MANUAL_NOT_CITABLE and SEGMENT_LOW_CONFIDENCE_NOT_CITABLE are both real, distinct contract codes — not invented here", () => {
    expect(C.RecordingError.options).toContain("SEGMENT_PENDING_MANUAL_NOT_CITABLE");
    expect(C.RecordingError.options).toContain("SEGMENT_LOW_CONFIDENCE_NOT_CITABLE");
    expect("SEGMENT_PENDING_MANUAL_NOT_CITABLE").not.toBe("SEGMENT_LOW_CONFIDENCE_NOT_CITABLE");
  });

  it("resolving the ambiguity (no more overlap, a real channel) makes the segment citable again — the gate tracks status, not a permanent scar", () => {
    const stillOverlapping = transcribe(
      input({ diarization: { channelId: "ch-A", overlap: true } }),
      policy(),
    );
    const resolved = transcribe(
      input({ diarization: { channelId: "ch-A", overlap: false } }),
      policy(),
    );
    if (!stillOverlapping.ok || !resolved.ok) throw new Error("setup failed");
    expect(isCitable(stillOverlapping.segment)).toBe(false);
    expect(isCitable(resolved.segment)).toBe(true);
  });
});

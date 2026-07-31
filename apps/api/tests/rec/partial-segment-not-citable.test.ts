/**
 * F70 · 「正在识别」中间态门禁 + diarization 匿名声道 (uc-5-1 R7, I-7).
 *
 * Two invariants, one shared mechanism (`deriveStatus` in `transcription-core.ts`):
 *
 *   1. **正在识别不可引述** — the last, not-yet-final sentence of an utterance (`draft: true`
 *      ⇒ `status: "partial"`) must not be quotable, must not enter the retrieval index, and
 *      must not be handed to AI summarisation. All three consumers ask the same question, so
 *      this file asserts the one gate (`checkCitability` / `isCitable`) they all read, plus a
 *      simulated "what would `listTranscript` hand to an indexer" filter to prove the gate
 *      actually removes the segment from a batch, not just answers `true`/`false` in isolation.
 *   2. **重叠段的匿名声道不得被静默指认** — overlapping speech (`diarization.overlap: true`)
 *      ⇒ `status: "pending-manual"` **and** `speakerChannelId: null` (I-7). It is also not
 *      citable (`SEGMENT_PENDING_MANUAL_NOT_CITABLE`) for the same reason `partial` isn't:
 *      the outcome (who said this) is not settled yet, so nothing downstream may cite it as
 *      if it were.
 *
 * `final` segments (no overlap, not a draft) remain citable, and — this is the anonymity half
 * of I-7/I-9/I-10 — carry only an opaque `speakerChannelId`, never a resolved name: this file
 * asserts the stored shape has no `personId`/`personName`/`speakerName` key at all, because
 * `resolvedSpeaker` is a read-side projection from `SpeakerAssignment` (F74), not a field this
 * layer is allowed to invent.
 */
import { describe, expect, it } from "vitest";
import { recording as C } from "@repo/contracts";

import {
  checkCitability,
  isCitable,
  transcribe,
  type TranscribedSegment,
  type TranscriptionInput,
} from "../../src/domain/recording/transcription-core";
import { ingestSegment, startRecording } from "../../src/application/recording/capture";
import { harness } from "../support/rec-fakes";

const passthroughPolicy = {
  isLowConfidence: () => false,
  mask: (raw: string) => ({ available: true as const, text: raw, findings: [] }),
};

function input(overrides: Partial<TranscriptionInput> = {}): TranscriptionInput {
  return {
    sessionId: "s-1",
    trackId: "t-1",
    sourceType: "interview",
    anchor: { startMs: 0, endMs: 900, messageId: null },
    rawText: "hello",
    asrConfidence: 0.9,
    diarization: { channelId: "ch-A", overlap: false },
    draft: false,
    sessionDurationMs: 60_000,
    ...overrides,
  };
}

/** Stand-in for "what an indexer / Context Pack assembler would keep" (I-3's premise). */
function indexable(segments: readonly Pick<TranscribedSegment, "status">[]) {
  return segments.filter(isCitable);
}

describe("F70 · 「正在识别」不可引述 (partial)", () => {
  it("draft ⇒ status='partial', and checkCitability rejects it by the contract's own code", () => {
    const r = transcribe(input({ draft: true }), passthroughPolicy);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.segment.status).toBe("partial");
    expect(checkCitability(r.segment)).toBe("SEGMENT_PARTIAL_NOT_CITABLE");
    expect(isCitable(r.segment)).toBe(false);
  });

  it("SEGMENT_PARTIAL_NOT_CITABLE is one of the contract's markQuote rejection codes, not invented here", () => {
    expect(C.RecordingError.options).toContain("SEGMENT_PARTIAL_NOT_CITABLE");
  });

  it("a partial segment is excluded from the indexable/citable batch, not merely flagged", () => {
    const partial = transcribe(input({ draft: true, anchor: { startMs: 0, endMs: 900, messageId: null } }), passthroughPolicy);
    const final = transcribe(input({ draft: false, anchor: { startMs: 900, endMs: 1800, messageId: null } }), passthroughPolicy);
    if (!partial.ok || !final.ok) throw new Error("setup failed");

    const kept = indexable([partial.segment, final.segment]);
    expect(kept).toHaveLength(1);
    expect(kept[0]).toBe(final.segment);
  });

  it("finalising the same utterance (draft flips to false) makes it citable — the gate tracks status, not history", () => {
    const stillPartial = transcribe(input({ draft: true }), passthroughPolicy);
    const finalised = transcribe(input({ draft: false }), passthroughPolicy);
    if (!stillPartial.ok || !finalised.ok) throw new Error("setup failed");
    expect(isCitable(stillPartial.segment)).toBe(false);
    expect(isCitable(finalised.segment)).toBe(true);
  });

  it("end-to-end via ingestSegment: a draft segment lands in the store but is not part of the citable set", async () => {
    const deps = harness();
    const started = await startRecording(deps, {
      sourceType: "interview",
      sourceRefId: "ref-1",
      projectId: "prj-1",
      orgId: "org-1",
      trackPlan: [{ participantId: "p-1", micState: "granted" }],
    });
    if (!started.ok) throw new Error(`startRecording refused: ${started.reason}`);
    const trackId = started.tracks[0]?.trackId as string;

    const partial = await ingestSegment(deps, {
      sessionId: started.sessionId,
      trackId,
      anchor: { startMs: 0, endMs: 900, messageId: null },
      rawText: "还在说...",
      asrConfidence: 0.9,
      diarization: { channelId: "ch-A", overlap: false },
      draft: true,
    });
    expect(partial.ok).toBe(true);

    const stored = await deps.segments.ofTrack(trackId);
    expect(stored).toHaveLength(1); // it IS stored — "partial" is a status, not a rejection
    expect(indexable(stored)).toHaveLength(0); // but it must not enter the citable/indexable set
  });
});

describe("F70 · 重叠段的匿名声道不得被静默归属 (I-7)", () => {
  it("overlap ⇒ status='pending-manual' AND speakerChannelId=null, even though a channelId was offered", () => {
    const r = transcribe(input({ diarization: { channelId: "ch-A", overlap: true } }), passthroughPolicy);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.segment.status).toBe("pending-manual");
    expect(r.segment.speakerChannelId).toBeNull();
  });

  it("pending-manual is also not citable, by its own contract code (distinguishable from partial)", () => {
    const r = transcribe(input({ diarization: { channelId: "ch-A", overlap: true } }), passthroughPolicy);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(checkCitability(r.segment)).toBe("SEGMENT_PENDING_MANUAL_NOT_CITABLE");
    // The two rejection codes must stay distinguishable (`usecases.md` E5): the UI needs a
    // different "去校对" exit for「正在识别」than for「待人工指派」.
    const partial = transcribe(input({ draft: true }), passthroughPolicy);
    if (partial.ok) expect(checkCitability(partial.segment)).not.toBe(checkCitability(r.segment));
  });

  it("SEGMENT_PENDING_MANUAL_NOT_CITABLE is a contract code, not invented here", () => {
    expect(C.RecordingError.options).toContain("SEGMENT_PENDING_MANUAL_NOT_CITABLE");
  });

  it("a non-overlapping, finalised segment stays citable and carries only an opaque channel id — never a resolved name", () => {
    const r = transcribe(input({ diarization: { channelId: "ch-A", overlap: false }, draft: false }), passthroughPolicy);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(isCitable(r.segment)).toBe(true);
    expect(r.segment.speakerChannelId).toBe("ch-A");
    // I-10: no real-name field exists on the stored shape at all — `resolvedSpeaker` is a
    // read-side join onto `SpeakerAssignment` (F74), not a property this layer can hold.
    expect(Object.keys(r.segment)).not.toContain("personId");
    expect(Object.keys(r.segment)).not.toContain("personName");
    expect(Object.keys(r.segment)).not.toContain("speakerName");
    expect(Object.keys(r.segment)).not.toContain("resolvedSpeaker");
  });
});

/**
 * F76 · 三态段落（正在识别/待人工指派/待校对）与争议段一律不可被标为引述 (uc-5-3 AC4, R7, E5/E6).
 *
 * `markQuote` must not re-derive the four not-citable rejection codes on its own — it must
 * reuse the single door `checkCitability` already cuts in `transcription-core.ts` (F70/F71).
 * This file proves the reuse from the `markQuote` call site: each of the four segment states
 * produces its own distinct, non-merging code, and none of the four ever reaches "quote minted".
 */
import { describe, expect, it } from "vitest";
import { recording as C } from "@repo/contracts";

import { markQuote, type MarkQuotePolicy } from "../../src/domain/recording/quotes";
import {
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
    rawText: "下一步的资金安排",
    asrConfidence: 0.9,
    diarization: { channelId: "ch-A", overlap: false },
    draft: false,
    sessionDurationMs: 60_000,
    ...overrides,
  };
}

function transcriptionPolicy(overrides: Partial<TranscriptionPolicy> = {}): TranscriptionPolicy {
  return {
    isLowConfidence: () => false,
    mask: (raw: string) => ({ available: true as const, text: raw, findings: [] }),
    ...overrides,
  };
}

const permissivePolicy: MarkQuotePolicy = { rqExists: () => true };

describe("F76 · unstable segments reject markQuote — reusing checkCitability's four codes", () => {
  it("`partial`（正在识别）is rejected with SEGMENT_PARTIAL_NOT_CITABLE, not minted", () => {
    const t = transcribe(input({ draft: true }), transcriptionPolicy());
    expect(t.ok).toBe(true);
    if (!t.ok) return;
    expect(t.segment.status).toBe("partial");

    const r = markQuote("seg-1", t.segment, { rqId: null, evidenceNature: "观点" }, permissivePolicy);
    expect(r).toEqual({ ok: false, reason: "SEGMENT_PARTIAL_NOT_CITABLE" });
  });

  it("`pending-manual`（两人同时说话·待人工指派）is rejected with SEGMENT_PENDING_MANUAL_NOT_CITABLE, not minted", () => {
    const t = transcribe(
      input({ diarization: { channelId: "ch-A", overlap: true } }),
      transcriptionPolicy(),
    );
    expect(t.ok).toBe(true);
    if (!t.ok) return;
    expect(t.segment.status).toBe("pending-manual");
    expect(t.segment.speakerChannelId).toBeNull(); // I-7: no silent single-channel attribution

    const r = markQuote("seg-2", t.segment, { rqId: null, evidenceNature: "个人经历" }, permissivePolicy);
    expect(r).toEqual({ ok: false, reason: "SEGMENT_PENDING_MANUAL_NOT_CITABLE" });
  });

  it("低置信「待校对」is rejected with SEGMENT_LOW_CONFIDENCE_NOT_CITABLE, not minted", () => {
    const t = transcribe(input(), transcriptionPolicy({ isLowConfidence: () => true }));
    expect(t.ok).toBe(true);
    if (!t.ok) return;
    expect(t.segment.status).toBe("final"); // status itself is settled; the text is what's in doubt
    expect(t.segment.lowConfidence).toBe(true);

    const r = markQuote("seg-3", t.segment, { rqId: null, evidenceNature: "二手转述" }, permissivePolicy);
    expect(r).toEqual({ ok: false, reason: "SEGMENT_LOW_CONFIDENCE_NOT_CITABLE" });
  });

  it("`disputed`（争议·多人认领）is rejected with SEGMENT_DISPUTED_NOT_CITABLE, not minted", () => {
    // `transcribe()` never mints `disputed` (F71) — built directly as the citability gate's own
    // input shape, exactly as `disputed-lowconf-not-citable.test.ts` does for `checkCitability`.
    const disputed = {
      status: "disputed" as const,
      lowConfidence: false,
      anchor: { startMs: 0, endMs: 500, messageId: null },
    };
    const r = markQuote("seg-4", disputed, { rqId: null, evidenceNature: "观点" }, permissivePolicy);
    expect(r).toEqual({ ok: false, reason: "SEGMENT_DISPUTED_NOT_CITABLE" });
  });

  it("all four codes are pairwise distinct — no two unstable states collapse into one rejection", () => {
    const partial = transcribe(input({ draft: true }), transcriptionPolicy());
    const pendingManual = transcribe(
      input({ diarization: { channelId: "ch-A", overlap: true } }),
      transcriptionPolicy(),
    );
    const lowConfidence = transcribe(input(), transcriptionPolicy({ isLowConfidence: () => true }));
    if (!partial.ok || !pendingManual.ok || !lowConfidence.ok) throw new Error("setup failed");

    const results = [
      markQuote("a", partial.segment, { rqId: null, evidenceNature: "观点" }, permissivePolicy),
      markQuote("b", pendingManual.segment, { rqId: null, evidenceNature: "观点" }, permissivePolicy),
      markQuote(
        "c",
        { status: "disputed", lowConfidence: false, anchor: { startMs: 0, endMs: 10, messageId: null } },
        { rqId: null, evidenceNature: "观点" },
        permissivePolicy,
      ),
      markQuote("d", lowConfidence.segment, { rqId: null, evidenceNature: "观点" }, permissivePolicy),
    ];

    for (const r of results) expect(r.ok).toBe(false);
    const codes = results.map((r) => (r.ok ? null : r.reason));
    expect(new Set(codes).size).toBe(4);
    expect(codes).toEqual([
      "SEGMENT_PARTIAL_NOT_CITABLE",
      "SEGMENT_PENDING_MANUAL_NOT_CITABLE",
      "SEGMENT_DISPUTED_NOT_CITABLE",
      "SEGMENT_LOW_CONFIDENCE_NOT_CITABLE",
    ]);
  });

  it("a settled, high-confidence, non-overlapping segment is NOT rejected — the gate only fires on the four unstable states", () => {
    const t = transcribe(input(), transcriptionPolicy());
    expect(t.ok).toBe(true);
    if (!t.ok) return;

    const r = markQuote("seg-5", t.segment, { rqId: null, evidenceNature: "个人经历" }, permissivePolicy);
    expect(r.ok).toBe(true);
  });

  it("the four rejection codes are real markQuote error codes in the contract, not invented here", () => {
    const markQuoteErr = C.operations.markQuote.err as readonly string[];
    expect(markQuoteErr).toContain("SEGMENT_PARTIAL_NOT_CITABLE");
    expect(markQuoteErr).toContain("SEGMENT_PENDING_MANUAL_NOT_CITABLE");
    expect(markQuoteErr).toContain("SEGMENT_DISPUTED_NOT_CITABLE");
    expect(markQuoteErr).toContain("SEGMENT_LOW_CONFIDENCE_NOT_CITABLE");
  });
});

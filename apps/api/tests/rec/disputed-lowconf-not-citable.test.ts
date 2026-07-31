/**
 * F71 · 低置信「待校对」与争议 `disputed` 的不可引述门禁 (uc-5-1 R4, O-13).
 *
 * Two more not-citable reasons, each asserted on its own, neither conflated with the
 * overlap/pending-manual gate covered in `overlap-pending-manual.test.ts`:
 *
 *   1. **低置信「待校对」**（`SEGMENT_LOW_CONFIDENCE_NOT_CITABLE`）— `lowConfidence` is a
 *      boolean carried on the segment (`domain.md` §四 `[待定 D-1]`: *whether* a threshold was
 *      hit is asserted, *what the threshold is* is explicitly left to a human — O-13 downgraded
 *      it to non-blocking on condition the implementer not pick a number). This file therefore
 *      never asserts against a confidence literal; it only ever sets `lowConfidence` directly
 *      via the injected `TranscriptionPolicy`, the same seam `transcription-core.ts` documents.
 *      Its resolution exit is `correctSegmentText` (uc-5-2) — out of this feature's scope, but
 *      the gate it must clear is in scope.
 *   2. **`disputed`**（`SEGMENT_DISPUTED_NOT_CITABLE`）— its formal status is still `[待定 D-9]`
 *      (`KNOWN_CONTRACT_GAPS.C_REC_3`): nothing in this codebase currently *mints* `disputed`
 *      (that would be `markDispute`, unimplemented, and deliberately not part of this feature).
 *      What F71 owns is narrower and already decided by the contract: `disputed` **is** a
 *      `SegmentStatus` member and `SEGMENT_DISPUTED_NOT_CITABLE` **is** a `markQuote` rejection
 *      code (`recording.ts`) — so *given* a segment already in that status, `checkCitability`
 *      must reject it, distinguishably from the other three reasons. The segment fixture below
 *      is therefore built directly as a `{status, lowConfidence}` pair (the function's own
 *      parameter type), not produced through `transcribe()`, exactly because `transcribe()`
 *      correctly refuses to ever produce `disputed` on its own.
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
    rawText: "融资结构的下一步安排",
    asrConfidence: 0.4,
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

describe("F71 · 低置信「待校对」不可引述 (SEGMENT_LOW_CONFIDENCE_NOT_CITABLE)", () => {
  it("policy flags low confidence ⇒ lowConfidence=true on an otherwise-final segment, and it is not citable", () => {
    const r = transcribe(input(), policy({ isLowConfidence: () => true }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.segment.status).toBe("final"); // speaker/overlap were both settled — status is fine
    expect(r.segment.lowConfidence).toBe(true);
    expect(checkCitability(r.segment)).toBe("SEGMENT_LOW_CONFIDENCE_NOT_CITABLE");
    expect(isCitable(r.segment)).toBe(false);
  });

  it("no numeric confidence literal decides this — the gate only reads the policy's own boolean verdict", () => {
    // Same asrConfidence value, opposite policy verdicts ⇒ opposite citability. The gate itself
    // never inspects `asrConfidence`; this is what proves it.
    const flagged = transcribe(input({ asrConfidence: 0.55 }), policy({ isLowConfidence: () => true }));
    const clear = transcribe(input({ asrConfidence: 0.55 }), policy({ isLowConfidence: () => false }));
    if (!flagged.ok || !clear.ok) throw new Error("setup failed");
    expect(isCitable(flagged.segment)).toBe(false);
    expect(isCitable(clear.segment)).toBe(true);
  });

  it("SEGMENT_LOW_CONFIDENCE_NOT_CITABLE is a real markQuote rejection code, not invented here", () => {
    expect(C.RecordingError.options).toContain("SEGMENT_LOW_CONFIDENCE_NOT_CITABLE");
  });

  it("a final, high-confidence segment (no overlap, not a draft) stays citable", () => {
    const r = transcribe(input(), policy({ isLowConfidence: () => false }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(isCitable(r.segment)).toBe(true);
  });
});

describe("F71 · 争议段不可引述 (SEGMENT_DISPUTED_NOT_CITABLE)", () => {
  it("a segment in `disputed` status is rejected by its own code — distinguishable from the other three", () => {
    const disputed = { status: "disputed" as const, lowConfidence: false };
    expect(checkCitability(disputed)).toBe("SEGMENT_DISPUTED_NOT_CITABLE");
    expect(isCitable(disputed)).toBe(false);
  });

  it("disputed status reports its own code even when the segment is also lowConfidence — reasons don't merge", () => {
    const disputed = { status: "disputed" as const, lowConfidence: true };
    expect(checkCitability(disputed)).toBe("SEGMENT_DISPUTED_NOT_CITABLE");
  });

  it("SEGMENT_DISPUTED_NOT_CITABLE is a real markQuote rejection code and `disputed` is a real SegmentStatus member — both already decided by the contract, not invented here", () => {
    expect(C.RecordingError.options).toContain("SEGMENT_DISPUTED_NOT_CITABLE");
    expect(C.SegmentStatus.options).toContain("disputed");
  });

  it("transcribe() itself never mints `disputed` — it is out of this function's reach, by design (uc-5-2's markDispute, still unimplemented)", () => {
    // Every reachable combination of inputs to transcribe() must land on one of the three
    // statuses the ingest path is allowed to produce (`partial` / `final` / `pending-manual`);
    // `disputed` is a later, separate human action layered on top, not an ingest outcome.
    const cases: TranscriptionInput[] = [
      input({ draft: true }),
      input({ draft: false }),
      input({ diarization: { channelId: "ch-A", overlap: true } }),
    ];
    for (const c of cases) {
      const r = transcribe(c, policy());
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.segment.status).not.toBe("disputed");
    }
  });
});

describe("F71 · 四道拒绝码两两可区分 (usecases.md E5)", () => {
  it("partial / pending-manual / disputed / low-confidence each produce a distinct code", () => {
    const partial = transcribe(input({ draft: true }), policy());
    const pendingManual = transcribe(
      input({ diarization: { channelId: "ch-A", overlap: true } }),
      policy(),
    );
    const lowConfidence = transcribe(input(), policy({ isLowConfidence: () => true }));
    if (!partial.ok || !pendingManual.ok || !lowConfidence.ok) throw new Error("setup failed");

    const codes = [
      checkCitability(partial.segment),
      checkCitability(pendingManual.segment),
      checkCitability({ status: "disputed", lowConfidence: false }),
      checkCitability(lowConfidence.segment),
    ];
    expect(codes).toEqual([
      "SEGMENT_PARTIAL_NOT_CITABLE",
      "SEGMENT_PENDING_MANUAL_NOT_CITABLE",
      "SEGMENT_DISPUTED_NOT_CITABLE",
      "SEGMENT_LOW_CONFIDENCE_NOT_CITABLE",
    ]);
    expect(new Set(codes).size).toBe(4); // all four distinguishable, none collapse together
  });
});

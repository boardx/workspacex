/**
 * F76 · 引述锚点完整性 + 引述↔RQ 绑定 + 证据性质 (uc-5-3 R3 steps 1-3, AC1, AC3).
 *
 * Three things this feature owns, each asserted on its own:
 *   1. `markQuote` mints a quote carrying the segment's own resolvable anchor (AC1) and the
 *      caller's `evidenceNature`, and rejects an unresolvable anchor with `ANCHOR_MISSING`
 *      (I-29) — defense-in-depth on top of the ingest-time gate `transcription-core.ts` already
 *      owns (I-1).
 *   2. An `rqId` the policy does not recognise is `RQ_NOT_FOUND` at `markQuote` time — this
 *      bundle asks, it does not look RQs up itself (domain.md X-8: RQ 生命周期归 06-itv).
 *   3. `bindQuoteToRq` (a separate operation — "先标为引述" and "后来再挂到某个 RQ" are two
 *      distinct steps of R3) checks the RQ belongs to the same project, refuses to bind onto a
 *      withdrawn quote, and reports a `coverageDelta` that UC-6.4/UC-6.5 consume (AC3).
 */
import { describe, expect, it } from "vitest";
import { recording as C } from "@repo/contracts";

import {
  bindQuoteToRq,
  markQuote,
  type BindQuoteToRqPolicy,
  type MarkQuotePolicy,
  type QuoteForBinding,
} from "../../src/domain/recording/quotes";
import { transcribe, type TranscriptionPolicy } from "../../src/domain/recording/transcription-core";

const transcriptionPolicy: TranscriptionPolicy = {
  isLowConfidence: () => false,
  mask: (raw: string) => ({ available: true as const, text: raw, findings: [] }),
};

function citableSegment(anchor: { startMs: number | null; endMs: number | null; messageId: string | null }) {
  const t = transcribe(
    {
      sessionId: "s-1",
      trackId: "t-1",
      sourceType: anchor.messageId !== null ? "thread" : "interview",
      anchor,
      rawText: "我们下一步要做的是签合同",
      asrConfidence: 0.95,
      diarization: { channelId: "ch-A", overlap: false },
      draft: false,
      sessionDurationMs: 60_000,
    },
    transcriptionPolicy,
  );
  if (!t.ok) throw new Error(`setup failed: ${t.reason}`);
  return t.segment;
}

describe("F76 · markQuote — anchor completeness (I-29, AC1)", () => {
  it("mints a quote carrying the segment's own timecode anchor", () => {
    const segment = citableSegment({ startMs: 1200, endMs: 4500, messageId: null });
    const policy: MarkQuotePolicy = { rqExists: () => true };

    const r = markQuote("seg-audio-1", segment, { rqId: null, evidenceNature: "个人经历" }, policy);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.quote).toEqual({
      segmentId: "seg-audio-1",
      anchor: { startMs: 1200, endMs: 4500, messageId: null },
      rqId: null,
      evidenceNature: "个人经历",
    });
  });

  it("mints a quote carrying the segment's own message anchor (thread carrier)", () => {
    const segment = citableSegment({ startMs: null, endMs: null, messageId: "msg-42" });
    const policy: MarkQuotePolicy = { rqExists: () => true };

    const r = markQuote("seg-thread-1", segment, { rqId: null, evidenceNature: "观点" }, policy);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.quote.anchor).toEqual({ startMs: null, endMs: null, messageId: "msg-42" });
  });

  it("rejects with ANCHOR_MISSING when neither timecode nor messageId resolves — defense-in-depth, not reachable via transcribe()", () => {
    const policy: MarkQuotePolicy = { rqExists: () => true };
    // A citable (final, non-overlap, high-confidence) segment whose anchor is nonetheless
    // unresolvable — the shape `markQuote` itself is defending against per its own err union,
    // independent of how such a segment could come to exist.
    const r = markQuote(
      "seg-broken-anchor",
      { status: "final", lowConfidence: false, anchor: { startMs: null, endMs: null, messageId: null } },
      { rqId: null, evidenceNature: "观点" },
      policy,
    );
    expect(r).toEqual({ ok: false, reason: "ANCHOR_MISSING" });
  });

  it("ANCHOR_MISSING is a real markQuote error code in the contract, not invented here", () => {
    expect((C.operations.markQuote.err as readonly string[])).toContain("ANCHOR_MISSING");
  });
});

describe("F76 · markQuote — RQ binding at mark time + evidence nature (AC3)", () => {
  it("binds directly to an RQ at mark time when the caller already knows which RQ, and records evidence nature", () => {
    const segment = citableSegment({ startMs: 0, endMs: 900, messageId: null });
    const policy: MarkQuotePolicy = { rqExists: (rqId) => rqId === "rq-2" };

    const r = markQuote("seg-1", segment, { rqId: "rq-2", evidenceNature: "个人经历" }, policy);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.quote.rqId).toBe("rq-2");
    expect(r.quote.evidenceNature).toBe("个人经历");
  });

  it("rejects with RQ_NOT_FOUND when the supplied rqId is unknown — this module asks, it does not look RQs up itself", () => {
    const segment = citableSegment({ startMs: 0, endMs: 900, messageId: null });
    const policy: MarkQuotePolicy = { rqExists: () => false };

    const r = markQuote("seg-1", segment, { rqId: "rq-ghost", evidenceNature: "观点" }, policy);
    expect(r).toEqual({ ok: false, reason: "RQ_NOT_FOUND" });
  });

  it("rqId is nullable — a quote can be minted with no RQ yet and bound later via bindQuoteToRq", () => {
    const segment = citableSegment({ startMs: 0, endMs: 900, messageId: null });
    const policy: MarkQuotePolicy = { rqExists: () => true };

    const r = markQuote("seg-1", segment, { rqId: null, evidenceNature: "二手转述" }, policy);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.quote.rqId).toBeNull();
  });

  it("all three evidence natures round-trip unchanged", () => {
    const segment = citableSegment({ startMs: 0, endMs: 900, messageId: null });
    const policy: MarkQuotePolicy = { rqExists: () => true };

    for (const nature of C.EvidenceNature.options) {
      const r = markQuote("seg-1", segment, { rqId: null, evidenceNature: nature }, policy);
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.quote.evidenceNature).toBe(nature);
    }
  });
});

describe("F76 · bindQuoteToRq — RQ↔project + withdrawal + coverage delta (AC3)", () => {
  const unbound: QuoteForBinding = { rqId: null, withdrawn: false };
  const boundToRq2: QuoteForBinding = { rqId: "rq-2", withdrawn: false };
  const withdrawn: QuoteForBinding = { rqId: "rq-2", withdrawn: true };

  function policyWith(rqIdsInProject: readonly string[]): BindQuoteToRqPolicy {
    return { rqInProject: (rqId) => rqIdsInProject.includes(rqId) };
  }

  it("binds an unbound quote to an in-project RQ, reporting a positive coverage delta", () => {
    const r = bindQuoteToRq(unbound, { rqId: "rq-2" }, policyWith(["rq-2"]));
    expect(r).toEqual({ ok: true, rqId: "rq-2", coverageDelta: 1 });
  });

  it("re-binding to the same RQ is idempotent — coverage delta is 0, not a second count", () => {
    const r = bindQuoteToRq(boundToRq2, { rqId: "rq-2" }, policyWith(["rq-2"]));
    expect(r).toEqual({ ok: true, rqId: "rq-2", coverageDelta: 1 - 1 });
  });

  it("rejects with RQ_NOT_IN_PROJECT when the RQ belongs to a different project", () => {
    const r = bindQuoteToRq(unbound, { rqId: "rq-other-project" }, policyWith(["rq-2"]));
    expect(r).toEqual({ ok: false, reason: "RQ_NOT_IN_PROJECT" });
  });

  it("rejects with QUOTE_WITHDRAWN when the quote's evidence has been withdrawn — checked before the RQ lookup", () => {
    const r = bindQuoteToRq(withdrawn, { rqId: "rq-not-even-checked" }, policyWith(["rq-2"]));
    expect(r).toEqual({ ok: false, reason: "QUOTE_WITHDRAWN" });
  });

  it("RQ_NOT_IN_PROJECT and QUOTE_WITHDRAWN are real bindQuoteToRq error codes in the contract, not invented here", () => {
    const bindErr = C.operations.bindQuoteToRq.err as readonly string[];
    expect(bindErr).toContain("RQ_NOT_IN_PROJECT");
    expect(bindErr).toContain("QUOTE_WITHDRAWN");
    expect(bindErr).toContain("QUOTE_NOT_FOUND");
  });
});

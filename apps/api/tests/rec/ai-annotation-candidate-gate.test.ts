/**
 * F77 · AI 自动打点候选态 + 人工确认闸门 (uc-5-3 R3 steps 4-5, AC2).
 *
 * Three things asserted here, each its own `describe`:
 *   1. `createAiAnnotationCandidate` only ever mints `origin: "ai"`, `state: "candidate"`,
 *      and refuses when the Context Pack is missing or not replayable (I-26) — never a
 *      partial candidate with a dangling rationale.
 *   2. `checkAnnotationReferenceable` is the actual I-24 gate: an unconfirmed AI candidate is
 *      rejected for every downstream consumer (report/canvas/kg/decision), and confirming it
 *      is the only way to pass; withdrawn evidence is rejected regardless of origin.
 *   3. `decideAiAnnotation` transitions candidate → confirmed/ignored exactly once each,
 *      rejecting a repeat decision, and rejects a decision when the rationale's underlying
 *      segment already withdrew (E7).
 */
import { describe, expect, it } from "vitest";
import { recording as C } from "@repo/contracts";

import {
  checkAnnotationReferenceable,
  createAiAnnotationCandidate,
  decideAiAnnotation,
  isRationaleWithdrawn,
  type AnnotationForDecision,
  type AnnotationForReference,
  type ContextPackLookup,
} from "../../src/domain/recording/ai-annotation";

describe("F77 · createAiAnnotationCandidate — candidate-only minting + Context Pack gate (I-24, I-26)", () => {
  const workingPack: ContextPackLookup = {
    getPack: (id) =>
      id === "pack-1"
        ? { segmentIds: ["seg-1", "seg-2"], retrievalReasons: ["keyword:决策"] }
        : null,
    isReplayable: (id) => id === "pack-1",
  };

  it("mints an annotation with origin ai and state candidate — never confirmed", () => {
    const r = createAiAnnotationCandidate(
      { sessionId: "s-1", contextPackId: "pack-1", agentName: "Ava" },
      workingPack,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.annotation.origin).toBe("ai");
    expect(r.annotation.state).toBe("candidate");
    expect(r.annotation.agentName).toBe("Ava");
  });

  it("carries the rationale's segmentIds and retrievalReasons unchanged — the traceable basis (I-26)", () => {
    const r = createAiAnnotationCandidate(
      { sessionId: "s-1", contextPackId: "pack-1", agentName: "Ava" },
      workingPack,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.annotation.rationale).toEqual({
      contextPackId: "pack-1",
      segmentIds: ["seg-1", "seg-2"],
      retrievalReasons: ["keyword:决策"],
    });
  });

  it("rejects with CONTEXT_PACK_REQUIRED when the pack does not exist", () => {
    const r = createAiAnnotationCandidate(
      { sessionId: "s-1", contextPackId: "pack-ghost", agentName: "Ava" },
      workingPack,
    );
    expect(r).toEqual({ ok: false, reason: "CONTEXT_PACK_REQUIRED" });
  });

  it("rejects with CONTEXT_PACK_NOT_REPLAYABLE when the pack exists but can no longer be replayed", () => {
    const rottenPack: ContextPackLookup = {
      getPack: () => ({ segmentIds: ["seg-1"], retrievalReasons: ["x"] }),
      isReplayable: () => false,
    };
    const r = createAiAnnotationCandidate(
      { sessionId: "s-1", contextPackId: "pack-rotten", agentName: "Ava" },
      rottenPack,
    );
    expect(r).toEqual({ ok: false, reason: "CONTEXT_PACK_NOT_REPLAYABLE" });
  });

  it("CONTEXT_PACK_REQUIRED / CONTEXT_PACK_NOT_REPLAYABLE are real createAiAnnotationCandidate error codes, not invented here", () => {
    const err = C.operations.createAiAnnotationCandidate.err as readonly string[];
    expect(err).toContain("CONTEXT_PACK_REQUIRED");
    expect(err).toContain("CONTEXT_PACK_NOT_REPLAYABLE");
    expect(err).toContain("DIRECT_SEGMENT_ACCESS_FORBIDDEN");
  });
});

describe("F77 · checkAnnotationReferenceable — the one true I-24 chokepoint", () => {
  const unconfirmedAi: AnnotationForReference = { origin: "ai", state: "candidate", evidenceWithdrawn: false };
  const ignoredAi: AnnotationForReference = { origin: "ai", state: "ignored", evidenceWithdrawn: false };
  const confirmedAi: AnnotationForReference = { origin: "ai", state: "confirmed", evidenceWithdrawn: false };
  const confirmedHuman: AnnotationForReference = { origin: "human", state: "confirmed", evidenceWithdrawn: false };

  it("rejects an unconfirmed (candidate) AI annotation — it must not reach report/canvas/kg/decision", () => {
    expect(checkAnnotationReferenceable(unconfirmedAi)).toEqual({
      ok: false,
      reason: "AI_ANNOTATION_NOT_CONFIRMED",
    });
  });

  it("rejects an ignored AI annotation the same way — ignored is not a form of confirmed", () => {
    expect(checkAnnotationReferenceable(ignoredAi)).toEqual({
      ok: false,
      reason: "AI_ANNOTATION_NOT_CONFIRMED",
    });
  });

  it("allows a confirmed AI annotation — human confirmation is the only door through I-24", () => {
    expect(checkAnnotationReferenceable(confirmedAi)).toEqual({ ok: true });
  });

  it("allows a confirmed human annotation without ever touching the AI-specific code path", () => {
    expect(checkAnnotationReferenceable(confirmedHuman)).toEqual({ ok: true });
  });

  it("rejects withdrawn evidence regardless of origin — EVIDENCE_WITHDRAWN is checked first", () => {
    const withdrawnHuman: AnnotationForReference = { origin: "human", state: "confirmed", evidenceWithdrawn: true };
    const withdrawnAi: AnnotationForReference = { origin: "ai", state: "confirmed", evidenceWithdrawn: true };
    expect(checkAnnotationReferenceable(withdrawnHuman)).toEqual({ ok: false, reason: "EVIDENCE_WITHDRAWN" });
    expect(checkAnnotationReferenceable(withdrawnAi)).toEqual({ ok: false, reason: "EVIDENCE_WITHDRAWN" });
  });

  it("AI_ANNOTATION_NOT_CONFIRMED / EVIDENCE_WITHDRAWN are real referenceEvidenceDownstream error codes, not invented here", () => {
    const err = C.operations.referenceEvidenceDownstream.err as readonly string[];
    expect(err).toContain("AI_ANNOTATION_NOT_CONFIRMED");
    expect(err).toContain("EVIDENCE_WITHDRAWN");
  });
});

describe("F77 · decideAiAnnotation — confirm / edit-confirm / ignore, each exactly once (I-27, E7)", () => {
  const candidate: AnnotationForDecision = { state: "candidate", rationaleWithdrawn: false };

  it("confirm transitions candidate to confirmed", () => {
    const r = decideAiAnnotation(candidate, { decision: "confirm" });
    expect(r).toEqual({ ok: true, state: "confirmed", decision: "confirm" });
  });

  it("edit-confirm also transitions to confirmed — editing does not create a third state", () => {
    const r = decideAiAnnotation(candidate, { decision: "edit-confirm" });
    expect(r).toEqual({ ok: true, state: "confirmed", decision: "edit-confirm" });
  });

  it("ignore transitions candidate to ignored — not deleted, a real terminal state (I-27)", () => {
    const r = decideAiAnnotation(candidate, { decision: "ignore" });
    expect(r).toEqual({ ok: true, state: "ignored", decision: "ignore" });
  });

  it("rejects a second decision on an already-confirmed annotation with ANNOTATION_ALREADY_DECIDED", () => {
    const alreadyConfirmed: AnnotationForDecision = { state: "confirmed", rationaleWithdrawn: false };
    const r = decideAiAnnotation(alreadyConfirmed, { decision: "ignore" });
    expect(r).toEqual({ ok: false, reason: "ANNOTATION_ALREADY_DECIDED" });
  });

  it("rejects a second decision on an already-ignored annotation the same way — ignored is equally terminal", () => {
    const alreadyIgnored: AnnotationForDecision = { state: "ignored", rationaleWithdrawn: false };
    const r = decideAiAnnotation(alreadyIgnored, { decision: "confirm" });
    expect(r).toEqual({ ok: false, reason: "ANNOTATION_ALREADY_DECIDED" });
  });

  it("rejects with ANNOTATION_RATIONALE_WITHDRAWN when the depended-on segment already withdrew (E7)", () => {
    const orphaned: AnnotationForDecision = { state: "candidate", rationaleWithdrawn: true };
    const r = decideAiAnnotation(orphaned, { decision: "confirm" });
    expect(r).toEqual({ ok: false, reason: "ANNOTATION_RATIONALE_WITHDRAWN" });
  });

  it("ANNOTATION_ALREADY_DECIDED / ANNOTATION_RATIONALE_WITHDRAWN are real decideAiAnnotation error codes, not invented here", () => {
    const err = C.operations.decideAiAnnotation.err as readonly string[];
    expect(err).toContain("ANNOTATION_ALREADY_DECIDED");
    expect(err).toContain("ANNOTATION_RATIONALE_WITHDRAWN");
    expect(err).toContain("ANNOTATION_NOT_FOUND");
  });
});

describe("F77 · isRationaleWithdrawn — E7's auto-invalidation predicate", () => {
  it("is true when any of the rationale's segmentIds is in the withdrawn set", () => {
    const withdrawn = isRationaleWithdrawn({ segmentIds: ["seg-1", "seg-2"] }, new Set(["seg-2"]));
    expect(withdrawn).toBe(true);
  });

  it("is false when none of the rationale's segmentIds withdrew", () => {
    const withdrawn = isRationaleWithdrawn({ segmentIds: ["seg-1", "seg-2"] }, new Set(["seg-9"]));
    expect(withdrawn).toBe(false);
  });

  it("is false for an empty withdrawn set", () => {
    expect(isRationaleWithdrawn({ segmentIds: ["seg-1"] }, new Set())).toBe(false);
  });
});

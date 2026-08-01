/**
 * F77 · origin 可区分 + 不混入人工打点计数 + 忽略留痕 (uc-5-3 R3 step 4-5, I-24, I-25, I-27).
 *
 * Three things asserted here:
 *   1. `createHumanAnnotation` vs `createAiAnnotationCandidate` mint visibly and structurally
 *      different `origin`/`state` pairs — the distinction the spec calls "视觉与数据上都可区分".
 *   2. `countConfirmedHumanAnnotations` / `countAiCandidates` never cross-contaminate: an AI
 *      annotation contributes to neither the human count nor is miscounted regardless of its
 *      state; a human annotation never inflates the AI-candidate badge count (I-25).
 *   3. `decideAiAnnotation`'s `ignore` outcome carries enough in its return value for the
 *      caller to write an audit event distinguishable from a `confirm`/`edit-confirm` decision
 *      — "拒绝也要留痕" means the decision itself, and which decision it was, must be
 *      retrievable (I-27), not merely that the candidate silently disappeared.
 */
import { describe, expect, it } from "vitest";
import { recording as C } from "@repo/contracts";

import {
  countAiCandidates,
  countConfirmedHumanAnnotations,
  createAiAnnotationCandidate,
  createHumanAnnotation,
  decideAiAnnotation,
  type AnnotationForReference,
  type ContextPackLookup,
} from "../../src/domain/recording/ai-annotation";

describe("F77 · origin/state distinguishability — machine badge vs human mark", () => {
  it("createHumanAnnotation always mints origin human, state confirmed, no agent name, no rationale", () => {
    const a = createHumanAnnotation({ sessionId: "s-1" });
    expect(a).toEqual({
      sessionId: "s-1",
      origin: "human",
      state: "confirmed",
      agentName: null,
      rationale: null,
    });
  });

  it("createAiAnnotationCandidate always mints origin ai, state candidate, carrying an agent name and rationale", () => {
    const lookup: ContextPackLookup = {
      getPack: () => ({ segmentIds: ["seg-1"], retrievalReasons: ["keyword:决策"] }),
      isReplayable: () => true,
    };
    const r = createAiAnnotationCandidate(
      { sessionId: "s-1", contextPackId: "pack-1", agentName: "Ava" },
      lookup,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.annotation.origin).toBe("ai");
    expect(r.annotation.state).toBe("candidate");
    expect(r.annotation.agentName).not.toBeNull();
    expect(r.annotation.rationale).not.toBeNull();
  });

  it("the two mints never collide on origin — one code path cannot silently produce the other's shape", () => {
    const human = createHumanAnnotation({ sessionId: "s-1" });
    const lookup: ContextPackLookup = {
      getPack: () => ({ segmentIds: ["seg-1"], retrievalReasons: [] }),
      isReplayable: () => true,
    };
    const aiResult = createAiAnnotationCandidate(
      { sessionId: "s-1", contextPackId: "pack-1", agentName: "Ava" },
      lookup,
    );
    expect(aiResult.ok).toBe(true);
    if (!aiResult.ok) return;
    expect(human.origin).not.toBe(aiResult.annotation.origin);
    expect(human.state).not.toBe(aiResult.annotation.state);
  });

  it("AnnotationOrigin and AnnotationState are the real contract enums this module reuses, not invented locally", () => {
    expect(C.AnnotationOrigin.options).toEqual(["human", "ai"]);
    expect(C.AnnotationState.options).toEqual(["candidate", "confirmed", "ignored"]);
  });
});

describe("F77 · countConfirmedHumanAnnotations / countAiCandidates — no cross-contamination (I-25)", () => {
  const mixed: readonly AnnotationForReference[] = [
    { origin: "human", state: "confirmed", evidenceWithdrawn: false },
    { origin: "human", state: "confirmed", evidenceWithdrawn: false },
    { origin: "ai", state: "candidate", evidenceWithdrawn: false },
    { origin: "ai", state: "confirmed", evidenceWithdrawn: false },
    { origin: "ai", state: "ignored", evidenceWithdrawn: false },
  ];

  it("counts only human-origin confirmed annotations, regardless of how many AI annotations exist", () => {
    expect(countConfirmedHumanAnnotations(mixed)).toBe(2);
  });

  it("an AI annotation that reaches confirmed state still does not inflate the human count", () => {
    // The one AI annotation in `mixed` that is `confirmed` must not silently count as human —
    // if it did, the human count above would read 3, not 2.
    const aiConfirmedOnly = mixed.filter((a) => a.origin === "ai" && a.state === "confirmed");
    expect(aiConfirmedOnly).toHaveLength(1);
    expect(countConfirmedHumanAnnotations(aiConfirmedOnly)).toBe(0);
  });

  it("counts only ai-origin candidate annotations for the candidate badge, excluding confirmed/ignored AI and all human", () => {
    expect(countAiCandidates(mixed)).toBe(1);
  });

  it("an all-human list contributes zero to the AI candidate count", () => {
    const allHuman: readonly AnnotationForReference[] = [
      { origin: "human", state: "confirmed", evidenceWithdrawn: false },
      { origin: "human", state: "confirmed", evidenceWithdrawn: false },
    ];
    expect(countAiCandidates(allHuman)).toBe(0);
    expect(countConfirmedHumanAnnotations(allHuman)).toBe(2);
  });

  it("an all-ai list contributes zero to the human count even when every candidate is confirmed", () => {
    const allAiConfirmed: readonly AnnotationForReference[] = [
      { origin: "ai", state: "confirmed", evidenceWithdrawn: false },
      { origin: "ai", state: "confirmed", evidenceWithdrawn: false },
    ];
    expect(countConfirmedHumanAnnotations(allAiConfirmed)).toBe(0);
  });
});

describe("F77 · decideAiAnnotation — ignore leaves an auditable, distinguishable trace (I-27)", () => {
  it("ignore's result records which decision was made — not just that the candidate vanished", () => {
    const r = decideAiAnnotation({ state: "candidate", rationaleWithdrawn: false }, { decision: "ignore" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.decision).toBe("ignore");
    expect(r.state).toBe("ignored");
  });

  it("confirm's result is distinguishable from ignore's — both carry the literal decision made", () => {
    const confirmResult = decideAiAnnotation({ state: "candidate", rationaleWithdrawn: false }, { decision: "confirm" });
    const ignoreResult = decideAiAnnotation({ state: "candidate", rationaleWithdrawn: false }, { decision: "ignore" });
    expect(confirmResult.ok && confirmResult.decision).toBe("confirm");
    expect(ignoreResult.ok && ignoreResult.decision).toBe("ignore");
    expect(confirmResult.ok && confirmResult.state).not.toBe(ignoreResult.ok && ignoreResult.state);
  });

  it("edit-confirm is retrievable as its own decision literal, distinct from a plain confirm", () => {
    const r = decideAiAnnotation({ state: "candidate", rationaleWithdrawn: false }, { decision: "edit-confirm" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.decision).toBe("edit-confirm");
  });

  it("decideAiAnnotation's in/out decision enum matches the contract's three-way decision, not a locally invented set", () => {
    const decisionSchema = C.operations.decideAiAnnotation.in.shape.decision;
    expect(decisionSchema.options).toEqual(["confirm", "edit-confirm", "ignore"]);
  });
});

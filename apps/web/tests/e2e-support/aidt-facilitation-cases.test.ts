import { describe, expect, it } from "vitest";
import { AIDT_FACILITATION_CASES, AIDT_FACILITATION_SOURCE, FACILITATION_CRITERIA, assertLocalFacilitationTarget, facilitationReviewTemplate, selectFacilitationCases } from "../../e2e/aidt-facilitation-cases";

describe("facilitation capture preparation, not model acceptance", () => {
  it("defaults to no paid scenarios and requires an explicit bounded distinct selection", () => {
    expect(selectFacilitationCases(undefined)).toEqual([]);
    expect(selectFacilitationCases("  ")).toEqual([]);
    expect(selectFacilitationCases("dominant-member, stalled-team").map(item => item.id)).toEqual(["dominant-member", "stalled-team"]);
    for (const invalid of ["all", "dominant-member,dominant-member", "dominant-member,", "dominant-member,stalled-team,privacy-optout"]) expect(() => selectFacilitationCases(invalid)).toThrow();
  });
  it("covers the newly identified group dynamics without replacing the V2 field cases", () => {
    expect(new Set(AIDT_FACILITATION_CASES.map(item => item.id)).size).toBe(8);
    for (const id of ["dominant-member", "stalled-team", "decision-deadlock", "conflict-evidence", "review-before-adoption", "missing-evidence", "privacy-optout", "inclusive-hmw"]) expect(selectFacilitationCases(id)).toHaveLength(1);
    for (const scenario of AIDT_FACILITATION_CASES) {
      expect(scenario.stage).toBeGreaterThanOrEqual(1); expect(scenario.stage).toBeLessThanOrEqual(6);
      expect(scenario.turns).toHaveLength(2);
      expect(scenario.sections.every(section => AIDT_FACILITATION_SOURCE.sections.some(known => known === section))).toBe(true);
      expect(scenario.criteria.every(id => Boolean(FACILITATION_CRITERIA[id]))).toBe(true);
    }
  });
  it.each(AIDT_FACILITATION_CASES)("leaves $id pending human review with no invented observations", scenario => {
    const review = facilitationReviewTemplate(scenario);
    expect(review.status).toBe("pending"); expect(review.reviewer).toBeNull();
    expect(review.evidenceStatus).toBe("not-evaluated");
    expect(review.criteria.every(item => item.verdict === "pending" && item.evidenceMessageIds.length === 0 && item.note === "")).toBe(true);
    expect(review.criteria.map(item => item.id)).toEqual(scenario.criteria);
  });
});

it("allows controlled local origins and refuses remote/userinfo/path targets before browser login", () => {
  for (const url of ["http://127.0.0.1:3100", "https://localhost:3000/", "http://[::1]:3100"]) expect(() => assertLocalFacilitationTarget(url)).not.toThrow();
  for (const url of ["https://example.invalid", "https://localhost.example.invalid", "file:///tmp/demo", "http://localhost:3000/path", "http://localhost:3000/?token=private", "http://name:private@localhost:3000", "invalid"]) expect(() => assertLocalFacilitationTarget(url)).toThrow(/controlled local/);
});

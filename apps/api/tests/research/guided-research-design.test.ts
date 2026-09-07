import { describe, expect, it } from "vitest";
import { validateGeneratedResearchDesign, preserveResearchDesign } from "../../src/application/research/guided-research-design";

describe("newly generated research design quality", () => {
  it("rejects shallow new directions while allowing legacy schemas outside generation", () => {
    const item = { id: "d", title: "Cost", description: "Costs", enabled: true, order: 0 };
    expect(() => validateGeneratedResearchDesign("directions", [item])).toThrow();
    expect(() => validateGeneratedResearchDesign("directions", [{ ...item, decisionQuestions: ["What cost?"], hypotheses: ["Costs differ"], comparisonDimensions: ["EUR"], evidenceNeeds: ["Actual cost data"] }])).not.toThrow();
  });
  it("rejects generated duplicate subsection headings", () => {
    expect(() => validateGeneratedResearchDesign("outline", [{ objective: "Compare", analysisApproach: "Normalize", expectedOutput: "Matrix", subsections: ["a", "b", "c"].map((id) => ({ id, title: "Same heading", questions: ["Question?"] })) }])).toThrow();
  });
  it("requires chapter analysis intent and a substantive subsection plan", () => {
    const item = { id: "o", title: "Cost", questions: ["What cost?"], enabled: true, order: 0 };
    expect(() => validateGeneratedResearchDesign("outline", [item])).toThrow();
    expect(() => validateGeneratedResearchDesign("outline", [{ ...item, objective: "Compare costs", analysisApproach: "Normalize costs", expectedOutput: "Cost comparison", subsections: ["a", "b", "c"].map((id) => ({ id, title: id, questions: ["What cost?"] })) }])).not.toThrow();
  });
});


describe("model proposal metadata preservation", () => {
  it("retains omitted rich fields by stable ID while respecting explicit replacement and deletion", () => {
    const prior = [{ id: "d1", title: "Cost", decisionQuestions: ["What cost?"], hypotheses: ["Unverified"], evidenceNeeds: ["Actual data"] }, { id: "deleted", title: "Remove me" }];
    expect(preserveResearchDesign("directions", [{ id: "d1", title: "Updated cost", hypotheses: [] }], prior)).toEqual([{ id: "d1", title: "Updated cost", hypotheses: [], decisionQuestions: ["What cost?"], evidenceNeeds: ["Actual data"] }]);
    const subsections = [{ id: "s", title: "Analysis", questions: ["What evidence?"] }];
    expect(preserveResearchDesign("outline", [{ id: "o", title: "Revised" }], [{ id: "o", objective: "Compare", subsections }])).toEqual([{ id: "o", title: "Revised", objective: "Compare", subsections }]);
  });
});

import { research as C } from "@repo/contracts";
import { describe, expect, it } from "vitest";
import { validateGeneratedResearchDesign, preserveResearchDesign, researchDesignInstruction } from "../../src/application/research/guided-research-design";

describe("newly generated research design quality", () => {
  it("requires plan and subsection headings to use the research brief language", () => {
    expect(researchDesignInstruction("outline")).toContain("same language as the user's brief");
    expect(researchDesignInstruction("outline")).toContain("generic English labels");
  });
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


describe("formal report proposal preservation", () => {
  it("retains omitted front matter while respecting explicit replacements", () => {
    const prior = { title: "Report", summary: "Old summary", introduction: "Scope", conclusion: "Decisions" };
    expect(preserveResearchDesign("report", { title: "Revised", summary: "New summary", conclusion: "Revised decisions" }, prior)).toEqual({ title: "Revised", summary: "New summary", introduction: "Scope", conclusion: "Revised decisions" });
  });
});


describe("generated brief topic validation", () => {
  it("rejects the shared placeholder only at generation while manual and legacy schemas remain valid", () => {
    const brief = C.GuidedResearchBrief.parse({ topic: C.DEFAULT_RESEARCH_NAME, goal: "Research enterprise knowledge bases", region: "China", focus: "Access control", timeRange: "2026" });
    expect(() => validateGeneratedResearchDesign("brief", brief)).toThrow();
    expect(C.GuidedResearchRuntimeDraft.safeParse({ node: "brief", value: brief }).success).toBe(true);
    expect(() => validateGeneratedResearchDesign("brief", { ...brief, topic: "企业知识库" })).not.toThrow();
  });
});


describe("substantive generated plan framing", () => {
  it.each(["directions", "outline"])("assigns report packaging to report fields and retains external research questions in %s instructions", node => {
    const instruction = researchDesignInstruction(node);
    for (const requirement of ["externally answerable", "report.summary", "report.introduction", "report.conclusion", "mixed", "retain", "methods themselves"]) expect(instruction).toContain(requirement);
  });
  it("does not classify or silently filter valid external methodology or manual mixed chapters", () => {
    const chapters = ["External methods comparison", "Executive summary"].map((title, index) => ({ id: `chapter-${index}`, title, questions: ["Which published evaluation methods improve retrieval accuracy?"], objective: "Compare published methods", analysisApproach: "Compare external evaluations", expectedOutput: "Evidence comparison", subsections: ["Measures", "Comparisons", "Limitations"].map((heading, i) => ({ id: `${index}-${i}`, title: heading, questions: ["Which published evaluation methods improve retrieval accuracy?"] })), order: index, enabled: true }));
    expect(() => validateGeneratedResearchDesign("outline", chapters)).not.toThrow();
    expect(C.GuidedResearchRuntimeDraft.parse({ node: "outline", value: chapters }).value).toEqual(chapters);
  });
});

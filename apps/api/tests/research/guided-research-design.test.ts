import { guidedResearchReply } from "../../scripts/loopback-guided-research";
import { generateResearchPlan } from "../../src/application/research/guided-research-plan";
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

// Explicit loopback acceptance fixture only; these are not real-model evidence.
describe("controlled research loopback fixture", () => {
  const brief = { topic: C.DEFAULT_RESEARCH_NAME, goal: "核对储能并网政策。保留全部原始需求", region: "中国", timeRange: "2026", focus: "实施约束" };
  it("generates a non-placeholder topic from requirements without changing scope", () => {
    const generated = JSON.parse(guidedResearchReply("You are a research assistant. Generate the brief step.", JSON.stringify({ brief }))!);
    expect(generated.topic).toBe("核对储能并网政策");
    const value = C.GuidedResearchBrief.parse({ ...brief, topic: generated.topic });
    expect(() => validateGeneratedResearchDesign("brief", value)).not.toThrow();
    expect(value).toEqual({ ...brief, topic: "核对储能并网政策" });
  });
  it.each(["directions", "outline"] as const)("keeps strictly valid existing %s fixtures", node => {
    const value = JSON.parse(guidedResearchReply(`You are a research assistant. Generate the ${node} step.`, JSON.stringify({ brief }))!);
    expect(C.GuidedResearchRuntimeDraft.safeParse({ node, value }).success).toBe(true);
    expect(() => validateGeneratedResearchDesign(node, value)).not.toThrow();
  });
  it("covers the actual materials plan prompt without invented external tasks or evidence", async () => {
    const outline = [{ id: "policy", title: "政策要求" }, { id: "risk", title: "实施风险" }];
    const plan = await generateResearchPlan({ brief, outline, sourcePolicy: { mode: "materials", revision: 1, internalSourceIds: [], domains: [] } }, outline.map(item => item.id), async (system, context, validate) => {
      expect(system).toContain("Create a concrete supplied-material analysis plan");
      const output = JSON.parse(guidedResearchReply("You are a research assistant. " + system, JSON.stringify(context))!); validate(output); return output;
    });
    expect(C.GuidedResearchPlanModelOutput.safeParse(plan).success).toBe(true);
    expect(plan.tasks.map(task => task.sectionId)).toEqual(["policy", "risk"]);
    for (const task of plan.tasks) {
      expect(task.query).toMatch(/^分析本次材料/);
      expect(JSON.stringify(task)).not.toMatch(/https?:|grid storage policy evidence|外部检索|网页读取/);
    }
    expect(plan.overview).toContain("缺口");
    expect(plan).not.toHaveProperty("sources"); expect(plan).not.toHaveProperty("report");
  });
  it("retains the existing web plan fixture exactly", async () => {
    const outline = [{ id: "policy", title: "政策要求" }];
    const plan = await generateResearchPlan({ brief, outline }, ["policy"], async (system, context, validate) => {
      const output = JSON.parse(guidedResearchReply("You are a research assistant. " + system, JSON.stringify(context))!); validate(output); return output;
    });
    expect(plan.tasks[0]).toEqual({ sectionId: "policy", title: "核对政策证据", objective: "比较官方并网政策与实际执行", deliverables: ["政策依据和执行限制"], query: "grid storage policy evidence" });
  });
  it("does not intercept unrelated model requests", () => {
    expect(guidedResearchReply("An unrelated assistant", JSON.stringify({ brief }))).toBeNull();
  });
});

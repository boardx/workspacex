import { describe, expect, it } from "vitest";
import type { ResearchRuntime } from "../../src/application/research/guided-runtime-ports";
import { validateRuntimeDraft } from "../../src/application/research/guided-runtime-service";
const id = "6182ec9d-c281-423e-ab13-cd8a253d5699";
const state = { outline: [{ id: "chapter", enabled: true }], sources: [{ id, decision: "accepted" }] } as ResearchRuntime;
const report = { title: "Formal report", summary: "Executive findings", introduction: "Scope and methods", conclusion: "Priorities and next actions", sections: [{ sectionId: "chapter", body: `Known evidence [[source:${id}]]`, sourceIds: [id] }] };
describe("formal report write validation", () => {
  it.each(["summary", "introduction", "conclusion"])("rejects unknown bare references in %s", (field) => {
    expect(() => validateRuntimeDraft(state, { node: "report", value: { ...report, [field]: "Unsupported [[aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa]]" } })).toThrow("RESEARCH_CONTENT_REFERENCE_INVALID");
  });
  it("accepts exact known references across the whole report and rejects title citations", () => {
    expect(() => validateRuntimeDraft(state, { node: "report", value: { ...report, introduction: `Scope [[${id}]]`, conclusion: `Decision [${id}]` } })).not.toThrow();
    expect(() => validateRuntimeDraft(state, { node: "report", value: { ...report, title: `Report [[${id}]]` } })).toThrow();
  });
});

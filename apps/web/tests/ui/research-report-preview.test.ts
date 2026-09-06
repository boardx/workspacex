import { describe, expect, it } from "vitest";
import { researchReportPreview } from "@/lib/research-report-preview";
describe("incremental research report preview", () => {
  it("shows only report strings while nested sections are incomplete", () => {
    expect(researchReportPreview('{"title":"研究","summary":"摘要","sections":[{"sectionId":"a","body":"部分正文')).toEqual({ title: "研究", summary: "摘要", sections: [{ sectionId: "a", body: "部分正文" }] });
  });
  it("decodes escaped strings and holds unfinished unicode escapes and surrogate pairs", () => {
    expect(researchReportPreview('{"summary":"一\\n\\"二\\"\\u4e').summary).toBe('一\n"二"');
    expect(researchReportPreview('{"summary":"\\uD83D').summary).toBe("");
    expect(researchReportPreview('{"summary":"\\uD83D\\uDE00').summary).toBe("😀");
  });
  it("accepts the same optional JSON code fence as final report parsing", () => {
    expect(researchReportPreview('```json\n{"title":"流式标题').title).toBe("流式标题");
  });
  it("never exposes keys, source ids or arbitrary model metadata", () => {
    const preview = researchReportPreview('{"sources":["secret"],"title":"Title","sections":[{"sectionId":"a","sourceIds":["unvalidated"],"body":"Text"}]}');
    expect(preview).toEqual({ title: "Title", summary: "", sections: [{ sectionId: "a", body: "Text" }] });
    expect(researchReportPreview('unstructured model text').summary).toBe("");
  });
});

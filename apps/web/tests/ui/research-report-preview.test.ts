import { describe, expect, it } from "vitest";
import { researchReportPreview } from "@/lib/research-report-preview";
describe("incremental research report preview", () => {
  it("shows question paragraph prose before the author response finishes", () => {
    expect(researchReportPreview('{"sections":[{"sectionId":"a","paragraphs":[{"questionId":"private-id","body":"本章分析'))
      .toEqual({ title: "", summary: "", sections: [{ sectionId: "a", body: "本章分析" }] });
  });
  it("joins only paragraph body strings without exposing question or source metadata", () => {
    expect(researchReportPreview(JSON.stringify({ sections: [{ sectionId: "a", paragraphs: [
      { questionId: "private-id", body: "第一段", sourceIds: ["private-source"] },
      { body: { secret: "not prose" } }, { body: "第二段" }, // Synthetic test fixture.
    ] }] }))).toEqual({ title: "", summary: "", sections: [{ sectionId: "a", body: "第一段\n\n第二段" }] });
  });
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

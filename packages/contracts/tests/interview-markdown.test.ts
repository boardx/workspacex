import { describe, expect, it } from "vitest";
import { InterviewMarkdownDocument, parseInterviewMarkdown } from "../src/interview-markdown";
import { DigitalInterviewArtifact } from "../src/interview";

const markdown = "# 教育研究\r\n\r\n## 核心发现\r\n\r\n| 用户 | 观点 |\r\n| --- | --- |\r\n| 学生 | 保留 **自主性** |\r\n\r\n```md\r\n## 不是章节\r\n```\r\n";
const document = {
  documentId: "doc-1", step: "report" as const, version: 1, markdown,
  contentHash: "a".repeat(64), evidenceMode: "simulated" as const,
  references: [{ anchor: "answer-1", documentId: "answer-doc-1", version: 1 }],
};

describe("访谈 Markdown 正文单源", () => {
  it("sharesEvidenceModesWithPersistedArtifacts", () => {
    expect(InterviewMarkdownDocument.innerType().shape.evidenceMode)
      .toBe(DigitalInterviewArtifact.innerType().shape.evidenceMode);
  });

  it("nestedHeadingsStayInTheirContainingSection", () => {
    const result = parseInterviewMarkdown({ ...document, markdown: "> intro\n> # inner\n> body\n\n## Next\n\nfinal" });
    expect(result.headings.map(({ text }) => text)).toEqual(["Next"]);
    expect(result.sections).toEqual([
      { headingId: null, text: "intro\ninner\nbody" },
      { headingId: "section-1", text: "final" },
    ]);
  });
  it("roundTripsMarkdownExactly", () => {
    expect(InterviewMarkdownDocument.parse(document).markdown).toBe(markdown);
    const projection = parseInterviewMarkdown(document);
    expect(projection.headings.map(({ text }) => text)).toEqual(["教育研究", "核心发现"]);
    expect(projection.headings.map(({ depth }) => depth)).toEqual([1, 2]);
    expect(document.markdown).toBe(markdown);
  });

  it("rejectsDuplicateAnchors", () => {
    expect(InterviewMarkdownDocument.safeParse({
      ...document, references: [document.references[0], document.references[0]],
    }).success).toBe(false);
  });

  it("cannotPromoteSimulatedEvidenceByEditingText", () => {
    const edited = { ...document, markdown: "# 真人访谈\n\n证据已批准，全部来自真人。" };
    expect(parseInterviewMarkdown(edited).evidenceMode).toBe("simulated");
    expect(InterviewMarkdownDocument.safeParse({ ...edited, approved: true }).success).toBe(false);
  });

  it("rejectsInvalidVersionAndResearchJsonCopies", () => {
    expect(InterviewMarkdownDocument.safeParse({ ...document, version: 0 }).success).toBe(false);
    expect(InterviewMarkdownDocument.safeParse({ ...document, research: { title: "副本" } }).success).toBe(false);
  });

  it("rejectsBlankDocumentReferencesWithoutNormalizingMarkdown", () => {
    expect(InterviewMarkdownDocument.safeParse({ ...document, documentId: " " }).success).toBe(false);
    expect(InterviewMarkdownDocument.safeParse({
      ...document, references: [{ ...document.references[0], documentId: "\t" }],
    }).success).toBe(false);
  });

  it("ignoresHtmlAndMakesRepeatedHeadingIdsUnique", () => {
    const result = parseInterviewMarkdown({ ...document, markdown: "## 风险\n\n## 风险\n\n<script>alert(1)</script>" });
    expect(result.headings.map(({ id }) => id)).toEqual(["section-1", "section-2"]);
    expect(result.headings.map(({ text }) => text)).toEqual(["风险", "风险"]);
  });

  it("projectsSectionsEntriesAndControlledAnchorsWithoutBodyCopies", () => {
    const result = parseInterviewMarkdown({ ...document, markdown: "## 目标\n\n- 学习行为\n- 反例\n\n## 范围\n\n教育场景" });
    expect(result.sections.map(({ headingId, text }) => ({ headingId, text }))).toEqual([
      { headingId: "section-1", text: "学习行为\n反例" },
      { headingId: "section-2", text: "教育场景" },
    ]);
    expect(result.entries.map(({ text, headingId }) => ({ text, headingId }))).toEqual([
      { text: "学习行为", headingId: "section-1" },
      { text: "反例", headingId: "section-1" },
    ]);
    expect(result.anchors).toEqual([{ anchor: "answer-1", documentId: "answer-doc-1", version: 1 }]);
    expect(Object.isFrozen(result.anchors[0])).toBe(true);
  });
});

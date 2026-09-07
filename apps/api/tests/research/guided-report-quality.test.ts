import { describe, expect, it } from "vitest";
import { chapterStructureIssues } from "../../src/application/research/guided-report-quality";
const section = { id: "section", title: "Analysis", enabled: true, order: 0, questions: ["What follows?"],
  subsections: ["Evidence", "Implications", "Actions"].map((title) => ({ id: title, title, questions: [title] })) };
const prose = "The available evidence supports only a limited comparison; verify the missing details before making the decision.";
const chapter = (body: string) => ({ sectionId: "section", body, sourceIds: [] });
describe("required chapter subsection structure", () => {
  it("requires each rich subsection's substantive content in its specified order", () => {
    const correct = section.subsections.map((subsection) => `### ${subsection.title}\n\n${prose}`).join("\n\n");
    expect(chapterStructureIssues(chapter(correct), section)).toEqual([]);
    const reversed = [...section.subsections].reverse().map((subsection) => `### ${subsection.title}\n\n${prose}`).join("\n\n");
    expect(chapterStructureIssues(chapter(reversed), section).some((issue) => issue.includes("out-of-order"))).toBe(true);
    const emptyLast = correct.slice(0, correct.lastIndexOf(prose)) + "[[source:source]]";
    expect(chapterStructureIssues(chapter(emptyLast), section).some((issue) => issue.includes("substantive analysis"))).toBe(true);
  });
  it("cannot satisfy two specified sections by reusing a single heading occurrence", () => {
    const duplicate = { ...section, subsections: [...section.subsections, { id: "another", title: "Evidence", questions: ["Another question"] }] };
    const body = section.subsections.map((subsection) => `### ${subsection.title}\n\n${prose}`).join("\n\n");
    expect(chapterStructureIssues(chapter(body), duplicate).length).toBeGreaterThan(0);
    expect(chapterStructureIssues(chapter(body + `\n\n### Evidence\n\n${prose}`), section).some((issue) => issue.includes("exactly"))).toBe(true);
  });
});

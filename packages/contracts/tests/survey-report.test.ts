import { describe, expect, it } from "vitest";
import { compileSurveyReport, SurveyReportTemplateSchema } from "../src/survey-report";
import type { SurveyResponse, SurveyWorkflowQuestion } from "../src/survey";
const question = (id = "q", type: SurveyWorkflowQuestion["type"] = "scale", options = ["1", "2", "3", "4", "5"]): SurveyWorkflowQuestion => ({ id, type, options, order: 1, chapterId: "c", title: id, required: true });
const response = (value: string | string[], quality: SurveyResponse["quality"] = "normal", date = "2026-09-01", group?: string): SurveyResponse => ({ id: JSON.stringify([value, quality, date, group]), quality, submittedAt: `${date}T12:00:00.000Z`, role: "user", companySize: "1", durationSeconds: 60, answers: [{ questionId: "q", value }, ...(group ? [{ questionId: "g", value: group }] : [])] });
const template = (block: Record<string, unknown> = {}) => SurveyReportTemplateSchema.parse({ id: "report", title: "报告", sections: [{ id: "section", title: "章节", blocks: [{ id: "block", title: "指标", type: "metric", questionIds: ["q"], ...block }] }] });
const compile = (block: Record<string, unknown>, responses: SurveyResponse[], questions = [question()]) => compileSurveyReport(template(block), questions, responses).sections[0]!.blocks[0]!;
describe("deterministic survey reports", () => {
  it("averages only valid legal scale answers and excludes review samples", () => {
    expect(compile({}, [response("2"), response("4"), response("5", "review"), response("99"), response("Infinity"), response(["3"]) ]).rows).toEqual([{ label: "q", value: 3, count: 2 }]);
    expect(compile({ samplePolicy: "all" }, [response("2"), response("4", "review")]).rows[0]!.value).toBe(3);
  });
  it("publishes an auditable report sample basis and never re-includes excluded responses", () => {
    const excluded = { ...response("4"), analysis: "excluded" as const, exclusionReason: "测试答卷" };
    const report = compileSurveyReport(template({ samplePolicy: "all" }), [question()], [response("2"), response("3", "review"), excluded]);
    expect(report.sampleSummary).toEqual({ total: 3, pendingReview: 1, excluded: 1, included: 2 });
    expect(report.sections[0]!.blocks[0]!.sampleSize).toBe(2);
    expect(report.sections[0]!.blocks[0]!.rows[0]).toMatchObject({ value: 2.5, count: 2 });
  });
  it("counts each selected option once per person without coercing choices to numbers", () => {
    expect(compile({ statistic: "distribution" }, [response(["A", "A", "B"]), response(["B", "bad"])], [question("q", "multi", ["A", "B", "C"])]).rows).toEqual([{ label: "q · A", value: 1, count: 1 }, { label: "q · B", value: 2, count: 2 }, { label: "q · C", value: 0, count: 0 }]);
    expect(compile({}, [response("1")], [question("q", "single", ["1", "2"])]).issues.length).toBeGreaterThan(0);
  });
  it("does not invent data or gap baselines", () => {
    expect(compile({}, []).issues.length).toBeGreaterThan(0);
    expect(compile({}, [], []).issues.length).toBeGreaterThan(0);
    expect(compile({ type: "gap" }, [response("2")]).rows).toEqual([]);
    expect(compile({ type: "gap", target: 5 }, [response("2")]).rows[0]).toEqual({ label: "q", value: 2, count: 1, target: 5, gap: 3 });
  });
  it("suppresses undersized groups using valid answered samples", () => {
    const block = compile({ groupByQuestionId: "g" }, [response("2", "normal", "2026-09-01", "A"), ...Array.from({ length: 5 }, () => response("4", "normal", "2026-09-01", "B"))], [question(), question("g", "single", ["A", "B"])]);
    expect(block.rows).toEqual([{ label: "q", value: 4, count: 5, group: "B" }]);
    expect(block.issues).toEqual([]);
    expect(block.warnings?.join(" ")).toContain("5");
  });
  it("blocks charts when all groups are suppressed and aggregates nonblocking warnings", () => {
    const t = template({ groupByQuestionId: "g" });
    const result = compileSurveyReport(t, [question(), question("g", "single", ["A"])], [response("2", "normal", "2026-09-01", "A")]);
    expect(result.sections[0]!.blocks[0]!.rows).toEqual([]);
    expect(result.sections[0]!.blocks[0]!.issues.length).toBeGreaterThan(0);
    expect(result.issues.length).toBeGreaterThan(0);
    expect(result.warnings?.join(" ")).toContain("5");
  });
  it("uses sorted submission dates for line charts", () => {
    expect(compile({ type: "line" }, [response("4", "normal", "2026-09-02"), response("2"), response("4")]).rows).toEqual([{ label: "2026-09-01", value: 3, count: 2, group: "q" }, { label: "2026-09-02", value: 4, count: 1, group: "q" }]);
  });
  it("keeps ISO date labels and separates option series in distribution lines", () => {
    expect(compile({ type: "line", statistic: "distribution" }, [response("A"), response("B", "normal", "2026-09-02")], [question("q", "single", ["A", "B"])]).rows).toEqual([
      { label: "2026-09-01", value: 1, count: 1, group: "q · A" },
      { label: "2026-09-01", value: 0, count: 0, group: "q · B" },
      { label: "2026-09-02", value: 0, count: 0, group: "q · A" },
      { label: "2026-09-02", value: 1, count: 1, group: "q · B" },
    ]);
  });
  it("requires three compatible radar axes", () => {
    expect(compile({ type: "radar" }, [response("2")]).rows).toEqual([]);
    const questions = [question("q"), question("q2"), question("q3", "scale", ["1", "10"])];
    expect(compile({ type: "radar", questionIds: questions.map(q => q.id) }, [], questions).issues.join(" ")).toContain("雷达");
  });
  it("suppresses radar groups without all three populated axes", () => {
    const questions = [question(), question("q2"), question("q3"), question("g", "single", ["A"])];
    const samples = Array.from({ length: 5 }, () => response("2", "normal", "2026-09-01", "A"));
    const output = compile({ type: "radar", questionIds: ["q", "q2", "q3"], groupByQuestionId: "g" }, samples, questions);
    expect(output.rows).toEqual([]);
    expect(output.issues.join(" ")).toContain("雷达");
  });
  it("keeps distinct axes and series when questions have the same title", () => {
    const questions = [question("q"), question("q2"), question("q3")].map(q => ({ ...q, title: "同名" }));
    const samples = [{ ...response("2"), answers: questions.map((q, i) => ({ questionId: q.id, value: String(i + 1) })) }];
    const radar = compile({ type: "radar", questionIds: questions.map(q => q.id) }, samples, questions);
    expect(radar.issues).toEqual([]);
    expect(radar.rows.map(r => r.label)).toEqual(["同名（q）", "同名（q2）", "同名（q3）"]);
    const line = compile({ type: "line", questionIds: ["q", "q2"] }, samples, questions);
    expect(line.rows.map(r => r.group)).toEqual(["同名（q）", "同名（q2）"]);
  });
  it("allows empty draft templates but blocks empty report content", () => {
    const empty = { id: "empty", title: "空报告", sections: [] };
    expect(SurveyReportTemplateSchema.safeParse(empty).success).toBe(true);
    expect(compileSurveyReport(empty, [], []).issues.length).toBeGreaterThan(0);
    expect(compileSurveyReport({ ...empty, sections: [{ id: "s", title: "空章", blocks: [] }] }, [], []).issues.length).toBeGreaterThan(0);
    expect(compile({ type: "text", text: "   " }, []).issues.length).toBeGreaterThan(0);
    expect(compileSurveyReport(template({ type: "page-break" }), [], []).issues.length).toBeGreaterThan(0);
    expect(compileSurveyReport(template({ type: "text", text: "已撰写正文" }), [], []).issues).toEqual([]);
  });
  it("returns validation errors rather than throwing for malformed image URLs", () => {
    const input = template();
    input.sections[0]!.blocks[0]!.imageUrl = "not a url";
    expect(SurveyReportTemplateSchema.safeParse(input).success).toBe(false);
  });
  it("preserves authored content and validates image URLs and unique IDs", () => {
    const text = "用户原文 <script> 不执行";
    expect(compile({ type: "text", text }, []).text).toBe(text);
    expect(compile({ type: "image", imageUrl: "https://example.com/photo.png", caption: "说明" }, []).caption).toBe("说明");
    for (const imageUrl of ["javascript:alert(1)", "http://example.com/a", "https://user:pass@example.com/a"]) expect(() => template({ imageUrl })).toThrow();
    expect(() => template({ id: "section" })).toThrow();
    expect(() => template({ target: Infinity })).toThrow();
  });
});

import { describe, expect, it } from "vitest";
import { validateQuestionChapterOutput } from "../../src/application/research/guided-question-chapter-output";
const section = { id: "chapter3", title: "Analysis", objective: "Compare outcomes", questions: ["Main question"], subsections: [{ id: "details", title: "Confirmed analysis", questions: ["Detail"] }] };
const plan = Array.from({ length: 32 }, (_, i) => ({ questionId: `q${i}`, placement: i ? "details" : "chapter_lead", evidenceScope: i === 5 ? [] : [{ sourceId: "S1" }] }));
const prose = "The available observation establishes only background context. The requested measurement is unavailable; the responsible organizer must measure the outcome before choosing the intervention.";
const rows = () => plan.map(q => ({ questionId: q.questionId, body: prose + (q.evidenceScope.length ? " [[source:S1]]" : "") }));
function validate(paragraphs: unknown[]) { return validateQuestionChapterOutput(JSON.stringify({ sectionId: section.id, paragraphs }), section as any, plan, new Set(["S1", "S2"]), id => id); }
describe("strict internal question authoring", () => {
  it("assembles all 32 original questions in confirmed order without adding answer prose", () => {
    const result = validate(rows().reverse());
    expect(result.questionParagraphs.map(q => q.questionId)).toEqual(plan.map(q => q.questionId));
    expect(result.chapter.body.startsWith(prose)).toBe(true);
    expect(result.chapter.body.split("### Confirmed analysis")).toHaveLength(2);
    expect(result.chapter.body.split(prose)).toHaveLength(33);
    expect(result.chapter.sourceIds).toEqual(["S1"]);
    expect(result.questionParagraphs[5]?.paragraphIds).toEqual(["P6"]);
  });
  it("derives canonical source metadata from scoped inline citations, without asking the model for a duplicate list", () => {
    const proseOnly = rows();
    const result = validate(proseOnly);
    expect(result.chapter.sourceIds).toEqual(["S1"]);
    expect(result.chapter.body).toContain("[[source:S1]]");
    expect(() => validate(rows().map(row => ({ ...row, sourceIds: [] })))).toThrow();
  });
  it("preserves citation encounter order and deduplicates valid repeated markers", () => {
    const selectedPlan = plan.map(q => q.questionId === "q0" ? { ...q, evidenceScope: [{ sourceId: "S1" }, { sourceId: "S2" }] } : q);
    const paragraphs = rows().reverse(); paragraphs.find(q => q.questionId === "q0")!.body = prose + " [[source:S2]] [[source:S1]] [[source:S2]]";
    const result = validateQuestionChapterOutput(JSON.stringify({ sectionId: section.id, paragraphs }), section as any, selectedPlan, new Set(["S1", "S2"]), id => id);
    expect(result.chapter.sourceIds).toEqual(["S2", "S1"]);
    expect(result.chapter.body.match(/\[\[source:S2\]\]/g)).toHaveLength(2);
  });
  it.each(["[[source:S999]]", "[[source:S1]"])("discards invalid references while preserving prose and valid citations: %s", bad => {
    const paragraphs = rows(); paragraphs[4]!.body += " " + bad;
    const result = validate(paragraphs);
    expect(result.chapter.body.match(/\[\[source:S1\]\]/g)).toHaveLength(31);
    expect(result.chapter.body).not.toContain("S999");
    expect(result.chapter.body).toContain(prose);
    expect(result.chapter.sourceIds).toEqual(["S1"]);
  });
  it("allows citation-free prose to proceed to independent support review", () => {
    const paragraphs = rows(); paragraphs[4]!.body = prose;
    expect(validate(paragraphs).questionParagraphs).toHaveLength(32);
  });
  it("still rejects a bare URL outside the citation protocol", () => {
    const paragraphs = rows(); paragraphs[4]!.body += " https://example.org/invented";
    expect(() => validate(paragraphs)).toThrow();
  });
  it("discards every wrong-scope citation without discarding any question prose", () => {
    const paragraphs = rows();
    paragraphs[5]!.body += " [[source:S2]]";
    paragraphs[6]!.body += " [[source:S2]]";
    const result = validate(paragraphs);
    expect(result.chapter.body).not.toContain("[[source:S2]]");
    expect(result.chapter.body.split(prose)).toHaveLength(33);
    expect(result.chapter.sourceIds).toEqual(["S1"]);
    expect(paragraphs[5]!.body).toContain("[[source:S2]]");
  });
  it("preserves prose after an incomplete citation instead of deleting the rest of its line", () => {
    const paragraphs = rows();
    paragraphs[5]!.body += " [[source:S999] Preserve this actual measurement limitation.";
    expect(validate(paragraphs).chapter.body).toContain("Preserve this actual measurement limitation.");
  });
  it.each(["missing", "duplicate", "unknown", "oversized", "heading", "extra_field"])("rejects %s without manufacturing coverage", kind => {
    const paragraphs: any[] = rows();
    if (kind === "missing") paragraphs.splice(5, 1);
    if (kind === "duplicate") paragraphs[5].questionId = "q4";
    if (kind === "unknown") paragraphs[5].questionId = "invented";
    if (kind === "oversized") paragraphs[5].body = "x".repeat(10001);
    if (kind === "heading") paragraphs[5].body = "### Copied heading\n\n" + prose;
    if (kind === "outside_scope") { paragraphs[4].body = prose + " [[source:S2]]"; }
    if (kind === "fake_source") { paragraphs[5].body = prose + " [[source:S1]]"; }
    if (kind === "citation_mismatch") paragraphs[4].sourceIds = [];
    if (kind === "extra_field") paragraphs[5].approved = true;
    expect(() => validate(paragraphs)).toThrow();
  });
});

import { describe, expect, it } from "vitest";
import { aliasResolver } from "../../src/application/research/guided-report-checkpoint";
import { validateGeneratedChapter } from "../../src/application/research/guided-report-chapters";
import { validateCanonicalChapter, chapterValidationIssues } from "../../src/application/research/guided-chapter-citation-validation";
import { ResearchRuntimeError } from "../../src/application/research/guided-runtime-ports";
const section = { id: "local", title: "Local scope", order: 0, enabled: true, questions: ["What is supported?"] };
const resolve = aliasResolver([{ alias: "S1", sourceId: "other" }, { alias: "S7", sourceId: "local-source" }]);
const chapter = (body = "Supported limited statement [[source:S7]]", sourceIds = ["S7"]) => ({ sectionId: "local", body, sourceIds });
function caught(operation: () => unknown) { try { operation(); throw new Error("expected rejection"); } catch (error) { expect(error).toBeInstanceOf(ResearchRuntimeError); return error; } }
describe("private chapter repair feedback", () => {
  it("canonicalizes only supplied identities and still refuses a global source outside this chapter", () => {
    expect(validateCanonicalChapter(chapter(), section, new Set(["local-source"]), resolve).sourceIds).toEqual(["local-source"]);
    const error = caught(() => validateCanonicalChapter(chapter("Wrong scope [[source:S1]]", ["S1"]), section, new Set(["local-source"]), resolve));
    expect(chapterValidationIssues(error)).toEqual([{ code: "citation_not_allowed", path: ["body"] }]);
  });
  it.each([
    [chapter("Evidence [[source:S7]]", ["S7", "local-source"]), "citation_duplicate", ["sourceIds"]],
    [chapter("Evidence without a citation", ["S7"]), "citation_list_mismatch", ["sourceIds"]],
    [chapter("Evidence [[source:S7", ["S7"]), "citation_malformed", ["body"]],
    [{ ...chapter(), sectionId: "other-section" }, "section_mismatch", ["sectionId"]],
  ])("refuses invalid canonical content with structural feedback (%s)", (value, code, path) => {
    const error = caught(() => validateCanonicalChapter(value, section, new Set(["local-source"]), resolve));
    expect(chapterValidationIssues(error)).toEqual([{ code, path }]);
    expect((error as ResearchRuntimeError).reasonCode).toBe("RESEARCH_CONTENT_REFERENCE_INVALID");
  });
  it("never echoes unknown model-controlled values into validation feedback", () => {
    const secret = "test-only-MODEL_SECRET https://private.invalid/body";
    for (const value of [chapter(`Bad [[source:${secret}]]`, ["S7"]), chapter("Good [[source:S7]]", [secret])]) {
      const error = caught(() => validateCanonicalChapter(value, section, new Set(["local-source"]), resolve));
      const issues = chapterValidationIssues(error);
      expect(issues?.[0]?.code).toBe("citation_unknown"); expect(JSON.stringify(issues)).not.toContain(secret);
    }
    expect(chapterValidationIssues(new ResearchRuntimeError("RESEARCH_CONTENT_REFERENCE_INVALID", { cause: { validationIssues: [{ code: secret, path: [secret] }] } }))).toBeUndefined();
  });
  it("reports a schema field using only a fixed field whitelist", () => {
    const error = caught(() => validateGeneratedChapter({ ...chapter(), body: 123, MODEL_SECRET: "PRIVATE" }, section, new Set(["local-source"])));
    expect(chapterValidationIssues(error)).toEqual([{ code: "chapter_schema_invalid", path: ["body"] }]);
    expect(JSON.stringify(chapterValidationIssues(error))).not.toContain("MODEL_SECRET");
  });
});

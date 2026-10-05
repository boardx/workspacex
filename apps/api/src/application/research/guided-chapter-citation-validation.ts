import { research as C } from "@repo/contracts";
import { chapterStructureIssues } from "./guided-report-quality";
import { ResearchRuntimeError, type ResearchRuntime } from "./guided-runtime-ports";

type Chapter = NonNullable<ResearchRuntime["report"]>["sections"][number];
type Section = ResearchRuntime["outline"][number];
type FieldPath = [] | ["sectionId" | "body" | "sourceIds"] | ["sourceIds", number];
type ValidationCode = "chapter_json_invalid" | "chapter_schema_invalid" | "section_mismatch" | "citations_required" | "citation_unknown" | "citation_malformed" | "citation_not_allowed" | "citation_duplicate" | "citation_list_mismatch" | "chapter_url_forbidden" | "chapter_structure_invalid";
type ValidationIssue = { code: ValidationCode; path: FieldPath };

/** Server-created categories and structural paths only. Never include a rejected
 * model value, Zod message, excerpt, URL or arbitrary field name. Private repair
 * feedback is separate from the existing safe execution recorder. */
class ChapterValidationError extends ResearchRuntimeError {
  readonly validationIssues: ValidationIssue[];
  constructor(code: ValidationCode, path: FieldPath, reasonCode = "RESEARCH_CONTENT_REFERENCE_INVALID") {
    super(reasonCode);
    this.validationIssues = [{ code, path }];
  }
}
const fail = (code: ValidationCode, path: FieldPath, reason?: string): never => { throw new ChapterValidationError(code, path, reason); };
const indexPath = (index: number): FieldPath => index <= 255 ? ["sourceIds", index] : ["sourceIds"];
export function chapterValidationIssues(error: unknown): ValidationIssue[] | undefined {
  return error instanceof ChapterValidationError ? error.validationIssues : undefined;
}
function parseChapter(value: unknown): Chapter {
  const parsed = C.GuidedResearchReport.shape.sections.element.safeParse(value);
  if (!parsed.success) {
    const candidate = parsed.error.issues[0]?.path ?? [];
    const field = candidate[0];
    const path: FieldPath = field === "body" || field === "sectionId" ? [field]
      : field === "sourceIds" ? typeof candidate[1] === "number" && Number.isInteger(candidate[1]) && candidate[1] >= 0 ? indexPath(candidate[1]) : [field] : [];
    return fail("chapter_schema_invalid", path, "RESEARCH_NODE_STATE_INVALID");
  }
  return parsed.data;
}
export function inlineReportSources(text: string): string[] {
  const ids: string[] = [];
  C.mapGuidedResearchCitations(text, id => { ids.push(id); return `[[source:${id}]]`; }, () => fail("citation_malformed", ["body"]));
  return [...new Set(ids)];
}
export function validateGeneratedChapter(value: unknown, section: Section, allowed: ReadonlySet<string>, checkStructure = true): Chapter {
  const chapter = parseChapter(value);
  if (chapter.sectionId !== section.id) fail("section_mismatch", ["sectionId"]);
  if (allowed.size > 0 && !chapter.sourceIds.length) fail("citations_required", ["sourceIds"]);
  if (new Set(chapter.sourceIds).size !== chapter.sourceIds.length) fail("citation_duplicate", ["sourceIds"]);
  const inline = inlineReportSources(chapter.body);
  if (inline.some(id => !allowed.has(id))) fail("citation_not_allowed", ["body"]);
  const denied = chapter.sourceIds.findIndex(id => !allowed.has(id));
  if (denied >= 0) fail("citation_not_allowed", indexPath(denied));
  if (inline.length !== chapter.sourceIds.length || inline.some(id => !chapter.sourceIds.includes(id))) fail("citation_list_mismatch", ["sourceIds"]);
  if (/https?:\/\//i.test(chapter.body)) fail("chapter_url_forbidden", ["body"], "RESEARCH_NODE_STATE_INVALID");
  if (checkStructure && chapterStructureIssues(chapter, section).length) fail("chapter_structure_invalid", ["body"], "RESEARCH_NODE_STATE_INVALID");
  return chapter;
}
export function validateCanonicalChapter(value: unknown, section: Section, allowed: ReadonlySet<string>, resolve: (id: string) => string): Chapter {
  const chapter = parseChapter(value);
  const resolveAt = (id: string, path: FieldPath) => {
    try { return resolve(id); } catch { return fail("citation_unknown", path); }
  };
  const body = C.mapGuidedResearchCitations(chapter.body, id => `[[source:${resolveAt(id, ["body"])}]]`, () => fail("citation_malformed", ["body"]));
  const sourceIds = chapter.sourceIds.map((id, index) => resolveAt(id, indexPath(index)));
  return validateGeneratedChapter({ ...chapter, body, sourceIds }, section, allowed, false);
}

export function validateChapterOutput(text: string, section: Section, allowed: ReadonlySet<string>, resolve: (id: string) => string): Chapter {
  let value: unknown;
  try { value = JSON.parse(text); } catch { fail("chapter_json_invalid", [], "RESEARCH_NODE_STATE_INVALID"); }
  return validateCanonicalChapter(value, section, allowed, resolve);
}

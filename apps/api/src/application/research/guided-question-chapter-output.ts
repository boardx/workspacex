import { research as C } from "@repo/contracts";
import type { ModelResponseSchema } from "../agent-run/ports";
import type { ReportSection } from "./guided-report-evidence";
import { ResearchRuntimeError } from "./guided-runtime-ports";
import { validateModelChapter, chapterValidationIssues } from "./guided-chapter-citation-validation";
import { chapterParagraphRegistry, type QuestionParagraphBinding } from "./guided-chapter-paragraphs";

export interface QuestionParagraphPlan { questionId: string; placement: string; evidenceScope: { sourceId: string }[] }
const paragraph = C.GuidedResearchQuestionParagraphModelOutput;
const output = C.GuidedResearchQuestionChapterModelOutput;
class QuestionParagraphOutputError extends ResearchRuntimeError {
  readonly validationIssues: { code: string; path: (string | number)[]; questionId?: string; allowedSourceIds?: string[]; rejectedSourceIds?: string[] }[];
  constructor(code: string, reason = "RESEARCH_NODE_STATE_INVALID", detail?: { path: (string | number)[]; questionId: string; allowedSourceIds: string[]; rejectedSourceIds: string[] }) {
    super(reason); this.validationIssues = [{ code, path: ["paragraphs"], ...detail }];
  }
}
export function questionParagraphValidationIssues(error: unknown) {
  return error instanceof QuestionParagraphOutputError ? error.validationIssues : undefined;
}
export function questionParagraphResponseSchema(plan: readonly QuestionParagraphPlan[]): ModelResponseSchema {
  return { name: "research_question_chapter", policy: "strict-if-supported", schema: {
    type: "object", additionalProperties: false, required: Object.keys(output.shape), properties: {
      sectionId: { type: "string", minLength: output.shape.sectionId.minLength },
      paragraphs: { type: "array", minItems: plan.length, maxItems: plan.length, items: { anyOf: plan.map(q => {
        return { type: "object", additionalProperties: false, required: Object.keys(paragraph.shape), properties: {
          questionId: { type: "string", enum: [q.questionId] },
          body: { type: "string", minLength: paragraph.shape.body.minLength, maxLength: paragraph.shape.body.maxLength },
        } };
      }) } },
    },
  } };
}
/** Only order and format model prose. Never synthesize an answer or evidence gap. */
export function validateQuestionChapterOutput(text: string, section: ReportSection, plan: readonly QuestionParagraphPlan[], allowed: ReadonlySet<string>, resolve: (id: string) => string) {
  let raw: unknown; try { raw = JSON.parse(text); } catch { throw new QuestionParagraphOutputError("paragraph_schema_invalid"); }
  const parsed = output.safeParse(raw);
  if (!parsed.success || parsed.data.sectionId !== section.id) throw new QuestionParagraphOutputError("paragraph_schema_invalid");
  const rows = parsed.data.paragraphs;
  if (rows.length !== plan.length || new Set(rows.map(row => row.questionId)).size !== plan.length || rows.some(row => !plan.some(q => q.questionId === row.questionId))) throw new QuestionParagraphOutputError("question_coverage_invalid");
  const pieces: { body: string; questionId?: string }[] = [];
  const append = (q: QuestionParagraphPlan) => {
    const row = rows.find(row => row.questionId === q.questionId)!;
    if (/^\s*#{1,6}\s/m.test(row.body)) throw new QuestionParagraphOutputError("paragraph_heading_forbidden");
    const ownSources = new Set(q.evidenceScope.map(e => resolve(e.sourceId)));
    // Invalid question references are discarded, never reassigned to another
    // source. The complete prose still requires independent semantic review.
    let canonical;
    try { canonical = validateModelChapter({ sectionId: section.id, body: row.body, sourceIds: [] }, section, ownSources, resolve); }
    catch (error) {
      const issue = chapterValidationIssues(error)?.[0];
      if (!issue || !(error instanceof ResearchRuntimeError)) throw error;
      const allowedAliases = [...new Set(q.evidenceScope.map(e => e.sourceId))];
      const rejectedSourceIds = [...new Set([...[...row.body.matchAll(/\[\[source:([^\]]+)\]\]/g)].map(match => match[1]!)])].filter(id => /^S[1-9]\d{0,5}$/.test(id) && !allowedAliases.includes(id)).slice(0, 64);
      throw new QuestionParagraphOutputError(issue.code, error.reasonCode, { rejectedSourceIds, path: ["paragraphs", rows.indexOf(row), ...(issue.path[0] === "sourceIds" ? ["body"] : issue.path)], questionId: q.questionId, allowedSourceIds: allowedAliases });
    }
    pieces.push({ body: canonical.body, questionId: q.questionId });
  };
  for (const q of plan.filter(q => q.placement === "chapter_lead")) append(q);
  for (const subsection of section.subsections ?? []) {
    pieces.push({ body: `### ${subsection.title}` });
    for (const q of plan.filter(q => q.placement === subsection.id)) append(q);
  }
  if (pieces.filter(p => p.questionId).length !== plan.length) throw new QuestionParagraphOutputError("question_coverage_invalid");
  const body = pieces.map(piece => piece.body).join("\n\n");
  const chapter = validateModelChapter({ sectionId: section.id, body, sourceIds: [] }, section, allowed, resolve);
  let offset = 0; const questionParagraphs: QuestionParagraphBinding[] = [];
  for (const piece of pieces) {
    const count = chapterParagraphRegistry(piece.body).length;
    if (piece.questionId) questionParagraphs.push({ questionId: piece.questionId, paragraphIds: Array.from({ length: count }, (_, index) => `P${offset + index + 1}`) });
    offset += count;
  }
  return { chapter, questionParagraphs };
}

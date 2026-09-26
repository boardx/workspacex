import { z } from "zod";
import { SurveyQuestionTypeSchema } from "./survey-question-types";
import type { SurveyDraftInput } from "./survey-runtime";

export const SurveySourceDocumentKindSchema = z.enum([
  "design",
  "publication",
  "report_template",
  "analysis_report",
]);
export type SurveySourceDocumentKind = z.infer<typeof SurveySourceDocumentKindSchema>;

export const SurveySourceDocumentSchema = z.object({
  kind: SurveySourceDocumentKindSchema,
  markdown: z.string().max(500_000),
  revision: z.number().int().positive(),
  updatedAt: z.string().datetime(),
  contentHash: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  parseStatus: z.enum(["valid", "invalid"]).default("valid"),
}).strict();
export type SurveySourceDocument = z.infer<typeof SurveySourceDocumentSchema>;

export const SurveySourceDiagnosticSchema = z.object({
  code: z.enum(["TITLE_REQUIRED", "QUESTION_SYNTAX", "QUESTION_TYPE_UNSUPPORTED", "QUESTION_ID_DUPLICATE", "QUESTION_PROMPT_REQUIRED", "OPTIONS_REQUIRED"]),
  message: z.string().min(1),
  line: z.number().int().positive(),
  column: z.number().int().positive(),
}).strict();
export type SurveySourceDiagnostic = z.infer<typeof SurveySourceDiagnosticSchema>;

export const SurveyCompiledDraftSchema = z.object({
  title: z.string().min(1).max(200),
  questions: z.array(z.object({
    id: z.string().min(1).max(200), order: z.number().int().positive(), chapterId: z.string().max(200),
    title: z.string().min(1).max(2000), type: SurveyQuestionTypeSchema, required: z.boolean(), options: z.array(z.string().min(1).max(2000)).max(100),
  }).strict()).max(200),
  template: z.object({ id: z.string().min(1), title: z.string().min(1), sections: z.array(z.unknown()) }).passthrough(),
});
export type SurveyCompiledDraft = z.infer<typeof SurveyCompiledDraftSchema>;

export type SurveySourceParseResult =
  | { ok: true; draft: SurveyCompiledDraft; sourceRanges: Record<string, { line: number; column: number }> }
  | { ok: false; diagnostics: SurveySourceDiagnostic[] };

const choiceTypes = new Set(["single", "multi", "dropdown", "image_single", "image_multi", "scale", "matrix_single", "matrix_multi", "matrix_scale", "matrix_dropdown", "ranking", "allocation"]);
const heading = /^##\s+([^\s]+)\s+\[([^\]]+)\]\s*$/;

export function parseSurveyDesignMarkdown(markdown: string): SurveySourceParseResult {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const diagnostics: SurveySourceDiagnostic[] = [];
  const titleLine = lines.findIndex((line) => /^#\s+\S/.test(line));
  if (titleLine < 0) diagnostics.push({ code: "TITLE_REQUIRED", message: "问卷需要一级标题", line: 1, column: 1 });
  const title = titleLine < 0 ? "" : lines[titleLine]!.replace(/^#\s+/, "").trim();
  const questions: SurveyCompiledDraft["questions"] = [];
  const sourceRanges: Record<string, { line: number; column: number }> = {};
  const ids = new Set<string>();
  for (let i = 0; i < lines.length; i++) {
    const match = heading.exec(lines[i]!);
    if (!match) continue;
    const id = match[1]!;
    const attributes = match[2]!.split(",").map((item) => item.trim()).filter(Boolean);
    const type = attributes[0] ?? "";
    const required = attributes.slice(1).includes("required");
    const parsedType = SurveyQuestionTypeSchema.safeParse(type);
    if (!parsedType.success) {
      diagnostics.push({ code: "QUESTION_TYPE_UNSUPPORTED", message: `不支持的题型：${type}`, line: i + 1, column: 1 });
      continue;
    }
    if (ids.has(id)) {
      diagnostics.push({ code: "QUESTION_ID_DUPLICATE", message: `题目编号重复：${id}`, line: i + 1, column: 1 });
      continue;
    }
    ids.add(id);
    const body: string[] = [];
    for (let cursor = i + 1; cursor < lines.length && !/^##\s+/.test(lines[cursor]!); cursor++) body.push(lines[cursor]!);
    const prompt = body.find((line) => line.trim() && !line.trimStart().startsWith("-"))?.trim() ?? "";
    const options = body.filter((line) => /^-\s+\S/.test(line)).map((line) => line.replace(/^-\s+/, "").trim());
    if (!prompt) diagnostics.push({ code: "QUESTION_PROMPT_REQUIRED", message: "题目需要题干", line: i + 1, column: 1 });
    if (choiceTypes.has(type) && options.length < 2) diagnostics.push({ code: "OPTIONS_REQUIRED", message: "选择题至少需要两个选项", line: i + 1, column: 1 });
    questions.push({ id, order: questions.length + 1, chapterId: "general", title: prompt || id, type: parsedType.data, required, options });
    sourceRanges[id] = { line: i + 1, column: 1 };
  }
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (!line.startsWith("> visibleWhen:")) continue;
    const reference = /^>\s+visibleWhen:\s+(\S+)\s+equals\s+.+$/.exec(line)?.[1];
    if (!reference || !ids.has(reference)) {
      diagnostics.push({ code: "QUESTION_SYNTAX", message: "显示逻辑引用了不存在的题目", line: i + 1, column: 1 });
    }
  }
  return diagnostics.length ? { ok: false, diagnostics } : { ok: true, draft: { title, questions, template: { id: "report-template", title: `${title}分析报告`, sections: [] } }, sourceRanges };
}

export function serializeSurveyDesignMarkdown(draft: SurveyDraftInput): string {
  const parts = [`# ${draft.title.trim()}`];
  for (const question of [...draft.questions].sort((a, b) => a.order - b.order)) {
    parts.push("", `## ${question.id} [${question.type}${question.required ? ", required" : ""}]`, question.title.trim());
    for (const option of question.options) parts.push(`- ${option.trim()}`);
  }
  return `${parts.join("\n").trimEnd()}\n`;
}

/** A stable, dependency-free 256-bit fingerprint for source snapshot identity. */
export function sourceContentHash(documents: readonly (Pick<SurveySourceDocument, "kind" | "markdown"> & Record<string, unknown>)[]): string {
  const canonical = [...documents].sort((a, b) => a.kind.localeCompare(b.kind)).map((document) => `${document.kind}\0${document.markdown.replace(/\r\n/g, "\n")}`).join("\n\u0001\n");
  const hashes = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
  for (let i = 0; i < canonical.length; i++) {
    const value = canonical.charCodeAt(i);
    for (let j = 0; j < hashes.length; j++) hashes[j] = Math.imul(hashes[j]! ^ value, 0x01000193) >>> 0;
  }
  return hashes.map((value) => value!.toString(16).padStart(8, "0")).join("");
}

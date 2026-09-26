import { z } from "zod";
import { SurveyQuestionTypeSchema, SurveyWorkflowQuestionSchema, validateSurveyQuestionLogic } from "./survey-question-types";
import { SurveyReportTemplateSchema, type SurveyReportTemplate } from "./survey-report";
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
  code: z.enum(["TITLE_REQUIRED", "QUESTION_SYNTAX", "QUESTION_TYPE_UNSUPPORTED", "QUESTION_ID_DUPLICATE", "QUESTION_PROMPT_REQUIRED", "OPTIONS_REQUIRED", "COMPILED_DRAFT_INVALID", "DOCUMENT_SYNTAX", "REPORT_TEMPLATE_INVALID"]),
  message: z.string().min(1),
  line: z.number().int().positive(),
  column: z.number().int().positive(),
}).strict();
export type SurveySourceDiagnostic = z.infer<typeof SurveySourceDiagnosticSchema>;

export const SurveyCompiledDraftSchema = z.object({
  title: z.string().min(1).max(200),
  questions: z.array(SurveyWorkflowQuestionSchema).max(200),
  template: SurveyReportTemplateSchema,
});
export type SurveyCompiledDraft = z.infer<typeof SurveyCompiledDraftSchema>;

export type SurveySourceParseResult =
  | { ok: true; draft: SurveyCompiledDraft; sourceRanges: Record<string, { line: number; column: number }> }
  | { ok: false; diagnostics: SurveySourceDiagnostic[] };

const choiceTypes = new Set(["single", "multi", "dropdown", "image_single", "image_multi", "scale", "matrix_single", "matrix_multi", "matrix_scale", "matrix_dropdown", "ranking", "allocation"]);
const heading = /^##\s+([^\s]+)\s+\[([^\]]+)\]\s*$/;
const sourceMetadata = z.object({
  chapterId: z.string().optional(),
  config: z.unknown().optional(),
  provenance: z.unknown().optional(),
}).strict();
const sourceFence = /^```survey-question\s*$/;
const reportFence = /^```survey-report\s*$/;

function diagnostic(
  code: SurveySourceDiagnostic["code"],
  message: string,
  line: number,
): SurveySourceDiagnostic {
  return { code, message, line, column: 1 };
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((item) => item === undefined ? "null" : stableJson(item)).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).filter((key) => record[key] !== undefined).sort().map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(",")}}`;
  }
  if (value === undefined) return "null";
  return JSON.stringify(value);
}

function fencedJson(
  lines: string[],
  startsFence: (line: string) => boolean,
): { value?: unknown; body: string[]; diagnostic?: SurveySourceDiagnostic } {
  const start = lines.findIndex(startsFence);
  if (start < 0) return { body: lines };
  const end = lines.findIndex((line, index) => index > start && /^```\s*$/.test(line));
  if (end < 0) return { body: lines, diagnostic: diagnostic("QUESTION_SYNTAX", "元数据代码块缺少结束标记", start + 1) };
  const raw = lines.slice(start + 1, end).join("\n");
  try {
    return { value: JSON.parse(raw), body: [...lines.slice(0, start), ...lines.slice(end + 1)] };
  } catch {
    return { body: lines, diagnostic: diagnostic("QUESTION_SYNTAX", "元数据必须是有效 JSON", start + 1) };
  }
}

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
    if (!match) {
      if (/^##\s+/.test(lines[i]!))
        diagnostics.push(diagnostic("QUESTION_SYNTAX", "题目标题必须使用“## 编号 [题型]”格式", i + 1));
      continue;
    }
    const id = match[1]!;
    const attributes = match[2]!.split(",").map((item) => item.trim()).filter(Boolean);
    const type = attributes[0] ?? "";
    const required = attributes.slice(1).includes("required");
    const parsedType = SurveyQuestionTypeSchema.safeParse(type);
    if (!parsedType.success) {
      diagnostics.push({ code: "QUESTION_TYPE_UNSUPPORTED", message: `不支持的题型：${type}`, line: i + 1, column: 1 });
      continue;
    }
    if (attributes.slice(1).some((attribute) => attribute !== "required")) {
      diagnostics.push(diagnostic("QUESTION_SYNTAX", "题目属性只支持 required", i + 1));
      continue;
    }
    if (ids.has(id)) {
      diagnostics.push({ code: "QUESTION_ID_DUPLICATE", message: `题目编号重复：${id}`, line: i + 1, column: 1 });
      continue;
    }
    ids.add(id);
    const body: string[] = [];
    for (let cursor = i + 1; cursor < lines.length && !/^##\s+/.test(lines[cursor]!); cursor++) body.push(lines[cursor]!);
    const fenced = fencedJson(body, (line) => sourceFence.test(line));
    if (fenced.diagnostic) diagnostics.push({ ...fenced.diagnostic, line: i + fenced.diagnostic.line });
    let advanced: z.infer<typeof sourceMetadata> = {};
    if (fenced.value !== undefined) {
      const metadata = sourceMetadata.safeParse(fenced.value);
      if (!metadata.success)
        diagnostics.push(diagnostic("QUESTION_SYNTAX", "题目元数据只允许 chapterId、config 与 provenance", i + 1));
      else advanced = metadata.data;
    }
    const semanticBody = fenced.body;
    const prompt = semanticBody.find((line) => line.trim() && !line.trimStart().startsWith("-") && !line.trimStart().startsWith(">"))?.trim() ?? "";
    const options = semanticBody.filter((line) => /^-\s+\S/.test(line)).map((line) => line.replace(/^-\s+/, "").trim());
    if (!prompt) diagnostics.push({ code: "QUESTION_PROMPT_REQUIRED", message: "题目需要题干", line: i + 1, column: 1 });
    if (choiceTypes.has(type) && options.length < 2) diagnostics.push({ code: "OPTIONS_REQUIRED", message: "选择题至少需要两个选项", line: i + 1, column: 1 });
    const question = SurveyWorkflowQuestionSchema.safeParse({ id, order: questions.length + 1, chapterId: advanced.chapterId ?? "general", title: prompt || id, type: parsedType.data, required, options, config: advanced.config, provenance: advanced.provenance });
    if (!question.success) {
      diagnostics.push(diagnostic("QUESTION_SYNTAX", "题目元数据不符合题型配置约束", i + 1));
      continue;
    }
    questions.push(question.data);
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
  questions.forEach((question, index) => {
    for (const error of validateSurveyQuestionLogic(question, index, questions))
      diagnostics.push(diagnostic("QUESTION_SYNTAX", error, sourceRanges[question.id]!.line));
  });
  const draft: SurveyCompiledDraft = { title, questions, template: { id: "report-template", title: `${title}分析报告`, sections: [] } };
  const compiled = SurveyCompiledDraftSchema.safeParse(draft);
  if (!compiled.success) {
    diagnostics.push(diagnostic("COMPILED_DRAFT_INVALID", "编译后的问卷超出运行时允许的范围", titleLine + 1 || 1));
    return { ok: false, diagnostics };
  }
  return diagnostics.length ? { ok: false, diagnostics } : { ok: true, draft: compiled.data, sourceRanges };
}

export function serializeSurveyDesignMarkdown(draft: SurveyDraftInput): string {
  const parts = [`# ${draft.title.trim()}`];
  for (const question of [...draft.questions].sort((a, b) => a.order - b.order)) {
    parts.push("", `## ${question.id} [${question.type}${question.required ? ", required" : ""}]`, question.title.trim());
    for (const option of question.options) parts.push(`- ${option.trim()}`);
    const metadata = {
      ...(question.chapterId !== "general" ? { chapterId: question.chapterId } : {}),
      ...(question.config ? { config: question.config } : {}),
      ...(question.provenance ? { provenance: question.provenance } : {}),
    };
    if (Object.keys(metadata).length)
      parts.push("", "```survey-question", stableJson(metadata), "```");
  }
  return `${parts.join("\n").trimEnd()}\n`;
}

export type SurveyReportTemplateParseResult =
  | { ok: true; template: SurveyReportTemplate }
  | { ok: false; diagnostics: SurveySourceDiagnostic[] };

export function serializeSurveyReportTemplateMarkdown(template: SurveyReportTemplate): string {
  return `# ${template.title.trim()}\n\n\`\`\`survey-report\n${stableJson(template)}\n\`\`\`\n`;
}

export function parseSurveyReportTemplateMarkdown(markdown: string): SurveyReportTemplateParseResult {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const titleLine = lines.findIndex((line) => /^#\s+\S/.test(line));
  if (titleLine < 0) return { ok: false, diagnostics: [diagnostic("DOCUMENT_SYNTAX", "报告模板需要一级标题", 1)] };
  const fenced = fencedJson(lines, (line) => reportFence.test(line));
  if (fenced.diagnostic) return { ok: false, diagnostics: [{ ...fenced.diagnostic, code: "REPORT_TEMPLATE_INVALID" }] };
  const parsed = SurveyReportTemplateSchema.safeParse(fenced.value);
  if (!parsed.success) return { ok: false, diagnostics: [diagnostic("REPORT_TEMPLATE_INVALID", "报告模板元数据不符合运行时约束", titleLine + 1)] };
  const headingTitle = lines[titleLine]!.replace(/^#\s+/, "").trim();
  if (parsed.data.title !== headingTitle)
    return { ok: false, diagnostics: [diagnostic("REPORT_TEMPLATE_INVALID", "报告标题必须与一级标题一致", titleLine + 1)] };
  return { ok: true, template: parsed.data };
}

export type SurveyPublicationParseResult =
  | { ok: true }
  | { ok: false; diagnostics: SurveySourceDiagnostic[] };

export function parseSurveyPublicationMarkdown(markdown: string): SurveyPublicationParseResult {
  return /^#\s+\S/.test(markdown.replace(/\r\n/g, "\n"))
    ? { ok: true }
    : { ok: false, diagnostics: [diagnostic("DOCUMENT_SYNTAX", "发布设置需要一级标题", 1)] };
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

import { z } from "zod";
import { SurveyDraftInputSchema } from "./survey-runtime";
import { SurveyReportTemplateSchema } from "./survey-report";

/** Keep the whole UTF-8 request below the unchanged 100 KiB JSON parser limit. */
export const SURVEY_TEMPLATE_REQUEST_MAX_BYTES = 90 * 1024;
export function isSurveyTemplateRequestWithinLimit(value: unknown, reservedBytes = 0): boolean {
  try {
    const json = JSON.stringify(value);
    return typeof json === "string" && new TextEncoder().encode(json).byteLength + reservedBytes <= SURVEY_TEMPLATE_REQUEST_MAX_BYTES;
  } catch { return false; }
}
const requestLimitMessage = "模板请求总大小不能超过 90KB（UTF-8，包含题目、报告内容及保存版本）";

export const SurveyTemplateKindSchema = z.enum(["question", "report"]);
const fields = {
  kind: SurveyTemplateKindSchema,
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000).default(""),
  questions: SurveyDraftInputSchema.shape.questions.refine(
    questions => new Set(questions.map(question => question.id)).size === questions.length,
    "题目 ID 必须唯一",
  ),
  template: SurveyReportTemplateSchema,
};
const SurveyTemplateBaseSchema = z.object(fields);
function boundedRequest<S extends z.ZodTypeAny>(schema: S, reservedBytes = 0) {
  // Check the original request before Zod strips unknown keys, then normalized
  // output too: defaulted fields must not make a later copy exceed this contract.
  const withinLimit = (value: unknown) => isSurveyTemplateRequestWithinLimit(value, reservedBytes);
  return z.unknown().refine(withinLimit, requestLimitMessage)
    .pipe(schema).refine(withinLimit, requestLimitMessage);
}
// Reserve room for expectedVersion so every accepted create can later be saved.
export const SurveyTemplateInputSchema = boundedRequest(SurveyTemplateBaseSchema, 128);
export const SurveyTemplateSaveInputSchema = boundedRequest(SurveyTemplateBaseSchema.extend({
  expectedVersion: z.number().int().positive(),
}));
export const SurveyLibraryTemplateSchema = SurveyTemplateBaseSchema.extend({
  id: z.string().min(1),
  version: z.number().int().positive(),
  updatedAt: z.string().datetime(),
});
export type SurveyTemplateInput = z.infer<typeof SurveyTemplateInputSchema>;
export type SurveyLibraryTemplate = z.infer<typeof SurveyLibraryTemplateSchema>;

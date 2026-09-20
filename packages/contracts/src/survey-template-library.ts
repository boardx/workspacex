import { z } from "zod";
import { SurveyDraftInputSchema } from "./survey-runtime";
import { SurveyReportTemplateSchema } from "./survey-report";

export const SurveyTemplateKindSchema = z.enum(["question", "report"]);
const fields = {
  kind: SurveyTemplateKindSchema,
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000).default(""),
  questions: SurveyDraftInputSchema.shape.questions.refine(
    questions => new Set(questions.map(question => question.id)).size === questions.length,
    "题目 ID 必须唯一",
  ),
  template: SurveyReportTemplateSchema.refine(
    template => JSON.stringify(template).length <= 500000,
    "报告模板过大",
  ),
};
export const SurveyTemplateInputSchema = z.object(fields);
export const SurveyTemplateSaveInputSchema = SurveyTemplateInputSchema.extend({
  expectedVersion: z.number().int().positive(),
});
export const SurveyLibraryTemplateSchema = SurveyTemplateInputSchema.extend({
  id: z.string().min(1),
  version: z.number().int().positive(),
  updatedAt: z.string().datetime(),
});
export type SurveyTemplateInput = z.infer<typeof SurveyTemplateInputSchema>;
export type SurveyLibraryTemplate = z.infer<typeof SurveyLibraryTemplateSchema>;

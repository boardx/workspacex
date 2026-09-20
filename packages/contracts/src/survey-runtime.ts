import { z } from "zod";
import { SurveyWorkflowQuestionSchema, SurveyResponseSchema } from "./survey";
import {
  SurveyReportTemplateSchema,
  CompiledSurveyReportSchema,
} from "./survey-report";

export const SurveyDraftInputSchema = z.object({
  title: z.string().trim().min(1).max(200),
  questions: z
    .array(
      SurveyWorkflowQuestionSchema.extend({
        title: z.string().trim().min(1).max(2000),
        chapterId: z.string().max(200),
        id: z.string().min(1).max(200),
        options: z
          .array(z.string().trim().min(1).max(2000))
          .max(100)
          .default([]),
      }),
    )
    .max(200),
  template: SurveyReportTemplateSchema.refine(
    (value) => JSON.stringify(value).length <= 500000,
    "报告模板过大",
  ),
});
export const SurveySaveInputSchema = SurveyDraftInputSchema.extend({
  expectedVersion: z.number().int().positive(),
});
export const SurveyVersionInputSchema = z.object({
  expectedVersion: z.number().int().positive(),
});
export const SurveyPublishInputSchema = SurveyVersionInputSchema.extend({
  expiresAt: z.string().datetime().optional(),
});
export const SurveySubmissionInputSchema = z.object({
  submissionId: z.string().min(8).max(128),
  answers: z
    .array(
      z.object({
        questionId: z.string().min(1),
        value: z.union([
          z.string().max(20000),
          z.array(z.string().max(2000)).max(100),
        ]),
      }),
    )
    .max(200),
  durationSeconds: z.number().int().nonnegative().max(604800).default(0),
  role: z.string().max(200).default("未填写"),
  companySize: z.string().max(200).default("未填写"),
});
export const SurveyRuntimeSchema = SurveyDraftInputSchema.extend({
  id: z.string(),
  version: z.number().int().positive(),
  updatedAt: z.string().datetime(),
  responses: z.array(SurveyResponseSchema),
  publication: z
    .object({
      token: z.string(),
      status: z.enum(["collecting", "closed"]),
      questions: z.array(SurveyWorkflowQuestionSchema),
      version: z.number().int().positive(),
      expiresAt: z.string().datetime(),
    })
    .nullable(),
  report: CompiledSurveyReportSchema.nullable(),
  reportBasisVersion: z.number().int().positive().nullable(),
  reportGeneratedAt: z.string().datetime().nullable(),
});
export type SurveyRuntime = z.infer<typeof SurveyRuntimeSchema>;
export type SurveyDraftInput = z.infer<typeof SurveyDraftInputSchema>;
export type SurveySubmissionInput = z.infer<typeof SurveySubmissionInputSchema>;

import { z } from "zod";
import {
  SurveyAnonymitySchema,
  SurveyPublishBlockerSchema,
  SurveyStatusSchema,
  SurveyWorkflowQuestionSchema,
  SurveyResponseSchema,
  SurveyAnswerValueSchema,
} from "./survey";
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
export const SurveyCreateCommandSchema = z
  .object({
    draft: SurveyDraftInputSchema,
    anonymity: SurveyAnonymitySchema.default("anonymous"),
  })
  .strict();
export const SurveySaveCommandSchema = z
  .object({
    expectedVersion: z.number().int().positive(),
    draft: SurveyDraftInputSchema,
    anonymity: SurveyAnonymitySchema.optional(),
    status: SurveyStatusSchema.optional(),
  })
  .strict();
export const SurveyVersionInputSchema = z
  .object({
    expectedVersion: z.number().int().positive(),
  })
  .strict();
export const SurveyPrepareCommandSchema = SurveyVersionInputSchema;
export const SurveyWithdrawCommandSchema = SurveyVersionInputSchema;
export const SurveyStartCollectionCommandSchema =
  SurveyVersionInputSchema;
export const SurveyCloseCommandSchema = SurveyVersionInputSchema;
export const SurveyPublishInputSchema = SurveyVersionInputSchema.extend({
  expiresAt: z.string().datetime().optional(),
});
export const SurveySubmissionInputSchema = z.object({
  submissionId: z.string().min(8).max(128),
  uploadSessionToken: z.string().min(1).max(512).optional(),
  answers: z
    .array(
      z.object({
        questionId: z.string().min(1),
        value: SurveyAnswerValueSchema,
      }),
    )
    .max(200),
  durationSeconds: z.number().int().nonnegative().max(604800).default(0),
  role: z.string().trim().min(1).max(200).default("未填写"),
  companySize: z.string().trim().min(1).max(200).default("未填写"),
});
const SurveyRuntimeBaseSchema = SurveyDraftInputSchema.extend({
  id: z.string(),
  version: z.number().int().positive(),
  status: SurveyStatusSchema,
  anonymity: SurveyAnonymitySchema,
  answerRevision: z.number().int().nonnegative().default(0),
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
  reportBasisAnswerRevision: z
    .number()
    .int()
    .nonnegative()
    .nullable()
    .default(null),
  reportGeneratedAt: z.string().datetime().nullable(),
});
export const SurveyRuntimeSchema = z.preprocess((input) => {
  if (!input || typeof input !== "object" || Array.isArray(input)) return input;
  const value = input as Record<string, unknown>;
  const publication =
    value.publication && typeof value.publication === "object"
      ? (value.publication as Record<string, unknown>)
      : null;
  return {
    ...value,
    status:
      value.status ??
      (publication?.status === "closed" ? "closed" : publication ? "collecting" : "draft"),
    anonymity: value.anonymity ?? "anonymous",
  };
}, SurveyRuntimeBaseSchema);
export const SurveyCommandResultSchema = z
  .object({
    survey: SurveyRuntimeSchema,
    blockers: z.array(SurveyPublishBlockerSchema).default([]),
  })
  .strict();
export type SurveyRuntime = z.infer<typeof SurveyRuntimeSchema>;
export type SurveyDraftInput = z.infer<typeof SurveyDraftInputSchema>;
export type SurveySubmissionInput = z.infer<typeof SurveySubmissionInputSchema>;
export type SurveyCreateCommand = z.infer<typeof SurveyCreateCommandSchema>;
export type SurveySaveCommand = z.infer<typeof SurveySaveCommandSchema>;
export type SurveyCommandResult = z.infer<typeof SurveyCommandResultSchema>;

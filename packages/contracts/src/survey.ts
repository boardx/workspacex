import { z } from "zod";

export const SurveyWorkflowStepSchema = z.enum(["design", "template", "publish", "responses", "report"]);
export const SurveyStatusSchema = z.enum(["draft", "ready", "collecting", "closed"]);
export const SurveyQuestionTypeSchema = z.enum(["single", "multi", "scale", "open"]);
export const SurveyResponseQualitySchema = z.enum(["normal", "review"]);
export const SurveyChartTypeSchema = z.enum(["gap-matrix", "capability-table", "grouped-bar", "line", "radar"]);

export const SurveyWorkflowQuestionSchema = z.object({
  id: z.string().min(1),
  order: z.number().int().positive(),
  chapterId: z.string(),
  type: SurveyQuestionTypeSchema,
  title: z.string().min(1),
  required: z.boolean(),
  options: z.array(z.string().min(1)).default([]),
});

export const SurveyReportSectionSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  managementQuestion: z.string(),
  method: z.string(),
  output: z.enum(["text", "chart", "image"]),
  chartType: SurveyChartTypeSchema.optional(),
});

export const SurveyResponseSchema = z.object({
  id: z.string().min(1),
  submitter: z.string().optional(),
  role: z.string().min(1),
  companySize: z.string().min(1),
  quality: SurveyResponseQualitySchema,
  submittedAt: z.string().datetime(),
  durationSeconds: z.number().int().nonnegative(),
  answers: z.array(z.object({ questionId: z.string().min(1), value: z.union([z.string(), z.array(z.string())]) })),
});

export const SurveyWorkflowSchema = z.object({
  survey: z.object({
    id: z.string().min(1), title: z.string().min(1), status: SurveyStatusSchema, lastSavedAt: z.string().datetime(),
  }),
  questions: z.array(SurveyWorkflowQuestionSchema),
  reportTemplate: z.object({ sections: z.array(SurveyReportSectionSchema) }),
  publication: z.object({ target: z.number().int().positive(), link: z.string().url() }),
  responses: z.array(SurveyResponseSchema),
  report: z.object({
    generatedAt: z.string().datetime(),
    sections: z.array(z.object({ id: z.string(), title: z.string(), body: z.string() })),
  }),
}).superRefine((model, ctx) => {
  const questionIds = new Set(model.questions.map((question) => question.id));
  for (const [responseIndex, response] of model.responses.entries()) {
    for (const [answerIndex, answer] of response.answers.entries()) {
      if (!questionIds.has(answer.questionId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Unknown question: ${answer.questionId}`,
          path: ["responses", responseIndex, "answers", answerIndex, "questionId"],
        });
      }
    }
  }
});

export type SurveyWorkflowStep = z.infer<typeof SurveyWorkflowStepSchema>;
export type SurveyWorkflowModel = z.infer<typeof SurveyWorkflowSchema>;
export type SurveyWorkflowQuestion = z.infer<typeof SurveyWorkflowQuestionSchema>;
export type SurveyChartType = z.infer<typeof SurveyChartTypeSchema>;
export type SurveyResponse = z.infer<typeof SurveyResponseSchema>;

import { z } from "zod";

export const SurveyWorkflowStepSchema = z.enum([
  "design",
  "template",
  "publish",
  "responses",
  "report",
]);
export const SurveyStatusSchema = z.enum([
  "draft",
  "ready",
  "collecting",
  "closed",
]);
export const SurveyAnonymitySchema = z.enum(["anonymous", "identified"]);
export const SurveyPublishBlockerCodeSchema = z.enum([
  "QUESTIONS_EMPTY",
  "QUESTION_OPTIONS_EMPTY",
  "MAPPING_INCOMPLETE",
  "LEADING_QUESTION",
]);
export const SurveyPublishBlockerSchema = z
  .object({
    code: SurveyPublishBlockerCodeSchema,
    side: z.enum(["survey", "question", "section"]),
    subjectId: z.string().min(1),
    missingFields: z.array(z.string().min(1)),
  })
  .strict();
export const SurveyCommandErrorCodeSchema = z.enum([
  "ANONYMITY_IMMUTABLE",
  "STATUS_COMMAND_REQUIRED",
  "INVALID_TRANSITION",
  "SURVEY_VERSION_CONFLICT",
  "SURVEY_PUBLISH_BLOCKED",
]);
import {
  SurveyWorkflowQuestionSchema,
  SurveyAnswerValueSchema,
} from "./survey-question-types";
export * from "./survey-question-types";
export const SurveyResponseQualitySchema = z.enum(["normal", "review"]);
export const SurveyChartTypeSchema = z.enum([
  "gap-matrix",
  "capability-table",
  "grouped-bar",
  "line",
  "radar",
]);

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
  answers: z.array(
    z.object({ questionId: z.string().min(1), value: SurveyAnswerValueSchema }),
  ),
});

export const SurveyWorkflowSchema = z
  .object({
    survey: z.object({
      id: z.string().min(1),
      title: z.string().min(1),
      status: SurveyStatusSchema,
      lastSavedAt: z.string().datetime(),
    }),
    questions: z.array(SurveyWorkflowQuestionSchema),
    reportTemplate: z.object({ sections: z.array(SurveyReportSectionSchema) }),
    publication: z.object({
      target: z.number().int().positive(),
      link: z.string().url(),
    }),
    responses: z.array(SurveyResponseSchema),
    report: z.object({
      generatedAt: z.string().datetime(),
      sections: z.array(
        z.object({ id: z.string(), title: z.string(), body: z.string() }),
      ),
    }),
  })
  .superRefine((model, ctx) => {
    const questionIds = new Set(model.questions.map((question) => question.id));
    for (const [responseIndex, response] of model.responses.entries()) {
      for (const [answerIndex, answer] of response.answers.entries()) {
        if (!questionIds.has(answer.questionId)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Unknown question: ${answer.questionId}`,
            path: [
              "responses",
              responseIndex,
              "answers",
              answerIndex,
              "questionId",
            ],
          });
        }
      }
    }
  });

export type SurveyWorkflowStep = z.infer<typeof SurveyWorkflowStepSchema>;
export type SurveyWorkflowModel = z.infer<typeof SurveyWorkflowSchema>;
export type SurveyStatus = z.infer<typeof SurveyStatusSchema>;
export type SurveyAnonymity = z.infer<typeof SurveyAnonymitySchema>;
export type SurveyPublishBlocker = z.infer<
  typeof SurveyPublishBlockerSchema
>;

export type SurveyChartType = z.infer<typeof SurveyChartTypeSchema>;
export type SurveyResponse = z.infer<typeof SurveyResponseSchema>;

export * from "./survey-report";

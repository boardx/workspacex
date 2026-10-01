import { z } from "zod";
import { DigitalInterviewReportReview, operations } from "./interview";

// Reuse existing review domain codes; access-denial remains indistinguishable 404.
export const InterviewMarkdownReportReviewErrorCode = z.enum(operations.reviewDigitalInterviewReport.err)
  .exclude(["NO_INTERVIEW_ACCESS", "DEPENDENCY_UNAVAILABLE"]);

export const InterviewMarkdownReportReview = DigitalInterviewReportReview.omit({ reportId: true }).extend({
  documentId: z.string().min(1),
  documentVersion: z.number().int().positive(),
  contentHash: z.string().regex(/^[a-f0-9]{64}$/u),
  status: DigitalInterviewReportReview.shape.status.exclude(["pending"]),
  reviewedBy: z.string().min(1),
  reviewedAt: z.string().datetime(),
}).strict();
export type InterviewMarkdownReportReview = z.infer<typeof InterviewMarkdownReportReview>;
export const SubmitInterviewMarkdownReportReview = InterviewMarkdownReportReview.omit({ reviewId: true, reviewedBy: true, reviewedAt: true }).extend({
  expectedVersion: z.number().int().positive(),
  requestId: z.string().min(1).max(200),
}).strict();
export type SubmitInterviewMarkdownReportReview = z.infer<typeof SubmitInterviewMarkdownReportReview>;
export const InterviewMarkdownReportReviewResult = z.object({ review: InterviewMarkdownReportReview, version: z.number().int().positive() }).strict();
export type InterviewMarkdownReportReviewResult = z.infer<typeof InterviewMarkdownReportReviewResult>;

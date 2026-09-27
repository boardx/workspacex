import type { InterviewMarkdownReportReviewResult, SubmitInterviewMarkdownReportReview } from "@repo/contracts/interview-markdown-report-review";
import type { OrgId } from "../../domain/org-id";
import type { Guarded } from "../security/permission-filter";
export interface InterviewMarkdownReportReviewRepository {
  submit(input: SubmitInterviewMarkdownReportReview & { orgId: OrgId; interviewId: string; actorId: string }): Promise<Guarded<InterviewMarkdownReportReviewResult>>;
}
export const INTERVIEW_MARKDOWN_REPORT_REVIEW_REPOSITORY = Symbol("InterviewMarkdownReportReviewRepository");

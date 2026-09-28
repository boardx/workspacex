import { BadRequestException, Body, ConflictException, Controller, Inject, NotFoundException, Param, Post } from "@nestjs/common";
import { InterviewMarkdownReportReviewResult, SubmitInterviewMarkdownReportReview } from "@repo/contracts/interview-markdown-report-review";
import { INTERVIEW_MARKDOWN_REPORT_REVIEW_REPOSITORY, type InterviewMarkdownReportReviewRepository } from "../../application/interview/interview-markdown-report-review.port";
import { DIGITAL_INTERVIEW_REPOSITORY, type DigitalInterviewRepository } from "../../application/interview/digital-interview-ports";
import { INTERVIEW_SCOPE_REPOSITORY, type InterviewScopeRepository } from "../../application/interview/ports";
import { DECISION_ID_FACTORY, type DecisionIdFactory } from "../../application/identity/ports";
import { reviewInterviewMarkdownReport } from "../../application/interview/review-interview-markdown-report";
import { DigitalInterviewWorkflowError } from "../../application/interview/workflow/digital-interview-runtime.port";
import { NoInterviewAccessError } from "../../application/interview/errors";
import { toOrgId } from "../../domain/org-id";
import { assertPrincipal, type Principal } from "../../domain/principal";
import { CurrentPrincipal } from "../current-principal.decorator";

@Controller("/interviews/digital")
export class InterviewMarkdownReportReviewController {
  constructor(
    @Inject(INTERVIEW_MARKDOWN_REPORT_REVIEW_REPOSITORY) private readonly reviews: InterviewMarkdownReportReviewRepository,
    @Inject(DIGITAL_INTERVIEW_REPOSITORY) private readonly repo: DigitalInterviewRepository,
    @Inject(INTERVIEW_SCOPE_REPOSITORY) private readonly scope: InterviewScopeRepository,
    @Inject(DECISION_ID_FACTORY) private readonly decisions: DecisionIdFactory,
  ) {}
  @Post("/:interviewId/markdown/report/review")
  async submit(@CurrentPrincipal() principal: Principal, @Param("interviewId") interviewId: string, @Body() body: unknown) {
    assertPrincipal(principal);
    const input = SubmitInterviewMarkdownReportReview.safeParse(body);
    if (!input.success) throw new BadRequestException({ reasonCode: "DIGITAL_INTERVIEW_INPUT_INVALID" });
    try {
      return InterviewMarkdownReportReviewResult.parse(await reviewInterviewMarkdownReport({ repo: this.repo, scope: this.scope, decisions: this.decisions, reviews: this.reviews },
        { ...input.data, orgId: toOrgId(principal.orgId), actorId: principal.userId, interviewId }));
    } catch (error) {
      if (error instanceof NoInterviewAccessError || error instanceof DigitalInterviewWorkflowError && error.code === "NO_INTERVIEW_ACCESS") throw new NotFoundException();
      if (error instanceof DigitalInterviewWorkflowError) throw new ConflictException({ reasonCode: error.code });
      throw error;
    }
  }
}

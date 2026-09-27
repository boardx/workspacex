import type { SubmitInterviewMarkdownReportReview } from "@repo/contracts/interview-markdown-report-review";
import type { OrgId } from "../../domain/org-id";
import { discloseDecided, isDisclosed } from "../security/permission-filter";
import { authorizeDigitalInterview, type GetDigitalInterviewDeps } from "./get-digital-interview";
import { NoInterviewAccessError } from "./errors";
import type { InterviewMarkdownReportReviewRepository } from "./interview-markdown-report-review.port";

export async function reviewInterviewMarkdownReport(deps: GetDigitalInterviewDeps & { reviews: InterviewMarkdownReportReviewRepository },
  input: SubmitInterviewMarkdownReportReview & { orgId: OrgId; interviewId: string; actorId: string }) {
  const actor = { orgId: input.orgId, interviewId: input.interviewId, viewerUserId: input.actorId };
  await authorizeDigitalInterview(deps, actor);
  const saved = await deps.reviews.submit(input);
  const authorized = await authorizeDigitalInterview(deps, actor);
  const disclosed = discloseDecided(saved, authorized.decision);
  if (!isDisclosed(disclosed)) throw new NoInterviewAccessError(input.interviewId);
  return disclosed.payload;
}

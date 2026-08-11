import { decideInterviewVisibility } from "../../domain/interview/visibility-decision";
import type { OrgRole } from "../../domain/identity/roles";
import type { OrgId } from "../../domain/org-id";
import type { DecisionIdFactory } from "../identity/ports";
import { discloseDecided, isDisclosed } from "../security/permission-filter";
import type { DigitalInterviewRepository, StoredDigitalInterview } from "./digital-interview-ports";
import { NoInterviewAccessError } from "./errors";
import type { InterviewScopeRepository } from "./ports";

export interface GetDigitalInterviewDeps {
  readonly repo: DigitalInterviewRepository;
  readonly scope: InterviewScopeRepository;
  readonly decisions: DecisionIdFactory;
}

export async function getDigitalInterview(
  deps: GetDigitalInterviewDeps,
  input: { readonly orgId: OrgId; readonly viewerUserId: string; readonly interviewId: string },
): Promise<StoredDigitalInterview> {
  const found = await deps.repo.findVisibleById(input.orgId, input.viewerUserId, input.interviewId);
  if (found !== null) {
    const [projectIds, membership] = await Promise.all([
      deps.scope.projectIdsOf(input.orgId, input.viewerUserId),
      deps.scope.orgMembershipOf(input.orgId, input.viewerUserId),
    ]);
    const disclosed = discloseDecided(
      found.item,
      decideInterviewVisibility({
        decisionId: deps.decisions.next(),
        interview: found.facts,
        viewer: { userId: input.viewerUserId, projectIds },
        orgRole: membership.orgRole as OrgRole | null,
        viewerTeamId: membership.teamId,
      }),
    );
    if (isDisclosed(disclosed)) return disclosed.payload;
  }
  throw new NoInterviewAccessError(input.interviewId);
}

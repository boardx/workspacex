import type { OrgId } from "../../domain/org-id";
import {
  canTransitionDigitalInterview,
  type DigitalInterviewStatusName,
} from "../../domain/interview/digital-interview";
import {
  DigitalInterviewConcurrentModificationError,
  DigitalInterviewStepInvalidError,
} from "./errors";
import type { StoredDigitalInterview } from "./digital-interview-ports";
import { getDigitalInterview, type GetDigitalInterviewDeps } from "./get-digital-interview";

export async function transitionDigitalInterviewStatus(
  deps: GetDigitalInterviewDeps,
  input: {
    readonly orgId: OrgId;
    readonly actorId: string;
    readonly interviewId: string;
    readonly expectedVersion: number;
    readonly toStatus: DigitalInterviewStatusName;
  },
): Promise<StoredDigitalInterview> {
  const current = await getDigitalInterview(deps, {
    orgId: input.orgId,
    viewerUserId: input.actorId,
    interviewId: input.interviewId,
  });
  if (current.version !== input.expectedVersion) {
    throw new DigitalInterviewConcurrentModificationError(input.interviewId);
  }
  if (!canTransitionDigitalInterview(current.status, input.toStatus)) {
    throw new DigitalInterviewStepInvalidError(current.status, input.toStatus);
  }

  await deps.repo.updateStatus({
    orgId: input.orgId,
    interviewId: input.interviewId,
    expectedVersion: input.expectedVersion,
    fromStatus: current.status,
    toStatus: input.toStatus,
  });
  const updated = await getDigitalInterview(deps, {
    orgId: input.orgId,
    viewerUserId: input.actorId,
    interviewId: input.interviewId,
  });
  if (updated.version !== input.expectedVersion + 1 || updated.status !== input.toStatus) {
    throw new DigitalInterviewConcurrentModificationError(input.interviewId);
  }
  return updated;
}

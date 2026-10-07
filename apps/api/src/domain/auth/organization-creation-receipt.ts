import type { PermissionDecision } from "../identity/permission-decision";
/** A creation receipt is disclosed only to its creator for the same retry request.
 * This grants no content access to any tenant, even if membership later changes. */
export function decideOrganizationCreationReceipt(input: {
  readonly decisionId: string;
  readonly requesterId: string;
  readonly requestId: string;
  readonly creatorId: string;
  readonly receiptRequestId: string;
}): PermissionDecision {
  const allowed = input.requesterId === input.creatorId && input.requestId === input.receiptRequestId;
  return {
    allowed, decisionId: input.decisionId,
    orgLayer: { role: null, teamId: null, passed: allowed },
    projectLayer: null,
    scopeLayer: { scope: "org-wide", passed: allowed },
    reasonCode: allowed ? null : "NO_ORG_MEMBERSHIP",
  };
}

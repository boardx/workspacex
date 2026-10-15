import type { PermissionDecision } from "../identity/permission-decision";

/** A bearer capability applies only to a separate, explicitly published snapshot.
 * It never authorizes reading the source thread or joining its organization. */
export function decideSharedSnapshot(input: {
  tokenMatches: boolean; revoked: boolean; decisionId: string;
}): PermissionDecision {
  const allowed = input.tokenMatches && !input.revoked;
  return {
    allowed, orgLayer: { role: null, teamId: null, passed: allowed },
    projectLayer: null, scopeLayer: { scope: "org-wide", passed: allowed },
    reasonCode: allowed ? null : "ORG_SCOPE_DENIED", decisionId: input.decisionId,
  };
}

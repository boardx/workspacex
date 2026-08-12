import type { PermissionDecision } from "../identity/permission-decision";

export function decideGuidedResearchVisibility(input: {
  decisionId: string;
  ownerUserId: string;
  viewerUserId: string;
  isExplicitCollaborator: boolean;
}): PermissionDecision {
  const allowed = input.ownerUserId === input.viewerUserId || input.isExplicitCollaborator;
  return {
    allowed,
    orgLayer: { role: null, teamId: null, passed: true },
    projectLayer: null,
    scopeLayer: { scope: "org-wide", passed: true },
    reasonCode: allowed ? null : "NO_PROJECT_ROLE",
    decisionId: input.decisionId,
  };
}

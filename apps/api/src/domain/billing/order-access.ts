import type { PermissionDecision } from "../identity/permission-decision";
import type { OrgRole } from "../identity/roles";
/** Billing owners have no project/ACL binding; a platform role never substitutes for team membership. */
export function decideOrderOwner(input: {
  decisionId: string; ownerType: "user" | "team"; ownerId: string; userId: string;
  orgRole: OrgRole | null; teamId: string | null; requiresAdmin: boolean;
}): PermissionDecision {
  const allowed = input.ownerType === "user" ? input.ownerId === input.userId
    : input.orgRole !== null && (!input.requiresAdmin || input.orgRole === "admin");
  return { decisionId: input.decisionId, allowed,
    orgLayer: { role: input.orgRole, teamId: input.teamId, passed: allowed }, projectLayer: null,
    scopeLayer: { scope: "org-wide", passed: allowed }, reasonCode: allowed ? null : "NO_ORG_MEMBERSHIP" };
}

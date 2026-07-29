/**
 * The role vocabulary. Innermost layer.
 *
 * ## Why these are DERIVED from `@repo/contracts` rather than declared here
 *
 * `OrgRole` / `ProjectRole` / `VisibilityScope` / `PermissionReason` already exist as zod
 * enums in the contract, because the frontend renders against them. Declaring them again
 * here would be a second copy of the same fact -- the failure mode this project has hit
 * six times. `lint-contract-source` would flag it, and it would be right to.
 *
 * Importing a pure vocabulary package inward is not a layering violation: `@repo/contracts`
 * has no I/O, no framework and no infrastructure -- it is a shared type dictionary, closer
 * to a language primitive than to an outer layer. What the onion forbids is the domain
 * knowing about HTTP or PostgreSQL, and it still does not.
 */
import { identity } from "@repo/contracts";
import type { z } from "zod";

export type OrgRole = z.infer<typeof identity.OrgRole>;
export type ProjectRole = z.infer<typeof identity.ProjectRole>;
export type VisibilityScope = z.infer<typeof identity.VisibilityScope>;
export type PermissionReason = z.infer<typeof identity.PermissionReason>;

export const ORG_ROLES = identity.OrgRole.options;
/**
 * Exactly four, permanently (O-03).
 *
 * "Co-facilitator" is a SECOND FACILITATOR INSTANCE with identical permissions, one of whom
 * is marked host and holds final say. "Researcher" / "participant" are display aliases for
 * facilitator / member in interview and survey contexts and never reach storage.
 * "Interviewee" holds no project role at all -- it is a one-time token identity.
 *
 * Each of those was proposed at some point as a fifth role. Accepting any one of them turns
 * authorization from a two-way intersection into a three-way one and the test matrix from
 * 4x3 into 4x3xN, which is why the count is asserted rather than assumed.
 */
export const PROJECT_ROLES = identity.ProjectRole.options;

export function isOrgRole(v: unknown): v is OrgRole {
  return identity.OrgRole.safeParse(v).success;
}
export function isProjectRole(v: unknown): v is ProjectRole {
  return identity.ProjectRole.safeParse(v).success;
}

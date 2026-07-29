/**
 * The two-layer intersection. This function IS feature F01.
 *
 * Pure: no clock, no randomness, no I/O. `decisionId` is supplied by the caller precisely
 * so this stays pure and therefore exhaustively testable.
 *
 * ## The shape of the rule (UC-0.3 R3/R4)
 *
 *   org layer     -- "may you use this resource at all"
 *   project layer -- "inside this session, what may you see and do"
 *
 * Either one failing denies. They do not substitute for each other, which is the entire
 * point of AC1: an org admin with no project role does not read project content by virtue
 * of being an admin.
 *
 * ## What a denial has to say
 *
 * A bare `allowed: false` is not usable. R4 E3 requires that a team-scoped denial states it
 * came from the ORG layer, not the project layer -- otherwise the user goes looking for a
 * project role they already have. So every decision carries both layers' verdicts, and
 * `reasonCode` names which one closed the door.
 *
 * ## What a denial must NOT say
 *
 * Nothing about whether the resource exists. `NO_PROJECT_ROLE` and "no such project" have
 * to be indistinguishable from outside (identity usecases.md), which is why this function
 * never takes a "resource exists" flag: it cannot leak what it was never told.
 */
import { identity } from "@repo/contracts";
import type { z } from "zod";
import type { OrgRole, PermissionReason, ProjectRole, VisibilityScope } from "./roles";
import { isKnownAction, roleAllows } from "./project-role-matrix";

export interface OrgLayerInput {
  /** null = not a member of this organization */
  readonly role: OrgRole | null;
  /** Single team membership per org (O-12) */
  readonly teamId: string | null;
}

export interface ProjectLayerInput {
  /** null = holds no role in this project. That is a NORMAL state, not an error (I-11). */
  readonly role: ProjectRole | null;
  readonly groupId: string | null;
  /** One facilitator instance among several may hold final say (O-03) */
  readonly isHost?: boolean;
}

export interface ScopeInput {
  readonly scope: VisibilityScope;
  /** Which team owns a team-only resource. Meaningless for org-wide. */
  readonly ownerTeamId: string | null;
}

export interface DecisionInput {
  readonly decisionId: string;
  readonly action: string;
  readonly org: OrgLayerInput;
  /**
   * null = there is no project context for this request.
   *
   * Not the same as "has no project role". Without project context the project layer does
   * not apply at all and the decision's `projectLayer` is null (invariant I-11) -- which is
   * what stops project-layer identity from being rendered on non-project screens.
   */
  readonly project: ProjectLayerInput | null;
  readonly scope: ScopeInput;
}

/**
 * The decision object. DERIVED from the contract, never restated.
 *
 * `lint-contract-source` catches a second definition, and when it caught this one it was
 * right to: an `interface PermissionDecision` here plus a zod `PermissionDecision` in the
 * contract is two declarations of one fact.
 *
 * Deriving it also surfaced a real defect in the contract as signed -- both layers declared
 * `role` non-nullable while the failure enum's very first entry is `NO_ORG_MEMBERSHIP`, a
 * verdict that has no role to report. See the note in `packages/contracts/src/identity.ts`.
 */
export type PermissionDecision = z.infer<typeof identity.PermissionDecision>;

/**
 * Sentinel owning team for "no single team can satisfy every source" (see strictestScope).
 * Deliberately not a real team id, and deliberately not null -- null reads as org-wide,
 * which is the loosest answer to a question whose answer is the strictest.
 */
export const UNSATISFIABLE_TEAM = "__unsatisfiable__";

export function decide(input: DecisionInput): PermissionDecision {
  const { org, project, scope, action, decisionId } = input;

  const orgPassed = org.role !== null;
  // A team-only resource requires the requester to be in the owning team. This is an ORG
  // layer check even though it reads like a resource attribute, because team membership is
  // an org-level fact -- and saying so is what makes the denial actionable (R4 E3).
  const scopePassed =
    scope.scope === "org-wide" || (org.teamId !== null && org.teamId === scope.ownerTeamId);

  const orgLayer = { role: org.role, teamId: org.teamId, passed: orgPassed && scopePassed };
  const scopeLayer = { scope: scope.scope, passed: scopePassed };

  // Invariant I-11: no project context => the project layer does not apply.
  const projectLayer =
    project === null
      ? null
      : {
          role: project.role,
          groupId: project.groupId,
          passed: project.role !== null && isKnownAction(action) && roleAllows(project.role, action),
        };

  const deny = (reasonCode: PermissionReason): PermissionDecision => ({
    allowed: false, orgLayer, projectLayer, scopeLayer, reasonCode, decisionId,
  });

  if (!orgPassed) return deny("NO_ORG_MEMBERSHIP");
  if (!scopePassed) return deny("ORG_SCOPE_DENIED");

  if (project !== null && projectLayer !== null && !projectLayer.passed) {
    if (project.role === null) {
      // Admins and compliance officers get a DIFFERENT code here, not a different outcome.
      // The outcome is identical -- that is D-18 and AC1. The code exists because "you are
      // an admin and that is why this is still denied" is the single most likely thing for
      // someone to file as a bug (identity usecases.md ADMIN_NOT_SUPERUSER).
      return deny(
        org.role === "admin" || org.role === "compliance" ? "ADMIN_NOT_SUPERUSER" : "NO_PROJECT_ROLE",
      );
    }
    // Role present, action out of reach. Also covers unknown actions: an action nobody
    // declared is denied, never waved through.
    return deny("PROJECT_ROLE_INSUFFICIENT");
  }

  return { allowed: true, orgLayer, projectLayer, scopeLayer, reasonCode: null, decisionId };
}

/**
 * Invariant I-7: a resource reachable through several sources takes the STRICTEST of them.
 *
 * Not the loosest, and not the union. Both of those are the intuitive answer when you think
 * of permissions as capabilities you accumulate -- and both leak: an item visible to one
 * team, combined into a derived artifact with an org-wide item, must not become org-wide.
 */
export function strictestScope(scopes: readonly ScopeInput[]): ScopeInput {
  const teamOnly = scopes.filter((s) => s.scope === "team-only");
  if (teamOnly.length === 0) return { scope: "org-wide", ownerTeamId: null };
  // Several distinct owning teams means no single team satisfies all sources. The strictest
  // reading is "nobody", represented by an owning team that cannot be matched.
  const owners = new Set(teamOnly.map((s) => s.ownerTeamId));
  return owners.size === 1
    ? { scope: "team-only", ownerTeamId: [...owners][0] ?? null }
    : { scope: "team-only", ownerTeamId: UNSATISFIABLE_TEAM };
}

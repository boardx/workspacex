/**
 * `RenderRoleView` -- F04, UC-1.4 R3/R5/R8: one screen, clipped by project role.
 *
 * ## Why this never throws (contract `err: []`)
 *
 * Same reasoning as the rest of the identity bundle (`authorize()`'s header): "why was I
 * shown this much" has to be recoverable data, not an exception that discards it. An
 * unauthenticated / role-less request gets `allowed: false` back with empty `visibleBlocks`
 * / `actionEndpoints` and a `NO_PROJECT_ROLE` reason -- the caller renders a no-permission
 * state (V10), not an error page.
 *
 * ## Why `visibleBlocks` / `actionEndpoints` come from the matrix, not from `decision`
 *
 * `decision` answers ONE question (`ROLE_VIEW_GATE_ACTION`, the weakest read every role
 * holds) -- it is not, itself, the per-block breakdown. Once the gate says the requester
 * holds project role R, the projection for R is looked up directly from the matrix
 * (`role-view.ts`), which is the single source for "what may role R see/do" (`no-frontend-copy`
 * in the F01 tests guards that source being singular).
 */
import { skeletonFor, visibleBlocksFor, actionEndpointsFor, ROLE_VIEW_GATE_ACTION } from "../../domain/identity/role-view";
import type { OrgId } from "../../domain/org-id";
import { authorize, type AuthorizeDeps } from "../identity/authorize";

export interface RenderRoleViewInput {
  readonly userId: string;
  readonly orgId: OrgId;
  readonly projectId: string;
  readonly screen: string;
}

export async function renderRoleView(deps: AuthorizeDeps, input: RenderRoleViewInput) {
  const decision = await authorize(deps, {
    userId: input.userId,
    orgId: input.orgId,
    projectId: input.projectId,
    object: { kind: "project", id: input.projectId },
    action: ROLE_VIEW_GATE_ACTION,
  });

  const role = decision.allowed ? decision.projectLayer?.role ?? null : null;

  return {
    // AC1: the skeleton is identical no matter what `role` came back -- only the two lists
    // below vary. There is no branch here that swaps `screen` or `slots` by role.
    skeleton: skeletonFor(input.screen),
    // AC2/AC3: whitelists. `role === null` (no project role, or denied) yields `[]` for
    // both -- the keys are always present (contract requires arrays, not optional fields),
    // but the CONTENTS never include a block/button the requester has no matrix entry for.
    visibleBlocks: role === null ? [] : visibleBlocksFor(role),
    actionEndpoints: role === null ? [] : actionEndpointsFor(role),
    roleBanner: {
      orgRole: decision.orgLayer.role,
      // No team-directory port exists yet to resolve a team id to a display name; inventing
      // one here would be exactly the kind of unreviewed field this codebase's culture
      // flags (see `ProjectController`'s header on `provenanceEventId`). Left `null` and
      // named here as an open gap rather than silently faked.
      teamName: null,
      projectRole: role,
      groupLabel: decision.projectLayer?.groupId ?? null,
    },
    decision,
  };
}

/**
 * `Authorize` and `AuthorizeBatch` -- the two-layer intersection, wired to storage.
 *
 * Neither throws. Authorization is EXPLAINABLE DATA, not an exception: "why was I allowed /
 * denied" has to be recoverable afterwards (UC-0.3 R6), and an exception discards exactly
 * that. The only thing that throws here is the auth dependency being unavailable, and it
 * throws rather than returning a denial so that nobody can mistake an outage for a verdict.
 */
import {
  decide,
  strictestScope,
  type PermissionDecision,
  type ScopeInput,
} from "../../domain/identity/permission-decision";
import type { OrgId } from "../../domain/org-id";
import type { DecisionIdFactory, IdentityRepository, ObjectRef } from "./ports";

export interface AuthorizeDeps {
  readonly repo: IdentityRepository;
  readonly ids: DecisionIdFactory;
}

export interface AuthorizeInput {
  readonly userId: string;
  readonly orgId: OrgId;
  readonly projectId?: string;
  readonly object: ObjectRef;
  readonly action: string;
}

const keyOf = (o: ObjectRef): string => `${o.kind}:${o.id}`;

/**
 * An object with no binding row is treated as `org-wide`.
 *
 * That is the loosest default and it deserves justification: bindings describe RESTRICTIONS
 * on top of org membership, and the org layer has already been checked by the time this
 * matters. Defaulting to team-only instead would deny every object nobody has scoped yet,
 * i.e. all of them, which pushes implementers toward disabling the check. The real
 * containment is that the org layer and RLS both run regardless.
 */
const DEFAULT_SCOPE: ScopeInput = { scope: "org-wide", ownerTeamId: null };

export async function authorize(deps: AuthorizeDeps, input: AuthorizeInput): Promise<PermissionDecision> {
  const [d] = await authorizeBatch(deps, {
    userId: input.userId,
    orgId: input.orgId,
    projectId: input.projectId,
    objects: [input.object],
    action: input.action,
  });
  return d!;
}

export interface AuthorizeBatchInput {
  readonly userId: string;
  readonly orgId: OrgId;
  readonly projectId?: string;
  readonly objects: readonly ObjectRef[];
  readonly action: string;
}

/**
 * Batch judgement. Returned array is the same length and ORDER as `objects`, so callers
 * never have to match by id -- matching by id is where an off-by-one silently pairs one
 * item's content with another item's verdict.
 *
 * Membership is read ONCE for the whole batch, which is the point: the identity of the
 * requester does not vary per object, only the object's scope does.
 */
export async function authorizeBatch(
  deps: AuthorizeDeps,
  input: AuthorizeBatchInput,
): Promise<PermissionDecision[]> {
  const { repo, ids } = deps;
  const { userId, orgId, projectId, objects, action } = input;

  const orgMembership = await repo.findOrgMembership(userId, orgId);
  const projectMembership =
    projectId === undefined ? null : await repo.findProjectMembership(userId, projectId, orgId);

  const bindings = await repo.findBindings(orgId, objects);

  return objects.map((object) =>
    decide({
      decisionId: ids.next(),
      action,
      org: { role: orgMembership?.orgRole ?? null, teamId: orgMembership?.teamId ?? null },
      // undefined projectId => no project context at all => projectLayer is null (I-11).
      // Present projectId with no membership => context exists, role is null. The
      // difference matters: the first is "not a project screen", the second is "denied".
      project:
        projectId === undefined
          ? null
          : {
              role: projectMembership?.projectRole ?? null,
              groupId: projectMembership?.groupId ?? null,
              isHost: projectMembership?.isHost ?? false,
            },
      scope: bindings.get(keyOf(object)) ?? DEFAULT_SCOPE,
    }),
  );
}

/**
 * Judge an object that is reachable through several sources (invariant I-7).
 *
 * Used by derived artifacts: a Context Pack item assembled from two sources takes the
 * strictest of them, never the union.
 */
export async function authorizeDerived(
  deps: AuthorizeDeps,
  input: AuthorizeBatchInput & { readonly sources: readonly ObjectRef[] },
): Promise<PermissionDecision> {
  const { repo, ids } = deps;
  const orgMembership = await repo.findOrgMembership(input.userId, input.orgId);
  const projectMembership =
    input.projectId === undefined
      ? null
      : await repo.findProjectMembership(input.userId, input.projectId, input.orgId);
  const bindings = await repo.findBindings(input.orgId, input.sources);
  const scopes = input.sources.map((s) => bindings.get(keyOf(s)) ?? DEFAULT_SCOPE);

  return decide({
    decisionId: ids.next(),
    action: input.action,
    org: { role: orgMembership?.orgRole ?? null, teamId: orgMembership?.teamId ?? null },
    project:
      input.projectId === undefined
        ? null
        : {
            role: projectMembership?.projectRole ?? null,
            groupId: projectMembership?.groupId ?? null,
            isHost: projectMembership?.isHost ?? false,
          },
    scope: strictestScope(scopes),
  });
}

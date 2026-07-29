/**
 * `SwitchOrganization` (O-12).
 *
 * The post-effects are part of the CONTRACT, not implementation detail -- the contract file
 * says so explicitly. That phrasing exists because the obvious implementation (change
 * currentOrgId, return the new org) passes every naive test while leaving the previous
 * organization's project context and cached verdicts in place. The user then sees org B's
 * shell around org A's data, and nothing anywhere reports an error.
 *
 * So this use case does three things, each separately assertable:
 *   1. clear ALL project-scoped context
 *   2. invalidate every cached authorization decision for this user
 *   3. re-resolve identity against the NEW organization
 */
import type {
  AuthorizationCache,
  DecisionIdFactory,
  IdentityRepository,
  OrganizationRow,
  SessionStore,
} from "./ports";
import type { OrgId } from "../../domain/org-id";
import type { CapabilityListing } from "../../domain/identity/capability-listing";
import type { CapabilityRepository } from "./capability-ports";
import { listCapabilities } from "./list-capabilities";

/** One declaration, seen from two places -- see `errors.ts`. */
export { NoOrgMembershipError } from "./errors";
import { NoOrgMembershipError } from "./errors";

export interface SwitchOrgDeps {
  readonly repo: IdentityRepository;
  readonly sessions: SessionStore;
  readonly cache: AuthorizationCache;
  readonly capabilities: CapabilityRepository;
  readonly ids: DecisionIdFactory;
}

export interface SwitchOrgResult {
  readonly org: OrganizationRow;
  /**
   * The NEW organization's entire configuration, and nothing from the old one (F15 / R3 5).
   *
   * Resolved here rather than left for the client to fetch afterwards, because the contract
   * makes "the previous organization's agents/skills/models/MCPs do not come across" a
   * post-effect of THIS operation. A client that had to ask separately would render the
   * previous list for however long that request took, which is the visible form of the bug.
   *
   * `[]` for an organization with nothing configured -- never a built-in default (V1). The
   * emptiness is not produced here; it is what an unconfigured organization has.
   */
  readonly capabilities: readonly CapabilityListing[];
}

export async function switchOrganization(
  deps: SwitchOrgDeps,
  input: { readonly userId: string; readonly toOrgId: OrgId },
): Promise<SwitchOrgResult> {
  const { repo, sessions, cache } = deps;
  const { userId, toOrgId } = input;

  const membership = await repo.findOrgMembership(userId, toOrgId);
  if (membership === null) throw new NoOrgMembershipError();

  const org = await repo.findOrganization(toOrgId);
  // Membership without an organization row is inconsistent data. R4 E4 says treat
  // inconsistency as DENY and raise -- never fall back to something permissive.
  if (org === null) throw new NoOrgMembershipError();

  // Order matters: clear first, then switch. Switching first leaves a window in which the
  // new org id is current while the old project context is still readable.
  await sessions.clearProjectScoped(userId);
  await cache.invalidateUser(userId);
  await sessions.setOrg(userId, toOrgId);

  // Resolved AFTER the cache is invalidated and the org is switched, so nothing here can be
  // served from a verdict made under the previous organization (O-12 post-effect ③).
  const { visible } = await listCapabilities(
    { repo, capabilities: deps.capabilities, ids: deps.ids },
    { userId, orgId: toOrgId },
  );

  return { org: { ...org, team: membership.teamId }, capabilities: visible };
}

export interface ResolvedIdentity {
  readonly org: OrganizationRow;
  readonly orgRole: string;
  readonly teamId: string | null;
  readonly projectRole: string | null;
  readonly groupId: string | null;
}

/** `ResolveIdentity` -- the two layers of the current identity (I-11 for the project half). */
export async function resolveIdentity(
  repo: IdentityRepository,
  input: { readonly userId: string; readonly orgId: OrgId; readonly projectId?: string },
): Promise<ResolvedIdentity> {
  const membership = await repo.findOrgMembership(input.userId, input.orgId);
  if (membership === null) throw new NoOrgMembershipError();
  const org = await repo.findOrganization(input.orgId);
  if (org === null) throw new NoOrgMembershipError();

  const project =
    input.projectId === undefined
      ? null
      : await repo.findProjectMembership(input.userId, input.projectId, input.orgId);

  return {
    // `team` belongs to the caller's membership, not the organization row -- fill it here,
    // where the membership is actually known.
    org: { ...org, team: membership.teamId },
    orgRole: membership.orgRole,
    teamId: membership.teamId,
    // Invariant I-11: no project context => null, not a default role.
    projectRole: project?.projectRole ?? null,
    groupId: project?.groupId ?? null,
  };
}

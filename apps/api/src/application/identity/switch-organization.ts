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
  IdentityRepository,
  OrganizationRow,
  SessionStore,
} from "./ports";
import type { OrgId } from "../../domain/org-id";

export interface SwitchOrgDeps {
  readonly repo: IdentityRepository;
  readonly sessions: SessionStore;
  readonly cache: AuthorizationCache;
}

export class NoOrgMembershipError extends Error {
  readonly code = "NO_ORG_MEMBERSHIP";
  constructor() {
    // No org id in the message: whether that org exists is not this caller's business.
    super("NO_ORG_MEMBERSHIP");
  }
}

export interface SwitchOrgResult {
  readonly org: OrganizationRow;
  /**
   * Always [] here.
   *
   * The capability listing belongs to F15, and F15's acceptance V1 is that an organization
   * with no configuration returns an EMPTY ARRAY rather than any built-in default. Shipping
   * a placeholder list now would create exactly the built-in default that requirement
   * forbids, and it would look like configuration to whoever saw it first.
   */
  readonly capabilities: readonly never[];
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

  return { org: { ...org, team: membership.teamId }, capabilities: [] };
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

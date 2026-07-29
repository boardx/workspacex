/**
 * `EnsurePersonalLocalOrg` + `GetLocalOrg` (F16 / usecases.md, invariants I-2 / I-3).
 *
 * ## "注册即有" is a transaction property, not a step
 *
 * The registration path calls `ensurePersonalLocalOrg` INSIDE the transaction that creates
 * the credential and the invited organization (`PgRegistrationRepository`). That placement is
 * the requirement: if it were a follow-up call, a crash between the two would leave an
 * account whose owner has no local organization, and I-2 ("每个 user 恰好拥有一个") would be
 * false for exactly the users whose registration was interrupted -- a state no later code
 * checks for, because every code path assumes the org is there.
 *
 * This module is what the flow calls; it is idempotent because usecases.md says so, and
 * because idempotence is what makes a retry safe rather than a second organization.
 */
import { LOCAL_ORG_GUARANTEES, isLocalOrg, localObjectKeyPrefix } from "../../domain/identity/local-org";
import type { OrgId } from "../../domain/org-id";
import { LocalOrgOnlyError, NoOrgMembershipError } from "./errors";
import type { IdentityRepository, OrganizationRow } from "./ports";

export interface EnsureLocalOrgInput {
  readonly userId: string;
  readonly displayName: string;
}

/**
 * Idempotent: a second call returns the same organization.
 *
 * ⚠ The idempotence is delivered by a UNIQUE INDEX, not by "check then insert". Two
 * concurrent registrations of the same user would both see "none exists" and both insert,
 * and the outcome would be two local organizations with no error raised anywhere -- the same
 * class of bug F19's conditional UPDATE exists to avoid, and equally invisible.
 */
export async function ensurePersonalLocalOrg(
  repo: IdentityRepository,
  input: EnsureLocalOrgInput,
): Promise<OrganizationRow> {
  return repo.ensurePersonalLocalOrg(input.userId, input.displayName);
}

export interface LocalOrgView {
  readonly org: OrganizationRow;
  readonly guarantees: readonly { readonly id: string; readonly statement: string }[];
  readonly memberCount: 1;
  readonly canInvite: false;
  readonly storagePrefix: string;
}

/**
 * What the caller's own local organization looks like.
 *
 * ⚠ It resolves the organization FROM the caller, never from a supplied id. The contract's
 * `getLocalOrg.in` is an empty object for that reason: an endpoint that took an org id would
 * be an endpoint someone could point at another person's local organization, and then
 * "invisible to everyone else" would rest on the authorization check inside it being right
 * forever. There is nothing to get wrong if there is no parameter.
 */
export async function getLocalOrg(
  repo: IdentityRepository,
  userId: string,
): Promise<LocalOrgView> {
  const org = await repo.findPersonalLocalOrg(userId);
  // Not "create it here". Two creation paths would mean I-2 depends on both being correct,
  // and the second one is always the one written in a hurry.
  if (org === null) throw new NoOrgMembershipError();
  if (!isLocalOrg(org.kind)) throw new LocalOrgOnlyError();

  const members = await repo.countOrgMembers(org.id as OrgId);
  if (members !== 1) {
    // I-3 as a runtime assertion, not just a database trigger. If it ever fails, the honest
    // response is an error: the contract types `memberCount` as `z.literal(1)`, so a value of
    // 2 is not something the client can be told -- and telling them "1" would be a lie that
    // makes a broken isolation look intact.
    throw new Error(`invariant I-3 violated: personal-local org has ${members} members`);
  }

  return {
    org,
    guarantees: LOCAL_ORG_GUARANTEES.map((g) => ({ id: g.id, statement: g.statement })),
    memberCount: 1,
    canInvite: false,
    storagePrefix: localObjectKeyPrefix(org.id),
  };
}

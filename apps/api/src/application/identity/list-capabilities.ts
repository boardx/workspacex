/**
 * `ListCapabilities` -- what this organization has configured, filtered to what you may see
 * (F15 / uc-0-5 R3 steps 3-4, R12 V1 V2 V10).
 *
 * ## The two layers are SERIAL, and that is the whole shape of this file
 *
 * R3 step 4: first "does this organization have the capability at all", then "am I inside
 * its visibility scope". They are not one filter with two conditions, because the two
 * failures have to be told apart (V10): a member of the wrong team must learn that the
 * capability EXISTS and is restricted to a team, not that the organization does not have it
 * -- otherwise they go asking the admin to add something that is already there.
 *
 * Layer one is the absence of a row: the repository returns what the organization
 * configured, and an unconfigured organization returns nothing at all. Layer two is
 * `decideCapabilityVisibility`, which produces a decision carrying `ORG_SCOPE_DENIED`. So
 * `withheld` is not diagnostics -- it is the only place the second layer's answer exists.
 *
 * ## There is no fallback branch, and there is no place to put one
 *
 * No `if (rows.length === 0) return DEFAULTS`. Acceptance V1 is that an organization with no
 * configuration shows an empty state rather than a built-in list, which is only true if
 * empty means empty everywhere along the path: no default here, no seed row in the
 * migration, no starter array in the interface layer.
 */
import {
  decideCapabilityVisibility,
  type CapabilityKind,
  type CapabilityListing,
} from "../../domain/identity/capability-listing";
import { projectListingForOrg } from "../../domain/identity/local-org";
import type { OrgId } from "../../domain/org-id";
import {
  discloseDecided,
  isDisclosed,
  type Withheld,
} from "../security/permission-filter";
import type { CapabilityRepository, GuardedCapability } from "./capability-ports";
import type { DecisionIdFactory, IdentityRepository } from "./ports";
import { NoOrgMembershipError } from "./switch-organization";

export interface ListCapabilitiesDeps {
  readonly repo: IdentityRepository;
  readonly capabilities: CapabilityRepository;
  readonly ids: DecisionIdFactory;
}

/**
 * Both halves, deliberately.
 *
 * The contract's `listCapabilities.out` is only the array -- so `withheld` never crosses the
 * wire, and this use case is where V10's distinction is assertable. Returning only the
 * survivors would make "the organization has none" and "you may not see them" identical from
 * every point in the system, which is precisely what V10 forbids.
 */
export interface CapabilityDisclosure {
  readonly visible: readonly CapabilityListing[];
  readonly withheld: readonly Withheld[];
}

export interface ListCapabilitiesInput {
  readonly userId: string;
  readonly orgId: OrgId;
  /** Omitted = every kind, which is what `SwitchOrganization` needs (R3 step 5). */
  readonly kind?: CapabilityKind;
}

export async function listCapabilities(
  deps: ListCapabilitiesDeps,
  input: ListCapabilitiesInput,
): Promise<CapabilityDisclosure> {
  const { repo, capabilities, ids } = deps;

  // Precondition from usecases.md: the caller must be a member. Checked before any listing
  // is read, so a non-member cannot learn the size of the configuration either.
  const membership = await repo.findOrgMembership(input.userId, input.orgId);
  if (membership === null) throw new NoOrgMembershipError();

  // The organization's KIND, read once. It decides whether a cloud endpoint is even usable
  // here (F16 guarantee 1), and that judgement is made in one place -- `projectListingForOrg`
  // -- rather than by each screen deciding what to grey out. A per-screen decision is how one
  // console ends up hiding the row and another showing it enabled.
  const org = await repo.findOrganization(input.orgId);
  if (org === null) throw new NoOrgMembershipError();

  const rows: readonly GuardedCapability[] =
    input.kind === undefined
      ? await capabilities.listAll(input.orgId)
      : await capabilities.listByKind(input.orgId, input.kind);

  const visible: CapabilityListing[] = [];
  const withheld: Withheld[] = [];

  for (const row of rows) {
    const decision = decideCapabilityVisibility({
      decisionId: ids.next(),
      orgRole: membership.orgRole,
      requesterTeamId: membership.teamId,
      scope: row.facts.scope,
      ownerTeamId: row.facts.ownerTeamId,
    });
    // The payload is unreachable except through this call -- forgetting to judge is a type
    // error, not an omission (permission-filter).
    const r = discloseDecided(row.listing, decision);
    // ⚠ Projected AFTER the visibility decision, never instead of it. The local-org rule
    // greys a row out; it never reveals one the requester may not see. Doing it the other way
    // round would make "禁用并注明原因" a channel through which a team-only capability's
    // existence leaks to everyone.
    if (isDisclosed(r)) visible.push(projectListingForOrg(r.payload, org.kind));
    else withheld.push(r);
  }

  // ⚠ Disabled entries are RETURNED, with `enabled: false`. R8: a capability the
  // organization does not allow must be shown greyed out with a reason, never hidden --
  // hiding reads as "the product cannot do this", which sends the user to the wrong place.
  return { visible, withheld };
}

/**
 * `QueryProvenance` -- the ONE audit retrieval surface (coherence review X-2).
 *
 * It is implemented here, in the phase where the first writer lands, and it is written
 * against the SHARED contract rather than against `identity`'s needs. The artifact bundle
 * writes lineage events to the same table and reads them through this same operation;
 * if it grows its own, X-2 has been lost and nobody will notice until the two disagree.
 *
 * ## Who may read the trail
 *
 * R4 A1 names two audiences and this function serves exactly those two:
 *
 *   * the PROJECT LEAD -- "every admin access is logged AND VISIBLE TO THE PROJECT LEAD".
 *     In this ontology 「项目负责人」 is the ORG role `lead` (UC-0.3 R5), not a project
 *     role; the project roles are facilitator / groupLead / member / observer.
 *   * the ADMIN THEMSELVES -- "an admin can review their own access history" via the
 *     prototype's 「看我的访问记录」.
 *
 * plus `compliance`, whose R5 row grants the audit chain explicitly (and grants no content
 * read -- see `admin-boundary.ts`).
 *
 * Everyone else is refused. A consultant reading the trail of a project they are not
 * responsible for would learn who has been looking at what, which is itself information
 * about the organization.
 *
 * ⚠ Reading your OWN history is checked first and needs no role. It is the one query that
 * reveals nothing the caller did not already do.
 */
import type { OrgId } from "../../domain/org-id";
import type { OrgRole } from "../../domain/identity/roles";
import type { IdentityRepository } from "../identity/ports";
import { NoOrgMembershipError } from "../identity/switch-organization";
import type { ProvenancePage, ProvenanceQuery, ProvenanceReader } from "./ports";

export class ProvenanceForbiddenError extends Error {
  readonly code = "PROJECT_ROLE_INSUFFICIENT";
  constructor() {
    super("PROJECT_ROLE_INSUFFICIENT");
  }
}

/** Org roles carrying a governance mandate over the whole organization (UC-0.3 R5). */
const TRAIL_READERS: readonly OrgRole[] = ["lead", "admin", "compliance"];

export interface QueryProvenanceDeps {
  readonly repo: IdentityRepository;
  readonly reader: ProvenanceReader;
}

export interface QueryProvenanceInput {
  readonly requesterId: string;
  readonly orgId: OrgId;
  readonly filter: Omit<ProvenanceQuery, "orgId">;
}

export async function queryProvenance(
  deps: QueryProvenanceDeps,
  input: QueryProvenanceInput,
): Promise<ProvenancePage> {
  const { repo, reader } = deps;
  const { requesterId, orgId, filter } = input;

  const membership = await repo.findOrgMembership(requesterId, orgId);
  // Not a member: NOT "empty result". An empty page is indistinguishable from "there is
  // nothing to see", and a caller who is not in the tenant should not be told which.
  if (membership === null) throw new NoOrgMembershipError();

  const ownHistoryOnly = filter.actorId === requesterId;
  if (!ownHistoryOnly && !TRAIL_READERS.includes(membership.orgRole)) {
    throw new ProvenanceForbiddenError();
  }

  // RLS is still the first line: the query below runs under tenant scope, so even a bug in
  // the branch above cannot return another organization's events.
  return reader.query(orgId, filter);
}

/**
 * `ResolveModelConstraint` -- the single judging point for "must this round stay local"
 * (coherence B-3 / X-5; uc-0-5 R12 V12).
 *
 * Thin on purpose. The rule is pure and lives in `domain/identity/model-constraint`; this
 * only supplies the organization's facts. The contract is explicit that
 * `context-pack.resolvePackModelConstraint` must NOT judge again but call this -- two
 * judging points is how one screen ends up calling it a product promise and another calling
 * it an org policy, and those two differ in whether an admin can switch them off.
 */
import {
  resolveModelConstraintRule,
  type ModelConstraint,
} from "../../domain/identity/model-constraint";
import { isLocalOrg } from "../../domain/identity/local-org";
import type { OrgId } from "../../domain/org-id";
import type { IdentityRepository } from "./ports";
import { NoOrgMembershipError } from "./switch-organization";

export interface ResolveModelConstraintInput {
  readonly userId: string;
  readonly orgId: OrgId;
  readonly dataScope: readonly { readonly itemId: string; readonly confidential: boolean }[];
}

export async function resolveModelConstraint(
  repo: IdentityRepository,
  input: ResolveModelConstraintInput,
): Promise<ModelConstraint> {
  const membership = await repo.findOrgMembership(input.userId, input.orgId);
  if (membership === null) throw new NoOrgMembershipError();
  const org = await repo.findOrganization(input.orgId);
  if (org === null) throw new NoOrgMembershipError();

  return resolveModelConstraintRule({
    orgKind: org.kind,
    // Passed only for a real organization. For a personal-local one there is nothing to
    // pass: the promise comes from `kind`, and handing the rule a policy it must remember
    // not to read is how "must not read" eventually becomes "reads".
    modelPolicy: isLocalOrg(org.kind) ? undefined : org.modelPolicy,
    dataScope: input.dataScope,
  });
}

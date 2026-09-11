import { bootstrapFirstUser, type BootstrapFirstUserDeps, type BootstrapFirstUserInput } from "../auth/bootstrap-first-user";
import { BootstrapUnavailableError } from "../auth/errors";
import type { CredentialRepository } from "../auth/ports";
import type { IdentityRepository } from "../identity/ports";
import { normalizeEmail } from "../../domain/auth/registration";
import { toOrgId } from "../../domain/org-id";

/** Privileged local provision command only; never exposed as a public HTTP retry bypass. */
export async function ensureProvisionAdmin(
  deps: BootstrapFirstUserDeps & {
    credentials: CredentialRepository;
    identity: IdentityRepository;
    seedAgents: (ids: { userId: string; orgId: string }) => Promise<void>;
  },
  input: BootstrapFirstUserInput,
): Promise<{ userId: string; orgId: string; created: boolean }> {
  let result: { userId: string; orgId: string; created: boolean };
  try {
    result = { ...await bootstrapFirstUser(deps, input), created: true };
  } catch (error) {
    if (!(error instanceof BootstrapUnavailableError)) throw error;
    // A consumed gate alone is NOT success. Authenticate the requested administrator,
    // then prove the existing organization and role. Never reset credentials or grant roles.
    const credential = await deps.credentials.findByEmail(normalizeEmail(input.email));
    if (!credential || !credential.emailVerifiedAt || !await deps.hasher.verify(input.password, credential.passwordHash)) {
      throw new Error("provision administrator does not match existing installation");
    }
    const candidates: string[] = [];
    for (const membership of await deps.identity.listMemberships(credential.userId)) {
      if (membership.orgRole !== "admin") continue;
      const organization = await deps.identity.findOrganization(toOrgId(membership.orgId));
      if (organization?.name === input.orgName && organization.kind === "organization") candidates.push(membership.orgId);
    }
    if (candidates.length !== 1) throw new Error("provision organization does not match existing installation");
    result = { userId: credential.userId, orgId: candidates[0]!, created: false };
  }
  // All three existing seed operations are idempotent. Retry repairs a crash between the
  // permanent account gate and agent publication rather than claiming a bare 409 passed.
  await deps.seedAgents(result);
  return result;
}

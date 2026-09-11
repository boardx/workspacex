import { describe, expect, it, vi } from "vitest";
import { ensureProvisionAdmin } from "../../src/application/deploy/ensure-provision-admin";
import type { CredentialRepository, RegistrationRepository } from "../../src/application/auth/ports";
import type { IdentityRepository } from "../../src/application/identity/ports";

function fixture() {
  const seedAgents = vi.fn(async () => ({ defaultAgentId: "agent-1" }));
  const verify = vi.fn(async () => true);
  const deps = { repo: { isFirstUserBootstrapAvailable: async () => false } as RegistrationRepository,
    hasher: { hash: async () => "", verify, verifyDummy: async () => false as const },
    credentials: { findByEmail: async () => ({ userId: "user-1", emailVerifiedAt: new Date(), passwordHash: "hash" }) } as unknown as CredentialRepository,
    identity: { listMemberships: async () => [{ orgId: "org-1", orgRole: "admin" }],
      findOrganization: async () => ({ name: "Cloud", kind: "organization" }) } as unknown as IdentityRepository,
    seedAgents };
  return { deps, seedAgents, verify };
}
const input = { email: "admin@example.com", password: "test-strong-password", displayName: "Admin", orgName: "Cloud" };
describe("provision administrator retry", () => {
  it("repairs agent publication only after authenticating and proving admin membership", async () => {
    const { deps, seedAgents } = fixture();
    expect(await ensureProvisionAdmin(deps, input)).toEqual({ userId: "user-1", orgId: "org-1", created: false, defaultAgentId: "agent-1" });
    expect(seedAgents).toHaveBeenCalledOnce();
  });
  it("does not turn consumed bootstrap into success for incorrect credentials", async () => {
    const { deps, verify, seedAgents } = fixture(); verify.mockResolvedValue(false);
    await expect(ensureProvisionAdmin(deps, input)).rejects.toThrow("administrator"); expect(seedAgents).not.toHaveBeenCalled();
  });
  it("does not grant admin to an ordinary member", async () => {
    const { deps, seedAgents } = fixture(); deps.identity.listMemberships = async () => [{ orgId: "org-1", orgRole: "consultant" }];
    await expect(ensureProvisionAdmin(deps, input)).rejects.toThrow("organization"); expect(seedAgents).not.toHaveBeenCalled();
  });
  it("rejects ambiguous same-name organizations", async () => {
    const { deps } = fixture(); deps.identity.listMemberships = async () => [{ orgId: "org-1", orgRole: "admin" }, { orgId: "org-2", orgRole: "admin" }];
    await expect(ensureProvisionAdmin(deps, input)).rejects.toThrow("organization");
  });
  it("propagates agent seeding failure, then repairs on a later invocation", async () => {
    const { deps, seedAgents } = fixture(); seedAgents.mockRejectedValueOnce(new Error("seed unavailable"));
    await expect(ensureProvisionAdmin(deps, input)).rejects.toThrow("seed unavailable");
    await expect(ensureProvisionAdmin(deps, input)).resolves.toMatchObject({ created: false });
  });
});

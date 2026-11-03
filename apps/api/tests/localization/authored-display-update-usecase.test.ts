import { describe, expect, it, vi } from "vitest";
import type { IdentityRepository } from "../../src/application/identity/ports";
import { getAuthoredDisplayUpdateOffer, applyAuthoredDisplayUpdate } from "../../src/application/localization/authored-display-update";
import { toOrgId } from "../../src/domain/org-id";
const request = { orgId: toOrgId("org-a"), actorId: "admin" };
const body = { expectedOrgId: "org-a", expectedMetadataVersion: "2.0.0", idempotencyKey: "update" };
function setup(role = "admin", changed = false) {
  const identities = { findOrgMembership: vi.fn(async () => ({ orgRole: role, teamId: "team-a" })) } as unknown as IdentityRepository;
  const repository = { offer: vi.fn(async (_input: unknown) => ({ metadataVersion: "2.0.0", available: true, installedCount: 1 })),
    apply: vi.fn(async (_input: unknown) => changed ? null : { metadataVersion: "2.0.0", updatedEntities: 1, skippedEntities: 0, appliedAt: new Date().toISOString(), replayed: false }) };
  return { identities, repository };
}
describe("explicit display metadata update authorization", () => {
  it.each(["consultant","lead","observer"])("denies %s before status or update access", async role => {
    const deps = setup(role);
    await expect(getAuthoredDisplayUpdateOffer(request,deps)).rejects.toMatchObject({ code: "ROLE_INSUFFICIENT" });
    await expect(applyAuthoredDisplayUpdate({ ...request, body },deps)).rejects.toMatchObject({ code: "ROLE_INSUFFICIENT" });
    expect(deps.repository.offer).not.toHaveBeenCalled(); expect(deps.repository.apply).not.toHaveBeenCalled();
  });
  it("does not let org admins bypass team visibility in either status or writes", async () => {
    const deps = setup();
    await getAuthoredDisplayUpdateOffer(request,deps);
    const read = deps.repository.offer.mock.calls[0]![0] as unknown as { authorize: (facts: unknown) => { allowed: boolean } };
    expect(read.authorize({ scope: "team-only", ownerTeamId: "other-team" }).allowed).toBe(false);
    await applyAuthoredDisplayUpdate({ ...request, body },deps);
    const write = deps.repository.apply.mock.calls[0]![0] as unknown as typeof read;
    expect(write.authorize({ scope: "team-only", ownerTeamId: "other-team" }).allowed).toBe(false);
  });
  it("binds the frozen organization and rejects executable or unknown fields", async () => {
    const deps = setup();
    await expect(applyAuthoredDisplayUpdate({ ...request, body: { ...body, expectedOrgId: "org-b" } },deps)).rejects.toMatchObject({ code: "ROLE_INSUFFICIENT" });
    await expect(applyAuthoredDisplayUpdate({ ...request, body: { ...body, instructions: "rewrite" } },deps)).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    expect(deps.repository.apply).not.toHaveBeenCalled();
  });
  it("requires a fresh version instead of silently applying a changed offer", async () => {
    await expect(applyAuthoredDisplayUpdate({ ...request, body },setup("admin",true))).rejects.toMatchObject({ code: "SOURCE_CHANGED" });
  });
});

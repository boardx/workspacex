import { describe, expect, it, vi } from "vitest";
import { getLocalizationAdmin, putLocalization, clearLocalization } from "../../src/application/localization/entity-localization";
import type { IdentityRepository } from "../../src/application/identity/ports";

const request = { orgId: "org-a", actorId: "admin", kind: "skill" as const, entityId: "skill-a", locale: "en" as const };
const body = { sourceRevision: "v1", expectedTranslationRevision: null, status: "reviewed" as const, fields: { name: "Discovery" } };
function setup(role: string | null = "admin", outcome: string = "ok") {
  const view = { source: { orgId: "org-a", entityId: "skill-a", kind: "skill", revision: "v1", locale: null, fields: { name: "探索" } }, translation: null };
  const repository = {
    get: vi.fn(async () => view),
    put: vi.fn(async () => outcome === "ok" ? { kind: "ok", view } : { kind: outcome }),
    clear: vi.fn(async () => outcome === "ok" ? { kind: "ok", view } : { kind: outcome }),
    setSourceLocale: vi.fn(), displays: vi.fn(),
  };
  const identities = { findOrgMembership: vi.fn(async () => role === null ? null : { orgRole: role }) } as unknown as IdentityRepository;
  return { repository, deps: { repository: repository as never, identities } };
}
describe("entity localization administration", () => {
  it.each(["member", "viewer", null])("denies %s before repository access", async role => {
    const { deps, repository } = setup(role);
    await expect(getLocalizationAdmin(request, deps)).rejects.toMatchObject({ code: "ROLE_INSUFFICIENT" });
    await expect(putLocalization({ ...request, body }, deps)).rejects.toMatchObject({ code: "ROLE_INSUFFICIENT" });
    await expect(clearLocalization({ ...request, body: { sourceRevision: "v1", expectedTranslationRevision: 1 } }, deps)).rejects.toMatchObject({ code: "ROLE_INSUFFICIENT" });
    expect(repository.get).not.toHaveBeenCalled();
    expect(repository.put).not.toHaveBeenCalled();
    expect(repository.clear).not.toHaveBeenCalled();
  });
  it.each([
    ["not-found", "ENTITY_NOT_FOUND"], ["source-changed", "SOURCE_CHANGED"], ["translation-changed", "TRANSLATION_CHANGED"],
  ])("preserves repository %s refusal", async (outcome, code) => {
    const { deps } = setup("admin", outcome);
    await expect(putLocalization({ ...request, body }, deps)).rejects.toMatchObject({ code });
  });
  it("validates writes rather than forwarding executable fields", async () => {
    const { deps, repository } = setup();
    await expect(putLocalization({ ...request, body: { ...body, instructions: "rewrite" } }, deps)).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    expect(repository.put).not.toHaveBeenCalled();
  });
  it("returns the source view for an authorized write", async () => {
    const { deps, repository } = setup();
    const result = await putLocalization({ ...request, body }, deps);
    expect(result.source.fields.name).toBe("探索");
    expect(repository.put).toHaveBeenCalledWith({ ...request, body, authorize: expect.any(Function) });
  });
});

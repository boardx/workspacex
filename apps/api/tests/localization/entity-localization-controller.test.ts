import { describe, expect, it } from "vitest";
import { HttpException } from "@nestjs/common";
import { EntityLocalizationController } from "../../src/interface/controllers/entity-localization.controller";
import type { IdentityRepository } from "../../src/application/identity/ports";
import type { EntityLocalizationRepository } from "../../src/application/localization/entity-localization";
import type { Principal } from "../../src/domain/principal";
const principal = { orgId: "org-a", userId: "admin" } as Principal;
function setup(outcome = "ok", role = "admin") {
  const view = { source: { orgId: "org-a", entityId: "skill-a", kind: "skill", revision: "v1", locale: null, fields: { name: "原文" } }, translation: null };
  const identities = { findOrgMembership: async () => ({ orgRole: role }) } as unknown as IdentityRepository;
  const repository = { get: async () => outcome === "not-found" ? null : view, put: async () => ({ kind: outcome, view }), clear: async () => ({ kind: outcome, view }) } as unknown as EntityLocalizationRepository;
  return new EntityLocalizationController(identities, repository);
}
const body = { sourceRevision: "v1", expectedTranslationRevision: null, status: "draft", fields: { name: "Translated" } };
describe("translation management HTTP boundary", () => {
  it("returns a validated view without an executable field", async () => {
    expect((await setup().getSkill(principal, "skill-a", "en")).source.fields.name).toBe("原文");
    expect((await setup().putSkill(principal, "skill-a", "en", body)).translation).toBeNull();
  });
  it.each([["not-found", 404], ["source-changed", 409], ["translation-changed", 409]])("maps %s", async (outcome, status) => {
    try { await setup(outcome as string).putSkill(principal, "skill-a", "en", body); throw Error("expected error"); }
    catch (error) { expect(error).toBeInstanceOf(HttpException); expect((error as HttpException).getStatus()).toBe(status); }
  });
  it("uses 403 for non-admin and 422 for invalid locale/body", async () => {
    await expect(setup("ok", "member").putSkill(principal, "skill-a", "en", body)).rejects.toMatchObject({ status: 403 });
    await expect(Promise.resolve().then(() => setup().getSkill(principal, "skill-a", "en-US"))).rejects.toMatchObject({ status: 422 });
    await expect(setup().putSkill(principal, "skill-a", "en", { ...body, instructions: "overwrite" })).rejects.toMatchObject({ status: 422 });
  });
});

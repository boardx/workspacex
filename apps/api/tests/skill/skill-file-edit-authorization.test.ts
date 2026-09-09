import { describe, expect, it, vi } from "vitest";
import { getSkillFileSnapshot, saveSkillFiles, type SkillFileEditDeps } from "../../src/application/skill/edit-skill-files";

describe("Skill file administrator authorization precedes all data access", () => {
  for (const role of [null, "observer", "consultant"]) it(`rejects ${role ?? "nonmember"} without reading or writing`, async () => {
    const read = vi.fn(), append = vi.fn();
    const findOrgMembership = vi.fn().mockResolvedValue(role ? { orgRole: role } : null);
    const deps: SkillFileEditDeps = { identities: { findOrgMembership }, repository: { read, append } };
    const context = { orgId: "org-a", actorId: "actor-a", skillId: "skill-a" };
    await expect(getSkillFileSnapshot({ ...context, versionId: "version-a" }, deps)).rejects.toMatchObject({ code: "EDIT_NOT_ORG_ADMIN" });
    await expect(saveSkillFiles({ ...context, expectedVersionId: "version-a", mutations: [{ kind: "put", path: "SKILL.md", contentBase64: "YQ==", mediaType: "text/markdown" }] }, deps)).rejects.toMatchObject({ code: "EDIT_NOT_ORG_ADMIN" });
    expect(findOrgMembership).toHaveBeenCalledWith("actor-a", "org-a");
    expect(read).not.toHaveBeenCalled(); expect(append).not.toHaveBeenCalled();
  });
  it("performs current membership lookup before an administrator read", async () => {
    const order: string[] = [];
    const deps: SkillFileEditDeps = { identities: { findOrgMembership: vi.fn().mockImplementation(async () => { order.push("membership"); return { orgRole: "admin" }; }) }, repository: { read: vi.fn().mockImplementation(async () => { order.push("read"); return null; }), append: vi.fn() } };
    await expect(getSkillFileSnapshot({ orgId: "org-a", actorId: "actor-a", skillId: "skill-a", versionId: "version-a" }, deps)).rejects.toMatchObject({ code: "EDIT_SKILL_NOT_FOUND" });
    expect(order).toEqual(["membership", "read"]);
  });
});

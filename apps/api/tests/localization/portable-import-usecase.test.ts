import { describe, expect, it, vi } from "vitest";
import { importSkillStarterPack } from "../../src/application/skill-import/import-skill-starter-pack";
import { importAgentStarterPack } from "../../src/application/agent-import/import-agent-starter-pack";
import type { IdentityRepository } from "../../src/application/identity/ports";
import { toOrgId } from "../../src/domain/org-id";
import { skillV2, agentV2 } from "./portable-pack-fixture";

describe("direct portable import authorization and replay", () => {
  for (const [kind, build, run] of [["skill", skillV2, importSkillStarterPack], ["agent", agentV2, importAgentStarterPack]] as const) {
    const setup = (role = "admin") => {
      const identities = { findOrgMembership: vi.fn(async () => ({ orgRole: role, teamId: "team-a" })) } as unknown as IdentityRepository;
      const pack = build();
      const packs = { load: vi.fn(async () => pack) };
      const imports = { findExisting: vi.fn(async () => ({ kind: "replayed", result: {}, metadataOnly: true })), persistVerified: vi.fn(), retireSuperseded: vi.fn() };
      const input = { actorId: "author", orgId: toOrgId("org-a"), packId: pack.packId, packVersion: pack.packVersion,
        idempotencyKey: "direct", expectedPackDigest: pack.packDigest };
      return { deps: { identities, packs, imports }, pack, packs, imports, input };
    };
    it(`${kind}: denies a member before loading or replaying`, async () => {
      const { deps, packs, imports, input } = setup("member");
      await expect(run(deps as never, input)).rejects.toThrow();
      expect(packs.load).not.toHaveBeenCalled(); expect(imports.findExisting).not.toHaveBeenCalled();
    });
    it(`${kind}: verifies package bytes before returning an existing replay`, async () => {
      const { deps, pack, imports, input } = setup();
      if ("skills" in pack) pack.skills[0]!.localization.translations.en!.name = "Tampered";
      else pack.agents[0]!.localization.translations.en!.name = "Tampered";
      await expect(run(deps as never, input)).rejects.toThrow();
      expect(imports.findExisting).not.toHaveBeenCalled(); expect(imports.persistVerified).not.toHaveBeenCalled();
    });
    it(`${kind}: rejects a different expected digest before returning a replay`, async () => {
      const { deps, imports, input } = setup();
      await expect(run(deps as never, { ...input, expectedPackDigest: "0".repeat(64) })).rejects.toThrow();
      expect(imports.findExisting).not.toHaveBeenCalled();
    });
    it(`${kind}: valid replay does not retire entities or republish dependencies`, async () => {
      const { deps, imports, input } = setup();
      await expect(run(deps as never, input)).resolves.toMatchObject({ created: false });
      expect(imports.persistVerified).not.toHaveBeenCalled(); expect(imports.retireSuperseded).not.toHaveBeenCalled();
    });
  }
});

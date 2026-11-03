import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { verifySkillStarterPack, skillContentDigest, importPayloadDigest } from "../../src/domain/skill/starter-pack";
import { verifyAgentStarterPack, verifyOfficialAgentStarterPack, agentImportPayloadDigest } from "../../src/domain/agent/starter-pack";
import { buildOfficialAgentRolePack } from "../../src/domain/agent/official-role-packs";
import { skillV1, skillV2, agentV2, officialV2, sha } from "./portable-pack-fixture";

describe("portable localization integrity and unchanged execution", () => {
  it("binds direct import idempotency to verified package bytes while retaining legacy coordinate keys", () => {
    for (const digest of [importPayloadDigest, agentImportPayloadDigest]) {
      const coordinates = { packId: "portable", packVersion: "2.0.0" };
      const first = { ...coordinates, expectedPackDigest: "a".repeat(64) };
      const second = { ...coordinates, expectedPackDigest: "b".repeat(64) };
      expect(digest(first)).not.toBe(digest(second));
      expect(digest(first)).not.toBe(digest(coordinates));
      expect(digest(coordinates)).toBe(sha(JSON.stringify(coordinates)));
    }
  });
  it("keeps every shipped v1 Skill pack readable without changing parsed bytes", () => {
    const root = resolve(__dirname, "../../../../skills/starter-packs");
    let count = 0;
    for (const directory of readdirSync(root)) for (const file of readdirSync(join(root, directory)).filter(name => name.endsWith(".json"))) {
      const raw = JSON.parse(readFileSync(join(root, directory, file), "utf8"));
      expect(JSON.stringify(verifySkillStarterPack(raw, raw)), `${directory}/${file}`).toBe(JSON.stringify(raw));
      count++;
    }
    expect(count).toBeGreaterThan(40);
    const roles = buildOfficialAgentRolePack();
    expect(JSON.stringify(verifyOfficialAgentStarterPack(roles, roles))).toBe(JSON.stringify(roles));
  });
  it("includes translated copy in the package digest but excludes it from Skill execution digest", () => {
    const first = skillV2("First"), second = skillV2("Second");
    expect(first.packDigest).not.toBe(second.packDigest);
    expect(skillContentDigest(first.skills[0]!)).toBe(skillContentDigest(second.skills[0]!));
    expect(skillContentDigest(first.skills[0]!)).toBe(skillContentDigest(skillV1().skills[0]!));
    expect(verifySkillStarterPack(first, first)).toEqual(first);
    expect(() => verifySkillStarterPack({ ...first, skills: second.skills }, first)).toThrow();
  });
  it("binds ordinary and official Agent metadata without changing original instructions or their digest", () => {
    for (const [build, verify] of [[agentV2, verifyAgentStarterPack], [officialV2, verifyOfficialAgentStarterPack]] as const) {
      const first = build("First"), second = build("Second");
      expect(first.packDigest).not.toBe(second.packDigest);
      expect(first.agents[0]!.instructions).toBe(second.agents[0]!.instructions);
      expect(first.agents[0]!.instructionDigest).toBe(second.agents[0]!.instructionDigest);
      expect(verify(first, first)).toEqual(first);
      expect(() => verify({ ...first, agents: second.agents }, first)).toThrow();
    }
  });
});

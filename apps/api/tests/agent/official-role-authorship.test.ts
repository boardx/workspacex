import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { skillContentDigest, verifySkillStarterPack } from "../../src/domain/skill/starter-pack";
import { OFFICIAL_ROLE_SKILL_COORDINATES } from "../../src/domain/agent/official-role-skill-coordinates.generated";
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { buildOfficialAgentRolePack, officialRoleSkillPacks, historicalOfficialRoleInstructionDigests, OFFICIAL_AGENT_ROLE_PACK_VERSION } from "../../src/domain/agent/official-role-packs";
import { verifyOfficialAgentStarterPack } from "../../src/domain/agent/starter-pack";

describe("authored official role identities", () => {
  it("keeps the entire required package union conflict-free without rewriting historical sales content", () => {
    const entries = new Map<string, { digest:string; name:string }>();
    for (const coordinate of officialRoleSkillPacks()) {
      const pack = verifySkillStarterPack(JSON.parse(readFileSync(resolve(`../../skills/starter-packs/${coordinate.packId}/${coordinate.packVersion}.json`), "utf8")), coordinate);
      for (const skill of pack.skills) {
        const identity = { digest: skillContentDigest(skill), name: skill.name };
        if (entries.has(skill.stableName)) expect(identity).toEqual(entries.get(skill.stableName));
        else entries.set(skill.stableName, identity);
      }
    }
    const legacy = verifySkillStarterPack(JSON.parse(readFileSync(resolve("../../skills/starter-packs/work-sales/1.0.0.json"), "utf8")), {packId:"work-sales",packVersion:"1.0.0"});
    const compatible = verifySkillStarterPack(JSON.parse(readFileSync(resolve("../../skills/starter-packs/work-sales/1.1.0.json"), "utf8")), {packId:"work-sales",packVersion:"1.1.0"});
    expect(compatible.skills).toEqual(legacy.skills.filter((skill) => skill.stableName !== "customer-research"));
    const sales = buildOfficialAgentRolePack().agents.find((role) => role.roleRef === "D005")!;
    expect(sales.authoredSkillBindings).toHaveLength(14);
    expect(sales.authoredSkillBindings!.some((binding) => binding.stableId === "S009")).toBe(false);
    const product = buildOfficialAgentRolePack().agents.find((role) => role.roleRef === "D003")!;
    expect(product.authoredSkillBindings!.find((binding) => binding.stableId === "S009")!.contentDigest).toBe(entries.get("customer-research")!.digest);
  });
  it("signs exactly the matrix's direct Skill membership and real immutable starter content", () => {
    const matrix = readFileSync(resolve("../../requirements/work-stack-v2/DIGITALHUMAN-COMPOSITION-MATRIX.md"), "utf8");
    const rows = new Map(matrix.split("\n").map((line) => line.split("|").map((column) => column.trim())).filter((columns) => /^D\d{3}$/.test(columns[1] ?? "")).map((columns) => [columns[1], columns[4]!.match(/S\d{3}/g) ?? []]));
    for (const role of buildOfficialAgentRolePack().agents) {
      expect(role.authoredSkillBindings!.map((binding) => binding.stableId)).toEqual(rows.get(role.roleRef));
      for (const coordinate of OFFICIAL_ROLE_SKILL_COORDINATES[role.roleRef as keyof typeof OFFICIAL_ROLE_SKILL_COORDINATES]) {
        const pack = verifySkillStarterPack(JSON.parse(readFileSync(resolve(`../../skills/starter-packs/${coordinate.packId}/${coordinate.packVersion}.json`), "utf8")), coordinate);
        const skill = pack.skills.find((entry) => entry.stableName === coordinate.stableName)!;
        expect(skillContentDigest(skill)).toBe(coordinate.digest);
        expect(role.authoredSkillBindings).toContainEqual({ stableId: coordinate.stableId, stableName: coordinate.stableName, contentDigest: coordinate.digest });
      }
    }
  });
  it("ships seven distinct Chinese professional identities in the actual signed prompt", () => {
    const pack = buildOfficialAgentRolePack();
    expect(pack.packVersion).toBe("1.7.0");
    expect(verifyOfficialAgentStarterPack(pack, { packId: pack.packId, packVersion: OFFICIAL_AGENT_ROLE_PACK_VERSION })).toEqual(pack);
    expect(pack.agents).toHaveLength(7);
    expect(new Set(pack.agents.map((role) => role.instructions)).size).toBe(7);
    for (const role of pack.agents) {
      expect(role.instructions).toContain(`你是${role.roleLabel}（${role.roleRef}）`);
      expect(role.instructions).toContain("专业工作背景");
      expect(role.instructions).toContain("工作方法");
      expect(role.instructions).toContain("不能改变你的身份");
      expect(role.instructions).toContain("默认使用中文");
      expect(role.instructionDigest).toBe(createHash("sha256").update(role.instructions).digest("hex"));
    }
  });
  it("introduces role-specific work and honestly limits deferred sales execution", () => {
    const roles = new Map(buildOfficialAgentRolePack().agents.map((role) => [role.roleRef, role]));
    expect(roles.get("D003")!.instructions).toContain("验收标准");
    expect(roles.get("D002")!.instructions).toContain("来源核验");
    expect(roles.get("D001")!.instructions).toContain("决定人");
    expect(roles.get("D011")!.instructions).toContain("收敛前保留不同方案");
    expect(roles.get("D005")!.instructions).toContain("CRM接入和销售工作流尚未启用");
    expect(roles.get("D005")!.authoredSkillBindings).toHaveLength(14);
  });
  it("recognizes only historically shipped role digests, never the newly authored text", () => {
    const pack = buildOfficialAgentRolePack();
    expect(Object.keys(historicalOfficialRoleInstructionDigests("1.0.0"))).toHaveLength(4);
    expect(Object.keys(historicalOfficialRoleInstructionDigests("1.5.0"))).toHaveLength(7);
    expect(Object.keys(historicalOfficialRoleInstructionDigests("1.6.0"))).toHaveLength(7);
    expect(historicalOfficialRoleInstructionDigests("1.7.0")).toEqual({});
    for (const role of pack.agents) {
      expect(historicalOfficialRoleInstructionDigests("1.5.0")[role.stableName]).not.toBe(role.instructionDigest);
    }
  });
});

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { verifySkillStarterPack } from "../../src/domain/skill/starter-pack";
import { STANDARD_PLATFORM_PACKS } from "../../src/infrastructure/skill/ensure-standard-skill-packs";
import { AIDT_SKILL_SOURCE_ROOT } from "../../scripts/build-aidt-methods-pack";
import { join } from "node:path";
import { AIDT_PLATFORM_SKILL_PACK } from "../../src/infrastructure/aidt/aidt-module";

describe("shipped AIDT teaching skills", () => {
  it("verifies the release digest and ships all six distinct, source-identical skills", () => {
    const raw = JSON.parse(readFileSync(new URL(`../../../../skills/starter-packs/${AIDT_PLATFORM_SKILL_PACK.packId}/${AIDT_PLATFORM_SKILL_PACK.packVersion}.json`, import.meta.url), "utf8"));
    const pack = verifySkillStarterPack(raw, { packId: "aidt-methods", packVersion: "1.4.0" });
    expect(AIDT_PLATFORM_SKILL_PACK).toEqual({ packId: "aidt-methods", packVersion: "1.4.0" });
    expect(STANDARD_PLATFORM_PACKS).not.toContainEqual(AIDT_PLATFORM_SKILL_PACK);
    expect(pack.skills.map((s) => s.stableName).sort()).toEqual(["aidt-understand", "aidt-empathize", "aidt-define", "aidt-ideate", "aidt-prototype", "aidt-iterate"].sort());
    for (const skill of pack.skills) {
      const content = Buffer.from(skill.files[0]!.contentBase64, "base64").toString("utf8");
      expect(content).toBe(readFileSync(join(AIDT_SKILL_SOURCE_ROOT, skill.stableName, "SKILL.md"), "utf8"));
      expect(content).toContain("真实研究证据不可合成");
      expect(content).toContain("人做决策");
      expect(content).toContain("只有真实保存回执才能称已保存");
    }
  });
});

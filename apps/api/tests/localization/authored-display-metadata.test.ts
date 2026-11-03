import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { buildDisplayMetadata } from "../../../../scripts/generate-display-metadata";
import data from "../../../../skills/localizations/work-stack-v2.json";
import { buildLocalizedOfficialPack, localizeShippedSkillPack } from "../../src/domain/localization/authored-display-metadata";
import { buildOfficialAgentRolePack } from "../../src/domain/agent/official-role-packs";
import { verifyOfficialAgentStarterPack } from "../../src/domain/agent/starter-pack";
import { verifySkillStarterPack } from "../../src/domain/skill/starter-pack";
import { SUPPORTED_LOCALES } from "@repo/contracts/locale";
const root = resolve(__dirname,"../../../..");
describe("authored bilingual display release", () => {
  it("covers all 86 Work Skill and seven Agent headings mechanically", () => {
    expect(data).toEqual(buildDisplayMetadata());
    expect(Object.keys(data.skills)).toHaveLength(86); expect(Object.keys(data.agents)).toHaveLength(7);
    for (const fields of [...Object.values(data.skills),...Object.values(data.agents)]) expect(Object.keys(fields).sort()).toEqual([...SUPPORTED_LOCALES].sort());
  });
  it("keeps every legacy Skill file/digest/name intact while publishing authored v2 titles", () => {
    for (const [packId,base] of Object.entries(data.packages)) {
      const path = resolve(root,"skills/starter-packs",packId,`${base.baseVersion}.json`), raw = readFileSync(path,"utf8");
      const legacy = verifySkillStarterPack(JSON.parse(raw), { packId, packVersion: base.baseVersion });
      const localized = localizeShippedSkillPack(legacy);
      expect(verifySkillStarterPack(localized,localized)).toEqual(localized);
      expect(localized.schemaVersion).toBe(2); expect(localized.packVersion).toBe(data.metadataVersion);
      for (const [i,entry] of localized.skills.entries()) {
        const { localization, ...original } = entry;
        expect(original).toEqual(legacy.skills[i]);
        expect(Object.keys(localization.translations).sort()).toEqual([...SUPPORTED_LOCALES].sort());
      }
      expect(readFileSync(path,"utf8")).toBe(raw);
    }
  });
  it("keeps official Agent originals and instruction digests exact, with bilingual names/labels/alt text", () => {
    const legacy = buildOfficialAgentRolePack(), localized = buildLocalizedOfficialPack();
    expect(verifyOfficialAgentStarterPack(localized,localized)).toEqual(localized);
    for (const [i,entry] of localized.agents.entries()) {
      const { localization, ...original } = entry;
      expect(original).toEqual(legacy.agents[i]);
      expect(localization.sourceLocale).toBe("zh-CN");
      expect(localization.translations.en?.name).toBe(data.agents[entry.roleRef as keyof typeof data.agents].en.name);
      expect(localization.translations.en?.roleLabel).toBe(localization.translations.en?.name);
    }
  });
  it("does not author translations for an unknown or modified execution package", () => {
    const base = data.packages["work-product"], legacy = JSON.parse(readFileSync(resolve(root,"skills/starter-packs/work-product",`${base.baseVersion}.json`),"utf8"));
    expect(() => localizeShippedSkillPack({ ...legacy, packDigest: "0".repeat(64) })).toThrow();
    expect(() => localizeShippedSkillPack({ ...legacy, packId: "user-authored" })).toThrow();
  });
});

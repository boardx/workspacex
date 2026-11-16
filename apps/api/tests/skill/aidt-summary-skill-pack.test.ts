import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { AIDT_SUMMARY_SOURCE, buildAidtSummaryPack, checkOrWriteAidtSummaryPack } from "../../scripts/build-aidt-summary-pack";
import { verifySkillStarterPack } from "../../src/domain/skill/starter-pack";
import { AIDT_SUMMARY_SKILL_PACK, AIDT_PLATFORM_SKILL_PACK } from "../../src/infrastructure/aidt/aidt-module";
import { enabledPlatformSkillPacks, STANDARD_PLATFORM_PACKS } from "../../src/infrastructure/skill/ensure-standard-skill-packs";
const root = new URL("../../../../", import.meta.url);
afterEach(() => vi.unstubAllEnvs());
it("ships a real source-identical summary task in a separate immutable verified release, preserving six stage methods", () => {
  const pack = buildAidtSummaryPack(), raw = JSON.parse(readFileSync(new URL(`skills/starter-packs/${pack.packId}/${pack.packVersion}.json`, root), "utf8"));
  expect(verifySkillStarterPack(raw, AIDT_SUMMARY_SKILL_PACK)).toEqual(pack);
  expect(pack.skills.map(skill=>skill.stableName)).toEqual(["dt-summarize-project"]);
  const source = readFileSync(AIDT_SUMMARY_SOURCE, "utf8");
  expect(Buffer.from(pack.skills[0]!.files[0]!.contentBase64,"base64").toString("utf8")).toBe(source);
  for(const phrase of ["SUM I1", "SUM I2", "SUM O1", "SUM O2", "不是第七步", "一组一份", "教师点评", "故事线", "缺失", "不可信"] ) expect(source).toContain(phrase);
  const stages = JSON.parse(readFileSync(new URL(`skills/starter-packs/${AIDT_PLATFORM_SKILL_PACK.packId}/${AIDT_PLATFORM_SKILL_PACK.packVersion}.json`,root),"utf8"));
  expect(stages.skills).toHaveLength(6); expect(stages.skills.some((s:{stableName:string})=>s.stableName==="dt-summarize-project")).toBe(false);
  expect(createHash("sha256").update(readFileSync(new URL("skills/starter-packs/aidt-methods/1.3.0.json",root))).digest("hex")).toBe("43bd0807885fb9a47d2c4dc56c5403969d2be7fda665b10d83a34a99409d40af");
});
it("is opt-in only and keeps ordinary module startup unchanged", () => {
  vi.stubEnv("ENABLE_AIDT_MODULE","0"); expect(enabledPlatformSkillPacks()).toEqual(STANDARD_PLATFORM_PACKS);
  expect(STANDARD_PLATFORM_PACKS).not.toContainEqual(AIDT_SUMMARY_SKILL_PACK);
  vi.stubEnv("ENABLE_AIDT_MODULE","1"); expect(enabledPlatformSkillPacks()).toContainEqual(AIDT_SUMMARY_SKILL_PACK);
});
it("builds deterministically and refuses a changed existing release rather than overwriting bytes", () => {
  const directory=mkdtempSync(join(tmpdir(),"aidt-summary-release-"));
  try {
    const pack=buildAidtSummaryPack(); expect(buildAidtSummaryPack()).toEqual(pack);
    const first=checkOrWriteAidtSummaryPack(pack,directory); expect(first.created).toBe(true);
    expect(checkOrWriteAidtSummaryPack(pack,directory,true).created).toBe(false);
    writeFileSync(first.path,"changed bytes\n"); expect(()=>checkOrWriteAidtSummaryPack(pack,directory)).toThrow("never overwrite");
    expect(readFileSync(first.path,"utf8")).toBe("changed bytes\n");
  } finally { rmSync(directory,{recursive:true,force:true}); }
});

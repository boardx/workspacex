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
it("keeps both earlier summary releases and authoring bytes immutable and reproducible under their original coordinates", () => {
  const releases = [
    {version:"1.0.0",source:"skills/aidt-reporting/dt-summarize-project/SKILL.md",sourceHash:"1e003889c2cc2e9a9f866adbb7163cfe55505620271e379f748f79be660ba286",packHash:"ccf956f35998325fe48586c8d7372b5225435eb2489193baa6d1eeb44f8dffb7"},
    {version:"1.0.1",source:"skills/aidt-reporting-candidates/1.0.1/dt-summarize-project/SKILL.md",sourceHash:"12c08a161b04d9bd971f578a60ead2e2748774ad1261a9fa430d21610b1358fd",packHash:"3ea83de72863f7c2550984fc988515460e5f35a940237c74d2ef3c28b8ba05ba"},
  ];
  for(const release of releases){
    const source=new URL(release.source,root),packPath=new URL(`skills/starter-packs/aidt-project-summary/${release.version}.json`,root);
    const before=readFileSync(packPath);
    expect(createHash("sha256").update(readFileSync(source)).digest("hex")).toBe(release.sourceHash);
    expect(createHash("sha256").update(before).digest("hex")).toBe(release.packHash);
    const pack=buildAidtSummaryPack(source.pathname,{packId:"aidt-project-summary",packVersion:release.version});
    expect(pack).toEqual(verifySkillStarterPack(JSON.parse(before.toString("utf8")),{packId:"aidt-project-summary",packVersion:release.version}));
    expect(checkOrWriteAidtSummaryPack(pack,new URL("skills/starter-packs/aidt-project-summary/",root).pathname,true).created).toBe(false);
    expect(readFileSync(packPath)).toEqual(before);
  }
});
it("requests a complete bounded report before expansion without deleting uncertainty or merging frozen questions",()=>{
  const source=readFileSync(AIDT_SUMMARY_SOURCE,"utf8");
  expect(AIDT_SUMMARY_SKILL_PACK).toEqual({packId:"aidt-project-summary",packVersion:"1.0.2"});
  for(const rule of ["先交一份完整紧凑报告","约800–1000中文字","先覆盖全部章节与关键学习链","再按学生请求逐节展开","默认紧凑草稿可按以下八项组织","学生可改名、合并或重排章节","不将八章设为软件/课程必填模板","自检实质内容覆盖，不检查固定章节数量","不在正文复制长UUID或整个来源目录","完整资源引用由实际来源附录保留","不捏造附录","每个句子完整","问题不同按旧冻结问题分别叙述，不混题","当前验证问题不能覆盖旧题","旧回2→新回5","尚未开展测试及下一步计划","报告正文必须披露","不得自行写确认字段","不得以短引用推断版本继承关系"])expect(source).toContain(rule);
  expect(source).not.toContain("先给目录/草稿");
  expect(source).not.toContain("先交部分草稿并列待补项");
  expect(source).not.toContain("正文按八个短章组织");
  expect(source).not.toContain("八章齐全");
});

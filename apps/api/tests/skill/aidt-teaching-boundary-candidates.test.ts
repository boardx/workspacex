/** Source/pack regressions only. A passing check does not establish model adherence. */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AIDT_METHODS_CANDIDATE, AIDT_METHODS_CANDIDATE_SOURCE_ROOT, buildAidtMethodsPack, checkOrWriteAidtMethodsPack } from "../../scripts/build-aidt-methods-pack";
import { AIDT_SUMMARY_CANDIDATE, AIDT_SUMMARY_CANDIDATE_SOURCE, buildAidtSummaryPack, checkOrWriteAidtSummaryPack } from "../../scripts/build-aidt-summary-pack";
import { sha256, verifySkillStarterPack } from "../../src/domain/skill/starter-pack";
import { AIDT_PLATFORM_SKILL_PACK, AIDT_SUMMARY_SKILL_PACK } from "../../src/infrastructure/aidt/aidt-module";

const root = new URL("../../../../", import.meta.url);
const temporary: string[] = [];
afterEach(() => { for (const path of temporary.splice(0)) rmSync(path, { recursive: true, force: true }); });
const methods = () => buildAidtMethodsPack(AIDT_METHODS_CANDIDATE_SOURCE_ROOT, AIDT_METHODS_CANDIDATE);
const summary = () => buildAidtSummaryPack(AIDT_SUMMARY_CANDIDATE_SOURCE, AIDT_SUMMARY_CANDIDATE);
const content = (name: string) => readFileSync(join(AIDT_METHODS_CANDIDATE_SOURCE_ROOT, name, "SKILL.md"), "utf8");

describe("opt-in teaching boundary release candidates", () => {
  it("selects new opt-in coordinates while retaining published bytes", () => {
    expect(AIDT_PLATFORM_SKILL_PACK).toEqual({ packId: "aidt-methods", packVersion: "1.3.2" });
    expect(AIDT_SUMMARY_SKILL_PACK).toEqual({ packId: "aidt-project-summary", packVersion: "1.0.2" });
    for (const [path, digest] of [
      ["aidt-methods/1.3.0.json", "43bd0807885fb9a47d2c4dc56c5403969d2be7fda665b10d83a34a99409d40af"],
      ["aidt-methods/1.3.1.json", "f0371a57c32b4bec955d83267a5f4f3d1c8c63f2460dcd685727d4503b55020b"],
      ["aidt-project-summary/1.0.0.json", "ccf956f35998325fe48586c8d7372b5225435eb2489193baa6d1eeb44f8dffb7"],
      ["aidt-project-summary/1.0.1.json", "3ea83de72863f7c2550984fc988515460e5f35a940237c74d2ef3c28b8ba05ba"],
    ]) expect(sha256(readFileSync(new URL(`skills/starter-packs/${path}`, root)))).toBe(digest);
    expect(buildAidtMethodsPack().packVersion).toBe("1.3.2");
    expect(buildAidtSummaryPack().packVersion).toBe("1.0.2");
  });

  it("constructs deterministic, source-identical candidates in the same stable lineage", () => {
    const pairs = [[methods(), methods(), AIDT_METHODS_CANDIDATE], [summary(), summary(), AIDT_SUMMARY_CANDIDATE]] as const;
    for (const [pack, repeated, coordinate] of pairs) {
      expect(pack).toEqual(repeated);
      expect(verifySkillStarterPack(pack, coordinate)).toEqual(pack);
      const shipped = JSON.parse(readFileSync(new URL(`skills/starter-packs/${pack.packId}/${pack.packVersion}.json`, root), "utf8"));
      expect(shipped).toEqual(pack);
      for (const skill of pack.skills) {
        const source = pack.packId === "aidt-methods" ? content(skill.stableName) : readFileSync(AIDT_SUMMARY_CANDIDATE_SOURCE, "utf8");
        expect(Buffer.from(skill.files[0]!.contentBase64, "base64").toString("utf8")).toBe(source);
        expect(skill.files[0]!.digest).toBe(sha256(source));
        expect(skill.semanticVersion).toBe(coordinate.packVersion);
        expect(source.split(/^---\s*$/m)[2]!.trimStart().split("\n")[0]).toBe("<!-- aidt-feedback-turn: return-after-student-feedback-v1 -->");
      }
    }
    expect(methods().skills.map(skill => skill.stableName)).toEqual(buildAidtMethodsPack().skills.map(skill => skill.stableName));
    expect(summary().skills[0]!.stableName).toBe("dt-summarize-project");
  });

  it("leaves the prior pinned release without the new execution opt-in", () => {
    for (const path of ["aidt-methods/1.3.0.json", "aidt-project-summary/1.0.0.json"]) {
      const pack = JSON.parse(readFileSync(new URL(`skills/starter-packs/${path}`, root), "utf8"));
      for (const skill of pack.skills) {
        const original = Buffer.from(skill.files[0].contentBase64, "base64").toString("utf8");
        expect(original).not.toContain("<!-- aidt-feedback-turn:");
        const sourceRoot = pack.packId === "aidt-methods" ? "aidt-methods" : "aidt-reporting";
        expect(readFileSync(new URL(`skills/${sourceRoot}/${skill.stableName}/SKILL.md`, root), "utf8")).toBe(original);
      }
    }
  });

  it("preserves all 1.3.1 authoring bytes and changes only S1 guidance beyond the 1.3.2 version bump", () => {
    const previous = JSON.parse(readFileSync(new URL("skills/starter-packs/aidt-methods/1.3.1.json", root), "utf8"));
    for (const skill of previous.skills) {
      const original = Buffer.from(skill.files[0].contentBase64, "base64").toString("utf8");
      expect(readFileSync(new URL(`skills/aidt-methods-candidates/1.3.1/${skill.stableName}/SKILL.md`, root), "utf8")).toBe(original);
      if (skill.stableName !== "aidt-understand") expect(content(skill.stableName)).toBe(original.replace("version: 1.3.1\n", "version: 1.3.2\n"));
    }
  });

  it("S1 preserves the student's uncertainty and obeys an explicit single neutral question request", () => {
    const text = content("aidt-understand");
    for (const rule of ["逐字引用", "忠实转述", "不得改变原句的确定程度", "困惑是否存在未知", "不能改成“看不懂”“找错位置”等已定缺陷", "用“如果……”条件化", "AI 提出的待验证假设", "由学生判断", "只有一个问号", "不要再附第二个问句、独立子问或额外作业", "非问句提示", "不因已知来源类别而否定学生后续更正"]) expect(text).toContain(rule);
  });

  it("refuses cross-lineage construction or a source/coordinate mismatch", () => {
    expect(() => buildAidtMethodsPack(AIDT_METHODS_CANDIDATE_SOURCE_ROOT, {packId: "aidt-methods", packVersion: "1.3.0"})).toThrow("source version differs");
    expect(() => buildAidtSummaryPack(AIDT_SUMMARY_CANDIDATE_SOURCE, {packId: "aidt-project-summary", packVersion: "1.0.0"})).toThrow("source version differs");
    expect(() => buildAidtMethodsPack(AIDT_METHODS_CANDIDATE_SOURCE_ROOT, { ...AIDT_METHODS_CANDIDATE, packId: "other" })).toThrow("lineage");
    expect(() => buildAidtSummaryPack(AIDT_SUMMARY_CANDIDATE_SOURCE, { ...AIDT_SUMMARY_CANDIDATE, packId: "other" })).toThrow("lineage");
  });

  it.each(["methods", "summary"])("keeps %s candidate writes exclusive and --check read-only", kind => {
    const directory = mkdtempSync(join(tmpdir(), "aidt-boundary-release-")); temporary.push(directory);
    const pack = kind === "methods" ? methods() : summary();
    const write = kind === "methods" ? checkOrWriteAidtMethodsPack : checkOrWriteAidtSummaryPack;
    expect(() => write(pack, directory, true)).toThrow("missing");
    const result = write(pack, directory);
    expect(result.created).toBe(true);
    expect(write(pack, directory, true).created).toBe(false);
    writeFileSync(result.path, "retained release bytes\n");
    expect(() => write(pack, directory)).toThrow("never overwrite");
    expect(readFileSync(result.path, "utf8")).toBe("retained release bytes\n");
  });

  it("S2 distinguishes practice and hypotheses from real participant evidence", () => {
    const text = content("aidt-empathize");
    for (const rule of ["角色扮演仅可练习提问与倾听", "假设整理仅可形成待验证问题", "模拟回答不能说明真实用户的感受或需求", "不能填入真实人物发现卡", "先拟访谈问题", "等待学生决定采纳"]) expect(text).toContain(rule);
    expect(text).not.toContain("AI 模拟采访必须标注模拟，不作为证据。");
  });

  it("S2 describes only the actual source categories and preserves consent boundaries", () => {
    const text = content("aidt-empathize");
    for (const rule of ["只列本组已有的来源类别", "目前只有猜测，没有真实观察或抱怨记录", "真实采访须取得参与者同意", "不可用个人录音笔记绕过项目访谈的同意流程"]) expect(text).toContain(rule);
  });

  it("SUM must disclose actual readable scope, truncated sources and unresolved gaps", () => {
    const text = readFileSync(AIDT_SUMMARY_CANDIDATE_SOURCE, "utf8");
    for (const rule of ["选中某项不代表全文已读取", "报告正文必须披露", "截断只解释未显示的内容", "该版理由未读到，待核对", "先交完整紧凑草稿", "在对应位置列待补项"]) expect(text).toContain(rule);
  });

  it("SUM retains visible V1/V2, original questions and historical return decisions", () => {
    const text = readFileSync(AIDT_SUMMARY_CANDIDATE_SOURCE, "utf8");
    for (const rule of ["被测试的 V1", "后来生成的 V2", "不能把新版问题倒填进旧版测试", "当前选择与历史选择分开叙述", "不能把当前返回步骤覆盖此前决定", "已可见的当前 V2 引用和返回决定必须纳入", "只有真实保存回执才能称已保存"]) expect(text).toContain(rule);
  });
});

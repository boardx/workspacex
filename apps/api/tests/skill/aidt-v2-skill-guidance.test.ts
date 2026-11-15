/** Static shipped-prompt and build invariants, not a model-behavior evaluation.
 * Actual learner turns and provider outputs still require a real configured model.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildAidtMethodsPack, checkOrWriteAidtMethodsPack } from "../../scripts/build-aidt-methods-pack";
import { sha256, verifySkillStarterPack } from "../../src/domain/skill/starter-pack";
import { AIDT_PLATFORM_SKILL_PACK } from "../../src/infrastructure/aidt/aidt-module";
const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
function source(name: string) { return readFileSync(new URL(`../../../../skills/aidt-methods/${name}/SKILL.md`, import.meta.url), "utf8"); }
describe("V2 shipped guidance requirements", () => {
  it("FR15 puts student topic value and observation/complaint/guess reflection before decomposition", () => {
    const text = source("aidt-understand");
    expect(text.indexOf("为什么这个问题值得我们研究")).toBeLessThan(text.indexOf("才协助拆解"));
    for (const rule of ["亲自观察", "抱怨", "猜测不是研究结论", "不代填现场经历", "不提前要求第三阶段的 HMW"]) expect(text).toContain(rule);
  });
  it("FR16 places a source-linked surprise or honest none before persona", () => {
    const text = source("aidt-define");
    expect(text.indexOf("在画像之前")).toBeLessThan(text.indexOf("学生先按模板综合填写用户画像"));
    for (const rule of ["暂无意外发现", "具体发现卡／原材料位置", "不强迫编造反转故事", "选择暂无可继续画像", "不强制补访", "教师", "不新增必须提交的独立用户问题卡"]) expect(text).toContain(rule);
  });
  it("FR17 keeps student multi-label categories separate from votes and distinct idea counts", () => {
    const text = source("aidt-ideate");
    for (const rule of ["最容易实现的", "最具突破性的", "最有趣的", "允许多标签", "每个标签都由学生说明分类理由", "可暂未分类", "某一类没有点子也可以", "分类与投票分开", "不得自动归类", "跨两个类别仍只是一个点子", "至少三份不同点子"]) expect(text).toContain(rule);
    expect(text).not.toContain("数量待课程确认");
    expect(text).not.toContain("三个只是可尝试的课堂目标");
  });
  it("FR18 requires the student's test question and prior view before generation, tied to a real prototype", () => {
    const text = source("aidt-prototype");
    for (const rule of ["任何原型生成前", "测试之前，我们现在怎样看", "缺少任一项时先等待学生补充", "实际保存的原型引用／版本", "不能虚构版本", "Design Workbench"]) expect(text).toContain(rule);
  });
  it("FR19 keeps learning change and student return decisions independent of producing a new prototype", () => {
    const text = source("aidt-iterate");
    for (const rule of ["不重写历史先前看法", "现在怎样看", "第 1–5 步", "不强制生成新原型", "暂不修改", "生成新版不能写成已通过测试"]) expect(text).toContain(rule);
  });
  it("keeps a single stage-adapted guide, genuine evidence and existing native tool boundaries", () => {
    for (const name of ["aidt-understand", "aidt-empathize", "aidt-define", "aidt-ideate", "aidt-prototype", "aidt-iterate"]) {
      const text = source(name);
      for (const rule of ["同一个 AI 引导师", "不另建六个独立智能体", "真实研究证据不可合成", "人做决策", "只有真实保存回执才能称已保存", "系统保存回执只证明材料已保存", "不表示全组每个人已投票", "个人录音笔记不是经过同意的项目访谈"]) expect(text).toContain(rule);
    }
  });
});
describe("immutable optional-pack release builder", () => {
  it("derives file metadata and verifies a deterministic new release", () => {
    const first = buildAidtMethodsPack();
    expect(first).toEqual(buildAidtMethodsPack());
    expect(first).toEqual(verifySkillStarterPack(first, AIDT_PLATFORM_SKILL_PACK));
    expect(first.skills).toHaveLength(6);
    for (const skill of first.skills) expect(skill.semanticVersion).toBe(AIDT_PLATFORM_SKILL_PACK.packVersion);
  });
  it("checks an identical output but refuses to overwrite different release bytes", () => {
    const dir = mkdtempSync(join(tmpdir(), "aidt-pack-builder-")); dirs.push(dir);
    const pack = buildAidtMethodsPack();
    const result = checkOrWriteAidtMethodsPack(pack, dir);
    expect(result.created).toBe(true);
    expect(checkOrWriteAidtMethodsPack(pack, dir, true)).toMatchObject({ created: false });
    writeFileSync(result.path, "existing-release-must-remain");
    expect(() => checkOrWriteAidtMethodsPack(pack, dir)).toThrow(/never overwrite/);
    expect(readFileSync(result.path, "utf8")).toBe("existing-release-must-remain");
  });
  it("does not create files during --check", () => {
    const dir = mkdtempSync(join(tmpdir(), "aidt-pack-check-")); dirs.push(dir);
    expect(() => checkOrWriteAidtMethodsPack(buildAidtMethodsPack(), dir, true)).toThrow(/missing/);
  });
  it.each([
    ["1.0.0", "66e421d4dcc2831857ab5985bcf86a5797541a6da2a1ea28fb26b5e638f3eef0"],
    ["1.1.0", "e27b320e7643ca8457ddef4588490025747f1308f180c5d780f5b4e166d96ddf"],
    ["1.2.0", "2c71c9c30ddcf4b9d69f697e12a274de25c3bbec977b4f1528e590fea119bed5"],
  ])("preserves the published %s release bytes", (version, expected) => {
    const bytes = readFileSync(new URL(`../../../../skills/starter-packs/aidt-methods/${version}.json`, import.meta.url));
    expect(sha256(bytes)).toBe(expected);
    expect(verifySkillStarterPack(JSON.parse(bytes.toString("utf8")), { packId: AIDT_PLATFORM_SKILL_PACK.packId, packVersion: version }).packVersion).toBe(version);
  });
});

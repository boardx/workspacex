/**
 * lint-skill-metadata-source 的反证套件（issue #3154）。
 * 每条断言都先造一种破坏方式确认它会红。最后一组是**反向反证**：真仓库今天必须判绿，
 * 且解析器/计数器确实抓到了数据——正则失配会让全称断言平凡为真。
 *
 * ⚠ 收敛前这份套件的「真仓库判绿」那条是**红的**：那时 10 个 build.ts 全都手写着
 *   `semanticVersion:'1.1.0'` / `capabilityId:'WX-S016'`，且 7 个 SKILL.md 的 frontmatter
 *   根本没有 version / capability_id。它是这次修复的反证锚点。
 */
import { describe, it, expect } from "vitest";
// @ts-expect-error —— .mjs 无类型声明
import { checkSkillMetadataSource, inspectBuildScript, stripCommentsAndStrings, loadRecords, run, LEGACY_NESTED_METADATA } from "./lint-skill-metadata-source.mjs";

interface Offence { readonly field: string; readonly total: number; readonly conforming: number }
interface Build { readonly sourceFile: string; readonly offending: readonly Offence[]; readonly importsReader: boolean; readonly callsReader: boolean }
interface Skill { readonly key: string; readonly error: string | null; readonly nestedMetadata: boolean }

const cleanBuild = (over: Partial<Build> = {}): Build =>
  ({ sourceFile: "skills/p/scripts/build.ts", offending: [], importsReader: true, callsReader: true, ...over });
const cleanSkill = (key: string, over: Partial<Skill> = {}): Skill =>
  ({ key, error: null, nestedMetadata: false, ...over });

const CONFORMING_BUILD = `
import {parseSkillFrontmatter} from '../../../apps/api/src/domain/skill/skill-frontmatter';
const meta=parseSkillFrontmatter(readFileSync('SKILL.md','utf8'),'a');
const skills=[{stableName:meta.stableName,name:'显示名',semanticVersion:meta.semanticVersion,manifest:{capabilityId:meta.capabilityId},files}];
`;

describe("判定①：build.ts 不许自己写这三个字段的值", () => {
  it("合规写法（右值就是 frontmatter 对象的同名字段）⇒ 零违规", () => {
    expect(inspectBuildScript(CONFORMING_BUILD).offending).toEqual([]);
  });
  it("字面量 semanticVersion ⇒ 红并报出计数", () => {
    const source = CONFORMING_BUILD.replace("semanticVersion:meta.semanticVersion", "semanticVersion:'1.1.0'");
    expect(inspectBuildScript(source).offending).toEqual([{ field: "semanticVersion", total: 1, conforming: 0 }]);
  });
  it("字面量 capabilityId ⇒ 红", () => {
    const source = CONFORMING_BUILD.replace("capabilityId:meta.capabilityId", "capabilityId:'WX-S016'");
    expect(inspectBuildScript(source).offending.map((o: Offence) => o.field)).toEqual(["capabilityId"]);
  });
  it("三元表达式算出来的 semanticVersion ⇒ 红（standard-audio 迁移前的真实写法）", () => {
    const source = CONFORMING_BUILD.replace("semanticVersion:meta.semanticVersion", "semanticVersion:stableName==='meeting-minutes'?'1.1.1':'1.1.0'");
    expect(inspectBuildScript(source).offending.some((o: Offence) => o.field === "semanticVersion")).toBe(true);
  });
  it("从字面量表解构出来的变量再简写 ⇒ 红（standard-context 迁移前的真实写法）", () => {
    const source = CONFORMING_BUILD.replace("stableName:meta.stableName", "stableName");
    expect(inspectBuildScript(source).offending.some((o: Offence) => o.field === "stableName")).toBe(true);
  });
  it("注释里提到字段名不算声明——不许因为写了说明就判红", () => {
    const source = `// semanticVersion / stableName / capabilityId 都从 frontmatter 读\n${CONFORMING_BUILD}`;
    expect(inspectBuildScript(source).offending).toEqual([]);
  });
  it("字符串里的 // 不会把后半行当注释吃掉", () => {
    expect(stripCommentsAndStrings("const a='https://x/y',capabilityId:m.capabilityId;")).toBe('const a="",capabilityId:m.capabilityId;');
  });
  it("违规计数原样进 failures 并点名文件", () => {
    const r = checkSkillMetadataSource([cleanBuild({ offending: [{ field: "capabilityId", total: 3, conforming: 1 }] })], [cleanSkill("p/a")], []);
    expect(r.ok).toBe(false);
    expect(r.failures[0]).toMatch(/skills\/p\/scripts\/build\.ts: capabilityId 在构建脚本里出现 3 次/);
  });
});

describe("判定②：反空转——不读 frontmatter 的脚本上判定①平凡为真", () => {
  it("没 import 单源解析器 ⇒ 红", () => {
    const r = checkSkillMetadataSource([cleanBuild({ importsReader: false })], [cleanSkill("p/a")], []);
    expect(r.failures[0]).toMatch(/没有 import .*parseSkillFrontmatter/);
  });
  it("import 了却没调用 ⇒ 红", () => {
    const r = checkSkillMetadataSource([cleanBuild({ callsReader: false })], [cleanSkill("p/a")], []);
    expect(r.failures[0]).toMatch(/却没调用它/);
  });
  it("真实构建脚本确实 import 并调用了它", () => {
    const probe = inspectBuildScript(CONFORMING_BUILD);
    expect(probe.importsReader).toBe(true);
    expect(probe.callsReader).toBe(true);
  });
});

describe("判定③：SKILL.md 解析不出来就红，不是判绿", () => {
  it("解析器的报错原样进 failures", () => {
    const r = checkSkillMetadataSource([cleanBuild()], [cleanSkill("p/a", { error: "frontmatter 缺 version" })], []);
    expect(r.ok).toBe(false);
    expect(r.failures[0]).toBe("p/a: frontmatter 缺 version");
  });
});

describe("判定④：metadata: 嵌套名单只减不增", () => {
  it("名单外的嵌套写法 ⇒ 红（新增一律顶层）", () => {
    const r = checkSkillMetadataSource([cleanBuild()], [cleanSkill("p/new", { nestedMetadata: true })], []);
    expect(r.failures[0]).toMatch(/嵌在 metadata: 下——新增一律顶层写/);
  });
  it("名单内的嵌套写法 ⇒ 绿（记账，不阻断）", () => {
    expect(checkSkillMetadataSource([cleanBuild()], [cleanSkill("p/old", { nestedMetadata: true })], ["p/old"]).ok).toBe(true);
  });
  it("名单条目已经改成顶层却没删 ⇒ 红（陈旧条目会让上限变成移动靶）", () => {
    const r = checkSkillMetadataSource([cleanBuild()], [cleanSkill("p/fixed")], ["p/fixed"]);
    expect(r.failures[0]).toMatch(/已经改成顶层写法，但还留在 LEGACY_NESTED_METADATA/);
  });
  it("名单条目在仓库里找不到 ⇒ 红", () => {
    expect(checkSkillMetadataSource([cleanBuild()], [cleanSkill("p/a")], ["gone/skill"]).failures[0]).toMatch(/找不到——名单陈旧/);
  });
});

describe("空集防线：没有对象不等于没有问题", () => {
  it("一个 build.ts 都没扫到 ⇒ 红", () => {
    expect(checkSkillMetadataSource([], [cleanSkill("p/a")], []).failures[0]).toMatch(/一个都没扫到/);
  });
  it("一个 SKILL.md 都没扫到 ⇒ 红", () => {
    expect(checkSkillMetadataSource([cleanBuild()], [], []).failures[0]).toMatch(/一个 SKILL\.md 都没扫到/);
  });
  it("加载期错误原样进 failures（拒绝下判断，不是判绿）", () => {
    expect(checkSkillMetadataSource([cleanBuild()], [cleanSkill("p/a")], [], ["skills/ 目录不存在"]).ok).toBe(false);
  });
  it("全都干净 ⇒ 绿（反向反证：一道永远红的门控等于没有）", () => {
    expect(checkSkillMetadataSource([cleanBuild()], [cleanSkill("p/a")], [])).toMatchObject({ ok: true, failures: [] });
  });
});

describe("真仓库", () => {
  it("扫到 10 个构建脚本、10 个以上 SKILL.md，且没有加载期错误", () => {
    const { builds, skills, loadErrors } = loadRecords();
    expect(loadErrors).toEqual([]);
    expect(builds.length).toBe(10);
    expect(skills.length).toBeGreaterThan(10);
  });
  it("今天判绿；metadata: 嵌套遗留正好是名单里那 5 条", () => {
    expect(run()).toMatchObject({ ok: true });
    expect(LEGACY_NESTED_METADATA.length).toBe(5);
    expect(run().nested).toBe(5);
  });
});

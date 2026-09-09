/**
 * lint-skill-metadata-source 的反证套件。
 * 每条断言都先造一种破坏方式确认它会红。最后一组是**反向反证**：真仓库今天必须判绿，
 * 且解析器确实抓到了数据——正则失配会让全称断言平凡为真。
 */
import { describe, it, expect } from "vitest";
// @ts-expect-error —— .mjs 无类型声明
import { checkSkillMetadata, readFrontmatter, loadRecords, run, CONVENTION_DEBT } from "./lint-skill-metadata-source.mjs";

const complete = (key: string, over: Record<string, unknown> = {}) => ({
  key,
  built: { stableName: key.split("/")[1], semanticVersion: "1.0.0", capabilityId: "WX-S001" },
  frontmatter: { name: key.split("/")[1], version: "1.0.0", capability_id: "WX-S001", ...over },
});

describe("判定①：两处都出现的字段必须逐字相等", () => {
  it("version 漂移 ⇒ 红并点名两侧的值", () => {
    const r = checkSkillMetadata([complete("p/a", { version: "9.9.9" })], []);
    expect(r.ok).toBe(false);
    expect(r.failures[0]).toMatch(/version 两处不一致.*"9\.9\.9".*"1\.0\.0"/);
  });
  it("capability_id 漂移 ⇒ 红", () => {
    expect(checkSkillMetadata([complete("p/a", { capability_id: "WX-S999" })], []).ok).toBe(false);
  });
  it("stable_name 漂移 ⇒ 红", () => {
    expect(checkSkillMetadata([complete("p/a", { name: "renamed" })], []).ok).toBe(false);
  });
  it("全一致 ⇒ 绿（反向反证：一道永远红的门控等于没有）", () => {
    expect(checkSkillMetadata([complete("p/a")], [])).toMatchObject({ ok: true, failures: [] });
  });
  it("债务名单不豁免判定①——名单里的 skill 字段冲突照样红", () => {
    const rec = complete("p/a", { version: null, capability_id: null, name: "renamed" });
    expect(checkSkillMetadata([rec], ["p/a"]).failures.some((f: string) => /stable_name 两处不一致/.test(f))).toBe(true);
  });
});

describe("判定②：约定一致性，债务名单只减不增", () => {
  it("名单外的 skill 缺字段 ⇒ 红（新增不许再少写）", () => {
    const r = checkSkillMetadata([complete("p/new", { version: null })], []);
    expect(r.failures[0]).toMatch(/缺 version——约定是三个字段都写/);
  });
  it("名单内的 skill 缺字段 ⇒ 绿（记账，不阻断）", () => {
    expect(checkSkillMetadata([complete("p/old", { version: null, capability_id: null })], ["p/old"]).ok).toBe(true);
  });
  it("名单条目已补齐却没删 ⇒ 红（陈旧条目会让债务上限变成移动靶）", () => {
    const r = checkSkillMetadata([complete("p/fixed")], ["p/fixed"]);
    expect(r.failures[0]).toMatch(/已补齐，但还留在 CONVENTION_DEBT 名单里/);
  });
  it("名单条目在仓库里找不到 ⇒ 红", () => {
    expect(checkSkillMetadata([complete("p/a")], ["gone/skill"]).failures[0]).toMatch(/找不到——名单陈旧/);
  });
});

describe("空集防线：没有对象不等于没有问题", () => {
  it("一个 skill 都没扫到 ⇒ 红", () => {
    expect(checkSkillMetadata([], []).ok).toBe(false);
  });
  it("SKILL.md 没有 frontmatter ⇒ 红（取不到声明不等于一致）", () => {
    const r = checkSkillMetadata([{ ...complete("p/a"), frontmatter: null }], []);
    expect(r.failures[0]).toMatch(/没有 frontmatter/);
  });
  it("加载期错误原样进 failures（拒绝下判断，不是判绿）", () => {
    expect(checkSkillMetadata([complete("p/a")], [], ["构建产物不存在"]).ok).toBe(false);
  });
});

describe("frontmatter 解析器对两种真实写法都有效", () => {
  it("顶层字段", () => {
    expect(readFrontmatter("---\nname: a\nversion: 1.0.0\ncapability_id: WX-S001\n---\n#")).toEqual({ name: "a", version: "1.0.0", capability_id: "WX-S001" });
  });
  it("metadata 嵌一层（standard-authoring 的写法）", () => {
    expect(readFrontmatter("---\nname: a\nmetadata:\n  capability_id: WX-S015\n  version: 1.0.0\n---\n#")).toEqual({ name: "a", version: "1.0.0", capability_id: "WX-S015" });
  });
  it("没有 frontmatter ⇒ null，不是空对象", () => {
    expect(readFrontmatter("# 没有 frontmatter")).toBeNull();
  });
});

describe("真仓库", () => {
  it("扫到 10 个以上 skill 且 build 侧字段非空——正则失配会让全称断言平凡为真", () => {
    const { records, loadErrors } = loadRecords();
    expect(loadErrors).toEqual([]);
    expect(records.length).toBeGreaterThan(10);
    expect(records.every((r: { built: { stableName?: string; semanticVersion?: string; capabilityId?: string } }) => r.built.stableName && r.built.semanticVersion && r.built.capabilityId)).toBe(true);
  });
  it("今天判绿，且债务名单正好是那 7 条现存缺口", () => {
    expect(run()).toMatchObject({ ok: true });
    expect(CONVENTION_DEBT.length).toBe(7);
  });
});

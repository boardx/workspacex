/**
 * lint-shipped-pack-version 的反证套件。
 *
 * 本仓已九次「全绿但空转」。每条断言都先造一种真实发生过的破坏方式，确认它会红，
 * 才有资格相信它绿的时候说明了什么。最后两组是**反向反证**：一致的输入必须判绿
 * （一道永远红的门控等于没有），以及真仓库解析器确实抓得到今天的数据
 * （正则失配会让全称断言平凡为真）。
 */
import { describe, it, expect } from "vitest";
// @ts-expect-error —— .mjs 无类型声明，故意直接引
import { checkPackVersions, parseBuildScript, parseSeeder, loadBuilds } from "./lint-shipped-pack-version.mjs";

const build = (packId: string, packVersion: string) => ({ packId, packVersion, sourceFile: `skills/${packId}/scripts/build.ts` });
const allExist = () => true;

describe("发货版本 ≠ 构建版本", () => {
  it("点名漂移的包并给出两侧版本（这正是 standard-web 今天的形状）", () => {
    const r = checkPackVersions([build("standard-web", "1.1.2")], [{ packId: "standard-web", packVersion: "1.1.1" }], allExist);
    expect(r.ok).toBe(false);
    expect(r.failures.join("\n")).toMatch(/standard-web: 发货版本 1\.1\.1.*≠ 构建版本 1\.1\.2/);
  });

  it("版本一致就判绿——反向反证，否则这道门永远红", () => {
    const r = checkPackVersions([build("standard-web", "1.1.2")], [{ packId: "standard-web", packVersion: "1.1.2" }], allExist);
    expect(r).toMatchObject({ ok: true, failures: [] });
  });
});

describe("两侧集合必须互相覆盖", () => {
  it("构建了却没发货 ⇒ 红", () => {
    const r = checkPackVersions([build("ghost", "1.0.0")], [{ packId: "standard-web", packVersion: "1.1.1" }], allExist);
    expect(r.failures.some((f: string) => /ghost.*从没发货/.test(f))).toBe(true);
  });
  it("发货了却没有 build.ts ⇒ 红", () => {
    const r = checkPackVersions([build("standard-web", "1.1.1")], [{ packId: "standard-web", packVersion: "1.1.1" }, { packId: "phantom", packVersion: "1.0.0" }], allExist);
    expect(r.failures.some((f: string) => /phantom.*build\.ts 不存在/.test(f))).toBe(true);
  });
  it("发货版本的清单文件不存在 ⇒ 红", () => {
    const r = checkPackVersions([build("standard-web", "1.1.1")], [{ packId: "standard-web", packVersion: "1.1.1" }], () => false);
    expect(r.failures.some((f: string) => /清单 skills\/starter-packs\/standard-web\/1\.1\.1\.json 不存在/.test(f))).toBe(true);
  });
});

describe("空集防线：没有对象不等于没有问题", () => {
  it("一个 build.ts 都没扫到 ⇒ 红", () => {
    expect(checkPackVersions([], [{ packId: "x", packVersion: "1" }], allExist).ok).toBe(false);
  });
  it("seeder 结构解析不出来 ⇒ 红（拒绝下判断，不是判绿）", () => {
    const r = checkPackVersions([build("standard-web", "1.1.1")], null, allExist);
    expect(r.failures.some((f: string) => /STANDARD_PLATFORM_PACKS.*没解析出来/.test(f))).toBe(true);
  });
  it("解析出 0 条发货条目 ⇒ 红", () => {
    expect(checkPackVersions([build("a", "1")], [], allExist).ok).toBe(false);
  });
});

describe("解析器对真实文件形状有效", () => {
  it("build.ts 的单行紧凑写法能取到 packId/packVersion", () => {
    expect(parseBuildScript("const unsigned={schemaVersion:1,packId:'standard-web',packVersion:'1.1.2',skills};")).toEqual({ packId: "standard-web", packVersion: "1.1.2" });
  });
  it("seeder 的 as const 数组能取到全部条目", () => {
    const parsed = parseSeeder("export const STANDARD_PLATFORM_PACKS = [\n {packId:'a',packVersion:'1.0.0'},\n {packId:'b',packVersion:'2.0.0'},\n] as const;");
    expect(parsed).toEqual([{ packId: "a", packVersion: "1.0.0" }, { packId: "b", packVersion: "2.0.0" }]);
  });
  it("真仓库里确实扫到多个包且字段非空——正则失配会让全称断言平凡为真", () => {
    const builds = loadBuilds();
    expect(builds.length).toBeGreaterThan(1);
    expect(builds.every((b: { packId: string | null; packVersion: string | null }) => b.packId && b.packVersion)).toBe(true);
  });
});

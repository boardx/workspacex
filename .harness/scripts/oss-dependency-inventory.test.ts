/**
 * 依赖许可证盘点的回归测试。三个 bug 各钉一条（2026-09-24 实跑发现）：
 *   ① 只读根目录 node_modules/<名字>，pnpm 的 .pnpm 布局读不到——装了依赖也只解析出 42 / 2163；
 *   ② 需确认名单逐字匹配开头，LGPL / MPL / 复合表达式全部漏过，报「0 个需确认」；
 *   ③ 不分生产与开发依赖——开发工具的许可证不构成再分发，混在一起会让真问题淹没在噪音里。
 * 全部离线跑（不带 --registry），测试不依赖网络。
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { needsReview } from "./lib/spdx-review.mjs";

const ROOT = join(import.meta.dirname, "../..");
const SCRIPT = join(ROOT, ".harness/scripts/oss-dependency-inventory.mjs");
const installed = existsSync(join(ROOT, "node_modules", ".pnpm"));

type Report = {
  totalPackages: number;
  resolved: number;
  shippedPackages: number;
  needsReview: { name: string; license: string; shipped: boolean }[];
};
let dir = "";
let report: Report;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "dep-inventory-"));
  const out = join(dir, "r.json");
  const r = spawnSync("node", [SCRIPT, "--json", out], { cwd: ROOT, encoding: "utf8" });
  expect(r.status).toBe(0);
  report = JSON.parse(readFileSync(out, "utf8")) as Report;
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe.skipIf(!installed)("oss-dependency-inventory", () => {
  it("① 读得到 pnpm 的 .pnpm 布局：离线也能解析绝大多数包", () => {
    // 离线时只有别的平台的二进制读不到；初版在同样条件下只解析出 42 个
    expect(report.resolved / report.totalPackages).toBeGreaterThan(0.8);
  });

  it("② LGPL 不以 GPL 开头，也必须进需确认名单", () => {
    expect(report.needsReview.some((r) => /^LGPL/.test(r.license))).toBe(true);
  });


  it("③ 区分是否随产品分发，且分发闭包不是空集也不是全集", () => {
    expect(report.shippedPackages).toBeGreaterThan(100);
    expect(report.shippedPackages).toBeLessThan(report.totalPackages);
    expect(report.needsReview.some((r) => !r.shipped)).toBe(true);
  });
});

describe("needsReview（SPDX 表达式）", () => {
  it.each([
    ["LGPL-3.0-or-later", true, "LGPL 不以 GPL 开头，初版漏过"],
    ["MPL-2.0", true, "弱 copyleft，初版漏过"],
    ["Apache-2.0 AND LGPL-3.0-or-later", true, "AND：任一要确认就算（sharp 的 libvips 就是这个）"],
    ["(MIT OR GPL-3.0-or-later)", false, "OR：可以只选 MIT"],
    ["(MPL-2.0 OR Apache-2.0)", false, "OR：可以只选 Apache"],
    ["GPL-3.0 OR AGPL-3.0", true, "OR 的每个选项都要确认"],
    ["MIT", false, "宽松许可"],
    ["BlueOak-1.0.0", false, "宽松许可"],
  ])("%s ⇒ %s（%s）", (expr, expected) => {
    expect(needsReview(expr)).toBe(expected);
  });
});

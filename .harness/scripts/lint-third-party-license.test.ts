/** lint-third-party-license 的反例测试（#4262）：用临时的盘点 JSON，不依赖真实 node_modules。 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const SCRIPT = join(import.meta.dirname, "lint-third-party-license.mjs");
const made: string[] = [];
afterEach(() => { while (made.length) rmSync(made.pop()!, { recursive: true, force: true }); });

type Pkg = { name: string; version: string; license: string | null; shipped: boolean; installed: boolean };
function run(packages: Pkg[], reviewed: unknown[] = [], nodeModulesPresent = true) {
  const dir = mkdtempSync(join(tmpdir(), "tp-license-test-"));
  made.push(dir);
  const w = (n: string, v: unknown) => { writeFileSync(join(dir, n), JSON.stringify(v)); return join(dir, n); };
  const inv = w("inv.json", { nodeModulesPresent, packages });
  const pol = w("pol.json", { allow: ["MIT", "Apache-2.0", "ISC", "BSD-3-Clause"], aliases: { "MIT/X11": "MIT" } });
  const rev = w("rev.json", { reviewed });
  return spawnSync("node", [SCRIPT, "--inventory", inv, "--policy", pol, "--reviewed", rev], { encoding: "utf8" });
}
const p = (name: string, license: string | null, extra: Partial<Pkg> = {}): Pkg =>
  ({ name, version: "1.0.0", license, shipped: true, installed: true, ...extra });

describe("lint-third-party-license", () => {
  it("全是允许清单内的许可证（含别名、LICENSE 文件后缀、OR / AND 表达式）→ 通过", () => {
    const r = run([p("a", "MIT"), p("b", "MIT/X11"), p("c", "MIT(LICENSE 文件)"), p("d", "(MIT OR GPL-3.0-or-later)"), p("e", "(Apache-2.0 AND BSD-3-Clause)")]);
    expect(r.status).toBe(0);
  });

  it("反例：分发闭包里的 GPL 包没登记 → 失败并点名", () => {
    const r = run([p("a", "MIT"), p("evil", "GPL-3.0-only")]);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("evil@1.0.0");
  });

  it("反例：AND 里有一项不允许 → 失败；未声明许可证 → 失败", () => {
    expect(run([p("x", "MIT AND LGPL-3.0-or-later")]).status).toBe(1);
    const r = run([p("nolic", null)]);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("nolic@1.0.0");
  });

  it("已审登记且许可证原文一致 → 放行；许可证变了 → 重新变红", () => {
    const rev = [{ package: "m@1.0.0", license: "MPL-2.0", reason: "t" }];
    expect(run([p("m", "MPL-2.0")], rev).status).toBe(0);
    const r = run([p("m", "AGPL-3.0-only")], rev);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("重新审");
  });

  it("开发依赖与本机未装的包不判", () => {
    expect(run([p("a", "MIT"), p("dev", "GPL-3.0-only", { shipped: false }), p("win", null, { installed: false })]).status).toBe(0);
  });

  it("反例：node_modules 不存在或分发闭包为空 → 失败（空集不是全绿）", () => {
    expect(run([p("a", "MIT")], [], false).status).toBe(1);
    expect(run([]).status).toBe(1);
  });
});

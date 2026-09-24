/**
 * 这道门自己的门：它得**真的被跑到**，也得**真的会红**。
 *
 * 只测「当前仓库退出码 0」是不够的——一道永远退出 0 的门同样能通过那条断言。
 * 所以对三种违规各造一个反例，要求每一个都判失败；再造一个空目录，要求空集不判绿。
 */
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const ROOT = join(import.meta.dirname, "../..");
const SCRIPT = join(ROOT, ".harness/scripts/lint-contracts-no-workspace-deps.mjs");

const made: string[] = [];
function fixture(pkg: Record<string, unknown>, files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "contracts-deps-"));
  made.push(root);
  const dir = join(root, "packages", "contracts");
  mkdirSync(join(dir, "src"), { recursive: true });
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "@repo/contracts", ...pkg }));
  for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, "src", name), text);
  return root;
}
function run(root: string) {
  return spawnSync("node", [SCRIPT, "--root", root], { encoding: "utf8" });
}
afterEach(() => {
  while (made.length) rmSync(made.pop()!, { recursive: true, force: true });
});

describe("lint-contracts-no-workspace-deps", () => {
  it("package.json 里有这条脚本，且接进了 verify:harness:raw", () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as {
      scripts: Record<string, string>;
    };
    expect(pkg.scripts["lint:contracts-no-workspace-deps"]).toContain("lint-contracts-no-workspace-deps.mjs");
    expect(pkg.scripts["verify:harness:raw"]).toContain("lint:contracts-no-workspace-deps");
  });

  it("当前仓库是干净的，且确实扫到了文件", () => {
    const out = execFileSync("node", [SCRIPT], { encoding: "utf8" });
    expect(out).toMatch(/违规 0 处/);
    expect(out).not.toMatch(/扫描 package\.json \+ 0 个/);
  });

  it("干净的反例对照组判绿", () => {
    const r = run(fixture({ dependencies: { zod: "^3" } }, { "a.ts": 'import { z } from "zod";\nimport { b } from "./b";\n', "b.ts": "export const b = 1;\n" }));
    expect(r.status).toBe(0);
  });

  it("① package.json 依赖工作区包 ⇒ 红", () => {
    const r = run(fixture({ dependencies: { "@repo/maau-postinvest-report": "workspace:*" } }, { "a.ts": "export {};\n" }));
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("@repo/maau-postinvest-report");
  });

  it("② 源码 import 工作区包 ⇒ 红（含 import type 与动态 import）", () => {
    for (const line of [
      'import { THRESHOLDS } from "@repo/maau-postinvest-report";',
      'import type { X } from "@repo/coord-protocol";',
      'const m = await import("@repo/anything");',
    ]) {
      const r = run(fixture({}, { "a.ts": line + "\n" }));
      expect(r.status, line).toBe(1);
    }
  });

  it("③ 相对路径跳出契约包 ⇒ 红", () => {
    const r = run(fixture({}, { "a.ts": 'import { t } from "../../maau-postinvest-report/src/index";\n' }));
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("跳出了契约包目录");
  });

  it("扫到 0 个源码文件 ⇒ 不许判绿", () => {
    const r = run(fixture({}, {}));
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("空集不是全绿");
  });
});

/**
 * 这道门自己的门：真的被跑到、真的会红。三种违规各一个反例，空集不判绿，
 * 以及「ee → oss」这个允许的方向不误报。
 */
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const ROOT = join(import.meta.dirname, "../..");
const SCRIPT = join(ROOT, ".harness/scripts/lint-ee-boundary.mjs");

const made: string[] = [];
type Pkg = { pkg?: Record<string, unknown>; files?: Record<string, string> };
/** apps/api 在归属表里是 oss，拿它当开源方；packages/ee-sso 由目录名自动归为企业版。 */
function fixture(api: Pkg, ee: Pkg = {}, withEe = true): string {
  const root = mkdtempSync(join(tmpdir(), "ee-boundary-"));
  made.push(root);
  const put = (dir: string, name: string, p: Pkg) => {
    mkdirSync(join(root, dir, "src"), { recursive: true });
    writeFileSync(join(root, dir, "package.json"), JSON.stringify({ name, ...p.pkg }));
    for (const [f, t] of Object.entries(p.files ?? {})) {
      mkdirSync(dirname(join(root, dir, f)), { recursive: true });
      writeFileSync(join(root, dir, f), t);
    }
  };
  put("apps/api", "@repo/api", api);
  if (withEe) put("packages/ee-sso", "@repo/ee-sso", ee);
  return root;
}
const run = (root: string) => spawnSync("node", [SCRIPT, "--root", root], { encoding: "utf8" });
afterEach(() => {
  while (made.length) rmSync(made.pop()!, { recursive: true, force: true });
});

describe("lint-ee-boundary", () => {
  it("package.json 里有这条脚本，且接进了 verify:harness:raw", () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as { scripts: Record<string, string> };
    expect(pkg.scripts["lint:ee-boundary"]).toContain("lint-ee-boundary.mjs");
    expect(pkg.scripts["verify:harness:raw"]).toContain("lint:ee-boundary");
  });

  it("当前仓库干净，且确实扫到了开源包文件", () => {
    const out = execFileSync("node", [SCRIPT], { encoding: "utf8" });
    expect(out).toMatch(/违规 0 处/);
    expect(out).not.toMatch(/源码文件 0 个/);
  }, 30_000);

  it("对照组：开源方干净、企业版依赖开源方 ⇒ 绿", () => {
    const r = run(fixture(
      { files: { "src/a.ts": 'import { b } from "./b";\n', "src/b.ts": "export const b = 1;\n" } },
      { pkg: { dependencies: { "@repo/api": "workspace:*" } }, files: { "src/x.ts": 'import "@repo/api";\n' } },
    ));
    expect(r.status, r.stderr).toBe(0);
  });

  it("① package.json 依赖企业版包 ⇒ 红", () => {
    const r = run(fixture({ pkg: { dependencies: { "@repo/ee-sso": "workspace:*" } }, files: { "src/a.ts": "export {};\n" } }));
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("@repo/ee-sso");
  });

  it("② 源码 import 企业版包 ⇒ 红（含子路径、import type、动态 import）", () => {
    for (const line of [
      'import { x } from "@repo/ee-sso";',
      'import type { X } from "@repo/ee-sso/types";',
      'const m = await import("@repo/ee-sso");',
    ]) {
      const r = run(fixture({ files: { "src/a.ts": line + "\n" } }));
      expect(r.status, line).toBe(1);
    }
  });

  it("③ 相对路径进入 ee-* 目录 ⇒ 红", () => {
    const r = run(fixture({ files: { "src/a.ts": 'import "../../../packages/ee-sso/src/x";\n' } }));
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("进入了企业版目录");
  });

  it("没有任何 ee-* 包时照实报 0 个，不算失败", () => {
    const r = run(fixture({ files: { "src/a.ts": "export {};\n" } }, {}, false));
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("企业版包 0 个");
  });

  it("开源包源码 0 个 ⇒ 空集不判绿", () => {
    const r = run(fixture({}));
    expect(r.status).toBe(1);
  });
});

/**
 * 技能包清单门控的回归测试。
 *
 * 这道门初版误报过一半：自己写的解析器只认顶层字段，把 5 个把身份嵌在 `metadata:` 下的
 * 官方技能包全判成「缺 capability_id / 缺 version」，还据此得出了一个写进开源方案的错误结论。
 * 第一条用例就是那个 bug 的原样复现，必须判为身份齐全。
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const ROOT = join(import.meta.dirname, "../..");
const SCRIPT = join(ROOT, ".harness/scripts/lint-maau-manifest.mjs");

const made: string[] = [];
function skills(entries: Record<string, { md: string; license?: boolean }>): string {
  const root = mkdtempSync(join(tmpdir(), "skill-manifest-"));
  made.push(root);
  for (const [path, { md, license }] of Object.entries(entries)) {
    const dir = join(root, "skills", path);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "SKILL.md"), md);
    if (license) writeFileSync(join(dir, "LICENSE"), "MIT License\n");
  }
  return root;
}
const run = (root: string, ...args: string[]) =>
  spawnSync("pnpm", ["exec", "tsx", SCRIPT, "--root", root, ...args], { encoding: "utf8", cwd: ROOT });
afterEach(() => {
  while (made.length) rmSync(made.pop()!, { recursive: true, force: true });
});

// 每条用例都起 tsx 子进程，默认 5 秒超时在慢机器上会假红
describe("lint-maau-manifest", { timeout: 30_000 }, () => {
  it("package.json 里有这条脚本，且经 tsx 跑（要 import 唯一解析器）", () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as { scripts: Record<string, string> };
    expect(pkg.scripts["lint:maau-manifest"]).toMatch(/tsx .*lint-maau-manifest\.mjs/);
  });

  it("回归：身份嵌在 metadata: 下的技能包，身份判为齐全（初版把它误报成缺失）", () => {
    const r = run(skills({
      "pack/nested": {
        md: "---\nname: nested\ndescription: d\nmetadata:\n  capability_id: WX-S002\n  version: 1.0.0\n---\n",
        license: true,
      },
    }));
    expect(r.stdout).toMatch(/1 个技能包，0 个有问题/);
  });

  it("顶层写法同样判为齐全", () => {
    const r = run(skills({
      "pack/top": { md: "---\nname: top\ndescription: d\nversion: 1.0.0\ncapability_id: WX-S021\nlicense: Apache-2.0\n---\n" },
    }));
    expect(r.stdout).toMatch(/0 个有问题/);
  });

  it("真缺身份时仍报 identity", () => {
    const r = run(skills({ "pack/bare": { md: "---\nname: bare\ndescription: d\n---\n", license: true } }));
    expect(r.stdout).toMatch(/identity/);
  });

  it("name 与目录名不一致也报——那会让按名字找目录悄悄取错文件", () => {
    const r = run(skills({
      "pack/real-dir": { md: "---\nname: other-name\ndescription: d\nversion: 1.0.0\ncapability_id: WX-S1\n---\n", license: true },
    }));
    expect(r.stdout).toMatch(/identity/);
  });

  it("缺许可：默认只报告（退出 0），--strict 判失败", () => {
    const root = skills({ "pack/nolic": { md: "---\nname: nolic\ndescription: d\nversion: 1.0.0\ncapability_id: WX-S3\n---\n" } });
    expect(run(root).status).toBe(0);
    expect(run(root, "--strict").status).toBe(1);
  });
});

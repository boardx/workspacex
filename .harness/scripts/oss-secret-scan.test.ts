/**
 * 凭据扫描 `--head-only` 的回归测试。
 *
 * 初版这条路径永远报 0 命中：ES 模块里用了 require（未定义，错误被 catch 吞掉，每个文件读成空串），
 * 而就算读得到，把所有文件拼成一个字符串也会在大文件上崩——前一个 bug 把后一个盖住了，
 * 这条路径从来没真正跑过。一道永远绿的门比没有门更糟。
 *
 * 假凭据在运行时拼出来：源码里不出现完整的形状，免得本测试文件自己被扫描器命中。
 */
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const SCRIPT = join(import.meta.dirname, "oss-secret-scan.mjs");
const made: string[] = [];
function repo(files: Record<string, string | Buffer>): string {
  const dir = mkdtempSync(join(tmpdir(), "secret-scan-"));
  made.push(dir);
  execFileSync("git", ["init", "-q"], { cwd: dir });
  for (const [name, body] of Object.entries(files)) writeFileSync(join(dir, name), body);
  execFileSync("git", ["add", "-A"], { cwd: dir });
  return dir;
}
const scan = (cwd: string) => spawnSync("node", [SCRIPT, "--head-only"], { cwd, encoding: "utf8" });
afterEach(() => {
  while (made.length) rmSync(made.pop()!, { recursive: true, force: true });
});

describe("oss-secret-scan --head-only", () => {
  it("工作树里的凭据真的会被扫到（初版永远报 0）", () => {
    const fakeAws = "AKIA" + "Q".repeat(16);
    const r = scan(repo({ "config.ts": `const k = "${fakeAws}";\n` }));
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/命中\s+1\b/);
    expect(r.stdout).toContain("aws-access-key");
    expect(r.stdout).not.toContain(fakeAws); // 不回显凭据本身
  });

  it("大文件与二进制跳过且计数，不再把整棵树拼成一个字符串而崩", () => {
    const r = scan(repo({
      "big.txt": Buffer.alloc(3 * 1024 * 1024, 97),
      "img.png": Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01]),
      "ok.ts": "export const a = 1;\n",
    }));
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/跳过的文件\s+2/);
    expect(r.stdout).toMatch(/命中\s+0\b/);
  });

  it("--strict 在有命中时退出 1", () => {
    const fakeGh = "ghp_" + "a".repeat(36);
    const dir = repo({ "x.ts": `t = "${fakeGh}"\n` });
    const r = spawnSync("node", [SCRIPT, "--head-only", "--strict"], { cwd: dir, encoding: "utf8" });
    expect(r.status).toBe(1);
  });
});

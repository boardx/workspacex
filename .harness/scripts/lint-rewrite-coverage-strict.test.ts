/**
 * `lint-rewrite-coverage --strict`：扫不全（incomplete）必须退出非 0（#2490 独立审第 1 条）。
 *
 * 不带 `--strict` 时，扫不全降级为 WARN、退出 0——那是只读审计的语义（宁可不判，不用残缺
 * 输入做否定性判断）。但一道 **required PR check** 在「没做判断」时给绿，就是 fail-open：
 * controller 目录挪走、next.config.mjs 读不到、扫描器退化，PR 照样绿，门等于没装。
 *
 * 断行为，不断源码字符串：真的 spawn 脚本，用 `--root` 指向一个空目录制造「扫不全」。
 * 三个样本缺一不可：① 空根 + 不带 strict → 0（降级语义没被本改动破坏）；
 * ② 空根 + strict → 非 0（门真的会红）；③ 真仓库 + strict → 0（正样本，门不是恒红）。
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..", "..");
const SCRIPT = join(ROOT, ".harness", "scripts", "lint-rewrite-coverage.mjs");

let dir: string | null = null;
afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = null; });

function run(args: string[]): { code: number; out: string } {
  // 退出 0 的样本也要看 stderr：降级 WARN 走的是 console.warn，不在 stdout 上。
  const r = spawnSync("pnpm", ["exec", "tsx", SCRIPT, ...args], { cwd: ROOT, encoding: "utf8" });
  return { code: r.status ?? 1, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}

describe("lint-rewrite-coverage --strict（#2490：PR 门控不许 fail-open）", () => {
  it("① 扫不全 + 不带 --strict → 退出 0，且明说「没做判断」（只读审计的降级语义保留）", () => {
    dir = mkdtempSync(join(tmpdir(), "rewrite-empty-root-"));
    const r = run(["--root", dir]);
    expect(r.code).toBe(0);
    expect(r.out).toContain("扫不全");
  });

  it("② 扫不全 + --strict → 退出非 0（门控模式下「没做判断」不能当绿）", () => {
    dir = mkdtempSync(join(tmpdir(), "rewrite-empty-root-"));
    const r = run(["--root", dir, "--strict"]);
    expect(r.code).not.toBe(0);
    expect(r.out).toContain("--strict");
  });

  it("③ 真仓库 + --strict → 退出 0（正样本：门不是恒红）", () => {
    const r = run(["--strict"]);
    expect(r.code, r.out).toBe(0);
    expect(r.out).toContain("覆盖一致");
  });
});

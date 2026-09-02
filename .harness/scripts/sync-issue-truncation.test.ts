/**
 * sync --apply 的 issue 清单**拿不全时必须整个停下**，而不是在残缺清单上建/改/关（#2483）。
 *
 * doctor 的同型防线见 doctor-issue-truncation.test.ts（2026-08-05，连红四次的误判）。
 * sync 这一侧更危险：doctor 最多误报「没有 issue」，sync 会**真的再建一个**——
 * 清单外的老 feature 靠 marker 找不到 → 退回标题搜索 → 中文长标题搜不到 → 双胞胎
 * （2026-07-29 已因搜索失效建出 #30/#31）。
 *
 * 同样断**行为**、不断源码字符串：用假 `gh` 记录每一条被调用的命令，断言截断时
 * 一条 mutating 命令都没发出；并用「清单没触顶」的正样本证明这道门不是空转。
 */
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..", "..");

let dir: string | null = null;
afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = null; });

/** 假 gh：`issue list` 回 n 条空 body 的 issue；其余命令回 `[]`；每条命令逐行记进 calls.log。 */
function runSyncApplyWithFakeGh(rows: number): { out: string; code: number; calls: string[] } {
  dir = mkdtempSync(join(tmpdir(), "sync-gh-"));
  const gh = join(dir, "gh");
  const log = join(dir, "calls.log");
  writeFileSync(gh, `#!/usr/bin/env bash
echo "$*" >> ${JSON.stringify(log)}
case "$*" in
  *"issue list"*) node -e 'process.stdout.write(JSON.stringify(Array.from({length:${rows}},(_,i)=>({number:i+1,title:"t"+(i+1),body:"",state:"OPEN",labels:[]}))))' ;;
  *) echo '[]' ;;
esac
`);
  chmodSync(gh, 0o755);
  const env = { ...process.env, PATH: `${dir}:${process.env.PATH}` };
  let out = "";
  let code = 0;
  try {
    out = execFileSync("pnpm", ["harness", "sync", "--phase", "00", "--apply"], {
      cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], env,
    });
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string; status?: number };
    out = `${err.stdout ?? ""}${err.stderr ?? ""}`;
    code = err.status ?? 1;
  }
  const calls = existsSync(log) ? readFileSync(log, "utf8").split("\n").filter(Boolean) : [];
  return { out, code, calls };
}

const isMutating = (c: string) => /issue (create|edit|close|comment)|milestones|label create/.test(c);

describe("sync --apply：issue 清单截断（#2483）", () => {
  it("触顶（可能被截断）→ 退出非 0，且**一条**建/改/关都没发出", () => {
    const { out, code, calls } = runSyncApplyWithFakeGh(5000); // = ISSUE_PAGE_LIMIT
    expect(code).not.toBe(0);
    expect(out).toContain("sync --apply 中止");
    expect(out).toContain("可能被截断");
    expect(calls.some((c) => c.includes("issue list"))).toBe(true); // 确实问过清单
    expect(calls.filter(isMutating)).toEqual([]); // 但没动任何东西
  });

  it("反空转正样本：清单**没有**触顶时照常走下去，会发出建 issue 的命令", () => {
    const { out, code, calls } = runSyncApplyWithFakeGh(3);
    expect(code).toBe(0);
    expect(out).not.toContain("sync --apply 中止");
    expect(calls.some((c) => c.includes("issue create"))).toBe(true);
  });
});

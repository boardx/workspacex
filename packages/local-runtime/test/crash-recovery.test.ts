/**
 * 硬杀之后数据还在不在（#3872 R4）。
 *
 * ## 为什么这道门必须存在
 * 离线应用十大缺陷的**第 1 条**就是「数据丢了或打不开了」：异常退出后库损坏，
 * 且没有可用备份。而 `pglite-server.ts` 自己的注释里写着「被硬杀留下的不一致目录」
 * 会让 PGlite 在 WASM 深处 abort（`RuntimeError: Aborted()`），没有可读的原因。
 * 那句话是真的风险描述，但**从来没人验过它在本仓的真实启动路径上会不会发生**——
 * 体验评分卡维度 5 扣分的理由之一就是「从没测过崩溃恢复」。
 *
 * ## 判据是数行数，不是「跑一遍没报错」
 * 评分卡写死了：`kill -9` 之后**重开并核行数**。一个只断言「没抛异常」的测试，
 * 在库被清空的情况下会全绿。
 *
 * ## 为什么起真进程
 * 要测的就是「进程被硬杀」这件事，在同一个进程里模拟不出来。
 */
import { afterEach, describe, expect, it } from "vitest";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { ensureDatabaseExists, startPgliteServer } from "../src/pglite-server";

const require_ = createRequire(new URL("../../../apps/api/package.json", import.meta.url));
const pg = require_("pg") as typeof import("pg");
const HERE = fileURLToPath(new URL(".", import.meta.url));
const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

const tmp = (): string => { const d = mkdtempSync(join(tmpdir(), "wsx-crash-")); dirs.push(d); return d; };

/** 起写入方，等它至少提交过 `minCommits` 行，返回「已知已提交的下界」。 */
async function writeUntil(dataDir: string, port: number, minCommits: number): Promise<{ committed: number; kill: () => void }> {
  // 直接执行 tsx 这个可执行外壳；用 `node <tsx>` 跑它会立刻退出（它是 shell shim，不是模块）。
  const tsx = join(HERE, "..", "..", "..", "node_modules", ".bin", "tsx");
  const child = spawn(tsx, [
    join(HERE, "fixtures", "crash-writer.mjs"), dataDir, String(port), "20",
  ], { stdio: ["ignore", "pipe", "pipe"] });
  let committed = 0;
  let out = "";
  await new Promise<void>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`写入方 90 秒内没写到 ${minCommits} 行；输出：${out.slice(-400)}`)), 90_000);
    child.stdout.on("data", (b: Buffer) => {
      out += b.toString();
      for (const m of out.matchAll(/COMMITTED (\d+)/g)) committed = Number(m[1]);
      if (committed >= minCommits) { clearTimeout(t); resolve(); }
    });
    child.stderr.on("data", (b: Buffer) => { out += b.toString(); });
    child.on("exit", (code) => { clearTimeout(t); reject(new Error(`写入方提前退出 code=${code}；输出：${out.slice(-400)}`)); });
  });
  return { committed, kill: () => { child.kill("SIGKILL"); } };
}

async function countRows(dataDir: string, port: number): Promise<number> {
  await ensureDatabaseExists(dataDir);
  const h = await startPgliteServer({ dataDir, port, username: "postgres" });
  try {
    const c = new pg.Client({ host: "127.0.0.1", port, user: "postgres", database: "workspacex" });
    await c.connect();
    const r = await c.query<{ n: number }>("SELECT count(*)::int AS n FROM crash_probe");
    await c.end();
    return r.rows[0]?.n ?? -1;
  } finally {
    await h.stop();
  }
}

describe("硬杀之后数据还在", () => {
  it("写到一半被 kill -9：库能重新打开，已提交的行一条不少", async () => {
    const dataDir = tmp();
    const w = await writeUntil(dataDir, 55480, 200);
    w.kill();
    await new Promise((r) => setTimeout(r, 2500));   // 等内核回收端口与文件句柄

    const rows = await countRows(dataDir, 55481);
    // 下界是「日志里看到的最后一次提交」：在途的那个事务丢掉是**正确**行为，
    // 已提交的一条都不能少。
    expect(rows).toBeGreaterThanOrEqual(w.committed);
  }, 180_000);
});

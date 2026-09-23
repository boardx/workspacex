/**
 * 真库往返：备份一个真的 PGlite 库，再把它恢复到另一个目录，**数行数**（#3872 R5）。
 *
 * ## 为什么这一条不能省
 * `restore.test.ts` 测的是**编排**（先验后写、挪走不删、恢复完核对），它的
 * `writeDatabase` 是个替身。而「PGlite 的快照到底能不能原样读回来」是另一层的事实——
 * 替身在那个剧本下产不出缺陷：无论 `dumpDataDir` 有没有真的工作，编排测试都会绿。
 * 断言要打在需求指名的那一层：用户要的是「换台电脑数据还在」，那就得真的换个目录读回来。
 */
import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { createBackup } from "../src/backup";
import { restoreBackup } from "../src/restore";
import { ensureDatabaseExists, restoreDatabaseDump, startPgliteServer } from "../src/pglite-server";

const require_ = createRequire(new URL("../../../apps/api/package.json", import.meta.url));
const pg = require_("pg") as typeof import("pg");
const dirs: string[] = [];
const tmp = (): string => { const d = mkdtempSync(join(tmpdir(), "wsx-rt-")); dirs.push(d); return d; };
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

async function withDb<T>(pgDataDir: string, port: number, fn: (c: import("pg").Client) => Promise<T>): Promise<T> {
  await ensureDatabaseExists(pgDataDir);
  const h = await startPgliteServer({ dataDir: pgDataDir, port, username: "postgres" });
  const c = new pg.Client({ host: "127.0.0.1", port, user: "postgres", database: "workspacex" });
  await c.connect();
  try { return await fn(c); } finally { await c.end(); await h.stop(); }
}

describe("备份到恢复的真库往返", () => {
  it("在 A 机器上备份，在 B 机器上读回来——行数一条不差", async () => {
    const a = tmp();
    const pgA = join(a, "pgdata");
    const objectsA = join(a, "objects");
    await mkdir(objectsA, { recursive: true });

    // ① A 上建真数据
    await withDb(pgA, 55490, async (c) => {
      await c.query("CREATE TABLE organizations (id serial primary key, name text)");
      await c.query("CREATE TABLE chat_threads (id serial primary key, title text)");
      await c.query("INSERT INTO organizations(name) VALUES ('我的本地工作区')");
      for (let i = 0; i < 37; i += 1) await c.query("INSERT INTO chat_threads(title) VALUES ($1)", [`对话 ${i}`]);
    });

    // ② 真备份：用 PGlite 自己的一致快照
    const backupRoot = join(a, "backups");
    let dumpBytes = 0;
    const b = await withDb(pgA, 55491, async () => null).then(async () => {
      await ensureDatabaseExists(pgA);
      const h = await startPgliteServer({ dataDir: pgA, port: 55492, username: "postgres" });
      try {
        const r = await createBackup({
          destRoot: backupRoot,
          appVersion: "0.2.0",
          dumpDatabase: async () => { const d = await h.dumpDatabase(); dumpBytes = d.byteLength; return d; },
          countRows: (t) => h.countRows(t),
          objectsDir: objectsA,
        });
        if (!r.ok) throw new Error(r.reason);
        return r;
      } finally { await h.stop(); }
    });
    expect(dumpBytes).toBeGreaterThan(1000);            // 真的导出了东西，不是个空壳
    expect(b.manifest.rowCounts.chat_threads).toBe(37);

    // ③ 换一个全新目录恢复——这就是「换一台电脑」
    const bDir = tmp();
    let counted: Record<string, number | null> = {};
    const r = await restoreBackup({
      backupDir: b.dir,
      dataDir: bDir,
      writeDatabase: (pgDataDir, dump) => restoreDatabaseDump(pgDataDir, dump),
      countRows: async (t) => {
        const n = await withDb(join(bDir, "pgdata"), 55493, async (c) => {
          try {
            const q = await c.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${t}`);
            return q.rows[0]?.n ?? null;
          } catch { return null; }
        });
        counted[t] = n;
        return n;
      },
    });

    expect(r.ok, r.ok ? "" : r.reason).toBe(true);
    expect(counted.chat_threads).toBe(37);
    expect(counted.organizations).toBe(1);
  }, 180_000);
});

/**
 * **全部迁移必须能在 PGlite 上从零跑通**——本地版全新安装的第一道关（#3872）。
 *
 * ## 为什么有这道门
 *
 * 2026-09-24 合入的 `20260924230000_kg_f08_graph_recall.sql` 在函数**定义**里引用了
 * `ag_catalog`（Apache AGE 的 schema）。服务器版镜像带 AGE，迁移照常；本地桌面版的 PGlite
 * 没有 AGE，于是从那天起**本地版每一个全新安装都在迁移这一步失败、整个应用起不来**，
 * 用户看到的只有一句 `migration_failed`（migrate-cli 为防泄露凭据故意吞掉了原因）。
 *
 * 同一条功能线的 F01 头注和 ADR-114 决策 5 早就写明了这条原则——「无条件引用 AGE 会让桌面版
 * 整条迁移链断掉」——但**原则没有门**，于是第二个作者照样踩了进去。这正是本仓那条规矩：
 * 没有脚本的规范条目视为未落地。
 *
 * 发现方式：R20 真机往返验证时，干净首次运行直接起不来。全仓此前**没有任何测试**
 * 在 PGlite 上跑过迁移链，CI 里也没有一个车道提到本地版。
 *
 * ## 走产线同一条路径
 *
 * `runMigrations` → `apps/api/src/infrastructure/db/migrate-cli.ts`，就是 `up()` 首次启动
 * 时调用的那一条。不另写一份迁移器：另写的那份会和产线漂移，而漂移正是这类缺陷藏身的地方。
 */
import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import net from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { DB_OWNER_ROLE, resolveLocalConfig } from "../src/config";
import { ensureDatabaseExists, startPgliteServer } from "../src/pglite-server";
import { runMigrations } from "../src/seeds";

const REPO_ROOT = fileURLToPath(new URL("../../..", import.meta.url));
const MIGRATIONS_DIR = join(REPO_ROOT, "apps", "api", "migrations");

/**
 * 找一个空闲端口。⚠ 刻意落在 32768 以下：macOS 的临时端口区从 49152 起、Linux 从 32768 起，
 * 落在那里的端口会被出向连接偷去当源端口（本仓实测过「红但零用例」就是这么来的）。
 */
async function freePort(): Promise<number> {
  for (let i = 0; i < 50; i++) {
    const p = 20000 + Math.floor(Math.random() * 10000);
    const free = await new Promise<boolean>((res) => {
      const s = net.createServer();
      s.once("error", () => res(false));
      s.listen(p, "127.0.0.1", () => s.close(() => res(true)));
    });
    if (free) return p;
  }
  throw new Error("找不到空闲端口");
}

describe("全新安装的数据库", () => {
  it("**全部迁移在 PGlite 上从零跑通**，一条都不少", async () => {
    const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql"));
    expect(files.length, "迁移目录是空的——判据本身坏了").toBeGreaterThan(100);

    const dataDir = mkdtempSync(join(tmpdir(), "wsx-mig-"));
    const port = await freePort();
    const c = resolveLocalConfig({ repoRoot: REPO_ROOT, dataDir, ports: { postgres: port } });
    await ensureDatabaseExists(join(dataDir, "pgdata"));
    const pg = await startPgliteServer({ dataDir: join(dataDir, "pgdata"), port, username: DB_OWNER_ROLE });
    const lines: string[] = [];
    try {
      await runMigrations(c, (l) => lines.push(l));
    } catch (e) {
      // migrate-cli 为了不泄露凭据只打一句 migration_failed；在这台只有测试数据的库上，
      // 把能拿到的都打出来，免得下一个人又要自己写探针去找是哪一条。
      throw new Error(`迁移在 PGlite 上失败：${String(e)}\n--- 迁移输出 ---\n${lines.join("\n")}`);
    } finally {
      await pg.stop();
    }
    const applied = lines.find((l) => /applied \d+ migration/.test(l)) ?? "";
    const n = Number(/applied (\d+) migration/.exec(applied)?.[1] ?? "-1");
    expect(n, `应用的迁移数与文件数对不上：${applied}`).toBe(files.length);
  }, 180_000);
});

describe("引用可选扩展的迁移必须先判断它在不在", () => {
  /*
    动态那条是真证据，但它只告诉你「坏了」。这条静态检查告诉你**坏在哪、为什么**。

    判据是实测出来的，和直觉不一样（2026-09-27，对全仓 6 条提到 ag_catalog 的迁移逐条比对）：

      ✓ 函数头里 `SET search_path = ag_catalog …`  —— 4 条都有，PGlite 上照样过
      ✓ ag_catalog 出现在字符串 / EXECUTE / format() 里 —— 运行时才解析，照样过
      ✗ 在 plpgsql 的 DECLARE 里声明 `ag_catalog.<类型>` 的变量 —— **建函数那一刻**
        就要解析类型，schema 不在当场失败。原版 F08 唯一多出来的就是这一行。

    ⚠ 第一版这条门把函数体里的 `pg_extension WHERE extname = 'age'` 也当成合格守卫——
      那是**运行时**检查，防不住迁移时的失败。把原版 F08 放回去，它照样绿。
      我的门编码了和原作者一模一样的误解。迁移时守卫只认顶层的
      `pg_namespace … ag_catalog` 或 `pg_available_extensions` 判断。
  */
  const declaresAgeType = /^\s+\w+\s+ag_catalog\.\w+\s*(:=|;)/m;
  const migrationTimeGuard = /pg_namespace[\s\S]{0,80}ag_catalog|pg_available_extensions/i;

  it("在 DECLARE 里用 AGE 类型的迁移，必须带迁移时的存在性判断", () => {
    const offenders = readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith(".sql"))
      .filter((f) => {
        const sql = readFileSync(join(MIGRATIONS_DIR, f), "utf8");
        return declaresAgeType.test(sql) && !migrationTimeGuard.test(sql);
      });
    expect(offenders, "这些迁移在建函数时就要解析 AGE 类型，本地版全新安装会在它们身上失败").toEqual([]);
  });

  it("判据本身：认得出原版 F08 的那一行，不误伤只在字符串里提到 ag_catalog 的写法", () => {
    expect(declaresAgeType.test("DECLARE\n  v_param ag_catalog.agtype;\nBEGIN")).toBe(true);
    expect(declaresAgeType.test("  v_x ag_catalog.agtype := NULL;")).toBe(true);
    expect(declaresAgeType.test("LANGUAGE plpgsql SET search_path = ag_catalog, pg_catalog")).toBe(false);
    expect(declaresAgeType.test("  'FROM ag_catalog.cypher(%L, $q$ MATCH (n) RETURN n $q$)'")).toBe(false);
    // 运行时检查不是迁移时守卫
    expect(migrationTimeGuard.test("IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_extension WHERE extname = 'age') THEN")).toBe(false);
  });
});

/**
 * 用户直接交办（2026-09-25，ad-hoc）—— `PgKgDeploymentExtractionSettings`（真实 Postgres）：
 *
 *   (a) 迁移 20260925120000 把既有单例行、以及 DEFAULT 都回填成 `true`——这是本次改动的
 *       "默认开"承诺，直接查库断言，不是从代码逻辑推出来的。
 *   (b) `setEnabled` 双向可切换（不是只能开一次的 `kg_extraction_enable()`），返回写入后的
 *       现值，且立即反映在下一次 `getEnabled` 上。
 *   (c) `kg_extraction_enable()`（旧的单向函数）原样保留、仍然可调——兼容既有测试夹具
 *       （`kg-extraction-fixtures.ts` 的 `enableExtraction()`）与其他生产调用方
 *       （`kg-extraction-worker.ts` 曾经的调用点已删，但函数本身不因此消失）。
 *
 * ⚠ `kg_extraction_state` 是全库单例、跨测试文件共享（同 `org-extraction-toggle-trigger.
 *   test.ts` 头注）。本文件把它切回 `false` 的窗口只在单个 `it` 内、`finally` 里立刻切回
 *   `true`，外加 `afterAll` 兜底——这是本次改动本身要解决的问题（这一行不该只能靠"别碰它"
 *   来维持安全），但跨文件并行仍要克制影响面。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PgDatabase } from "../../src/infrastructure/db/pg-database";
import { appConfig } from "../../src/infrastructure/db/pg-config";
import { PgKgDeploymentExtractionSettings } from "../../src/infrastructure/knowledge-graph/pg-kg-deployment-extraction-settings";
import { asOwner, ensureDatabase, migrateOnce } from "../support/db";

let db: PgDatabase;
let repo: PgKgDeploymentExtractionSettings;

beforeAll(async () => {
  ensureDatabase();
  await migrateOnce();
  db = new PgDatabase(appConfig());
  repo = new PgKgDeploymentExtractionSettings(db);
});

afterAll(async () => {
  // 兜底：不管前面哪个用例失败在哪一步，收尾时这一行必须是 true——这是全库共享的单例，
  // 其他并行文件（`kg-extraction-fixtures.ts` 的既有测试）默认假设它开着。
  await asOwner((c) => c.query("SELECT kg_extraction_set_enabled(true)"));
  await db?.close();
});

describe("F06 部署级开关落库（用户直接交办）", () => {
  it("(a) 迁移把既有单例行回填成 true——默认开", async () => {
    const row = await asOwner((c) => c.query<{ enabled: boolean }>("SELECT enabled FROM kg_extraction_state WHERE singleton"));
    expect(row.rows[0]?.enabled).toBe(true);
  });

  it("(a2) 表的 DEFAULT 也改成了 true（新种一行会是 true，不只是回填过的这一行）", async () => {
    const row = await asOwner((c) => c.query<{ column_default: string | null }>(
      "SELECT column_default FROM information_schema.columns WHERE table_name = 'kg_extraction_state' AND column_name = 'enabled'",
    ));
    expect(row.rows[0]?.column_default).toMatch(/true/);
  });

  it("(b) getEnabled 现值 = 库里的值；setEnabled 双向切换，立即反映在下一次读上", async () => {
    try {
      expect(await repo.getEnabled()).toBe(true);

      const off = await repo.setEnabled(false, "u-platform-ops");
      expect(off).toBe(false);
      expect(await repo.getEnabled()).toBe(false);

      const on = await repo.setEnabled(true, "u-platform-ops");
      expect(on).toBe(true);
      expect(await repo.getEnabled()).toBe(true);
    } finally {
      await asOwner((c) => c.query("SELECT kg_extraction_set_enabled(true)"));
    }
  });

  it("(c) kg_extraction_enable()（旧的单向函数）仍然可调，且把它置真", async () => {
    try {
      await repo.setEnabled(false, "u-platform-ops");
      expect(await repo.getEnabled()).toBe(false);

      await asOwner((c) => c.query("SELECT kg_extraction_enable()"));
      expect(await repo.getEnabled()).toBe(true);
    } finally {
      await asOwner((c) => c.query("SELECT kg_extraction_set_enabled(true)"));
    }
  });
});

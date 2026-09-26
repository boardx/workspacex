/**
 * Phase 18 F15 —— `kg_graph_neighbors` 逐跳锚定版（迁移 20260925100000）的两道门：
 *
 * ① 安全（评审 B1 复现过的提权）：这是 SECURITY DEFINER 函数（属主是迁移角色）。旧写法在函数体里
 *    `CREATE TEMP TABLE IF NOT EXISTS pg_temp.kg_hop1 … TRUNCATE … INSERT`：调用方（app_rw）可以先在自己的 pg_temp 里
 *    建同名表、挂触发器，函数以属主身份执行时就替调用方跑了触发器（评审用它 `ALTER ROLE app_rw SUPERUSER` 成功）。
 *    这里以 app_rw 身份重放这个攻击：同名表、TRUNCATE / INSERT 两种触发器都挂上，调用函数，断言
 *    触发器一次都没跑、app_rw 仍不是超级用户；再断言函数源码里不建任何对象、不碰临时表。
 * ② 与 F08 版逐行相同（评审 N2）：把 F08 迁移里原样的函数装成 `kg_graph_neighbors_f08`，在同一张图上对每个种子、
 *    每对种子、全部种子逐一对拍。特别钉住「种子 {张三, v2}：张三 → 决定 → v2 → 风险」——路径经过的实体是
 *    **另一个**种子，F08 返回它（只排除这条路径自己的种子）。
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { appConfig } from "../../src/infrastructure/db/pg-config";
import { PgDatabase } from "../../src/infrastructure/db/pg-database";
import { asOwner } from "../support/db";
import { seedRecallOrg } from "./kg-recall-fixtures";

const ORG = "org-kg-f15-anchored";
let db: PgDatabase;

type Row = Record<string, string | null>;
const key = (r: Row) => [r.seed_key, r.rel1, r.mid1_key, r.rel2, r.mid2_key, r.rel3, r.claim_key].join("|");

async function neighbors(fn: string, seeds: readonly string[]): Promise<string[]> {
  return asOwner(async (c) => {
    await c.query("SELECT set_config('app.current_org', $1, false)", [ORG]);
    const r = await c.query<Row>(`SELECT * FROM ${fn}($1::text[])`, [seeds]);
    return r.rows.map(key).sort();
  });
}

beforeAll(async () => {
  db = new PgDatabase(appConfig());
  await seedRecallOrg(db, ORG, ["thr-f15-anch"]);
  // F08 的原版，逐字取自它的迁移，只改函数名
  const f08 = readFileSync(fileURLToPath(new URL("../../migrations/20260924230000_kg_f08_graph_recall.sql", import.meta.url)), "utf8");
  const body = f08.slice(f08.indexOf("CREATE OR REPLACE FUNCTION kg_graph_neighbors"), f08.indexOf("$$;", f08.indexOf("CREATE OR REPLACE FUNCTION kg_graph_neighbors")) + 3);
  await asOwner((c) => c.query(body.replace("FUNCTION kg_graph_neighbors(", "FUNCTION kg_graph_neighbors_f08(")));
});
afterAll(async () => {
  await asOwner((c) => c.query("DROP FUNCTION IF EXISTS kg_graph_neighbors_f08(text[])"));
  await db.close();
});

describe("F15: kg_graph_neighbors 逐跳锚定", () => {
  it("① 调用方预先在 pg_temp 里放的同名表与触发器，不会被属主身份执行；app_rw 提不了权", async () => {
    const c = new pg.Client(appConfig());
    await c.connect();
    try {
      await c.query(`CREATE FUNCTION pg_temp.f15_evil() RETURNS trigger LANGUAGE plpgsql AS $f$
        BEGIN PERFORM set_config('f15.fired', current_user, false); EXECUTE 'ALTER ROLE app_rw SUPERUSER'; RETURN NULL; END $f$`);
      for (const t of ["kg_hop1", "kg_hop2", "kg_hop3"]) {
        await c.query(`CREATE TEMP TABLE ${t} (a text, b text, x text)`);
        await c.query(`CREATE TRIGGER f15_t BEFORE TRUNCATE ON pg_temp.${t} FOR EACH STATEMENT EXECUTE FUNCTION pg_temp.f15_evil()`);
        await c.query(`CREATE TRIGGER f15_i BEFORE INSERT ON pg_temp.${t} FOR EACH STATEMENT EXECUTE FUNCTION pg_temp.f15_evil()`);
      }
      const seeds = (await asOwner(async (o) => (await o.query<{ id: string }>(
        "SELECT 'object:' || id AS id FROM ontology_objects WHERE org_id = $1", [ORG])).rows)).map((r) => r.id);
      await c.query("BEGIN");
      await c.query("SELECT set_config('app.current_org', $1, true)", [ORG]);
      const out = await c.query("SELECT count(*)::int AS n FROM kg_graph_neighbors($1::text[])", [seeds]);
      await c.query("COMMIT");
      expect(out.rows[0].n).toBeGreaterThan(0);
      const fired = await c.query<{ v: string | null }>("SELECT current_setting('f15.fired', true) AS v");
      expect(fired.rows[0]!.v ?? "").toBe("");
    } finally {
      await c.end();
      const [role] = await asOwner(async (o) => (await o.query<{ rolsuper: boolean }>("SELECT rolsuper FROM pg_roles WHERE rolname = 'app_rw'")).rows);
      // 万一失守，先把集群恢复原样，再让断言红
      if (role?.rolsuper) await asOwner((o) => o.query("ALTER ROLE app_rw NOSUPERUSER"));
      expect(role?.rolsuper).toBe(false);
    }
  });

  it("① 函数体里不建任何对象、不碰临时表（中间结果只在 plpgsql 变量里）", async () => {
    const [fn] = await asOwner(async (c) => (await c.query<{ src: string; definer: boolean }>(
      "SELECT prosrc AS src, prosecdef AS definer FROM pg_proc WHERE proname = 'kg_graph_neighbors'")).rows);
    expect(fn!.definer).toBe(true);
    expect(fn!.src).not.toMatch(/\b(?:CREATE|TRUNCATE|DROP|ALTER|INSERT|UPDATE|DELETE)\b/i);
    expect(fn!.src).not.toMatch(/pg_temp|\bTEMP(?:ORARY)?\b/i);
  });

  it("② 与 F08 版逐行相同：每个种子、每对种子、全部种子", async () => {
    const objects = await asOwner(async (c) => (await c.query<{ id: string; name: string }>(
      "SELECT 'object:' || id AS id, name FROM ontology_objects WHERE org_id = $1 ORDER BY name", [ORG])).rows);
    expect(objects.length).toBeGreaterThanOrEqual(3);
    const sets: string[][] = [
      ...objects.map((o) => [o.id]),
      ...objects.flatMap((a, i) => objects.slice(i + 1).map((b) => [a.id, b.id])),
      objects.map((o) => o.id),
    ];
    for (const s of sets) {
      expect(await neighbors("kg_graph_neighbors", s), s.join(",")).toEqual(await neighbors("kg_graph_neighbors_f08", s));
    }
  });

  it("② 经过另一个种子的 3 跳路径也返回（{张三, v2}：张三 → 决定 → v2 → 风险）", async () => {
    const byName = new Map((await asOwner(async (c) => (await c.query<{ id: string; name: string }>(
      "SELECT 'object:' || id AS id, name FROM ontology_objects WHERE org_id = $1", [ORG])).rows)).map((o) => [o.name, o.id]));
    const [risk] = await asOwner(async (c) => (await c.query<{ id: string }>(
      "SELECT 'claim:' || id AS id FROM claims WHERE org_id = $1 AND statement = '测试环境不稳定会拖慢 v2'", [ORG])).rows);
    const rows = await asOwner(async (c) => {
      await c.query("SELECT set_config('app.current_org', $1, false)", [ORG]);
      return (await c.query<Row>("SELECT * FROM kg_graph_neighbors($1::text[])", [[byName.get("张三")!, byName.get("v2")!]])).rows;
    });
    expect(rows.some((r) => r.seed_key === byName.get("张三") && r.mid2_key === byName.get("v2") && r.claim_key === risk!.id)).toBe(true);
  });
});

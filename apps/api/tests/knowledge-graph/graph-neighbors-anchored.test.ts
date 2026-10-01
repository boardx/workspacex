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
 * ③ 枢纽实体（#4175，迁移 20260926120000）：一个实体挂 1,100 条结论。F15 版在这里 3 跳 0 行（第二跳的前沿被指回种子的边
 *    占满）且要一秒多。现在：与「F08 的全部路径按新旧排序取前 200」逐行相同（f08Reference 在 TS 里按 F08 的定义从图快照
 *    枚举全部路径；它自己先在 ② 的小图上与 F08 原版对拍过），p95 < 300 ms。
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { appConfig } from "../../src/infrastructure/db/pg-config";
import { PgDatabase } from "../../src/infrastructure/db/pg-database";
import { rebuildOrgGraph } from "../../src/infrastructure/knowledge-graph/kg-graph-rebuild";
import { asOwner, resetOrgs } from "../support/db";
import { seedRecallOrg } from "./kg-recall-fixtures";

const ORG = "org-kg-f15-anchored";
const HUB_ORG = "org-kg-i4175-hub";
const HUB_CLAIMS = 1100;
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

/** 图的一份快照（kg_graph_snapshot：图里真有的顶点与边，含重复边）+ 各结论的 created_at（微秒）。 */
interface GraphView {
  readonly vertices: ReadonlySet<string>;
  readonly adj: ReadonlyMap<string, readonly { rel: string; other: string }[]>;
  readonly at: ReadonlyMap<string, bigint>;
}

async function graphView(org: string): Promise<GraphView> {
  return asOwner(async (c) => {
    await c.query("BEGIN");
    await c.query("SELECT set_config('app.current_org', $1, true)", [org]);
    const snap = (await c.query<{ x: string }>("SELECT x FROM kg_graph_snapshot() AS x")).rows.map((r) => r.x);
    const claims = (await c.query<{ key: string; us: string }>(
      "SELECT 'claim:' || id AS key, (extract(epoch FROM created_at) * 1000000)::bigint::text AS us FROM claims WHERE org_id = $1", [org])).rows;
    await c.query("COMMIT");
    const vertices = new Set<string>();
    const adj = new Map<string, { rel: string; other: string }[]>();
    const add = (v: string, e: { rel: string; other: string }) => { adj.set(v, [...(adj.get(v) ?? []), e]); };
    for (const x of snap) {
      const [tag, , src, dst, rel] = x.split("|");
      if (tag === "V") vertices.add(x.slice(2));
      else { add(src!, { rel: rel!, other: dst! }); add(dst!, { rel: rel!, other: src! }); }
    }
    return { vertices, adj, at: new Map(claims.map((r) => [r.key, BigInt(r.us)])) };
  });
}

/**
 * F08 的两种形状，按定义从快照枚举**全部**路径（无向、m2 ≠ 本路径种子、c ≠ 本路径 m1），再按迁移 20260926120000 规定的顺序
 * 各取前 200：结论新 → 旧（没有 created_at 的最后），再按 key；3 跳先按 m1 再按 c。`frontier` 是那份迁移里第 1 跳往下带的
 * 结论数上限（不传 = 不设上限）。
 */
function f08Reference(g: GraphView, seeds: readonly string[], frontier?: number): string[] {
  const kind = (k: string) => k.slice(0, k.indexOf(":"));
  const str = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
  const claim = (a: string, b: string) => {
    const x = g.at.get(a), y = g.at.get(b);
    if (x !== y) return x === undefined ? 1 : y === undefined ? -1 : x > y ? -1 : 1;
    return str(a, b);
  };
  const one = [...new Set(seeds)].filter((s) => g.vertices.has(s)).flatMap((s) =>
    (g.adj.get(s) ?? []).filter((e) => kind(e.other) === "claim").map((e) => ({ s, rel: e.rel, m1: e.other })));
  one.sort((a, b) => claim(a.m1, b.m1) || str(a.s, b.s) || str(a.rel, b.rel));
  const m1s = [...new Set(one.map((r) => r.m1))];
  const carried = new Set(frontier === undefined ? m1s : m1s.slice(0, frontier));
  const three: (string | null)[][] = [];
  for (const a of one) {
    if (!carried.has(a.m1)) continue;
    for (const b of g.adj.get(a.m1) ?? []) {
      if (kind(b.other) !== "object" || b.other === a.s) continue;
      for (const d of g.adj.get(b.other) ?? []) {
        if (kind(d.other) === "claim" && d.other !== a.m1) three.push([a.s, a.rel, a.m1, b.rel, b.other, d.rel, d.other]);
      }
    }
  }
  const at = (r: (string | null)[], i: number) => r[i] as string;
  three.sort((x, y) => claim(at(x, 2), at(y, 2)) || claim(at(x, 6), at(y, 6)) || str(at(x, 0), at(y, 0)) || str(at(x, 1), at(y, 1))
    || str(at(x, 3), at(y, 3)) || str(at(x, 4), at(y, 4)) || str(at(x, 5), at(y, 5)));
  return [
    ...one.slice(0, 200).map((r) => [r.s, r.rel, null, null, null, null, r.m1].join("|")),
    ...three.slice(0, 200).map((r) => r.join("|")),
  ].sort();
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
    const [fn] = await asOwner(async (c) => (await c.query<{ src: string; definer: boolean; config: string[] }>(
      "SELECT prosrc AS src, prosecdef AS definer, proconfig AS config FROM pg_proc WHERE proname = 'kg_graph_neighbors'")).rows);
    expect(fn!.definer).toBe(true);
    // #4175 重写之后仍固定 search_path，pg_temp 在最后
    expect(fn!.config).toContain("search_path=ag_catalog, pg_catalog, public, pg_temp");
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
    const g = await graphView(ORG);
    for (const s of sets) {
      const f08 = await neighbors("kg_graph_neighbors_f08", s);
      expect(await neighbors("kg_graph_neighbors", s), s.join(",")).toEqual(f08);
      // ③ 用的参照实现先在这里与 F08 原版逐行相同
      expect(f08Reference(g, s), `reference ${s.join(",")}`).toEqual(f08);
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

/**
 * ③ 枢纽：一个实体（hub）挂 HUB_CLAIMS 条结论。结论 g 的 created_at = 基准 − ⌊g/2⌋ 秒（两两同一时刻，考 key 次序）；
 * 每条都 about hub；g % 3 = 0 的还 about p(g % 10)，g % 5 = 0 的 decided_by z，g % 11 = 0 的被 p(g % 10) 反向 mentions。
 * 最新的两条（g = 1、2）只连着 hub：F15 版的第二跳正是被这种「指回种子」的边占满的。
 */
describe("#4175: 枢纽实体上的图路邻域", () => {
  const obj = (x: string) => `object:${HUB_ORG}-o-${x}`;

  beforeAll(async () => {
    await resetOrgs(HUB_ORG);
    await asOwner(async (c) => {
      await c.query("BEGIN");
      await c.query("INSERT INTO organizations (id, name, kind) VALUES ($1, $1, 'organization')", [HUB_ORG]);
      await c.query("SELECT set_config('app.current_org', $1, true)", [HUB_ORG]);
      await c.query(`INSERT INTO ontology_objects (id, org_id, scope_kind, scope_id, object_kind, name, created_by)
        SELECT $1 || '-o-' || x, $1, 'org', $1, 'concept', 'hub fixture ' || x, 'model'
          FROM unnest(ARRAY['hub', 'z', 'p0', 'p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8', 'p9']) x`, [HUB_ORG]);
      await c.query(`INSERT INTO claims (id, org_id, statement, status, scope_kind, scope_id, created_by, created_at)
        SELECT $1 || '-c-' || g, $1, 'hub claim ' || g, 'proposed', 'org', $1, 'model',
               timestamptz '2026-09-01 00:00:00+00' - make_interval(secs => g / 2)
          FROM generate_series(1, $2::int) g`, [HUB_ORG, HUB_CLAIMS]);
      await c.query(`INSERT INTO ontology_edges (id, org_id, src_kind, src_id, dst_kind, dst_id, relation, scope_kind, scope_id, created_by)
        SELECT $1 || '-e-' || t || '-' || g, $1, sk, $1 || sid, dk, $1 || did, rel, 'org', $1, 'model'
          FROM generate_series(1, $2::int) g,
          LATERAL (VALUES
            ('hub', true, 'claim', '-c-' || g, 'object', '-o-hub', 'about'),
            ('p', g % 3 = 0, 'claim', '-c-' || g, 'object', '-o-p' || g % 10, 'about'),
            ('z', g % 5 = 0, 'claim', '-c-' || g, 'object', '-o-z', 'decided_by'),
            ('m', g % 11 = 0, 'object', '-o-p' || g % 10, 'claim', '-c-' || g, 'mentions')) e(t, keep, sk, sid, dk, did, rel)
         WHERE keep`, [HUB_ORG, HUB_CLAIMS]);
      await c.query("COMMIT");
    });
    const r = await asOwner((c) => rebuildOrgGraph(c, HUB_ORG));
    expect(r.parity).toEqual({ missingInGraph: [], extraInGraph: [] });
  });
  afterAll(async () => { await resetOrgs(HUB_ORG); });

  it("③ 与「F08 全部路径按新旧取前 200」逐行相同；3 跳不再是 0 行（上限之内：第 1 跳前沿 1000 在这张图上不起作用）", async () => {
    const g = await graphView(HUB_ORG);
    expect(g.adj.get(obj("hub"))?.length).toBeGreaterThanOrEqual(HUB_CLAIMS);
    const seedSets = [[obj("hub")], [obj("hub"), obj("p0")], [obj("p0")], [obj("z"), obj("p3")],
      ["hub", "z", "p0", "p1", "p2", "p3", "p4", "p5", "p6", "p7", "p8", "p9"].map(obj)];
    for (const seeds of seedSets) {
      const expected = f08Reference(g, seeds, 1000);
      expect(f08Reference(g, seeds), `frontier binds for ${seeds.join(",")}`).toEqual(expected);
      const got = await asOwner(async (c) => {
        await c.query("SELECT set_config('app.current_org', $1, false)", [HUB_ORG]);
        return (await c.query<Row>("SELECT * FROM kg_graph_neighbors($1::text[])", [seeds])).rows.map(key).sort();
      });
      expect(got, seeds.join(",")).toEqual(expected);
      expect(got.filter((k) => k.split("|")[2] !== "").length, `3-hop rows for ${seeds.join(",")}`).toBe(200);
    }
  });

  it("③ 以 app_rw、生产的 2 s statement_timeout 调 20 次：p95 < 300 ms", async () => {
    const c = new pg.Client(appConfig());
    await c.connect();
    const ms: number[] = [];
    try {
      // i = -1 is an untimed warm-up (plan cache / first-touch pages on a cold CI runner).
      for (let i = -1; i < 20; i++) {
        await c.query("BEGIN");
        await c.query("SELECT set_config('app.current_org', $1, true)", [HUB_ORG]);
        await c.query("SELECT set_config('statement_timeout', '2000', true)");
        const t0 = performance.now();
        const r = await c.query("SELECT count(*)::int AS n FROM kg_graph_neighbors($1::text[])", [[obj("hub")]]);
        if (i >= 0) ms.push(performance.now() - t0);
        await c.query("COMMIT");
        expect(r.rows[0].n).toBe(400);
      }
    } finally {
      await c.end();
    }
    ms.sort((a, b) => a - b);
    expect(ms[Math.ceil(ms.length * 0.95) - 1]!).toBeLessThan(300);
  });
});

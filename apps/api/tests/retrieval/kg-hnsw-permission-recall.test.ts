// @global-scope-fixture table:embedding_models: 本文件登记三个只属于它的模型（`f05-hnsw-fixture@1` 32 维、`f05-lifecycle@1`、`f05-mixed@1`），生命周期 / 多维度并存两个用例在 finally 里删掉后两个；`f05-hnsw-fixture` 保留（登记是幂等的 upsert，重跑收敛到同一行），别的文件不读这三个名字。
/**
 * Phase 18 F05 —— HNSW 向量索引 + 带权限过滤的召回率门槛（uc-18-2 R9；改造自
 * `tests/kernel/pgvector-permission-recall.test.ts`，那份十二行的集合量不出「率」）。
 *
 * ## 这份测试判什么
 *
 * 1. **索引真的在、真的被用**：每个登记模型在 segment_embeddings / object_embeddings 上各一条部分
 *    HNSW 表达式索引；「索引臂」的计划走它（EXPLAIN + pg_stat_user_indexes 每条查询 +1），并且被量的
 *    每一条查询都是「只走索引」拿满的 k 条（不是精确补全替它考的试）。
 * 2. **召回率门槛**：在 RLS（app 角色 + app.current_org / app.current_user_id）和生产用的作用域谓词
 *    之后，recall@10 的均值 ≥ `THRESHOLDS.vectorRecallBaseline`（S0-4 签的 0.9，只从登记表读）。
 *    真值是 TS 里对「有权看的集合」做的暴力精确 kNN，并且用 SQL 精确扫描核对过同一个集合；还有一条
 *    反证（窗口饿到 ef_search = k）证明这个量法**会**判不过。
 *
 *    两个臂、同一条 SQL：**planner 臂**就是生产发出去的语句——作用域很窄时规划器会走作用域 btree
 *    预过滤再精确排序（正确，也是它按代价做的选择）；**索引臂**在同一事务里 `enable_sort = off`，
 *    把显式排序定价出局，只剩 HNSW 能给出顺序——那正是 R9 担心的形态（作用域一变大规划器就会走到这里），
 *    门槛在这里判；planner 臂同样要过门槛。
 * 3. **跨 scope 恒零**：别的会话、别的用户的个人空间、别的 org（作用域 id 故意取成一样）——
 *    经索引召回的结果里一条都没有；拿一条越权行自己的向量去查（距离 0 的最近邻），它也不出来。
 * 4. **HNSW + 过滤的经典坑**：先取候选、后过滤 ⇒ 不足 k 条。先在同一份数据上把坑复现出来
 *    （ef_search=40、无迭代扫描时确实返回不满），再证明生产路径（ef 按 k 放大 + pgvector ≥ 0.8 迭代
 *    扫描 + 取不满时精确补全）在「有权集合 ≥ k」时恒返回 k 条，且就是精确真值。
 *
 * ## 数据
 *
 * 确定性（mulberry32 种子）：32 维，40 个簇中心，每行 = 某个中心 + 高斯噪声。**作用域与簇无关**——
 * 有权行和越权行在同一邻域里交错，过滤才有东西可以做错。object 侧 2 个 org × 4 个作用域 × 300 行
 * （+ 一个 12 行的小会话），segment 侧 2 个 org × 1200 行（+ 一个 72 行的小 org：12 行有权，其余是同 org 的
 * 别项目行与私人笔记——精确补全那一路也得把它们挡在外面），有权集合约占 1/4。
 *
 * object_embeddings 的查询是本文件自己写的：生产侧还没有 object 向量召回路（F08 的 vector 通道
 * `available:false`，要等向量 worker 写 embedding）。它的作用域谓词逐字照 `pg-knowledge-recall.ts`
 * （本会话 L0 ∪ 发起人本人 L1），走的是生产的 `hnsw-ann.ts`。segment 侧走的就是生产的
 * `PgSegmentRetriever.vector`。
 */
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { thresholds as TH } from "@repo/contracts";
import { asApp, asOwner, ensureDatabase, migrateOnce, resetOrgs, seedOrg } from "../support/db";
import { registerEmbeddingModel } from "../support/retrieval-fixtures";
import { RETRIEVAL_EMBEDDING_LIMITS } from "@repo/contracts/retrieval-embedding";
import { appConfig, migrationConfig } from "../../src/infrastructure/db/pg-config";
import { registerEmbeddingModel as registerModelAsOperator } from "../../src/infrastructure/retrieval/register-embedding-model";
import { PgDatabase } from "../../src/infrastructure/db/pg-database";
import { PgSegmentRetriever } from "../../src/infrastructure/retrieval/pg-segment-retriever";
import {
  annOrder,
  annThenExact,
  efSearchFor,
  exactOrder,
  prepareAnn,
  supportsIterativeScan,
  VectorDimensionMismatchError,
  type VectorSearchEvent,
  type VectorSearchPath,
} from "../../src/infrastructure/retrieval/hnsw-ann";
import type { DatabasePort, TenantSession } from "../../src/application/ports/database.port";
import { toOrgId } from "../../src/domain/org-id";

const DIMS = 32;
const CLUSTERS = 40;
const K = 10;
const QUERY_COUNT = 60;
const PER_SCOPE = 300;
const TINY = 12;
const MODEL = { model: "f05-hnsw-fixture", modelVersion: "1" };

const ORG_A = "org-f05-hnsw-a";
const ORG_B = "org-f05-hnsw-b";
const ORG_C = "org-f05-hnsw-c"; // segment side: a small org (12 eligible rows among its 72), for the under-fill case
const PROJ_A = "proj-f05-hnsw-a";
const PROJ_A2 = "proj-f05-hnsw-a2";
const PROJ_B = "proj-f05-hnsw-b";
const PROJ_C = "proj-f05-hnsw-c";
const PROJ_C2 = "proj-f05-hnsw-c2";

const ME = "u-f05-me";
const OTHER_USER = "u-f05-other";
const MY_THREAD = "t-f05-mine";
const OTHER_THREAD = "t-f05-other";
const TINY_THREAD = "t-f05-tiny";

/* ───────────────────────────── deterministic vectors ───────────────────────────── */

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(0xf05);
function gauss(): number {
  const u = Math.max(rand(), 1e-12);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand());
}
function unit(v: number[]): number[] {
  const n = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
  return v.map((x) => x / n);
}
// Rounded to 6 decimals BEFORE use, so the TS ground truth and pgvector (float4) see the same
// numbers up to float4 rounding -- far below the gaps between neighbours in this data.
const round = (v: number[]) => v.map((x) => Math.round(x * 1e6) / 1e6);
const CENTERS = Array.from({ length: CLUSTERS }, () => unit(Array.from({ length: DIMS }, gauss)));
function sample(noise: number): number[] {
  const c = CENTERS[Math.floor(rand() * CLUSTERS)]!;
  return round(c.map((x) => x + gauss() * noise));
}
const lit = (v: readonly number[]) => `[${v.join(",")}]`;
function cosineDistance(a: readonly number[], b: readonly number[]): number {
  let d = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { d += a[i]! * b[i]!; na += a[i]! * a[i]!; nb += b[i]! * b[i]!; }
  return 1 - d / Math.sqrt(na * nb);
}
function exactTopK(q: readonly number[], rows: readonly Row[], k: number): string[] {
  return rows
    .map((r) => ({ id: r.id, d: cosineDistance(q, r.vec) }))
    .sort((x, y) => x.d - y.d || x.id.localeCompare(y.id))
    .slice(0, k)
    .map((x) => x.id);
}

interface Row { id: string; vec: number[] }
interface ObjRow extends Row { org: string; scopeKind: "chat_session" | "personal"; scopeId: string }
interface SegRow extends Row { org: string; projectId: string | null; layer: "org" | "project" | "personal"; private: boolean }

/* ───────────────────────────── object fixture ───────────────────────────── */

const OBJECT_SCOPES: { scopeKind: ObjRow["scopeKind"]; scopeId: string; n: number }[] = [
  { scopeKind: "chat_session", scopeId: MY_THREAD, n: PER_SCOPE },
  { scopeKind: "personal", scopeId: ME, n: PER_SCOPE },
  { scopeKind: "chat_session", scopeId: OTHER_THREAD, n: PER_SCOPE },
  { scopeKind: "personal", scopeId: OTHER_USER, n: PER_SCOPE },
];
const OBJECTS: ObjRow[] = [];
for (const org of [ORG_A, ORG_B]) {
  // Org B reuses org A's scope ids on purpose: if org isolation leaned on "the thread id happens
  // to be different", these rows would come through the scope predicate.
  for (const s of OBJECT_SCOPES) {
    for (let i = 0; i < s.n; i++) {
      OBJECTS.push({ id: `f05o-${org.slice(-1)}-${s.scopeId}-${i}`, org, scopeKind: s.scopeKind, scopeId: s.scopeId, vec: sample(0.35) });
    }
  }
}
for (let i = 0; i < TINY; i++) {
  OBJECTS.push({ id: `f05o-a-${TINY_THREAD}-${i}`, org: ORG_A, scopeKind: "chat_session", scopeId: TINY_THREAD, vec: sample(0.35) });
}

/** Requester ME in their own personal thread MY_THREAD: L0 of that thread ∪ ME's L1 (F08/F12). */
const objEligible = (r: ObjRow) =>
  r.org === ORG_A && ((r.scopeKind === "chat_session" && r.scopeId === MY_THREAD) || (r.scopeKind === "personal" && r.scopeId === ME));
type LeakClass = "other-session" | "other-user-personal" | "other-org";
function objLeakClass(r: ObjRow): LeakClass | null {
  if (objEligible(r)) return null;
  if (r.org !== ORG_A) return "other-org";
  return r.scopeKind === "personal" ? "other-user-personal" : "other-session";
}
const OBJ_BY_ID = new Map(OBJECTS.map((o) => [o.id, o]));

/* ───────────────────────────── segment fixture ───────────────────────────── */

const SEGMENTS: SegRow[] = [];
function addSegs(org: string, n: number, projectId: string | null, layer: SegRow["layer"], priv: boolean) {
  const start = SEGMENTS.filter((s) => s.org === org).length;
  for (let i = 0; i < n; i++) {
    SEGMENTS.push({ id: `f05s-${org.slice(-1)}-${start + i}`, org, projectId, layer, private: priv, vec: sample(0.35) });
  }
}
addSegs(ORG_A, 400, PROJ_A, "project", false); // eligible
addSegs(ORG_A, 200, null, "org", false); // eligible (org layer is always in scope)
addSegs(ORG_A, 300, PROJ_A2, "project", false); // other project
addSegs(ORG_A, 300, null, "personal", true); // private personal notes (I-8)
addSegs(ORG_B, 600, PROJ_B, "project", false);
addSegs(ORG_B, 600, null, "org", false);
addSegs(ORG_C, TINY, PROJ_C, "project", false); // eligible
// Out-of-scope neighbours INSIDE the small org: when the index comes back short and the exact
// query fills k, that exact query must keep the candidate-set predicate (review N1 / mutation M1).
addSegs(ORG_C, 30, PROJ_C2, "project", false); // other project
addSegs(ORG_C, 30, null, "personal", true); // private personal notes (I-8)

/** Mirror of `CANDIDATE_SET` in pg-segment-retriever.ts, for (org, project). */
const segEligible = (org: string, projectId: string) => (r: SegRow) =>
  r.org === org && !(r.layer === "personal" && r.private) && (r.projectId === projectId || r.layer !== "project");
const SEG_BY_ID = new Map(SEGMENTS.map((s) => [s.id, s]));

const QUERIES = Array.from({ length: QUERY_COUNT }, () => sample(0.2));

/* ───────────────────────────── seeding ───────────────────────────── */

async function seedSegments(org: string, extraProject: string | null): Promise<void> {
  const rows = SEGMENTS.filter((s) => s.org === org);
  const art = `f05-art-${org}`;
  const ver = `${art}-v1`;
  await asApp(org, async (c) => {
    if (extraProject) {
      await c.query("INSERT INTO projects (id, org_id, name, kind) VALUES ($1,$2,$3,'workshop')", [extraProject, org, extraProject]);
      await c.query("INSERT INTO workshops (id, org_id) VALUES ($1,$2)", [extraProject, org]);
    }
    await c.query(
      `INSERT INTO artifacts (id, org_id, project_id, source, title, created_by, synthesized)
       VALUES ($1,$2,NULL,'upload',$1,'u-seed',false)`, [art, org]);
    await c.query(
      `INSERT INTO artifact_versions (id, org_id, artifact_id, version_number, object_storage_key, content_hash, mime, size_bytes, pinned_by)
       VALUES ($1,$2,$3,1,$4,$5,'application/octet-stream',1,'u-seed')`,
      [ver, org, art, `${org}/artifacts/${art}/v1/${ver}`, "0".repeat(64)]);
    const ids = rows.map((r) => r.id);
    await c.query(
      `INSERT INTO segments (id, org_id, artifact_version_id, kind, ordinal)
       SELECT id, $2, $3, 'text', ord::int FROM unnest($1::text[]) WITH ORDINALITY AS x(id, ord)`, [ids, org, ver]);
    await c.query(
      `INSERT INTO anchors (id, org_id, segment_id, kind, locator)
       SELECT id || '-anchor', $2, id, 'page', '1' FROM unnest($1::text[]) AS x(id)`, [ids, org]);
    await c.query(
      `INSERT INTO segment_text (segment_id, org_id, artifact_id, artifact_version_id, project_id, source_type, layer, private, lifecycle, content, tsv)
       SELECT id, $2, $3, $4, p, 'interview', l, pr, 'effective', 'f05 segment ' || id, ''::tsvector
         FROM unnest($1::text[], $5::text[], $6::text[], $7::boolean[]) AS x(id, p, l, pr)`,
      [ids, org, art, ver, rows.map((r) => r.projectId), rows.map((r) => r.layer), rows.map((r) => r.private)]);
    await c.query(
      `INSERT INTO segment_embeddings (segment_id, org_id, model, model_version, embedding)
       SELECT id, $2, $3, $4, v::vector FROM unnest($1::text[], $5::text[]) AS x(id, v)`,
      [ids, org, MODEL.model, MODEL.modelVersion, rows.map((r) => lit(r.vec))]);
  });
}

async function seedObjects(): Promise<void> {
  // Owner-side: app_rw has SELECT only on the ontology tables (writes go through the F03
  // executor). What is under test here is the READ path, which runs as app_rw below.
  await asOwner(async (c) => {
    await c.query(
      `INSERT INTO ontology_objects (id, org_id, scope_kind, scope_id, object_kind, name, created_by)
       SELECT id, o, k, s, 'concept', id, 'human' FROM unnest($1::text[], $2::text[], $3::text[], $4::text[]) AS x(id, o, k, s)`,
      [OBJECTS.map((r) => r.id), OBJECTS.map((r) => r.org), OBJECTS.map((r) => r.scopeKind), OBJECTS.map((r) => r.scopeId)]);
    await c.query(
      `INSERT INTO object_embeddings (org_id, target_kind, target_id, model, model_version, embedding)
       SELECT o, 'object', id, $3, $4, v::vector FROM unnest($1::text[], $2::text[], $5::text[]) AS x(id, o, v)`,
      [OBJECTS.map((r) => r.id), OBJECTS.map((r) => r.org), MODEL.model, MODEL.modelVersion, OBJECTS.map((r) => lit(r.vec))]);
  });
}

/* ───────────────────────────── object read path (app role + RLS) ───────────────────────────── */

const session = (c: pg.Client): TenantSession => ({
  query: async <R,>(sql: string, params?: readonly unknown[]) => ({ rows: (await c.query(sql, params as unknown[])).rows as R[] }),
});


/** Scope predicate verbatim from pg-knowledge-recall.ts: this thread's L0 ∪ the requester's own L1. */
function objectSql(order: string): string {
  return `SELECT oe.target_id AS id
            FROM object_embeddings oe
            JOIN ontology_objects o ON o.id = oe.target_id AND o.org_id = oe.org_id
           WHERE oe.org_id = $1 AND oe.target_kind = 'object' AND oe.model = $2 AND oe.model_version = $3
             AND o.merged_into IS NULL
             AND ((o.scope_kind = 'chat_session' AND o.scope_id = $4) OR (o.scope_kind = 'personal' AND o.scope_id = $5))
           ORDER BY ${order}
           LIMIT $7`;
}

/**
 * Two arms, same SQL:
 *
 * - `planner`: exactly what production sends. With a selective scope the planner may pre-filter
 *   through the scope btree and sort exactly -- correct, and the planner's call.
 * - `index`: the same statement with `enable_sort = off`, which prices the explicit sort out and
 *   leaves the HNSW index as the only way to produce the order. That is the configuration R9 is
 *   about (and the one the planner moves to as a scope grows), so it is where the rate is judged.
 */
type Arm = "planner" | "index";
const NO_PERSONAL = "~no-personal-scope~";

async function armSettings(c: pg.Client, arm: Arm): Promise<void> {
  if (arm === "index") await c.query("SELECT set_config('enable_sort', 'off', true)");
}

interface ObjSearch { ids: string[]; path: VectorSearchPath; annRows: number }

async function objectSearch(opts: { org: string; user: string; thread: string; personal: boolean; q: readonly number[]; k: number; arm: Arm; iterativeOff?: boolean }): Promise<ObjSearch> {
  return asApp(opts.org, async (c) => {
    await c.query("SELECT set_config('app.current_user_id', $1, true)", [opts.user]);
    await armSettings(c, opts.arm);
    const ann = await prepareAnn(session(c), MODEL, opts.q, opts.k);
    if (!ann) throw new Error("fixture model not registered");
    // Take the index's ability to keep scanning away AFTER production turned it on (review N2).
    if (opts.iterativeOff && ann.iterativeScan) await c.query("SELECT set_config('hnsw.iterative_scan', 'off', true)");
    // `personal` false = not the requester's own personal thread: L1 stays out (F08 (c4)).
    const params = [opts.org, MODEL.model, MODEL.modelVersion, opts.thread, opts.personal ? opts.user : NO_PERSONAL, lit(opts.q), opts.k];
    const run = async (order: string) => (await c.query<{ id: string }>(objectSql(order), params)).rows.map((r) => r.id);
    const r = await annThenExact(opts.k, () => run(annOrder("oe.embedding", "$6", ann.dims)), () => run(`${exactOrder("oe.embedding", "$6")}, oe.target_id`));
    return { ids: [...r.rows], path: r.path, annRows: r.annRows };
  });
}

async function explainObject(arm: Arm, order: string, q: readonly number[]): Promise<string> {
  return asApp(ORG_A, async (c) => {
    await c.query("SELECT set_config('app.current_user_id', $1, true)", [ME]);
    await armSettings(c, arm);
    await prepareAnn(session(c), MODEL, q, K);
    const params = [ORG_A, MODEL.model, MODEL.modelVersion, MY_THREAD, ME, lit(q), K];
    return (await c.query<{ "QUERY PLAN": string }>(`EXPLAIN (COSTS OFF) ${objectSql(order)}`, params))
      .rows.map((r) => r["QUERY PLAN"]).join("\n");
  });
}

/** A DatabasePort whose tenant transactions run in the `index` arm; the retriever is unchanged. */
function indexArmDb(inner: PgDatabase): DatabasePort {
  return {
    withTenant: (orgId, fn) => inner.withTenant(orgId, async (s) => {
      await s.query("SELECT set_config('enable_sort', 'off', true)");
      return fn(s);
    }),
    withoutTenant: (fn) => inner.withoutTenant(fn),
    close: () => inner.close(),
  };
}

/**
 * A DatabasePort whose sessions switch `hnsw.iterative_scan` back off right after production code
 * switched it on (`prepareAnn`, pgvector ≥ 0.8) -- so the exact-fill path runs on every version.
 * On < 0.8 production never issues that statement and this wrapper is a no-op.
 */
function iterativeOffDb(inner: DatabasePort): DatabasePort {
  return {
    withTenant: (orgId, fn) => inner.withTenant(orgId, (s) => fn({
      query: async <R,>(sql: string, params?: readonly unknown[]) => {
        const r = await s.query<R>(sql, params);
        if (sql.includes("'hnsw.iterative_scan'")) await s.query("SELECT set_config('hnsw.iterative_scan', 'off', true)");
        return r;
      },
    })),
    withoutTenant: (fn) => inner.withoutTenant(fn),
    close: () => inner.close(),
  };
}

/* ───────────────────────────── shared state ───────────────────────────── */

let iterative = false;
const baseline = TH.requireValue<number>(TH.THRESHOLDS.vectorRecallBaseline, "vectorRecallBaseline");

async function indexName(table: string): Promise<string> {
  const r = await asOwner((c) => c.query<{ n: string }>("SELECT embedding_hnsw_index_name($1, $2, $3) AS n", [table, MODEL.model, MODEL.modelVersion]));
  return r.rows[0]!.n;
}

async function idxScans(index: string): Promise<number> {
  const r = await asOwner((c) => c.query<{ n: string | null }>("SELECT idx_scan::text AS n FROM pg_stat_user_indexes WHERE indexrelname = $1", [index]));
  return Number(r.rows[0]?.n ?? 0);
}

/** Index-usage statistics are flushed when the backend exits; poll briefly for the flush. */
async function waitForScans(index: string, atLeast: number): Promise<number> {
  let n = await idxScans(index);
  for (let i = 0; i < 40 && n < atLeast; i++) {
    await new Promise((r) => setTimeout(r, 50));
    n = await idxScans(index);
  }
  return n;
}

const mean = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

beforeAll(async () => {
  ensureDatabase();
  await migrateOnce();
  await resetOrgs(ORG_A, ORG_B, ORG_C);
  // Dead tuples from an earlier local run still sit in the HNSW graph and take window slots
  // until vacuum; a fresh CI database has none. Vacuum so both measure the same thing.
  await asOwner(async (c) => { await c.query("VACUUM segment_embeddings"); await c.query("VACUUM object_embeddings"); });
  await registerEmbeddingModel(MODEL.model, MODEL.modelVersion, DIMS);
  await seedOrg({ orgId: ORG_A, projectId: PROJ_A });
  await seedOrg({ orgId: ORG_B, projectId: PROJ_B });
  await seedOrg({ orgId: ORG_C, projectId: PROJ_C });
  await seedSegments(ORG_A, PROJ_A2);
  await seedSegments(ORG_B, null);
  await seedSegments(ORG_C, PROJ_C2);
  await seedObjects();
  await asOwner((c) => c.query("ANALYZE segment_embeddings; ANALYZE object_embeddings; ANALYZE segment_text; ANALYZE ontology_objects"));
  const v = await asOwner((c) => c.query<{ v: string }>("SELECT extversion AS v FROM pg_extension WHERE extname = 'vector'"));
  iterative = supportsIterativeScan(v.rows[0]!.v);
  console.log(`[F05] pgvector ${v.rows[0]!.v}; iterative scan ${iterative ? "on (strict_order)" : "unavailable (< 0.8)"}`);
}, 180_000);

afterAll(async () => {
  await resetOrgs(ORG_A, ORG_B, ORG_C);
});

/* ───────────────────────────── 1. the index ───────────────────────────── */

describe("F05 ①: one HNSW index per registered model, on both embedding tables", () => {
  it("partial expression index at the registered dimension, cosine ops -- the same distance the channel ranks by", async () => {
    for (const t of ["segment_embeddings", "object_embeddings"]) {
      const name = await indexName(t);
      const r = await asOwner((c) => c.query<{ indexdef: string }>("SELECT indexdef FROM pg_indexes WHERE tablename = $1 AND indexname = $2", [t, name]));
      expect(r.rows, `${t}: ${name}`).toHaveLength(1);
      const def = r.rows[0]!.indexdef;
      expect(def).toMatch(new RegExp(`USING hnsw \\(\\(\\(?embedding\\)?::vector\\(${DIMS}\\)\\) vector_cosine_ops\\)`));
      expect(def).toContain(`model = '${MODEL.model}'::text`);
      expect(def).toContain(`model_version = '${MODEL.modelVersion}'::text`);
    }
  });

  it("the index arm's plan reads the HNSW index (EXPLAIN: same SQL, same params, app role under RLS); the exact form cannot", async () => {
    const name = await indexName("object_embeddings");
    const plan = await explainObject("index", annOrder("oe.embedding", "$6", DIMS), QUERIES[0]!);
    expect(plan, plan).toContain(`Index Scan using ${name}`);
    // Counter-proof: the exact-order form of the same statement can NOT use it, even with the
    // sort priced out -- so "the plan uses the index" is a property of the ANN expression.
    const exactPlan = await explainObject("index", exactOrder("oe.embedding", "$6"), QUERIES[0]!);
    expect(exactPlan).not.toContain(name);
  });
});

/* ───────────────────────────── 2 + 3. recall and zero leak ───────────────────────────── */

async function measureObjects(arm: Arm) {
  const eligible = OBJECTS.filter(objEligible);
  const leaks: Record<LeakClass, number> = { "other-session": 0, "other-user-personal": 0, "other-org": 0 };
  const recalls: number[] = [];
  const paths: Record<VectorSearchPath, number> = { ann: 0, "exact-completion": 0 };
  const short: number[] = [];
  for (const q of QUERIES) {
    const r = await objectSearch({ org: ORG_A, user: ME, thread: MY_THREAD, personal: true, q, k: K, arm });
    paths[r.path]++;
    if (r.ids.length !== K) short.push(r.ids.length);
    for (const id of r.ids) {
      const row = OBJ_BY_ID.get(id);
      if (!row) throw new Error(`unknown id ${id}`);
      const leak = objLeakClass(row);
      if (leak) leaks[leak]++;
    }
    const truth = exactTopK(q, eligible, K);
    recalls.push(truth.filter((id) => r.ids.includes(id)).length / K);
  }
  return { eligible: eligible.length, leaks, recalls, paths, short };
}

async function measureSegments(port: DatabasePort) {
  const events: VectorSearchEvent[] = [];
  const retriever = new PgSegmentRetriever(port, (e) => events.push(e));
  const eligibleRows = SEGMENTS.filter(segEligible(ORG_A, PROJ_A));
  const eligibleIds = new Set(eligibleRows.map((r) => r.id));
  const recalls: number[] = [];
  const foreign = { otherOrg: 0, otherProject: 0, privatePersonal: 0 };
  const short: number[] = [];
  for (const q of QUERIES) {
    const rows = await retriever.vector({ orgId: toOrgId(ORG_A), projectId: PROJ_A, query: "", timeRange: null, limit: K }, q, MODEL);
    const ids = rows.map((r) => r.ref.id);
    if (ids.length !== K) short.push(ids.length);
    for (const id of ids) {
      if (eligibleIds.has(id)) continue;
      const s = SEG_BY_ID.get(id);
      if (!s || s.org !== ORG_A) foreign.otherOrg++;
      else if (s.layer === "personal") foreign.privatePersonal++;
      else foreign.otherProject++;
    }
    const truth = exactTopK(q, eligibleRows, K);
    recalls.push(truth.filter((id) => ids.includes(id)).length / K);
  }
  const paths = events.reduce<Record<string, number>>((m, e) => ({ ...m, [e.path]: (m[e.path] ?? 0) + 1 }), {});
  return { eligible: eligibleRows.length, events, recalls, foreign, short, paths };
}

describe("F05 ②③: recall after RLS + scope filtering ≥ vectorRecallBaseline, and zero cross-scope leakage", () => {
  it("object_embeddings, index arm: HNSW index scanned once per query, every query filled by the index alone, recall@10 ≥ baseline, zero foreign rows", async () => {
    const index = await indexName("object_embeddings");
    const before = await idxScans(index);
    const m = await measureObjects("index");
    const scans = (await waitForScans(index, before + QUERY_COUNT)) - before;
    console.log(`[F05] object_embeddings [index arm] recall@${K}: mean=${mean(m.recalls).toFixed(4)} min=${Math.min(...m.recalls).toFixed(2)} over ${QUERY_COUNT} queries; eligible=${m.eligible}/${OBJECTS.length}; hnsw idx_scan +${scans}; paths=${JSON.stringify(m.paths)}; leaks=${JSON.stringify(m.leaks)}; baseline=${baseline}`);
    expect(m.eligible).toBeGreaterThanOrEqual(K * 10); // a rate over a population, not a handful
    expect(m.leaks).toEqual({ "other-session": 0, "other-user-personal": 0, "other-org": 0 });
    expect(m.short).toEqual([]);
    // The rate is the INDEX's: no measured query was rescued by exact completion...
    expect(m.paths).toEqual({ ann: QUERY_COUNT, "exact-completion": 0 });
    // ...and the HNSW index really served them.
    expect(scans).toBeGreaterThanOrEqual(QUERY_COUNT);
    expect(mean(m.recalls)).toBeGreaterThanOrEqual(baseline);
  }, 120_000);

  it("object_embeddings, planner arm (the SQL production sends, planner's own choice): recall@10 ≥ baseline, k rows, zero foreign rows", async () => {
    const m = await measureObjects("planner");
    console.log(`[F05] object_embeddings [planner arm] recall@${K}: mean=${mean(m.recalls).toFixed(4)} min=${Math.min(...m.recalls).toFixed(2)}; paths=${JSON.stringify(m.paths)}; leaks=${JSON.stringify(m.leaks)}`);
    expect(m.leaks).toEqual({ "other-session": 0, "other-user-personal": 0, "other-org": 0 });
    expect(m.short).toEqual([]);
    expect(mean(m.recalls)).toBeGreaterThanOrEqual(baseline);
  }, 120_000);

  it("segment_embeddings via PgSegmentRetriever.vector, index arm: HNSW scanned per query, index-only, recall@10 ≥ baseline, zero foreign rows", async () => {
    const index = await indexName("segment_embeddings");
    const before = await idxScans(index);
    const inner = new PgDatabase(appConfig());
    let m: Awaited<ReturnType<typeof measureSegments>>;
    try {
      m = await measureSegments(indexArmDb(inner));
    } finally {
      await inner.close(); // backend exit flushes its index-usage statistics
    }
    const scans = (await waitForScans(index, before + QUERY_COUNT)) - before;
    console.log(`[F05] segment_embeddings [index arm] recall@${K}: mean=${mean(m.recalls).toFixed(4)} min=${Math.min(...m.recalls).toFixed(2)} over ${QUERY_COUNT} queries; eligible=${m.eligible}/${SEGMENTS.length}; hnsw idx_scan +${scans}; paths=${JSON.stringify(m.paths)}; foreign=${JSON.stringify(m.foreign)}; ef_search=${m.events[0]?.efSearch}; baseline=${baseline}`);
    expect(m.foreign).toEqual({ otherOrg: 0, otherProject: 0, privatePersonal: 0 });
    expect(m.short).toEqual([]);
    expect(m.events).toHaveLength(QUERY_COUNT);
    expect(m.events.every((e) => e.path === "ann" && e.iterativeScan === iterative)).toBe(true);
    expect(scans).toBeGreaterThanOrEqual(QUERY_COUNT);
    expect(mean(m.recalls)).toBeGreaterThanOrEqual(baseline);
  }, 120_000);

  it("segment_embeddings via PgSegmentRetriever.vector, planner arm (production as composed): recall@10 ≥ baseline, k rows, zero foreign rows", async () => {
    const inner = new PgDatabase(appConfig());
    try {
      const m = await measureSegments(inner);
      console.log(`[F05] segment_embeddings [planner arm] recall@${K}: mean=${mean(m.recalls).toFixed(4)} min=${Math.min(...m.recalls).toFixed(2)}; paths=${JSON.stringify(m.paths)}; foreign=${JSON.stringify(m.foreign)}`);
      expect(m.foreign).toEqual({ otherOrg: 0, otherProject: 0, privatePersonal: 0 });
      expect(m.short).toEqual([]);
      expect(mean(m.recalls)).toBeGreaterThanOrEqual(baseline);
    } finally {
      await inner.close();
    }
  }, 120_000);

  it("counter-proof: the measurement CAN fail -- a starved window (ef_search = k, no completion) scores below the baseline", async () => {
    // Without this, recall ≥ baseline would be equally consistent with a measurement that always
    // reports 1 (e.g. comparing a list with itself).
    const eligible = OBJECTS.filter(objEligible);
    const recalls: number[] = [];
    for (const q of QUERIES.slice(0, 20)) {
      const ids = await asApp(ORG_A, async (c) => {
        await c.query("SELECT set_config('app.current_user_id', $1, true)", [ME]);
        await armSettings(c, "index");
        await c.query("SELECT set_config('hnsw.ef_search', $1, true)", [String(K)]);
        if (iterative) await c.query("SELECT set_config('hnsw.iterative_scan', 'off', true)");
        const params = [ORG_A, MODEL.model, MODEL.modelVersion, MY_THREAD, ME, lit(q), K];
        return (await c.query<{ id: string }>(objectSql(annOrder("oe.embedding", "$6", DIMS)), params)).rows.map((r) => r.id);
      });
      const truth = exactTopK(q, eligible, K);
      recalls.push(truth.filter((id) => ids.includes(id)).length / K);
    }
    console.log(`[F05] counter-proof (ef_search=${K}, no completion): mean recall@${K}=${mean(recalls).toFixed(4)}`);
    expect(mean(recalls)).toBeLessThan(baseline);
  });

  it("the TS ground truth is the database's own exact answer over the same RLS + scope-filtered set", async () => {
    // Guards the rates above from being measured against a ground truth that disagrees with what
    // the database considers eligible (a fixture bug that made both sides wrong the same way
    // would otherwise read as perfect recall).
    const eligible = OBJECTS.filter(objEligible);
    for (const q of QUERIES.slice(0, 5)) {
      const exact = await asApp(ORG_A, async (c) => {
        await c.query("SELECT set_config('app.current_user_id', $1, true)", [ME]);
        const params = [ORG_A, MODEL.model, MODEL.modelVersion, MY_THREAD, ME, lit(q), K];
        return (await c.query<{ id: string }>(objectSql(`${exactOrder("oe.embedding", "$6")}, oe.target_id`), params)).rows.map((r) => r.id);
      });
      expect(exact).toEqual(exactTopK(q, eligible, K));
    }
  });

  it("an out-of-scope row's OWN vector (distance 0 to itself) never surfaces it -- for each leak class, in both arms", async () => {
    const probes: Record<LeakClass, ObjRow> = {
      "other-session": OBJECTS.find((r) => objLeakClass(r) === "other-session")!,
      "other-user-personal": OBJECTS.find((r) => objLeakClass(r) === "other-user-personal")!,
      "other-org": OBJECTS.find((r) => objLeakClass(r) === "other-org" && r.scopeId === MY_THREAD)!,
    };
    for (const arm of ["index", "planner"] as const) {
      for (const [cls, row] of Object.entries(probes)) {
        const r = await objectSearch({ org: ORG_A, user: ME, thread: MY_THREAD, personal: true, q: row.vec, k: K, arm });
        expect(r.ids, `${arm}/${cls}`).not.toContain(row.id);
        expect(r.ids.every((id) => objEligible(OBJ_BY_ID.get(id)!)), `${arm}/${cls}`).toBe(true);
        expect(r.ids, `${arm}/${cls}`).toHaveLength(K);
      }
    }
    // Counter-proof: the same probe DOES come back first for the requester entitled to it -- the
    // row is reachable through the index; it is the filter that withholds it.
    const theirs = probes["other-user-personal"];
    const r = await objectSearch({ org: ORG_A, user: OTHER_USER, thread: OTHER_THREAD, personal: true, q: theirs.vec, k: K, arm: "index" });
    expect(r.ids[0]).toBe(theirs.id);
  });

  it("RLS alone already zeroes other users' personal rows and other orgs; the scope predicate is what removes other sessions", async () => {
    const count = (user: string | null) => asApp(ORG_A, async (c) => {
      if (user) await c.query("SELECT set_config('app.current_user_id', $1, true)", [user]);
      return (await c.query<{ scope_kind: string; scope_id: string; org_id: string; n: string }>(
        `SELECT o.scope_kind, o.scope_id, oe.org_id, count(*)::text AS n
           FROM object_embeddings oe JOIN ontology_objects o ON o.id = oe.target_id AND o.org_id = oe.org_id
          WHERE oe.model = $1 AND oe.model_version = $2
          GROUP BY 1, 2, 3`, [MODEL.model, MODEL.modelVersion])).rows;
    });
    const asMe = await count(ME);
    expect(asMe.filter((r) => r.org_id !== ORG_A)).toEqual([]); // other org: RLS
    expect(asMe.filter((r) => r.scope_kind === "personal" && r.scope_id !== ME)).toEqual([]); // other user's L1: RLS
    // Non-vacuity: other sessions ARE visible to RLS (same org) -- so the zero for
    // "other-session" above is the scope predicate's doing, not luck.
    expect(asMe.some((r) => r.scope_kind === "chat_session" && r.scope_id === OTHER_THREAD)).toBe(true);
    // Fail closed: without app.current_user_id no personal row is visible at all, not even ME's.
    const anon = await count(null);
    expect(anon.filter((r) => r.scope_kind === "personal")).toEqual([]);
  });
});

/* ───────────────────────────── 4. the filtered-HNSW pitfall ───────────────────────────── */

describe("F05 ④: HNSW-then-filter under-fill -- reproduced, then shown mitigated", () => {
  const tinyEligible = OBJECTS.filter((r) => r.org === ORG_A && r.scopeKind === "chat_session" && r.scopeId === TINY_THREAD);

  it("the pitfall is real on this data: index scan, default window, no iterative scan ⇒ fewer than k rows although ≥ k are eligible", async () => {
    expect(tinyEligible.length).toBeGreaterThanOrEqual(K);
    let short = 0;
    for (const q of QUERIES.slice(0, 20)) {
      const ids = await asApp(ORG_A, async (c) => {
        await c.query("SELECT set_config('app.current_user_id', $1, true)", [ME]);
        await armSettings(c, "index");
        await c.query("SELECT set_config('hnsw.ef_search', '40', true)");
        if (iterative) await c.query("SELECT set_config('hnsw.iterative_scan', 'off', true)");
        const params = [ORG_A, MODEL.model, MODEL.modelVersion, TINY_THREAD, NO_PERSONAL, lit(q), K];
        return (await c.query<{ id: string }>(objectSql(annOrder("oe.embedding", "$6", DIMS)), params)).rows.map((r) => r.id);
      });
      if (ids.length < K) short++;
    }
    console.log(`[F05] pitfall reproduction (index scan, ef_search=40, no iterative scan, eligible=${tinyEligible.length}/${OBJECTS.length}): ${short}/20 queries returned < ${K} rows`);
    expect(short).toBeGreaterThan(0);
  });

  /*
   * What the mitigation guarantees, per path -- asserted honestly for each:
   *
   *   * ALWAYS: exactly k rows when ≥ k are eligible (the R9 under-fill is gone), and every row in
   *     scope (zero leakage).
   *   * `exact-completion` (pgvector < 0.8, or the index came back short): the rows ARE the exact
   *     answer -- strict equality.
   *   * `ann` (e.g. pgvector ≥ 0.8, where iterative scan fills k from the index): the rows are
   *     APPROXIMATE neighbours, like every other index read. Their quality is governed by the same
   *     recall gate as ②: mean recall@k over the query set ≥ `vectorRecallBaseline`. Asserting
   *     exact equality here would demand more than HNSW promises (CI on pgvector ≥ 0.8 showed 9/10
   *     overlap on individual queries -- correct ANN behaviour, not a leak).
   */
  function judgeTinyScope(label: string, runs: { ids: readonly string[]; path: VectorSearchPath; truth: readonly string[]; inScope: (id: string) => boolean }[]) {
    const paths: Record<VectorSearchPath, number> = { ann: 0, "exact-completion": 0 };
    const annRecalls: number[] = [];
    for (const [i, r] of runs.entries()) {
      paths[r.path]++;
      expect(r.ids, `${label} #${i}`).toHaveLength(K);
      expect(r.ids.filter((id) => !r.inScope(id)), `${label} #${i}: out-of-scope rows`).toEqual([]);
      if (r.path === "exact-completion") expect([...r.ids].sort(), `${label} #${i}`).toEqual([...r.truth].sort());
      else annRecalls.push(r.truth.filter((id) => r.ids.includes(id)).length / K);
    }
    const annMean = annRecalls.length ? mean(annRecalls) : null;
    console.log(`[F05] ${label}: paths=${JSON.stringify(paths)}; ann-path mean recall@${K}=${annMean === null ? "n/a" : annMean.toFixed(4)}`);
    if (annMean !== null) expect(annMean).toBeGreaterThanOrEqual(baseline);
    return paths;
  }

  for (const arm of ["index", "planner"] as const) {
    it(`${arm} arm: the production path returns exactly k in-scope rows when ≥ k are eligible -- exact when completion ran, ≥ baseline recall when served by the index (objects)`, async () => {
      const runs = [];
      for (const q of QUERIES.slice(0, 20)) {
        const r = await objectSearch({ org: ORG_A, user: ME, thread: TINY_THREAD, personal: false, q, k: K, arm });
        runs.push({ ids: r.ids, path: r.path, truth: exactTopK(q, tinyEligible, K), inScope: (id: string) => tinyEligible.some((x) => x.id === id) });
      }
      const paths = judgeTinyScope(`tiny scope (objects, ${arm} arm, iterative=${iterative})`, runs);
      // Without iterative scan the index cannot fill k here, so completion MUST have run -- the
      // mitigation is exercised, not assumed.
      if (arm === "index" && !iterative) expect(paths["exact-completion"]).toBe(20);
    });
  }

  it("index arm, PgSegmentRetriever.vector: a small org (12 eligible rows) is a sliver of the shared index, and still gets exactly k in-scope rows (exact when completed, ≥ baseline recall when index-served)", async () => {
    const events: VectorSearchEvent[] = [];
    const runs = [];
    const inner = new PgDatabase(appConfig());
    try {
      const retriever = new PgSegmentRetriever(indexArmDb(inner), (e) => events.push(e));
      const eligible = SEGMENTS.filter(segEligible(ORG_C, PROJ_C));
      const eligibleIds = new Set(eligible.map((r) => r.id));
      for (const q of QUERIES.slice(0, 20)) {
        const rows = await retriever.vector({ orgId: toOrgId(ORG_C), projectId: PROJ_C, query: "", timeRange: null, limit: K }, q, MODEL);
        const ev = events[events.length - 1]!;
        runs.push({ ids: rows.map((r) => r.ref.id), path: ev.path, truth: exactTopK(q, eligible, K), inScope: (id: string) => eligibleIds.has(id) });
      }
    } finally {
      await inner.close();
    }
    expect(events).toHaveLength(20);
    judgeTinyScope(`tiny org (segments, index arm, iterative=${iterative}); under-filled index reads ${events.filter((e) => e.annRows < K).length}/20`, runs);
    if (!iterative) expect(events.every((e) => e.path === "exact-completion" && e.annRows < K)).toBe(true);
  });

  /*
   * The exact-fill path, forced on EVERY pgvector version (review N2). On ≥ 0.8 iterative scan
   * normally fills k from the index, so without this the fill query -- and its scope predicate --
   * would go untested wherever CI runs. Iterative scan is switched off AFTER `prepareAnn` turned
   * it on, i.e. the production code runs unchanged and only the index's ability to keep going is
   * taken away. Then: the fill path MUST run, and its answer MUST be the exact one.
   */
  it("exact-fill path, forced (iterative scan off after prepareAnn), objects: completion runs on every query and returns exactly the exact answer", async () => {
    let completions = 0;
    for (const q of QUERIES.slice(0, 20)) {
      const r = await objectSearch({ org: ORG_A, user: ME, thread: TINY_THREAD, personal: false, q, k: K, arm: "index", iterativeOff: true });
      if (r.path === "exact-completion") completions++;
      expect(r.ids).toEqual(exactTopK(q, tinyEligible, K));
    }
    expect(completions).toBe(20);
  });

  it("exact-fill path, forced, PgSegmentRetriever.vector: completion runs, returns the exact answer, and keeps the candidate-set predicate (other-project / private rows in the same org never return)", async () => {
    const orgRows = SEGMENTS.filter((r) => r.org === ORG_C);
    const eligible = orgRows.filter(segEligible(ORG_C, PROJ_C));
    const eligibleIds = new Set(eligible.map((r) => r.id));
    // Non-vacuity: without the predicate, out-of-scope rows of this org WOULD be among the nearest.
    const wouldLeak = QUERIES.slice(0, 20).reduce((n, q) => n + exactTopK(q, orgRows, K).filter((id) => !eligibleIds.has(id)).length, 0);
    expect(wouldLeak).toBeGreaterThan(0);

    const events: VectorSearchEvent[] = [];
    const inner = new PgDatabase(appConfig());
    const foreign: string[] = [];
    try {
      const retriever = new PgSegmentRetriever(iterativeOffDb(indexArmDb(inner)), (e) => events.push(e));
      for (const q of QUERIES.slice(0, 20)) {
        const rows = await retriever.vector({ orgId: toOrgId(ORG_C), projectId: PROJ_C, query: "", timeRange: null, limit: K }, q, MODEL);
        const ids = rows.map((r) => r.ref.id);
        foreign.push(...ids.filter((id) => !eligibleIds.has(id)));
        expect(ids).toEqual(exactTopK(q, eligible, K));
      }
    } finally {
      await inner.close();
    }
    console.log(`[F05] forced exact-fill (segments): completions ${events.filter((e) => e.path === "exact-completion").length}/20; out-of-scope rows that would rank in an unfiltered top-${K}: ${wouldLeak}; returned: ${foreign.length}`);
    expect(foreign).toEqual([]);
    expect(events.map((e) => e.path)).toEqual(Array(20).fill("exact-completion"));
  });

  it("fewer than k eligible ⇒ all of them, and nothing else (completion does not widen the scope)", async () => {
    for (const arm of ["index", "planner"] as const) {
      const r = await objectSearch({ org: ORG_A, user: ME, thread: TINY_THREAD, personal: false, q: QUERIES[0]!, k: 50, arm });
      expect(new Set(r.ids), arm).toEqual(new Set(tinyEligible.map((x) => x.id)));
    }
  });
});

/* ───────────────────────────── query-side guards ───────────────────────────── */

describe("F05: query-side guards", () => {
  it("a query vector of the wrong dimension is a structured error, not an empty result", async () => {
    const inner = new PgDatabase(appConfig());
    try {
      const err = await new PgSegmentRetriever(inner)
        .vector({ orgId: toOrgId(ORG_A), projectId: PROJ_A, query: "", timeRange: null, limit: K }, [1, 0, 0], MODEL)
        .catch((e: unknown) => e);
      expect(err).toBeInstanceOf(VectorDimensionMismatchError);
      expect((err as VectorDimensionMismatchError).code).toBe("vector_query_dimension_mismatch");
    } finally {
      await inner.close();
    }
  });

  it("supportsIterativeScan: 0.8.0 and later only", () => {
    expect(supportsIterativeScan("0.6.0")).toBe(false);
    expect(supportsIterativeScan("0.7.4")).toBe(false);
    expect(supportsIterativeScan("0.8.0")).toBe(true);
    expect(supportsIterativeScan("0.8.1")).toBe(true);
    expect(supportsIterativeScan("1.0")).toBe(true);
    expect(supportsIterativeScan("garbage")).toBe(false);
  });

  it("ef_search is sized to k within pgvector's bounds", () => {
    expect(efSearchFor(1)).toBe(40);
    expect(efSearchFor(K)).toBe(100);
    expect(efSearchFor(10_000)).toBe(1000);
  });
});

/* ───────────────────────────── index lifecycle follows the registry ───────────────────────────── */

describe("F05: the index follows the model registry (trigger on embedding_models)", () => {
  const LIFE = { model: "f05-lifecycle", modelVersion: "1" };
  const defs = () => asOwner((c) => c.query<{ tablename: string; indexdef: string }>(
    `SELECT tablename, indexdef FROM pg_indexes
      WHERE indexname IN (embedding_hnsw_index_name('segment_embeddings', $1, $2), embedding_hnsw_index_name('object_embeddings', $1, $2))
      ORDER BY tablename`, [LIFE.model, LIFE.modelVersion])).then((r) => r.rows);

  it("register ⇒ created; change dims ⇒ rebuilt at the new dims; unregister ⇒ dropped; > 2000 dims ⇒ registration refused", async () => {
    try {
      await asOwner((c) => c.query("DELETE FROM embedding_models WHERE model = $1", [LIFE.model]));
      await asOwner((c) => c.query("INSERT INTO embedding_models (model, model_version, dims) VALUES ($1,$2,8)", [LIFE.model, LIFE.modelVersion]));
      let d = await defs();
      expect(d.map((r) => r.tablename)).toEqual(["object_embeddings", "segment_embeddings"]);
      expect(d.every((r) => r.indexdef.includes("::vector(8)"))).toBe(true);

      await asOwner((c) => c.query("UPDATE embedding_models SET dims = 16 WHERE model = $1 AND model_version = $2", [LIFE.model, LIFE.modelVersion]));
      d = await defs();
      expect(d).toHaveLength(2);
      expect(d.every((r) => r.indexdef.includes("::vector(16)"))).toBe(true);

      await asOwner((c) => c.query("DELETE FROM embedding_models WHERE model = $1 AND model_version = $2", [LIFE.model, LIFE.modelVersion]));
      expect(await defs()).toEqual([]);

      // Fail closed: a model the index cannot serve is not registered at all, rather than
      // registered and silently served by a full exact scan. The database's cap is pinned to the
      // ONE stated limit, the contract constant (review N4): exactly the limit registers, one more
      // is refused.
      const MAX = RETRIEVAL_EMBEDDING_LIMITS.maxDimensions;
      await asOwner((c) => c.query("INSERT INTO embedding_models (model, model_version, dims) VALUES ($1,$2,$3)", [LIFE.model, LIFE.modelVersion, MAX]));
      expect((await defs()).every((r) => r.indexdef.includes(`::vector(${MAX})`))).toBe(true);
      await asOwner((c) => c.query("DELETE FROM embedding_models WHERE model = $1 AND model_version = $2", [LIFE.model, LIFE.modelVersion]));
      const err = await asOwner((c) => c.query("INSERT INTO embedding_models (model, model_version, dims) VALUES ($1,$2,$3)", [LIFE.model, LIFE.modelVersion, MAX + 1]))
        .catch((e: unknown) => e as { code?: string; message?: string });
      expect((err as { code?: string }).code).toBe("22023");
      expect((err as { message?: string }).message).toMatch(new RegExp(`at most ${MAX}\\b`));
      const left = await asOwner((c) => c.query("SELECT 1 FROM embedding_models WHERE model = $1", [LIFE.model]));
      expect(left.rows).toEqual([]);
      expect(await defs()).toEqual([]);
    } finally {
      await asOwner((c) => c.query("DELETE FROM embedding_models WHERE model = $1", [LIFE.model]));
    }
  });

  it("the operator registration path names the reason: over the limit ⇒ `embedding_model_dimensions_exceed_index_limit`, at the limit ⇒ registered", async () => {
    const MAX = RETRIEVAL_EMBEDDING_LIMITS.maxDimensions;
    try {
      await expect(registerModelAsOperator(migrationConfig(), LIFE.model, LIFE.modelVersion, MAX + 1))
        .rejects.toThrow(/^embedding_model_dimensions_exceed_index_limit$/);
      expect((await asOwner((c) => c.query("SELECT 1 FROM embedding_models WHERE model = $1", [LIFE.model]))).rows).toEqual([]);
      await registerModelAsOperator(migrationConfig(), LIFE.model, LIFE.modelVersion, MAX);
      expect(await defs()).toHaveLength(2);
    } finally {
      await asOwner((c) => c.query("DELETE FROM embedding_models WHERE model = $1", [LIFE.model]));
    }
  });

  it("ANALYZE still works while two models of different dimensions coexist (dual-write), on both tables", async () => {
    const MIXED = { model: "f05-mixed", modelVersion: "1" };
    const target = OBJECTS.find((r) => r.org === ORG_A)!;
    const seg = SEGMENTS.find((r) => r.org === ORG_A)!;
    try {
      await registerEmbeddingModel(MIXED.model, MIXED.modelVersion, 3);
      await asOwner((c) => c.query(
        `INSERT INTO object_embeddings (org_id, target_kind, target_id, model, model_version, embedding) VALUES ($1,'object',$2,$3,$4,'[1,0,0]')`,
        [ORG_A, target.id, MIXED.model, MIXED.modelVersion]));
      await asApp(ORG_A, (c) => c.query(
        `INSERT INTO segment_embeddings (segment_id, org_id, model, model_version, embedding) VALUES ($1,$2,$3,$4,'[1,0,0]')`,
        [seg.id, ORG_A, MIXED.model, MIXED.modelVersion]));
      // Without `SET STATISTICS 0` on `embedding` this throws "different vector dimensions 3 and
      // 32" -- and autovacuum's auto-analyze fails the same way, silently, forever.
      await asOwner(async (c) => {
        await c.query("ANALYZE segment_embeddings");
        await c.query("ANALYZE object_embeddings");
      });
      const stat = await asOwner((c) => c.query<{ attrelid: string; attstattarget: number }>(
        `SELECT attrelid::regclass::text AS attrelid, attstattarget FROM pg_attribute
          WHERE attrelid IN ('segment_embeddings'::regclass, 'object_embeddings'::regclass) AND attname = 'embedding' ORDER BY 1`));
      expect(stat.rows.map((r) => [r.attrelid, r.attstattarget])).toEqual([["object_embeddings", 0], ["segment_embeddings", 0]]);
    } finally {
      await asOwner(async (c) => {
        await c.query("DELETE FROM object_embeddings WHERE model = $1", [MIXED.model]);
        await c.query("DELETE FROM segment_embeddings WHERE model = $1", [MIXED.model]);
        await c.query("DELETE FROM embedding_models WHERE model = $1", [MIXED.model]);
      });
    }
  });

  it("the app role cannot call the index-management functions", async () => {
    await expect(asApp(ORG_A, (c) => c.query("SELECT embedding_hnsw_ensure('x','1',4)"))).rejects.toThrow(/permission denied/);
    await expect(asApp(ORG_A, (c) => c.query("SELECT embedding_hnsw_drop('x','1')"))).rejects.toThrow(/permission denied/);
  });
});

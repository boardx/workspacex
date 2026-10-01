/*
 * Issue #4175 —— 图路邻域在「枢纽实体」上不再超时、也不再饿死（F15 版 kg_graph_neighbors 的第二版）。
 *
 * 为什么：F15（20260925100000）把 F08 的一条 3 跳 cypher 拆成三次单跳，但每一跳仍是一次 cypher 调用，
 * 形如 `WHERE x.key IN $keys`——$keys 是上一跳的全部端点（上千个）组成的 agtype 列表，AGE 对每一行逐个比较，
 * 近似「行数 × 列表长度」。评审实测：枢纽实体挂 250 条结论 5.9 s（超过召回给图路的 2 s），600 条 30 s，
 * 1,100 条 56 s 且 3 跳 0 行——第二跳的前沿上限（1000 条边）被「指回种子本身」的边占满，真正的路径一条没留下。
 * 于是任何一个 org 里只要有一个被提到一两百次的实体，图路每一轮都「超时 ⇒ 降级」。
 *
 * 做法（三件事）：
 *   ① 不再调 cypher。AGE 的图本来就是关系表：`<图>."N"`（顶点：id, properties）与 `<图>."E"`（边：id, start_id,
 *      end_id, properties）。邻接就是 E 上按 start_id / end_id 的等值连接；本迁移给这两列（以及 N.id）补上 btree 索引
 *      （kg_age_ensure_schema 以后每次建图 / 投影都会确保它们在，这里再给已有的图补一次）。一条 SQL 走完三跳，
 *      每一跳都是「按 graphid 走索引」的 LATERAL 查找，没有「列表里逐个比」，也不给规划器留下中间结果之间嵌套循环的余地
 *      （函数体里有说明）；函数带 `SET jit = off`（估算行数常被放大，JIT 编译一次 ~1 s）。
 *   ② 第二跳的「m2 ≠ 本路径的种子」在截断**之前**按路径判（与 F08 同一条件），指回种子的边不再占前沿名额。
 *   ③ 截断不再是任意的：结论按「新 → 旧」排（canonical claims.created_at 降序，再按 key 升序、C 排序规则，
 *      得到一个全序；图里有而 canonical 已没有的结论排最后），每一处上限都按这个顺序取前 N 个。
 *
 * 语义（与 F08 的关系）——F08 的两种形状、两处 LIMIT 200 不变，只是 200 条从「任意」变成「按上面的顺序最靠前的」：
 *   1 跳：种子 —— 结论。全部这种行按（结论新旧, 种子 key, 关系）排，取前 200。
 *   3 跳：种子 —— 结论 m1 —— 实体 m2 —— 结论 c，m2 ≠ 本路径的种子、c ≠ 本路径的 m1（F08 的条件逐条相同）。
 *         全部这种行按（m1 新旧, c 新旧, 其余各列）排，取前 200。
 * 两处工作量上限（上限之内，结果与「F08 的全部路径按上述顺序取前 200」逐行相同；graph-neighbors-anchored.test.ts 在
 * 1,100 条结论的枢纽上对拍）：
 *   - 第 1 跳往下带的结论最多 c_frontier = 1000 个（最新的那些）。只有「最新的 1000 个结论加起来凑不满 200 条 3 跳路径、
 *     更旧的结论才凑得出」时，结果才会与不设上限不同。
 *   - 第 3 跳每个实体最多取 c_rows + 1 = 201 个结论（最新的那些）。这一条**不改变结果**：输出先按 m1 再按 c 排，
 *     某条路径能进前 200，排在它前面的同一 m1、同一 m2 的结论不到 200 个，再加上被排除的 m1 自己，至多 201。
 *   - 3 跳的拼接只做到「按 m1 顺序累计已确定凑满 200 条」的那个 m1 为止：每一行（m1, m2）至少贡献
 *     「m2 的结论数 − 1」条路径（至多排除 m1 自己），累计到 200 之后的 m1 排在这 200 条之后，不可能进结果。
 *     这也**不改变结果**，只是不去拼、不去排几十万条注定被截掉的路径。
 *
 * 实测（本地 PG16 + AGE 1.6，种子 = 枢纽实体，p95）：结论 250 → F15 382 ms / 本版 13 ms；600 → 829 ms / 17 ms；
 * 1,100 → 1,378 ms 且 3 跳 0 行 / 30 ms、3 跳 200 行；5,000 → 本版 100 ms（12 个实体全做种子 166 ms）。
 *
 * ⚠ 安全（SECURITY DEFINER，属主是迁移角色；F15 评审复现过一次提权）——本版保持 F15 的全部约束：
 *   - 函数体里**不建任何对象**（没有临时表、没有 DDL）；只读三张表：本 org 图 schema 下的 "N" / "E"（schema 名由
 *     kg_org_graph_name(app.current_org) 派生、%I 引用，属主是迁移角色，app_rw 在其中没有 CREATE），以及 public.claims。
 *   - 属主身份下 RLS 不生效，所以 claims 只按主键取 created_at，且只有 `org_id = 本 org`（org 只从 app.current_org 读）
 *     时才用它，别的 org 的行一个字段也拿不到（与 kg_live_vertices 同一原则）；图本身就是按 org 分的。
 *   - search_path 固定为 ag_catalog, pg_catalog, public, pg_temp（pg_temp 最后；函数 / 运算符解析本来就不看 pg_temp）；
 *     动态 SQL 里的函数一律带 schema 前缀；app_rw 在 public、ag_catalog 都没有 CREATE，劫持不了运算符。
 *   - 动态 SQL 里拼进去的只有图 schema 名（%I）；种子、org 一律走参数（$1 / $2）。
 *   - 只返回 id 与关系，列与 F08 相同；内容与可见性仍回 canonical 按 RLS 判（ADR-114 决策 3）。
 */

-- ─────────────────────────────── 邻接索引 ───────────────────────────────
-- 与 20260924200000 里的同名函数相比，只多了三条 btree（N.id、E.start_id、E.end_id）。
CREATE OR REPLACE FUNCTION kg_age_ensure_schema(p_graph text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ag_catalog, pg_catalog, public, pg_temp
AS $$
DECLARE
  v_graph_oid oid := (SELECT graphid FROM ag_catalog.ag_graph WHERE name = p_graph);
BEGIN
  IF NOT EXISTS (SELECT 1 FROM ag_catalog.ag_label WHERE graph = v_graph_oid AND name = 'N') THEN
    PERFORM ag_catalog.create_vlabel(p_graph::cstring, 'N'::cstring);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM ag_catalog.ag_label WHERE graph = v_graph_oid AND name = 'E') THEN
    PERFORM ag_catalog.create_elabel(p_graph::cstring, 'E'::cstring);
  END IF;
  EXECUTE format('CREATE INDEX IF NOT EXISTS n_props_gin ON %I."N" USING gin (properties)', p_graph);
  EXECUTE format('CREATE INDEX IF NOT EXISTS e_props_gin ON %I."E" USING gin (properties)', p_graph);
  -- #4175：图路邻域按 graphid 走邻接（kg_graph_neighbors），没有这三条就是每一跳整表扫描。
  EXECUTE format('CREATE INDEX IF NOT EXISTS n_id_btree ON %I."N" (id)', p_graph);
  EXECUTE format('CREATE INDEX IF NOT EXISTS e_start_btree ON %I."E" (start_id)', p_graph);
  EXECUTE format('CREATE INDEX IF NOT EXISTS e_end_btree ON %I."E" (end_id)', p_graph);
END
$$;
REVOKE ALL ON FUNCTION kg_age_ensure_schema(text) FROM PUBLIC;

-- 已有的 org 图补上索引。两层 IF 不能合并：没有 AGE 的库里 ag_catalog 不存在（同 kg_drop_org_graph 的说明）。
DO $$
DECLARE
  g text;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_extension WHERE extname = 'age') THEN
    FOR g IN
      SELECT gr.name::text FROM ag_catalog.ag_graph gr
       WHERE EXISTS (SELECT 1 FROM ag_catalog.ag_label l WHERE l.graph = gr.graphid AND l.name = 'N')
         AND EXISTS (SELECT 1 FROM ag_catalog.ag_label l WHERE l.graph = gr.graphid AND l.name = 'E')
         AND EXISTS (SELECT 1 FROM public.organizations o WHERE public.kg_org_graph_name(o.id) = gr.name::text)
    LOOP
      PERFORM public.kg_age_ensure_schema(g);
    END LOOP;
  END IF;
END
$$;

-- ─────────────────────────────── 图路邻域 ───────────────────────────────
CREATE OR REPLACE FUNCTION kg_graph_neighbors(p_seed_keys text[])
RETURNS TABLE (seed_key text, rel1 text, mid1_key text, rel2 text, mid2_key text, rel3 text, claim_key text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ag_catalog, pg_catalog, public, pg_temp
-- 估算行数常被放大（jsonb 展开、agtype 表达式），会触发 JIT：实测单次编译 ~1 s，而查询本身几十毫秒。
SET jit = off
AS $$
DECLARE
  -- 每种形状最多返回多少行（同 F08）
  c_rows     CONSTANT integer := 200;
  -- 第 1 跳往下带多少个结论（见文件头）
  c_frontier CONSTANT integer := 1000;
  v_org   text := current_setting('app.current_org', true);
  v_graph text;
BEGIN
  IF v_org IS NULL OR v_org = '' THEN RAISE EXCEPTION 'KG_NO_TENANT' USING ERRCODE = '42501'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_extension WHERE extname = 'age') THEN
    RAISE EXCEPTION 'KG_GRAPH_UNAVAILABLE: Apache AGE is not installed in this database' USING ERRCODE = '55000';
  END IF;
  v_graph := public.kg_org_graph_name(v_org);
  IF cardinality(p_seed_keys) = 0 OR NOT EXISTS (SELECT 1 FROM ag_catalog.ag_graph WHERE name = v_graph) THEN
    RETURN;
  END IF;

  -- 结论的全序：canonical 里越新越前（没有的排最后），再按 key（C 排序规则，与部署的库排序规则无关）。
  -- 形状上刻意不给规划器留「嵌套循环扫中间结果」的余地（图表的统计信息常常是旧的、agtype 表达式也估不准）：
  --   - 邻接一律是 LATERAL（OFFSET 0 不让它被拉平）按 graphid 走索引：边 = start_id 一支 + end_id 一支（无向，
  --     与 cypher 的 (a)-[e]-(b) 相同），端点 = N.id；
  --   - 结论新旧用标量子查询按主键取（org 条件写在 CASE 里而不是 WHERE：否则旧统计会让它改走 org 前缀索引、
  --     每查一条就把整个 org 的结论扫一遍；别的 org 的结论同样拿不到时间，只是排到最后）；
  --   - 第 3 跳按实体分组成一个 jsonb 对象（实体 → 它的结论列表），拼路径时按 key 取，不做中间结果之间的连接。
  RETURN QUERY EXECUTE format($q$
    WITH seed AS MATERIALIZED (
      SELECT DISTINCT n.id, n.properties ->> 'key'::text AS key
        FROM pg_catalog.unnest($1::text[]) k
        CROSS JOIN LATERAL (
          SELECT x.id, x.properties FROM %1$I."N" x WHERE x.properties @> ag_catalog.agtype_build_map('key', k) OFFSET 0) n
    ), hop1 AS MATERIALIZED (
      SELECT s.id AS s, s.key AS s_key, h.rel, v.id AS m1, v.properties ->> 'key'::text AS m1_key,
             (SELECT CASE WHEN cl.org_id = $2 THEN cl.created_at END FROM public.claims cl WHERE cl.id = v.properties ->> 'id'::text) AS m1_at
        FROM seed s
        CROSS JOIN LATERAL (
          SELECT e.properties ->> 'relation'::text AS rel, e.end_id AS o FROM %1$I."E" e WHERE e.start_id = s.id
          UNION ALL
          SELECT e.properties ->> 'relation'::text, e.start_id FROM %1$I."E" e WHERE e.end_id = s.id
          OFFSET 0) h
        CROSS JOIN LATERAL (SELECT y.id, y.properties FROM %1$I."N" y WHERE y.id = h.o OFFSET 0) v
       WHERE v.properties ->> 'kind'::text = 'claim'
    ), ranked AS MATERIALIZED (
      SELECT h.*, pg_catalog.dense_rank() OVER (ORDER BY h.m1_at DESC NULLS LAST, h.m1_key COLLATE "C") AS rk FROM hop1 h
    ), hop12 AS MATERIALIZED (
      -- m2 ≠ 本路径的种子：按路径判，在任何截断之前
      SELECT a.s_key, a.rel AS rel1, a.m1, a.m1_key, a.rk, h.rel AS rel2, v.id AS m2, v.properties ->> 'key'::text AS m2_key
        FROM ranked a
        CROSS JOIN LATERAL (
          SELECT e.properties ->> 'relation'::text AS rel, e.end_id AS o FROM %1$I."E" e WHERE e.start_id = a.m1
          UNION ALL
          SELECT e.properties ->> 'relation'::text, e.start_id FROM %1$I."E" e WHERE e.end_id = a.m1
          OFFSET 0) h
        CROSS JOIN LATERAL (SELECT y.id, y.properties FROM %1$I."N" y WHERE y.id = h.o OFFSET 0) v
       WHERE a.rk <= $3 AND h.o <> a.s AND v.properties ->> 'kind'::text = 'object'
    ), hop3 AS MATERIALIZED (
      SELECT m.m2, h.rel, v.id AS c, v.properties ->> 'key'::text AS c_key,
             (SELECT CASE WHEN cl.org_id = $2 THEN cl.created_at END FROM public.claims cl WHERE cl.id = v.properties ->> 'id'::text) AS c_at
        FROM (SELECT DISTINCT m2 FROM hop12) m
        CROSS JOIN LATERAL (
          SELECT e.properties ->> 'relation'::text AS rel, e.end_id AS o FROM %1$I."E" e WHERE e.start_id = m.m2
          UNION ALL
          SELECT e.properties ->> 'relation'::text, e.start_id FROM %1$I."E" e WHERE e.end_id = m.m2
          OFFSET 0) h
        CROSS JOIN LATERAL (SELECT y.id, y.properties FROM %1$I."N" y WHERE y.id = h.o OFFSET 0) v
       WHERE v.properties ->> 'kind'::text = 'claim'
    ), lists AS MATERIALIZED (
      -- 实体 → 它最新的 $4 + 1 个结论（[关系, key, 新旧, graphid]），以及这个数
      SELECT pg_catalog.jsonb_object_agg(z.m2::text, z.lst) AS by_m2, pg_catalog.jsonb_object_agg(z.m2::text, z.n) AS width
        FROM (
          SELECT x.m2, pg_catalog.max(x.r) AS n,
                 pg_catalog.jsonb_agg(pg_catalog.jsonb_build_array(x.rel, x.c_key, extract(epoch FROM x.c_at), x.c::text)) AS lst
            FROM (SELECT h.*, pg_catalog.dense_rank() OVER (PARTITION BY h.m2 ORDER BY h.c_at DESC NULLS LAST, h.c_key COLLATE "C") AS r
                    FROM hop3 h) x
           WHERE x.r <= $4 + 1
           GROUP BY x.m2) z
    ), cutoff AS (
      -- 每行 (m1, m2) 至少贡献「m2 的结论数 − 1」条路径；累计满 $4 条的那个 m1 之后的都进不了结果
      SELECT pg_catalog.min(x.rk) AS rk FROM (
        SELECT p.rk, pg_catalog.sum(((SELECT width FROM lists) ->> (p.m2::text))::integer - 1) OVER (ORDER BY p.rk) AS acc
          FROM hop12 p) x
       WHERE x.acc >= $4
    )
    (SELECT s_key, rel, NULL::text, NULL::text, NULL::text, NULL::text, m1_key
       FROM ranked
      ORDER BY rk, s_key COLLATE "C", rel COLLATE "C"
      LIMIT $4)
    UNION ALL
    (SELECT p.s_key, p.rel1, p.m1_key, p.rel2, p.m2_key, c ->> 0, c ->> 1
       FROM hop12 p
       CROSS JOIN LATERAL pg_catalog.jsonb_array_elements((SELECT by_m2 FROM lists) -> (p.m2::text)) c
      WHERE p.rk <= coalesce((SELECT rk FROM cutoff), $3) AND c ->> 3 <> p.m1::text
      ORDER BY p.rk, (c ->> 2)::numeric DESC NULLS LAST, (c ->> 1) COLLATE "C", p.s_key COLLATE "C", p.rel1 COLLATE "C",
               p.rel2 COLLATE "C", p.m2_key COLLATE "C", (c ->> 0) COLLATE "C"
      LIMIT $4)
  $q$, v_graph)
  USING p_seed_keys, v_org, c_frontier, c_rows;
END
$$;

REVOKE ALL ON FUNCTION kg_graph_neighbors(text[]) FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_rw') THEN
    GRANT EXECUTE ON FUNCTION kg_graph_neighbors(text[]) TO app_rw;
  END IF;
END
$$;


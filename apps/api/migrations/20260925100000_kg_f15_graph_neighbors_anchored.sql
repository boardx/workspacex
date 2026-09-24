/*
 * Phase 18 F15（记忆体验评测 E10「不卡顿」）—— 图路邻域改成**逐跳锚定**，形状与 F08 版相同。
 *
 * 为什么：F08 的 3 跳是一条 `MATCH (s)-[e1]-(m1)-[e2]-(m2)-[e3]-(c)` 的 cypher。AGE 把它编成一串嵌套循环，
 * 规划器从 m1（所有结论）起步、把 s 的过滤放在最外层——等于先枚举整张图的所有 3 跳路径再筛种子。实测一个用户
 * 聊了十几轮（94 个节点、99 条边）时单次要 3.9 秒，超过召回给图路的 2 秒上限，于是每一轮图路都「超时 ⇒ 降级」：
 * 回答下方挂一行「这次没能查全你的记忆」，而且首字晚了 2 秒。节点越多越慢（四重嵌套，近似 n⁴）。
 *
 * 做法：每一跳都从上一跳已知的端点出发（`WHERE x.key IN $keys`，AGE 对这一种形状先过滤再连边），三次单跳，
 * 在 SQL 里拼成路径：
 *   1 跳：种子 —— 结论                      （与 F08 第一段同一条 cypher）
 *   2 跳：上一步的结论 —— 实体
 *   3 跳：上一步的实体 —— 结论
 * 拼接时的条件与 F08 逐条相同：m2 ≠ 这条路径自己的种子、c ≠ 这条路径的 m1（F08 的边唯一性在这些端点条件下自然成立：
 * 同一条边的两端必须相同，而那正是被排除的情形）。输出各最多 200 条，同 F08。
 * 与 F08 的唯一差别是**每一跳的前沿上限**（KG_HOP_FRONTIER）：一个人人都提到的实体（「北极星项目」）连着几十上百条结论，
 * 不设上限，第二、三跳会把整张图拉进来。上限之内结果与 F08 逐行相同（graph-neighbors-anchored.test.ts 对拍）。
 *
 * ⚠ 安全（SECURITY DEFINER，属主是迁移角色）：函数体内**不建任何对象**（没有临时表、没有动态 DDL），
 * 中间结果只放在 plpgsql 变量里（jsonb / text[]）。临时表不行：调用方可以先在自己的 pg_temp 里建一张同名表、
 * 挂一个 TRUNCATE / INSERT 触发器，定义者身份执行时就会以属主身份跑调用方的代码（评审复现过提权）。
 * `definer-no-temp-objects.test.ts` 以 app_rw 身份重放这个攻击，断言提不了权。
 */
CREATE OR REPLACE FUNCTION kg_graph_neighbors(p_seed_keys text[])
RETURNS TABLE (seed_key text, rel1 text, mid1_key text, rel2 text, mid2_key text, rel3 text, claim_key text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ag_catalog, pg_catalog, public, pg_temp
AS $$
DECLARE
  -- 每一跳最多带多少条边往下走（见文件头）
  c_frontier CONSTANT integer := 1000;
  v_org   text := current_setting('app.current_org', true);
  v_graph text;
  v_hop1  jsonb;
  v_hop2  jsonb;
  v_hop3  jsonb;
  v_m1    text[];
  v_m2    text[];
BEGIN
  IF v_org IS NULL OR v_org = '' THEN RAISE EXCEPTION 'KG_NO_TENANT' USING ERRCODE = '42501'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_extension WHERE extname = 'age') THEN
    RAISE EXCEPTION 'KG_GRAPH_UNAVAILABLE: Apache AGE is not installed in this database' USING ERRCODE = '55000';
  END IF;
  v_graph := public.kg_org_graph_name(v_org);
  IF cardinality(p_seed_keys) = 0 OR NOT EXISTS (SELECT 1 FROM ag_catalog.ag_graph WHERE name = v_graph) THEN
    RETURN;
  END IF;

  -- 第 1 跳：种子 —— 结论
  EXECUTE format(
    'SELECT coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_array(q.s::text, q.r::text, q.c::text)), ''[]''::jsonb) FROM ('
    'SELECT * FROM ag_catalog.cypher(%L, $q$ MATCH (s:N)-[e:E]-(c:N) WHERE s.key IN $keys AND c.kind = ''claim'' '
    'RETURN s.key, e.relation, c.key $q$, $1) AS (s ag_catalog.agtype, r ag_catalog.agtype, c ag_catalog.agtype) LIMIT %s) q',
    v_graph, c_frontier)
    INTO v_hop1
    USING pg_catalog.jsonb_build_object('keys', pg_catalog.to_jsonb(p_seed_keys))::text::ag_catalog.agtype;

  RETURN QUERY
    SELECT h->>0, h->>1, NULL::text, NULL::text, NULL::text, NULL::text, h->>2
      FROM pg_catalog.jsonb_array_elements(v_hop1) h LIMIT 200;

  SELECT pg_catalog.array_agg(DISTINCT pg_catalog.btrim(h->>2, '"')) INTO v_m1 FROM pg_catalog.jsonb_array_elements(v_hop1) h;
  IF v_m1 IS NULL THEN RETURN; END IF;

  -- 第 2 跳：结论 —— 实体
  EXECUTE format(
    'SELECT coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_array(q.m1::text, q.r::text, q.m2::text)), ''[]''::jsonb) FROM ('
    'SELECT * FROM ag_catalog.cypher(%L, $q$ MATCH (m1:N)-[e:E]-(m2:N) WHERE m1.key IN $keys AND m2.kind = ''object'' '
    'RETURN m1.key, e.relation, m2.key $q$, $1) AS (m1 ag_catalog.agtype, r ag_catalog.agtype, m2 ag_catalog.agtype) LIMIT %s) q',
    v_graph, c_frontier)
    INTO v_hop2
    USING pg_catalog.jsonb_build_object('keys', pg_catalog.to_jsonb(v_m1))::text::ag_catalog.agtype;

  SELECT pg_catalog.array_agg(DISTINCT pg_catalog.btrim(h->>2, '"')) INTO v_m2 FROM pg_catalog.jsonb_array_elements(v_hop2) h;
  IF v_m2 IS NULL THEN RETURN; END IF;

  -- 第 3 跳：实体 —— 结论
  EXECUTE format(
    'SELECT coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_array(q.m2::text, q.r::text, q.c::text)), ''[]''::jsonb) FROM ('
    'SELECT * FROM ag_catalog.cypher(%L, $q$ MATCH (m2:N)-[e:E]-(c:N) WHERE m2.key IN $keys AND c.kind = ''claim'' '
    'RETURN m2.key, e.relation, c.key $q$, $1) AS (m2 ag_catalog.agtype, r ag_catalog.agtype, c ag_catalog.agtype) LIMIT %s) q',
    v_graph, c_frontier)
    INTO v_hop3
    USING pg_catalog.jsonb_build_object('keys', pg_catalog.to_jsonb(v_m2))::text::ag_catalog.agtype;

  RETURN QUERY
    SELECT a->>0, a->>1, a->>2, b->>1, b->>2, d->>1, d->>2
      FROM pg_catalog.jsonb_array_elements(v_hop1) a
      JOIN pg_catalog.jsonb_array_elements(v_hop2) b ON b->>0 = a->>2
      JOIN pg_catalog.jsonb_array_elements(v_hop3) d ON d->>0 = b->>2
     WHERE d->>2 <> a->>2 AND b->>2 <> a->>0
     LIMIT 200;
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

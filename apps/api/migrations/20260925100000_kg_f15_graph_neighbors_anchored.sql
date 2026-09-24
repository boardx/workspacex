/*
 * Phase 18 F15（记忆体验评测 E10「不卡顿」）—— 图路邻域改成**逐跳锚定**，结果与 F08 版逐行相同。
 *
 * 为什么：F08 的 3 跳是一条 `MATCH (s)-[e1]-(m1)-[e2]-(m2)-[e3]-(c)` 的 cypher。AGE 把它编成一串嵌套循环，
 * 规划器从 m1（所有结论）起步、把 s 的过滤放在最外层——等于先枚举整张图的所有 3 跳路径再筛种子。实测一个用户
 * 聊了十几轮（94 个节点、99 条边）时单次要 3.9 秒，超过召回给图路的 2 秒上限，于是每一轮图路都「超时 ⇒ 降级」：
 * 回答下方挂一行「这次没能查全你的记忆」，而且首字晚了 2 秒。节点越多越慢（四重嵌套，近似 n⁴）。
 *
 * 做法：每一跳都从上一跳已知的端点出发（`WHERE x.key IN $keys`，AGE 对这一种形状先过滤再连边），三次单跳，
 * 在 SQL 里拼成路径：
 *   1 跳：种子 —— 结论                      （与 F08 第一段同一条 cypher）
 *   2 跳：上一步的结论 —— 另一个实体（≠ 种子）
 *   3 跳：上一步的实体 —— 结论（≠ 第一跳那条结论）
 * 形状、过滤条件、每种最多 200 条都与 F08 相同；F08 的 `_ag_enforce_edge_uniqueness` 在这里自然成立：三条边分属
 * 结论—种子、结论—另一实体、另一实体—结论三种端点组合，不可能是同一条边。
 */
CREATE OR REPLACE FUNCTION kg_graph_neighbors(p_seed_keys text[])
RETURNS TABLE (seed_key text, rel1 text, mid1_key text, rel2 text, mid2_key text, rel3 text, claim_key text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ag_catalog, pg_catalog, public, pg_temp
AS $$
DECLARE
  v_org   text := current_setting('app.current_org', true);
  v_graph text;
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

  -- 第 1 跳：种子 —— 结论（全部，供后两跳锚定；返回给调用方的 1 跳结果仍最多 200 条）
  CREATE TEMP TABLE IF NOT EXISTS pg_temp.kg_hop1 (s text, r text, c text) ON COMMIT DROP;
  CREATE TEMP TABLE IF NOT EXISTS pg_temp.kg_hop2 (m1 text, r text, m2 text) ON COMMIT DROP;
  CREATE TEMP TABLE IF NOT EXISTS pg_temp.kg_hop3 (m2 text, r text, c text) ON COMMIT DROP;
  TRUNCATE pg_temp.kg_hop1, pg_temp.kg_hop2, pg_temp.kg_hop3;

  EXECUTE format(
    'INSERT INTO pg_temp.kg_hop1 SELECT s::text, r::text, c::text '
    'FROM ag_catalog.cypher(%L, $q$ MATCH (s:N)-[e:E]-(c:N) WHERE s.key IN $keys AND c.kind = ''claim'' '
    'RETURN s.key, e.relation, c.key $q$, $1) AS (s ag_catalog.agtype, r ag_catalog.agtype, c ag_catalog.agtype)', v_graph)
    USING jsonb_build_object('keys', to_jsonb(p_seed_keys))::text::ag_catalog.agtype;

  RETURN QUERY SELECT h.s, h.r, NULL::text, NULL::text, NULL::text, NULL::text, h.c FROM pg_temp.kg_hop1 h LIMIT 200;

  SELECT array_agg(DISTINCT trim(both '"' from h.c)) INTO v_m1 FROM pg_temp.kg_hop1 h;
  IF v_m1 IS NULL THEN RETURN; END IF;

  -- 第 2 跳：结论 —— 另一个实体（不是种子本身）
  EXECUTE format(
    'INSERT INTO pg_temp.kg_hop2 SELECT m1::text, r::text, m2::text '
    'FROM ag_catalog.cypher(%L, $q$ MATCH (m1:N)-[e:E]-(m2:N) WHERE m1.key IN $keys AND m2.kind = ''object'' '
    'AND NOT m2.key IN $seeds RETURN m1.key, e.relation, m2.key $q$, $1) '
    'AS (m1 ag_catalog.agtype, r ag_catalog.agtype, m2 ag_catalog.agtype)', v_graph)
    USING jsonb_build_object('keys', to_jsonb(v_m1), 'seeds', to_jsonb(p_seed_keys))::text::ag_catalog.agtype;

  SELECT array_agg(DISTINCT trim(both '"' from h.m2)) INTO v_m2 FROM pg_temp.kg_hop2 h;
  IF v_m2 IS NULL THEN RETURN; END IF;

  -- 第 3 跳：实体 —— 结论
  EXECUTE format(
    'INSERT INTO pg_temp.kg_hop3 SELECT m2::text, r::text, c::text '
    'FROM ag_catalog.cypher(%L, $q$ MATCH (m2:N)-[e:E]-(c:N) WHERE m2.key IN $keys AND c.kind = ''claim'' '
    'RETURN m2.key, e.relation, c.key $q$, $1) AS (m2 ag_catalog.agtype, r ag_catalog.agtype, c ag_catalog.agtype)', v_graph)
    USING jsonb_build_object('keys', to_jsonb(v_m2))::text::ag_catalog.agtype;

  RETURN QUERY
    SELECT a.s, a.r, a.c, b.r, b.m2, d.r, d.c
      FROM pg_temp.kg_hop1 a
      JOIN pg_temp.kg_hop2 b ON b.m1 = a.c
      JOIN pg_temp.kg_hop3 d ON d.m2 = b.m2
     WHERE d.c <> a.c AND b.m2 <> a.s
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

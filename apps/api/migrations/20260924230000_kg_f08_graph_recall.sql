/*
 * Phase 18 F08 —— 召回用的图路：从问题里解析出的实体（graphSeeds）出发，在本 org 的 AGE 图上走邻域，
 * **只返回 id 与走过的关系**（ADR-114 决策 3）。内容、作用域、可见性一律回 canonical 按 RLS 判——
 * 图里有全 org 所有人的 id，调用方拿到候选 id 后必须再和「本会话 / 本人」可见的结论集求交。
 *
 * 两种形状：
 *   1 跳：种子实体 —— 结论（结论直接提到这个实体）
 *   3 跳：种子实体 —— 结论 —— 另一个实体 —— 结论（「张三」相关的决定里提到的产品，又被哪些结论提到）
 * 每种最多 200 条；图路只加分、不单独决定结果（uc-18-2 R7-2），所以宁可少、不可慢。
 *
 * AGE 不可用 ⇒ KG_GRAPH_UNAVAILABLE（调用方把图路记为 available = false，其余通道照常）。
 */
CREATE OR REPLACE FUNCTION kg_graph_neighbors(p_seed_keys text[])
RETURNS TABLE (seed_key text, rel1 text, mid1_key text, rel2 text, mid2_key text, rel3 text, claim_key text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ag_catalog, pg_catalog, public, pg_temp
AS $$
DECLARE
  v_org   text := current_setting('app.current_org', true);
  v_graph text;
  v_param ag_catalog.agtype;
BEGIN
  IF v_org IS NULL OR v_org = '' THEN RAISE EXCEPTION 'KG_NO_TENANT' USING ERRCODE = '42501'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_extension WHERE extname = 'age') THEN
    RAISE EXCEPTION 'KG_GRAPH_UNAVAILABLE: Apache AGE is not installed in this database' USING ERRCODE = '55000';
  END IF;
  v_graph := public.kg_org_graph_name(v_org);
  IF cardinality(p_seed_keys) = 0 OR NOT EXISTS (SELECT 1 FROM ag_catalog.ag_graph WHERE name = v_graph) THEN
    RETURN;
  END IF;
  v_param := jsonb_build_object('seeds', to_jsonb(p_seed_keys))::text::ag_catalog.agtype;
  RETURN QUERY EXECUTE format(
    'SELECT s::text, r1::text, NULL::text, NULL::text, NULL::text, NULL::text, c::text '
    'FROM ag_catalog.cypher(%L, $q$ MATCH (s:N)-[e:E]-(c:N) WHERE s.key IN $seeds AND c.kind = ''claim'' '
    'RETURN s.key, e.relation, c.key LIMIT 200 $q$, $1) '
    'AS (s ag_catalog.agtype, r1 ag_catalog.agtype, c ag_catalog.agtype)', v_graph) USING v_param;
  RETURN QUERY EXECUTE format(
    'SELECT s::text, r1::text, m1::text, r2::text, m2::text, r3::text, c::text '
    'FROM ag_catalog.cypher(%L, $q$ MATCH (s:N)-[e1:E]-(m1:N)-[e2:E]-(m2:N)-[e3:E]-(c:N) '
    'WHERE s.key IN $seeds AND m1.kind = ''claim'' AND m2.kind = ''object'' AND c.kind = ''claim'' AND c <> m1 AND m2 <> s '
    'RETURN s.key, e1.relation, m1.key, e2.relation, m2.key, e3.relation, c.key LIMIT 200 $q$, $1) '
    'AS (s ag_catalog.agtype, r1 ag_catalog.agtype, m1 ag_catalog.agtype, r2 ag_catalog.agtype, '
    '    m2 ag_catalog.agtype, r3 ag_catalog.agtype, c ag_catalog.agtype)', v_graph) USING v_param;
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

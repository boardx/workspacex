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
/*
 * ⚠ 2026-09-27 改：函数定义放进「ag_catalog 在不在」的判断里（#3872）。
 *
 * 原写法在迁移时就引用 `ag_catalog`（`SET search_path = ag_catalog …` 与 `ag_catalog.agtype`
 * 类型的变量），而本地桌面版的 PGlite 没有 AGE —— 于是从这条迁移合入起（2026-09-24），
 * **本地版每一个全新安装都在迁移这一步失败、整个应用起不来**，用户只看到一句
 * `migration_failed`。这正是 F01（20260924170000_kg_f01_age_extension.sql）头注与
 * ADR-114 决策 5 明确要避免的事：「迁移失败会连带不用图的全部功能一起不可用；
 * AGE 不可用时的报错位置是用图的那一刻（KG_GRAPH_UNAVAILABLE），不是迁移时。」
 *
 * 本函数的作者其实已经写了运行时那一刻的 KG_GRAPH_UNAVAILABLE，只是函数**定义本身**
 * 就依赖 ag_catalog，走不到运行时。现在：
 *   · ag_catalog 存在（服务器版镜像）→ 建真函数，**函数体与原文逐字相同**；
 *   · 不存在（本地 PGlite）→ 建一个**签名完全相同**的替身：同样先做租户检查
 *     （KG_NO_TENANT / 42501），再抛同一个 KG_GRAPH_UNAVAILABLE（55000）。
 * 调用方拿到的契约在两种数据库上一模一样，「图路不可用、其余通道照常」照原设计生效。
 *
 * 对云端安全：迁移器按文件名跳过已应用的迁移、只记录不校验校验和，
 * 已经跑过这条的环境什么都不会变；只影响全新安装。
 */
DO $do$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_namespace WHERE nspname = 'ag_catalog') THEN
    EXECUTE $create$
CREATE OR REPLACE FUNCTION kg_graph_neighbors(p_seed_keys text[])
RETURNS TABLE (seed_key text, rel1 text, mid1_key text, rel2 text, mid2_key text, rel3 text, claim_key text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ag_catalog, pg_catalog, public, pg_temp
AS $fn$
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
$fn$
$create$;
  ELSE
    EXECUTE $create$
CREATE OR REPLACE FUNCTION kg_graph_neighbors(p_seed_keys text[])
RETURNS TABLE (seed_key text, rel1 text, mid1_key text, rel2 text, mid2_key text, rel3 text, claim_key text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp
AS $fn$
DECLARE
  v_org text := current_setting('app.current_org', true);
BEGIN
  IF v_org IS NULL OR v_org = '' THEN RAISE EXCEPTION 'KG_NO_TENANT' USING ERRCODE = '42501'; END IF;
  RAISE EXCEPTION 'KG_GRAPH_UNAVAILABLE: Apache AGE is not installed in this database' USING ERRCODE = '55000';
END
$fn$
$create$;
  END IF;
END
$do$;

REVOKE ALL ON FUNCTION kg_graph_neighbors(text[]) FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_rw') THEN
    GRANT EXECUTE ON FUNCTION kg_graph_neighbors(text[]) TO app_rw;
  END IF;
END
$$;

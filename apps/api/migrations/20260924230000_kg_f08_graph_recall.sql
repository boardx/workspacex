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
 * ⚠ 2026-09-27 改：函数定义放进「ag_catalog 在不在」的判断里（#3872 / PR #4300）。
 *
 * 原写法在 plpgsql 的 DECLARE 里声明 `ag_catalog.agtype` 类型的变量，而 plpgsql 在
 * **建函数那一刻**就要解析声明的类型。本地桌面版的 PGlite 没有 AGE —— 于是从这条迁移合入起
 * （2026-09-24），**本地版每一个全新安装都在迁移这一步失败、整个应用起不来**，用户只看到一句
 * `migration_failed`。这正是 F01（20260924170000_kg_f01_age_extension.sql）头注与
 * ADR-114 决策 5 明确要避免的事：「AGE 不可用时报错的位置是用图的那一刻（KG_GRAPH_UNAVAILABLE），
 * 不是迁移时。」
 *
 * 现在：
 *   · ag_catalog 存在（服务器版镜像）→ 建真函数，**连同 `AS $$ … $$;` 在内逐字等于原文**；
 *   · 不存在（本地 PGlite）→ 建一个**签名完全相同**的替身：同样先做租户检查
 *     （KG_NO_TENANT / 42501），再抛同一个 KG_GRAPH_UNAVAILABLE（55000）。
 *
 * ⚠ 真函数必须保持原样的双美元号分隔与结尾，而且它的建函数语句必须是本文件里**第一个**：
 *   tests/knowledge-graph/graph-neighbors-anchored.test.ts（F15）按文本从这里切出
 *   「F08 原版」做对照——从第一处建函数语句切到其后第一处「双美元号加分号」。
 *   第一版把结尾改成了别的分隔符，切法就一路切到文件末尾，CI 报
 *   `syntax error at or near "$create$; ELSE …"`。替身因此用 $fn$ 分隔、放在真函数之后。
 *   （这段注释刻意不写出那两串字面量——写出来的话，注释自己就成了「第一处」，
 *   第二版就是这么被自己的警告注释弄断的。）
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

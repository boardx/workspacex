/*
 * Phase 18 F01（#4074）—— Apache AGE 扩展 + 按 org 建图（ADR-114）。
 *
 * ## 这份迁移做两件事
 *
 * 1. `CREATE EXTENSION age` —— **只在 AGE 已安装时**执行。
 *    本仓的迁移同时跑在两种 Postgres 上：服务器版（`workspacex/postgres-age` 镜像，带 AGE）
 *    和本地桌面版（PGlite，只带 pgvector，没有 AGE）。无条件 CREATE 会让桌面版整条迁移链断掉。
 *    ADR-114 决策 5 要求的是「AGE 不可用时**显式**报错」，报错的位置是用图的那一刻
 *    （`KG_GRAPH_UNAVAILABLE`），不是迁移时——迁移失败会连带不用图的全部功能一起不可用。
 *
 * 2. `kg_ensure_current_org_graph()` —— 为**当前会话所属 org**幂等地建它专属的 AGE 图。
 *    - 图名由 org id 派生（`kg_org_graph_name`），不接受调用方传入 org：
 *      租户从 `app.current_org`（`pg-database.ts` 的 withTenant 设置）读，
 *      调用方没有办法替别的 org 建图，也就没有办法拿到别的 org 的图名去查（ADR-114 决策 3，I-13）。
 *    - SECURITY DEFINER：`create_graph` 要建 schema，运行时角色 `app_rw` 没有 DDL 权限（0001），
 *      只授它执行这一个函数，而不是放宽它的权限。
 *    - 并发两次首用同一 org：advisory lock 串行化，第二个看到图已存在直接返回。
 *
 * ## 不做什么
 *
 * - 不给 `app_rw` 任何图 schema 的直接读写权限。图的读写经后续 feature（F04 投影、F08 召回）
 *   的 SECURITY DEFINER 函数进行，同样只按 `app.current_org` 定位图——权限判定永远只有 RLS 一处。
 */

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'age') THEN
    CREATE EXTENSION IF NOT EXISTS age;
  END IF;
END
$$;

-- 图名：`wsx_org_` + org id 的 md5 前 24 位。
-- 为什么不直接用 org id：AGE 图名必须是合法标识符（≤ 63 字节、不含 `-` 等），而 org id 的格式
-- 不受本迁移控制；哈希得到的名字长度固定、字符集固定，且同一 org 永远得到同一个名字。
CREATE OR REPLACE FUNCTION kg_org_graph_name(p_org text) RETURNS text
LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE
AS $$ SELECT 'wsx_org_' || substr(md5(p_org), 1, 24) $$;

CREATE OR REPLACE FUNCTION kg_ensure_current_org_graph() RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
-- 固定 search_path：SECURITY DEFINER 函数若按调用方的 search_path 解析名字，调用方可以用
-- 同名对象劫持它（同 0010 的说明）。
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_org   text := current_setting('app.current_org', true);
  v_graph text;
BEGIN
  IF v_org IS NULL OR v_org = '' THEN
    RAISE EXCEPTION 'KG_NO_TENANT: app.current_org is not set' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'age') THEN
    RAISE EXCEPTION 'KG_GRAPH_UNAVAILABLE: Apache AGE is not installed in this database'
      USING ERRCODE = '55000';
  END IF;

  v_graph := public.kg_org_graph_name(v_org);
  PERFORM pg_advisory_xact_lock(hashtext('kg_graph:' || v_graph));

  IF NOT EXISTS (SELECT 1 FROM ag_catalog.ag_graph WHERE name = v_graph) THEN
    PERFORM ag_catalog.create_graph(v_graph::name);
  END IF;
  RETURN v_graph;
END
$$;

REVOKE ALL ON FUNCTION kg_ensure_current_org_graph() FROM PUBLIC;
REVOKE ALL ON FUNCTION kg_org_graph_name(text) FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_rw') THEN
    GRANT EXECUTE ON FUNCTION kg_ensure_current_org_graph() TO app_rw;
    GRANT EXECUTE ON FUNCTION kg_org_graph_name(text) TO app_rw;
  END IF;
END
$$;

/*
 * Phase 18 F04 —— AGE 投影：canonical 表 → 本 org 的 AGE 图（ADR-114 决策 2：图是可重建投影）。
 *
 * ## 数据流
 *
 *   ontology_objects / claims / ontology_edges 写入（只经 F03 执行器）
 *     └─ AFTER 触发器 → kg_projection_outbox（同一事务：canonical 落了，待投影就一定在）
 *   投影 worker（apps/api/src/infrastructure/knowledge-graph/kg-projection-worker.ts）
 *     └─ 按 org 调 kg_project_pending() → 逐条 upsert / 删除到 AGE，处理完删掉 outbox 行
 *
 * AGE 挂了（没装、查询报错）：kg_project_pending 抛错、事务回滚，outbox 行原样保留；
 * canonical 写入与它**不在同一事务**，照常成功。恢复后 worker 自动补齐，或跑 `pnpm graph:rebuild` 全量重建。
 *
 * ## 「应该在图里的是什么」只有一个定义
 *
 * `kg_live_vertices(org)` / `kg_live_edges(org)` 两个 SQL 函数。增量投影、全量重建、对拍测试都读它们——
 * 不存在第二份「哪些行该进图」的规则。
 *   - 顶点：带作用域的 object（未被合并）与 claim（未撤销、未被取代）。key = kind:id。
 *   - 边：带作用域、status = active、两端都「活着」的边。端点是消息 / 片段时，顶点随边一起建。
 *
 * ## 为什么所有函数都显式按 org 过滤
 *
 * 函数属主是迁移角色（postgres，超级用户），SECURITY DEFINER 下 RLS 不生效。
 * 所以每个查询都写死 `org_id = v_org`，v_org 只从 app.current_org 读，调用方传不进别的 org。
 * 个人空间的行也进图（图里只有 id 和类型，没有正文）；召回时回 canonical 按 RLS 读内容，
 * 别人的个人空间在那一步被滤掉（ADR-114 决策 3）。
 */

-- ─────────────────────────────── outbox ───────────────────────────────
CREATE TABLE IF NOT EXISTS kg_projection_outbox (
  id          bigserial PRIMARY KEY,
  org_id      text NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  target_kind text NOT NULL CHECK (target_kind IN ('object', 'claim', 'edge')),
  target_id   text NOT NULL,
  enqueued_at timestamptz NOT NULL DEFAULT now()
);
-- 同一目标只排一次：投影总是读 canonical 的**当前**状态，排两次没有意义。
CREATE UNIQUE INDEX IF NOT EXISTS kg_projection_outbox_target_uniq
  ON kg_projection_outbox (org_id, target_kind, target_id);

ALTER TABLE kg_projection_outbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE kg_projection_outbox FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS kg_projection_outbox_tenant ON kg_projection_outbox;
CREATE POLICY kg_projection_outbox_tenant ON kg_projection_outbox
  USING (org_id = current_setting('app.current_org', true))
  WITH CHECK (org_id = current_setting('app.current_org', true));
REVOKE ALL ON kg_projection_outbox FROM app_rw;
GRANT SELECT ON kg_projection_outbox TO app_rw;

CREATE OR REPLACE FUNCTION kg_enqueue_projection() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  r      record;
  v_kind text := CASE TG_TABLE_NAME WHEN 'ontology_objects' THEN 'object' WHEN 'claims' THEN 'claim' ELSE 'edge' END;
BEGIN
  IF TG_OP = 'DELETE' THEN r := OLD; ELSE r := NEW; END IF;
  -- 旧路径（phase-01）的无作用域行不进图。
  IF r.scope_kind IS NULL THEN RETURN NULL; END IF;
  -- org 整体删除的级联：org 已经不在了，没有图可投，也插不进（外键）。
  IF NOT EXISTS (SELECT 1 FROM organizations o WHERE o.id = r.org_id) THEN RETURN NULL; END IF;
  INSERT INTO kg_projection_outbox (org_id, target_kind, target_id)
  VALUES (r.org_id, v_kind, r.id)
  ON CONFLICT (org_id, target_kind, target_id) DO NOTHING;
  RETURN NULL;
END
$$;

DROP TRIGGER IF EXISTS kg_enqueue_projection_trg ON ontology_objects;
CREATE TRIGGER kg_enqueue_projection_trg AFTER INSERT OR UPDATE OR DELETE ON ontology_objects
  FOR EACH ROW EXECUTE FUNCTION kg_enqueue_projection();
DROP TRIGGER IF EXISTS kg_enqueue_projection_trg ON claims;
CREATE TRIGGER kg_enqueue_projection_trg AFTER INSERT OR UPDATE OR DELETE ON claims
  FOR EACH ROW EXECUTE FUNCTION kg_enqueue_projection();
DROP TRIGGER IF EXISTS kg_enqueue_projection_trg ON ontology_edges;
CREATE TRIGGER kg_enqueue_projection_trg AFTER INSERT OR UPDATE OR DELETE ON ontology_edges
  FOR EACH ROW EXECUTE FUNCTION kg_enqueue_projection();

-- ─────────────────────────────── 「该在图里的」唯一定义 ───────────────────────────────
CREATE OR REPLACE FUNCTION kg_live_vertices(p_org text)
RETURNS TABLE (key text, id text, kind text, scope_kind text, scope_id text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT 'object:' || o.id, o.id, 'object', o.scope_kind, o.scope_id
    FROM ontology_objects o
   WHERE o.org_id = p_org AND o.scope_kind IS NOT NULL AND o.merged_into IS NULL
  UNION ALL
  SELECT 'claim:' || c.id, c.id, 'claim', c.scope_kind, c.scope_id
    FROM claims c
   WHERE c.org_id = p_org AND c.scope_kind IS NOT NULL AND c.revoked_at IS NULL AND c.status <> 'superseded'
$$;

CREATE OR REPLACE FUNCTION kg_live_edges(p_org text)
RETURNS TABLE (id text, src_key text, src_id text, src_kind text, dst_key text, dst_id text, dst_kind text, relation text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp
AS $$
  WITH v AS (SELECT key FROM kg_live_vertices(p_org))
  SELECT e.id, e.src_kind || ':' || e.src_id, e.src_id, e.src_kind,
         e.dst_kind || ':' || e.dst_id, e.dst_id, e.dst_kind, e.relation
    FROM ontology_edges e
   WHERE e.org_id = p_org AND e.scope_kind IS NOT NULL AND e.status = 'active'
     AND (e.src_kind NOT IN ('object', 'claim') OR e.src_kind || ':' || e.src_id IN (SELECT key FROM v))
     AND (e.dst_kind NOT IN ('object', 'claim') OR e.dst_kind || ':' || e.dst_id IN (SELECT key FROM v))
$$;

-- ─────────────────────────────── AGE 写入（内部，不授给 app_rw） ───────────────────────────────
CREATE OR REPLACE FUNCTION kg_age_exec(p_graph text, p_cypher text, p_params jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ag_catalog, pg_catalog, public, pg_temp
AS $$
BEGIN
  -- cypher 文本只来自本迁移里的常量；变量一律走参数（$1 agtype），不拼进查询。
  EXECUTE format('SELECT * FROM ag_catalog.cypher(%L, $q$%s$q$, $1) AS (v ag_catalog.agtype)', p_graph, p_cypher)
    USING p_params::text::ag_catalog.agtype;
END
$$;

CREATE OR REPLACE FUNCTION kg_age_put_edge(p_graph text, e record) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  PERFORM kg_age_exec(p_graph, 'MATCH ()-[x:E {id: $id}]->() DELETE x', jsonb_build_object('id', e.id));
  PERFORM kg_age_exec(p_graph,
    'MERGE (a:N {key: $sk}) SET a.id = $sid, a.kind = $skind '
    'MERGE (b:N {key: $dk}) SET b.id = $did, b.kind = $dkind '
    'CREATE (a)-[:E {id: $id, relation: $rel}]->(b)',
    jsonb_build_object('sk', e.src_key, 'sid', e.src_id, 'skind', e.src_kind,
                       'dk', e.dst_key, 'did', e.dst_id, 'dkind', e.dst_kind, 'id', e.id, 'rel', e.relation));
END
$$;

CREATE OR REPLACE FUNCTION kg_age_project_one(p_graph text, p_org text, p_kind text, p_id text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v record; e record;
BEGIN
  IF p_kind = 'edge' THEN
    SELECT * INTO e FROM kg_live_edges(p_org) le WHERE le.id = p_id;
    IF FOUND THEN
      PERFORM kg_age_put_edge(p_graph, e);
    ELSE
      PERFORM kg_age_exec(p_graph, 'MATCH ()-[x:E {id: $id}]->() DELETE x', jsonb_build_object('id', p_id));
    END IF;
    RETURN;
  END IF;

  SELECT * INTO v FROM kg_live_vertices(p_org) lv WHERE lv.key = p_kind || ':' || p_id;
  IF FOUND THEN
    PERFORM kg_age_exec(p_graph,
      'MERGE (n:N {key: $key}) SET n.id = $id, n.kind = $kind, n.scope_kind = $sk, n.scope_id = $sid',
      jsonb_build_object('key', v.key, 'id', v.id, 'kind', v.kind, 'sk', v.scope_kind, 'sid', v.scope_id));
    -- 顶点刚「活过来」（例如撤销被撤回）：它的边之前因端点不活而没进图，这里补上。
    FOR e IN SELECT * FROM kg_live_edges(p_org) le WHERE le.src_key = v.key OR le.dst_key = v.key LOOP
      PERFORM kg_age_put_edge(p_graph, e);
    END LOOP;
  ELSE
    PERFORM kg_age_exec(p_graph, 'MATCH (n:N {key: $key}) DETACH DELETE n', jsonb_build_object('key', p_kind || ':' || p_id));
  END IF;
END
$$;

-- ─────────────────────────────── worker 入口 ───────────────────────────────
CREATE OR REPLACE FUNCTION kg_project_pending(p_limit integer DEFAULT 500) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_org   text := current_setting('app.current_org', true);
  v_graph text;
  r       record;
  n       integer := 0;
BEGIN
  IF v_org IS NULL OR v_org = '' THEN
    RAISE EXCEPTION 'KG_NO_TENANT' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM kg_projection_outbox WHERE org_id = v_org) THEN
    RETURN 0;
  END IF;
  v_graph := kg_ensure_current_org_graph();  -- AGE 不可用 ⇒ KG_GRAPH_UNAVAILABLE，整笔回滚，outbox 保留
  FOR r IN
    SELECT id, target_kind, target_id FROM kg_projection_outbox
     WHERE org_id = v_org ORDER BY id LIMIT p_limit FOR UPDATE SKIP LOCKED
  LOOP
    PERFORM kg_age_project_one(v_graph, v_org, r.target_kind, r.target_id);
    DELETE FROM kg_projection_outbox WHERE id = r.id;
    n := n + 1;
  END LOOP;
  RETURN n;
END
$$;

-- 有待投影的 org 列表：只给 id，不给内容；worker 据此逐个 org 进 withTenant。
CREATE OR REPLACE FUNCTION kg_projection_pending_orgs() RETURNS SETOF text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp
AS $$ SELECT DISTINCT org_id FROM kg_projection_outbox $$;

-- ─────────────────────────────── 全量重建（graph:rebuild） ───────────────────────────────
CREATE OR REPLACE FUNCTION kg_rebuild_current_org_graph() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_org   text := current_setting('app.current_org', true);
  v_graph text;
  v record; e record;
  nv integer := 0; ne integer := 0;
BEGIN
  IF v_org IS NULL OR v_org = '' THEN
    RAISE EXCEPTION 'KG_NO_TENANT' USING ERRCODE = '42501';
  END IF;
  v_graph := kg_ensure_current_org_graph();
  -- 重建期间挡住增量投影（同一把锁，kg_ensure_current_org_graph 里也拿它；事务级，可重入）
  PERFORM pg_advisory_xact_lock(hashtext('kg_graph:' || v_graph));
  PERFORM ag_catalog.drop_graph(v_graph::name, true);
  PERFORM ag_catalog.create_graph(v_graph::name);
  DELETE FROM kg_projection_outbox WHERE org_id = v_org;
  FOR v IN SELECT * FROM kg_live_vertices(v_org) LOOP
    PERFORM kg_age_exec(v_graph,
      'CREATE (n:N {key: $key, id: $id, kind: $kind, scope_kind: $sk, scope_id: $sid})',
      jsonb_build_object('key', v.key, 'id', v.id, 'kind', v.kind, 'sk', v.scope_kind, 'sid', v.scope_id));
    nv := nv + 1;
  END LOOP;
  FOR e IN SELECT * FROM kg_live_edges(v_org) LOOP
    PERFORM kg_age_put_edge(v_graph, e);
    ne := ne + 1;
  END LOOP;
  RETURN jsonb_build_object('graph', v_graph, 'vertices', nv, 'edges', ne);
END
$$;

-- ─────────────────────────────── 对拍：两边各出一份快照 ───────────────────────────────
-- 每行一个可比较的字符串：顶点 `V|key`，边 `E|id|src_key|dst_key|relation`。
-- 源端（消息 / 片段）顶点随边存在，不单独比较：边的比较已经覆盖了它们。
CREATE OR REPLACE FUNCTION kg_canonical_snapshot() RETURNS SETOF text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT 'V|' || key FROM kg_live_vertices(current_setting('app.current_org', true))
  UNION ALL
  SELECT 'E|' || id || '|' || src_key || '|' || dst_key || '|' || relation
    FROM kg_live_edges(current_setting('app.current_org', true))
$$;

CREATE OR REPLACE FUNCTION kg_graph_snapshot() RETURNS SETOF text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ag_catalog, pg_catalog, public, pg_temp
AS $$
DECLARE
  v_graph text := public.kg_org_graph_name(current_setting('app.current_org', true));
BEGIN
  IF NOT EXISTS (SELECT 1 FROM ag_catalog.ag_graph WHERE name = v_graph) THEN
    RETURN;
  END IF;
  RETURN QUERY EXECUTE format(
    'SELECT ''V|'' || (k::text) FROM ag_catalog.cypher(%L, $q$ MATCH (n:N) WHERE n.kind IN [''object'', ''claim''] RETURN n.key $q$) AS (k ag_catalog.agtype)',
    v_graph);
  RETURN QUERY EXECUTE format(
    'SELECT ''E|'' || (i::text) || ''|'' || (s::text) || ''|'' || (d::text) || ''|'' || (r::text) '
    'FROM ag_catalog.cypher(%L, $q$ MATCH (a:N)-[e:E]->(b:N) RETURN e.id, a.key, b.key, e.relation $q$) '
    'AS (i ag_catalog.agtype, s ag_catalog.agtype, d ag_catalog.agtype, r ag_catalog.agtype)',
    v_graph);
END
$$;

REVOKE ALL ON FUNCTION kg_enqueue_projection(), kg_live_vertices(text), kg_live_edges(text),
  kg_age_exec(text, text, jsonb), kg_age_put_edge(text, record), kg_age_project_one(text, text, text, text),
  kg_project_pending(integer), kg_projection_pending_orgs(), kg_rebuild_current_org_graph(),
  kg_canonical_snapshot(), kg_graph_snapshot() FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_rw') THEN
    -- worker 只需要这两个；重建与对拍走迁移角色（scripts/graph-rebuild.ts）。
    GRANT EXECUTE ON FUNCTION kg_project_pending(integer), kg_projection_pending_orgs() TO app_rw;
  END IF;
END
$$;

SELECT kernel_apply_org_freeze_policies();

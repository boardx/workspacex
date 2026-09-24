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
-- 同一目标可以有多行：每次 canonical 变动都追加一行，**不**做 ON CONFLICT 去重。
-- 去重看起来省事，但会丢更新：worker 已锁住某目标的旧行、正在投影时，并发写入命中那行、
-- DO NOTHING 直接返回；worker 随后把这唯一一行删掉——那次变动就永远没被投影。
-- 现在 worker 只删「它开始处理时看到的最大 id 及以下」的行（kg_project_pending），之后到的行留给下一轮。
CREATE TABLE IF NOT EXISTS kg_projection_outbox (
  id          bigserial PRIMARY KEY,
  org_id      text NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  target_kind text NOT NULL CHECK (target_kind IN ('object', 'claim', 'edge')),
  target_id   text NOT NULL,
  -- 单个目标投影失败（坏数据 / AGE 对这条报错）不拖垮整批：记次数与原因，超过上限不再重试，
  -- 由 graph:rebuild 或人工处理（kg_projection_dead 视图可查）。
  attempts    integer NOT NULL DEFAULT 0,
  last_error  text,
  enqueued_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS kg_projection_outbox_target_idx
  ON kg_projection_outbox (org_id, target_kind, target_id, id);

ALTER TABLE kg_projection_outbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE kg_projection_outbox FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS kg_projection_outbox_tenant ON kg_projection_outbox;
CREATE POLICY kg_projection_outbox_tenant ON kg_projection_outbox
  USING (org_id = current_setting('app.current_org', true))
  WITH CHECK (org_id = current_setting('app.current_org', true));
REVOKE ALL ON kg_projection_outbox FROM app_rw;
GRANT SELECT ON kg_projection_outbox TO app_rw;

-- 单个目标的重试上限：唯一的一处定义，视图、worker 入口、待处理 org 列表都读它。
CREATE OR REPLACE FUNCTION kg_projection_max_attempts() RETURNS integer
LANGUAGE sql IMMUTABLE AS $$ SELECT 5 $$;

-- 超过上限、不再自动重试的目标：给人看的出口（graph:rebuild 会把它们一并重建掉）。
CREATE OR REPLACE VIEW kg_projection_dead WITH (security_invoker = true) AS
  SELECT org_id, target_kind, target_id, max(attempts) AS attempts, max(last_error) AS last_error
    FROM kg_projection_outbox WHERE attempts >= kg_projection_max_attempts()
   GROUP BY org_id, target_kind, target_id;
GRANT SELECT ON kg_projection_dead TO app_rw;

CREATE OR REPLACE FUNCTION kg_enqueue_projection() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  r      record;
  v_kind text := CASE TG_TABLE_NAME WHEN 'ontology_objects' THEN 'object' WHEN 'claims' THEN 'claim' ELSE 'edge' END;
BEGIN
  IF TG_OP = 'DELETE' THEN r := OLD; ELSE r := NEW; END IF;
  -- 旧路径（phase-01）的无作用域行不进图。UPDATE 时新旧任一带作用域就排队（作用域被清空的行要从图里拿掉）。
  IF r.scope_kind IS NULL AND NOT (TG_OP = 'UPDATE' AND OLD.scope_kind IS NOT NULL) THEN RETURN NULL; END IF;
  -- org 整体删除的级联：org 已经不在了，没有图可投，也插不进（外键）。
  IF NOT EXISTS (SELECT 1 FROM public.organizations o WHERE o.id = r.org_id) THEN RETURN NULL; END IF;
  -- 库里没有 AGE（桌面版 PGlite）：永远不会被消费的行不排，否则 outbox 无限增长。
  -- 以后装上 AGE：跑一次 graph:rebuild 从 canonical 全量建图，不需要这些行。
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_extension WHERE extname = 'age') THEN RETURN NULL; END IF;
  INSERT INTO public.kg_projection_outbox (org_id, target_kind, target_id) VALUES (r.org_id, v_kind, r.id);
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
LANGUAGE plpgsql SET search_path = ag_catalog, pg_catalog, public, pg_temp
AS $$
BEGIN
  -- cypher 文本只来自本迁移里的常量；变量一律走参数（$1 agtype），不拼进查询。
  EXECUTE format('SELECT * FROM ag_catalog.cypher(%L, $q$%s$q$, $1) AS (v ag_catalog.agtype)', p_graph, p_cypher)
    USING p_params::text::ag_catalog.agtype;
END
$$;

CREATE OR REPLACE FUNCTION kg_age_put_edge(p_graph text, e record, p_fresh boolean DEFAULT false) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  -- 增量时先删同 id 的旧边（端点可能变过）；全量重建的新图里没有旧边，跳过这次扫描。
  IF NOT p_fresh THEN
    PERFORM kg_age_exec(p_graph, 'MATCH ()-[x:E {id: $id}]->() DELETE x', jsonb_build_object('id', e.id));
  END IF;
  PERFORM kg_age_exec(p_graph,
    'MERGE (a:N {key: $sk}) SET a.id = $sid, a.kind = $skind '
    'MERGE (b:N {key: $dk}) SET b.id = $did, b.kind = $dkind '
    'CREATE (a)-[:E {id: $id, relation: $rel}]->(b)',
    jsonb_build_object('sk', e.src_key, 'sid', e.src_id, 'skind', e.src_kind,
                       'dk', e.dst_key, 'did', e.dst_id, 'dkind', e.dst_kind, 'id', e.id, 'rel', e.relation));
END
$$;

-- 标签与属性索引：MATCH / MERGE 按属性 {key} / {id} 匹配，没有索引就是整图扫描。
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
END
$$;

-- 源端点（消息 / 片段）顶点只随边存在：边没了，孤立的源顶点一起清掉。
CREATE OR REPLACE FUNCTION kg_age_sweep_sources(p_graph text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  PERFORM kg_age_exec(p_graph,
    'MATCH (n:N) WHERE n.kind IN [''segment'', ''chat_message''] AND NOT EXISTS((n)-[]-()) DELETE n', '{}'::jsonb);
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
CREATE OR REPLACE FUNCTION kg_project_pending(p_limit integer DEFAULT 50) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_org   text := current_setting('app.current_org', true);
  v_graph text;
  t       record;
  n       integer := 0;
  v_swept boolean := false;
BEGIN
  IF v_org IS NULL OR v_org = '' THEN
    RAISE EXCEPTION 'KG_NO_TENANT' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM kg_projection_outbox WHERE org_id = v_org AND attempts < kg_projection_max_attempts()) THEN
    RETURN 0;
  END IF;
  v_graph := kg_ensure_current_org_graph();  -- AGE 不可用 ⇒ KG_GRAPH_UNAVAILABLE，整笔回滚，outbox 保留
  PERFORM kg_age_ensure_schema(v_graph);

  -- 先把本轮要处理的行锁住，按目标聚合：同一目标排了多行只投影一次，删到本轮看到的最大 id 为止。
  -- 本轮开始之后才到的行 id 更大，不会被删（见表头注释：不丢更新）。
  FOR t IN
    WITH picked AS (
      SELECT id, target_kind, target_id FROM kg_projection_outbox
       WHERE org_id = v_org AND attempts < kg_projection_max_attempts()
       ORDER BY id LIMIT p_limit
       FOR UPDATE SKIP LOCKED
    )
    SELECT target_kind, target_id, max(id) AS max_id FROM picked GROUP BY target_kind, target_id ORDER BY min(id)
  LOOP
    BEGIN
      PERFORM kg_age_project_one(v_graph, v_org, t.target_kind, t.target_id);
      DELETE FROM kg_projection_outbox
       WHERE org_id = v_org AND target_kind = t.target_kind AND target_id = t.target_id AND id <= t.max_id;
      n := n + 1;
      -- 边被删、或顶点死掉（DETACH DELETE 顺带删了它的边）都可能留下孤立的源顶点。
      v_swept := true;
    EXCEPTION
      -- 瞬时冲突（锁等不到、死锁、序列化失败）不算这条目标的错：不计次数，留给下一轮。
      WHEN lock_not_available OR deadlock_detected OR serialization_failure THEN
        NULL;
      WHEN OTHERS THEN
        -- 单个目标失败：子事务回滚它自己的图改动，记一次失败，继续下一个（不让一条坏数据卡住整个 org）。
        UPDATE kg_projection_outbox SET attempts = attempts + 1, last_error = left(SQLERRM, 500)
         WHERE org_id = v_org AND target_kind = t.target_kind AND target_id = t.target_id AND id <= t.max_id;
    END;
  END LOOP;
  IF v_swept THEN PERFORM kg_age_sweep_sources(v_graph); END IF;
  RETURN n;
END
$$;

-- 有待投影的 org 列表：只给 id，不给内容；worker 据此逐个 org 进 withTenant。
CREATE OR REPLACE FUNCTION kg_projection_pending_orgs() RETURNS SETOF text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp
AS $$ SELECT DISTINCT org_id FROM kg_projection_outbox WHERE attempts < kg_projection_max_attempts() $$;

-- 全局死信数（只有数字）：worker 发现它变大就报错，死信不会无声无息地堆着。
CREATE OR REPLACE FUNCTION kg_projection_dead_count() RETURNS bigint
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp
AS $$ SELECT count(DISTINCT (org_id, target_kind, target_id)) FROM kg_projection_outbox WHERE attempts >= kg_projection_max_attempts() $$;

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
  PERFORM kg_age_ensure_schema(v_graph);
  DELETE FROM kg_projection_outbox WHERE org_id = v_org;
  FOR v IN SELECT * FROM kg_live_vertices(v_org) LOOP
    PERFORM kg_age_exec(v_graph,
      'CREATE (n:N {key: $key, id: $id, kind: $kind, scope_kind: $sk, scope_id: $sid})',
      jsonb_build_object('key', v.key, 'id', v.id, 'kind', v.kind, 'sk', v.scope_kind, 'sid', v.scope_id));
    nv := nv + 1;
  END LOOP;
  FOR e IN SELECT * FROM kg_live_edges(v_org) LOOP
    PERFORM kg_age_put_edge(v_graph, e, true);
    ne := ne + 1;
  END LOOP;
  RETURN jsonb_build_object('graph', v_graph, 'vertices', nv, 'edges', ne);
END
$$;

-- ─────────────────────────────── 对拍：两边各出一份快照 ───────────────────────────────
-- 每行一个可比较的字符串：顶点 `V|key`，边 `E|id|src_key|dst_key|relation`。
-- 顶点包括源端点（消息 / 片段）：孤立的源顶点也是不一致，对拍要看得见。
CREATE OR REPLACE FUNCTION kg_canonical_snapshot() RETURNS SETOF text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp
AS $$
  WITH e AS (SELECT * FROM kg_live_edges(current_setting('app.current_org', true)))
  SELECT 'V|' || key FROM kg_live_vertices(current_setting('app.current_org', true))
  UNION
  -- 源端点（消息 / 片段）顶点：恰好是活边的那些端点，一个不多（孤立的要被清掉）。
  SELECT 'V|' || k FROM (SELECT src_key AS k, src_kind AS kind FROM e UNION SELECT dst_key, dst_kind FROM e) s
   WHERE s.kind NOT IN ('object', 'claim')
  UNION ALL
  SELECT 'E|' || id || '|' || src_key || '|' || dst_key || '|' || relation FROM e
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
    'SELECT ''V|'' || (k::text) FROM ag_catalog.cypher(%L, $q$ MATCH (n:N) RETURN n.key $q$) AS (k ag_catalog.agtype)',
    v_graph);
  RETURN QUERY EXECUTE format(
    'SELECT ''E|'' || (i::text) || ''|'' || (s::text) || ''|'' || (d::text) || ''|'' || (r::text) '
    'FROM ag_catalog.cypher(%L, $q$ MATCH (a:N)-[e:E]->(b:N) RETURN e.id, a.key, b.key, e.relation $q$) '
    'AS (i ag_catalog.agtype, s ag_catalog.agtype, d ag_catalog.agtype, r ag_catalog.agtype)',
    v_graph);
END
$$;

-- ─────────────────────────────── org 删除 ⇒ 它的图一起删 ───────────────────────────────
-- 图里只有 id，但 id 与个人空间的 scope_id（用户 id）同样是租户数据，不该比 org 活得久。
CREATE OR REPLACE FUNCTION kg_drop_org_graph() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_graph text := public.kg_org_graph_name(OLD.id);
BEGIN
  -- 两层 IF 不能合并：没有 AGE 的库（桌面版 PGlite）里 ag_catalog 不存在，合成一个表达式会在解析时就报错。
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_extension WHERE extname = 'age') THEN
    IF EXISTS (SELECT 1 FROM ag_catalog.ag_graph WHERE name = v_graph) THEN
      PERFORM ag_catalog.drop_graph(v_graph::name, true);
    END IF;
  END IF;
  RETURN NULL;
END
$$;
DROP TRIGGER IF EXISTS kg_drop_org_graph_trg ON organizations;
CREATE TRIGGER kg_drop_org_graph_trg AFTER DELETE ON organizations
  FOR EACH ROW EXECUTE FUNCTION kg_drop_org_graph();

REVOKE ALL ON FUNCTION kg_enqueue_projection(), kg_live_vertices(text), kg_live_edges(text),
  kg_age_exec(text, text, jsonb), kg_age_put_edge(text, record, boolean), kg_age_project_one(text, text, text, text),
  kg_age_ensure_schema(text), kg_age_sweep_sources(text), kg_drop_org_graph(),
  kg_project_pending(integer), kg_projection_pending_orgs(), kg_projection_dead_count(), kg_rebuild_current_org_graph(),
  kg_canonical_snapshot(), kg_graph_snapshot() FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_rw') THEN
    -- worker 只需要这两个；重建与对拍走迁移角色（scripts/graph-rebuild.ts）。
    GRANT EXECUTE ON FUNCTION kg_project_pending(integer), kg_projection_pending_orgs(), kg_projection_dead_count() TO app_rw;
  END IF;
END
$$;

SELECT kernel_apply_org_freeze_policies();

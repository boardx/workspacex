/*
 * Issue #4270 —— AGE 图里的重复边：投影必须与 canonical 活边（kg_live_edges）逐条一一对应。
 *
 * ## 根因
 *
 * F04（20260924200000）的 kg_age_put_edge 用**一条** cypher 写边：
 *
 *   MERGE (a:N {key: $sk}) SET a.id = …, a.kind = …
 *   MERGE (b:N {key: $dk}) SET b.id = …, b.kind = …
 *   CREATE (a)-[:E {…}]->(b)
 *
 * 端点已在图里时，MERGE 命中、SET 就地改写这个顶点（N 表里插入新版本）。AGE 执行 SET 时推进了命令计数，
 * 同一条语句里仍在进行的对 N 的扫描有时会**再看到**刚写出的新版本（Halloween 问题），MERGE 于是多产出一行，
 * 后面的 CREATE 按行执行，建出两条 id、端点、关系都相同的边。是否中招取决于新版本落在扫描位置的前面还是后面，
 * 所以看起来随机：本地实测每次写边约 6% 中招（3,000 次循环里最多同一 id 两条）。
 *   - 全量重建（graph:rebuild）先建好全部顶点再写边，**每一条**边都走「端点已存在」这个分支——
 *     #4175 的工人在一次重建后看到 2,420 条里 613 条重复，就是这个。
 *   - 增量投影里端点已存在的边同样会中；同一 id 下次再投影时「先删同 id 旧边」会把副本一起删掉，
 *     但只要这条边不再被触动，副本就一直留着。
 * 与重放 / 重试 / 重建和 worker 并发**无关**：两者本来就由同一把 advisory lock 串行（kg_ensure_current_org_graph 与
 * kg_rebuild_current_org_graph 拿同一个键；rebuildOrgGraph 在事务外先拿会话级锁），测试 ④ 钉住了这一点。
 *
 * F04 的对拍为什么没发现：graphParity（kg-graph-rebuild.ts）把两边的快照各转成 Set 再比，两条一模一样的边
 * 在 Set 里是一条。本 issue 同时把它改成按多重集比（同一个 PR 的 TS 改动）。
 *
 * ## 修法
 *
 * 1. kg_age_put_edge 拆成「端点 upsert」与「写边」两步：
 *      MERGE (n:N {key}) SET …   —— 每个端点单独一条语句；这里即使 MERGE 多产出一行，也只是同样的 SET 再做一次；
 *      MATCH (a:N {key: $sk}), (b:N {key: $dk}) CREATE (a)-[:E …]->(b) RETURN 1
 *                                 —— 这条语句不改 N，扫描 N 时没有新版本可看；
 *    并且写边**必须恰好产出 1 行**，否则抛 KG_EDGE_PROJECTION（fail closed：增量投影里这条目标记一次失败、留在 outbox，
 *    重建则整笔回滚），不再有「悄悄多写 / 少写一条边」的可能。
 *    全量重建（p_fresh）时 object / claim 端点已由顶点那一轮建好（kg_live_edges 只返回两端都活着的边），
 *    只有消息 / 片段这类源端点需要 upsert——重建的调用次数与改前相同量级。
 * 2. 已有重复边的清理：kg_age_dedupe_edges(graph) 删除「起点、终点、属性完全相同」的边里 graphid 较大的副本，
 *    返回删了几条；幂等（第二次返回 0）。本迁移对每个已有的 org 图跑一次。
 *    为什么选迁移而不是只靠 graph:rebuild：重建能清掉，但它要运维逐个环境手动跑；迁移在部署时自动执行一次、
 *    不依赖任何人记得去做，在干净的库上是空操作，强制重放（verify-migrations.sh）也只是再做一次空操作。
 *    只删「完全相同」的副本：别的不一致（端点不对、边多余）不在这里猜，留给对拍发现、由 graph:rebuild 处理。
 *
 * ## 安全（SECURITY DEFINER，属主是迁移角色；F15 评审复现过一次提权）
 *
 * - kg_age_put_edge 仍是 SECURITY DEFINER，search_path 仍固定为 pg_catalog, public, pg_temp（pg_temp 最后），
 *   函数体不建任何对象，也不再自己拼动态 SQL（写边经 kg_age_exec / kg_age_exec_count，cypher 文本是本文件里的常量，变量一律走 agtype 参数）。
 *   它仍不授给 app_rw（F04 的 REVOKE 保持；CREATE OR REPLACE 不改变已有的 ACL，这里再 REVOKE 一次）。
 *   org 作用域不变：调用它的 kg_age_project_one / kg_rebuild_current_org_graph 只按 app.current_org 定位图。
 * - kg_age_exec_count 与 kg_age_exec 同形：不是 SECURITY DEFINER，REVOKE FROM PUBLIC、不授给 app_rw，search_path 固定、
 *   pg_temp 最后，只把图名（%L）与迁移里的常量 cypher 拼进 SQL，变量走参数。
 * - kg_age_dedupe_edges **不是** SECURITY DEFINER：只有迁移角色（属主）调用；REVOKE FROM PUBLIC，不授给 app_rw。
 *   search_path 同样固定、pg_temp 最后；动态 SQL 里只拼图 schema 名（%I），不建对象。
 */

-- 同 kg_age_exec（20260924200000），只多返回 cypher 产出的行数：写边要据此断言「恰好一条」。
-- 不是 SECURITY DEFINER、不授给 app_rw；search_path 与 kg_age_exec 相同（AGE 的属性匹配要在 ag_catalog 里解析运算符）。
CREATE OR REPLACE FUNCTION kg_age_exec_count(p_graph text, p_cypher text, p_params jsonb) RETURNS bigint
LANGUAGE plpgsql SET search_path = ag_catalog, pg_catalog, public, pg_temp
AS $$
DECLARE
  n bigint;
BEGIN
  -- cypher 文本只来自迁移里的常量；变量一律走参数（$1 agtype），不拼进查询。
  EXECUTE format('SELECT count(*) FROM ag_catalog.cypher(%L, $q$%s$q$, $1) AS (v ag_catalog.agtype)', p_graph, p_cypher)
    INTO n USING p_params::text::ag_catalog.agtype;
  RETURN n;
END
$$;
REVOKE ALL ON FUNCTION kg_age_exec_count(text, text, jsonb) FROM PUBLIC;

CREATE OR REPLACE FUNCTION kg_age_put_edge(p_graph text, e record, p_fresh boolean DEFAULT false) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  n bigint;
BEGIN
  -- 增量时先删同 id 的旧边（端点可能变过；也顺带删掉改前留下的副本）；全量重建的新图里没有旧边，跳过这次扫描。
  IF NOT p_fresh THEN
    PERFORM kg_age_exec(p_graph, 'MATCH ()-[x:E {id: $id}]->() DELETE x', jsonb_build_object('id', e.id));
  END IF;
  -- 端点 upsert：每个端点一条语句（见文件头：不能与写边放在同一条语句里）。
  IF NOT p_fresh OR e.src_kind NOT IN ('object', 'claim') THEN
    PERFORM kg_age_exec(p_graph, 'MERGE (n:N {key: $key}) SET n.id = $id, n.kind = $kind',
      jsonb_build_object('key', e.src_key, 'id', e.src_id, 'kind', e.src_kind));
  END IF;
  IF NOT p_fresh OR e.dst_kind NOT IN ('object', 'claim') THEN
    PERFORM kg_age_exec(p_graph, 'MERGE (n:N {key: $key}) SET n.id = $id, n.kind = $kind',
      jsonb_build_object('key', e.dst_key, 'id', e.dst_id, 'kind', e.dst_kind));
  END IF;
  n := kg_age_exec_count(p_graph,
    'MATCH (a:N {key: $sk}), (b:N {key: $dk}) CREATE (a)-[:E {id: $id, relation: $rel}]->(b) RETURN 1',
    jsonb_build_object('sk', e.src_key, 'dk', e.dst_key, 'id', e.id, 'rel', e.relation));
  IF n <> 1 THEN
    RAISE EXCEPTION 'KG_EDGE_PROJECTION: edge % was written % times (expected exactly 1)', e.id, n
      USING ERRCODE = 'XX000';
  END IF;
END
$$;
REVOKE ALL ON FUNCTION kg_age_put_edge(text, record, boolean) FROM PUBLIC;

-- 已有重复边的清理：同一图里起点、终点、属性（id + relation）完全相同的边只留 graphid 最小的一条。
CREATE OR REPLACE FUNCTION kg_age_dedupe_edges(p_graph text) RETURNS integer
LANGUAGE plpgsql SET search_path = ag_catalog, pg_catalog, public, pg_temp
AS $$
DECLARE
  n integer;
BEGIN
  EXECUTE format(
    'DELETE FROM %1$I."E" x USING %1$I."E" y '
    'WHERE x.start_id = y.start_id AND x.end_id = y.end_id AND x.properties = y.properties AND x.id > y.id', p_graph);
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END
$$;
REVOKE ALL ON FUNCTION kg_age_dedupe_edges(text) FROM PUBLIC;

-- 已有的 org 图各清一次。两层 IF 不能合并：没有 AGE 的库里 ag_catalog 不存在（同 kg_drop_org_graph 的说明）。
DO $$
DECLARE
  g text;
  n integer;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_extension WHERE extname = 'age') THEN
    FOR g IN
      SELECT gr.name::text FROM ag_catalog.ag_graph gr
       WHERE EXISTS (SELECT 1 FROM ag_catalog.ag_label l WHERE l.graph = gr.graphid AND l.name = 'E')
         AND EXISTS (SELECT 1 FROM public.organizations o WHERE public.kg_org_graph_name(o.id) = gr.name::text)
    LOOP
      n := public.kg_age_dedupe_edges(g);
      IF n > 0 THEN
        RAISE NOTICE 'kg_age_dedupe_edges: removed % duplicate edge(s) from graph %', n, g;
      END IF;
    END LOOP;
  END IF;
END
$$;

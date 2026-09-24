/*
 * D12 —— 建出六跳路径所需的图节点与边（docs/research/super-instance-design.md §2.1）。
 *
 * 1. 放宽 `ontology_edges.src_kind / dst_kind` 的 CHECK（0009 写死六个产品域 kind），加上
 *    customer_instance / release / defect / pull_request / feature / evidence。
 *    kind 列表的单一事实源是 packages/contracts/src/ontology-projection.ts 的 OntologyNodeKind，
 *    与本文件的一致性由 apps/api/tests/retrieval/ontology-projection-mapping.test.ts 机械核对。
 * 2. 新增 `projection_source`：非 NULL 表示这行是仓库权威源的**投影**（人类决策 D17 读法 B），
 *    可重建、对产品只读——只有在事务内 `SET LOCAL workspacex.projection_sync = 'on'` 的同步脚本
 *    能写；组织删除的级联删除（pg_trigger_depth() > 1）不受阻。
 *
 * 只动 schema，不种数据（同 20260805030000 纪律）；customer_instance 行来自 D9/D10 遥测。
 */
ALTER TABLE ontology_edges DROP CONSTRAINT IF EXISTS ontology_edges_src_kind_check;
ALTER TABLE ontology_edges DROP CONSTRAINT IF EXISTS ontology_edges_dst_kind_check;
-- Phase 18（kg_f02，ADR-114）把端点类型收成一条合并约束 ontology_edges_kinds_chk，并新增
-- object / claim / chat_message。本迁移排在它之后，端点类型改由下面两条约束承载（含那三种），
-- 合并约束随之移除——同一事实只留一处约束，契约 ontologyProjection.EdgeEndpointKind 与其逐项对账。
ALTER TABLE ontology_edges DROP CONSTRAINT IF EXISTS ontology_edges_kinds_chk;

ALTER TABLE ontology_edges ADD CONSTRAINT ontology_edges_src_kind_check CHECK (src_kind IN (
  'person', 'project', 'decision', 'requirement', 'research', 'segment',
  'object', 'claim', 'chat_message',
  'customer_instance', 'release', 'defect', 'pull_request', 'feature', 'evidence'));
ALTER TABLE ontology_edges ADD CONSTRAINT ontology_edges_dst_kind_check CHECK (dst_kind IN (
  'person', 'project', 'decision', 'requirement', 'research', 'segment',
  'object', 'claim', 'chat_message',
  'customer_instance', 'release', 'defect', 'pull_request', 'feature', 'evidence'));

ALTER TABLE ontology_edges ADD COLUMN IF NOT EXISTS projection_source text
  CHECK (projection_source IS NULL OR projection_source IN ('repo'));

CREATE INDEX IF NOT EXISTS ontology_edges_projection_idx
  ON ontology_edges (org_id, projection_source) WHERE projection_source IS NOT NULL;

CREATE OR REPLACE FUNCTION ontology_edges_projection_readonly() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF pg_trigger_depth() > 1 THEN
    -- cascaded from organizations delete
    RETURN COALESCE(NEW, OLD);
  END IF;
  IF (TG_OP <> 'INSERT' AND OLD.projection_source IS NOT NULL)
     OR (TG_OP <> 'DELETE' AND NEW.projection_source IS NOT NULL) THEN
    IF current_setting('workspacex.projection_sync', true) IS DISTINCT FROM 'on' THEN
      RAISE EXCEPTION 'ontology_edges projection rows are read-only; the repository is authoritative (D17)'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;
  RETURN COALESCE(NEW, OLD);
END
$$;

DROP TRIGGER IF EXISTS ontology_edges_projection_readonly_trg ON ontology_edges;
CREATE TRIGGER ontology_edges_projection_readonly_trg
  BEFORE INSERT OR UPDATE OR DELETE ON ontology_edges
  FOR EACH ROW EXECUTE FUNCTION ontology_edges_projection_readonly();

/*
 * D4 / D11 —— 平台大脑的节点表 + 客户实例投影（docs/research/super-instance-design.md S1 / S5）。
 *
 * 1. `ontology_edges` 的 kind CHECK 再加两个知识 kind（methodology / lesson）；ADR 用已有 decision。
 *    kind 列表单一事实源仍是 packages/contracts/src/ontology-projection.ts 的 OntologyNodeKind，
 *    由 apps/api/tests/retrieval/ontology-projection-mapping.test.ts 与本文件（最新的 CHECK）逐字核对。
 * 2. `projection_source` 加 'telemetry'：D11 的客户实例与 running 边权威在 D10 车队投影，不在仓库。
 * 3. 新表 `ontology_nodes`：节点的标题 / 正文（ADR、方法论、经验；客户实例只存不透明哈希与运行事实）。
 *    投影行与 D12 的边同一套只读纪律——复用 ontology_edges_projection_readonly() 触发器函数。
 *
 * 只动 schema，不种数据。
 */
ALTER TABLE ontology_edges DROP CONSTRAINT IF EXISTS ontology_edges_src_kind_check;
ALTER TABLE ontology_edges DROP CONSTRAINT IF EXISTS ontology_edges_dst_kind_check;

ALTER TABLE ontology_edges ADD CONSTRAINT ontology_edges_src_kind_check CHECK (src_kind IN (
  'person', 'project', 'decision', 'requirement', 'research', 'segment',
  'customer_instance', 'release', 'defect', 'pull_request', 'feature', 'evidence',
  'methodology', 'lesson'));
ALTER TABLE ontology_edges ADD CONSTRAINT ontology_edges_dst_kind_check CHECK (dst_kind IN (
  'person', 'project', 'decision', 'requirement', 'research', 'segment',
  'customer_instance', 'release', 'defect', 'pull_request', 'feature', 'evidence',
  'methodology', 'lesson'));

ALTER TABLE ontology_edges DROP CONSTRAINT IF EXISTS ontology_edges_projection_source_check;
ALTER TABLE ontology_edges ADD CONSTRAINT ontology_edges_projection_source_check
  CHECK (projection_source IS NULL OR projection_source IN ('repo', 'telemetry'));

CREATE TABLE IF NOT EXISTS ontology_nodes (
  id                text PRIMARY KEY,
  org_id            text NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  kind              text NOT NULL CONSTRAINT ontology_nodes_kind_check CHECK (kind IN (
    'person', 'project', 'decision', 'requirement', 'research', 'segment',
    'customer_instance', 'release', 'defect', 'pull_request', 'feature', 'evidence',
    'methodology', 'lesson')),
  node_key          text NOT NULL CHECK (length(node_key) > 0),
  title             text NOT NULL CHECK (length(title) > 0),
  body              text NOT NULL DEFAULT '',
  source_path       text,
  content_hash      text NOT NULL,
  projection_source text CHECK (projection_source IS NULL OR projection_source IN ('repo', 'telemetry')),
  UNIQUE (org_id, kind, node_key)
);

CREATE INDEX IF NOT EXISTS ontology_nodes_projection_idx
  ON ontology_nodes (org_id, projection_source) WHERE projection_source IS NOT NULL;

ALTER TABLE ontology_nodes ENABLE ROW LEVEL SECURITY;
ALTER TABLE ontology_nodes FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ontology_nodes_tenant ON ontology_nodes;
CREATE POLICY ontology_nodes_tenant ON ontology_nodes
  USING (org_id = current_setting('app.current_org', true))
  WITH CHECK (org_id = current_setting('app.current_org', true));

REVOKE ALL ON ontology_nodes FROM app_rw;
GRANT SELECT, INSERT, UPDATE, DELETE ON ontology_nodes TO app_rw;

DROP TRIGGER IF EXISTS ontology_nodes_projection_readonly_trg ON ontology_nodes;
CREATE TRIGGER ontology_nodes_projection_readonly_trg
  BEFORE INSERT OR UPDATE OR DELETE ON ontology_nodes
  FOR EACH ROW EXECUTE FUNCTION ontology_edges_projection_readonly();

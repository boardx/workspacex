/*
 * 数字人标签（ad-hoc）：`agents.tags`（草稿）/ `agent_versions.tags`（发布快照）。
 *
 * 与 20260928230000_ag01 的七个角色冻结列同一约定：发布时由
 * apps/api/src/infrastructure/agent/agent-version-insert.ts 从 agents 原样拷入 agent_versions。
 * 形状规则（trim、1–20 字、去重）的单一事实源 = 契约 `AgentTags`
 * （packages/contracts/src/agent-role.ts）；DB 只兜底个数上限与「无 NULL 元素」。
 *
 * 回填：已导入官方角色包（1.0.0 / 1.1.0）的组织，四个官方角色 tags 仍为空的，写成 1.2.0 包里的
 * 标签（stableName → tags 的唯一声明处 = official-role-packs.ts ROLE_SEEDS；
 * official-role-pack-import.test.ts 核对本文件字面量与之一致）。草稿行与已发布版本同改——目录读
 * 的是发布快照；发布快照有不可变触发器，只对这一条 UPDATE 临时关掉（同 20260929150000）。
 * 只动 tags 一列、只动空数组的行；重复执行无副作用。
 */
ALTER TABLE agents ADD COLUMN IF NOT EXISTS tags text[] NOT NULL DEFAULT '{}'::text[];
ALTER TABLE agent_versions ADD COLUMN IF NOT EXISTS tags text[] NOT NULL DEFAULT '{}'::text[];

ALTER TABLE agents DROP CONSTRAINT IF EXISTS agents_tags_ok;
ALTER TABLE agents ADD CONSTRAINT agents_tags_ok
  CHECK (cardinality(tags) <= 10 AND array_position(tags, NULL) IS NULL);
ALTER TABLE agent_versions DROP CONSTRAINT IF EXISTS agent_versions_tags_ok;
ALTER TABLE agent_versions ADD CONSTRAINT agent_versions_tags_ok
  CHECK (cardinality(tags) <= 10 AND array_position(tags, NULL) IS NULL);

CREATE TEMP TABLE dh_official_tags_backfill (stable_name text PRIMARY KEY, tags text[] NOT NULL) ON COMMIT DROP;
INSERT INTO dh_official_tags_backfill (stable_name, tags) VALUES
  ('d002-research-knowledge-analyst', ARRAY['调研','知识管理','分析']),
  ('d003-product-manager',            ARRAY['产品','需求','规划']),
  ('d005-sales-representative',       ARRAY['销售','客户','商机']),
  ('d011-design-thinking-expert',     ARRAY['设计','创新','用户研究']);

ALTER TABLE agent_versions DISABLE TRIGGER agent_versions_immutable_trg;
UPDATE agent_versions v
   SET tags = b.tags
  FROM agents a
  JOIN dh_official_tags_backfill b ON b.stable_name = a.stable_name
 WHERE v.agent_id = a.id AND v.org_id = a.org_id
   AND a.catalog_source = 'official' AND v.catalog_source = 'official'
   AND cardinality(v.tags) = 0;
ALTER TABLE agent_versions ENABLE TRIGGER agent_versions_immutable_trg;

UPDATE agents a
   SET tags = b.tags
  FROM dh_official_tags_backfill b
 WHERE a.stable_name = b.stable_name AND a.catalog_source = 'official' AND cardinality(a.tags) = 0;

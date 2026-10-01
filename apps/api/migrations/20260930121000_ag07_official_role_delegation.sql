/*
 * AG07 —— 官方角色包 1.3.0：四个官方角色带上真实转交目标（`delegation_policy`），handoff 开箱可用。
 *
 * 目标的唯一声明处 = apps/api/src/domain/agent/official-role-packs.ts `officialRoleDelegationTargets()`
 * （由各角色 workflowAllowlist 推导：拥有本角色白名单外 Workflow 的其它官方角色）；本文件的字面量是
 * 被 tests/agent/official-role-pack-import.test.ts 机械核对的副本。maxDepth 1，requireApproval 保持 true。
 *
 * 回填：只动 `catalog_source='official'` 且 delegation_policy **仍是包默认值**（不允许任何转交）的行——
 * 管理员改过的不碰；只动这一列（tags / 头像等不碰）。草稿行与已发布版本同改（运行时读 run 钉住的
 * 发布快照）；发布快照有不可变触发器，只对这一条 UPDATE 临时关掉（同 20260929160000）。重复执行无副作用。
 */
CREATE TEMP TABLE ag07_official_delegation_backfill (stable_name text PRIMARY KEY, policy jsonb NOT NULL) ON COMMIT DROP;
INSERT INTO ag07_official_delegation_backfill (stable_name, policy) VALUES
  ('d002-research-knowledge-analyst', '{"allowedTargets":["D003","D005","D011"],"maxDepth":1,"requireApproval":true}'),
  ('d003-product-manager',            '{"allowedTargets":["D002","D005","D011"],"maxDepth":1,"requireApproval":true}'),
  ('d005-sales-representative',       '{"allowedTargets":["D002","D003","D011"],"maxDepth":1,"requireApproval":true}'),
  ('d011-design-thinking-expert',     '{"allowedTargets":["D002","D003","D005"],"maxDepth":1,"requireApproval":true}');

ALTER TABLE agent_versions DISABLE TRIGGER agent_versions_immutable_trg;
UPDATE agent_versions v
   SET delegation_policy = b.policy
  FROM agents a
  JOIN ag07_official_delegation_backfill b ON b.stable_name = a.stable_name
 WHERE v.agent_id = a.id AND v.org_id = a.org_id
   AND a.catalog_source = 'official' AND v.catalog_source = 'official'
   AND v.delegation_policy = '{"allowedTargets":[],"maxDepth":0,"requireApproval":true}'::jsonb;
ALTER TABLE agent_versions ENABLE TRIGGER agent_versions_immutable_trg;

UPDATE agents a
   SET delegation_policy = b.policy
  FROM ag07_official_delegation_backfill b
 WHERE a.stable_name = b.stable_name AND a.catalog_source = 'official'
   AND a.delegation_policy = '{"allowedTargets":[],"maxDepth":0,"requireApproval":true}'::jsonb;

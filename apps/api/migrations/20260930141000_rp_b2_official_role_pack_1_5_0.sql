/*
 * 官方角色包 1.5.0（rp-b2）：新增 D001 高管与战略伙伴 / D006 客户成功专员 / D007 项目与运营经理。
 *
 * 新增角色不需要回填——它们随「导入官方角色包」才出现在组织里（没有已导入的旧行）。受影响的是**既有四个**
 * 官方角色：转交目标 `officialRoleDelegationTargets()` 由各角色 workflowAllowlist 推导（拥有本角色白名单外
 * Workflow 的其它官方角色），三个新角色加入后 D002/D003/D005/D011 的 `allowedTargets` 随之变长。
 *
 * 目标的唯一声明处 = apps/api/src/domain/agent/official-role-packs.ts `officialRoleDelegationTargets()`；
 * 本文件的 new_policy 字面量是被 tests/agent/official-role-pack-import.test.ts 机械核对的副本，old_policy 是
 * 20260930121000_ag07_official_role_delegation.sql 写入的 1.3.0 值（同样被该测试核对）。
 *
 * 回填：只动 `catalog_source='official'` 且 delegation_policy **仍等于 1.3.0/1.4.0 值**的行——管理员改过的
 * 不碰；只动这一列。草稿行与已发布版本同改（运行时读 run 钉住的发布快照）；发布快照有不可变触发器，
 * 只对这一条 UPDATE 临时关掉（同 20260930121000）。重复执行无副作用（第二次 old_policy 已不匹配）。
 * 不建任何租户表 ⇒ 无需 kernel_apply_org_freeze_policies()。
 */
CREATE TEMP TABLE rp_b2_official_delegation_backfill (stable_name text PRIMARY KEY, old_policy jsonb NOT NULL, new_policy jsonb NOT NULL) ON COMMIT DROP;
INSERT INTO rp_b2_official_delegation_backfill (stable_name, old_policy, new_policy) VALUES
  ('d002-research-knowledge-analyst', '{"allowedTargets":["D003","D005","D011"],"maxDepth":1,"requireApproval":true}', '{"allowedTargets":["D001","D003","D005","D006","D007","D011"],"maxDepth":1,"requireApproval":true}'),
  ('d003-product-manager',            '{"allowedTargets":["D002","D005","D011"],"maxDepth":1,"requireApproval":true}', '{"allowedTargets":["D001","D002","D005","D006","D007","D011"],"maxDepth":1,"requireApproval":true}'),
  ('d005-sales-representative',       '{"allowedTargets":["D002","D003","D011"],"maxDepth":1,"requireApproval":true}', '{"allowedTargets":["D001","D002","D003","D006","D007","D011"],"maxDepth":1,"requireApproval":true}'),
  ('d011-design-thinking-expert',     '{"allowedTargets":["D002","D003","D005"],"maxDepth":1,"requireApproval":true}', '{"allowedTargets":["D001","D002","D003","D005","D006","D007"],"maxDepth":1,"requireApproval":true}');

ALTER TABLE agent_versions DISABLE TRIGGER agent_versions_immutable_trg;
UPDATE agent_versions v
   SET delegation_policy = b.new_policy
  FROM agents a
  JOIN rp_b2_official_delegation_backfill b ON b.stable_name = a.stable_name
 WHERE v.agent_id = a.id AND v.org_id = a.org_id
   AND a.catalog_source = 'official' AND v.catalog_source = 'official'
   AND v.delegation_policy = b.old_policy;
ALTER TABLE agent_versions ENABLE TRIGGER agent_versions_immutable_trg;

UPDATE agents a
   SET delegation_policy = b.new_policy
  FROM rp_b2_official_delegation_backfill b
 WHERE a.stable_name = b.stable_name AND a.catalog_source = 'official'
   AND a.delegation_policy = b.old_policy;

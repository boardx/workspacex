/*
 * AG06 × 官方角色包 1.3.0：四个官方角色带上真实升级规则（`escalation_policy`）——此前恒为 `{"rules":[]}`，
 * `escalate_matter` 永远不命中，升级卡片在产品里不可达。
 *
 * 规则的唯一声明处 = apps/api/src/domain/agent/official-role-packs.ts `officialRoleEscalationPolicies()`；
 * 本文件的字面量是被 tests/agent/official-role-pack-import.test.ts 机械核对的副本。
 *
 * 回填：只动 `catalog_source='official'` 且 escalation_policy **仍是包默认值**（空规则）的行——管理员改过的
 * 不碰；只动这一列。草稿行与已发布版本同改（运行时读 run 钉住的发布快照）；发布快照有不可变触发器，
 * 只对这一条 UPDATE 临时关掉（同 20260930121000 / 20260929160000）。重复执行无副作用。
 */
CREATE TEMP TABLE ag06_official_escalation_backfill (stable_name text PRIMARY KEY, policy jsonb NOT NULL) ON COMMIT DROP;
INSERT INTO ag06_official_escalation_backfill (stable_name, policy) VALUES
  ('d002-research-knowledge-analyst', '{"rules":[{"matter":"超出职责范围的事项","target":"requester"},{"matter":"删除或覆盖组织数据","target":"org_admin"},{"matter":"代表组织对客户或外部作出承诺","target":"org_admin"},{"matter":"使用含个人信息或来源未授权的数据","target":"org_admin"}]}'),
  ('d003-product-manager', '{"rules":[{"matter":"超出职责范围的事项","target":"requester"},{"matter":"删除或覆盖组织数据","target":"org_admin"},{"matter":"代表组织对客户或外部作出承诺","target":"org_admin"},{"matter":"预算或资源投入承诺","target":"org_admin"}]}'),
  ('d005-sales-representative', '{"rules":[{"matter":"超出职责范围的事项","target":"requester"},{"matter":"删除或覆盖组织数据","target":"org_admin"},{"matter":"代表组织对客户或外部作出承诺","target":"org_admin"},{"matter":"报价、折扣或价格承诺","target":"org_admin"},{"matter":"合同或交付条款承诺","target":"org_admin"}]}'),
  ('d011-design-thinking-expert', '{"rules":[{"matter":"超出职责范围的事项","target":"requester"},{"matter":"删除或覆盖组织数据","target":"org_admin"},{"matter":"代表组织对客户或外部作出承诺","target":"org_admin"},{"matter":"预算或资源投入承诺","target":"org_admin"},{"matter":"使用含个人信息或来源未授权的数据","target":"org_admin"}]}');

ALTER TABLE agent_versions DISABLE TRIGGER agent_versions_immutable_trg;
UPDATE agent_versions v
   SET escalation_policy = b.policy
  FROM agents a
  JOIN ag06_official_escalation_backfill b ON b.stable_name = a.stable_name
 WHERE v.agent_id = a.id AND v.org_id = a.org_id
   AND a.catalog_source = 'official' AND v.catalog_source = 'official'
   AND v.escalation_policy = '{"rules":[]}'::jsonb;
ALTER TABLE agent_versions ENABLE TRIGGER agent_versions_immutable_trg;

UPDATE agents a
   SET escalation_policy = b.policy
  FROM ag06_official_escalation_backfill b
 WHERE a.stable_name = b.stable_name AND a.catalog_source = 'official'
   AND a.escalation_policy = '{"rules":[]}'::jsonb;

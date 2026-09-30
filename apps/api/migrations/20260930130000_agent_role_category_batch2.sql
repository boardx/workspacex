/*
 * 批次 2 数字人（D001 高管战略 / D006 客户成功 / D007 项目运营）的角色类别：`agents.role_category` 与
 * `agent_versions.role_category` 的 CHECK 增加 executive / customer_success / operations。
 *
 * 唯一声明处 = packages/contracts/src/agent-role.ts `AgentRoleCategory`；本文件的字面量由
 * apps/api/tests/agent/role-category-migration-parity.test.ts 与之机械核对。
 * 只放宽取值集合（旧值全部保留），不建表、不动数据；重复执行无副作用（DROP IF EXISTS 再 ADD）。
 * 约束名 = PostgreSQL 对 ag01 行内 CHECK 的默认命名。
 */
ALTER TABLE agents DROP CONSTRAINT IF EXISTS agents_role_category_check;
ALTER TABLE agents ADD CONSTRAINT agents_role_category_check
  CHECK (role_category IS NULL OR role_category IN ('research','product','sales','design','general','executive','customer_success','operations'));

ALTER TABLE agent_versions DROP CONSTRAINT IF EXISTS agent_versions_role_category_check;
ALTER TABLE agent_versions ADD CONSTRAINT agent_versions_role_category_check
  CHECK (role_category IS NULL OR role_category IN ('research','product','sales','design','general','executive','customer_success','operations'));

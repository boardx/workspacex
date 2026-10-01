/*
 * Workflow 能力授权管理面（组织管理员授予 / 撤销 workflow_capability_grants）。
 *
 * WF04 建表时只给了 app_rw SELECT（「谁能配置授权是另一块还没建的管理面」）。本迁移补上那块：
 *  - app_rw 获得 INSERT / UPDATE / DELETE —— 写入口只有 WorkflowCapabilityGrantController，
 *    它先判组织 admin，再在同一事务里写 provenance_events（审计）；RLS 双闸不变，只能写本组织。
 *  - updated_by 记录最后一次授予的管理员（界面展示用；完整历史在 provenance_events）。
 * 默认只读不变：没有配置行仍按 `read` 封顶（ADR-120 决策 #2），撤销 = 删除配置行。
 */
ALTER TABLE workflow_capability_grants ADD COLUMN IF NOT EXISTS updated_by text;

GRANT INSERT, UPDATE, DELETE ON workflow_capability_grants TO app_rw;

SELECT kernel_apply_org_freeze_policies();

-- 20260806100000 #594: chat_threads.project_id 放宽为可空 —— 个人线程（不挂靠任何项目）
--
-- ## 权威依据
--
-- 人类本人 2026-08-06 直接推翻此前裁决："不需要新建项目也应该新建一个 chat，
-- 开始使用 skills 和 agent"，二选一确认方案 A（projectId 全链路可空）。
-- coord-main 视为签核已完成，登记于 phases/phase-01-run-a-project/contracts/chat/
-- MIGRATION-IMPACT.md。
--
-- ## 这条迁移只做一件事
--
-- DROP NOT NULL。FK（REFERENCES projects (id) ON DELETE CASCADE）本身对 NULL 值
-- 天然放行——Postgres 的外键约束从不检查 NULL，不需要改 FK 定义本身。
-- 可重放：DROP NOT NULL 在已经可空的列上重跑是空操作，不报错。
--
-- ⚠ 不动的东西，逐条列出以防被下一个人误读成遗漏：
--   · `chat_threads_visibility_scope` CHECK 的五值枚举 —— 个人线程复用既有的
--     'private'，契约层同一决定见 packages/contracts/src/chat.ts 头注。
--   · `chat_threads_member_private_needs_group` CHECK —— 与个人线程无关
--     （个人线程恒 `visibility_scope='private'`，不是 `'member-private'`，
--     且 `group_id` 恒 NULL，这条 CHECK 本来就只管 member-private 那一档）。
--   · `ownership_layer` 列与其 CHECK（恒 'project'）—— 这是 I-9「agent 私聊恒属项目层」
--     的落点，与本次的「线程本身能不能不属于项目」是两件事。个人线程今天也会带着
--     `ownership_layer='project'` 这个列默认值，语义上有点怪（这一列的唯一声明用途
--     就是 I-9，而 I-9 讲的是 agent_private=true 的那一类线程，不是所有线程）——
--     但这一列在应用层代码里从未被读取（`grep -rn ownership_layer apps/api/src`
--     零命中，只在这份迁移文件与 domain.md 里出现），动它是在修一个没有任何消费者
--     会感知到的列，风险与收益不成比例，本次不碰，如实记在这里等后人评估。
--   · `agent_private` 列 —— agent 私聊是项目内的另一个概念，个人线程恒
--     `agent_private=false`（应用层 `createPersonalThread` 从不设置它，列默认值
--     即为 false），两个概念不相交，不需要联动。
ALTER TABLE chat_threads ALTER COLUMN project_id DROP NOT NULL;

-- 个人线程列表（`ChatRepository.listPersonalThreads`）按 `(org_id, created_by)`
-- 过滤 `project_id IS NULL` 的行。局部索引只覆盖这一类行，不与既有
-- `chat_threads_project_idx`（覆盖 project_id 非空的一侧）重叠或竞争。
CREATE INDEX IF NOT EXISTS chat_threads_personal_idx
  ON chat_threads (org_id, created_by, last_activity_at DESC)
  WHERE project_id IS NULL;

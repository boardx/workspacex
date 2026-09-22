-- Team3 研判工作流下线（2026-09-22 人类指令）：删除该 feature 独占的四张表。
--
-- 原建表迁移 `20260916010000_research_workflow_sessions.sql` 已随实现一并删除，因此
-- 全新库上这四张表从不存在；本文件只负责把**已经跑过那条迁移**的库收回到同一状态。
-- 每条都是 IF EXISTS，可反复重放（`pnpm --filter api migrate:check` 要求逐文件幂等）。
-- 索引、RLS 策略、表上的 GRANT 随表一起消失；`research_gate_audit_id_seq` 是该表
-- 自己的 identity 序列，也随表删除，无需单独 DROP。
--
-- ⚠ 只动 `research_*`，不碰 `guided_research_*` —— 后者是仍在使用的 guided research
--   栈（F168 起），名字像但不是同一个对象空间。
DROP TABLE IF EXISTS research_predictions;
DROP TABLE IF EXISTS research_gate_audit;
DROP TABLE IF EXISTS research_materials;
DROP TABLE IF EXISTS research_sessions;

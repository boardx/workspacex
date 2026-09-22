-- Team3「前沿赛道技术路线研判」于 2026-09-22 按人类指令下线，这条迁移把
-- 20260916010000_research_workflow_sessions.sql 建的四张表删掉。
--
-- ⚠ 为什么需要这条迁移：删掉那个 .sql 文件**不会**让已部署库里的表消失——
--   迁移是只进不退的流水，删文件只是让新环境不再建它，老环境原样留着四张表、
--   四套 RLS 策略和两条外键。那就是典型的「代码里没有、库里还在」的残骸：
--   下一个人读 schema 会看到四张无人认领的表，查不到任何使用者。
--
-- 删除顺序：research_sessions 被其余三张表以 ON DELETE CASCADE 引用，
-- 但这里用 CASCADE 一次性放倒依赖对象（索引、策略、外键），不依赖顺序。
-- 数据本身是 team3 试运行期间的研判会话，随功能一并作废。

DROP TABLE IF EXISTS research_predictions CASCADE;
DROP TABLE IF EXISTS research_gate_audit CASCADE;
DROP TABLE IF EXISTS research_materials CASCADE;
DROP TABLE IF EXISTS research_sessions CASCADE;

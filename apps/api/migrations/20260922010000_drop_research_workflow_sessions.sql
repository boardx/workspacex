-- 一个已下线的 ad-hoc 功能曾在这里建过四张 `research_*` 表；功能连同它的建表迁移
-- 一并删除（2026-09-24 人类指令：开源仓库里不留这套私有 agent 技术的任何内容）。
--
-- ⚠ 为什么删了建表迁移还需要这条：迁移是只进不退的流水。删掉那个 .sql 只是让**新**
--   环境不再建这些表；**已经跑过它的**环境原样留着表、RLS 策略与外键，成为典型的
--   「代码里没有、库里还在」的残骸——下一个人读 schema 会看到几张无人认领的表，
--   查不到任何使用者，也查不到它们当初是干什么的。
--
-- 用 CASCADE 一次性放倒依赖对象（索引、策略、外键），不依赖删除顺序。
-- 表里的数据是该功能试运行期间产生的，随功能一并作废。
--
-- ⚠ 不要碰 `guided_research_*`：那是仍在使用的 guided research 栈，名字像，
--   但不是同一个对象空间。
DROP TABLE IF EXISTS research_predictions CASCADE;
DROP TABLE IF EXISTS research_gate_audit CASCADE;
DROP TABLE IF EXISTS research_materials CASCADE;
DROP TABLE IF EXISTS research_sessions CASCADE;

-- Phase 14 F15 -- 完整可审计 transcript 存储改造（R3'/R6，`error-observability` 契约束）。
--
-- 新增两列存放"完整（非摘要）"内容的字段级加密密文：`input_full_content_enc`/
-- `output_full_content_enc`。与既有 `input_digest`/`output_digest`（SHA-256 摘要）、
-- `tool_args_summary`/`tool_result_summary`（截断摘要）并存，互不替代——
-- `agent_run_steps` 是 append-only 账本（见建表迁移的触发器），本迁移只 ADD COLUMN，
-- 不改写、不回填既有行：历史行两列天然为 NULL，审计读诚实报告为"内容不可读"
-- （I-4），不伪造。
--
-- 密文格式与加解密逻辑不在数据库层：见
-- `apps/api/src/infrastructure/agent-run/transcript-content-cipher.ts`。
--
-- 幂等：`IF NOT EXISTS`，重复执行安全。
ALTER TABLE agent_run_steps
  ADD COLUMN IF NOT EXISTS input_full_content_enc text NULL,
  ADD COLUMN IF NOT EXISTS output_full_content_enc text NULL;

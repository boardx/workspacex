-- #4227 —— `wx_cite` 工具的 run 引用账本。
--
-- 助手消息在 `commitWriteback` 那一刻才存在，执行期间模型调用 `wx_cite` 时还没有
-- `message_id` 可挂（与 #1624 `model_output_files` 同一个理由）。这一列只存**服务端已校验**
-- 的引用条目（来源经与 `wx_knowledge_read` 同一条授权 + 版本校验重读过），写回时由
-- `numberRunCitations` 折叠重复、编号 1..n，再经 `persistAssistantCitations` 落进 `chat_citations`。
--
-- DEFAULT '[]' 是不回归的保证：没调过 `wx_cite` 的 run 写回逐字节同前（不写任何引用行）。
ALTER TABLE agent_runs
  ADD COLUMN IF NOT EXISTS cited_sources jsonb NOT NULL DEFAULT '[]'::jsonb;

SELECT kernel_apply_org_freeze_policies();

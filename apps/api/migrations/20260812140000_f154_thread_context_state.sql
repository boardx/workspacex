-- F154 (Context Engine L2): 每线程一份的持久滚动摘要。
--
-- ## 这张表补的是什么
--
-- V8（execute-run 的 assembleHistory）已有「把被预算丢弃的旧轮压成一条摘要伪消息」的雏形，但它
-- **每 run 现算、无持久化**：每次都从头压，对话越长越贵，且「不重读全史」这条不变量做不到。
-- F154 把 L2 落成持久状态：一条对话一行，随对话**增量**更新——只把「这轮新掉出 L1 近端窗口的旧轮」
-- 折进已有摘要，不重压全史。run 时直读本行拿到 L2，无需回扫历史。
--
--   summary                  —— 当前 L2 滚动摘要正文（role 中性文本；组装时前置成一条 assistant 伪消息）。
--   summarized_through_id     —— 已折进摘要的**最后一条**消息 id（含）；NULL = 还没摘要过。
--   summarized_through_at     —— 该消息的 created_at，与 id 一起构成 (created_at,id) 边界游标，
--                                供组装判断「哪些旧轮已进摘要、哪些还在 L1 原文窗口」。
--   version                   —— 乐观并发：增量更新以「读到的 version」为条件写回，撞并发不静默覆盖。
--
-- 一条对话一行：PK 就是 thread_id（chat_threads.id 全局唯一）。org_id 供 RLS。
--
-- 可重放：IF NOT EXISTS / OR REPLACE 全程（migrate:check 忽略版本表强制重放每个文件）。

CREATE TABLE IF NOT EXISTS thread_context_state (
  thread_id             text PRIMARY KEY REFERENCES chat_threads (id) ON DELETE CASCADE,
  org_id                text NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  summary               text NOT NULL DEFAULT '',
  summarized_through_id text,
  summarized_through_at timestamptz,
  version               integer NOT NULL DEFAULT 0,
  updated_at            timestamptz NOT NULL DEFAULT now()
);

-- 按 org 读写（RLS 已按 org 收口，此索引服务「一个 org 的所有线程状态」批量场景）。
CREATE INDEX IF NOT EXISTS thread_context_state_org_idx ON thread_context_state (org_id);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'thread_context_state') THEN
    RAISE EXCEPTION 'thread_context_state did not get created';
  END IF;
END
$$;

/* ─────────────────────────── RLS ─────────────────────────── */

ALTER TABLE thread_context_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE thread_context_state FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS thread_context_state_tenant ON thread_context_state;
CREATE POLICY thread_context_state_tenant ON thread_context_state
  USING (org_id = current_setting('app.current_org', true))
  WITH CHECK (org_id = current_setting('app.current_org', true));

-- 摘要随对话增量 upsert（读-改-写），故 SELECT/INSERT/UPDATE 都要；不删（线程删除靠 FK 级联）。
REVOKE ALL ON thread_context_state FROM app_rw;
GRANT SELECT, INSERT, UPDATE ON thread_context_state TO app_rw;

-- 新增租户表之后必须重新调用一次组织冻结策略，否则组织冻结对这张新表不生效（同 F34/F35/F36/F153 成例）。
SELECT kernel_apply_org_freeze_policies();

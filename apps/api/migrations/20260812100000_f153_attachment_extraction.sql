-- F153/W1 (V9-b): 附件内容抽取（anydoc）的事务性 outbox + 附件抽取状态列。
--
-- ## 这张表补的是什么
--
-- V9-a（i946）只把附件字节存进对象存储（`chat_message_attachments.storage_ref`），
-- `extracted_ref` 恒 NULL。V9-b 要把内容抽成 markdown 进上下文——大文件抽取慢、吃内存
-- （anydoc 峰值 ~28×输入），必须异步、可重放、进程中途死掉也不丢活。
--
-- `chat_attachment_extraction_outbox`：一行 = 一个「把这个附件抽成 markdown」的待办。行与
-- 「使它为真的写」（附件挂消息 / 上传落库）可在同一 COMMIT 入队——事务性 outbox：worker 绝不会
-- 看到一个该抽却没有 job 行的附件。抽取是**单步**（不像 ingestion 的九态流水线），所以没有
-- `step` 列；幂等靠 `UNIQUE (attachment_id)`：重复入队是 `ON CONFLICT DO NOTHING`，不是第二个
-- job 抢同一份活。worker 完成即 DELETE 该 job 行（队列排空，不留每附件一行 done 记录）。
--
-- 抽取**结果状态**记在 `chat_message_attachments` 上（下方 ALTER），供上下文组装与 UI 读：
-- outbox 排空后，附件的 `extraction_status` 仍如实记着 extracted/unsupported/failed。
--
-- 可重放：全程 IF NOT EXISTS / OR REPLACE（migrate:check 会忽略版本表强制重放每个文件）。

CREATE TABLE IF NOT EXISTS chat_attachment_extraction_outbox (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        text NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  -- 附件删除（含 thread/message 级联删除穿透到附件）时，这条待办一并消失。
  attachment_id text NOT NULL REFERENCES chat_message_attachments (id) ON DELETE CASCADE,
  status        text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'failed')),
  attempts      integer NOT NULL DEFAULT 0,
  last_error    text,
  -- claim marker；worker 认为超过其 staleness 窗口的 processing 行是死 claim、可重放。
  -- 那个窗口数值留在 worker 里（`STALE_CLAIM_MS`），不在这里存第二份。
  locked_by     text,
  locked_at     timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  -- 重复入队同一附件 = no-op（`ON CONFLICT (attachment_id) DO NOTHING`），不是第二个 job。
  CONSTRAINT chat_attachment_extraction_outbox_uniq UNIQUE (attachment_id)
);

CREATE INDEX IF NOT EXISTS chat_attachment_extraction_outbox_claim_idx
  ON chat_attachment_extraction_outbox (status, created_at) WHERE status = 'pending';

-- 附件抽取的结果状态（结果面，长期保留；outbox 是过程面，排空即删）。
--   pending     还没抽（入队待处理，或将要内联抽）。
--   extracted   已抽出内容（convert 成功或 passthrough 文本）——`extracted_ref` 指向 markdown 对象。
--   unsupported 抽不出文本（图片无文字层等）——不是错误，附件仍在，只是内容进不了上下文。
--   failed      抽取失败——`extraction_error` 记 anydoc 的 ConvertErrorCode。
-- `extracted_ref`（i946 已建，恒 NULL）从这里起被 worker/内联路径写成 markdown 对象的 key。
ALTER TABLE chat_message_attachments
  ADD COLUMN IF NOT EXISTS extraction_status text NOT NULL DEFAULT 'pending'
    CHECK (extraction_status IN ('pending', 'extracted', 'unsupported', 'failed'));
ALTER TABLE chat_message_attachments
  ADD COLUMN IF NOT EXISTS extraction_error text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'chat_attachment_extraction_outbox') THEN
    RAISE EXCEPTION 'chat_attachment_extraction_outbox did not get created';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_name = 'chat_message_attachments' AND column_name = 'extraction_status'
  ) THEN
    RAISE EXCEPTION 'chat_message_attachments.extraction_status did not get added';
  END IF;
END
$$;

/* ─────────────────────────── RLS ─────────────────────────── */

ALTER TABLE chat_attachment_extraction_outbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_attachment_extraction_outbox FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS chat_attachment_extraction_outbox_tenant ON chat_attachment_extraction_outbox;
CREATE POLICY chat_attachment_extraction_outbox_tenant ON chat_attachment_extraction_outbox
  USING (org_id = current_setting('app.current_org', true))
  WITH CHECK (org_id = current_setting('app.current_org', true));

-- worker 完成即删 job 行，故授予 DELETE（同 ingestion_outbox 的理由）。
REVOKE ALL ON chat_attachment_extraction_outbox FROM app_rw;
GRANT SELECT, INSERT, UPDATE, DELETE ON chat_attachment_extraction_outbox TO app_rw;

-- 新增租户表之后必须重新调用一次组织冻结策略，否则组织冻结对这张新表不生效（同 F34/F35/F36 成例）。
SELECT kernel_apply_org_freeze_policies();

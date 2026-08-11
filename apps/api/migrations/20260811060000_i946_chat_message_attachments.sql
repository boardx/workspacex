-- #946 · V9-a F150 —— 对话附件数据模型。
--
-- 上传流程决定了 message_id **可空**：`uploadAttachment`（契约
-- packages/contracts/src/chat-file-upload.ts）在**消息还不存在时**就落一行拿到 id，
-- 随后 `createMessage` 带 `attachmentIds` 把它挂到消息上（set message_id）。
-- 因此：
--   · message_id NULL = 「已上传、尚未挂到任何消息」的 pending 态；
--   · 「每消息 ≤10」的容量校验在**上传时**按该线程的 pending 行数算（UC uc-8-6 V2：
--     该线程第 11 个附件被拒）；挂到消息时校验 attachmentIds 属该线程且未挂过别的消息（V5）。
--   · 数值上限（25MB / 白名单 / 10）的唯一事实源是契约 `ATTACHMENT_LIMITS`/
--     `ATTACHMENT_MIME_ALLOWLIST`，**不在这里也不在应用层复述**（服务端从契约读）。
--   · extracted_ref 是 V9-b（F153，附件抽取进 L3 检索）的字段，V9-a 恒 NULL。
--
-- 级联：thread 删 ⇒ 附件删（含 pending）；message 删 ⇒ 挂在其上的附件删。两条 FK 都 CASCADE。
CREATE TABLE IF NOT EXISTS chat_message_attachments (
  id            text PRIMARY KEY,
  org_id        text NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  thread_id     text NOT NULL REFERENCES chat_threads (id) ON DELETE CASCADE,
  -- NULL = pending（已上传未挂消息）。挂上后 = 该消息 id。message 删则附件随之删。
  message_id    text REFERENCES chat_messages (id) ON DELETE CASCADE,
  -- 对象存储引用（复用 files 域的存储；本表不存字节本体）。
  storage_ref   text NOT NULL,
  filename      text NOT NULL,
  -- 服务端核验字节后的权威 mime（不是客户端声明值）。
  mime          text NOT NULL,
  -- 服务端接收到的权威字节数。
  bytes         bigint NOT NULL CHECK (bytes >= 0),
  -- V9-b：抽取文本引用。V9-a 恒 NULL。
  extracted_ref text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- pending 计数（每线程 ≤10 的校验）：只索引未挂消息的行。
CREATE INDEX IF NOT EXISTS chat_message_attachments_thread_pending_idx
  ON chat_message_attachments (thread_id)
  WHERE message_id IS NULL;

-- 按消息回读附件（listMessages 的 attachments 投影）。
CREATE INDEX IF NOT EXISTS chat_message_attachments_message_idx
  ON chat_message_attachments (message_id);

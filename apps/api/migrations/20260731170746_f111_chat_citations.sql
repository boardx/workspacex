-- F111：工具调用链展开 + 引用角标可定位（chat 束 domain.md D 组 · uc-8-2 UC-14/UC-15）
--
-- ## 这个文件只建一张表，理由是 I-22 明确禁止的那件事没有落到这张表头上
--
-- 「展开工具调用链」是 `provenance_events` 的投影（I-22 逐字：**不另建调用日志表**），
-- 所以工具调用本身**没有**新表——它写进已有的 `provenance_events`，见
-- `apps/api/src/domain/chat/tool-call-projection.ts` 文件头（借用 `generated` 类型、
-- `thread` target，两处都是 ADR-101 已补但不精确匹配的借用，报告为已知缺口）。
--
-- `chat_citations` 是另一件事：`chat.Message.citations` 是消息内容的一部分（契约
-- `Message.citations: Citation[]`），不是审计投影。它现在**没有任何持久化落点**——
-- `get-thread.ts` 的 `toMessage()` 把它写死成 `[]`（该文件头部登记为契约缺口：
-- 消息创建端口本身还不存在，写入侧无处可去）。`locateCitation`（UC-15）要回答
-- 「这条引用点开能不能定位到原件」，若引用本身无处存放，这个问题无从回答——
-- 于是这张表存在的意义只是给 UC-15 一个真实的持久层，不是给 UC-14 开第二个日志表。
--
-- 可重放：IF NOT EXISTS / DROP-then-ADD，`migrate:check` 强制重放每个文件。

CREATE TABLE IF NOT EXISTS chat_citations (
  citation_id       text PRIMARY KEY,
  org_id            text NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  -- 引用出现在哪条消息里。级联删除：消息没了，挂在它身上的引用角标也没有意义。
  message_id        text NOT NULL REFERENCES chat_messages (id) ON DELETE CASCADE,
  idx               integer NOT NULL CHECK (idx > 0),
  source_full_name  text NOT NULL CHECK (length(source_full_name) > 0),
  anchor_kind       text NOT NULL,
  -- 三种锚点各自的定位字段。**不是全部可空**——CHECK 强制「kind 对应的那一个字段非空」，
  -- 否则一条 kind='page' 却 anchor_page 为 NULL 的行会通过写入，
  -- 而 UC-15 的 I-24（100% 可定位）在读它的那一刻才发现定位不了。
  anchor_page       integer CHECK (anchor_page IS NULL OR anchor_page > 0),
  anchor_range      text,
  anchor_message_id text,
  -- 引用来源的 artifact，可空——不是所有引用都回指一份可下架的材料
  -- （例如锚点本身就是另一条消息，kind='message' 时来源就是那条消息，不需要 artifact）。
  -- 没有外键：来源材料被删除是 `SOURCE_ARTIFACT_DELETED` 的正常路径，不是数据损坏，
  -- 加外键会让删除动作在这里连带失败或级联，而删除 artifact 与删除一条引用记录是两件事。
  source_artifact_id text,
  created_at        timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE chat_citations DROP CONSTRAINT IF EXISTS chat_citations_anchor_kind_check;
ALTER TABLE chat_citations ADD CONSTRAINT chat_citations_anchor_kind_check CHECK (
  -- 三值封闭，与契约 `CitationAnchorKind` 同值——由
  -- `tests/chat/citation-anchor-100pct-locatable.test.ts` 双向比对，不留第二份声明。
  anchor_kind IN ('page', 'transcript', 'message')
);

ALTER TABLE chat_citations DROP CONSTRAINT IF EXISTS chat_citations_anchor_field_matches_kind;
ALTER TABLE chat_citations ADD CONSTRAINT chat_citations_anchor_field_matches_kind CHECK (
  (anchor_kind = 'page' AND anchor_page IS NOT NULL)
  OR (anchor_kind = 'transcript' AND anchor_range IS NOT NULL)
  OR (anchor_kind = 'message' AND anchor_message_id IS NOT NULL)
);

-- 同一条消息内引用编号不得重复：`index` 是界面上的角标数字，两条引用共用一个编号，
-- 点开哪一条会全靠代码里谁先塞进数组，这正是"角标可定位"要防的歧义。
CREATE UNIQUE INDEX IF NOT EXISTS chat_citations_message_idx_uniq
  ON chat_citations (org_id, message_id, idx);

CREATE INDEX IF NOT EXISTS chat_citations_message_lookup_idx
  ON chat_citations (org_id, message_id);

ALTER TABLE chat_citations ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_citations FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS chat_citations_tenant ON chat_citations;
CREATE POLICY chat_citations_tenant ON chat_citations
  USING (org_id = current_setting('app.current_org', true))
  WITH CHECK (org_id = current_setting('app.current_org', true));

GRANT SELECT, INSERT ON chat_citations TO app_rw;

-- F22 的停用冻结：新建租户表必须自己补这一次调用（0014 见不到本文件之后才建的表）。
SELECT kernel_apply_org_freeze_policies();

COMMENT ON TABLE chat_citations IS
  'F111 UC-15 locateCitation 的持久层。不是 provenance 投影——引用是消息内容的一部分'
  '（chat.Message.citations），provenance_events 只投影工具调用链（I-22）。';

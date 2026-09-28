-- 项目中枢 B3-T1（#4495）：证据归一化。
--
-- 六类来源（chat 消息 / 附件 / 问卷答卷 / 访谈片段 / 转写片段 / 深研来源）统一成一种可追溯的证据单元
-- `project_evidence`：谁说的、在哪份材料的哪个位置、摘录多长、现在还在不在。项目大脑（B3-T2 起）的
-- 结论只引用这种单元，不再直接引用「某条 chat 消息」。
--
-- 幂等键 `(org_id, source_kind, source_ref)`：同一来源内的同一引用只有一行——采集器可以反复跑
-- （挂载时、入图前、重试），重复只刷新摘录 / 定位，不长第二行。
-- `revoked`：源被删 / 撤回时**不删行**而是标记——结论的锚点还指着它，删了锚点就悬空；列表默认不含。
-- `app_rw` 只 SELECT / INSERT / UPDATE：没有 DELETE 路径，「撤回」是 UPDATE。
--
-- 结论证据锚点的回链：`claim_message_evidence`（chat 消息证据）与 `claim_segments`（附件证据）各加一列
-- 可空 `evidence_id` 指向 `project_evidence.id`。⚠ 这两张表**没有** `source_kind` 列——来源类别由
-- 表本身表达（消息表 / 片段表），所以「把 CHECK 扩到六类」在这里没有对象；另外四类的锚点由 B3-T2 的
-- 入图管线经 `evidence_id` 直接指向证据单元（单元自带 `source_kind`），不再需要每类一张锚点表。
-- 只对新入图数据写回链，不迁移旧数据（旧行 `evidence_id` 为 NULL）。
--
-- 可重放：IF NOT EXISTS / DROP-then-CREATE / CREATE OR REPLACE。

CREATE TABLE IF NOT EXISTS project_evidence (
  id             text PRIMARY KEY,
  org_id         text NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  project_id     text NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  source_kind    text NOT NULL CHECK (source_kind IN (
                   'chat_message', 'attachment', 'survey_response', 'interview_segment', 'transcript_segment', 'research_source')),
  -- 所属资源：chat_message → threadId；survey_response → surveyId；interview_segment → interviewSessionId；
  -- transcript_segment → transcriptionId；research_source → guidedResearchSessionId；attachment → artifactId
  resource_id    text NOT NULL,
  -- 来源内的具体引用：messageId / responseId:questionId / segmentId / sourceId / artifactVersionId
  source_ref     text NOT NULL,
  -- 可读摘录（契约 `ProjectEvidenceItem.excerpt` ≤ 280），不是全文
  excerpt        text NOT NULL CHECK (length(excerpt) <= 280),
  locator        jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(locator) = 'object'),
  -- 说这句话的人；匿名答卷为 NULL
  speaker_label  text NULL,
  resource_title text NOT NULL,
  revoked        boolean NOT NULL DEFAULT false,
  created_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT project_evidence_source_uniq UNIQUE (org_id, source_kind, source_ref)
);

-- 列表：某项目按建立时间倒序（复合游标 created_at, id）；按来源过滤走同一索引的前缀。
CREATE INDEX IF NOT EXISTS project_evidence_project_idx
  ON project_evidence (org_id, project_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS project_evidence_project_source_idx
  ON project_evidence (org_id, project_id, source_kind, created_at DESC, id DESC);
-- 撤回：按所属资源整批标记。
CREATE INDEX IF NOT EXISTS project_evidence_resource_idx
  ON project_evidence (org_id, source_kind, resource_id);

ALTER TABLE project_evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_evidence FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS project_evidence_tenant ON project_evidence;
CREATE POLICY project_evidence_tenant ON project_evidence
  USING (org_id = current_setting('app.current_org', true))
  WITH CHECK (org_id = current_setting('app.current_org', true));

REVOKE ALL ON project_evidence FROM app_rw;
GRANT SELECT, INSERT, UPDATE ON project_evidence TO app_rw;

-- ─────────────────────────────── 结论锚点回链 ───────────────────────────────
-- 可空、无外键：证据单元与锚点分属两个写路径（采集器 / 执行器），外键会让「先入图后采集」的顺序
-- 变成硬约束；回链的一致性由 `kg_insert_claim_evidence` 在写入时核对（单元必须存在于本 org）。
ALTER TABLE claim_message_evidence ADD COLUMN IF NOT EXISTS evidence_id text NULL;
ALTER TABLE claim_segments ADD COLUMN IF NOT EXISTS evidence_id text NULL;
CREATE INDEX IF NOT EXISTS claim_message_evidence_evidence_idx
  ON claim_message_evidence (org_id, evidence_id) WHERE evidence_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS claim_segments_evidence_idx
  ON claim_segments (org_id, evidence_id) WHERE evidence_id IS NOT NULL;

-- 执行器的证据写入：与 F06（20260924210000）同一函数体，只多接一个可选的 `evidence_id`。
-- 证据项：`{segment_id, stance[, evidence_id]}` 或 `{message_id, stance, excerpt[, evidence_id]}`。
-- 给了 `evidence_id` 却指不到本 org 的证据单元 ⇒ 当作没给（写 NULL），不拒批：回链是附加信息，
-- 不是 I-5「至少一条 supporting 证据」的一部分。
CREATE OR REPLACE FUNCTION kg_insert_claim_evidence(p_org text, p_scope_kind text, p_scope_id text, p_claim_id text, ev jsonb)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_body     text;
  v_excerpt  text;
  v_evidence text := ev->>'evidence_id';
BEGIN
  IF v_evidence IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM project_evidence pe WHERE pe.id = v_evidence AND pe.org_id = p_org
  ) THEN
    v_evidence := NULL;
  END IF;
  IF ev ? 'message_id' THEN
    -- 会话作用域：消息必须来自这个会话。个人空间：消息必须来自**本人创建**的会话——否则可以把别人
    -- 私聊里的消息挂成自己的证据，还能借接受 / 拒绝探测别人会话里的消息 id（I-14）。
    SELECT m.body INTO v_body FROM chat_messages m JOIN chat_threads t ON t.id = m.thread_id AND t.org_id = m.org_id
     WHERE m.id = ev->>'message_id' AND m.org_id = p_org AND m.visibility_scope IS NULL
       AND ((p_scope_kind = 'chat_session' AND m.thread_id = p_scope_id)
         OR (p_scope_kind = 'personal' AND t.created_by = p_scope_id));
    IF NOT FOUND THEN
      RAISE EXCEPTION 'KG_EVIDENCE_NOT_FOUND: message %', ev->>'message_id' USING ERRCODE = '23503';
    END IF;
    -- 摘录由服务端核对：必须是原话的一段；不是就用消息开头。面板上标着「原话」的，一定是原话。
    v_excerpt := coalesce(ev->>'excerpt', '');
    IF v_excerpt = '' OR strpos(v_body, v_excerpt) = 0 THEN v_excerpt := left(v_body, 280); END IF;
    INSERT INTO claim_message_evidence (claim_id, org_id, message_id, stance, excerpt, evidence_id)
    VALUES (p_claim_id, p_org, ev->>'message_id', ev->>'stance', left(v_excerpt, 280), v_evidence)
    ON CONFLICT (claim_id, message_id, stance) DO UPDATE
      SET evidence_id = coalesce(claim_message_evidence.evidence_id, EXCLUDED.evidence_id);
    RETURN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM segments s WHERE s.id = ev->>'segment_id' AND s.org_id = p_org) THEN
    RAISE EXCEPTION 'KG_EVIDENCE_NOT_FOUND: segment %', ev->>'segment_id' USING ERRCODE = '23503';
  END IF;
  INSERT INTO claim_segments (claim_id, org_id, segment_id, stance, evidence_id)
  VALUES (p_claim_id, p_org, ev->>'segment_id', ev->>'stance', v_evidence)
  ON CONFLICT DO NOTHING;
END
$$;
REVOKE ALL ON FUNCTION kg_insert_claim_evidence(text, text, text, text, jsonb) FROM PUBLIC;

-- 组织冻结的写限制在首次 apply 时也装上（同 `project_resource_links` 迁移）。
SELECT kernel_apply_org_freeze_policies();

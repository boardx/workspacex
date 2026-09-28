-- 项目中枢 B3-T2（issue #4496）—— 项目证据单元作为结论锚点。
--
-- 项目大脑按「AI 权限」吃六类证据（问卷答卷 / 访谈片段 / 转写片段 / 深研来源 / 对话 / 附件）之后，
-- 结论的证据不再只是「某条消息」或「某个附件片段」：它指向 T1 归一出来的**证据单元**（`ev_…`）。
-- 既有的 `kg_insert_claim_evidence` 只认 `{segment_id}` / `{message_id}`，而且消息证据只允许挂在
-- chat_session / personal 作用域——project 作用域的入图批次在这里会被拒。本迁移：
--   1. 新表 `claim_project_evidence`：一条结论 ↔ 一个证据单元（含冗余的 source_kind / source_ref / excerpt，
--      锚点渲染不必回表）；
--   2. `kg_insert_claim_evidence` 加第三种证据项 `{evidence_id, source_kind, source_ref, stance, excerpt}`，
--      只接受 **project 作用域**（证据单元是项目的东西，挂到会话 / 个人空间没有意义，也会绕开项目成员这道门）。
--
-- ⚠ 不对 T1 的 `project_evidence` 表加外键：两个切片并行落地，本迁移不能假设那张表已经存在。等 T1 合入后
--   由后续迁移补 `REFERENCES project_evidence (id) ON DELETE CASCADE` 与存在性校验（见 #4496 回报）。
-- 来源枚举与契约 `ProjectEvidenceSourceKind` 同一份（CHECK 只是数据库那一层的兜底）。

CREATE TABLE IF NOT EXISTS claim_project_evidence (
  claim_id    text NOT NULL REFERENCES claims (id) ON DELETE CASCADE,
  org_id      text NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  evidence_id text NOT NULL,
  source_kind text NOT NULL CHECK (source_kind IN ('chat_message', 'attachment', 'survey_response', 'interview_segment', 'transcript_segment', 'research_source')),
  source_ref  text NOT NULL,
  stance      text NOT NULL CHECK (stance IN ('supporting', 'contradicting')),
  -- 可读摘录（契约 KgEvidenceAnchor.excerpt ≤ 280）
  excerpt     text NOT NULL DEFAULT '' CHECK (length(excerpt) <= 280),
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (claim_id, evidence_id, stance)
);
CREATE INDEX IF NOT EXISTS claim_project_evidence_evidence_idx ON claim_project_evidence (org_id, evidence_id);

ALTER TABLE claim_project_evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE claim_project_evidence FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS claim_project_evidence_tenant ON claim_project_evidence;
CREATE POLICY claim_project_evidence_tenant ON claim_project_evidence
  USING (org_id = current_setting('app.current_org', true))
  WITH CHECK (org_id = current_setting('app.current_org', true));
-- 可见性跟随结论（同 claim_message_evidence）。
DROP POLICY IF EXISTS claim_project_evidence_claim_visible ON claim_project_evidence;
CREATE POLICY claim_project_evidence_claim_visible ON claim_project_evidence AS RESTRICTIVE
  USING (EXISTS (SELECT 1 FROM claims c WHERE c.id = claim_id AND c.org_id = claim_project_evidence.org_id));
-- I-3：只有执行器（SECURITY DEFINER 函数）写；app_rw 只读。
REVOKE ALL ON claim_project_evidence FROM app_rw;
GRANT SELECT ON claim_project_evidence TO app_rw;

-- ─────────────────────────────── 执行器：接收证据单元 ───────────────────────────────
-- 在 F06（迁移 20260924210000）版本之上加一支；消息 / 片段两支逐字保留。
CREATE OR REPLACE FUNCTION kg_insert_claim_evidence(p_org text, p_scope_kind text, p_scope_id text, p_claim_id text, ev jsonb)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp
AS $$
-- B3 集成后的合体（T1 20260928100000 + T2 本迁移；本文件按文件名后应用，函数体以此为准）：
--   · {message_id, stance, excerpt, evidence_id?}  → claim_message_evidence（T1：evidence_id 可空回链）
--   · {segment_id, stance, evidence_id?}            → claim_segments（同上）
--   · {evidence_id, source_kind, source_ref, stance, excerpt} → claim_project_evidence（T2：只收 project 作用域）
-- 三种都先核对 evidence_id 指向本 org 的 project_evidence：消息 / 片段指不到 ⇒ 落 NULL 不拒批；
-- 证据单元变体指不到 ⇒ 拒（它没有别的锚可落）。
DECLARE
  v_body     text;
  v_excerpt  text;
  v_evidence text := ev->>'evidence_id';
BEGIN
  IF v_evidence IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM project_evidence pe WHERE pe.id = v_evidence AND pe.org_id = p_org
  ) THEN
    IF ev ? 'source_kind' THEN
      RAISE EXCEPTION 'KG_EVIDENCE_NOT_FOUND: project evidence %', v_evidence USING ERRCODE = '23503';
    END IF;
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
  IF ev ? 'segment_id' THEN
    IF NOT EXISTS (SELECT 1 FROM segments s WHERE s.id = ev->>'segment_id' AND s.org_id = p_org) THEN
      RAISE EXCEPTION 'KG_EVIDENCE_NOT_FOUND: segment %', ev->>'segment_id' USING ERRCODE = '23503';
    END IF;
    INSERT INTO claim_segments (claim_id, org_id, segment_id, stance, evidence_id)
    VALUES (p_claim_id, p_org, ev->>'segment_id', ev->>'stance', v_evidence)
    ON CONFLICT DO NOTHING;
    RETURN;
  END IF;
  -- B3-T2：证据单元只挂在项目作用域的结论上。
  IF p_scope_kind IS DISTINCT FROM 'project' THEN
    RAISE EXCEPTION 'KG_EVIDENCE_NOT_FOUND: project evidence % cannot anchor a % claim', ev->>'evidence_id', p_scope_kind USING ERRCODE = '23503';
  END IF;
  INSERT INTO claim_project_evidence (claim_id, org_id, evidence_id, source_kind, source_ref, stance, excerpt)
  VALUES (p_claim_id, p_org, v_evidence, ev->>'source_kind', ev->>'source_ref', ev->>'stance', left(coalesce(ev->>'excerpt', ''), 280))
  ON CONFLICT DO NOTHING;
END
$$;
REVOKE ALL ON FUNCTION kg_insert_claim_evidence(text, text, text, text, jsonb) FROM PUBLIC;

-- ─────────────────────────────── 入图任务：哪些项目该跑一轮 ───────────────────────────────
-- 只回 id，不带任何内容（同 `kg_extraction_pending_orgs`）。目前 = 所有 active 项目：每个项目每轮一条带索引的
-- 「有没有待入图证据」查询（`listForIngestion`），没有就空转。等 T1 的 `project_evidence` 落地后改成只回
-- 「有未撤回、未入图证据」的项目（见 #4496 回报的 `ingested_at` 提议）。
CREATE OR REPLACE FUNCTION kg_project_ingestion_pending() RETURNS TABLE (org_id text, project_id text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp
AS $$ SELECT p.org_id, p.id FROM public.projects p WHERE p.status = 'active' ORDER BY p.org_id, p.id $$;
REVOKE ALL ON FUNCTION kg_project_ingestion_pending() FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_rw') THEN
    GRANT EXECUTE ON FUNCTION kg_project_ingestion_pending() TO app_rw;
  END IF;
END
$$;

-- B3 集成：T1 的 `project_evidence` 表在本文件之前（20260928100000）已建，锚点回链补外键。
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'claim_project_evidence_evidence_fkey' AND conrelid = 'claim_project_evidence'::regclass) THEN
    ALTER TABLE claim_project_evidence ADD CONSTRAINT claim_project_evidence_evidence_fkey
      FOREIGN KEY (evidence_id) REFERENCES project_evidence (id) ON DELETE CASCADE;
  END IF;
END $$;

-- 组织冻结的写限制在首次 apply 时也装上（新表 claim_project_evidence；否则只有重放时才被
-- 20260928100000 的调用顺带装上，migrate:check 的 schema digest 会对不上）。
SELECT kernel_apply_org_freeze_policies();

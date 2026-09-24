/*
 * Phase 18 F06 —— 会话消息 → 知识抽取：消息证据、抽取队列、执行器接收消息证据。
 *
 * ## 为什么证据要能直接指向消息（而不是只能指向 segments）
 *
 * segments 挂在 artifact_versions 下，而 artifact_versions 是「文件在对象存储里的不可变快照」
 * （file-first，0006 I-5：没有字节的版本不是版本）。给每条聊天消息造一个 artifact / version，
 * 等于伪造文件——它们还会出现在文件浏览器里。所以消息证据单独一张表 `claim_message_evidence`，
 * 外键直接指向 chat_messages：消息被删 ⇒ 证据行跟着没（F07 在此之上判「结论是否还有支撑」）。
 * 附件证据仍走 claim_segments。I-5「至少一条 supporting 证据」对两种证据一视同仁。
 * 契约 `KgEvidenceAnchor` 已区分 `sourceKind: chat_message | attachment`，这里只是存储落点。
 *
 * ## 抽取队列
 *
 * chat_messages 的 AFTER INSERT 触发器把新消息排进 `kg_extraction_queue`（同一事务：消息落了，
 * 待抽取就一定在；消息发送本身不等抽取——06-UX R3-8「不拖慢对话」）。worker 按 org 取活。
 */

-- ─────────────────────────────── 消息证据 ───────────────────────────────
CREATE TABLE IF NOT EXISTS claim_message_evidence (
  claim_id   text NOT NULL REFERENCES claims (id) ON DELETE CASCADE,
  org_id     text NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  message_id text NOT NULL REFERENCES chat_messages (id) ON DELETE CASCADE,
  stance     text NOT NULL CHECK (stance IN ('supporting', 'contradicting')),
  -- 可读摘录（契约 KgEvidenceAnchor.excerpt ≤ 280）：面板上直接给人看「原话」，不必每次回表。
  excerpt    text NOT NULL DEFAULT '' CHECK (length(excerpt) <= 280),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (claim_id, message_id, stance)
);
CREATE INDEX IF NOT EXISTS claim_message_evidence_message_idx ON claim_message_evidence (org_id, message_id);

ALTER TABLE claim_message_evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE claim_message_evidence FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS claim_message_evidence_tenant ON claim_message_evidence;
CREATE POLICY claim_message_evidence_tenant ON claim_message_evidence
  USING (org_id = current_setting('app.current_org', true))
  WITH CHECK (org_id = current_setting('app.current_org', true));
-- 可见性跟随结论（结论的个人空间策略在子查询里照样生效）。
DROP POLICY IF EXISTS claim_message_evidence_claim_visible ON claim_message_evidence;
CREATE POLICY claim_message_evidence_claim_visible ON claim_message_evidence AS RESTRICTIVE
  USING (EXISTS (SELECT 1 FROM claims c WHERE c.id = claim_id AND c.org_id = claim_message_evidence.org_id));
REVOKE ALL ON claim_message_evidence FROM app_rw;
GRANT SELECT ON claim_message_evidence TO app_rw;

-- ─────────────────────────────── 抽取队列 ───────────────────────────────
CREATE TABLE IF NOT EXISTS kg_extraction_queue (
  message_id  text PRIMARY KEY REFERENCES chat_messages (id) ON DELETE CASCADE,
  org_id      text NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  thread_id   text NOT NULL,
  attempts    integer NOT NULL DEFAULT 0,
  last_error  text,
  locked_at   timestamptz,
  -- 失败后的退避：模型短暂不可用时，三次重试不会挤在连续三个 2 秒的轮询里全部用光。
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  enqueued_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS kg_extraction_queue_org_idx ON kg_extraction_queue (org_id, enqueued_at);

ALTER TABLE kg_extraction_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE kg_extraction_queue FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS kg_extraction_queue_tenant ON kg_extraction_queue;
CREATE POLICY kg_extraction_queue_tenant ON kg_extraction_queue
  USING (org_id = current_setting('app.current_org', true))
  WITH CHECK (org_id = current_setting('app.current_org', true));
REVOKE ALL ON kg_extraction_queue FROM app_rw;
-- 排队只经触发器；worker 以 app_rw 身份认领（UPDATE locked_at）、完成（DELETE）、记失败（UPDATE）。
GRANT SELECT, UPDATE, DELETE ON kg_extraction_queue TO app_rw;

-- 抽取是否在这个库上开着（单行表）。抽取默认关（KG_EXTRACTION_ENABLED=1 才开）；关着的时候不排队——
-- 否则每个部署（包括桌面版）都会一条消息攒一行、永远没人消费（同 F04 在没有 AGE 时不排 outbox 的理由）。
-- worker 启动且确实开着时调用 kg_extraction_enable() 把它置真；从那之后的新消息才排队，不会回头给
-- 全部历史消息补抽（要补抽走「整理本会话」，uc-18-3 A1）。
CREATE TABLE IF NOT EXISTS kg_extraction_state (
  singleton  boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  enabled    boolean NOT NULL DEFAULT false,
  enabled_at timestamptz
);
INSERT INTO kg_extraction_state (singleton, enabled) VALUES (true, false) ON CONFLICT DO NOTHING;
REVOKE ALL ON kg_extraction_state FROM app_rw;

CREATE OR REPLACE FUNCTION kg_extraction_enable() RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp
AS $$ UPDATE public.kg_extraction_state SET enabled = true, enabled_at = coalesce(enabled_at, now()) WHERE singleton $$;
REVOKE ALL ON FUNCTION kg_extraction_enable() FROM PUBLIC;

CREATE OR REPLACE FUNCTION kg_enqueue_extraction() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  -- 原始转录流（raw_transcript）另有管线；只有空白的消息没有可抽的东西。
  IF NEW.raw_transcript OR NEW.body ~ '^\s*$' THEN RETURN NULL; END IF;
  -- 单条消息比会话更窄的可见范围（member-private 等）：从它抽出的知识会按整个会话可见，所以不抽。
  IF NEW.visibility_scope IS NOT NULL THEN RETURN NULL; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.kg_extraction_state WHERE enabled) THEN RETURN NULL; END IF;
  INSERT INTO public.kg_extraction_queue (message_id, org_id, thread_id)
  VALUES (NEW.id, NEW.org_id, NEW.thread_id)
  ON CONFLICT (message_id) DO NOTHING;
  RETURN NULL;
END
$$;
DROP TRIGGER IF EXISTS kg_enqueue_extraction_trg ON chat_messages;
CREATE TRIGGER kg_enqueue_extraction_trg AFTER INSERT ON chat_messages
  FOR EACH ROW EXECUTE FUNCTION kg_enqueue_extraction();

CREATE OR REPLACE FUNCTION kg_extraction_pending_orgs() RETURNS SETOF text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp
AS $$ SELECT DISTINCT org_id FROM public.kg_extraction_queue WHERE attempts < 3 AND next_attempt_at <= now() $$;
REVOKE ALL ON FUNCTION kg_extraction_pending_orgs() FROM PUBLIC;

-- ─────────────────────────────── 执行器：接收消息证据 ───────────────────────────────
-- 只替换 F03 抽出来的证据写入函数；kg_apply_batch 本身（不变量、冻结、幂等锁）不动。
-- 证据项：`{segment_id, stance}` 或 `{message_id, stance, excerpt}`。消息证据额外要求：消息属于本 org；
-- 作用域是 chat_session 时，消息必须来自**这个会话**（跨会话的「证据」只会让面板指向用户看不懂的地方）。
CREATE OR REPLACE FUNCTION kg_insert_claim_evidence(p_org text, p_scope_kind text, p_scope_id text, p_claim_id text, ev jsonb)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_body    text;
  v_excerpt text;
BEGIN
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
    INSERT INTO claim_message_evidence (claim_id, org_id, message_id, stance, excerpt)
    VALUES (p_claim_id, p_org, ev->>'message_id', ev->>'stance', left(v_excerpt, 280))
    ON CONFLICT DO NOTHING;
    RETURN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM segments s WHERE s.id = ev->>'segment_id' AND s.org_id = p_org) THEN
    RAISE EXCEPTION 'KG_EVIDENCE_NOT_FOUND: segment %', ev->>'segment_id' USING ERRCODE = '23503';
  END IF;
  INSERT INTO claim_segments (claim_id, org_id, segment_id, stance)
  VALUES (p_claim_id, p_org, ev->>'segment_id', ev->>'stance')
  ON CONFLICT DO NOTHING;
END
$$;
REVOKE ALL ON FUNCTION kg_insert_claim_evidence(text, text, text, text, jsonb) FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_rw') THEN
    GRANT EXECUTE ON FUNCTION kg_extraction_pending_orgs(), kg_extraction_enable() TO app_rw;
  END IF;
END
$$;

SELECT kernel_apply_org_freeze_policies();

/*
 * Issue #4290（第 8 轮）—— 本人明确改口时，新决定自动取代本人的旧决定（可撤销）。
 *
 * 人类决定（2026-09-26，signoff-draft/chat-knowledge-graph/usecases.md #4290 条目）：
 *   1. 只有明确改口才取代：新决定带改口信号，且与**同一作者**一条仍生效的旧决定主题相同。并列补充两条都留。
 *   2. 自动生效、可撤销：旧决定转 superseded（revocation_reason = decision_changed），不再召回；会话里一行
 *      「已用〈新〉取代〈旧〉 · 撤销」，撤销后旧决定恢复为生效，新决定仍在。
 *
 * 与 F16（20260924290000）同一形状，接在它后面、同一个抽取任务里跑（detect-conflicts.ts）：
 *   ① `kg_supersede_candidates(thread, message)`：只读。这条消息刚抽出的决定（F16 的 kg_conflict_newer_ok：本会话、
 *      模型提出、没人看过、由这条消息支撑——F16 刚开了卡的新条已是 contested，自然不在里面），带上消息作者；
 *      以及还活着的旧决定（kg_supersede_older_ok）：本会话的，外加——只在个人线程、且这条消息就是所有者本人说的
 *      时候（kg_conflict_source.with_personal，同 F16）——所有者本人个人空间的。每条旧决定带作者：
 *      会话里的 = 它全部支撑原话的唯一人类作者（kg_supersede_session_author，不唯一 ⇒ NULL）；个人空间的 = 空间主人。
 *   ② 应用层纯函数（domain/knowledge-graph/decision-supersede.ts）判哪几对算明确改口。判定规则只在那一处。
 *   ③ `kg_apply_supersedes(jsonb)`：在会话锁（+ 个人空间锁）下逐条复核（①的条件原样再判一遍、同一作者、行上锁），
 *      把旧决定——连同所有者本人由它晋升出去的、还活着的 L1 副本（同 F16 keep_new：用户说了改，旧说法就不该再被召回）——
 *      转 superseded，给新决定写 supersedes_claim_id，开一条取代提示（kg_supersede_notices）并记下撤销快照。
 *
 * 为什么要 revoked_at（而不只是 status）：本仓库所有「这条还活着吗」的读法都是 `revoked_at IS NULL AND status <> 'superseded'`
 * 两个条件一起用，只有一半的话某处漏判就会把它当活的；F07 的级联（边失效）也挂在 revoked_at 上——旧决定的边跟着失效，
 * 图召回同样走不到它。代价是撤销时要把级联收掉的边放回来：开提示时就把「这次会被收掉的活边」记进快照（restore.edges），
 * 撤销时逐条放回（端点仍在、结论端点仍活着的才放）。
 *
 * supersedes_claim_id：旧决定在本会话里，或会话是所有者本人的个人线程（只有所有者本人看得到这条新结论）时才写——
 * 同 F16 的纪律，项目会话里的结论不指向别人看不到的个人空间 id。取代关系本身总记在提示表里（newer / older）。
 *
 * 撤销（`kg_undo_supersede`，applyHumanAction{undoSupersede}）：人的动作（I-15），与 F10 / F16 同一套前置（所有者、
 * 会话锁 → 个人空间锁、revision）。只恢复快照里、且现在仍是「因这次改口而失效」（revocation_reason = decision_changed）的结论，
 * 恢复成当时的状态；会话里的旧结论另外要求原话还在（原话被删了就没有可恢复的东西）。一条都恢复不了 ⇒ KG_CLAIM_NOT_FOUND。
 * 撤销过的一对不会再被自动取代：同一条新决定只开一张提示（UNIQUE org_id, newer_claim_id），抽取任务重试时跳过。
 */

-- ─────────────────────────────── 提示表 ───────────────────────────────
CREATE TABLE IF NOT EXISTS kg_supersede_notices (
  id              text PRIMARY KEY,
  org_id          text NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  thread_id       text NOT NULL,
  -- 说出改口的那条消息：提示挂在它所在的那一轮回答下面（getTurnMemory）。删消息置空、行留作审计（同 F16）。
  message_id      text REFERENCES chat_messages (id) ON DELETE SET NULL,
  newer_claim_id  text NOT NULL REFERENCES claims (id) ON DELETE CASCADE,
  -- 被取代的那句旧决定（界面上的〈旧〉）；同一句话在会话与个人空间各有一条时，全部都在 restore.claims 里。
  older_claim_id  text NOT NULL REFERENCES claims (id) ON DELETE CASCADE,
  status          text NOT NULL DEFAULT 'applied' CHECK (status IN ('applied', 'undone')),
  -- 撤销快照：{ claims: [{ id, status }], edges: [id], newer_supersedes: text|null }
  restore         jsonb NOT NULL,
  detected_by_action_id text NOT NULL,
  undone_by       text,
  undone_at       timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CHECK (newer_claim_id <> older_claim_id),
  CHECK ((status = 'undone') = (undone_at IS NOT NULL)),
  UNIQUE (org_id, newer_claim_id)
);
CREATE INDEX IF NOT EXISTS kg_supersede_notices_message_idx ON kg_supersede_notices (org_id, message_id, created_at);
CREATE INDEX IF NOT EXISTS kg_supersede_notices_older_idx ON kg_supersede_notices (org_id, older_claim_id);

ALTER TABLE kg_supersede_notices ENABLE ROW LEVEL SECURITY;
ALTER TABLE kg_supersede_notices FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS kg_supersede_notices_tenant ON kg_supersede_notices;
CREATE POLICY kg_supersede_notices_tenant ON kg_supersede_notices
  USING (org_id = current_setting('app.current_org', true) OR (SELECT public.kg_is_table_owner()))
  WITH CHECK (org_id = current_setting('app.current_org', true) OR (SELECT public.kg_is_table_owner()));
-- 可见性跟随两条结论（子查询受 claims 的个人空间策略约束）：旧决定在所有者个人空间时，别人连提示存在都看不到（I-14）。
DROP POLICY IF EXISTS kg_supersede_notices_claims_visible ON kg_supersede_notices;
CREATE POLICY kg_supersede_notices_claims_visible ON kg_supersede_notices AS RESTRICTIVE
  USING ((SELECT public.kg_is_table_owner())
      OR (EXISTS (SELECT 1 FROM claims c WHERE c.id = newer_claim_id AND c.org_id = kg_supersede_notices.org_id)
          AND EXISTS (SELECT 1 FROM claims c WHERE c.id = older_claim_id AND c.org_id = kg_supersede_notices.org_id)));
-- 只读：开提示与撤销都经下面的 SECURITY DEFINER 函数。
REVOKE ALL ON kg_supersede_notices FROM app_rw;
GRANT SELECT ON kg_supersede_notices TO app_rw;

-- ─────────────────────────────── 候选 ───────────────────────────────

-- 会话里一条结论的作者：全部支撑原话都是人说的、且是同一个人 ⇒ 那个人；否则 NULL（不取代）。
CREATE OR REPLACE FUNCTION kg_supersede_session_author(p_org text, p_claim text) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT CASE WHEN count(*) > 0 AND bool_and(m.author_kind = 'human') AND count(DISTINCT m.author_id) = 1
              THEN min(m.author_id) END
    FROM public.claim_message_evidence e JOIN public.chat_messages m ON m.id = e.message_id AND m.org_id = e.org_id
   WHERE e.org_id = p_org AND e.claim_id = p_claim AND e.stance = 'supporting'
$$;

-- 还活着的旧决定：活着、没在冲突里、是决定；本会话的（不是这条消息刚抽出的），或所有者本人个人空间的
-- （p_owner 非空时；由这条消息刚抽出的结论晋升 / 自动记入出去的副本不算——那是新说法本身）。
CREATE OR REPLACE FUNCTION kg_supersede_older_ok(p_org text, p_thread text, p_message text, p_owner text, p_claim text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.claims c
     WHERE c.org_id = p_org AND c.id = p_claim AND c.revoked_at IS NULL
       AND c.status IN ('proposed', 'reviewed', 'accepted') AND c.claim_kind = 'decision'
       AND ((c.scope_kind = 'chat_session' AND c.scope_id = p_thread
             AND NOT EXISTS (SELECT 1 FROM public.claim_message_evidence e
                              WHERE e.org_id = p_org AND e.claim_id = c.id AND e.message_id = p_message))
         OR (p_owner IS NOT NULL AND c.scope_kind = 'personal' AND c.scope_id = p_owner
             AND NOT EXISTS (SELECT 1 FROM public.ontology_edges d
                               JOIN public.claim_message_evidence e ON e.claim_id = d.dst_id AND e.org_id = d.org_id
                              WHERE d.org_id = p_org AND d.src_kind = 'claim' AND d.src_id = c.id AND d.relation = 'derived_from'
                                AND d.dst_kind = 'claim' AND e.message_id = p_message))))
$$;

CREATE OR REPLACE FUNCTION kg_supersede_candidates(p_thread text, p_message text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_org    text := current_setting('app.current_org', true);
  v_src    record;
  v_owner  text;
  v_author text;
BEGIN
  IF v_org IS NULL OR v_org = '' THEN RAISE EXCEPTION 'KG_NO_TENANT' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v_src FROM kg_conflict_source(v_org, p_thread, p_message);
  IF NOT FOUND THEN RETURN jsonb_build_object('fresh', '[]'::jsonb, 'live', '[]'::jsonb); END IF;
  v_owner := CASE WHEN v_src.with_personal THEN v_src.owner END;
  SELECT m.author_id INTO v_author FROM chat_messages m WHERE m.org_id = v_org AND m.id = p_message;
  RETURN jsonb_build_object(
    'fresh', (SELECT coalesce(jsonb_agg(jsonb_build_object(
                'id', c.id, 'kind', c.claim_kind, 'statement', c.statement, 'authorId', v_author) ORDER BY c.id), '[]'::jsonb)
                FROM claims c
               WHERE c.org_id = v_org AND c.scope_kind = 'chat_session' AND c.scope_id = p_thread
                 AND c.claim_kind = 'decision' AND kg_conflict_newer_ok(v_org, p_thread, p_message, c.id)),
    'live', (SELECT coalesce(jsonb_agg(jsonb_build_object(
                'id', c.id, 'kind', c.claim_kind, 'statement', c.statement, 'scope', c.scope_kind,
                'authorId', CASE WHEN c.scope_kind = 'personal' THEN c.scope_id ELSE kg_supersede_session_author(v_org, c.id) END)
                ORDER BY c.id), '[]'::jsonb)
                FROM claims c
               WHERE c.org_id = v_org
                 AND ((c.scope_kind = 'chat_session' AND c.scope_id = p_thread) OR (c.scope_kind = 'personal' AND c.scope_id = v_owner))
                 AND kg_supersede_older_ok(v_org, p_thread, p_message, v_owner, c.id)));
END
$$;

-- ─────────────────────────────── 取代 ───────────────────────────────
-- p = { action_id, thread_id, message_id, supersedes: [{ newer, olders: [id, …] }] }
-- 复核不过的旧条静默跳过（判定和落表之间状态可能变了）；一条新决定一张提示；返回开了几张。
CREATE OR REPLACE FUNCTION kg_apply_supersedes(p jsonb) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_org      text := current_setting('app.current_org', true);
  v_thread   text := p->>'thread_id';
  v_message  text := p->>'message_id';
  v_id       text := p->>'action_id';
  v_src      record;
  v_owner    text;
  v_author   text;
  v_item     jsonb;
  v_newer    record;
  v_older    record;
  v_olders   text[];
  v_rep      text;
  v_set      text[];
  v_restore  jsonb;
  v_session  text[] := '{}';
  v_personal text[] := '{}';
  n          int := 0;
BEGIN
  IF v_org IS NULL OR v_org = '' THEN RAISE EXCEPTION 'KG_NO_TENANT' USING ERRCODE = '42501'; END IF;
  IF NOT public.kernel_org_is_writable(v_org) THEN
    RAISE EXCEPTION 'KG_ORG_FROZEN: organization % is read-only', v_org USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_src FROM kg_conflict_source(v_org, v_thread, v_message);
  IF NOT FOUND THEN RETURN 0; END IF;
  v_owner := CASE WHEN v_src.with_personal THEN v_src.owner END;
  SELECT m.author_id INTO v_author FROM chat_messages m WHERE m.org_id = v_org AND m.id = v_message;
  IF v_author IS NULL THEN RETURN 0; END IF;

  -- 与 F10 / F11 / F16 同一把会话锁、同一个顺序（先会话、后个人空间）。
  PERFORM pg_advisory_xact_lock(hashtext('kg_scope:' || v_org || '|chat_session|' || v_thread));
  IF v_owner IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtext('kg_scope:' || v_org || '|personal|' || v_owner));
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(coalesce(p->'supersedes', '[]'::jsonb)) LOOP
    CONTINUE WHEN v_item->>'newer' IS NULL;
    SELECT * INTO v_newer FROM claims WHERE org_id = v_org AND id = v_item->>'newer' FOR UPDATE;
    CONTINUE WHEN NOT FOUND;
    CONTINUE WHEN v_newer.claim_kind IS DISTINCT FROM 'decision' OR NOT kg_conflict_newer_ok(v_org, v_thread, v_message, v_newer.id);
    -- 一条新决定只取代一次：撤销过的不会因为任务重试又被取代
    CONTINUE WHEN EXISTS (SELECT 1 FROM kg_supersede_notices x WHERE x.org_id = v_org AND x.newer_claim_id = v_newer.id);

    v_olders := '{}';
    FOR v_older IN
      SELECT c.* FROM claims c
       WHERE c.org_id = v_org AND c.id IN (SELECT jsonb_array_elements_text(coalesce(v_item->'olders', '[]'::jsonb)))
       ORDER BY (c.scope_kind = 'chat_session') DESC, c.id
       FOR UPDATE
    LOOP
      CONTINUE WHEN v_older.id = v_newer.id OR NOT kg_supersede_older_ok(v_org, v_thread, v_message, v_owner, v_older.id);
      -- 同一作者（不同作者之间不取代，只走 F16）
      CONTINUE WHEN v_author IS DISTINCT FROM
        (CASE WHEN v_older.scope_kind = 'personal' THEN v_older.scope_id ELSE kg_supersede_session_author(v_org, v_older.id) END);
      v_olders := v_olders || v_older.id;
    END LOOP;
    CONTINUE WHEN cardinality(v_olders) = 0;
    v_rep := v_olders[1];

    -- 连同所有者本人由这些旧条晋升出去的、还活着的 L1 副本（同 F16 keep_new）
    SELECT array_agg(DISTINCT x) INTO v_set FROM (
      SELECT unnest(v_olders) AS x
      UNION
      SELECT pc.id FROM claims pc
       WHERE v_owner IS NOT NULL AND pc.org_id = v_org AND pc.scope_kind = 'personal' AND pc.scope_id = v_owner
         AND pc.revoked_at IS NULL AND pc.status <> 'superseded'
         AND EXISTS (SELECT 1 FROM ontology_edges d WHERE d.org_id = v_org AND d.src_kind = 'claim' AND d.src_id = pc.id
                       AND d.relation = 'derived_from' AND d.dst_kind = 'claim' AND d.dst_id = ANY(v_olders))) s;
    PERFORM 1 FROM claims WHERE org_id = v_org AND id = ANY(v_set) FOR UPDATE;

    -- 撤销快照：当时的状态、这次会被 F07 级联收掉的活边、新条原来的 supersedes
    v_restore := jsonb_build_object(
      'claims', (SELECT jsonb_agg(jsonb_build_object('id', c.id, 'status', c.status) ORDER BY c.id)
                   FROM claims c WHERE c.org_id = v_org AND c.id = ANY(v_set)),
      'edges', (SELECT coalesce(jsonb_agg(e.id ORDER BY e.id), '[]'::jsonb) FROM ontology_edges e
                 WHERE e.org_id = v_org AND e.status = 'active'
                   AND ((e.src_kind = 'claim' AND e.src_id = ANY(v_set)) OR (e.dst_kind = 'claim' AND e.dst_id = ANY(v_set)))),
      'newer_supersedes', v_newer.supersedes_claim_id);

    UPDATE claims SET status = 'superseded', revoked_at = now(), revocation_reason = 'decision_changed', updated_at = now()
     WHERE org_id = v_org AND id = ANY(v_set) AND revoked_at IS NULL;
    UPDATE claims SET supersedes_claim_id = v_rep, updated_at = now()
     WHERE org_id = v_org AND id = v_newer.id
       AND ((SELECT c.scope_kind FROM claims c WHERE c.org_id = v_org AND c.id = v_rep) = 'chat_session' OR v_owner IS NOT NULL);

    INSERT INTO kg_supersede_notices (id, org_id, thread_id, message_id, newer_claim_id, older_claim_id, restore, detected_by_action_id)
    VALUES (v_id || '-' || n, v_org, v_thread, v_message, v_newer.id, v_rep, v_restore, v_id);
    n := n + 1;
    v_session := v_session || v_newer.id;
    v_session := v_session || ARRAY(SELECT c.id FROM claims c WHERE c.org_id = v_org AND c.id = ANY(v_set) AND c.scope_kind = 'chat_session');
    v_personal := v_personal || ARRAY(SELECT c.id FROM claims c WHERE c.org_id = v_org AND c.id = ANY(v_set) AND c.scope_kind = 'personal');
  END LOOP;

  IF n = 0 THEN RETURN 0; END IF;
  -- 会话作用域留一条（revision 前进；来源抽屉按 payload.claims 查）；个人空间的旧条单独在个人空间留一条（同 F16）。
  INSERT INTO ontology_actions (id, org_id, scope_kind, scope_id, actor_kind, actor_id, action_type, payload, source_ref, outcome)
  VALUES (v_id, v_org, 'chat_session', v_thread, 'system', 'kg-supersede-detector', 'supersedeDecision',
          jsonb_build_object('message_id', v_message, 'notices', n, 'reason', 'decision_changed',
                             'claims', (SELECT coalesce(jsonb_agg(DISTINCT jsonb_build_object('id', x)), '[]'::jsonb) FROM unnest(v_session) x)),
          v_message, 'accepted');
  IF cardinality(v_personal) > 0 THEN
    INSERT INTO ontology_actions (id, org_id, scope_kind, scope_id, actor_kind, actor_id, action_type, payload, source_ref, outcome)
    VALUES (v_id || '-l1', v_org, 'personal', v_owner, 'system', 'kg-supersede-detector', 'supersedeDecision',
            jsonb_build_object('thread_id', v_thread, 'reason', 'decision_changed',
                               'claims', (SELECT jsonb_agg(DISTINCT jsonb_build_object('id', x)) FROM unnest(v_personal) x)),
            v_message, 'accepted');
  END IF;
  RETURN n;
END
$$;

-- ─────────────────────────────── 撤销（人的动作）───────────────────────────────
-- p = { action_id, thread_id, based_on_revision, action: { type: undoSupersede, noticeId } }
CREATE OR REPLACE FUNCTION kg_undo_supersede(p jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_org      text := current_setting('app.current_org', true);
  v_user     text := current_setting('app.current_user_id', true);
  v_thread   text := p->>'thread_id';
  v_action   jsonb := p->'action';
  v_id       text := p->>'action_id';
  v_rev      bigint;
  v_notice   record;
  v_c        jsonb;
  v_row      record;
  v_session  text[] := '{}';
  v_personal text[] := '{}';
BEGIN
  IF v_org IS NULL OR v_org = '' THEN RAISE EXCEPTION 'KG_NO_TENANT' USING ERRCODE = '42501'; END IF;
  IF NOT public.kernel_org_is_writable(v_org) THEN
    RAISE EXCEPTION 'KG_ORG_FROZEN: organization % is read-only', v_org USING ERRCODE = '42501';
  END IF;
  IF v_user IS NULL OR v_user = '' THEN RAISE EXCEPTION 'KG_ACTOR_NOT_HUMAN: no signed-in user' USING ERRCODE = '42501'; END IF;
  IF NOT EXISTS (SELECT 1 FROM chat_threads t WHERE t.id = v_thread AND t.org_id = v_org AND t.created_by = v_user) THEN
    RAISE EXCEPTION 'KG_NOT_OWNER: only the thread owner edits its knowledge' USING ERRCODE = '42501';
  END IF;
  IF v_action->>'type' IS DISTINCT FROM 'undoSupersede' OR v_action->>'noticeId' IS NULL THEN
    RAISE EXCEPTION 'KG_INVALID_ACTION: %', v_action->>'type' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('kg_scope:' || v_org || '|chat_session|' || v_thread));
  PERFORM pg_advisory_xact_lock(hashtext('kg_scope:' || v_org || '|personal|' || v_user));
  SELECT count(*) INTO v_rev FROM ontology_actions a
   WHERE a.org_id = v_org AND a.scope_kind = 'chat_session' AND a.scope_id = v_thread AND a.outcome = 'accepted';
  IF (p->>'based_on_revision')::bigint IS DISTINCT FROM v_rev THEN
    RAISE EXCEPTION 'KG_REVISION_CHANGED: based on %, current %', p->>'based_on_revision', v_rev USING ERRCODE = '40001';
  END IF;

  -- 本会话的、还没撤销过的提示。别的会话的 id、撤销过的、不存在的——同一个出口。
  SELECT * INTO v_notice FROM kg_supersede_notices
   WHERE org_id = v_org AND id = v_action->>'noticeId' AND thread_id = v_thread AND status = 'applied'
   FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'KG_PROMPT_NOT_FOUND' USING ERRCODE = '23503'; END IF;

  FOR v_c IN SELECT * FROM jsonb_array_elements(coalesce(v_notice.restore->'claims', '[]'::jsonb)) LOOP
    SELECT * INTO v_row FROM claims WHERE org_id = v_org AND id = v_c->>'id' FOR UPDATE;
    CONTINUE WHEN NOT FOUND;
    -- 只恢复「因这次改口而失效」、且调用方有权动的：本会话的，或调用方本人个人空间的
    CONTINUE WHEN v_row.revoked_at IS NULL OR v_row.revocation_reason IS DISTINCT FROM 'decision_changed';
    CONTINUE WHEN NOT ((v_row.scope_kind = 'chat_session' AND v_row.scope_id = v_thread)
                    OR (v_row.scope_kind = 'personal' AND v_row.scope_id = v_user));
    -- 会话里的结论：原话还在才恢复（原话被删了就没有可恢复的东西，同 F07）
    CONTINUE WHEN v_row.scope_kind = 'chat_session'
      AND NOT EXISTS (SELECT 1 FROM claim_message_evidence e WHERE e.org_id = v_org AND e.claim_id = v_row.id AND e.stance = 'supporting')
      AND NOT EXISTS (SELECT 1 FROM claim_segments s WHERE s.claim_id = v_row.id AND s.stance = 'supporting');
    UPDATE claims SET status = v_c->>'status', revoked_at = NULL, revocation_reason = NULL, updated_at = now()
     WHERE org_id = v_org AND id = v_row.id;
    IF v_row.scope_kind = 'personal' THEN v_personal := v_personal || v_row.id; ELSE v_session := v_session || v_row.id; END IF;
  END LOOP;
  IF cardinality(v_session) + cardinality(v_personal) = 0 THEN
    RAISE EXCEPTION 'KG_CLAIM_NOT_FOUND: the superseded decision is gone' USING ERRCODE = '23503';
  END IF;

  -- 放回 F07 级联收掉的边：快照里的、现在仍是失效的、两端都还在（结论端点还活着）的
  UPDATE ontology_edges e SET status = 'active', invalidated_at = NULL
   WHERE e.org_id = v_org AND e.status = 'invalidated'
     AND e.id IN (SELECT jsonb_array_elements_text(coalesce(v_notice.restore->'edges', '[]'::jsonb)))
     AND (e.src_kind <> 'claim' OR EXISTS (SELECT 1 FROM claims c WHERE c.org_id = v_org AND c.id = e.src_id AND c.revoked_at IS NULL))
     AND (e.dst_kind <> 'claim' OR EXISTS (SELECT 1 FROM claims c WHERE c.org_id = v_org AND c.id = e.dst_id AND c.revoked_at IS NULL))
     AND (e.src_kind <> 'chat_message' OR EXISTS (SELECT 1 FROM chat_messages m WHERE m.org_id = v_org AND m.id = e.src_id))
     AND (e.dst_kind <> 'chat_message' OR EXISTS (SELECT 1 FROM chat_messages m WHERE m.org_id = v_org AND m.id = e.dst_id))
     AND (e.src_kind <> 'segment' OR EXISTS (SELECT 1 FROM segments s WHERE s.org_id = v_org AND s.id = e.src_id))
     AND (e.dst_kind <> 'segment' OR EXISTS (SELECT 1 FROM segments s WHERE s.org_id = v_org AND s.id = e.dst_id))
     AND (e.src_kind <> 'object' OR EXISTS (SELECT 1 FROM ontology_objects o WHERE o.org_id = v_org AND o.id = e.src_id))
     AND (e.dst_kind <> 'object' OR EXISTS (SELECT 1 FROM ontology_objects o WHERE o.org_id = v_org AND o.id = e.dst_id));

  -- 新决定仍在；它指向旧条的 supersedes 放回原样
  UPDATE claims SET supersedes_claim_id = v_notice.restore->>'newer_supersedes', updated_at = now()
   WHERE org_id = v_org AND id = v_notice.newer_claim_id AND supersedes_claim_id = v_notice.older_claim_id;
  UPDATE kg_supersede_notices SET status = 'undone', undone_by = v_user, undone_at = now() WHERE id = v_notice.id;

  INSERT INTO ontology_actions (id, org_id, scope_kind, scope_id, actor_kind, actor_id, action_type, payload, outcome)
  VALUES (v_id, v_org, 'chat_session', v_thread, 'human', v_user, 'undoSupersede',
          jsonb_build_object('action', v_action,
                             'claims', (SELECT jsonb_agg(jsonb_build_object('id', x)) FROM unnest(v_session || v_notice.newer_claim_id) x),
                             'objects', '[]'::jsonb),
          'accepted');
  IF cardinality(v_personal) > 0 THEN
    INSERT INTO ontology_actions (id, org_id, scope_kind, scope_id, actor_kind, actor_id, action_type, payload, outcome)
    VALUES (v_id || '-l1', v_org, 'personal', v_user, 'human', v_user, 'undoSupersede',
            jsonb_build_object('thread_id', v_thread, 'claims', (SELECT jsonb_agg(jsonb_build_object('id', x)) FROM unnest(v_personal) x)),
            'accepted');
  END IF;
  RETURN jsonb_build_object('revision', kg_thread_revision(v_thread), 'action_id', v_id);
END
$$;

REVOKE ALL ON FUNCTION kg_supersede_session_author(text, text), kg_supersede_older_ok(text, text, text, text, text),
  kg_supersede_candidates(text, text), kg_apply_supersedes(jsonb), kg_undo_supersede(jsonb) FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_rw') THEN
    GRANT EXECUTE ON FUNCTION kg_supersede_candidates(text, text), kg_apply_supersedes(jsonb), kg_undo_supersede(jsonb) TO app_rw;
  END IF;
END
$$;

-- 停用组织的冻结策略（F22 单一事实源，新租户表建完调用一次）
SELECT kernel_apply_org_freeze_policies();

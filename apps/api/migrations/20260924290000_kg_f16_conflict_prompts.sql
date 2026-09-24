/*
 * Phase 18 F16 —— 矛盾提醒（uc-18-6 D / uc-18-1 A3，契约 KgConflictPrompt、applyHumanAction{resolveConflict}）。
 *
 * 流程：抽取（F06）把一条用户消息的结论交给执行器之后，同一个任务里接着判矛盾——
 *   ① `kg_conflict_candidates(thread, message)`：只读。这条消息刚抽出的结论（model / proposed），
 *      以及「你确认过」的结论（reviewed_by 非空、accepted 或已在冲突中）：本会话的，外加——只在个人线程、
 *      且这条消息就是会话所有者本人说的时候——所有者本人个人空间的（从本会话晋升出去的副本不重复算）。
 *   ② 应用层纯函数（domain/knowledge-graph/conflict.ts）判哪几对算矛盾、排好先后。
 *   ③ `kg_open_conflicts(jsonb)`：在会话锁下逐对复核（①的条件原样再判一遍、两行 FOR UPDATE），
 *      两条转 contested、给旧的那条挂一条 contradicting 证据（这条消息）、开一张提醒（kg_conflict_prompts）。
 * 判定规则只在 ② 一处；这里只保证「被判为矛盾的一对确实是一新一旧、都在调用方有权动的范围里」。
 *
 * 出口：`kg_resolve_conflict(jsonb)` —— 人的动作（I-15），与 F10 `kg_apply_human_action` 同一套
 * 前置（所有者、会话锁、revision），分成单独的函数是为了不整段重写 F10 的函数体：
 *   - keep_new：旧条 superseded（revoked_at，原因 conflict_keep_new，F07 的级联把它的边和 L1 副本一起收掉），
 *     新条 accepted；旧条在个人空间、或旧条有过本人的 L1 副本时，新条同一动作里记进个人空间（F11 kg_promote_claim），
 *     长期记忆里留下的是新的说法。
 *   - keep_both：两条都 accepted，各记一句适用条件，结束冲突。
 *   - ignore：两条保持 contested；这一对（旧条 + 同样说法的新条）不再提醒（I-19）。
 *
 * I-19 的「同一对」按**旧条 id + 新说法的归一文本**认：同一句话再说一遍，抽取会产生一条新 id 的结论，
 * 按 id 认就会再弹一次。旧条被改写（新 id）或被取代后，这个键自然失效——「直到其中一条被改」。
 */

-- ─────────────────────────────── 提醒表 ───────────────────────────────
CREATE TABLE IF NOT EXISTS kg_conflict_prompts (
  id              text PRIMARY KEY,
  org_id          text NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  thread_id       text NOT NULL,
  -- 说出新说法的那条消息：这张卡挂在它所在的那一轮回答下面（getTurnMemory）。消息删了，卡跟着没。
  message_id      text NOT NULL REFERENCES chat_messages (id) ON DELETE CASCADE,
  newer_claim_id  text NOT NULL REFERENCES claims (id) ON DELETE CASCADE,
  older_claim_id  text NOT NULL REFERENCES claims (id) ON DELETE CASCADE,
  -- 新说法的归一文本（I-19 的键）：kg_conflict_statement_key()
  newer_key       text NOT NULL,
  -- 同一次判定里的先后（0 = 最重要）：一轮只出一张，取最小的那张（R4 E3 / I-18）
  rank            integer NOT NULL CHECK (rank >= 0),
  status          text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'kept_new', 'kept_both', 'ignored')),
  newer_condition text CHECK (newer_condition IS NULL OR length(newer_condition) <= 200),
  older_condition text CHECK (older_condition IS NULL OR length(older_condition) <= 200),
  detected_by_action_id text NOT NULL,
  resolved_by     text,
  resolved_at     timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CHECK (newer_claim_id <> older_claim_id),
  CHECK ((status = 'open') = (resolved_at IS NULL)),
  UNIQUE (org_id, older_claim_id, newer_claim_id)
);
CREATE INDEX IF NOT EXISTS kg_conflict_prompts_message_idx ON kg_conflict_prompts (org_id, message_id, rank);
CREATE INDEX IF NOT EXISTS kg_conflict_prompts_pair_idx ON kg_conflict_prompts (org_id, older_claim_id, newer_key);

ALTER TABLE kg_conflict_prompts ENABLE ROW LEVEL SECURITY;
ALTER TABLE kg_conflict_prompts FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS kg_conflict_prompts_tenant ON kg_conflict_prompts;
CREATE POLICY kg_conflict_prompts_tenant ON kg_conflict_prompts
  USING (org_id = current_setting('app.current_org', true))
  WITH CHECK (org_id = current_setting('app.current_org', true));
-- 可见性跟随两条结论（子查询受 claims 的个人空间策略约束）：旧条在所有者个人空间里时，
-- 会话的其他成员连这张卡存在都看不到（I-14）。
DROP POLICY IF EXISTS kg_conflict_prompts_claims_visible ON kg_conflict_prompts;
CREATE POLICY kg_conflict_prompts_claims_visible ON kg_conflict_prompts AS RESTRICTIVE
  USING (EXISTS (SELECT 1 FROM claims c WHERE c.id = newer_claim_id AND c.org_id = kg_conflict_prompts.org_id)
     AND EXISTS (SELECT 1 FROM claims c WHERE c.id = older_claim_id AND c.org_id = kg_conflict_prompts.org_id));
-- 只读：开卡与处理都经下面的 SECURITY DEFINER 函数。
REVOKE ALL ON kg_conflict_prompts FROM app_rw;
GRANT SELECT ON kg_conflict_prompts TO app_rw;

-- I-19 的键：NFKC、去空白、小写。「上线改到 10/1」与「上线改到 10／1 」是同一句话。
CREATE OR REPLACE FUNCTION kg_conflict_statement_key(p_statement text) RETURNS text
LANGUAGE sql IMMUTABLE AS $$ SELECT lower(regexp_replace(normalize(p_statement, NFKC), '\s+', '', 'g')) $$;

-- 这条消息能不能引出矛盾提醒，以及能不能拿所有者的个人空间来比：
--   消息在本会话、人说的、不是更窄可见范围的消息；个人空间只在个人线程里、且消息是所有者本人说的。
CREATE OR REPLACE FUNCTION kg_conflict_source(p_org text, p_thread text, p_message text)
RETURNS TABLE (owner text, with_personal boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT t.created_by, (t.project_id IS NULL AND m.author_id = t.created_by)
    FROM public.chat_messages m JOIN public.chat_threads t ON t.id = m.thread_id AND t.org_id = m.org_id
   WHERE m.org_id = p_org AND m.id = p_message AND m.thread_id = p_thread
     AND m.author_kind = 'human' AND m.visibility_scope IS NULL AND m.raw_transcript = false
$$;

-- 「你确认过」的旧条：活着、有人确认过（reviewed_by）、accepted 或已在冲突中（被忽略的那一对还要能挡住重复提醒）。
-- 本会话的；或者所有者本人个人空间的（p_owner 非空时），但从本会话晋升出去的副本不算——本会话的原条已经在候选里。
CREATE OR REPLACE FUNCTION kg_conflict_older_ok(p_org text, p_thread text, p_owner text, p_claim text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.claims c
     WHERE c.org_id = p_org AND c.id = p_claim AND c.revoked_at IS NULL
       AND c.status IN ('accepted', 'contested') AND c.reviewed_by IS NOT NULL
       AND ((c.scope_kind = 'chat_session' AND c.scope_id = p_thread)
         OR (p_owner IS NOT NULL AND c.scope_kind = 'personal' AND c.scope_id = p_owner
             AND NOT EXISTS (SELECT 1 FROM public.ontology_edges d JOIN public.claims src ON src.id = d.dst_id AND src.org_id = d.org_id
                              WHERE d.org_id = p_org AND d.src_kind = 'claim' AND d.src_id = c.id AND d.relation = 'derived_from'
                                AND d.dst_kind = 'claim' AND d.status = 'active'
                                AND src.scope_kind = 'chat_session' AND src.scope_id = p_thread))))
$$;

-- 这条消息刚抽出的新条：本会话、模型提出、还没人看过、由这条消息支撑。
CREATE OR REPLACE FUNCTION kg_conflict_newer_ok(p_org text, p_thread text, p_message text, p_claim text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.claims c
     WHERE c.org_id = p_org AND c.id = p_claim AND c.scope_kind = 'chat_session' AND c.scope_id = p_thread
       AND c.created_by = 'model' AND c.status = 'proposed' AND c.revoked_at IS NULL
       AND EXISTS (SELECT 1 FROM public.claim_message_evidence e
                    WHERE e.claim_id = c.id AND e.org_id = p_org AND e.message_id = p_message AND e.stance = 'supporting'))
$$;

-- ─────────────────────────────── ① 候选 ───────────────────────────────
CREATE OR REPLACE FUNCTION kg_conflict_candidates(p_thread text, p_message text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_org   text := current_setting('app.current_org', true);
  v_src   record;
  v_owner text;
BEGIN
  IF v_org IS NULL OR v_org = '' THEN RAISE EXCEPTION 'KG_NO_TENANT' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v_src FROM kg_conflict_source(v_org, p_thread, p_message);
  IF NOT FOUND THEN RETURN jsonb_build_object('fresh', '[]'::jsonb, 'confirmed', '[]'::jsonb); END IF;
  v_owner := CASE WHEN v_src.with_personal THEN v_src.owner END;
  RETURN jsonb_build_object(
    'fresh', (SELECT coalesce(jsonb_agg(jsonb_build_object(
                'id', c.id, 'kind', coalesce(c.claim_kind, 'fact'), 'statement', c.statement,
                'confidence', coalesce(c.confidence, 0.5), 'about', kg_conflict_about(v_org, c.id)) ORDER BY c.id), '[]'::jsonb)
                FROM claims c
               WHERE c.org_id = v_org AND c.scope_kind = 'chat_session' AND c.scope_id = p_thread
                 AND kg_conflict_newer_ok(v_org, p_thread, p_message, c.id)),
    'confirmed', (SELECT coalesce(jsonb_agg(jsonb_build_object(
                'id', c.id, 'kind', coalesce(c.claim_kind, 'fact'), 'statement', c.statement,
                'scope', c.scope_kind, 'confirmedAt', c.updated_at, 'about', kg_conflict_about(v_org, c.id)) ORDER BY c.id), '[]'::jsonb)
                FROM claims c
               WHERE c.org_id = v_org
                 AND ((c.scope_kind = 'chat_session' AND c.scope_id = p_thread) OR (c.scope_kind = 'personal' AND c.scope_id = v_owner))
                 AND kg_conflict_older_ok(v_org, p_thread, v_owner, c.id)));
END
$$;

-- 一条结论涉及的实体名（活的 about 边）。
CREATE OR REPLACE FUNCTION kg_conflict_about(p_org text, p_claim text) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT coalesce(jsonb_agg(o.name ORDER BY o.name), '[]'::jsonb)
    FROM public.ontology_edges e JOIN public.ontology_objects o ON o.id = e.dst_id AND o.org_id = e.org_id
   WHERE e.org_id = p_org AND e.src_kind = 'claim' AND e.src_id = p_claim AND e.dst_kind = 'object'
     AND e.relation = 'about' AND e.status = 'active'
$$;

-- ─────────────────────────────── ③ 开卡 ───────────────────────────────
-- p = { action_id, thread_id, message_id, pairs: [{ newer, older }] }（pairs 按重要性排好）。
-- 复核不过的一对静默跳过（判定和落表之间状态可能变了：旧条刚被忘掉、新条刚被确认），返回开了几张。
CREATE OR REPLACE FUNCTION kg_open_conflicts(p jsonb) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_org     text := current_setting('app.current_org', true);
  v_thread  text := p->>'thread_id';
  v_message text := p->>'message_id';
  v_id      text := p->>'action_id';
  v_src     record;
  v_owner   text;
  v_pair    jsonb;
  v_newer   record;
  v_older   record;
  v_key     text;
  v_done    text[] := '{}';
  v_claims  text[] := '{}';
  v_personal text[] := '{}';
  n         int := 0;
BEGIN
  IF v_org IS NULL OR v_org = '' THEN RAISE EXCEPTION 'KG_NO_TENANT' USING ERRCODE = '42501'; END IF;
  IF NOT public.kernel_org_is_writable(v_org) THEN
    RAISE EXCEPTION 'KG_ORG_FROZEN: organization % is read-only', v_org USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_src FROM kg_conflict_source(v_org, v_thread, v_message);
  IF NOT FOUND THEN RETURN 0; END IF;
  v_owner := CASE WHEN v_src.with_personal THEN v_src.owner END;

  -- 与 F10 / F11 同一把会话锁：并发的确认 / 忘掉 / 晋升排在这次开卡之前或之后。
  PERFORM pg_advisory_xact_lock(hashtext('kg_scope:' || v_org || '|chat_session|' || v_thread));
  IF v_owner IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtext('kg_scope:' || v_org || '|personal|' || v_owner));
  END IF;

  FOR v_pair IN SELECT * FROM jsonb_array_elements(coalesce(p->'pairs', '[]'::jsonb)) LOOP
    -- 锁住两行再判：判完到写之间谁也改不了它们。
    CONTINUE WHEN v_pair->>'newer' IS NULL OR v_pair->>'older' IS NULL OR v_pair->>'newer' = v_pair->>'older';
    SELECT * INTO v_newer FROM claims WHERE org_id = v_org AND id = v_pair->>'newer' FOR UPDATE;
    CONTINUE WHEN NOT FOUND;
    SELECT * INTO v_older FROM claims WHERE org_id = v_org AND id = v_pair->>'older' FOR UPDATE;
    CONTINUE WHEN NOT FOUND;
    -- 新条：还没人看过；同一次判定里已经配过一对的（刚转 contested、上一轮已核过）也算——
    -- 一条新说法可以同时和两条旧的冲突。
    CONTINUE WHEN NOT (v_newer.id = ANY(v_done) OR kg_conflict_newer_ok(v_org, v_thread, v_message, v_newer.id));
    CONTINUE WHEN NOT kg_conflict_older_ok(v_org, v_thread, v_owner, v_older.id);
    v_key := kg_conflict_statement_key(v_newer.statement);
    -- I-19：同一旧条、同样说法的新条已经提醒过（还开着、被忽略、或两条都留了）⇒ 不再提醒
    CONTINUE WHEN EXISTS (SELECT 1 FROM kg_conflict_prompts x
                           WHERE x.org_id = v_org AND x.older_claim_id = v_older.id AND x.newer_key = v_key
                             AND x.status IN ('open', 'ignored', 'kept_both'));

    UPDATE claims SET status = 'contested', updated_at = now()
     WHERE org_id = v_org AND id IN (v_newer.id, v_older.id) AND status <> 'contested';
    -- uc-18-1 A3：「写一条 contradicting 证据」—— 旧条上记下「这条消息说的不一样」
    PERFORM kg_insert_claim_evidence(v_org, v_older.scope_kind, v_older.scope_id, v_older.id,
      jsonb_build_object('message_id', v_message, 'stance', 'contradicting', 'excerpt', ''));
    INSERT INTO kg_conflict_prompts (id, org_id, thread_id, message_id, newer_claim_id, older_claim_id, newer_key, rank, detected_by_action_id)
    VALUES (v_id || '-' || n, v_org, v_thread, v_message, v_newer.id, v_older.id, v_key, n, v_id);
    n := n + 1;
    v_done := v_done || v_newer.id;
    IF NOT v_newer.id = ANY(v_claims) THEN v_claims := v_claims || v_newer.id; END IF;
    IF v_older.scope_kind = 'personal' THEN
      IF NOT v_older.id = ANY(v_personal) THEN v_personal := v_personal || v_older.id; END IF;
    ELSIF NOT v_older.id = ANY(v_claims) THEN
      v_claims := v_claims || v_older.id;
    END IF;
  END LOOP;

  IF n = 0 THEN RETURN 0; END IF;
  -- 会话作用域留一条（revision 前进；来源抽屉的「谁 / 何时」按 payload.claims 查）。个人空间的旧条单独在
  -- 个人空间留一条：会话里的审计不带别人看不到的个人空间 id。
  INSERT INTO ontology_actions (id, org_id, scope_kind, scope_id, actor_kind, actor_id, action_type, payload, source_ref, outcome)
  VALUES (v_id, v_org, 'chat_session', v_thread, 'system', 'kg-conflict-detector', 'detectConflict',
          jsonb_build_object('message_id', v_message, 'prompts', n,
                             'claims', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', x)), '[]'::jsonb) FROM unnest(v_claims) x)),
          v_message, 'accepted');
  IF cardinality(v_personal) > 0 THEN
    INSERT INTO ontology_actions (id, org_id, scope_kind, scope_id, actor_kind, actor_id, action_type, payload, source_ref, outcome)
    VALUES (v_id || '-l1', v_org, 'personal', v_owner, 'system', 'kg-conflict-detector', 'detectConflict',
            jsonb_build_object('thread_id', v_thread,
                               'claims', (SELECT jsonb_agg(jsonb_build_object('id', x)) FROM unnest(v_personal) x)),
            v_message, 'accepted');
  END IF;
  RETURN n;
END
$$;

-- ─────────────────────────────── 出口：人的三种选择 ───────────────────────────────
-- p = { action_id, thread_id, based_on_revision, action: { type: resolveConflict, promptId, resolution, conditions? } }
CREATE OR REPLACE FUNCTION kg_resolve_conflict(p jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_org     text := current_setting('app.current_org', true);
  v_user    text := current_setting('app.current_user_id', true);
  v_thread  text := p->>'thread_id';
  v_action  jsonb := p->'action';
  v_res     text := p->'action'->>'resolution';
  v_id      text := p->>'action_id';
  v_rev     bigint;
  v_prompt  record;
  v_newer   record;
  v_older   record;
  v_promote boolean := false;
  v_l1      text;
  v_claims  jsonb;
BEGIN
  IF v_org IS NULL OR v_org = '' THEN RAISE EXCEPTION 'KG_NO_TENANT' USING ERRCODE = '42501'; END IF;
  IF NOT public.kernel_org_is_writable(v_org) THEN
    RAISE EXCEPTION 'KG_ORG_FROZEN: organization % is read-only', v_org USING ERRCODE = '42501';
  END IF;
  IF v_user IS NULL OR v_user = '' THEN RAISE EXCEPTION 'KG_ACTOR_NOT_HUMAN: no signed-in user' USING ERRCODE = '42501'; END IF;
  IF NOT EXISTS (SELECT 1 FROM chat_threads t WHERE t.id = v_thread AND t.org_id = v_org AND t.created_by = v_user) THEN
    RAISE EXCEPTION 'KG_NOT_OWNER: only the thread owner edits its knowledge' USING ERRCODE = '42501';
  END IF;
  IF v_action->>'type' IS DISTINCT FROM 'resolveConflict' OR v_res IS NULL OR v_res NOT IN ('keep_new', 'keep_both', 'ignore') THEN
    RAISE EXCEPTION 'KG_INVALID_ACTION: %', v_action->>'type' USING ERRCODE = '22023';
  END IF;

  -- 锁顺序同 F11：先会话、后个人空间。
  PERFORM pg_advisory_xact_lock(hashtext('kg_scope:' || v_org || '|chat_session|' || v_thread));
  PERFORM pg_advisory_xact_lock(hashtext('kg_scope:' || v_org || '|personal|' || v_user));
  SELECT count(*) INTO v_rev FROM ontology_actions a
   WHERE a.org_id = v_org AND a.scope_kind = 'chat_session' AND a.scope_id = v_thread AND a.outcome = 'accepted';
  IF (p->>'based_on_revision')::bigint IS DISTINCT FROM v_rev THEN
    RAISE EXCEPTION 'KG_REVISION_CHANGED: based on %, current %', p->>'based_on_revision', v_rev USING ERRCODE = '40001';
  END IF;

  -- 提醒：本会话的、还开着的。别的会话的 id、处理过的、不存在的——同一个出口。
  SELECT * INTO v_prompt FROM kg_conflict_prompts
   WHERE org_id = v_org AND id = v_action->>'promptId' AND thread_id = v_thread AND status = 'open'
   FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'KG_PROMPT_NOT_FOUND' USING ERRCODE = '23503'; END IF;
  SELECT * INTO v_newer FROM claims WHERE org_id = v_org AND id = v_prompt.newer_claim_id FOR UPDATE;
  SELECT * INTO v_older FROM claims WHERE org_id = v_org AND id = v_prompt.older_claim_id FOR UPDATE;
  -- 两条里有一条已经被改写 / 忘掉 / 取代：这张卡说的那一对已经不存在了
  IF v_newer.revoked_at IS NOT NULL OR v_newer.status = 'superseded' OR v_older.revoked_at IS NOT NULL OR v_older.status = 'superseded'
     OR NOT (v_newer.scope_kind = 'chat_session' AND v_newer.scope_id = v_thread)
     OR NOT ((v_older.scope_kind = 'chat_session' AND v_older.scope_id = v_thread) OR (v_older.scope_kind = 'personal' AND v_older.scope_id = v_user)) THEN
    RAISE EXCEPTION 'KG_PROMPT_NOT_FOUND: the conflicting pair has changed' USING ERRCODE = '23503';
  END IF;

  IF v_res = 'keep_new' THEN
    -- 旧条在长期记忆里（本身在个人空间，或有本人的 L1 副本）⇒ 新条也记进去，长期记忆里留的是新说法。
    v_promote := v_older.scope_kind = 'personal' OR EXISTS (
      SELECT 1 FROM ontology_edges d JOIN claims pc ON pc.id = d.src_id AND pc.org_id = d.org_id
       WHERE d.org_id = v_org AND d.relation = 'derived_from' AND d.status = 'active' AND d.dst_kind = 'claim' AND d.dst_id = v_older.id
         AND pc.scope_kind = 'personal' AND pc.scope_id = v_user AND pc.revoked_at IS NULL);
    UPDATE claims SET status = 'superseded', revoked_at = now(), revocation_reason = 'conflict_keep_new', updated_at = now()
     WHERE org_id = v_org AND id = v_older.id;
    -- supersedes 只在同一作用域里连：会话里的结论不能指着一条别人看不到的个人空间 id。
    UPDATE claims SET status = 'accepted', reviewed_by = v_user, updated_at = now(),
                      supersedes_claim_id = CASE WHEN v_older.scope_kind = 'chat_session' THEN v_older.id ELSE supersedes_claim_id END
     WHERE org_id = v_org AND id = v_newer.id;
    IF v_promote THEN
      v_l1 := kg_promote_claim(jsonb_build_object('action_id', v_id || '-p', 'thread_id', v_thread, 'claim_id', v_newer.id));
      IF v_older.scope_kind = 'personal' THEN
        UPDATE claims SET supersedes_claim_id = v_older.id WHERE org_id = v_org AND id = v_l1 AND id <> v_older.id;
      END IF;
    END IF;
    UPDATE kg_conflict_prompts SET status = 'kept_new', resolved_by = v_user, resolved_at = now() WHERE id = v_prompt.id;

  ELSIF v_res = 'keep_both' THEN
    UPDATE claims SET status = 'accepted', reviewed_by = v_user, updated_at = now()
     WHERE org_id = v_org AND id IN (v_newer.id, v_older.id);
    UPDATE kg_conflict_prompts
       SET status = 'kept_both', resolved_by = v_user, resolved_at = now(),
           newer_condition = nullif(btrim(v_action->'conditions'->>'newer'), ''),
           older_condition = nullif(btrim(v_action->'conditions'->>'older'), '')
     WHERE id = v_prompt.id;

  ELSE
    -- ignore：两条保持冲突；这一对不再提醒（开卡时按 status = ignored 挡住）
    UPDATE kg_conflict_prompts SET status = 'ignored', resolved_by = v_user, resolved_at = now() WHERE id = v_prompt.id;
  END IF;

  v_claims := CASE WHEN v_older.scope_kind = 'chat_session'
                   THEN jsonb_build_array(jsonb_build_object('id', v_newer.id), jsonb_build_object('id', v_older.id))
                   ELSE jsonb_build_array(jsonb_build_object('id', v_newer.id)) END;
  INSERT INTO ontology_actions (id, org_id, scope_kind, scope_id, actor_kind, actor_id, action_type, payload, outcome)
  VALUES (v_id, v_org, 'chat_session', v_thread, 'human', v_user, 'resolveConflict',
          jsonb_build_object('action', v_action, 'claims', v_claims, 'objects', '[]'::jsonb), 'accepted');
  IF v_older.scope_kind = 'personal' AND v_res <> 'ignore' THEN
    INSERT INTO ontology_actions (id, org_id, scope_kind, scope_id, actor_kind, actor_id, action_type, payload, outcome)
    VALUES (v_id || '-l1', v_org, 'personal', v_user, 'human', v_user, 'resolveConflict',
            jsonb_build_object('thread_id', v_thread, 'resolution', v_res, 'claims', jsonb_build_array(jsonb_build_object('id', v_older.id))),
            'accepted');
  END IF;
  RETURN jsonb_build_object('revision', v_rev + 1, 'action_id', v_id);
END
$$;

REVOKE ALL ON FUNCTION kg_conflict_statement_key(text), kg_conflict_source(text, text, text),
  kg_conflict_older_ok(text, text, text, text), kg_conflict_newer_ok(text, text, text, text),
  kg_conflict_candidates(text, text), kg_conflict_about(text, text), kg_open_conflicts(jsonb), kg_resolve_conflict(jsonb) FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_rw') THEN
    GRANT EXECUTE ON FUNCTION kg_conflict_candidates(text, text), kg_open_conflicts(jsonb), kg_resolve_conflict(jsonb) TO app_rw;
  END IF;
END
$$;

-- 停用组织的冻结策略（F22 单一事实源，新租户表建完调用一次）
SELECT kernel_apply_org_freeze_policies();

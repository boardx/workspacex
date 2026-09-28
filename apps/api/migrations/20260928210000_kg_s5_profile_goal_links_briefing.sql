/*
 * issue #4360 / #4362（S5，待人类签核）——「关于我」画像层（目标 → 决定 / 待办）与新会话开场简报。
 *
 * 本迁移做四件事：
 *   1. 结构关系多一个 `serves_goal`（契约 `KgStructuralRelation`，ontology-enum-parity 测试逐项对账）：
 *      个人空间里一条决定 / 待办 → 同一个人的一个目标。两端同属一个人的个人空间，边的作用域也是那个人的个人空间。
 *   2. 三个入口函数（SECURITY DEFINER，每条语句按 org 限定，个人空间一律按 scope_id 限定到一个人）：
 *      - `kg_goal_link_candidates(thread, message)`（系统读）：这条消息刚记进作者本人个人空间、还没挂目标的决定 / 待办，
 *        以及作者本人的目标。作者只由证据消息推出（复用 #4283 的 `kg_auto_copy_author`），不取调用方参数。
 *      - `kg_set_goal_link(p)`：两种身份。
 *          · 系统（没有登录用户）：模型提议且高把握时由抽取任务调用；目标空间只由证据消息的作者决定；
 *            **只在这条从来没挂过目标时挂**（有过挂接——包括本人摘掉过的——一律不动：不覆盖人的选择）。
 *          · 人（app.current_user_id）：只在本人的个人空间里改挂 / 摘掉。
 *      - `kg_revise_personal_claim(p)`（人）：改写本人个人空间的一条：新说法成为「你确认过」的新一条、旧的被它取代
 *        （revocation_reason = user_revised，/brain 折叠「取代了：…」）；来源、实体、挂接（两个方向）都转到新的一条上。
 *        旧的那条置 revoked_at 之后，F07 的触发器（kg_cascade_claim_revocation）把旧条上的边全部失效——所以先复制、后失效。
 *   3. 两张本人私有的表：`kg_briefing_preferences`（关掉简报的偏好）与 `kg_briefing_events`（展示 / 采纳 / 关闭埋点）。
 *      RLS：本组织 且 user_id = app.current_user_id——别人的偏好 / 埋点连存在都看不到。
 *   4. 冻结策略（F22）照例装上。
 *
 * 不做：不改召回、抽取、晋升的任何既有函数；不给 app_rw 任何表的直接写权限（本体表仍只经函数写）。
 */

-- ─────────────────────────────── 1. 关系枚举 ───────────────────────────────
ALTER TABLE ontology_edges DROP CONSTRAINT IF EXISTS ontology_edges_kg_relation_chk;
ALTER TABLE ontology_edges ADD CONSTRAINT ontology_edges_kg_relation_chk
  CHECK (NOT (src_kind IN ('object', 'claim') OR dst_kind IN ('object', 'claim'))
      OR relation IN ('supported_by', 'may_shorten', 'blocks', 'hard_constraint', 'candidate_for',
                      'mentions', 'about', 'derived_from', 'supersedes', 'belongs_to', 'decided_by', 'serves_goal'));

-- ─────────────────────────────── 2a. 挂接候选（系统读） ───────────────────────────────
CREATE OR REPLACE FUNCTION kg_goal_link_candidates(p_thread text, p_message text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_org    text := current_setting('app.current_org', true);
  v_caller text := nullif(current_setting('app.current_user_id', true), '');
  v_author text;
BEGIN
  IF v_org IS NULL OR v_org = '' THEN RAISE EXCEPTION 'KG_NO_TENANT' USING ERRCODE = '42501'; END IF;
  v_author := public.kg_auto_copy_author(v_org, p_thread, p_message);
  IF v_author IS NULL OR (v_caller IS NOT NULL AND v_caller <> v_author) OR NOT public.kg_scope_enabled('personal') THEN
    RETURN jsonb_build_object('author', NULL, 'items', '[]'::jsonb, 'goals', '[]'::jsonb);
  END IF;
  RETURN jsonb_build_object(
    'author', v_author,
    'items', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'statement', p.statement, 'kind', p.claim_kind) ORDER BY p.created_at, p.id), '[]'::jsonb)
                FROM public.claims p
               WHERE p.org_id = v_org AND p.scope_kind = 'personal' AND p.scope_id = v_author
                 AND p.claim_kind IN ('decision', 'todo') AND p.revoked_at IS NULL AND p.status <> 'superseded'
                 -- S6（#4363）× #4494 review B1：过期的、做完 / 不做了的待办不再提议挂目标。
                 AND (p.valid_to IS NULL OR p.valid_to > now()) AND (p.claim_kind <> 'todo' OR p.todo_state = 'open')
                 AND EXISTS (SELECT 1 FROM public.ontology_edges d
                               JOIN public.claims s ON s.id = d.dst_id AND s.org_id = d.org_id
                               JOIN public.claim_message_evidence e ON e.claim_id = s.id AND e.org_id = s.org_id
                              WHERE d.org_id = v_org AND d.src_kind = 'claim' AND d.src_id = p.id AND d.relation = 'derived_from'
                                AND d.dst_kind = 'claim' AND d.status = 'active'
                                AND s.scope_kind = 'chat_session' AND s.scope_id = p_thread
                                AND e.message_id = p_message AND e.stance = 'supporting')
                 AND NOT EXISTS (SELECT 1 FROM public.ontology_edges g
                                  WHERE g.org_id = v_org AND g.src_kind = 'claim' AND g.src_id = p.id AND g.relation = 'serves_goal')),
    'goals', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'statement', x.statement) ORDER BY x.created_at DESC, x.id), '[]'::jsonb)
                FROM (SELECT g.id, g.statement, g.created_at FROM public.claims g
                       WHERE g.org_id = v_org AND g.scope_kind = 'personal' AND g.scope_id = v_author AND g.claim_kind = 'goal'
                         AND g.revoked_at IS NULL AND g.status <> 'superseded'
                         AND (g.valid_to IS NULL OR g.valid_to > now())
                       ORDER BY g.created_at DESC, g.id LIMIT 20) x));
END
$$;

-- ─────────────────────────────── 2b. 挂接 / 改挂 / 摘掉 ───────────────────────────────
-- p: { action_id, claim_id, goal_claim_id | null, confidence?, thread_id?, message_id? }。
-- 系统身份必须带 thread_id + message_id（作者由证据消息推出）；人身份只看 app.current_user_id。
-- 返回 { claim_id, goal_claim_id, outcome: linked | unlinked | unchanged }。
CREATE OR REPLACE FUNCTION kg_set_goal_link(p jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_org    text := current_setting('app.current_org', true);
  v_user   text := nullif(current_setting('app.current_user_id', true), '');
  v_id     text := p->>'action_id';
  v_claim  text := p->>'claim_id';
  v_goal   text := nullif(p->>'goal_claim_id', '');
  v_owner  text;
  v_actor  text;
  v_by     text;
  v_child  record;
  v_now    text;
BEGIN
  IF v_org IS NULL OR v_org = '' THEN RAISE EXCEPTION 'KG_NO_TENANT' USING ERRCODE = '42501'; END IF;
  IF NOT public.kernel_org_is_writable(v_org) THEN
    RAISE EXCEPTION 'KG_ORG_FROZEN: organization % is read-only', v_org USING ERRCODE = '42501';
  END IF;
  IF NOT public.kg_scope_enabled('personal') THEN
    RAISE EXCEPTION 'KG_SCOPE_NOT_ENABLED: personal' USING ERRCODE = '42501';
  END IF;
  IF v_user IS NULL THEN
    -- 系统：作者由证据消息推出；系统从不摘掉挂接。
    IF v_goal IS NULL THEN RAISE EXCEPTION 'KG_INVALID_ACTION: the system never unlinks' USING ERRCODE = '22023'; END IF;
    v_owner := public.kg_auto_copy_author(v_org, p->>'thread_id', p->>'message_id');
    IF v_owner IS NULL THEN
      RAISE EXCEPTION 'KG_NOT_AUTHOR: message is not a member''s own statement in this thread' USING ERRCODE = '42501';
    END IF;
    v_actor := 'system';
    v_by := 'model';
  ELSE
    v_owner := v_user;
    v_actor := 'human';
    v_by := 'human';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('kg_scope:' || v_org || '|personal|' || v_owner));
  SELECT * INTO v_child FROM claims c
   WHERE c.org_id = v_org AND c.id = v_claim AND c.scope_kind = 'personal' AND c.scope_id = v_owner
     AND c.claim_kind IN ('decision', 'todo') AND c.revoked_at IS NULL AND c.status <> 'superseded'
   FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'KG_CLAIM_NOT_FOUND' USING ERRCODE = '23503'; END IF;
  IF v_goal IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM claims g WHERE g.org_id = v_org AND g.id = v_goal AND g.scope_kind = 'personal' AND g.scope_id = v_owner
      AND g.claim_kind = 'goal' AND g.revoked_at IS NULL AND g.status <> 'superseded'
      -- S6 × #4494 review B1：过期的目标不能再挂（系统、人一样）。
      AND (g.valid_to IS NULL OR g.valid_to > now())) THEN
    RAISE EXCEPTION 'KG_CLAIM_NOT_FOUND: goal' USING ERRCODE = '23503';
  END IF;

  IF v_actor = 'system' THEN
    -- 系统只挂从来没挂过的：挂过（不论现在还在不在、是谁挂 / 摘的）⇒ 不动。
    IF EXISTS (SELECT 1 FROM ontology_edges g WHERE g.org_id = v_org AND g.src_kind = 'claim' AND g.src_id = v_claim
                AND g.relation = 'serves_goal') THEN
      SELECT g.dst_id INTO v_now FROM ontology_edges g WHERE g.org_id = v_org AND g.src_kind = 'claim' AND g.src_id = v_claim
         AND g.relation = 'serves_goal' AND g.status = 'active' LIMIT 1;
      RETURN jsonb_build_object('claim_id', v_claim, 'goal_claim_id', v_now, 'outcome', 'unchanged');
    END IF;
    -- 系统挂接还要求这一条确实由这条消息而来（derived_from → 本会话里有这条消息作证据的结论）。
    IF NOT EXISTS (SELECT 1 FROM ontology_edges d
                     JOIN claims s ON s.id = d.dst_id AND s.org_id = d.org_id
                     JOIN claim_message_evidence e ON e.claim_id = s.id AND e.org_id = s.org_id
                    WHERE d.org_id = v_org AND d.src_kind = 'claim' AND d.src_id = v_claim AND d.relation = 'derived_from'
                      AND d.dst_kind = 'claim' AND d.status = 'active'
                      AND s.scope_kind = 'chat_session' AND s.scope_id = p->>'thread_id'
                      AND e.message_id = p->>'message_id' AND e.stance = 'supporting') THEN
      RAISE EXCEPTION 'KG_CLAIM_NOT_FOUND: not from this message' USING ERRCODE = '23503';
    END IF;
  ELSE
    UPDATE ontology_edges SET status = 'invalidated', invalidated_at = now()
     WHERE org_id = v_org AND src_kind = 'claim' AND src_id = v_claim AND relation = 'serves_goal' AND status = 'active';
  END IF;

  IF v_goal IS NOT NULL THEN
    INSERT INTO ontology_edges (id, org_id, src_kind, src_id, dst_kind, dst_id, relation, created_by, scope_kind, scope_id)
    VALUES (v_id || '-g', v_org, 'claim', v_claim, 'claim', v_goal, 'serves_goal', v_by, 'personal', v_owner);
  END IF;

  INSERT INTO ontology_actions (id, org_id, scope_kind, scope_id, actor_kind, actor_id, action_type, payload, outcome)
  VALUES (v_id, v_org, 'personal', v_owner, v_actor, CASE WHEN v_actor = 'human' THEN v_owner ELSE 'kg-goal-link' END, 'setGoalLink',
          jsonb_build_object('confidence', p->'confidence',
                             'claims', jsonb_build_array(jsonb_build_object('id', v_claim))
                                       || CASE WHEN v_goal IS NULL THEN '[]'::jsonb ELSE jsonb_build_array(jsonb_build_object('id', v_goal)) END),
          'accepted');
  RETURN jsonb_build_object('claim_id', v_claim, 'goal_claim_id', v_goal, 'outcome', CASE WHEN v_goal IS NULL THEN 'unlinked' ELSE 'linked' END);
END
$$;

-- ─────────────────────────────── 2c. 改写本人个人空间的一条（人） ───────────────────────────────
-- p: { action_id, claim_id, statement }。返回新一条的 id。
CREATE OR REPLACE FUNCTION kg_revise_personal_claim(p jsonb) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_org    text := current_setting('app.current_org', true);
  v_user   text := nullif(current_setting('app.current_user_id', true), '');
  v_id     text := p->>'action_id';
  v_text   text := btrim(coalesce(p->>'statement', ''));
  v_old    record;
  v_new    text;
BEGIN
  IF v_org IS NULL OR v_org = '' THEN RAISE EXCEPTION 'KG_NO_TENANT' USING ERRCODE = '42501'; END IF;
  IF NOT public.kernel_org_is_writable(v_org) THEN
    RAISE EXCEPTION 'KG_ORG_FROZEN: organization % is read-only', v_org USING ERRCODE = '42501';
  END IF;
  IF v_user IS NULL THEN RAISE EXCEPTION 'KG_ACTOR_NOT_HUMAN: no signed-in user' USING ERRCODE = '42501'; END IF;
  IF v_text = '' OR length(v_text) > 2000 THEN RAISE EXCEPTION 'KG_INVALID_ACTION: statement' USING ERRCODE = '22023'; END IF;

  PERFORM pg_advisory_xact_lock(hashtext('kg_scope:' || v_org || '|personal|' || v_user));
  SELECT * INTO v_old FROM claims c
   WHERE c.org_id = v_org AND c.id = p->>'claim_id' AND c.scope_kind = 'personal' AND c.scope_id = v_user
     AND c.revoked_at IS NULL AND c.status <> 'superseded'
   FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'KG_CLAIM_NOT_FOUND' USING ERRCODE = '23503'; END IF;
  IF v_old.status = 'contested' THEN
    RAISE EXCEPTION 'KG_CONTESTED_NEEDS_RESOLUTION: resolve the conflict before revising' USING ERRCODE = '23514';
  END IF;

  v_new := v_id || '-c';
  INSERT INTO claims (id, org_id, statement, status, tsv, claim_kind, confidence, created_by, reviewed_by,
                      supersedes_claim_id, scope_kind, scope_id, valid_from)
  VALUES (v_new, v_org, v_text, 'accepted', to_tsvector('simple', v_text), v_old.claim_kind, 1, 'human', v_user,
          v_old.id, 'personal', v_user, now());
  -- 改的是说法，不是出处：证据原样挂到新的一条上（I-5）。
  INSERT INTO claim_message_evidence (claim_id, org_id, message_id, stance, excerpt)
    SELECT v_new, org_id, message_id, stance, excerpt FROM claim_message_evidence WHERE org_id = v_org AND claim_id = v_old.id
  ON CONFLICT DO NOTHING;
  INSERT INTO claim_segments (claim_id, org_id, segment_id, stance)
    SELECT v_new, org_id, segment_id, stance FROM claim_segments WHERE org_id = v_org AND claim_id = v_old.id
  ON CONFLICT DO NOTHING;
  -- 出边（来源 derived_from、实体 about / decided_by、挂在哪个目标 serves_goal）原样复制到新的一条。
  INSERT INTO ontology_edges (id, org_id, src_kind, src_id, dst_kind, dst_id, relation, created_by, scope_kind, scope_id)
    SELECT v_new || '-' || e.id, e.org_id, 'claim', v_new, e.dst_kind, e.dst_id, e.relation, e.created_by, 'personal', v_user
      FROM ontology_edges e
     WHERE e.org_id = v_org AND e.src_kind = 'claim' AND e.src_id = v_old.id AND e.status = 'active';
  -- S6（#4363）× #4494 review M1：上面复制 derived_from 会触发 kg_copy_inherits_time，把新一条的 todo_state 覆盖成来源
  -- （会话里那条）的状态——本人在个人空间标了「做完了」、会话那条还是 open 时，改个说法就把它变回 open。
  -- 改写只改说法：状态以旧的那条为准（kg_revise_inherits_time 插入时已抄过一次，这里在复制边之后再定一次）。
  UPDATE claims SET todo_state = v_old.todo_state, updated_at = now()
   WHERE org_id = v_org AND id = v_new AND claim_kind = 'todo' AND v_old.claim_kind = 'todo'
     AND todo_state IS DISTINCT FROM v_old.todo_state;
  -- 入边里的挂接（别的决定 / 待办挂在这个目标下）转到新的一条：改一个目标，它下面的跟着走。
  INSERT INTO ontology_edges (id, org_id, src_kind, src_id, dst_kind, dst_id, relation, created_by, scope_kind, scope_id)
    SELECT v_new || '-in-' || e.id, e.org_id, e.src_kind, e.src_id, 'claim', v_new, e.relation, e.created_by, 'personal', v_user
      FROM ontology_edges e
     WHERE e.org_id = v_org AND e.dst_kind = 'claim' AND e.dst_id = v_old.id AND e.relation = 'serves_goal' AND e.status = 'active'
       AND e.scope_kind = 'personal' AND e.scope_id = v_user;
  -- 旧的那条被新的取代。置 revoked_at ⇒ F07 触发器把旧条上的边全部失效（上面已复制到新的一条）。
  UPDATE claims SET status = 'superseded', revoked_at = now(), revocation_reason = 'user_revised', updated_at = now()
   WHERE org_id = v_org AND id = v_old.id;
  INSERT INTO ontology_edges (id, org_id, src_kind, src_id, dst_kind, dst_id, relation, created_by, scope_kind, scope_id)
  VALUES (v_new || '-s', v_org, 'claim', v_new, 'claim', v_old.id, 'supersedes', 'human', 'personal', v_user);

  INSERT INTO ontology_actions (id, org_id, scope_kind, scope_id, actor_kind, actor_id, action_type, payload, outcome)
  VALUES (v_id, v_org, 'personal', v_user, 'human', v_user, 'revisePersonalClaim',
          jsonb_build_object('claims', jsonb_build_array(jsonb_build_object('id', v_old.id), jsonb_build_object('id', v_new))),
          'accepted');
  RETURN v_new;
END
$$;

REVOKE ALL ON FUNCTION kg_goal_link_candidates(text, text), kg_set_goal_link(jsonb), kg_revise_personal_claim(jsonb) FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_rw') THEN
    GRANT EXECUTE ON FUNCTION kg_goal_link_candidates(text, text), kg_set_goal_link(jsonb), kg_revise_personal_claim(jsonb) TO app_rw;
  END IF;
END
$$;

-- ─────────────────────────────── 3. 简报偏好与埋点（本人私有） ───────────────────────────────
CREATE TABLE IF NOT EXISTS kg_briefing_preferences (
  org_id     text NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  user_id    text NOT NULL,
  dismissed  boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, user_id)
);

CREATE TABLE IF NOT EXISTS kg_briefing_events (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  org_id     text NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  user_id    text NOT NULL,
  event      text NOT NULL CHECK (event IN ('shown', 'accepted', 'dismissed')),
  -- 简报条目 id（`<section>:<id>`），不存正文
  item_ids   jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(item_ids) = 'array' AND jsonb_array_length(item_ids) <= 6),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS kg_briefing_events_user_idx ON kg_briefing_events (org_id, user_id, created_at);

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['kg_briefing_preferences', 'kg_briefing_events']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_own', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I USING (org_id = current_setting(''app.current_org'', true) AND user_id = current_setting(''app.current_user_id'', true)) '
      'WITH CHECK (org_id = current_setting(''app.current_org'', true) AND user_id = current_setting(''app.current_user_id'', true))',
      t || '_own', t);
  END LOOP;
END
$$;
REVOKE ALL ON kg_briefing_preferences, kg_briefing_events FROM app_rw;
GRANT SELECT, INSERT, UPDATE ON kg_briefing_preferences TO app_rw;
GRANT SELECT, INSERT ON kg_briefing_events TO app_rw;

-- F22 组织冻结：新租户表在本迁移里装上冻结策略。
SELECT kernel_apply_org_freeze_policies();

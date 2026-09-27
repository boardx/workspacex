/*
 * S7（#4364）—— 回答下的引用 chip 上当场纠正：「这条不对」/「已过时」，并记下纠正事件（纠正率 = 纠正 / 被引用）。
 *
 * ① kg_citation_corrections：每一次纠正一行（谁、哪条回答、哪一条引用、哪种纠正）。纠正率的分子；分母（被引用次数）
 *    由应用层按同一个对账判据从 kg_turn_recalls + 回答正文复算（apps/api/src/domain/knowledge-graph/citation.ts），不另存一份。
 *    只给本人读写（RLS：本组织 + user_id = app.current_user_id）。
 *
 * ② kg_correct_citation(p)：执行一次纠正。复核全在这里（不信调用方）：
 *    - 执行身份是登录的人（app.current_user_id），且是这条对话的所有者（KG_NOT_OWNER）；
 *    - 这条回答属于这条对话，且这一轮的提问人就是他（kg_turn_recalls.requester_user_id）——否则同一个 KG_CLAIM_NOT_FOUND；
 *    - 这条结论在**这一轮的召回集合**里（kg_turn_recalls.items）：召回集合之外的 id 一律 KG_CLAIM_NOT_FOUND
 *      （「模型编不出 chip」在写侧也成立；是否真被回答用到由应用层按对账判据先核过）；
 *    - 结论仍然有效，且在他能管的地方：本对话的、他本人个人空间的、或他本人另一个个人对话里的（F15 跨会话召回来的）。
 *    动作落在「一家」上（review F1）：被点的那条 + 沿活的 derived_from 边（两个方向、传递）连着的、本人能管的活结论
 *    （会话里的原说法 ⇄ 它记进本人长期记忆的副本）。只动一条的话，另一份下一轮照样被召回。
 *    - wrong 且没给新说法 ⇒ 整家忘掉（status superseded + revoked_at，revocation_reason = user_citation_wrong）；
 *    - wrong 且给了新说法 ⇒ 取代：新说法只落一份——家里有本人长期记忆那份就落个人空间，否则落被点那条的作用域；
 *      supersedes 连同作用域那条（anchor，同 reviseClaim 转 superseded），家里其余的撤掉。
 *      不带 derived_from 边（review F2）；证据**保留**（去重后挂上，理由见函数内注释）；
 *    - expired ⇒ 已过时。TODO(#4363)：S6 落地后改成 valid_to = now()；在那之前整家按撤回执行
 *      （revocation_reason = user_citation_expired），应用层的 `expireClaim` 端口就是替换点。
 *    项目记忆（L2）不在「一家」里：那是全体成员的，不由一个人在对话的引用上改。
 *    每个被动到的作用域各留一条 ontology_actions 审计，并写一行 kg_citation_corrections。
 */
CREATE TABLE IF NOT EXISTS kg_citation_corrections (
  id            text PRIMARY KEY,
  org_id        text NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  user_id       text NOT NULL,
  thread_id     text NOT NULL,
  message_id    text NOT NULL,
  claim_id      text NOT NULL,
  kind          text NOT NULL CHECK (kind IN ('wrong', 'expired')),
  -- wrong 且给了新说法：取代它的那条新结论
  replaced_by   text,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS kg_citation_corrections_user_idx ON kg_citation_corrections (org_id, user_id, created_at);

ALTER TABLE kg_citation_corrections ENABLE ROW LEVEL SECURITY;
ALTER TABLE kg_citation_corrections FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS kg_citation_corrections_owner ON kg_citation_corrections;
CREATE POLICY kg_citation_corrections_owner ON kg_citation_corrections
  USING (org_id = current_setting('app.current_org', true) AND user_id = current_setting('app.current_user_id', true))
  WITH CHECK (org_id = current_setting('app.current_org', true) AND user_id = current_setting('app.current_user_id', true));
REVOKE ALL ON kg_citation_corrections FROM app_rw;
GRANT SELECT ON kg_citation_corrections TO app_rw;

-- p = { action_id, thread_id, message_id, claim_id, kind: wrong|expired, replacement? }
-- 返回 { outcome: forgotten | superseded | expired, new_claim_id }
CREATE OR REPLACE FUNCTION kg_correct_citation(p jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_org     text := current_setting('app.current_org', true);
  v_user    text := current_setting('app.current_user_id', true);
  v_id      text := p->>'action_id';
  v_thread  text := p->>'thread_id';
  v_message text := p->>'message_id';
  v_claim   text := p->>'claim_id';
  v_kind    text := p->>'kind';
  v_repl    text := nullif(btrim(coalesce(p->>'replacement', '')), '');
  v_items   jsonb;
  v_c       record;
  v_new     text;
  v_outcome text;
  v_anchor  record;
  v_akind   text;
  v_ascope  text;
  v_s       record;
  v_n       int;
BEGIN
  IF v_org IS NULL OR v_org = '' THEN RAISE EXCEPTION 'KG_NO_TENANT' USING ERRCODE = '42501'; END IF;
  IF NOT public.kernel_org_is_writable(v_org) THEN
    RAISE EXCEPTION 'KG_ORG_FROZEN: organization % is read-only', v_org USING ERRCODE = '42501';
  END IF;
  IF v_user IS NULL OR v_user = '' THEN RAISE EXCEPTION 'KG_ACTOR_NOT_HUMAN: no signed-in user' USING ERRCODE = '42501'; END IF;
  IF v_kind IS NULL OR v_kind NOT IN ('wrong', 'expired') OR (v_kind = 'expired' AND v_repl IS NOT NULL)
     OR length(coalesce(v_repl, '')) > 2000 OR v_id IS NULL OR v_id = '' THEN
    RAISE EXCEPTION 'KG_INVALID_REQUEST: correction %', v_kind USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM chat_threads t WHERE t.org_id = v_org AND t.id = v_thread AND t.created_by = v_user) THEN
    RAISE EXCEPTION 'KG_NOT_OWNER: only the thread owner corrects its citations' USING ERRCODE = '42501';
  END IF;

  -- 这一轮：这条回答（本对话里的）所属 run 的召回记录，提问人必须是他本人。
  SELECT r.items INTO v_items FROM kg_turn_recalls r
    JOIN chat_messages m ON m.org_id = r.org_id AND m.agent_run_id = r.run_id
   WHERE m.org_id = v_org AND m.thread_id = v_thread AND m.id = v_message AND r.thread_id = v_thread
     AND r.requester_user_id = v_user;
  IF v_items IS NULL OR NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_items) i WHERE i->>'claimId' = v_claim) THEN
    RAISE EXCEPTION 'KG_CLAIM_NOT_FOUND: not a citation of this turn' USING ERRCODE = '23503';
  END IF;

  SELECT c.* INTO v_c FROM claims c WHERE c.org_id = v_org AND c.id = v_claim;
  IF NOT FOUND OR v_c.revoked_at IS NOT NULL OR v_c.status = 'superseded'
     OR NOT ((v_c.scope_kind = 'chat_session' AND v_c.scope_id = v_thread)
          OR (v_c.scope_kind = 'personal' AND v_c.scope_id = v_user)
          OR (v_c.scope_kind = 'chat_session' AND EXISTS (
                SELECT 1 FROM chat_threads t WHERE t.org_id = v_org AND t.id = v_c.scope_id
                   AND t.project_id IS NULL AND t.created_by = v_user AND NOT t.archived))) THEN
    RAISE EXCEPTION 'KG_CLAIM_NOT_FOUND: claim % is gone or not yours', v_claim USING ERRCODE = '23503';
  END IF;

  -- 「一家」：沿**活的** derived_from 边（两个方向、传递）连在一起的活结论——会话里的原说法和它记进本人长期记忆的副本
  -- （#4283 自动记入 / F11 晋升）。纠正要落在整家上：只动被点的那一条，另一份还活着，下一轮照样被召回（review F1）。
  -- 只收本人能管的：本对话的、本人个人空间的、本人其他个人对话的；项目记忆（L2）不在此列——那是全体成员的，不由一个人在这里改。
  CREATE TEMP TABLE IF NOT EXISTS kg_s7_family (id text PRIMARY KEY, scope_kind text, scope_id text) ON COMMIT DROP;
  TRUNCATE kg_s7_family;
  INSERT INTO kg_s7_family (id, scope_kind, scope_id)
  WITH RECURSIVE fam(id) AS (
    SELECT v_c.id
    UNION
    SELECT CASE WHEN d.src_id = fam.id THEN d.dst_id ELSE d.src_id END
      FROM fam JOIN ontology_edges d
        ON d.org_id = v_org AND d.relation = 'derived_from' AND d.status = 'active'
       AND d.src_kind = 'claim' AND d.dst_kind = 'claim' AND (d.src_id = fam.id OR d.dst_id = fam.id)
  )
  SELECT c.id, c.scope_kind, c.scope_id FROM fam JOIN claims c ON c.org_id = v_org AND c.id = fam.id
   WHERE c.revoked_at IS NULL AND c.status <> 'superseded'
     AND ((c.scope_kind = 'chat_session' AND c.scope_id = v_thread)
       OR (c.scope_kind = 'personal' AND c.scope_id = v_user)
       OR (c.scope_kind = 'chat_session' AND EXISTS (
             SELECT 1 FROM chat_threads t WHERE t.org_id = v_org AND t.id = c.scope_id
                AND t.project_id IS NULL AND t.created_by = v_user AND NOT t.archived)));

  -- 锁这一家涉及的作用域（同 F10 / F17 的作用域锁，先会话、后个人空间，同一顺序防死锁），再锁行、再核一遍。
  PERFORM pg_advisory_xact_lock(hashtext('kg_scope:' || v_org || '|' || s.scope_kind || '|' || s.scope_id))
     FROM (SELECT DISTINCT scope_kind = 'personal' AS is_personal, scope_kind, scope_id FROM kg_s7_family ORDER BY 1, 3) s;
  PERFORM 1 FROM claims c WHERE c.org_id = v_org AND c.id IN (SELECT id FROM kg_s7_family) ORDER BY c.id FOR UPDATE;
  SELECT c.* INTO v_c FROM claims c WHERE c.org_id = v_org AND c.id = v_claim;
  IF v_c.revoked_at IS NOT NULL OR v_c.status = 'superseded' THEN
    RAISE EXCEPTION 'KG_CLAIM_NOT_FOUND: claim % changed meanwhile', v_claim USING ERRCODE = '23503';
  END IF;
  DELETE FROM kg_s7_family f USING claims c
   WHERE c.org_id = v_org AND c.id = f.id AND (c.revoked_at IS NOT NULL OR c.status = 'superseded');

  IF v_kind = 'wrong' AND v_repl IS NOT NULL THEN
    -- 新说法只落一份，落在这一家「最高」的作用域：家里有本人长期记忆那份 ⇒ 落个人空间（跨对话照样召回，
    -- 本对话也召回它），否则落在被点那条所在的作用域。supersedes 只在同一作用域里连（同 #4290 keep_new）。
    SELECT c.* INTO v_anchor FROM claims c JOIN kg_s7_family f ON f.id = c.id
     WHERE c.org_id = v_org ORDER BY (c.scope_kind = 'personal') DESC, (c.id = v_c.id) DESC, c.id LIMIT 1;
    v_new := v_id || '-c';
    v_akind := v_anchor.scope_kind;
    v_ascope := v_anchor.scope_id;
    -- TODO(#4363)：S6 落地后这里一并带上 valid_to / due_at / todo_status（review F4）。
    INSERT INTO claims (id, org_id, statement, status, tsv, claim_kind, confidence, created_by, reviewed_by,
                        supersedes_claim_id, scope_kind, scope_id, valid_from)
    VALUES (v_new, v_org, v_repl, 'accepted', to_tsvector('simple', v_repl), v_anchor.claim_kind, 1, 'human', v_user,
            v_anchor.id, v_anchor.scope_kind, v_anchor.scope_id, now());
    -- 出处（review F2，决定）：**保留**——这一家各条的证据消息去重后挂到新说法上。
    --   理由：① 改的是说法，出处仍是那次对话（同 F10 reviseClaim 的 I-5）；② 个人空间的结论只能经证据消息所在的对话
    --   打开来源抽屉 / 跳回原消息（getClaimSources 的个人空间分支），不带证据新说法就成了一条点不开的引用；
    --   ③ 「这是人改过的」由审计（ontology_actions，via = citation，带新旧两条 id）记着，不靠证据表表达。
    INSERT INTO claim_message_evidence (claim_id, org_id, message_id, stance, excerpt)
      SELECT DISTINCT ON (e.message_id, e.stance) v_new, e.org_id, e.message_id, e.stance, e.excerpt
        FROM claim_message_evidence e WHERE e.org_id = v_org AND e.claim_id IN (SELECT id FROM kg_s7_family)
       ORDER BY e.message_id, e.stance, e.claim_id;
    INSERT INTO claim_segments (claim_id, org_id, segment_id, stance)
      SELECT DISTINCT v_new, s.org_id, s.segment_id, s.stance FROM claim_segments s
       WHERE s.org_id = v_org AND s.claim_id IN (SELECT id FROM kg_s7_family);
    -- 边：只带新说法所在作用域那一条（anchor）的，**不带 derived_from**（review F2）：新说法不是从旧说法「记过来」的；
    -- 带过去的话，原对话里那条旧说法一撤，F07 会把新说法也一起收掉。
    INSERT INTO ontology_edges (id, org_id, src_kind, src_id, dst_kind, dst_id, relation, created_by, scope_kind, scope_id)
      SELECT v_new || '-' || e.id, e.org_id, 'claim', v_new, e.dst_kind, e.dst_id, e.relation, 'human', v_anchor.scope_kind, v_anchor.scope_id
        FROM ontology_edges e WHERE e.org_id = v_org AND e.src_kind = 'claim' AND e.src_id = v_anchor.id AND e.status = 'active'
         AND e.relation <> 'derived_from';
    -- anchor 同 reviseClaim：转 superseded（留在取代历史里）；家里其余的撤掉（F07 级联收掉它们的边）。
    UPDATE claims SET status = 'superseded', updated_at = now() WHERE org_id = v_org AND id = v_anchor.id;
    UPDATE claims SET status = 'superseded', revoked_at = now(), revocation_reason = 'user_citation_wrong', updated_at = now()
     WHERE org_id = v_org AND id IN (SELECT id FROM kg_s7_family) AND id <> v_anchor.id;
    v_outcome := 'superseded';
  ELSE
    -- TODO(#4363)：S6 落地后「已过时」改成 valid_to = now()（不撤）；在那之前按撤回执行。整家一起。
    UPDATE claims SET status = 'superseded', revoked_at = now(),
                      revocation_reason = CASE WHEN v_kind = 'expired' THEN 'user_citation_expired' ELSE 'user_citation_wrong' END,
                      updated_at = now()
     WHERE org_id = v_org AND id IN (SELECT id FROM kg_s7_family);
    v_outcome := CASE WHEN v_kind = 'expired' THEN 'expired' ELSE 'forgotten' END;
  END IF;

  -- 审计：每个被动到的作用域各一条（会话的审计不带个人空间的 id，个人空间那条记在个人空间，同 F17）。
  v_n := 0;
  FOR v_s IN SELECT DISTINCT scope_kind = 'personal' AS is_personal, scope_kind, scope_id FROM kg_s7_family ORDER BY 1, 3 LOOP
    INSERT INTO ontology_actions (id, org_id, scope_kind, scope_id, actor_kind, actor_id, action_type, payload, source_ref, outcome)
    VALUES (CASE WHEN v_n = 0 THEN v_id ELSE v_id || '-' || v_n END, v_org, v_s.scope_kind, v_s.scope_id, 'human', v_user,
            CASE WHEN v_outcome = 'superseded' THEN 'reviseClaim' ELSE 'revokeClaim' END,
            jsonb_build_object('via', 'citation', 'correction', v_kind,
                               'thread_id', CASE WHEN v_s.scope_kind = 'chat_session' AND v_s.scope_id = v_thread THEN v_thread END,
                               'message_id', CASE WHEN v_s.scope_kind = 'chat_session' AND v_s.scope_id = v_thread THEN v_message END,
                               'objects', '[]'::jsonb,
                               'claims', (SELECT jsonb_agg(jsonb_build_object('id', x.id) ORDER BY x.id) FROM (
                                           SELECT f.id FROM kg_s7_family f WHERE f.scope_kind = v_s.scope_kind AND f.scope_id = v_s.scope_id
                                           UNION ALL
                                           SELECT v_new WHERE v_new IS NOT NULL AND v_akind = v_s.scope_kind AND v_ascope = v_s.scope_id) x)),
            v_message, 'accepted');
    v_n := v_n + 1;
  END LOOP;

  INSERT INTO kg_citation_corrections (id, org_id, user_id, thread_id, message_id, claim_id, kind, replaced_by)
  VALUES (v_id, v_org, v_user, v_thread, v_message, v_c.id, v_kind, v_new);

  RETURN jsonb_build_object('outcome', v_outcome, 'new_claim_id', v_new);
END
$$;

REVOKE ALL ON FUNCTION kg_correct_citation(jsonb) FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_rw') THEN
    GRANT EXECUTE ON FUNCTION kg_correct_citation(jsonb) TO app_rw;
  END IF;
END
$$;

-- 停用组织的冻结策略（F22 单一事实源，新租户表建完调用一次）
SELECT kernel_apply_org_freeze_policies();

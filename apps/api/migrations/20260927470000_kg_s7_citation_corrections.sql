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
 *    动作：
 *    - wrong 且没给新说法 ⇒ 忘掉：与 F17 忘掉卡同一种失效（status superseded + revoked_at，F07 级联把边与派生副本一起收掉），
 *      revocation_reason = user_citation_wrong；
 *    - wrong 且给了新说法 ⇒ 取代：同 F10 reviseClaim 的做法（新结论 supersedes 旧的、证据与边原样挂过去、旧的转 superseded），
 *      在旧结论所在的作用域里写；
 *    - expired ⇒ 已过时。TODO(#4363)：S6 给 claims 加 valid_until 之后改成 valid_until = now()；在那之前按撤回执行
 *      （revocation_reason = user_citation_expired），应用层的 `expireClaim` 端口就是替换点。
 *    每次都在结论所在作用域留一条 ontology_actions 审计，并写一行 kg_citation_corrections。
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

  -- 锁这条结论所在的作用域（同 F10 / F17 的作用域锁），再锁行、再核一遍（期间被别处改过 ⇒ 不在了）。
  PERFORM pg_advisory_xact_lock(hashtext('kg_scope:' || v_org || '|' || v_c.scope_kind || '|' || v_c.scope_id));
  SELECT c.* INTO v_c FROM claims c WHERE c.org_id = v_org AND c.id = v_claim FOR UPDATE;
  IF v_c.revoked_at IS NOT NULL OR v_c.status = 'superseded' THEN
    RAISE EXCEPTION 'KG_CLAIM_NOT_FOUND: claim % changed meanwhile', v_claim USING ERRCODE = '23503';
  END IF;

  IF v_kind = 'wrong' AND v_repl IS NOT NULL THEN
    v_new := v_id || '-c';
    INSERT INTO claims (id, org_id, statement, status, tsv, claim_kind, confidence, created_by, reviewed_by,
                        supersedes_claim_id, scope_kind, scope_id, valid_from)
    VALUES (v_new, v_org, v_repl, 'accepted', to_tsvector('simple', v_repl), v_c.claim_kind, 1, 'human', v_user,
            v_c.id, v_c.scope_kind, v_c.scope_id, now());
    -- 改的是说法，不是出处：原来的证据原样挂到新结论上（同 reviseClaim，I-5）。
    INSERT INTO claim_message_evidence (claim_id, org_id, message_id, stance, excerpt)
      SELECT v_new, org_id, message_id, stance, excerpt FROM claim_message_evidence WHERE org_id = v_org AND claim_id = v_c.id;
    INSERT INTO claim_segments (claim_id, org_id, segment_id, stance)
      SELECT v_new, org_id, segment_id, stance FROM claim_segments WHERE org_id = v_org AND claim_id = v_c.id;
    INSERT INTO ontology_edges (id, org_id, src_kind, src_id, dst_kind, dst_id, relation, created_by, scope_kind, scope_id)
      SELECT v_new || '-' || e.id, e.org_id, 'claim', v_new, e.dst_kind, e.dst_id, e.relation, 'human', v_c.scope_kind, v_c.scope_id
        FROM ontology_edges e WHERE e.org_id = v_org AND e.src_kind = 'claim' AND e.src_id = v_c.id AND e.status = 'active'
         -- 个人空间那条的 derived_from 指向原对话里的旧说法：新说法不是从旧说法「记过来」的，不带过去
         --（带过去的话，原对话里那条旧说法一撤，F07 会把新说法也一起收掉）。
         AND e.relation <> 'derived_from';
    UPDATE claims SET status = 'superseded', updated_at = now() WHERE org_id = v_org AND id = v_c.id;
    v_outcome := 'superseded';
  ELSE
    UPDATE claims SET status = 'superseded', revoked_at = now(),
                      revocation_reason = CASE WHEN v_kind = 'expired' THEN 'user_citation_expired' ELSE 'user_citation_wrong' END,
                      updated_at = now()
     WHERE org_id = v_org AND id = v_c.id;
    v_outcome := CASE WHEN v_kind = 'expired' THEN 'expired' ELSE 'forgotten' END;
  END IF;

  INSERT INTO ontology_actions (id, org_id, scope_kind, scope_id, actor_kind, actor_id, action_type, payload, source_ref, outcome)
  VALUES (v_id, v_org, v_c.scope_kind, v_c.scope_id, 'human', v_user,
          CASE WHEN v_outcome = 'superseded' THEN 'reviseClaim' ELSE 'revokeClaim' END,
          jsonb_build_object('via', 'citation', 'correction', v_kind, 'thread_id', v_thread, 'message_id', v_message,
                             'objects', '[]'::jsonb,
                             'claims', CASE WHEN v_new IS NULL THEN jsonb_build_array(jsonb_build_object('id', v_c.id))
                                            ELSE jsonb_build_array(jsonb_build_object('id', v_c.id), jsonb_build_object('id', v_new)) END),
          v_message, 'accepted');

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

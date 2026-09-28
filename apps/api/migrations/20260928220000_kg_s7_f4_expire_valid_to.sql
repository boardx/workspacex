/*
 * S7 follow-up（F4，review of #4490；#4364 / #4363）——「已过时」改为有效期到期，不再撤回。
 *
 * 20260928190000 的 kg_correct_citation 在 S6 之前把「已过时」按撤回执行（revocation_reason = user_citation_expired），
 * 留了 TODO(#4363)。S6（20260928170000，#4492）已在 main：`claims.valid_to` 就是有效期（契约 validUntil，左闭右开），
 * 「过期了没有」只在应用层 claimExpired 一处判（召回排除、面板 / 大脑页标「已过期」）。本迁移只重建这一个函数：
 *   - 「已过时」⇒ 被点那条的整家（同「这条不对」的那一家：沿活的 derived_from、只走本人能改的）valid_to = now()，不撤、不动边；
 *     已经过期的再点 ⇒ KG_CLAIM_NOT_FOUND（不重复记纠正事件）；审计 action_type = expireClaim。
 *   - 「这条不对」+ 新说法：新行的 valid_to / due_at / todo_state 由 S6 的 kg_revise_inherits_time_trg 从 anchor 照抄
 *     （新行带 supersedes_claim_id、自己没写时间字段），这里不另写一份。
 *   - 「已过时」也让 S10 分享到项目的副本一起到期（同 kg_cascade_personal_share 的判据；人类决定 2026-09-28）；
 *     有效期窗口还没开始的，窗口起点收到此刻之前（否则到期不了）；审计只列这一次真的到期的。
 *   - 其余逐字同 20260928190000。
 * 20260928190000 里还留着 TODO(#4363) 注释：那份文件**一个字节都不能改**——已执行过的迁移文件的 sha256 要与
 * `_kernel_migrations.checksum` 一致（apps/api/scripts/data-readiness.ts 核对，云上 provision 的就绪检查跑它；改了就永远
 * 「schema not current」）。那几处 TODO 说的事就在本文件做完了，以本文件为准。纠正事件表 kg_citation_corrections 不变。
 */
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
  v_family  text[];
  v_touched text[];
  v_shared  text[];
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
  -- 只经过、只收本人能管的结论（review L1：递归本身就只走这些节点，不是走完再筛）：本对话的、本人个人空间的、
  -- 本人其他个人对话的。项目 / 组织记忆（L2 / L3）与别人的结论既不收，也不从它们那里继续走——那不是一个人在这里能改的。
  -- 放在数组变量里，**不用临时表**（delta review D1：SECURITY DEFINER 里的 TEMP 表可以被调用方预先建一张同名的顶替）。
  WITH RECURSIVE fam(id) AS (
    SELECT v_c.id
    UNION
    SELECT c.id
      FROM fam
      JOIN ontology_edges d
        ON d.org_id = v_org AND d.relation = 'derived_from' AND d.status = 'active'
       AND d.src_kind = 'claim' AND d.dst_kind = 'claim' AND (d.src_id = fam.id OR d.dst_id = fam.id)
      JOIN claims c ON c.org_id = v_org AND c.id = CASE WHEN d.src_id = fam.id THEN d.dst_id ELSE d.src_id END
     WHERE c.revoked_at IS NULL AND c.status <> 'superseded'
       AND ((c.scope_kind = 'chat_session' AND c.scope_id = v_thread)
         OR (c.scope_kind = 'personal' AND c.scope_id = v_user)
         OR (c.scope_kind = 'chat_session' AND EXISTS (
               SELECT 1 FROM chat_threads t WHERE t.org_id = v_org AND t.id = c.scope_id
                  AND t.project_id IS NULL AND t.created_by = v_user AND NOT t.archived)))
  )
  SELECT array_agg(id ORDER BY id) INTO v_family FROM fam;

  -- 锁这一家涉及的作用域（同 F10 / F17 的作用域锁，先会话、后个人空间，同一顺序防死锁），再锁行、再核一遍。
  PERFORM pg_advisory_xact_lock(hashtext('kg_scope:' || v_org || '|' || s.scope_kind || '|' || s.scope_id))
     FROM (SELECT DISTINCT c.scope_kind = 'personal' AS is_personal, c.scope_kind, c.scope_id
             FROM claims c WHERE c.org_id = v_org AND c.id = ANY(v_family) ORDER BY 1, 3) s;
  PERFORM 1 FROM claims c WHERE c.org_id = v_org AND c.id = ANY(v_family) ORDER BY c.id FOR UPDATE;
  SELECT c.* INTO v_c FROM claims c WHERE c.org_id = v_org AND c.id = v_claim;
  IF v_c.revoked_at IS NOT NULL OR v_c.status = 'superseded' THEN
    RAISE EXCEPTION 'KG_CLAIM_NOT_FOUND: claim % changed meanwhile', v_claim USING ERRCODE = '23503';
  END IF;
  SELECT array_agg(c.id ORDER BY c.id) INTO v_family FROM claims c
   WHERE c.org_id = v_org AND c.id = ANY(v_family) AND c.revoked_at IS NULL AND c.status <> 'superseded';

  -- review L4：「这条不对」时先把家里彼此之间的 derived_from 边收掉，再动结论。否则撤掉会话那条时 F07 级联会顺着这条边
  -- 把留在取代历史里的 anchor（个人空间那份，只该是 superseded）也一起撤掉。家外的边不动。
  -- 「已过时」不动边：这一家仍是这一家（原说法与它的副本），只是都到期了（#4363 的有效期，不是撤回）。
  IF v_kind = 'wrong' THEN
    UPDATE ontology_edges d SET status = 'invalidated', invalidated_at = now()
     WHERE d.org_id = v_org AND d.relation = 'derived_from' AND d.status = 'active'
       AND d.src_kind = 'claim' AND d.dst_kind = 'claim' AND d.src_id = ANY(v_family) AND d.dst_id = ANY(v_family);
  END IF;

  IF v_kind = 'wrong' AND v_repl IS NOT NULL THEN
    -- 新说法只落一份，落在这一家「最高」的作用域：家里有本人长期记忆那份 ⇒ 落个人空间（跨对话照样召回，
    -- 本对话也召回它），否则落在被点那条所在的作用域。supersedes 只在同一作用域里连（同 #4290 keep_new）。
    SELECT c.* INTO v_anchor FROM claims c
     WHERE c.org_id = v_org AND c.id = ANY(v_family) ORDER BY (c.scope_kind = 'personal') DESC, (c.id = v_c.id) DESC, c.id LIMIT 1;
    v_new := v_id || '-c';
    v_akind := v_anchor.scope_kind;
    v_ascope := v_anchor.scope_id;
    -- 时间字段（valid_to / due_at / todo_state）不在这里写：新行带着 supersedes_claim_id、自己没有时间字段 ⇒
    -- S6 的 kg_revise_inherits_time_trg（20260928170000）照抄 anchor 的（F4，测试见 kg-s7-citation-correction「F4」）。
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
        FROM claim_message_evidence e WHERE e.org_id = v_org AND e.claim_id = ANY(v_family)
       ORDER BY e.message_id, e.stance, e.claim_id;
    INSERT INTO claim_segments (claim_id, org_id, segment_id, stance)
      SELECT DISTINCT v_new, s.org_id, s.segment_id, s.stance FROM claim_segments s
       WHERE s.org_id = v_org AND s.claim_id = ANY(v_family);
    -- 边：只带新说法所在作用域那一条（anchor）的，**不带 derived_from**（review F2）：新说法不是从旧说法「记过来」的；
    -- 带过去的话，原对话里那条旧说法一撤，F07 会把新说法也一起收掉。
    INSERT INTO ontology_edges (id, org_id, src_kind, src_id, dst_kind, dst_id, relation, created_by, scope_kind, scope_id)
      SELECT v_new || '-' || e.id, e.org_id, 'claim', v_new, e.dst_kind, e.dst_id, e.relation, 'human', v_anchor.scope_kind, v_anchor.scope_id
        FROM ontology_edges e WHERE e.org_id = v_org AND e.src_kind = 'claim' AND e.src_id = v_anchor.id AND e.status = 'active'
         AND e.relation <> 'derived_from';
    -- anchor 同 reviseClaim：转 superseded（留在取代历史里，不撤）；家里其余的撤掉（F07 级联收掉它们的边）。
    UPDATE claims SET status = 'superseded', updated_at = now() WHERE org_id = v_org AND id = v_anchor.id;
    UPDATE claims SET status = 'superseded', revoked_at = now(), revocation_reason = 'user_citation_wrong', updated_at = now()
     WHERE org_id = v_org AND id = ANY(v_family) AND id <> v_anchor.id;
    v_outcome := 'superseded';
  ELSIF v_kind = 'expired' THEN
    -- F4（S6 #4363 已在 main）：「已过时」= 整家 valid_to = now()（左闭右开：此刻起不再成立），**不撤**。
    -- 行、边、证据都在：/brain 与记忆面板照旧列出它，标「已过期」（claim-time.ts claimExpired 一处判定）；召回不再用它。
    -- 已经过期的不算再过期一次（不重复记纠正事件）：被点的那条已过期 ⇒ 同「不在了」。
    -- 有效期窗口还没开始（valid_from 在此刻之后）⇒ 窗口起点收到此刻之前一瞬（PR #4507 review M1）：否则 valid_to 只能落在
    -- valid_from 之后（claims_validity_chk），这条到那时之前既照样被召回、也不算过期，再点仍会被接受、重复计数。
    IF v_c.valid_to IS NOT NULL AND v_c.valid_to <= now() THEN
      RAISE EXCEPTION 'KG_CLAIM_NOT_FOUND: claim % already expired', v_claim USING ERRCODE = '23503';
    END IF;
    WITH u AS (
      UPDATE claims
         SET valid_to = now(),
             valid_from = CASE WHEN valid_from IS NULL THEN NULL ELSE LEAST(valid_from, now() - interval '1 microsecond') END,
             updated_at = now()
       WHERE org_id = v_org AND id = ANY(v_family) AND (valid_to IS NULL OR valid_to > now())
      RETURNING id)
    SELECT coalesce(array_agg(id ORDER BY id), '{}') INTO v_touched FROM u;
    -- S10 分享到项目的副本（PR #4507 review M2，人类决定 2026-09-28：主人不再认这条，项目里的那份也不再算）：
    -- 同 kg_cascade_personal_share 撤回时的判据——有指向这一家的 derived_from 边、且没有指向家外的活 derived_from 来源——
    -- 一起到期（不撤，同上）。项目作用域排在会话 / 个人之后加锁。
    PERFORM pg_advisory_xact_lock(hashtext('kg_scope:' || v_org || '|project|' || x.scope_id))
       FROM (SELECT DISTINCT pc.scope_id FROM claims pc
              WHERE pc.org_id = v_org AND pc.scope_kind = 'project'
                AND EXISTS (SELECT 1 FROM ontology_edges d WHERE d.org_id = pc.org_id AND d.src_kind = 'claim' AND d.src_id = pc.id
                              AND d.relation = 'derived_from' AND d.dst_kind = 'claim' AND d.dst_id = ANY(v_touched))
              ORDER BY 1) x;
    WITH u AS (
      UPDATE claims pc
         SET valid_to = now(),
             valid_from = CASE WHEN pc.valid_from IS NULL THEN NULL ELSE LEAST(pc.valid_from, now() - interval '1 microsecond') END,
             updated_at = now()
       WHERE pc.org_id = v_org AND pc.scope_kind = 'project' AND pc.revoked_at IS NULL AND pc.status <> 'superseded'
         AND (pc.valid_to IS NULL OR pc.valid_to > now())
         AND EXISTS (SELECT 1 FROM ontology_edges d
                      WHERE d.org_id = pc.org_id AND d.src_kind = 'claim' AND d.src_id = pc.id AND d.relation = 'derived_from'
                        AND d.dst_kind = 'claim' AND d.dst_id = ANY(v_touched))
         AND NOT EXISTS (SELECT 1 FROM ontology_edges o
                          WHERE o.org_id = pc.org_id AND o.src_kind = 'claim' AND o.src_id = pc.id AND o.relation = 'derived_from'
                            AND o.dst_kind = 'claim' AND NOT (o.dst_id = ANY(v_touched)) AND o.status = 'active')
      RETURNING pc.id)
    SELECT coalesce(array_agg(id ORDER BY id), '{}') INTO v_shared FROM u;
    -- 审计只列这一次真的到期的（PR #4507 review L1）。
    v_touched := v_touched || v_shared;
    v_outcome := 'expired';
  ELSE
    UPDATE claims SET status = 'superseded', revoked_at = now(), revocation_reason = 'user_citation_wrong', updated_at = now()
     WHERE org_id = v_org AND id = ANY(v_family);
    v_outcome := 'forgotten';
  END IF;
  IF v_kind = 'wrong' THEN v_touched := v_family; END IF;

  -- 审计：每个被动到的作用域各一条（会话的审计不带个人空间的 id，个人空间那条记在个人空间，同 F17）。
  v_n := 0;
  FOR v_s IN SELECT DISTINCT c.scope_kind = 'project' AS is_project, c.scope_kind = 'personal' AS is_personal, c.scope_kind, c.scope_id
               FROM claims c WHERE c.org_id = v_org AND c.id = ANY(v_touched) ORDER BY 1, 2, 4 LOOP
    INSERT INTO ontology_actions (id, org_id, scope_kind, scope_id, actor_kind, actor_id, action_type, payload, source_ref, outcome)
    VALUES (CASE WHEN v_n = 0 THEN v_id ELSE v_id || '-' || v_n END, v_org, v_s.scope_kind, v_s.scope_id, 'human', v_user,
            CASE v_outcome WHEN 'superseded' THEN 'reviseClaim' WHEN 'expired' THEN 'expireClaim' ELSE 'revokeClaim' END,
            jsonb_build_object('via', 'citation', 'correction', v_kind,
                               'thread_id', CASE WHEN v_s.scope_kind = 'chat_session' AND v_s.scope_id = v_thread THEN v_thread END,
                               'message_id', CASE WHEN v_s.scope_kind = 'chat_session' AND v_s.scope_id = v_thread THEN v_message END,
                               'objects', '[]'::jsonb,
                               'claims', (SELECT jsonb_agg(jsonb_build_object('id', x.id) ORDER BY x.id) FROM (
                                           SELECT c.id FROM claims c WHERE c.org_id = v_org AND c.id = ANY(v_touched)
                                              AND c.scope_kind = v_s.scope_kind AND c.scope_id = v_s.scope_id
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

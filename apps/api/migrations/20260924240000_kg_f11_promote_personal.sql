/*
 * Phase 18 F11 —— 晋升到个人空间（L0 → L1，uc-18-4 R3 / R7，契约 promoteToPersonal）。
 *
 * `kg_promote_claim(jsonb)`：一次晋升一条（逐条部分成功，R4-E4 由应用层逐条调用、逐条收结果）。
 *   - 只有个人线程的所有者能晋升（R5；非个人线程 ⇒ KG_SCOPE_NOT_PERSONAL，别人的 ⇒ KG_NOT_OWNER）。
 *   - 冲突态拒绝（E5 → KG_CONTESTED_NEEDS_RESOLUTION）；证据都没了拒绝（E3 → KG_EVIDENCE_REVOKED）。
 *   - 「AI 记下的」照样能晋升：人点这个按钮本身就是确认（06-UX U-3，E1），同一动作里先确认再复制。
 *   - 复制 + 连边，不是移动（R7-1）：L1 新建一条 human / accepted 结论，证据原样挂上，
 *     `derived_from` 边连回 L0 原结论；L0 原行不改作用域。
 *   - 相关实体在 L1 做实体解析（同名同类型复用，没有就新建）。
 *   - mode = merge：去重时用户选了「合并」——证据追加到已有的 L1 结论上，同样连 derived_from。
 * 去重判断（哪条算「同义」）在应用层做；这里只执行、只复核不变量。
 */
CREATE OR REPLACE FUNCTION kg_promote_claim(p jsonb) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_org     text := current_setting('app.current_org', true);
  v_user    text := current_setting('app.current_user_id', true);
  v_thread  text := p->>'thread_id';
  v_claim   text := p->>'claim_id';
  v_id      text := p->>'action_id';
  v_mode    text := coalesce(p->>'mode', 'new');
  v_target  text;
  v_src     record;
  v_obj     record;
  v_pobj    text;
  n         int := 0;
BEGIN
  IF v_org IS NULL OR v_org = '' THEN RAISE EXCEPTION 'KG_NO_TENANT' USING ERRCODE = '42501'; END IF;
  IF NOT public.kernel_org_is_writable(v_org) THEN
    RAISE EXCEPTION 'KG_ORG_FROZEN: organization % is read-only', v_org USING ERRCODE = '42501';
  END IF;
  IF v_user IS NULL OR v_user = '' THEN RAISE EXCEPTION 'KG_ACTOR_NOT_HUMAN: no signed-in user' USING ERRCODE = '42501'; END IF;
  IF NOT EXISTS (SELECT 1 FROM chat_threads t WHERE t.id = v_thread AND t.org_id = v_org AND t.created_by = v_user) THEN
    RAISE EXCEPTION 'KG_NOT_OWNER: only the thread owner promotes its knowledge' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM chat_threads t WHERE t.id = v_thread AND t.org_id = v_org AND t.project_id IS NULL) THEN
    RAISE EXCEPTION 'KG_SCOPE_NOT_PERSONAL: only personal threads promote to personal knowledge' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_src FROM claims c
   WHERE c.org_id = v_org AND c.id = v_claim AND c.scope_kind = 'chat_session' AND c.scope_id = v_thread
     AND c.revoked_at IS NULL AND c.status <> 'superseded';
  IF NOT FOUND THEN RAISE EXCEPTION 'KG_CLAIM_NOT_FOUND' USING ERRCODE = '23503'; END IF;
  IF v_src.status = 'contested' THEN
    RAISE EXCEPTION 'KG_CONTESTED_NEEDS_RESOLUTION: resolve the conflict before promoting' USING ERRCODE = '23514';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM claim_message_evidence e WHERE e.claim_id = v_claim AND e.stance = 'supporting')
     AND NOT EXISTS (SELECT 1 FROM claim_segments s WHERE s.claim_id = v_claim AND s.stance = 'supporting') THEN
    RAISE EXCEPTION 'KG_EVIDENCE_REVOKED: the sources of this claim are gone' USING ERRCODE = '23514';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('kg_scope:' || v_org || '|personal|' || v_user));

  -- U-3：人点「记到我的长期记忆」本身就是确认
  IF v_src.status IN ('proposed', 'reviewed') THEN
    UPDATE claims SET status = 'accepted', reviewed_by = v_user, updated_at = now() WHERE org_id = v_org AND id = v_claim;
  END IF;

  IF v_mode = 'merge' THEN
    SELECT c.id INTO v_target FROM claims c
     WHERE c.org_id = v_org AND c.id = p->>'target_claim_id' AND c.scope_kind = 'personal' AND c.scope_id = v_user
       AND c.revoked_at IS NULL AND c.status <> 'superseded';
    IF v_target IS NULL THEN RAISE EXCEPTION 'KG_CLAIM_NOT_FOUND: merge target' USING ERRCODE = '23503'; END IF;
  ELSE
    v_target := v_id || '-p';
    INSERT INTO claims (id, org_id, statement, status, tsv, claim_kind, confidence, created_by, reviewed_by,
                        scope_kind, scope_id, valid_from)
    VALUES (v_target, v_org, v_src.statement, 'accepted', to_tsvector('simple', v_src.statement), v_src.claim_kind,
            1, 'human', v_user, 'personal', v_user, now());
    -- 相关实体在 L1 做实体解析：同名（不分大小写）同类型复用，没有就新建。
    FOR v_obj IN
      SELECT o.* FROM ontology_edges e JOIN ontology_objects o ON o.id = e.dst_id AND o.org_id = e.org_id
       WHERE e.org_id = v_org AND e.src_kind = 'claim' AND e.src_id = v_claim AND e.dst_kind = 'object'
         AND e.relation IN ('about', 'decided_by') AND e.status = 'active'
    LOOP
      n := n + 1;
      SELECT po.id INTO v_pobj FROM ontology_objects po
       WHERE po.org_id = v_org AND po.scope_kind = 'personal' AND po.scope_id = v_user AND po.merged_into IS NULL
         AND po.object_kind = v_obj.object_kind AND lower(po.name) = lower(v_obj.name)
       LIMIT 1;
      IF v_pobj IS NULL THEN
        v_pobj := v_id || '-o' || n;
        INSERT INTO ontology_objects (id, org_id, scope_kind, scope_id, object_kind, name, aliases, created_by)
        VALUES (v_pobj, v_org, 'personal', v_user, v_obj.object_kind, v_obj.name, v_obj.aliases, 'human');
      END IF;
      INSERT INTO ontology_edges (id, org_id, src_kind, src_id, dst_kind, dst_id, relation, created_by, scope_kind, scope_id)
      SELECT v_id || '-e' || n, v_org, 'claim', v_target, 'object', v_pobj, e.relation, 'human', 'personal', v_user
        FROM ontology_edges e WHERE e.org_id = v_org AND e.src_kind = 'claim' AND e.src_id = v_claim
         AND e.dst_kind = 'object' AND e.dst_id = v_obj.id AND e.status = 'active' LIMIT 1
      ON CONFLICT (id) DO NOTHING;
      v_pobj := NULL;
    END LOOP;
  END IF;

  -- 证据原样挂到 L1 结论上（merge 时是追加）
  INSERT INTO claim_message_evidence (claim_id, org_id, message_id, stance, excerpt)
    SELECT v_target, org_id, message_id, stance, excerpt FROM claim_message_evidence WHERE claim_id = v_claim
  ON CONFLICT DO NOTHING;
  INSERT INTO claim_segments (claim_id, org_id, segment_id, stance)
    SELECT v_target, org_id, segment_id, stance FROM claim_segments WHERE claim_id = v_claim
  ON CONFLICT DO NOTHING;
  -- 来源链不断（R7-1）：L1 → L0
  INSERT INTO ontology_edges (id, org_id, src_kind, src_id, dst_kind, dst_id, relation, created_by, scope_kind, scope_id)
  VALUES (v_id || '-d', v_org, 'claim', v_target, 'claim', v_claim, 'derived_from', 'human', 'personal', v_user)
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO ontology_actions (id, org_id, scope_kind, scope_id, actor_kind, actor_id, action_type, payload, outcome)
  VALUES (v_id, v_org, 'personal', v_user, 'human', v_user, 'promoteToPersonal',
          jsonb_build_object('thread_id', v_thread, 'mode', v_mode,
                             'claims', jsonb_build_array(jsonb_build_object('id', v_claim), jsonb_build_object('id', v_target))),
          'accepted');
  RETURN v_target;
END
$$;

REVOKE ALL ON FUNCTION kg_promote_claim(jsonb) FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_rw') THEN
    GRANT EXECUTE ON FUNCTION kg_promote_claim(jsonb) TO app_rw;
  END IF;
END
$$;

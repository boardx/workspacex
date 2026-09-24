/*
 * Phase 18 F10 —— 人工编辑动作（uc-18-3 R3-3 / R3-4，契约 applyHumanAction）。
 *
 * `kg_apply_human_action(jsonb)` 是人改本会话知识的唯一入口：确认（含批量）、改写、忘掉、标冲突、
 * 实体合并 / 拆分 / 改名。每个动作一条 accepted 的 ontology_actions（R3-5），投影由 F04 的触发器跟上。
 *
 * 数据库这一侧自己判：
 *   - 执行身份 = 登录用户（app.current_user_id），必须是**会话所有者**（uc-18-3 R5 / E2 → KG_NOT_OWNER）；
 *   - 乐观并发：调用方带上它看到的 revision（本会话 accepted 动作数），不一致 ⇒ KG_REVISION_CHANGED（E1）；
 *     判断与写入在同一把按会话的 advisory lock 下，两个标签页不会都以为自己是最新的；
 *   - 冲突态的结论不能直接确认（E3 → KG_CONTESTED_NEEDS_RESOLUTION）；
 *   - 只动本会话作用域里的行：别的会话 / 别人个人空间的 id 一律 KG_CLAIM_NOT_FOUND / KG_OBJECT_NOT_FOUND。
 * 可见性（能不能看这个会话）在应用层按 chat 的判定先过一遍；所有者一定看得见自己的会话。
 */

CREATE OR REPLACE FUNCTION kg_apply_human_action(p jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_org      text := current_setting('app.current_org', true);
  v_user     text := current_setting('app.current_user_id', true);
  v_thread   text := p->>'thread_id';
  v_action   jsonb := p->'action';
  v_type     text := p->'action'->>'type';
  v_id       text := p->>'action_id';
  v_rev      bigint;
  v_claims   text[] := '{}';
  v_objects  text[] := '{}';
  v_old      record;
  v_new_id   text;
  c_id       text;
  n          int;
BEGIN
  IF v_org IS NULL OR v_org = '' THEN RAISE EXCEPTION 'KG_NO_TENANT' USING ERRCODE = '42501'; END IF;
  IF NOT public.kernel_org_is_writable(v_org) THEN
    RAISE EXCEPTION 'KG_ORG_FROZEN: organization % is read-only', v_org USING ERRCODE = '42501';
  END IF;
  IF v_user IS NULL OR v_user = '' THEN RAISE EXCEPTION 'KG_ACTOR_NOT_HUMAN: no signed-in user' USING ERRCODE = '42501'; END IF;
  IF NOT EXISTS (SELECT 1 FROM chat_threads t WHERE t.id = v_thread AND t.org_id = v_org AND t.created_by = v_user) THEN
    RAISE EXCEPTION 'KG_NOT_OWNER: only the thread owner edits its knowledge' USING ERRCODE = '42501';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('kg_scope:' || v_org || '|chat_session|' || v_thread));
  SELECT count(*) INTO v_rev FROM ontology_actions a
   WHERE a.org_id = v_org AND a.scope_kind = 'chat_session' AND a.scope_id = v_thread AND a.outcome = 'accepted';
  IF (p->>'based_on_revision')::bigint IS DISTINCT FROM v_rev THEN
    RAISE EXCEPTION 'KG_REVISION_CHANGED: based on %, current %', p->>'based_on_revision', v_rev USING ERRCODE = '40001';
  END IF;

  IF v_type IN ('confirmClaim', 'confirmClaims') THEN
    v_claims := CASE WHEN v_type = 'confirmClaim' THEN ARRAY[v_action->>'claimId']
                     ELSE ARRAY(SELECT jsonb_array_elements_text(v_action->'claimIds')) END;
    PERFORM kg_human_require_claims(v_org, v_thread, v_claims);
    -- E3：批量里有一条冲突态 ⇒ 整批拒绝（契约 confirmClaims 注释）
    IF EXISTS (SELECT 1 FROM claims c WHERE c.org_id = v_org AND c.id = ANY(v_claims) AND c.status = 'contested') THEN
      RAISE EXCEPTION 'KG_CONTESTED_NEEDS_RESOLUTION: resolve the conflict before confirming' USING ERRCODE = '23514';
    END IF;
    UPDATE claims SET status = 'accepted', reviewed_by = v_user, updated_at = now()
     WHERE org_id = v_org AND id = ANY(v_claims) AND status IN ('proposed', 'reviewed');

  ELSIF v_type = 'reviseClaim' THEN
    v_claims := ARRAY[v_action->>'claimId'];
    PERFORM kg_human_require_claims(v_org, v_thread, v_claims);
    SELECT * INTO v_old FROM claims WHERE org_id = v_org AND id = v_action->>'claimId';
    v_new_id := v_id || '-c';
    INSERT INTO claims (id, org_id, statement, status, tsv, claim_kind, confidence, created_by, reviewed_by,
                        supersedes_claim_id, scope_kind, scope_id, valid_from)
    VALUES (v_new_id, v_org, v_action->>'statement', 'accepted', to_tsvector('simple', v_action->>'statement'),
            v_old.claim_kind, 1, 'human', v_user, v_old.id, 'chat_session', v_thread, now());
    -- 改写的是说法，不是出处：原来的证据原样挂到新结论上（I-5）。
    INSERT INTO claim_message_evidence (claim_id, org_id, message_id, stance, excerpt)
      SELECT v_new_id, org_id, message_id, stance, excerpt FROM claim_message_evidence WHERE claim_id = v_old.id;
    INSERT INTO claim_segments (claim_id, org_id, segment_id, stance)
      SELECT v_new_id, org_id, segment_id, stance FROM claim_segments WHERE claim_id = v_old.id;
    INSERT INTO ontology_edges (id, org_id, src_kind, src_id, dst_kind, dst_id, relation, created_by, scope_kind, scope_id)
      SELECT v_new_id || '-' || e.id, e.org_id, 'claim', v_new_id, e.dst_kind, e.dst_id, e.relation, 'human', 'chat_session', v_thread
        FROM ontology_edges e WHERE e.org_id = v_org AND e.src_kind = 'claim' AND e.src_id = v_old.id AND e.status = 'active';
    UPDATE claims SET status = 'superseded', updated_at = now() WHERE org_id = v_org AND id = v_old.id;
    v_claims := v_claims || v_new_id;

  ELSIF v_type = 'revokeClaim' THEN
    v_claims := ARRAY[v_action->>'claimId'];
    PERFORM kg_human_require_claims(v_org, v_thread, v_claims);
    UPDATE claims SET status = 'superseded', revoked_at = now(),
                      revocation_reason = coalesce(nullif(v_action->>'reason', ''), 'user_revoked'), updated_at = now()
     WHERE org_id = v_org AND id = v_claims[1];

  ELSIF v_type = 'markContested' THEN
    v_claims := ARRAY(SELECT jsonb_array_elements_text(v_action->'claimIds'));
    PERFORM kg_human_require_claims(v_org, v_thread, v_claims);
    UPDATE claims SET status = 'contested', updated_at = now() WHERE org_id = v_org AND id = ANY(v_claims);

  ELSIF v_type = 'renameObject' THEN
    v_objects := ARRAY[v_action->>'objectId'];
    PERFORM kg_human_require_objects(v_org, v_thread, v_objects);
    UPDATE ontology_objects
       SET aliases = coalesce((SELECT array_agg(DISTINCT a) FROM unnest(aliases || name) a WHERE a <> v_action->>'name'), '{}'),
           name = v_action->>'name', updated_at = now()
     WHERE org_id = v_org AND id = v_objects[1];

  ELSIF v_type = 'mergeObjects' THEN
    v_objects := ARRAY[v_action->>'keepObjectId', v_action->>'mergeObjectId'];
    IF v_objects[1] = v_objects[2] THEN RAISE EXCEPTION 'KG_OBJECT_NOT_FOUND: cannot merge an entity into itself' USING ERRCODE = '23514'; END IF;
    PERFORM kg_human_require_objects(v_org, v_thread, v_objects);
    UPDATE ontology_objects k
       SET aliases = coalesce((SELECT array_agg(DISTINCT a) FROM unnest(k.aliases || m.name || m.aliases) a WHERE a <> k.name), '{}'), updated_at = now()
      FROM ontology_objects m WHERE k.org_id = v_org AND k.id = v_objects[1] AND m.id = v_objects[2];
    -- 只改本会话作用域里的边：两个实体都属于本会话（上面已核对），别的作用域的边不该被这次合并改写。
    UPDATE ontology_edges SET dst_id = v_objects[1]
     WHERE org_id = v_org AND scope_kind = 'chat_session' AND scope_id = v_thread AND dst_kind = 'object' AND dst_id = v_objects[2];
    UPDATE ontology_edges SET src_id = v_objects[1]
     WHERE org_id = v_org AND scope_kind = 'chat_session' AND scope_id = v_thread AND src_kind = 'object' AND src_id = v_objects[2];
    UPDATE ontology_objects SET merged_into = v_objects[1], updated_at = now() WHERE org_id = v_org AND id = v_objects[2];

  ELSIF v_type = 'splitObject' THEN
    v_objects := ARRAY[v_action->>'objectId'];
    PERFORM kg_human_require_objects(v_org, v_thread, v_objects);
    v_claims := ARRAY(SELECT jsonb_array_elements_text(v_action->'moveClaimIds'));
    PERFORM kg_human_require_claims(v_org, v_thread, v_claims);
    v_new_id := v_id || '-o';
    INSERT INTO ontology_objects (id, org_id, scope_kind, scope_id, object_kind, name, aliases, created_by)
      SELECT v_new_id, org_id, 'chat_session', v_thread, object_kind, v_action->>'newName', '{}', 'human'
        FROM ontology_objects WHERE org_id = v_org AND id = v_objects[1];
    UPDATE ontology_edges SET dst_id = v_new_id
     WHERE org_id = v_org AND src_kind = 'claim' AND src_id = ANY(v_claims) AND dst_kind = 'object' AND dst_id = v_objects[1];
    v_objects := v_objects || v_new_id;

  ELSE
    RAISE EXCEPTION 'KG_INVALID_ACTION: %', v_type USING ERRCODE = '22023';
  END IF;

  -- payload 里带上受影响的结论 / 实体 id：来源抽屉的「谁 / 何时」按它查（pg-knowledge-read claimSources）。
  INSERT INTO ontology_actions (id, org_id, scope_kind, scope_id, actor_kind, actor_id, action_type, payload, outcome)
  VALUES (v_id, v_org, 'chat_session', v_thread, 'human', v_user, v_type,
          jsonb_build_object('action', v_action,
                             'claims', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', x)), '[]'::jsonb) FROM unnest(v_claims) x),
                             'objects', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', x)), '[]'::jsonb) FROM unnest(v_objects) x)),
          'accepted');
  RETURN jsonb_build_object('revision', v_rev + 1, 'action_id', v_id);
END
$$;

-- 这些结论都在本会话、都还活着；否则 KG_CLAIM_NOT_FOUND（别处的 id 与不存在的 id 同一个出口）。
CREATE OR REPLACE FUNCTION kg_human_require_claims(p_org text, p_thread text, p_ids text[]) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF cardinality(p_ids) = 0 OR (SELECT count(DISTINCT c.id) FROM claims c
       WHERE c.org_id = p_org AND c.id = ANY(p_ids) AND c.scope_kind = 'chat_session' AND c.scope_id = p_thread
         AND c.revoked_at IS NULL AND c.status <> 'superseded') <> cardinality(ARRAY(SELECT DISTINCT unnest(p_ids))) THEN
    RAISE EXCEPTION 'KG_CLAIM_NOT_FOUND' USING ERRCODE = '23503';
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION kg_human_require_objects(p_org text, p_thread text, p_ids text[]) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF (SELECT count(DISTINCT o.id) FROM ontology_objects o
       WHERE o.org_id = p_org AND o.id = ANY(p_ids) AND o.scope_kind = 'chat_session' AND o.scope_id = p_thread
         AND o.merged_into IS NULL) <> cardinality(ARRAY(SELECT DISTINCT unnest(p_ids))) THEN
    RAISE EXCEPTION 'KG_OBJECT_NOT_FOUND' USING ERRCODE = '23503';
  END IF;
END
$$;

REVOKE ALL ON FUNCTION kg_apply_human_action(jsonb), kg_human_require_claims(text, text, text[]),
  kg_human_require_objects(text, text, text[]) FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_rw') THEN
    GRANT EXECUTE ON FUNCTION kg_apply_human_action(jsonb) TO app_rw;
  END IF;
END
$$;

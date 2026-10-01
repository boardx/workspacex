-- 项目中枢 B2-S4（2026-09-27，issue #4428）—— 组织大脑放开组织作用域（L3）。
--
-- ① `kg_scope_enabled`：外扩到 'org'。与 `domain/knowledge-graph/ontology-batch.ts` 的 ENABLED_KG_SCOPES、
--    契约 KG_SCOPES_ENABLED_PHASE_18 三处同改（`tests/knowledge-graph/executor-invariants.test.ts` 对账）。
--    组织层只经晋升进入：应用层 `validateOntologyBatch` 对 org 作用域只放行 human 执行者（模型 / 系统批次
--    KG_ACTOR_NOT_HUMAN）；`kg_apply_batch` 本身不改（同 R7 放开 project 时的处理）。
-- ② `kg_promote_claim_to_org(jsonb)`：与 `kg_promote_claim_to_project`（迁移 20260927120000）同构——复制 +
--    derived_from、证据与实体跟过去、写 ontology_actions——只换三件事：
--      · 谁能做：本组织 lead / admin（`org_memberships.org_role`）——组织记忆是替整个组织记下，不是项目内的事；
--      · 来源：本项目**项目记忆**里的活结论（scope 'project' / project_id），不是会话结论（KG_CLAIM_NOT_FOUND）；
--      · 目标作用域 ('org', <org_id>)，实体 / 合并目标都在组织记忆里找。
--    ⚠ 不改 `kg_promote_claim` / `kg_promote_claim_to_project`：前两级的判定一字不动。

CREATE OR REPLACE FUNCTION kg_scope_enabled(p_scope_kind text) RETURNS boolean
LANGUAGE sql IMMUTABLE AS $$ SELECT p_scope_kind IN ('chat_session', 'personal', 'project', 'org') $$;

CREATE OR REPLACE FUNCTION kg_promote_claim_to_org(p jsonb) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_org     text := current_setting('app.current_org', true);
  v_user    text := current_setting('app.current_user_id', true);
  v_project text := p->>'project_id';
  v_claim   text := p->>'claim_id';
  v_id      text := p->>'action_id';
  v_mode    text := coalesce(p->>'mode', 'new');
  v_target  text;
  v_src     record;
  v_obj     record;
  v_oobj    text;
  n         int := 0;
BEGIN
  IF v_org IS NULL OR v_org = '' THEN RAISE EXCEPTION 'KG_NO_TENANT' USING ERRCODE = '42501'; END IF;
  IF NOT public.kernel_org_is_writable(v_org) THEN
    RAISE EXCEPTION 'KG_ORG_FROZEN: organization % is read-only', v_org USING ERRCODE = '42501';
  END IF;
  IF v_user IS NULL OR v_user = '' THEN RAISE EXCEPTION 'KG_ACTOR_NOT_HUMAN: no signed-in user' USING ERRCODE = '42501'; END IF;
  IF NOT public.kg_scope_enabled('org') THEN RAISE EXCEPTION 'KG_SCOPE_NOT_ENABLED: org' USING ERRCODE = '42501'; END IF;
  IF v_project IS NULL OR v_project = '' THEN RAISE EXCEPTION 'KG_CLAIM_NOT_FOUND: no project' USING ERRCODE = '23503'; END IF;
  -- 本组织的 lead / admin 才能替整个组织记下。
  IF NOT EXISTS (SELECT 1 FROM org_memberships m
                  WHERE m.org_id = v_org AND m.user_id = v_user AND m.org_role IN ('lead', 'admin')) THEN
    RAISE EXCEPTION 'KG_NOT_OWNER: only an organization lead or admin promotes to organization knowledge' USING ERRCODE = '42501';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('kg_scope:' || v_org || '|project|' || v_project));
  SELECT * INTO v_src FROM claims c
   WHERE c.org_id = v_org AND c.id = v_claim AND c.scope_kind = 'project' AND c.scope_id = v_project
     AND c.revoked_at IS NULL AND c.status <> 'superseded'
   FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'KG_CLAIM_NOT_FOUND' USING ERRCODE = '23503'; END IF;
  IF v_src.status = 'contested' THEN
    RAISE EXCEPTION 'KG_CONTESTED_NEEDS_RESOLUTION: resolve the conflict before promoting' USING ERRCODE = '23514';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM claim_message_evidence e WHERE e.claim_id = v_claim AND e.stance = 'supporting')
     AND NOT EXISTS (SELECT 1 FROM claim_segments s WHERE s.claim_id = v_claim AND s.stance = 'supporting') THEN
    RAISE EXCEPTION 'KG_EVIDENCE_REVOKED: the sources of this claim are gone' USING ERRCODE = '23514';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('kg_scope:' || v_org || '|org|' || v_org));

  IF v_src.status IN ('proposed', 'reviewed') THEN
    UPDATE claims SET status = 'accepted', reviewed_by = v_user, updated_at = now()
     WHERE org_id = v_org AND id = v_claim AND status IN ('proposed', 'reviewed');
    INSERT INTO ontology_actions (id, org_id, scope_kind, scope_id, actor_kind, actor_id, action_type, payload, outcome)
    VALUES (v_id || '-c', v_org, 'project', v_project, 'human', v_user, 'confirmClaim',
            jsonb_build_object('action', jsonb_build_object('type', 'confirmClaim', 'claimId', v_claim), 'via', 'promoteToOrg',
                               'claims', jsonb_build_array(jsonb_build_object('id', v_claim)), 'objects', '[]'::jsonb),
            'accepted');
  END IF;

  IF v_mode = 'merge' THEN
    SELECT c.id INTO v_target FROM claims c
     WHERE c.org_id = v_org AND c.id = p->>'target_claim_id' AND c.scope_kind = 'org' AND c.scope_id = v_org
       AND c.revoked_at IS NULL AND c.status NOT IN ('superseded', 'contested')
     FOR UPDATE;
    IF v_target IS NULL THEN RAISE EXCEPTION 'KG_CLAIM_NOT_FOUND: merge target' USING ERRCODE = '23503'; END IF;
    UPDATE claims SET status = 'accepted', reviewed_by = v_user, updated_at = now()
     WHERE org_id = v_org AND id = v_target AND status IN ('proposed', 'reviewed');
  ELSE
    v_target := v_id || '-g';
    INSERT INTO claims (id, org_id, statement, status, tsv, claim_kind, confidence, created_by, reviewed_by,
                        scope_kind, scope_id, valid_from)
    VALUES (v_target, v_org, v_src.statement, 'accepted', to_tsvector('simple', v_src.statement), v_src.claim_kind,
            1, 'human', v_user, 'org', v_org, now());
    FOR v_obj IN
      SELECT o.* FROM ontology_edges e JOIN ontology_objects o ON o.id = e.dst_id AND o.org_id = e.org_id
       WHERE e.org_id = v_org AND e.src_kind = 'claim' AND e.src_id = v_claim AND e.dst_kind = 'object'
         AND e.relation IN ('about', 'decided_by') AND e.status = 'active'
    LOOP
      n := n + 1;
      SELECT oo.id INTO v_oobj FROM ontology_objects oo
       WHERE oo.org_id = v_org AND oo.scope_kind = 'org' AND oo.scope_id = v_org AND oo.merged_into IS NULL
         AND oo.object_kind = v_obj.object_kind AND lower(oo.name) = lower(v_obj.name)
       LIMIT 1;
      IF v_oobj IS NULL THEN
        v_oobj := v_id || '-o' || n;
        INSERT INTO ontology_objects (id, org_id, scope_kind, scope_id, object_kind, name, aliases, created_by)
        VALUES (v_oobj, v_org, 'org', v_org, v_obj.object_kind, v_obj.name, v_obj.aliases, 'human');
      END IF;
      INSERT INTO ontology_edges (id, org_id, src_kind, src_id, dst_kind, dst_id, relation, created_by, scope_kind, scope_id)
      SELECT v_id || '-e' || n, v_org, 'claim', v_target, 'object', v_oobj, e.relation, 'human', 'org', v_org
        FROM ontology_edges e WHERE e.org_id = v_org AND e.src_kind = 'claim' AND e.src_id = v_claim
         AND e.dst_kind = 'object' AND e.dst_id = v_obj.id AND e.status = 'active' LIMIT 1
      ON CONFLICT (id) DO NOTHING;
      v_oobj := NULL;
    END LOOP;
  END IF;

  INSERT INTO claim_message_evidence (claim_id, org_id, message_id, stance, excerpt)
    SELECT v_target, org_id, message_id, stance, excerpt FROM claim_message_evidence WHERE claim_id = v_claim
  ON CONFLICT DO NOTHING;
  INSERT INTO claim_segments (claim_id, org_id, segment_id, stance)
    SELECT v_target, org_id, segment_id, stance FROM claim_segments WHERE claim_id = v_claim
  ON CONFLICT DO NOTHING;
  INSERT INTO ontology_edges (id, org_id, src_kind, src_id, dst_kind, dst_id, relation, created_by, scope_kind, scope_id)
  SELECT v_id || '-d', v_org, 'claim', v_target, 'claim', v_claim, 'derived_from', 'human', 'org', v_org
   WHERE NOT EXISTS (SELECT 1 FROM ontology_edges d
                      WHERE d.org_id = v_org AND d.src_kind = 'claim' AND d.src_id = v_target AND d.dst_kind = 'claim'
                        AND d.dst_id = v_claim AND d.relation = 'derived_from' AND d.status = 'active')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO ontology_actions (id, org_id, scope_kind, scope_id, actor_kind, actor_id, action_type, payload, outcome)
  VALUES (v_id, v_org, 'org', v_org, 'human', v_user, 'promoteToOrg',
          jsonb_build_object('project_id', v_project, 'mode', v_mode,
                             'claims', jsonb_build_array(jsonb_build_object('id', v_claim), jsonb_build_object('id', v_target))),
          'accepted');
  RETURN v_target;
END
$$;

REVOKE ALL ON FUNCTION kg_promote_claim_to_org(jsonb) FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_rw') THEN
    GRANT EXECUTE ON FUNCTION kg_promote_claim_to_org(jsonb), kg_scope_enabled(text) TO app_rw;
  END IF;
END $$;

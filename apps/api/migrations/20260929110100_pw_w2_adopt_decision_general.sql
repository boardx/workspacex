-- #4615 W2（PROP-PROJECT-WORKSPACE-001 §3.3）：采纳为决策对通用项目开放。
--
-- `kg_adopt_project_decision` 此前只认工作坊成员表 `project_memberships`，通用项目（kind = 'general'）的负责人 /
-- 协作者在 TS 层（`adopt-project-decision.ts`，已改走 resolveProjectLayer）过得去、到数据库这一层却恒 KG_NOT_VISIBLE。
-- 本迁移 CREATE OR REPLACE 同一个函数，**只改成员判定那一段**（其余逐字照抄 20260928110000）：
--   工作坊行 → 原样；否则通用项目名单（`general_project_members`，W1 由 research_project_members 更名而来）
--   owner → facilitator、collaborator → member；名单外的组织 lead / admin → observer（KG_NOT_OWNER）。
-- 依赖：`general_project_members` 由 W1 容器迁移建立；本函数用 to_regclass 探测，任何 apply 顺序下都可建、可重放。

CREATE OR REPLACE FUNCTION kg_adopt_project_decision(p jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_org       text := current_setting('app.current_org', true);
  v_user      text := current_setting('app.current_user_id', true);
  v_project   text := p->>'project_id';
  v_claim     text := p->>'claim_id';
  v_id        text := p->>'action_id';
  v_rationale text := btrim(coalesce(p->>'rationale', ''));
  v_role      text;
  v_src       record;
  v_target    text;
  v_has_evid  boolean;
  n           int := 0;
  v_edge      record;
BEGIN
  IF v_org IS NULL OR v_org = '' THEN RAISE EXCEPTION 'KG_NO_TENANT' USING ERRCODE = '42501'; END IF;
  IF NOT public.kernel_org_is_writable(v_org) THEN
    RAISE EXCEPTION 'KG_ORG_FROZEN: organization % is read-only', v_org USING ERRCODE = '42501';
  END IF;
  IF v_user IS NULL OR v_user = '' THEN RAISE EXCEPTION 'KG_ACTOR_NOT_HUMAN: no signed-in user' USING ERRCODE = '42501'; END IF;
  IF NOT public.kg_scope_enabled('project') THEN RAISE EXCEPTION 'KG_SCOPE_NOT_ENABLED: project' USING ERRCODE = '42501'; END IF;
  IF v_project IS NULL OR v_project = '' THEN RAISE EXCEPTION 'KG_CLAIM_NOT_FOUND: no project' USING ERRCODE = '23503'; END IF;
  IF v_id IS NULL OR v_id = '' THEN RAISE EXCEPTION 'KG_INVALID_REQUEST: no action id' USING ERRCODE = '22023'; END IF;
  IF length(v_rationale) < 1 OR length(v_rationale) > 500 THEN
    RAISE EXCEPTION 'KG_INVALID_REQUEST: rationale must be 1..500 characters' USING ERRCODE = '22023';
  END IF;

  -- 项目成员且不是观察者；项目未归档。
  -- #4615：项目层身份与 `application/identity/project-layer.ts resolveProjectLayer` 同一张映射——
  --   工作坊：`project_memberships.project_role`（热路径，与此前逐字相同）；
  --   通用项目（projects.kind = 'general'）：`general_project_members.role` owner → facilitator 行、
  --   collaborator → member 行；不在名单上的组织 lead / admin → observer 行（只读，KG_NOT_OWNER）。
  -- ⚠ `general_project_members` 由 W1（容器迁移）建；这里用 to_regclass 探测 + 动态 SQL，W1 尚未 apply 的库上
  --   本分支等价于「不是成员」（与此前行为相同），函数本身在任何迁移顺序下都能建出来。
  SELECT m.project_role INTO v_role FROM project_memberships m
   WHERE m.org_id = v_org AND m.project_id = v_project AND m.user_id = v_user;
  IF NOT FOUND THEN
    v_role := NULL;
    IF to_regclass('public.general_project_members') IS NOT NULL
       AND EXISTS (SELECT 1 FROM projects pr WHERE pr.id = v_project AND pr.org_id = v_org AND pr.kind = 'general') THEN
      EXECUTE 'SELECT CASE gm.role WHEN ''owner'' THEN ''facilitator'' WHEN ''collaborator'' THEN ''member'' END
                 FROM public.general_project_members gm
                WHERE gm.org_id = $1 AND gm.project_id = $2 AND gm.user_id = $3'
         INTO v_role USING v_org, v_project, v_user;
      IF v_role IS NULL AND EXISTS (SELECT 1 FROM org_memberships om
                                     WHERE om.org_id = v_org AND om.user_id = v_user AND om.org_role IN ('lead', 'admin')) THEN
        v_role := 'observer';
      END IF;
    END IF;
    IF v_role IS NULL THEN RAISE EXCEPTION 'KG_NOT_VISIBLE: not a member of this project' USING ERRCODE = '42501'; END IF;
  END IF;
  IF v_role = 'observer' OR NOT public.kernel_project_is_writable(v_project) THEN
    RAISE EXCEPTION 'KG_NOT_OWNER: observers and archived projects take no new project decisions' USING ERRCODE = '42501';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('kg_scope:' || v_org || '|project|' || v_project));
  SELECT * INTO v_src FROM claims c
   WHERE c.org_id = v_org AND c.id = v_claim AND c.scope_kind = 'project' AND c.scope_id = v_project
     AND c.revoked_at IS NULL AND c.status <> 'superseded'
   FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'KG_CLAIM_NOT_FOUND' USING ERRCODE = '23503'; END IF;
  -- 只允许 fact / hypothesis → decision（契约 KG_ADOPTABLE_CLAIM_KINDS 同一张表）。
  IF coalesce(v_src.claim_kind, 'fact') NOT IN ('fact', 'hypothesis') THEN
    RAISE EXCEPTION 'KG_CLAIM_NOT_FOUND: only a fact or hypothesis can be adopted as a decision' USING ERRCODE = '23503';
  END IF;
  IF v_src.status = 'contested' THEN
    RAISE EXCEPTION 'KG_CONTESTED_NEEDS_RESOLUTION: resolve the conflict before adopting' USING ERRCODE = '23514';
  END IF;

  -- 新的决策条目：陈述照抄、kind = decision、人建、采纳人复核。
  v_target := v_id || '-g';
  INSERT INTO claims (id, org_id, statement, status, tsv, claim_kind, confidence, created_by, reviewed_by,
                      scope_kind, scope_id, valid_from)
  VALUES (v_target, v_org, v_src.statement, 'accepted', to_tsvector('simple', v_src.statement), 'decision',
          1, 'human', v_user, 'project', v_project, now());

  -- 实体边原样复制（同一作用域，实体就是同一批）。
  FOR v_edge IN
    SELECT e.dst_id, e.relation FROM ontology_edges e
     WHERE e.org_id = v_org AND e.src_kind = 'claim' AND e.src_id = v_claim AND e.dst_kind = 'object'
       AND e.relation IN ('about', 'decided_by') AND e.status = 'active'
  LOOP
    n := n + 1;
    INSERT INTO ontology_edges (id, org_id, src_kind, src_id, dst_kind, dst_id, relation, created_by, scope_kind, scope_id)
    VALUES (v_id || '-e' || n, v_org, 'claim', v_target, 'object', v_edge.dst_id, v_edge.relation, 'human', 'project', v_project)
    ON CONFLICT (id) DO NOTHING;
  END LOOP;

  -- 证据锚点全部复制。T1（证据归一化）若已给 claim_message_evidence 加了 evidence_id 列，一并带过去。
  SELECT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = 'public' AND table_name = 'claim_message_evidence' AND column_name = 'evidence_id')
    INTO v_has_evid;
  IF v_has_evid THEN
    EXECUTE 'INSERT INTO claim_message_evidence (claim_id, org_id, message_id, stance, excerpt, evidence_id)
               SELECT $1, org_id, message_id, stance, excerpt, evidence_id FROM claim_message_evidence WHERE claim_id = $2
             ON CONFLICT DO NOTHING' USING v_target, v_claim;
  ELSE
    INSERT INTO claim_message_evidence (claim_id, org_id, message_id, stance, excerpt)
      SELECT v_target, org_id, message_id, stance, excerpt FROM claim_message_evidence WHERE claim_id = v_claim
    ON CONFLICT DO NOTHING;
  END IF;
  SELECT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = 'public' AND table_name = 'claim_segments' AND column_name = 'evidence_id')
    INTO v_has_evid;
  IF v_has_evid THEN
    EXECUTE 'INSERT INTO claim_segments (claim_id, org_id, segment_id, stance, evidence_id)
               SELECT $1, org_id, segment_id, stance, evidence_id FROM claim_segments WHERE claim_id = $2
             ON CONFLICT DO NOTHING' USING v_target, v_claim;
  ELSE
    INSERT INTO claim_segments (claim_id, org_id, segment_id, stance)
      SELECT v_target, org_id, segment_id, stance FROM claim_segments WHERE claim_id = v_claim
    ON CONFLICT DO NOTHING;
  END IF;

  -- 新 → 源：derived_from（同 R7 / S4 / S10 的回链方向）。
  INSERT INTO ontology_edges (id, org_id, src_kind, src_id, dst_kind, dst_id, relation, created_by, scope_kind, scope_id)
  VALUES (v_id || '-d', v_org, 'claim', v_target, 'claim', v_claim, 'derived_from', 'human', 'project', v_project)
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO ontology_actions (id, org_id, scope_kind, scope_id, actor_kind, actor_id, action_type, payload, outcome)
  VALUES (v_id, v_org, 'project', v_project, 'human', v_user, 'adoptProjectDecision',
          jsonb_build_object('project_id', v_project, 'rationale', v_rationale,
                             'source_claim_id', v_claim, 'decision_claim_id', v_target,
                             'claims', jsonb_build_array(jsonb_build_object('id', v_claim), jsonb_build_object('id', v_target))),
          'accepted');
  RETURN jsonb_build_object('decision_claim_id', v_target, 'action_id', v_id);
END
$$;

REVOKE ALL ON FUNCTION kg_adopt_project_decision(jsonb) FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_rw') THEN
    GRANT EXECUTE ON FUNCTION kg_adopt_project_decision(jsonb) TO app_rw;
  END IF;
END $$;

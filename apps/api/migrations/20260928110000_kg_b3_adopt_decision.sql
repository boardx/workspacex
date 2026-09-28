-- 项目中枢 B3-T4（2026-09-28，issue #4498）—— 成果回流：把项目记忆里的一条 fact / hypothesis **采纳为项目决策**。
--
-- `kg_adopt_project_decision(jsonb)`：与 B2-S4 `kg_promote_claim_to_org`（迁移 20260927160000）同构——新建一条 +
-- derived_from、证据跟过去、写 ontology_actions——只换四件事：
--   · 谁能做：**本项目成员且不是观察者**（`project_memberships.project_role <> 'observer'`；观察者在角色矩阵里只有
--     read.published）—— 不是成员 KG_NOT_VISIBLE，观察者 KG_NOT_OWNER（沿用现有码，不新增）；项目未归档。
--   · 来源：本项目**项目作用域**里活着的 fact / hypothesis（其余类型与「不在项目记忆里」同一个出口 KG_CLAIM_NOT_FOUND）；
--     有未解矛盾（status = contested）⇒ KG_CONTESTED_NEEDS_RESOLUTION。
--   · 目标：同一个项目作用域里一条 **decision** 类条目——陈述照抄、status accepted、created_by human、reviewed_by 采纳人；
--     实体边（about / decided_by）原样复制到新条目（同作用域，不必重找实体）；证据锚点全部复制
--     （`claim_message_evidence` / `claim_segments`；T1 若已加 `evidence_id` 列则一并带过去——用 information_schema
--     判列是否存在，两个分支都能跑）。
--   · 审计：`ontology_actions` 记 adoptProjectDecision，payload 带 rationale + source_claim_id + decision_claim_id；
--     `getProjectKnowledge.adoptedDecisions` 只从这一笔读，不另存表。
-- 同一条来源可以被采纳多次（不同理由 / 不同时间的决策各自成条）——决策是否被取代由既有 supersedes 机制管，这里不判重。
-- ⚠ 不改 `kg_promote_claim*` / `kg_share_claim_to_project`：它们的判定一字不动。

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
  SELECT m.project_role INTO v_role FROM project_memberships m
   WHERE m.org_id = v_org AND m.project_id = v_project AND m.user_id = v_user;
  IF NOT FOUND THEN RAISE EXCEPTION 'KG_NOT_VISIBLE: not a member of this project' USING ERRCODE = '42501'; END IF;
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

-- phase-18 S10（issue #4367，epic #4359）—— 个人结论**显式**提升到项目层（「分享到项目…」）。
--
-- 形状与 R7 `kg_promote_claim_to_project`（迁移 20260927120000）同构：复制一份派生副本进 ('project', <project_id>)，
-- derived_from 连回原结论，证据与实体跟过去，写 ontology_actions。只换三件事：
--   · 来源是**个人空间**（L1）的结论，不是项目线程里的（L0）；
--   · 谁能做：**只有这条个人结论的主人**（scope_id = app.current_user_id）；别人的个人结论与不存在同一个出口
--     KG_CLAIM_NOT_FOUND（人类决定 2026-09-27：别人的个人结论一律 404，不是 403）；
--   · 目标项目：主人是该项目成员，且不是观察者（observer 在角色矩阵里只有 read.published），项目未归档。
--
-- 出处（「由 X 分享自个人记忆」）不另存一份：它就是那条活的 derived_from 边 + 边另一端个人结论的主人。
-- 项目成员按 RLS 读不到别人的个人空间行，所以由 SECURITY DEFINER 的 `kg_share_author_name` 只回一个显示名。
--
-- 撤回（`kg_unshare_claim_from_project`）：把项目副本失效（user_revoked），F07 `kg_cascade_claim_revocation`
-- 随之把连着副本的边软失效；个人空间的原件一字不动（级联只往「由它派生的」方向走，原件是边的另一端）。
-- 原件失效（主人在 /brain「忘掉」、原话被删、被改口取代）⇒ 由它分享出去的项目副本一并失效
-- （`kg_cascade_personal_share`，下面）：分享的是「我现在认的这句话」，主人不再认了，项目里不该还挂着他的名字。
-- ⚠ 不改 `kg_cascade_claim_revocation` 本身（S6 等并行轮次可能也在改它）：另挂一个触发器，名字排在它前面
--   （PostgreSQL 同一事件的触发器按名字字母序执行）——那个函数会把连着原件的边全部软失效，排在它后面就找不到活边了。

-- ─────────────────────────────── 分享 ───────────────────────────────
CREATE OR REPLACE FUNCTION kg_share_claim_to_project(p jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_org     text := current_setting('app.current_org', true);
  v_user    text := current_setting('app.current_user_id', true);
  v_claim   text := p->>'claim_id';
  v_project text := p->>'project_id';
  v_id      text := p->>'action_id';
  v_role    text;
  v_src     record;
  v_copy    text;
  v_obj     record;
  v_pobj    text;
  n         int := 0;
BEGIN
  IF v_org IS NULL OR v_org = '' THEN RAISE EXCEPTION 'KG_NO_TENANT' USING ERRCODE = '42501'; END IF;
  IF NOT public.kernel_org_is_writable(v_org) THEN
    RAISE EXCEPTION 'KG_ORG_FROZEN: organization % is read-only', v_org USING ERRCODE = '42501';
  END IF;
  IF v_user IS NULL OR v_user = '' THEN RAISE EXCEPTION 'KG_ACTOR_NOT_HUMAN: no signed-in user' USING ERRCODE = '42501'; END IF;
  IF NOT public.kg_scope_enabled('project') THEN RAISE EXCEPTION 'KG_SCOPE_NOT_ENABLED: project' USING ERRCODE = '42501'; END IF;

  -- 锁顺序与其余个人空间 / 项目记忆写入一致：先个人空间，再项目。
  PERFORM pg_advisory_xact_lock(hashtext('kg_scope:' || v_org || '|personal|' || v_user));
  SELECT * INTO v_src FROM claims c
   WHERE c.org_id = v_org AND c.id = v_claim AND c.scope_kind = 'personal' AND c.scope_id = v_user
     AND c.revoked_at IS NULL AND c.status <> 'superseded'
   FOR UPDATE;
  -- 别人的个人结论、不存在、已失效：同一个出口（不泄露存在性）。
  IF NOT FOUND THEN RAISE EXCEPTION 'KG_CLAIM_NOT_FOUND' USING ERRCODE = '23503'; END IF;

  SELECT m.project_role INTO v_role FROM project_memberships m
   WHERE m.org_id = v_org AND m.project_id = v_project AND m.user_id = v_user;
  IF NOT FOUND THEN RAISE EXCEPTION 'KG_PROJECT_NOT_FOUND' USING ERRCODE = '23503'; END IF;
  IF v_role = 'observer' OR NOT public.kernel_project_is_writable(v_project) THEN
    RAISE EXCEPTION 'KG_PROJECT_READ_ONLY: observers and archived projects take no new project memory' USING ERRCODE = '42501';
  END IF;
  IF v_src.status = 'contested' THEN
    RAISE EXCEPTION 'KG_CONTESTED_NEEDS_RESOLUTION: resolve the conflict before sharing' USING ERRCODE = '23514';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('kg_scope:' || v_org || '|project|' || v_project));
  -- 已经分享过（项目里有一份活的、derived_from 连着它的副本）⇒ 幂等，交回那一份。
  SELECT pc.id INTO v_copy FROM ontology_edges d JOIN claims pc ON pc.id = d.src_id AND pc.org_id = d.org_id
   WHERE d.org_id = v_org AND d.src_kind = 'claim' AND d.dst_kind = 'claim' AND d.dst_id = v_claim
     AND d.relation = 'derived_from' AND d.status = 'active'
     AND pc.scope_kind = 'project' AND pc.scope_id = v_project AND pc.revoked_at IS NULL AND pc.status <> 'superseded'
   LIMIT 1;
  IF v_copy IS NOT NULL THEN
    RETURN jsonb_build_object('project_claim_id', v_copy, 'outcome', 'already_shared');
  END IF;

  -- 派生副本：主人显式分享本身就是确认（同 R7 / F11：人点了晋升 ⇒ accepted），原件的状态不动。
  v_copy := v_id || '-s';
  INSERT INTO claims (id, org_id, statement, status, tsv, claim_kind, confidence, created_by, reviewed_by,
                      scope_kind, scope_id, valid_from)
  VALUES (v_copy, v_org, v_src.statement, 'accepted', to_tsvector('simple', v_src.statement), v_src.claim_kind,
          1, 'human', v_user, 'project', v_project, now());

  FOR v_obj IN
    SELECT o.* FROM ontology_edges e JOIN ontology_objects o ON o.id = e.dst_id AND o.org_id = e.org_id
     WHERE e.org_id = v_org AND e.src_kind = 'claim' AND e.src_id = v_claim AND e.dst_kind = 'object'
       AND e.relation IN ('about', 'decided_by') AND e.status = 'active'
  LOOP
    n := n + 1;
    SELECT po.id INTO v_pobj FROM ontology_objects po
     WHERE po.org_id = v_org AND po.scope_kind = 'project' AND po.scope_id = v_project AND po.merged_into IS NULL
       AND po.object_kind = v_obj.object_kind AND lower(po.name) = lower(v_obj.name)
     LIMIT 1;
    IF v_pobj IS NULL THEN
      v_pobj := v_id || '-o' || n;
      INSERT INTO ontology_objects (id, org_id, scope_kind, scope_id, object_kind, name, aliases, created_by)
      VALUES (v_pobj, v_org, 'project', v_project, v_obj.object_kind, v_obj.name, v_obj.aliases, 'human');
    END IF;
    INSERT INTO ontology_edges (id, org_id, src_kind, src_id, dst_kind, dst_id, relation, created_by, scope_kind, scope_id)
    SELECT v_id || '-e' || n, v_org, 'claim', v_copy, 'object', v_pobj, e.relation, 'human', 'project', v_project
      FROM ontology_edges e WHERE e.org_id = v_org AND e.src_kind = 'claim' AND e.src_id = v_claim
       AND e.dst_kind = 'object' AND e.dst_id = v_obj.id AND e.status = 'active' LIMIT 1
    ON CONFLICT (id) DO NOTHING;
    v_pobj := NULL;
  END LOOP;

  -- 证据跟过去：原话被删（F07 ①）⇒ 副本同样失效。项目成员读来源时按会话可见性逐个过滤
  -- （projectClaimSources → evidenceThreadSources），主人个人对话里的原话不会漏给他们。
  INSERT INTO claim_message_evidence (claim_id, org_id, message_id, stance, excerpt)
    SELECT v_copy, org_id, message_id, stance, excerpt FROM claim_message_evidence WHERE claim_id = v_claim
  ON CONFLICT DO NOTHING;
  INSERT INTO claim_segments (claim_id, org_id, segment_id, stance)
    SELECT v_copy, org_id, segment_id, stance FROM claim_segments WHERE claim_id = v_claim
  ON CONFLICT DO NOTHING;
  INSERT INTO ontology_edges (id, org_id, src_kind, src_id, dst_kind, dst_id, relation, created_by, scope_kind, scope_id)
  VALUES (v_id || '-d', v_org, 'claim', v_copy, 'claim', v_claim, 'derived_from', 'human', 'project', v_project);

  INSERT INTO ontology_actions (id, org_id, scope_kind, scope_id, actor_kind, actor_id, action_type, payload, outcome)
  VALUES (v_id, v_org, 'project', v_project, 'human', v_user, 'shareToProject',
          jsonb_build_object('project_id', v_project,
                             'claims', jsonb_build_array(jsonb_build_object('id', v_claim), jsonb_build_object('id', v_copy))),
          'accepted');
  RETURN jsonb_build_object('project_claim_id', v_copy, 'outcome', 'shared');
END
$$;

-- ─────────────────────────────── 撤回分享 ───────────────────────────────
-- 只有主人能撤；不要求仍是项目成员（被移出项目的人仍能收回自己分享出去的东西）。
-- 没有活的副本（没分享过 / 已撤回 / 已随原件失效）⇒ KG_CLAIM_NOT_FOUND。
CREATE OR REPLACE FUNCTION kg_unshare_claim_from_project(p jsonb) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_org     text := current_setting('app.current_org', true);
  v_user    text := current_setting('app.current_user_id', true);
  v_claim   text := p->>'claim_id';
  v_project text := p->>'project_id';
  v_id      text := p->>'action_id';
  v_copy    text;
BEGIN
  IF v_org IS NULL OR v_org = '' THEN RAISE EXCEPTION 'KG_NO_TENANT' USING ERRCODE = '42501'; END IF;
  IF NOT public.kernel_org_is_writable(v_org) THEN
    RAISE EXCEPTION 'KG_ORG_FROZEN: organization % is read-only', v_org USING ERRCODE = '42501';
  END IF;
  IF v_user IS NULL OR v_user = '' THEN RAISE EXCEPTION 'KG_ACTOR_NOT_HUMAN: no signed-in user' USING ERRCODE = '42501'; END IF;

  PERFORM pg_advisory_xact_lock(hashtext('kg_scope:' || v_org || '|personal|' || v_user));
  IF NOT EXISTS (SELECT 1 FROM claims c WHERE c.org_id = v_org AND c.id = v_claim AND c.scope_kind = 'personal' AND c.scope_id = v_user) THEN
    RAISE EXCEPTION 'KG_CLAIM_NOT_FOUND' USING ERRCODE = '23503';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('kg_scope:' || v_org || '|project|' || v_project));
  SELECT pc.id INTO v_copy FROM ontology_edges d JOIN claims pc ON pc.id = d.src_id AND pc.org_id = d.org_id
   WHERE d.org_id = v_org AND d.src_kind = 'claim' AND d.dst_kind = 'claim' AND d.dst_id = v_claim
     AND d.relation = 'derived_from' AND d.status = 'active'
     AND pc.scope_kind = 'project' AND pc.scope_id = v_project AND pc.revoked_at IS NULL AND pc.status <> 'superseded'
   LIMIT 1
   FOR UPDATE OF pc;
  IF v_copy IS NULL THEN RAISE EXCEPTION 'KG_CLAIM_NOT_FOUND: not shared to this project' USING ERRCODE = '23503'; END IF;

  -- 失效项目副本 ⇒ F07 kg_cascade_claim_revocation 把连着它的边（derived_from / about …）一起软失效。
  UPDATE claims SET status = 'superseded', revoked_at = now(), revocation_reason = 'user_revoked', updated_at = now()
   WHERE org_id = v_org AND id = v_copy;

  INSERT INTO ontology_actions (id, org_id, scope_kind, scope_id, actor_kind, actor_id, action_type, payload, outcome)
  VALUES (v_id, v_org, 'project', v_project, 'human', v_user, 'unshareFromProject',
          jsonb_build_object('project_id', v_project,
                             'claims', jsonb_build_array(jsonb_build_object('id', v_claim), jsonb_build_object('id', v_copy))),
          'accepted');
  RETURN v_copy;
END
$$;

-- ─────────────────────────────── 出处：谁分享的 ───────────────────────────────
-- 一条项目结论若由某人的个人结论分享而来（活的 derived_from 边指向一条个人空间结论），回那个人的显示名；
-- 否则 NULL（R7 从项目线程记进来的、边已失效的）。只回显示名：不回原件 id、不回原件内容。
-- 取名走 credentials（无租户表）；那人没有凭据行 ⇒ 空串（界面说「项目成员」），与「不是分享来的」(NULL) 分开。
CREATE OR REPLACE FUNCTION kg_share_author_name(p_claim text) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT coalesce((SELECT cr.display_name FROM public.credentials cr WHERE cr.user_id = src.scope_id), '')
    FROM public.claims c
    JOIN public.ontology_edges d ON d.org_id = c.org_id AND d.src_kind = 'claim' AND d.src_id = c.id
     AND d.dst_kind = 'claim' AND d.relation = 'derived_from' AND d.status = 'active'
    JOIN public.claims src ON src.org_id = d.org_id AND src.id = d.dst_id AND src.scope_kind = 'personal'
   WHERE c.org_id = current_setting('app.current_org', true) AND c.id = p_claim AND c.scope_kind = 'project'
   LIMIT 1
$$;

-- ─────────────────────────────── 原件失效 ⇒ 分享出去的副本失效 ───────────────────────────────
CREATE OR REPLACE FUNCTION kg_cascade_personal_share() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF NEW.scope_kind IS DISTINCT FROM 'personal' OR OLD.revoked_at IS NOT NULL OR NEW.revoked_at IS NULL THEN RETURN NULL; END IF;
  UPDATE public.claims pc
     SET status = 'superseded', revoked_at = now(), revocation_reason = coalesce(NEW.revocation_reason, 'user_revoked'), updated_at = now()
   WHERE pc.org_id = NEW.org_id AND pc.scope_kind = 'project' AND pc.revoked_at IS NULL
     AND EXISTS (SELECT 1 FROM public.ontology_edges d
                  WHERE d.org_id = pc.org_id AND d.src_kind = 'claim' AND d.src_id = pc.id AND d.relation = 'derived_from'
                    AND d.dst_kind = 'claim' AND d.dst_id = NEW.id AND d.status = 'active');
  RETURN NULL;
END
$$;

-- 名字排在 kg_cascade_claim_revocation_trg 之前（见文件头）。
DROP TRIGGER IF EXISTS kg_cascade_0_personal_share_trg ON claims;
CREATE TRIGGER kg_cascade_0_personal_share_trg AFTER UPDATE OF revoked_at ON claims
  FOR EACH ROW EXECUTE FUNCTION kg_cascade_personal_share();

REVOKE ALL ON FUNCTION kg_share_claim_to_project(jsonb), kg_unshare_claim_from_project(jsonb), kg_share_author_name(text),
  kg_cascade_personal_share() FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_rw') THEN
    GRANT EXECUTE ON FUNCTION kg_share_claim_to_project(jsonb), kg_unshare_claim_from_project(jsonb), kg_share_author_name(text) TO app_rw;
  END IF;
END $$;

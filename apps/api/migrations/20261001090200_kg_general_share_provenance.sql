-- General project sharing retains author provenance and personal undo behavior.
CREATE OR REPLACE FUNCTION kg_share_author_name(p_claim text) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT coalesce((SELECT cr.display_name FROM public.credentials cr WHERE cr.user_id = src.scope_id), '')
    FROM public.claims c
    JOIN public.ontology_edges d ON d.org_id = c.org_id AND d.src_kind = 'claim' AND d.src_id = c.id
     AND d.dst_kind = 'claim' AND d.relation = 'derived_from' AND d.status = 'active'
    JOIN public.claims src ON src.org_id = d.org_id AND src.id = d.dst_id AND src.scope_kind = 'personal'
   WHERE c.org_id = current_setting('app.current_org', true) AND c.id = p_claim AND c.scope_kind = 'project'
     -- 审查 F2：只回答这个项目的成员（调用方是召回 / 项目大脑，都先设了 app.current_user_id = 查看者）。
     AND (EXISTS (SELECT 1 FROM public.project_memberships m
                  WHERE m.org_id = c.org_id AND m.project_id = c.scope_id
                    AND m.user_id = current_setting('app.current_user_id', true))
          OR EXISTS (SELECT 1 FROM public.general_project_members gm JOIN public.projects pr ON pr.org_id = gm.org_id AND pr.id = gm.project_id
                       WHERE gm.org_id = c.org_id AND gm.project_id = c.scope_id AND pr.kind = 'general'
                         AND gm.user_id = current_setting('app.current_user_id', true)))
   LIMIT 1
$$;

-- ─────────────────────────────── 原件失效 / 恢复 ⇒ 分享出去的副本跟着走 ───────────────────────────────
-- 与其他轮次的交互（跨 PR 迁移分析，2026-09-27）。原因码都是普通文本，按字面判断，对方未合入时这些分支只是不会被走到：
--   ① 原件被失效（任何原因，含 S4 #4361 的 'user_forgot'「忘掉」）⇒ 项目副本失效，原因记成本文件独有的
--      'personal_source_revoked'——只有带这个原因的副本才会在 ③ 被恢复（主人自己「撤回分享」的 user_revoked 不会）。
--   ② S8 #4491 整合（kg_consolidation_apply_merges）把重复的那条以 'consolidated_duplicate' 失效，事实仍由留下的那条承载
--      ⇒ 副本**不失效**，把它的 derived_from 改挂到留下的那条（同一人个人空间里：先认 S8 在同一事务里设的
--      `kg.consolidation_keep`，再认 supersedes_claim_id 指向败者的，否则认 kg_claim_basis 说法相同的活结论）。找不到留下的那条 ⇒ 什么都不做（副本保留；指向败者的边随 F07 软失效，
--      之后项目大脑不再标分享人——宁可少一个出处标签，也不因为「整理重复」把同事看得到的东西撤掉）。
--   ③ 撤销把原件的 revoked_at 放回 NULL（S4 kg_undo_memory_card、S8 kg_consolidation_undo）⇒ 恢复 ① 撤掉的副本：
--      副本回到 accepted，它被软失效的 derived_from 边、指向活实体的 about/decided_by 边重新生效。条件：主人仍是项目
--      非观察者成员、项目未归档、这个项目里还没有同一原件的另一份活副本（主人在这期间重新分享过 ⇒ 不再复活旧的）。
--   ④ S6 #4492 的 kg_copy_inherits_time 会在插入 derived_from 边时把 valid_to / due_at / todo_status 抄到副本上——
--      与这里无冲突；② 改挂新边时它照常生效。
CREATE OR REPLACE FUNCTION kg_cascade_personal_share() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_kept text;
  r      record;
BEGIN
  IF NEW.scope_kind IS DISTINCT FROM 'personal' THEN RETURN NULL; END IF;

  IF OLD.revoked_at IS NULL AND NEW.revoked_at IS NOT NULL THEN
    IF NEW.revocation_reason = 'consolidated_duplicate' THEN
      -- S8（#4491）在失效败者之前于同一事务里设 `kg.consolidation_keep` = 留下的那条：先认它（须是同一人的活个人结论），
      -- 说法不完全相同的整合也能改挂；没设 / 不合格 ⇒ 退回下面的说法匹配。
      SELECT k.id INTO v_kept FROM public.claims k
       WHERE k.org_id = NEW.org_id AND k.id = nullif(current_setting('kg.consolidation_keep', true), '') AND k.id <> NEW.id
         AND k.scope_kind = 'personal' AND k.scope_id = NEW.scope_id AND k.revoked_at IS NULL AND k.status <> 'superseded';
      IF v_kept IS NULL THEN
      SELECT k.id INTO v_kept FROM public.claims k
       WHERE k.org_id = NEW.org_id AND k.scope_kind = 'personal' AND k.scope_id = NEW.scope_id AND k.id <> NEW.id
         AND k.revoked_at IS NULL AND k.status <> 'superseded'
         AND (k.supersedes_claim_id = NEW.id OR public.kg_claim_basis(k.statement) = public.kg_claim_basis(NEW.statement))
       ORDER BY (k.supersedes_claim_id IS NOT DISTINCT FROM NEW.id) DESC, k.created_at, k.id
       LIMIT 1;
      END IF;
      IF v_kept IS NOT NULL THEN
        -- 不看边是否还活着（审查 F1：不依赖本触发器排在 F07 之前）；已经挂到别处的副本（有指向别的结论的活 derived_from）不动。
        FOR r IN
          SELECT DISTINCT ON (pc.id) pc.id AS copy_id, d.org_id, d.created_by, d.scope_kind, d.scope_id
            FROM public.ontology_edges d JOIN public.claims pc ON pc.id = d.src_id AND pc.org_id = d.org_id
           WHERE d.org_id = NEW.org_id AND d.src_kind = 'claim' AND d.dst_kind = 'claim' AND d.dst_id = NEW.id
             AND d.relation = 'derived_from' AND pc.scope_kind = 'project' AND pc.revoked_at IS NULL
             AND NOT EXISTS (SELECT 1 FROM public.ontology_edges o
                              WHERE o.org_id = pc.org_id AND o.src_kind = 'claim' AND o.src_id = pc.id AND o.relation = 'derived_from'
                                AND o.dst_kind = 'claim' AND o.dst_id <> NEW.id AND o.status = 'active')
           ORDER BY pc.id, d.created_at DESC
        LOOP
          UPDATE public.ontology_edges SET status = 'invalidated', invalidated_at = now()
           WHERE org_id = r.org_id AND src_kind = 'claim' AND src_id = r.copy_id AND dst_kind = 'claim' AND dst_id = NEW.id
             AND relation = 'derived_from' AND status = 'active';
          INSERT INTO public.ontology_edges (id, org_id, src_kind, src_id, dst_kind, dst_id, relation, created_by, scope_kind, scope_id)
          VALUES (r.copy_id || '-k-' || v_kept, r.org_id, 'claim', r.copy_id, 'claim', v_kept, 'derived_from', r.created_by, r.scope_kind, r.scope_id)
          -- A→B、撤销、B→A、再 A→B：同一条改挂边重新生效，而不是留着失效的那条（收敛）。
          ON CONFLICT (id) DO UPDATE SET status = 'active', invalidated_at = NULL;
        END LOOP;
      END IF;
      RETURN NULL;
    END IF;

    -- 边状态不作条件（审查 F1：F07 先跑、把边软失效了也照样找得到）；改挂到别的结论上的副本（② 之后）不跟着这一条走。
    UPDATE public.claims pc
       SET status = 'superseded', revoked_at = now(), revocation_reason = 'personal_source_revoked', updated_at = now()
     WHERE pc.org_id = NEW.org_id AND pc.scope_kind = 'project' AND pc.revoked_at IS NULL
       AND EXISTS (SELECT 1 FROM public.ontology_edges d
                    WHERE d.org_id = pc.org_id AND d.src_kind = 'claim' AND d.src_id = pc.id AND d.relation = 'derived_from'
                      AND d.dst_kind = 'claim' AND d.dst_id = NEW.id)
       AND NOT EXISTS (SELECT 1 FROM public.ontology_edges o
                        WHERE o.org_id = pc.org_id AND o.src_kind = 'claim' AND o.src_id = pc.id AND o.relation = 'derived_from'
                          AND o.dst_kind = 'claim' AND o.dst_id <> NEW.id AND o.status = 'active');
    RETURN NULL;
  END IF;

  IF OLD.revoked_at IS NOT NULL AND NEW.revoked_at IS NULL THEN
    FOR r IN
      SELECT pc.id AS copy_id, pc.scope_id AS project_id, d.id AS edge_id, pc.revoked_at AS copy_revoked_at
        FROM public.claims pc
        JOIN public.ontology_edges d ON d.org_id = pc.org_id AND d.src_kind = 'claim' AND d.src_id = pc.id
         AND d.dst_kind = 'claim' AND d.dst_id = NEW.id AND d.relation = 'derived_from'
       WHERE pc.org_id = NEW.org_id AND pc.scope_kind = 'project' AND pc.revoked_at IS NOT NULL
         AND pc.revocation_reason = 'personal_source_revoked'
         -- 这份副本当时挂的就是这一条（最近的 derived_from 指向它）：② 改挂过、后来随留下的那条失效的副本，不因败者回来而复活。
         AND (SELECT d3.dst_id FROM public.ontology_edges d3
               WHERE d3.org_id = pc.org_id AND d3.src_kind = 'claim' AND d3.src_id = pc.id AND d3.relation = 'derived_from'
                 AND d3.dst_kind = 'claim'
               ORDER BY d3.created_at DESC, d3.id DESC LIMIT 1) = NEW.id
       ORDER BY pc.revoked_at DESC, pc.id
    LOOP
      CONTINUE WHEN EXISTS (
        SELECT 1 FROM public.ontology_edges d2 JOIN public.claims c2 ON c2.id = d2.src_id AND c2.org_id = d2.org_id
         WHERE d2.org_id = NEW.org_id AND d2.src_kind = 'claim' AND d2.dst_kind = 'claim' AND d2.dst_id = NEW.id
           AND d2.relation = 'derived_from' AND d2.status = 'active'
           AND c2.scope_kind = 'project' AND c2.scope_id = r.project_id AND c2.revoked_at IS NULL);
      CONTINUE WHEN NOT EXISTS (
        SELECT 1 FROM public.project_memberships m
         WHERE m.org_id = NEW.org_id AND m.project_id = r.project_id AND m.user_id = NEW.scope_id AND m.project_role <> 'observer'
        UNION ALL SELECT 1 FROM public.general_project_members gm JOIN public.projects pr ON pr.org_id = gm.org_id AND pr.id = gm.project_id
         WHERE gm.org_id = NEW.org_id AND gm.project_id = r.project_id AND gm.user_id = NEW.scope_id
           AND pr.kind = 'general' AND gm.role IN ('owner', 'collaborator'));
      CONTINUE WHEN NOT public.kernel_project_is_writable(r.project_id);
      UPDATE public.claims SET status = 'accepted', revoked_at = NULL, revocation_reason = NULL, updated_at = now()
       WHERE org_id = NEW.org_id AND id = r.copy_id;
      UPDATE public.ontology_edges e SET status = 'active', invalidated_at = NULL
       WHERE e.org_id = NEW.org_id AND e.src_kind = 'claim' AND e.src_id = r.copy_id AND e.status = 'invalidated'
         AND (e.id = r.edge_id
              -- 只恢复随副本失效一起被收掉的那些（失效时刻不早于副本的 revoked_at），更早就失效的边不带回来。
              OR (e.dst_kind = 'object' AND e.relation IN ('about', 'decided_by') AND e.invalidated_at >= r.copy_revoked_at
                  AND EXISTS (SELECT 1 FROM public.ontology_objects o WHERE o.org_id = e.org_id AND o.id = e.dst_id AND o.merged_into IS NULL)));
    END LOOP;
  END IF;
  RETURN NULL;
END
$$;


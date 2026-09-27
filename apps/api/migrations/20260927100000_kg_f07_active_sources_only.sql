/*
 * Issue #4302 review（第 9 轮）—— F07 级联只数**活的** derived_from 边。
 *
 * 20260924250000_kg_f07_invalidation.sql 里 ② 判断「L1 副本的来源是否都已失效」时，数的是 derived_from 边本身，
 * 不看边的状态。#4283 之后多了一种「来源」：撤销自动记入（kg_undo_auto_copy）在副本还有别的活来源时只把那一条边
 * 软失效（detached），来源结论本身仍活着。旧口径把这条被摘掉的来源仍当成「活来源」⇒ 其余来源全部被忘掉后副本也不失效，
 * 永远留在长期记忆里；/brain 的「忘掉这条」因此会报成功、却只忘掉了对话里那条（review 复现）。
 *
 * 新口径（其余不变）：
 *   - 「由它而来」：只看**活的** derived_from 边（被摘掉的来源已不是这份副本的来源，忘掉它不牵动副本）；
 *   - 「还有别的活来源」：边是活的，且那条来源结论没失效。
 * 这与 kg_undo_auto_copy 判「还有别的活来源」、personalClaimOrigins（/brain 的来源）已经在用的口径是同一个。
 * 失效是软的：行保留、审计链不断；只 CREATE OR REPLACE 函数，触发器与权限沿用原迁移。
 */
CREATE OR REPLACE FUNCTION kg_cascade_claim_revocation() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF NEW.scope_kind IS NULL OR OLD.revoked_at IS NOT NULL OR NEW.revoked_at IS NULL THEN RETURN NULL; END IF;
  -- L1 副本：由它而来（活的 derived_from 边），且再没有别的活来源（活边 + 来源结论未失效）才失效。
  -- 先于下面的边失效：此刻指向 NEW 的 derived_from 边还是活的，NEW 本身已失效（revoked_at），不算活来源。
  UPDATE public.claims p
     SET status = 'superseded', revoked_at = now(), revocation_reason = NEW.revocation_reason, updated_at = now()
   WHERE p.org_id = NEW.org_id AND p.scope_kind = 'personal' AND p.revoked_at IS NULL
     AND EXISTS (SELECT 1 FROM public.ontology_edges d
                  WHERE d.org_id = p.org_id AND d.src_kind = 'claim' AND d.src_id = p.id
                    AND d.relation = 'derived_from' AND d.dst_kind = 'claim' AND d.dst_id = NEW.id AND d.status = 'active')
     AND NOT EXISTS (SELECT 1 FROM public.ontology_edges d JOIN public.claims src ON src.id = d.dst_id AND src.org_id = d.org_id
                      WHERE d.org_id = p.org_id AND d.src_kind = 'claim' AND d.src_id = p.id
                        AND d.relation = 'derived_from' AND d.dst_kind = 'claim' AND d.status = 'active'
                        AND src.revoked_at IS NULL);
  UPDATE public.ontology_edges e
     SET status = 'invalidated', invalidated_at = now()
   WHERE e.org_id = NEW.org_id AND e.status = 'active'
     AND ((e.src_kind = 'claim' AND e.src_id = NEW.id) OR (e.dst_kind = 'claim' AND e.dst_id = NEW.id));
  RETURN NULL;
END
$$;

REVOKE ALL ON FUNCTION kg_cascade_claim_revocation() FROM PUBLIC;

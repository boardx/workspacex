/*
 * Phase 18 F07 —— 删除与失效传播（uc-18-5 R3 / R4 / R7，V1–V4）。
 *
 * 原则：召回的权威过滤在 canonical（claims.revoked_at / status、ontology_edges.status），不依赖 AGE
 * 或向量已清理（R7-1）；失效是软的，行保留、审计链不断（R7-2）。AGE 由 F04 的投影 outbox 跟上：
 * 下面每一处 UPDATE 都经 kg_enqueue_projection_trg 排队，AGE 不可用时 canonical 已经生效（R4-E1）。
 *
 * 三个入口，一个出口：
 *   ① 证据被删（消息 / 会话硬删经外键级联掉 claim_message_evidence；附件删除经下面的
 *      kg_invalidate_segment_evidence 删掉 claim_segments）⇒ 结论还剩支持证据就只少一条（R3-2 第二支），
 *      一条不剩 ⇒ 结论失效，原因 source_deleted（R3-2 第一支）。
 *   ② 结论失效（上一条，或 F10 用户「忘掉」）⇒ 连着它的边软失效（R3-3）；由它晋升出去的
 *      个人空间副本（derived_from 指向它）在所有来源都失效时一并失效（R3-6 / V4）。
 *   ③ 消息被删 ⇒ 以它为端点的边软失效。
 * 只处理带作用域的本体行（scope_kind IS NOT NULL）：phase-01 的无作用域结论不在本 UC 范围内。
 */

-- ─────────────────────────────── ① 证据没了 ⇒ 结论失效 ───────────────────────────────
CREATE OR REPLACE FUNCTION kg_revoke_unsupported_claim() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF OLD.stance <> 'supporting' THEN RETURN NULL; END IF;
  -- 外键级联的 AFTER 行触发器在整条语句结束后才跑：同一次删除里的其他证据此时都已经不在了。
  UPDATE public.claims c
     SET status = 'superseded', revoked_at = now(), revocation_reason = 'source_deleted', updated_at = now()
   WHERE c.id = OLD.claim_id AND c.org_id = OLD.org_id AND c.scope_kind IS NOT NULL AND c.revoked_at IS NULL
     AND NOT EXISTS (SELECT 1 FROM public.claim_message_evidence e WHERE e.claim_id = c.id AND e.stance = 'supporting')
     AND NOT EXISTS (SELECT 1 FROM public.claim_segments s WHERE s.claim_id = c.id AND s.stance = 'supporting');
  RETURN NULL;
END
$$;

DROP TRIGGER IF EXISTS kg_revoke_unsupported_claim_trg ON claim_message_evidence;
CREATE TRIGGER kg_revoke_unsupported_claim_trg AFTER DELETE ON claim_message_evidence
  FOR EACH ROW EXECUTE FUNCTION kg_revoke_unsupported_claim();
DROP TRIGGER IF EXISTS kg_revoke_unsupported_claim_trg ON claim_segments;
CREATE TRIGGER kg_revoke_unsupported_claim_trg AFTER DELETE ON claim_segments
  FOR EACH ROW EXECUTE FUNCTION kg_revoke_unsupported_claim();

-- ─────────────────────────────── ② 结论失效 ⇒ 边 + L1 副本 ───────────────────────────────
CREATE OR REPLACE FUNCTION kg_cascade_claim_revocation() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF NEW.scope_kind IS NULL OR OLD.revoked_at IS NOT NULL OR NEW.revoked_at IS NULL THEN RETURN NULL; END IF;
  -- L1 副本：所有 derived_from 来源都已失效才失效（合并过多个会话的那条，还有别的来源就留着）。
  -- 先于下面的边失效：判断「来源」看的是 derived_from 边本身，与它是否已失效无关。
  UPDATE public.claims p
     SET status = 'superseded', revoked_at = now(), revocation_reason = NEW.revocation_reason, updated_at = now()
   WHERE p.org_id = NEW.org_id AND p.scope_kind = 'personal' AND p.revoked_at IS NULL
     AND EXISTS (SELECT 1 FROM public.ontology_edges d
                  WHERE d.org_id = p.org_id AND d.src_kind = 'claim' AND d.src_id = p.id
                    AND d.relation = 'derived_from' AND d.dst_kind = 'claim' AND d.dst_id = NEW.id)
     AND NOT EXISTS (SELECT 1 FROM public.ontology_edges d JOIN public.claims src ON src.id = d.dst_id AND src.org_id = d.org_id
                      WHERE d.org_id = p.org_id AND d.src_kind = 'claim' AND d.src_id = p.id
                        AND d.relation = 'derived_from' AND d.dst_kind = 'claim' AND src.revoked_at IS NULL);
  UPDATE public.ontology_edges e
     SET status = 'invalidated', invalidated_at = now()
   WHERE e.org_id = NEW.org_id AND e.status = 'active'
     AND ((e.src_kind = 'claim' AND e.src_id = NEW.id) OR (e.dst_kind = 'claim' AND e.dst_id = NEW.id));
  RETURN NULL;
END
$$;

DROP TRIGGER IF EXISTS kg_cascade_claim_revocation_trg ON claims;
CREATE TRIGGER kg_cascade_claim_revocation_trg AFTER UPDATE OF revoked_at ON claims
  FOR EACH ROW EXECUTE FUNCTION kg_cascade_claim_revocation();

-- ─────────────────────────────── ③ 消息被删 ⇒ 以它为端点的边 ───────────────────────────────
CREATE OR REPLACE FUNCTION kg_invalidate_message_edges() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  UPDATE public.ontology_edges e
     SET status = 'invalidated', invalidated_at = now()
    FROM gone g
   WHERE e.org_id = g.org_id AND e.status = 'active'
     AND ((e.src_kind = 'chat_message' AND e.src_id = g.id) OR (e.dst_kind = 'chat_message' AND e.dst_id = g.id));
  RETURN NULL;
END
$$;

DROP TRIGGER IF EXISTS kg_invalidate_message_edges_trg ON chat_messages;
CREATE TRIGGER kg_invalidate_message_edges_trg AFTER DELETE ON chat_messages
  REFERENCING OLD TABLE AS gone FOR EACH STATEMENT EXECUTE FUNCTION kg_invalidate_message_edges();

-- ─────────────────────────────── 附件删除（files 束出站端口 invalidateOntologyEdges）───────────────────────────────
-- 软失效替换原来按片段硬删边（R3-3）；同时去掉这些片段作为证据的 claim_segments，交给 ① 判断结论是否失效。
-- 带作用域的边 / 证据只能经 kg_* 函数改（F03 写守卫），所以这里是 SECURITY DEFINER：org 取自会话、
-- 片段按 org 与版本限定；版本属于哪个附件由调用方（pg-deletion-repository）先核对。
CREATE OR REPLACE FUNCTION kg_invalidate_segment_evidence(p_version_ids text[]) RETURNS text[]
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_org  text := current_setting('app.current_org', true);
  v_segs text[];
  v_ids  text[];
BEGIN
  IF v_org IS NULL OR v_org = '' THEN RAISE EXCEPTION 'KG_NO_TENANT' USING ERRCODE = '42501'; END IF;
  SELECT coalesce(array_agg(s.id), '{}') INTO v_segs
    FROM public.segments s WHERE s.org_id = v_org AND s.artifact_version_id = ANY(p_version_ids);
  UPDATE public.ontology_edges e
     SET status = 'invalidated', invalidated_at = now()
   WHERE e.org_id = v_org AND e.status = 'active'
     AND ((e.src_kind = 'segment' AND e.src_id = ANY(v_segs)) OR (e.dst_kind = 'segment' AND e.dst_id = ANY(v_segs)));
  -- 返回这些片段上**全部**已失效的边（含之前那次调用失效的）：端口契约要求同参两次结果一致
  -- （retryCascade 依赖），软失效的行还在，正好能做到；也顺带消除「空集 = 没干活」的歧义（files FS13）。
  SELECT coalesce(array_agg(e.id ORDER BY e.id), '{}') INTO v_ids FROM public.ontology_edges e
   WHERE e.org_id = v_org AND e.status = 'invalidated'
     AND ((e.src_kind = 'segment' AND e.src_id = ANY(v_segs)) OR (e.dst_kind = 'segment' AND e.dst_id = ANY(v_segs)));
  DELETE FROM public.claim_segments cs WHERE cs.org_id = v_org AND cs.segment_id = ANY(v_segs);
  RETURN v_ids;
END
$$;

REVOKE ALL ON FUNCTION kg_invalidate_segment_evidence(text[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION kg_revoke_unsupported_claim() FROM PUBLIC;
REVOKE ALL ON FUNCTION kg_cascade_claim_revocation() FROM PUBLIC;
REVOKE ALL ON FUNCTION kg_invalidate_message_edges() FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_rw') THEN
    GRANT EXECUTE ON FUNCTION kg_invalidate_segment_evidence(text[]) TO app_rw;
  END IF;
END
$$;

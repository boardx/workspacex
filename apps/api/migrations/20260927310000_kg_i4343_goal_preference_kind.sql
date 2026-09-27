/*
 * issue #4343（人类决定 2026-09-27）—— 新增结论类型 `goal`（目标 / 意图）与 `preference`（偏好）。
 *
 * 真实现象：devapp 个人会话里说「我的目标是探索未来教育」，抽取跑完（状态「已整理到最新」）却一条也没记下——
 * 结论类型只有 fact / hypothesis / decision / todo / risk 五个，抽取 prompt 也只问这五类，模型回空。
 *
 * 本迁移只做两件事（其余路径不变）：
 *   1. 放宽 claims.claim_kind 的 CHECK，与契约 `KgClaimKind`（packages/contracts/src/chat-knowledge-graph.ts）逐项对账。
 *      DROP-then-ADD，同 20260924180000 的写法；原五值照旧合法，没有历史行需要回填。
 *   2. 重建 #4283 的 `kg_auto_copy_candidates`：`fresh` 每一项多带 `kind`（claim_kind，空按 fact）。
 *      应用层据此把**作者本人说的**目标 / 偏好也复制进作者本人的个人空间（`auto-copy-decisions.ts`）；
 *      「写进谁的空间」仍只由证据消息的作者决定（`kg_auto_copy_eligible` / `kg_auto_copy_author` 原样），
 *      只限个人线程、只限作者本人的话、撤销与去重路径全部沿用——本迁移不放宽任何安全边界。
 *      函数体除 `'kind'` 这一项外与 20260926131000 逐字相同；CREATE OR REPLACE 保留原有的 REVOKE / GRANT。
 *
 * 不做：#4290 的改口取代（kg_* supersede 函数只认 claim_kind = 'decision'）不扩到新类型——见 issue #4343 报告的开放项。
 */

ALTER TABLE claims DROP CONSTRAINT IF EXISTS claims_claim_kind_chk;
ALTER TABLE claims ADD CONSTRAINT claims_claim_kind_chk
  CHECK (claim_kind IS NULL OR claim_kind IN ('fact', 'hypothesis', 'decision', 'todo', 'risk', 'goal', 'preference'));

-- ─────────────────────────────── 候选（系统读）：fresh 多带 kind ───────────────────────────────
CREATE OR REPLACE FUNCTION kg_auto_copy_candidates(p_thread text, p_message text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_org    text := current_setting('app.current_org', true);
  v_caller text := nullif(current_setting('app.current_user_id', true), '');
  v_author text;
BEGIN
  IF v_org IS NULL OR v_org = '' THEN RAISE EXCEPTION 'KG_NO_TENANT' USING ERRCODE = '42501'; END IF;
  v_author := public.kg_auto_copy_author(v_org, p_thread, p_message);
  -- 人的请求只能为自己取候选；系统（没有登录用户）按作者取。
  IF v_author IS NULL OR (v_caller IS NOT NULL AND v_caller <> v_author) OR NOT public.kg_scope_enabled('personal') THEN
    RETURN jsonb_build_object('author', NULL, 'fresh', '[]'::jsonb, 'personal', '[]'::jsonb);
  END IF;
  RETURN jsonb_build_object(
    'author', v_author,
    'fresh', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'statement', c.statement, 'kind', coalesce(c.claim_kind, 'fact')) ORDER BY c.created_at, c.id), '[]'::jsonb)
                FROM public.claims c
               WHERE c.org_id = v_org AND c.scope_kind = 'chat_session' AND c.scope_id = p_thread
                 AND c.created_by = 'model' AND c.status = 'proposed' AND c.revoked_at IS NULL
                 AND EXISTS (SELECT 1 FROM public.claim_message_evidence e
                              WHERE e.org_id = v_org AND e.claim_id = c.id AND e.message_id = p_message AND e.stance = 'supporting')
                 AND public.kg_auto_copy_eligible(v_org, c.id, v_author)
                 -- 已经有过本人副本（不论现在还在不在、边是否已摘掉）⇒ 不再复制：撤销过的不会被重试带回来。
                 AND NOT EXISTS (SELECT 1 FROM public.ontology_edges d JOIN public.claims p ON p.id = d.src_id AND p.org_id = d.org_id
                                  WHERE d.org_id = v_org AND d.relation = 'derived_from' AND d.src_kind = 'claim'
                                    AND d.dst_kind = 'claim' AND d.dst_id = c.id
                                    AND p.scope_kind = 'personal' AND p.scope_id = v_author)),
    'personal', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'statement', c.statement) ORDER BY c.created_at, c.id), '[]'::jsonb)
                   FROM public.claims c
                  WHERE c.org_id = v_org AND c.scope_kind = 'personal' AND c.scope_id = v_author
                    AND c.revoked_at IS NULL AND c.status <> 'superseded'));
END
$$;

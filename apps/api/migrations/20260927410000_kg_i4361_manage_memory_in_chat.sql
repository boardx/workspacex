/*
 * Issue #4361（phase-18 S4）—— 在对话里管理记忆：「忘掉关于 X 的」「我改主意了，改成 Y」「你记得我什么」。
 *
 * 只作用于**请求者本人的个人空间**（人类决定，#4361「只作用于本人个人空间，不许触碰别人或项目层的记忆」）：
 * 个人空间 = 本人的长期记忆（L1，scope_kind = personal）+ 本人全部个人线程（project_id IS NULL）里记下的会话结论
 * ——与 F15 跨会话召回同一个口径（S0-2=A）。项目会话里的结论是项目层的记忆，这里一条都不碰。
 *
 * 本迁移做四件事（其余沿用 F17 20260924300000 / #4344 20260927300000，逐字不变的部分见各函数注释）：
 *
 *   ① `kg_open_memory_card` 重建：
 *      - 忘掉卡**只在个人线程**开（项目会话 ⇒ not_personal，同记住卡）。**这是对 F17 的行为变更**（F17 原来在项目会话里
 *        列本会话的项目结论）——按 #4361 的范围规则「待签核、先按已批准执行」，见 evidence/phase-18/r10/README.md 待签核清单；
 *      - 忘掉卡的条目可以来自本人**别的个人线程**（F15 跨会话召回到的那些），不再只限本会话：条目记下它所在的会话（threadId），
 *        点击时按那个会话核对。补上 F17 自己记下的已知缺口（evidence/kg-experience-eval/README.md「要到那个对话里去忘」）；
 *      - 新的一种卡 `overview`（「你记得我什么」）：只在个人线程开；条目是调用方按召回候选给的 id，这里逐条复核
 *        （本人个人空间的活结论）并记下种类（claim_kind）与来源会话；**没有任何动作**（点不了），读侧按现在的事实过滤；
 *   ② `kg_act_on_memory_card` 重建：忘掉一条长期记忆时连同它在本人个人对话里的原话一起忘掉（活的 derived_from；
 *      否则回到那个对话它还在）；forget 分支按条目各自的会话核对与上锁（多个会话锁按 id 排序，再个人空间锁——
 *      与 F10 / F11 / F16「先会话、后个人空间」同一顺序，多锁时按 id 排序不会与单锁的事务成环），落表前记下**撤销快照**
 *      （restore：选中的结论 + 由它们晋升出去、还活着的 L1 副本的当时状态，以及这次会被 F07 级联收掉的活边），
 *      每个会话各记一条审计（会话 revision 各自前进）；overview 卡上的任何决定 ⇒ KG_INVALID_REQUEST。remember 分支逐字不变；
 *   ③ `kg_undo_memory_card`（新）：人的动作（I-15），撤销一张已生效的忘掉卡——只恢复快照里、现在仍是「因忘掉而失效」
 *      （revocation_reason = user_forgot）的结论，恢复成当时的状态；会话结论另外要求原话还在（同 R8 kg_undo_supersede）；
 *      F07 级联收掉的边照快照放回（两端都还在）。一条都恢复不了 ⇒ KG_CARD_STALE。卡转 undone。
 *   ④ `kg_memory_manage_ok`（新，只读）：这条消息是不是个人线程的所有者本人在这个线程里说的——「改主意」那条路
 *      （应用层 change-mind.ts，复用 R8 的抽取 → 取代 → 自动记入流水线）开工前的范围闸门。
 *
 * 越权一律同一个出口：别人的卡（has_personal ⇒ RLS 读不到）、别人个人线程里的卡、不存在的卡——应用层都答 KG_CARD_NOT_FOUND（404），
 * 不泄露存在性（人类决定：跨账号 404）。这里的 KG_NOT_OWNER 只是纵深防御。
 */

-- ─────────────────────────────── 表 ───────────────────────────────
ALTER TABLE kg_memory_cards DROP CONSTRAINT IF EXISTS kg_memory_cards_kind_check;
ALTER TABLE kg_memory_cards ADD CONSTRAINT kg_memory_cards_kind_check CHECK (kind IN ('remember', 'forget', 'overview'));
ALTER TABLE kg_memory_cards DROP CONSTRAINT IF EXISTS kg_memory_cards_status_check;
ALTER TABLE kg_memory_cards ADD CONSTRAINT kg_memory_cards_status_check CHECK (status IN ('open', 'done', 'dismissed', 'undone'));
-- 忘掉卡的撤销快照：{ claims: [{ id, status }], edges: [id] }（同 R8 kg_supersede_notices.restore）
ALTER TABLE kg_memory_cards ADD COLUMN IF NOT EXISTS restore jsonb;
ALTER TABLE kg_memory_cards ADD COLUMN IF NOT EXISTS undone_by text;
ALTER TABLE kg_memory_cards ADD COLUMN IF NOT EXISTS undone_at timestamptz;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'kg_memory_cards_undone_check') THEN
    ALTER TABLE kg_memory_cards ADD CONSTRAINT kg_memory_cards_undone_check
      CHECK ((status = 'undone') = (undone_at IS NOT NULL) AND (status <> 'undone' OR kind = 'forget'));
  END IF;
END
$$;

-- ─────────────────────────────── 个人空间的判定 ───────────────────────────────
-- 这条会话是不是 p_user 本人的个人线程（没有项目、本人创建）。
CREATE OR REPLACE FUNCTION kg_is_personal_thread_of(p_org text, p_thread text, p_user text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT EXISTS (SELECT 1 FROM public.chat_threads t
                  WHERE t.org_id = p_org AND t.id = p_thread AND t.project_id IS NULL AND t.created_by = p_user)
$$;

-- 一条结论是不是 p_user 个人空间里的活结论：本人长期记忆（L1），或本人某个个人线程里的会话结论。
CREATE OR REPLACE FUNCTION kg_personal_space_claim_ok(p_org text, p_user text, p_claim text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.claims c
     WHERE c.org_id = p_org AND c.id = p_claim AND c.revoked_at IS NULL AND c.status <> 'superseded'
       AND ((c.scope_kind = 'personal' AND c.scope_id = p_user)
         OR (c.scope_kind = 'chat_session' AND public.kg_is_personal_thread_of(p_org, c.scope_id, p_user))))
$$;

-- 一条个人空间结论来自哪个会话：会话结论 = 它自己的会话；L1 = 由它的活 derived_from 边指向的、本人个人线程里最早那条的会话。
CREATE OR REPLACE FUNCTION kg_personal_claim_thread(p_org text, p_user text, p_claim text) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT coalesce(
    (SELECT c.scope_id FROM public.claims c WHERE c.org_id = p_org AND c.id = p_claim AND c.scope_kind = 'chat_session'),
    (SELECT src.scope_id FROM public.ontology_edges d
       JOIN public.claims src ON src.id = d.dst_id AND src.org_id = d.org_id
      WHERE d.org_id = p_org AND d.src_kind = 'claim' AND d.src_id = p_claim AND d.relation = 'derived_from'
        AND d.dst_kind = 'claim' AND d.status = 'active' AND src.scope_kind = 'chat_session'
        AND public.kg_is_personal_thread_of(p_org, src.scope_id, p_user)
      ORDER BY src.created_at, src.id LIMIT 1))
$$;

-- ④ 「改主意」的范围闸门：消息是个人线程所有者本人在这个线程里说的（人类消息、没有更窄的可见范围、不是转写原文）。
CREATE OR REPLACE FUNCTION kg_memory_manage_ok(p_thread text, p_message text, p_requester text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT public.kg_is_personal_thread_of(current_setting('app.current_org', true), p_thread, p_requester)
     AND EXISTS (SELECT 1 FROM public.chat_messages m
                  WHERE m.org_id = current_setting('app.current_org', true) AND m.id = p_message AND m.thread_id = p_thread
                    AND m.author_kind = 'human' AND m.author_id = p_requester
                    AND m.visibility_scope IS NULL AND m.raw_transcript = false)
$$;

-- ─────────────────────────────── ① 开卡（系统） ───────────────────────────────
-- p = { card_id, thread_id, run_id, message_id, requester, kind, origin?（缺省 user_message）, statement?（remember）,
--       target + claim_ids?（forget，按相关度排好）, claim_ids?（overview，按显示顺序） }
-- 返回 { outcome: opened | not_owner | not_from_message | not_personal | no_items, card_id?, reused? }；不开卡的情况不报错（对话照常）。
CREATE OR REPLACE FUNCTION kg_open_memory_card(p jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_org     text := current_setting('app.current_org', true);
  v_thread  text := p->>'thread_id';
  v_message text := p->>'message_id';
  v_user    text := p->>'requester';
  v_kind    text := p->>'kind';
  v_origin  text := coalesce(p->>'origin', 'user_message');
  v_t       record;
  v_c       record;
  v_stmt    text;
  v_items   jsonb := '[]'::jsonb;
  v_seen    text[] := '{}';
  v_x       text;
  v_card    text;
BEGIN
  IF v_org IS NULL OR v_org = '' THEN RAISE EXCEPTION 'KG_NO_TENANT' USING ERRCODE = '42501'; END IF;
  IF NOT public.kernel_org_is_writable(v_org) THEN
    RAISE EXCEPTION 'KG_ORG_FROZEN: organization % is read-only', v_org USING ERRCODE = '42501';
  END IF;
  IF v_kind IS NULL OR v_kind NOT IN ('remember', 'forget', 'overview') THEN
    RAISE EXCEPTION 'KG_INVALID_REQUEST: card kind %', v_kind USING ERRCODE = '22023';
  END IF;
  IF v_origin NOT IN ('user_message', 'agent_tool') OR (v_origin = 'agent_tool' AND v_kind <> 'remember') THEN
    RAISE EXCEPTION 'KG_INVALID_REQUEST: card origin % for kind %', v_origin, v_kind USING ERRCODE = '22023';
  END IF;

  -- E1：只有会话所有者本人说的话才出卡。
  SELECT t.project_id, t.created_by INTO v_t FROM chat_threads t WHERE t.org_id = v_org AND t.id = v_thread;
  IF NOT FOUND OR v_user IS NULL OR v_t.created_by IS DISTINCT FROM v_user
     OR NOT EXISTS (SELECT 1 FROM chat_messages m
                     WHERE m.org_id = v_org AND m.id = v_message AND m.thread_id = v_thread
                       AND m.author_kind = 'human' AND m.author_id = v_user
                       AND m.visibility_scope IS NULL AND m.raw_transcript = false) THEN
    RETURN jsonb_build_object('outcome', 'not_owner');
  END IF;
  -- 前缀入口：卡上的字必须出自触发的这句话（不信调用方传进来的文本）。agent 入口的字由用户在卡上确认 / 改字（#4344）。
  -- overview 卡上没有用户说的字（条目是记忆本身，逐条在下面复核）。
  IF v_kind <> 'overview' AND (
       length(coalesce(btrim(CASE WHEN v_kind = 'remember' THEN p->>'statement' ELSE p->>'target' END), '')) = 0
       OR (v_origin = 'user_message'
           AND position(coalesce(CASE WHEN v_kind = 'remember' THEN btrim(p->>'statement') ELSE btrim(p->>'target') END, '')
                        IN (SELECT normalize(m.body, NFKC) FROM chat_messages m WHERE m.org_id = v_org AND m.id = v_message)) = 0)) THEN
    RETURN jsonb_build_object('outcome', 'not_from_message');
  END IF;

  -- 同一个 run 重试 / 本轮已有卡：沿用那一张，如实告诉调用方不是新开的。
  SELECT k.id INTO v_card FROM kg_memory_cards k WHERE k.org_id = v_org AND k.run_id = p->>'run_id';
  IF v_card IS NOT NULL THEN RETURN jsonb_build_object('outcome', 'opened', 'card_id', v_card, 'reused', true); END IF;

  -- 长期记忆 = 个人空间：三种卡都只在个人线程里开（#4361：忘掉 / 查看同样不碰项目层的记忆）。
  IF v_t.project_id IS NOT NULL THEN RETURN jsonb_build_object('outcome', 'not_personal'); END IF;

  IF v_kind = 'remember' THEN
    v_stmt := btrim(coalesce(p->>'statement', ''));
    IF length(v_stmt) = 0 OR length(v_stmt) > 2000 THEN RETURN jsonb_build_object('outcome', 'no_items'); END IF;
    -- 本会话里已经有同一句活结论 ⇒ 卡指着它（点「记住」时确认并晋升它，不另建一条）。
    SELECT c.id, c.statement INTO v_c FROM claims c
     WHERE c.org_id = v_org AND c.scope_kind = 'chat_session' AND c.scope_id = v_thread
       AND c.revoked_at IS NULL AND c.status <> 'superseded'
       AND kg_conflict_statement_key(c.statement) = kg_conflict_statement_key(v_stmt)
     ORDER BY c.created_at, c.id LIMIT 1;
    v_items := jsonb_build_array(jsonb_build_object(
      'claimId', v_c.id, 'statement', v_stmt, 'scope', 'chat_session',
      'basis', kg_claim_basis(v_c.statement)));
  ELSE
    -- forget / overview：每一条都必须是请求者本人个人空间里的活结论（本人 L1，或本人某个个人线程里的会话结论）。
    FOR v_x IN SELECT e FROM jsonb_array_elements_text(coalesce(p->'claim_ids', '[]'::jsonb)) WITH ORDINALITY AS a(e, i) ORDER BY i LOOP
      EXIT WHEN jsonb_array_length(v_items) >= 20;
      CONTINUE WHEN v_x = ANY(v_seen);
      CONTINUE WHEN NOT kg_personal_space_claim_ok(v_org, v_user, v_x);
      SELECT c.id, c.statement, c.scope_kind, c.scope_id, c.claim_kind INTO v_c FROM claims c WHERE c.org_id = v_org AND c.id = v_x;
      v_seen := v_seen || v_c.id;
      v_items := v_items || jsonb_build_array(jsonb_build_object(
        'claimId', v_c.id, 'statement', v_c.statement, 'scope', v_c.scope_kind, 'basis', kg_claim_basis(v_c.statement),
        'threadId', CASE WHEN v_c.scope_kind = 'chat_session' THEN v_c.scope_id END,
        'claimKind', v_c.claim_kind,
        'sourceThreadId', kg_personal_claim_thread(v_org, v_user, v_c.id)));
    END LOOP;
    IF jsonb_array_length(v_items) = 0 THEN RETURN jsonb_build_object('outcome', 'no_items'); END IF;
  END IF;

  -- 忘掉 / 查看卡上都是本人个人空间的条目：只有本人读得到这张卡（I-14，RLS kg_memory_cards_personal_owner）。
  INSERT INTO kg_memory_cards (id, org_id, thread_id, run_id, message_id, kind, items, has_personal, created_by, origin)
  VALUES (p->>'card_id', v_org, v_thread, p->>'run_id', v_message, v_kind, v_items,
          v_kind <> 'remember' OR EXISTS (SELECT 1 FROM jsonb_array_elements(v_items) i WHERE i->>'scope' = 'personal'), v_user, v_origin)
  ON CONFLICT (org_id, run_id) DO NOTHING;
  SELECT k.id INTO v_card FROM kg_memory_cards k WHERE k.org_id = v_org AND k.run_id = p->>'run_id';
  RETURN jsonb_build_object('outcome', 'opened', 'card_id', v_card, 'reused', v_card IS DISTINCT FROM p->>'card_id');
END
$$;

-- 一张卡涉及哪些会话（卡所在的会话 + 忘掉卡条目各自所在的会话），按 id 排序：上锁顺序。
CREATE OR REPLACE FUNCTION kg_memory_card_threads(p_thread text, p_items jsonb) RETURNS text[]
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT array_agg(DISTINCT x ORDER BY x) FROM (
    SELECT p_thread AS x
    UNION
    SELECT coalesce(i->>'threadId', p_thread) FROM jsonb_array_elements(p_items) i WHERE i->>'scope' = 'chat_session') s
$$;

-- ─────────────────────────────── ② 人的决定 ───────────────────────────────
-- p = { action_id, card_id, decision: accept|dismiss, actor_kind, claim_ids?（forget 选中的）, edited_statement?（remember 改过的字） }
-- 与 F17（20260924300000）的差别只在：overview 卡不接受任何决定；forget 分支按条目各自的会话核对 / 上锁 / 记审计，
-- 并在落表前记下撤销快照。remember 分支逐字不变。
CREATE OR REPLACE FUNCTION kg_act_on_memory_card(p jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_org     text := current_setting('app.current_org', true);
  v_user    text := current_setting('app.current_user_id', true);
  v_id      text := p->>'action_id';
  v_card    record;
  v_thread  text;
  v_project text;
  v_item    jsonb;
  v_stmt    text;
  v_c       record;
  v_claim   text;
  v_target  text;
  v_created boolean := false;
  v_l1_id   text;
  v_sel     text[];
  v_keep    jsonb := '[]'::jsonb;
  v_l0      text[] := '{}';
  v_l1      text[] := '{}';
  v_actions text[] := '{}';
  v_threads text[];
  v_x       text;
  v_set     text[];
  v_restore jsonb;
  v_ids     text[];
  v_selitems jsonb;
  v_srcs    text[] := '{}';
BEGIN
  IF v_org IS NULL OR v_org = '' THEN RAISE EXCEPTION 'KG_NO_TENANT' USING ERRCODE = '42501'; END IF;
  IF NOT public.kernel_org_is_writable(v_org) THEN
    RAISE EXCEPTION 'KG_ORG_FROZEN: organization % is read-only', v_org USING ERRCODE = '42501';
  END IF;
  -- I-15 / I-17：卡上的动作只由人执行；Agent / 模型 / 系统身份、或没有登录用户，一律拒绝。
  IF p->>'actor_kind' IS DISTINCT FROM 'human' OR v_user IS NULL OR v_user = '' THEN
    RAISE EXCEPTION 'KG_ACTOR_NOT_HUMAN: memory cards are acted on by a signed-in person' USING ERRCODE = '42501';
  END IF;
  IF p->>'decision' IS NULL OR p->>'decision' NOT IN ('accept', 'dismiss') THEN
    RAISE EXCEPTION 'KG_INVALID_REQUEST: decision %', p->>'decision' USING ERRCODE = '22023';
  END IF;

  SELECT k.thread_id, k.items, k.kind INTO v_c FROM kg_memory_cards k WHERE k.org_id = v_org AND k.id = p->>'card_id';
  IF NOT FOUND THEN RAISE EXCEPTION 'KG_CARD_NOT_FOUND' USING ERRCODE = '23503'; END IF;
  v_thread := v_c.thread_id;
  SELECT t.project_id INTO v_project FROM chat_threads t WHERE t.org_id = v_org AND t.id = v_thread AND t.created_by = v_user;
  IF NOT FOUND THEN RAISE EXCEPTION 'KG_NOT_OWNER: only the thread owner manages its memory' USING ERRCODE = '42501'; END IF;

  -- 选中的条目（「不用了」⇒ 一条都不算）。
  v_selitems := CASE WHEN p->>'decision' = 'dismiss' THEN '[]'::jsonb ELSE
    (SELECT coalesce(jsonb_agg(i), '[]'::jsonb) FROM jsonb_array_elements(v_c.items) i
      WHERE jsonb_typeof(p->'claim_ids') IS DISTINCT FROM 'array'
         OR i->>'claimId' IN (SELECT jsonb_array_elements_text(p->'claim_ids'))) END;
  -- #4361：忘掉一条长期记忆 = 在本人个人空间里都不再记着它——连同它由本人个人对话里哪些原话而来（活的 derived_from）。
  -- 只忘长期记忆那份的话，回到那个对话它还在、被召回（同一句在那个会话里仍是活的）。项目会话里的原话不碰。
  IF v_c.kind = 'forget' THEN
    v_srcs := ARRAY(
      SELECT DISTINCT src.id FROM jsonb_array_elements(v_selitems) i
        JOIN ontology_edges d ON d.org_id = v_org AND d.src_kind = 'claim' AND d.src_id = i->>'claimId'
                             AND d.relation = 'derived_from' AND d.dst_kind = 'claim' AND d.status = 'active'
        JOIN claims src ON src.org_id = v_org AND src.id = d.dst_id
       WHERE i->>'scope' = 'personal' AND src.scope_kind = 'chat_session'
         AND src.revoked_at IS NULL AND src.status <> 'superseded'
         AND kg_is_personal_thread_of(v_org, src.scope_id, v_user));
  END IF;

  -- 锁顺序同 F10 / F11 / F16：先会话、后个人空间。条目在别的个人线程里的忘掉卡：**选中的**条目（及其原话）所在的会话锁
  -- 按 id 排序依次拿（#4361；没选中的条目所在的会话不锁——不为用户没要忘的东西去等别的会话）。「不用了」只锁卡所在的会话。
  v_threads := ARRAY(SELECT DISTINCT x FROM unnest(kg_memory_card_threads(v_thread, v_selitems)
                       || ARRAY(SELECT c.scope_id FROM claims c WHERE c.org_id = v_org AND c.id = ANY(v_srcs))) x ORDER BY x);
  FOREACH v_x IN ARRAY v_threads LOOP
    PERFORM pg_advisory_xact_lock(hashtext('kg_scope:' || v_org || '|chat_session|' || v_x));
  END LOOP;
  PERFORM pg_advisory_xact_lock(hashtext('kg_scope:' || v_org || '|personal|' || v_user));
  SELECT * INTO v_card FROM kg_memory_cards k WHERE k.org_id = v_org AND k.id = p->>'card_id' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'KG_CARD_NOT_FOUND' USING ERRCODE = '23503'; END IF;
  IF v_card.created_by IS DISTINCT FROM v_user THEN
    RAISE EXCEPTION 'KG_NOT_OWNER: only the person who asked manages this card' USING ERRCODE = '42501';
  END IF;
  -- 「你记得我什么」的卡只是一张清单，没有任何动作。
  IF v_card.kind = 'overview' THEN
    RAISE EXCEPTION 'KG_INVALID_REQUEST: an overview card takes no decision' USING ERRCODE = '22023';
  END IF;
  -- 已经点过（另一个标签页 / 双击的第二下）：这张卡不再是用户眼前的样子了。
  IF v_card.status <> 'open' THEN RAISE EXCEPTION 'KG_CARD_STALE: card is %', v_card.status USING ERRCODE = '40001'; END IF;

  IF p->>'decision' = 'dismiss' THEN
    UPDATE kg_memory_cards SET status = 'dismissed', acted_by = v_user, acted_at = now() WHERE id = v_card.id;
    RETURN jsonb_build_object('card', kg_memory_card_json(v_card.id, 'dismissed', v_card.kind, v_card.items), 'action_ids', '[]'::jsonb);
  END IF;

  IF v_card.kind = 'remember' THEN
    -- 长期记忆 = 个人空间；会话后来被挪进项目 ⇒ 这张卡不再成立。
    IF v_project IS NOT NULL THEN RAISE EXCEPTION 'KG_CARD_STALE: thread is no longer personal' USING ERRCODE = '40001'; END IF;
    v_item := v_card.items->0;
    v_stmt := btrim(coalesce(p->>'edited_statement', v_item->>'statement'));
    IF length(v_stmt) = 0 OR length(v_stmt) > 2000 THEN
      RAISE EXCEPTION 'KG_INVALID_REQUEST: statement length' USING ERRCODE = '22023';
    END IF;
    IF v_item->>'claimId' IS NOT NULL AND kg_conflict_statement_key(v_stmt) = kg_conflict_statement_key(v_item->>'statement') THEN
      -- 卡指着本会话里已有的那一句：它在出卡之后被改过 / 忘掉 ⇒ 过期；有矛盾 ⇒ 先解决矛盾。
      SELECT * INTO v_c FROM claims c WHERE c.org_id = v_org AND c.id = v_item->>'claimId' FOR UPDATE;
      IF NOT FOUND OR v_c.revoked_at IS NOT NULL OR v_c.status = 'superseded'
         OR NOT (v_c.scope_kind = 'chat_session' AND v_c.scope_id = v_thread)
         OR kg_claim_basis(v_c.statement) IS DISTINCT FROM v_item->>'basis' THEN
        RAISE EXCEPTION 'KG_CARD_STALE: the remembered line changed' USING ERRCODE = '40001';
      END IF;
      v_claim := v_c.id;
    ELSE
      -- 那句「记住：…」本身被抽取成了同一句话 ⇒ 用它（会话里不留两份同样的话）。
      SELECT * INTO v_c FROM claims c
       WHERE c.org_id = v_org AND c.scope_kind = 'chat_session' AND c.scope_id = v_thread
         AND c.revoked_at IS NULL AND c.status <> 'superseded'
         AND kg_conflict_statement_key(c.statement) = kg_conflict_statement_key(v_stmt)
         AND EXISTS (SELECT 1 FROM claim_message_evidence e
                      WHERE e.claim_id = c.id AND e.org_id = v_org AND e.message_id = v_card.message_id AND e.stance = 'supporting')
       ORDER BY c.created_at, c.id LIMIT 1
       FOR UPDATE;
      IF FOUND THEN
        v_claim := v_c.id;
      ELSE
        v_claim := v_id || '-c';
        v_created := true;
        INSERT INTO claims (id, org_id, statement, status, tsv, claim_kind, confidence, created_by, reviewed_by,
                            scope_kind, scope_id, valid_from)
        VALUES (v_claim, v_org, v_stmt, 'accepted', to_tsvector('simple', v_stmt), 'fact', 1, 'human', v_user,
                'chat_session', v_thread, now());
        -- 出处 = 用户说「记住：…」的那句原话（来源一跳可达，06-UX R3-6）。
        INSERT INTO claim_message_evidence (claim_id, org_id, message_id, stance, excerpt)
        SELECT v_claim, v_org, m.id, 'supporting', left(m.body, 280) FROM chat_messages m
         WHERE m.org_id = v_org AND m.id = v_card.message_id;
        INSERT INTO ontology_actions (id, org_id, scope_kind, scope_id, actor_kind, actor_id, action_type, payload, source_ref, outcome)
        VALUES (v_id, v_org, 'chat_session', v_thread, 'human', v_user, 'rememberClaim',
                jsonb_build_object('card_id', v_card.id, 'via', 'memoryCard',
                                   'claims', jsonb_build_array(jsonb_build_object('id', v_claim)), 'objects', '[]'::jsonb),
                v_card.id, 'accepted');
        v_actions := v_actions || v_id;
      END IF;
    END IF;
    SELECT status INTO v_c FROM claims WHERE org_id = v_org AND id = v_claim;
    IF v_c.status = 'contested' THEN
      RAISE EXCEPTION 'KG_CONTESTED_NEEDS_RESOLUTION: resolve the conflict before remembering' USING ERRCODE = '23514';
    END IF;
    -- 长期记忆里已经有同一句 ⇒ 合并进去（证据追加、连 derived_from），不复制第二份。
    SELECT c.id INTO v_target FROM claims c
     WHERE c.org_id = v_org AND c.scope_kind = 'personal' AND c.scope_id = v_user
       AND c.revoked_at IS NULL AND c.status NOT IN ('superseded', 'contested')
       AND kg_conflict_statement_key(c.statement) = kg_conflict_statement_key(v_stmt)
     ORDER BY c.created_at, c.id LIMIT 1;
    v_l1_id := kg_promote_claim(jsonb_build_object('action_id', v_id || '-p', 'thread_id', v_thread, 'claim_id', v_claim,
                                                'mode', CASE WHEN v_target IS NULL THEN 'new' ELSE 'merge' END,
                                                'target_claim_id', v_target));
    v_actions := v_actions || (v_id || '-p');
    v_keep := jsonb_build_array(jsonb_build_object('claimId', v_claim, 'statement', v_stmt, 'scope', 'chat_session', 'basis', NULL));
    UPDATE kg_memory_cards SET remembered_claim_id = v_claim, remembered_personal_id = v_l1_id,
                               claim_created = v_created, personal_created = (v_target IS NULL)
     WHERE id = v_card.id;

  ELSE
    -- forget：选中的（省略 = 卡上全部）；每一条都必须在卡上。
    v_sel := CASE WHEN jsonb_typeof(p->'claim_ids') = 'array'
                  THEN ARRAY(SELECT DISTINCT jsonb_array_elements_text(p->'claim_ids'))
                  ELSE ARRAY(SELECT DISTINCT i->>'claimId' FROM jsonb_array_elements(v_card.items) i) END;
    IF cardinality(v_sel) = 0 THEN RAISE EXCEPTION 'KG_INVALID_REQUEST: nothing selected' USING ERRCODE = '22023'; END IF;
    IF (SELECT count(*) FROM jsonb_array_elements(v_card.items) i WHERE i->>'claimId' = ANY(v_sel)) <> cardinality(v_sel) THEN
      RAISE EXCEPTION 'KG_CARD_STALE: selection is not on the card' USING ERRCODE = '40001';
    END IF;
    -- 先逐条锁住并核对（按 id 排序上锁），全部对得上才动手：级联会把同一张卡上的 L1 副本一并失效，
    -- 边核边改就会把它误判成「期间被改过」。会话结论按它**自己**所在的会话核对：那个会话仍是本人的个人线程（#4361）。
    FOR v_item IN SELECT i FROM jsonb_array_elements(v_card.items) i WHERE i->>'claimId' = ANY(v_sel) ORDER BY i->>'claimId' LOOP
      SELECT * INTO v_c FROM claims c WHERE c.org_id = v_org AND c.id = v_item->>'claimId' FOR UPDATE;
      IF NOT FOUND OR v_c.revoked_at IS NOT NULL OR v_c.status = 'superseded'
         OR NOT ((v_item->>'scope' = 'chat_session' AND v_c.scope_kind = 'chat_session'
                  AND v_c.scope_id = coalesce(v_item->>'threadId', v_thread)
                  AND kg_is_personal_thread_of(v_org, v_c.scope_id, v_user))
              OR (v_item->>'scope' = 'personal' AND v_c.scope_kind = 'personal' AND v_c.scope_id = v_user AND v_project IS NULL))
         OR kg_claim_basis(v_c.statement) IS DISTINCT FROM v_item->>'basis' THEN
        RAISE EXCEPTION 'KG_CARD_STALE: % changed since the card was made', v_item->>'claimId' USING ERRCODE = '40001';
      END IF;
      IF v_c.scope_kind = 'personal' THEN v_l1 := v_l1 || v_c.id; ELSE v_l0 := v_l0 || v_c.id; END IF;
    END LOOP;
    -- 选中的长期记忆的原话（见上）：上锁后再核一遍（仍活着、仍在本人个人线程、所在会话已上锁），一起忘掉。
    FOR v_x IN SELECT x FROM unnest(v_srcs) x ORDER BY x LOOP
      CONTINUE WHEN v_x = ANY(v_l0);
      SELECT * INTO v_c FROM claims c WHERE c.org_id = v_org AND c.id = v_x FOR UPDATE;
      CONTINUE WHEN NOT FOUND OR v_c.revoked_at IS NOT NULL OR v_c.status = 'superseded' OR v_c.scope_kind <> 'chat_session'
        OR NOT (v_c.scope_id = ANY(v_threads)) OR NOT kg_is_personal_thread_of(v_org, v_c.scope_id, v_user);
      v_l0 := v_l0 || v_c.id;
    END LOOP;

    -- 撤销快照（#4361）：选中的 + 由它们晋升出去、还活着的本人 L1 副本（F07 级联可能把它们一起收掉）的当时状态，
    -- 以及这次会被级联收掉的活边。撤销时只恢复「因忘掉而失效」的那些。
    SELECT array_agg(DISTINCT x) INTO v_set FROM (
      SELECT unnest(v_l0 || v_l1) AS x
      UNION
      SELECT pc.id FROM claims pc
       WHERE pc.org_id = v_org AND pc.scope_kind = 'personal' AND pc.scope_id = v_user
         AND pc.revoked_at IS NULL AND pc.status <> 'superseded'
         AND EXISTS (SELECT 1 FROM ontology_edges d WHERE d.org_id = v_org AND d.src_kind = 'claim' AND d.src_id = pc.id
                       AND d.relation = 'derived_from' AND d.dst_kind = 'claim' AND d.status = 'active'
                       AND d.dst_id = ANY(v_l0))) s;
    v_restore := jsonb_build_object(
      'claims', (SELECT jsonb_agg(jsonb_build_object('id', c.id, 'status', c.status) ORDER BY c.id)
                   FROM claims c WHERE c.org_id = v_org AND c.id = ANY(v_set)),
      'edges', (SELECT coalesce(jsonb_agg(e.id ORDER BY e.id), '[]'::jsonb) FROM ontology_edges e
                 WHERE e.org_id = v_org AND e.status = 'active'
                   AND ((e.src_kind = 'claim' AND e.src_id = ANY(v_set)) OR (e.dst_kind = 'claim' AND e.dst_id = ANY(v_set)))));

    UPDATE claims SET status = 'superseded', revoked_at = now(), revocation_reason = 'user_forgot', updated_at = now()
     WHERE org_id = v_org AND id = ANY(v_l0 || v_l1) AND revoked_at IS NULL;
    -- 每个会话各留一条审计（各自的 revision 前进；来源抽屉按 payload.claims 查）。卡所在的会话沿用 v_id（与 F17 同一个 id）。
    FOREACH v_x IN ARRAY v_threads LOOP
      v_ids := ARRAY(SELECT c.id FROM claims c WHERE c.org_id = v_org AND c.id = ANY(v_l0) AND c.scope_id = v_x ORDER BY c.id);
      CONTINUE WHEN cardinality(v_ids) = 0;
      INSERT INTO ontology_actions (id, org_id, scope_kind, scope_id, actor_kind, actor_id, action_type, payload, source_ref, outcome)
      VALUES (CASE WHEN v_x = v_thread THEN v_id ELSE v_id || '-' || md5(v_x) END, v_org, 'chat_session', v_x, 'human', v_user, 'revokeClaim',
              jsonb_build_object('action', jsonb_build_object('type', 'revokeClaim', 'reason', 'user_forgot'), 'via', 'memoryCard',
                                 'card_id', v_card.id, 'objects', '[]'::jsonb,
                                 'claims', (SELECT jsonb_agg(jsonb_build_object('id', x)) FROM unnest(v_ids) x)),
              v_card.id, 'accepted');
      v_actions := v_actions || (CASE WHEN v_x = v_thread THEN v_id ELSE v_id || '-' || md5(v_x) END);
    END LOOP;
    IF cardinality(v_l1) > 0 THEN
      -- 个人空间的条目在个人空间留审计：会话里的审计不带个人空间 id。
      INSERT INTO ontology_actions (id, org_id, scope_kind, scope_id, actor_kind, actor_id, action_type, payload, source_ref, outcome)
      VALUES (v_id || '-l1', v_org, 'personal', v_user, 'human', v_user, 'revokeClaim',
              jsonb_build_object('action', jsonb_build_object('type', 'revokeClaim', 'reason', 'user_forgot'), 'via', 'memoryCard',
                                 'thread_id', v_thread, 'card_id', v_card.id,
                                 'claims', (SELECT jsonb_agg(jsonb_build_object('id', x)) FROM unnest(v_l1) x)),
              v_card.id, 'accepted');
      v_actions := v_actions || (v_id || '-l1');
    END IF;
    SELECT coalesce(jsonb_agg(i ORDER BY n), '[]'::jsonb) INTO v_keep
      FROM jsonb_array_elements(v_card.items) WITH ORDINALITY AS a(i, n) WHERE i->>'claimId' = ANY(v_sel);
    UPDATE kg_memory_cards SET restore = v_restore WHERE id = v_card.id;
  END IF;

  UPDATE kg_memory_cards
     SET status = 'done', acted_by = v_user, acted_at = now(), items = v_keep,
         has_personal = has_personal OR EXISTS (SELECT 1 FROM jsonb_array_elements(v_keep) i WHERE i->>'scope' = 'personal'),
         action_ids = to_jsonb(v_actions)
   WHERE id = v_card.id;
  -- 回给界面的卡：记住卡的 claimId 只在「撤销」只会撤掉这次新建的东西时给出（两条都是这次新建的），否则为 null（不给撤销）。
  RETURN jsonb_build_object('card', kg_memory_card_json(v_card.id, 'done', v_card.kind,
           CASE WHEN v_card.kind = 'remember' AND NOT (v_created AND v_target IS NULL)
                THEN jsonb_set(v_keep, '{0,claimId}', 'null'::jsonb) ELSE v_keep END),
         'action_ids', to_jsonb(v_actions));
END
$$;

-- ─────────────────────────────── ③ 撤销一张已生效的忘掉卡（人的动作） ───────────────────────────────
-- p = { action_id, card_id }。返回 { card, action_ids }。
CREATE OR REPLACE FUNCTION kg_undo_memory_card(p jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_org      text := current_setting('app.current_org', true);
  v_user     text := current_setting('app.current_user_id', true);
  v_id       text := p->>'action_id';
  v_card     record;
  v_head     record;
  v_threads  text[];
  v_x        text;
  v_c        jsonb;
  v_row      record;
  v_session  text[] := '{}';
  v_personal text[] := '{}';
  v_ids      text[];
  v_actions  text[] := '{}';
BEGIN
  IF v_org IS NULL OR v_org = '' THEN RAISE EXCEPTION 'KG_NO_TENANT' USING ERRCODE = '42501'; END IF;
  IF NOT public.kernel_org_is_writable(v_org) THEN
    RAISE EXCEPTION 'KG_ORG_FROZEN: organization % is read-only', v_org USING ERRCODE = '42501';
  END IF;
  IF p->>'actor_kind' IS DISTINCT FROM 'human' OR v_user IS NULL OR v_user = '' THEN
    RAISE EXCEPTION 'KG_ACTOR_NOT_HUMAN: memory cards are acted on by a signed-in person' USING ERRCODE = '42501';
  END IF;

  SELECT k.thread_id, k.items, k.restore INTO v_head FROM kg_memory_cards k WHERE k.org_id = v_org AND k.id = p->>'card_id';
  IF NOT FOUND THEN RAISE EXCEPTION 'KG_CARD_NOT_FOUND' USING ERRCODE = '23503'; END IF;
  IF NOT kg_is_personal_thread_of(v_org, v_head.thread_id, v_user) THEN
    RAISE EXCEPTION 'KG_NOT_OWNER: only the thread owner manages its memory' USING ERRCODE = '42501';
  END IF;
  -- 与 kg_act_on_memory_card 同一套锁：条目与快照里会话结论各自的会话（按 id 排序）→ 个人空间。快照在卡生效之后不再变。
  v_threads := ARRAY(SELECT DISTINCT x FROM unnest(kg_memory_card_threads(v_head.thread_id, v_head.items)
                       || ARRAY(SELECT c.scope_id FROM claims c
                                 WHERE c.org_id = v_org AND c.scope_kind = 'chat_session'
                                   AND c.id IN (SELECT r->>'id' FROM jsonb_array_elements(coalesce(v_head.restore->'claims', '[]'::jsonb)) r))) x
                     ORDER BY x);
  FOREACH v_x IN ARRAY v_threads LOOP
    PERFORM pg_advisory_xact_lock(hashtext('kg_scope:' || v_org || '|chat_session|' || v_x));
  END LOOP;
  PERFORM pg_advisory_xact_lock(hashtext('kg_scope:' || v_org || '|personal|' || v_user));
  SELECT * INTO v_card FROM kg_memory_cards k WHERE k.org_id = v_org AND k.id = p->>'card_id' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'KG_CARD_NOT_FOUND' USING ERRCODE = '23503'; END IF;
  IF v_card.created_by IS DISTINCT FROM v_user THEN
    RAISE EXCEPTION 'KG_NOT_OWNER: only the person who asked manages this card' USING ERRCODE = '42501';
  END IF;
  -- 只有「已生效的忘掉卡」能撤销；撤过一次 / 还开着 / 点了不用了 / 别的种类 ⇒ 这张卡已经不是用户眼前的样子。
  IF v_card.kind <> 'forget' OR v_card.status <> 'done' OR v_card.restore IS NULL THEN
    RAISE EXCEPTION 'KG_CARD_STALE: card is % %', v_card.kind, v_card.status USING ERRCODE = '40001';
  END IF;

  FOR v_c IN SELECT * FROM jsonb_array_elements(coalesce(v_card.restore->'claims', '[]'::jsonb)) LOOP
    SELECT * INTO v_row FROM claims WHERE org_id = v_org AND id = v_c->>'id' FOR UPDATE;
    CONTINUE WHEN NOT FOUND;
    -- 只恢复「因忘掉而失效」、且仍在本人个人空间里的
    CONTINUE WHEN v_row.revoked_at IS NULL OR v_row.revocation_reason IS DISTINCT FROM 'user_forgot';
    CONTINUE WHEN NOT ((v_row.scope_kind = 'chat_session' AND kg_is_personal_thread_of(v_org, v_row.scope_id, v_user))
                    OR (v_row.scope_kind = 'personal' AND v_row.scope_id = v_user));
    -- 会话里的结论：原话还在才恢复（原话被删了就没有可恢复的东西，同 F07 / R8）
    CONTINUE WHEN v_row.scope_kind = 'chat_session'
      AND NOT EXISTS (SELECT 1 FROM claim_message_evidence e WHERE e.org_id = v_org AND e.claim_id = v_row.id AND e.stance = 'supporting')
      AND NOT EXISTS (SELECT 1 FROM claim_segments s WHERE s.claim_id = v_row.id AND s.stance = 'supporting');
    UPDATE claims SET status = v_c->>'status', revoked_at = NULL, revocation_reason = NULL, updated_at = now()
     WHERE org_id = v_org AND id = v_row.id;
    IF v_row.scope_kind = 'personal' THEN v_personal := v_personal || v_row.id; ELSE v_session := v_session || v_row.id; END IF;
  END LOOP;
  IF cardinality(v_session) + cardinality(v_personal) = 0 THEN
    RAISE EXCEPTION 'KG_CARD_STALE: nothing forgotten by this card can be restored' USING ERRCODE = '40001';
  END IF;

  -- 放回 F07 级联收掉的边：快照里的、现在仍是失效的、两端都还在（结论端点还活着）的（同 R8 kg_undo_supersede）
  UPDATE ontology_edges e SET status = 'active', invalidated_at = NULL
   WHERE e.org_id = v_org AND e.status = 'invalidated'
     AND e.id IN (SELECT jsonb_array_elements_text(coalesce(v_card.restore->'edges', '[]'::jsonb)))
     AND (e.src_kind <> 'claim' OR EXISTS (SELECT 1 FROM claims c WHERE c.org_id = v_org AND c.id = e.src_id AND c.revoked_at IS NULL))
     AND (e.dst_kind <> 'claim' OR EXISTS (SELECT 1 FROM claims c WHERE c.org_id = v_org AND c.id = e.dst_id AND c.revoked_at IS NULL))
     AND (e.src_kind <> 'chat_message' OR EXISTS (SELECT 1 FROM chat_messages m WHERE m.org_id = v_org AND m.id = e.src_id))
     AND (e.dst_kind <> 'chat_message' OR EXISTS (SELECT 1 FROM chat_messages m WHERE m.org_id = v_org AND m.id = e.dst_id))
     AND (e.src_kind <> 'segment' OR EXISTS (SELECT 1 FROM segments s WHERE s.org_id = v_org AND s.id = e.src_id))
     AND (e.dst_kind <> 'segment' OR EXISTS (SELECT 1 FROM segments s WHERE s.org_id = v_org AND s.id = e.dst_id))
     AND (e.src_kind <> 'object' OR EXISTS (SELECT 1 FROM ontology_objects o WHERE o.org_id = v_org AND o.id = e.src_id))
     AND (e.dst_kind <> 'object' OR EXISTS (SELECT 1 FROM ontology_objects o WHERE o.org_id = v_org AND o.id = e.dst_id));

  UPDATE kg_memory_cards SET status = 'undone', undone_by = v_user, undone_at = now() WHERE id = v_card.id;

  -- 审计：每个会话一条（revision 前进）+ 个人空间一条。
  FOREACH v_x IN ARRAY v_threads LOOP
    v_ids := ARRAY(SELECT c.id FROM claims c WHERE c.org_id = v_org AND c.id = ANY(v_session) AND c.scope_id = v_x ORDER BY c.id);
    CONTINUE WHEN cardinality(v_ids) = 0;
    INSERT INTO ontology_actions (id, org_id, scope_kind, scope_id, actor_kind, actor_id, action_type, payload, source_ref, outcome)
    VALUES (v_id || '-' || md5(v_x), v_org, 'chat_session', v_x, 'human', v_user, 'undoForget',
            jsonb_build_object('card_id', v_card.id, 'via', 'memoryCard', 'objects', '[]'::jsonb,
                               'claims', (SELECT jsonb_agg(jsonb_build_object('id', x)) FROM unnest(v_ids) x)),
            v_card.id, 'accepted');
    v_actions := v_actions || (v_id || '-' || md5(v_x));
  END LOOP;
  IF cardinality(v_personal) > 0 THEN
    INSERT INTO ontology_actions (id, org_id, scope_kind, scope_id, actor_kind, actor_id, action_type, payload, source_ref, outcome)
    VALUES (v_id || '-l1', v_org, 'personal', v_user, 'human', v_user, 'undoForget',
            jsonb_build_object('thread_id', v_card.thread_id, 'card_id', v_card.id, 'via', 'memoryCard',
                               'claims', (SELECT jsonb_agg(jsonb_build_object('id', x)) FROM unnest(v_personal) x)),
            v_card.id, 'accepted');
    v_actions := v_actions || (v_id || '-l1');
  END IF;
  RETURN jsonb_build_object('card', kg_memory_card_json(v_card.id, 'undone', v_card.kind, v_card.items), 'action_ids', to_jsonb(v_actions));
END
$$;

REVOKE ALL ON FUNCTION kg_is_personal_thread_of(text, text, text), kg_personal_space_claim_ok(text, text, text),
  kg_personal_claim_thread(text, text, text), kg_memory_manage_ok(text, text, text), kg_open_memory_card(jsonb),
  kg_memory_card_threads(text, jsonb), kg_act_on_memory_card(jsonb), kg_undo_memory_card(jsonb) FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_rw') THEN
    GRANT EXECUTE ON FUNCTION kg_memory_manage_ok(text, text, text), kg_open_memory_card(jsonb), kg_act_on_memory_card(jsonb),
      kg_undo_memory_card(jsonb) TO app_rw;
  END IF;
END
$$;

-- 停用组织的冻结策略（F22 单一事实源，新租户表建完调用一次）
SELECT kernel_apply_org_freeze_policies();

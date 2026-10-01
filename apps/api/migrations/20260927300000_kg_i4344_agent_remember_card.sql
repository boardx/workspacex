/*
 * Issue #4344 —— agent 的记忆工具（`wx_remember`）开的是 F17 同一张「记住」确认卡。
 *
 * 20260924300000_kg_f17_memory_cards.sql 的 `kg_open_memory_card` 只为一种入口设计：用户消息以「记住：…」开头，
 * 执行器按前缀规则取出那句话去开卡。所以它要求卡上的字**出自这条消息正文**（not_from_message）——不信调用方的文本。
 * agent 工具这条入口的字是模型根据对话写的（「我的目标是今年跑完半马」可能出自三轮之前、或用户换了种说法），
 * 逐字出自本轮消息这一条天然不成立；但它换来的保证由**人**给：卡只是 open，用户看到这句话、可以改字，点「记住」
 * 才写（`kg_act_on_memory_card` 一个字没改：执行身份必须是登录的人、必须是会话所有者）。
 *
 * 所以只放开这一条，其余复核逐字不变：
 *   - origin = 'agent_tool'：只能开**记住**卡（忘掉卡的条目要按召回候选核对，agent 入口不开）；不做「出自本条消息」核对；
 *   - E1（会话所有者本人在本会话里发的这条消息）、记住卡只在个人线程（project_id IS NULL ⇒ not_personal）、长度上限：照旧；
 *   - 同一个 run 已有卡 ⇒ 沿用那张，并如实回 `reused = true`（前缀入口先开了卡、或本轮第二次调用），不开第二张、不改它的字。
 * 会话与消息来自服务端的 run（接口层不接受模型给的 id）；这里新增的 `origin` 列只做审计：卡上的字是谁提的。
 */
ALTER TABLE kg_memory_cards ADD COLUMN IF NOT EXISTS origin text NOT NULL DEFAULT 'user_message';
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'kg_memory_cards_origin_check') THEN
    ALTER TABLE kg_memory_cards ADD CONSTRAINT kg_memory_cards_origin_check
      CHECK (origin IN ('user_message', 'agent_tool') AND (origin = 'user_message' OR kind = 'remember'));
  END IF;
END
$$;

-- p = { card_id, thread_id, run_id, message_id, requester, kind, origin?（缺省 user_message）, statement?, target + claim_ids? }
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
  IF v_kind IS NULL OR v_kind NOT IN ('remember', 'forget') THEN
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
  -- 前缀入口：卡上的字必须出自触发的这句话（不信调用方传进来的文本）。agent 入口的字由用户在卡上确认 / 改字（见头注）。
  IF length(coalesce(btrim(CASE WHEN v_kind = 'remember' THEN p->>'statement' ELSE p->>'target' END), '')) = 0
     OR (v_origin = 'user_message'
         AND position(coalesce(CASE WHEN v_kind = 'remember' THEN btrim(p->>'statement') ELSE btrim(p->>'target') END, '')
                      IN (SELECT normalize(m.body, NFKC) FROM chat_messages m WHERE m.org_id = v_org AND m.id = v_message)) = 0) THEN
    RETURN jsonb_build_object('outcome', 'not_from_message');
  END IF;

  -- 同一个 run 重试 / 本轮已有卡：沿用那一张，如实告诉调用方不是新开的。
  SELECT k.id INTO v_card FROM kg_memory_cards k WHERE k.org_id = v_org AND k.run_id = p->>'run_id';
  IF v_card IS NOT NULL THEN RETURN jsonb_build_object('outcome', 'opened', 'card_id', v_card, 'reused', true); END IF;

  IF v_kind = 'remember' THEN
    IF v_t.project_id IS NOT NULL THEN RETURN jsonb_build_object('outcome', 'not_personal'); END IF;
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
    FOR v_x IN SELECT e FROM jsonb_array_elements_text(coalesce(p->'claim_ids', '[]'::jsonb)) WITH ORDINALITY AS a(e, i) ORDER BY i LOOP
      EXIT WHEN jsonb_array_length(v_items) >= 20;
      CONTINUE WHEN v_x = ANY(v_seen);
      SELECT c.id, c.statement, c.scope_kind INTO v_c FROM claims c
       WHERE c.org_id = v_org AND c.id = v_x AND c.revoked_at IS NULL AND c.status <> 'superseded'
         AND ((c.scope_kind = 'chat_session' AND c.scope_id = v_thread)
           OR (c.scope_kind = 'personal' AND c.scope_id = v_user AND v_t.project_id IS NULL));
      CONTINUE WHEN NOT FOUND;
      v_seen := v_seen || v_c.id;
      v_items := v_items || jsonb_build_array(jsonb_build_object(
        'claimId', v_c.id, 'statement', v_c.statement, 'scope', v_c.scope_kind, 'basis', kg_claim_basis(v_c.statement)));
    END LOOP;
    IF jsonb_array_length(v_items) = 0 THEN RETURN jsonb_build_object('outcome', 'no_items'); END IF;
  END IF;

  INSERT INTO kg_memory_cards (id, org_id, thread_id, run_id, message_id, kind, items, has_personal, created_by, origin)
  VALUES (p->>'card_id', v_org, v_thread, p->>'run_id', v_message, v_kind, v_items,
          EXISTS (SELECT 1 FROM jsonb_array_elements(v_items) i WHERE i->>'scope' = 'personal'), v_user, v_origin)
  ON CONFLICT (org_id, run_id) DO NOTHING;
  SELECT k.id INTO v_card FROM kg_memory_cards k WHERE k.org_id = v_org AND k.run_id = p->>'run_id';
  RETURN jsonb_build_object('outcome', 'opened', 'card_id', v_card, 'reused', v_card IS DISTINCT FROM p->>'card_id');
END
$$;

-- 权限沿用原迁移（CREATE OR REPLACE 不改 ACL），这里再声明一遍，免得有人只读这一份。
REVOKE ALL ON FUNCTION kg_open_memory_card(jsonb) FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_rw') THEN
    GRANT EXECUTE ON FUNCTION kg_open_memory_card(jsonb) TO app_rw;
  END IF;
END
$$;

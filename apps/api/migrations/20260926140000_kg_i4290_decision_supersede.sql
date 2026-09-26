/*
 * Issue #4290（第 8 轮）—— 本人明确改口时，新决定取代本人的旧决定：高把握自动（可撤销），低把握弹卡。
 *
 * 人类决定（2026-09-26，signoff-draft/chat-knowledge-graph/usecases.md 条目 5）：
 *   1. 只有明确改口才算：新决定带改口信号，且与**同一作者**一条仍生效的旧决定主题相同。并列补充两条都留。
 *   2. **高把握自动、低把握弹卡**：
 *      - 高把握（explicit / same_kind）自动生效、可撤销：旧决定转 superseded（revocation_reason = decision_changed），
 *        不再召回；会话里一行「已用〈新〉取代〈旧〉 · 撤销」，撤销后旧决定恢复为生效，新决定仍在。
 *      - 低把握（frame_only）从不自动：复用 F16 的冲突卡（kg_conflict_prompts，新列 kind = 'possible_change'），卡上
 *        「用〈新〉取代〈旧〉？」[取代] / [两条都保留]。**开卡不改任何一条的状态**——F16 开卡把两条转 contested（召回里标成
 *        「有矛盾」、挡住自动记入个人空间 #4283 与晋升 F11），而人类决定要「选之前两条都照常生效、都召回」。
 *        出口仍是 F16 的 kg_resolve_conflict（本迁移按 kind 分支重建）：[取代] = keep_new（旧条 superseded，连同本人由它
 *        晋升出去的 L1 副本；新条 accepted）；[两条都保留] = keep_both，只关卡、不问适用条件、两条状态都不动；
 *        界面上不给 ignore（直接调用时同样只关卡）。权限与 F16 相同：会话所有者本人；卡的可见性跟随两条结论（RLS）。
 *
 * 与 F16（20260924290000）同一形状，接在它后面、同一个抽取任务里跑（detect-conflicts.ts）：
 *   ① `kg_supersede_candidates(thread, message)`：只读。这条消息刚抽出的决定（F16 的 kg_conflict_newer_ok：本会话、
 *      模型提出、没人看过、由这条消息支撑——F16 刚开了卡的新条已是 contested，自然不在里面），带上消息作者；
 *      以及还活着的旧决定（kg_supersede_older_ok）：本会话的，外加——只在个人线程、且这条消息就是所有者本人说的
 *      时候（kg_conflict_source.with_personal，同 F16）——所有者本人个人空间的。每条旧决定带作者：
 *      会话里的 = 它全部支撑原话的唯一人类作者（kg_supersede_session_author，不唯一 ⇒ NULL）；个人空间的 = 空间主人。
 *   ② 应用层纯函数（domain/knowledge-graph/decision-supersede.ts）判哪几对算明确改口。判定规则只在那一处。
 *   ③ `kg_apply_supersedes(jsonb)`：在会话锁（+ 个人空间锁）下逐条复核（①的条件原样再判一遍、同一作者、行上锁）。
 *      `prompts`（低把握）⇒ 只开一张 possible_change 卡；`supersedes`（高把握）⇒
 *      把旧决定——连同所有者本人由它晋升出去的、还活着的 L1 副本（同 F16 keep_new：用户说了改，旧说法就不该再被召回）——
 *      转 superseded，给新决定写 supersedes_claim_id，开一条取代提示（kg_supersede_notices）并记下撤销快照。
 *
 * 为什么要 revoked_at（而不只是 status）：本仓库所有「这条还活着吗」的读法都是 `revoked_at IS NULL AND status <> 'superseded'`
 * 两个条件一起用，只有一半的话某处漏判就会把它当活的；F07 的级联（边失效）也挂在 revoked_at 上——旧决定的边跟着失效，
 * 图召回同样走不到它。代价是撤销时要把级联收掉的边放回来：开提示时就把「这次会被收掉的活边」记进快照（restore.edges），
 * 撤销时逐条放回（端点仍在、结论端点仍活着的才放）。
 *
 * supersedes_claim_id：旧决定在本会话里，或会话是所有者本人的个人线程（只有所有者本人看得到这条新结论）时才写——
 * 同 F16 的纪律，项目会话里的结论不指向别人看不到的个人空间 id。取代关系本身总记在提示表里（newer / older）。
 *
 * 撤销（`kg_undo_supersede`，applyHumanAction{undoSupersede}）：人的动作（I-15），与 F10 / F16 同一套前置（所有者、
 * 会话锁 → 个人空间锁、revision）。只恢复快照里、且现在仍是「因这次改口而失效」（revocation_reason = decision_changed）的结论，
 * 恢复成当时的状态；会话里的旧结论另外要求原话还在（原话被删了就没有可恢复的东西）。一条都恢复不了 ⇒ KG_CLAIM_NOT_FOUND。
 * 撤销过的一对不会再被自动取代：同一条新决定只开一张提示（UNIQUE org_id, newer_claim_id），抽取任务重试时跳过。
 */

-- ─────────────────────────── F16 卡的种类（低把握的改口） ───────────────────────────
-- conflict：F16 原有的矛盾提醒（开卡时两条转 contested）；possible_change：#4290 低把握改口（开卡不改状态）。
ALTER TABLE kg_conflict_prompts ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'conflict';
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'kg_conflict_prompts_kind_check') THEN
    ALTER TABLE kg_conflict_prompts ADD CONSTRAINT kg_conflict_prompts_kind_check CHECK (kind IN ('conflict', 'possible_change'));
  END IF;
END
$$;

-- ─────────────────────────────── 提示表 ───────────────────────────────
CREATE TABLE IF NOT EXISTS kg_supersede_notices (
  id              text PRIMARY KEY,
  org_id          text NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  thread_id       text NOT NULL,
  -- 说出改口的那条消息：提示挂在它所在的那一轮回答下面（getTurnMemory）。删消息置空、行留作审计（同 F16）。
  message_id      text REFERENCES chat_messages (id) ON DELETE SET NULL,
  newer_claim_id  text NOT NULL REFERENCES claims (id) ON DELETE CASCADE,
  -- 被取代的那句旧决定（界面上的〈旧〉）；同一句话在会话与个人空间各有一条时，全部都在 restore.claims 里。
  older_claim_id  text NOT NULL REFERENCES claims (id) ON DELETE CASCADE,
  status          text NOT NULL DEFAULT 'applied' CHECK (status IN ('applied', 'undone')),
  -- 撤销快照：{ claims: [{ id, status }], edges: [id], newer_supersedes: text|null }
  restore         jsonb NOT NULL,
  detected_by_action_id text NOT NULL,
  undone_by       text,
  undone_at       timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CHECK (newer_claim_id <> older_claim_id),
  CHECK ((status = 'undone') = (undone_at IS NOT NULL)),
  UNIQUE (org_id, newer_claim_id)
);
CREATE INDEX IF NOT EXISTS kg_supersede_notices_message_idx ON kg_supersede_notices (org_id, message_id, created_at);
CREATE INDEX IF NOT EXISTS kg_supersede_notices_older_idx ON kg_supersede_notices (org_id, older_claim_id);

ALTER TABLE kg_supersede_notices ENABLE ROW LEVEL SECURITY;
ALTER TABLE kg_supersede_notices FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS kg_supersede_notices_tenant ON kg_supersede_notices;
CREATE POLICY kg_supersede_notices_tenant ON kg_supersede_notices
  USING (org_id = current_setting('app.current_org', true) OR (SELECT public.kg_is_table_owner()))
  WITH CHECK (org_id = current_setting('app.current_org', true) OR (SELECT public.kg_is_table_owner()));
-- 可见性跟随两条结论（子查询受 claims 的个人空间策略约束）：旧决定在所有者个人空间时，别人连提示存在都看不到（I-14）。
DROP POLICY IF EXISTS kg_supersede_notices_claims_visible ON kg_supersede_notices;
CREATE POLICY kg_supersede_notices_claims_visible ON kg_supersede_notices AS RESTRICTIVE
  USING ((SELECT public.kg_is_table_owner())
      OR (EXISTS (SELECT 1 FROM claims c WHERE c.id = newer_claim_id AND c.org_id = kg_supersede_notices.org_id)
          AND EXISTS (SELECT 1 FROM claims c WHERE c.id = older_claim_id AND c.org_id = kg_supersede_notices.org_id)));
-- 只读：开提示与撤销都经下面的 SECURITY DEFINER 函数。
REVOKE ALL ON kg_supersede_notices FROM app_rw;
GRANT SELECT ON kg_supersede_notices TO app_rw;

-- ─────────────────────────────── 候选 ───────────────────────────────

-- 会话里一条结论的作者：全部支撑原话都是人说的、且是同一个人 ⇒ 那个人；否则 NULL（不取代）。
CREATE OR REPLACE FUNCTION kg_supersede_session_author(p_org text, p_claim text) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT CASE WHEN count(*) > 0 AND bool_and(m.author_kind = 'human') AND count(DISTINCT m.author_id) = 1
              THEN min(m.author_id) END
    FROM public.claim_message_evidence e JOIN public.chat_messages m ON m.id = e.message_id AND m.org_id = e.org_id
   WHERE e.org_id = p_org AND e.claim_id = p_claim AND e.stance = 'supporting'
$$;

-- 还活着的旧决定：活着、没在冲突里、是决定；本会话的（不是这条消息刚抽出的），或所有者本人个人空间的
-- （p_owner 非空时；由这条消息刚抽出的结论晋升 / 自动记入出去的副本不算——那是新说法本身）。
CREATE OR REPLACE FUNCTION kg_supersede_older_ok(p_org text, p_thread text, p_message text, p_owner text, p_claim text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.claims c
     WHERE c.org_id = p_org AND c.id = p_claim AND c.revoked_at IS NULL
       AND c.status IN ('proposed', 'reviewed', 'accepted') AND c.claim_kind = 'decision'
       AND ((c.scope_kind = 'chat_session' AND c.scope_id = p_thread
             AND NOT EXISTS (SELECT 1 FROM public.claim_message_evidence e
                              WHERE e.org_id = p_org AND e.claim_id = c.id AND e.message_id = p_message))
         OR (p_owner IS NOT NULL AND c.scope_kind = 'personal' AND c.scope_id = p_owner
             AND NOT EXISTS (SELECT 1 FROM public.ontology_edges d
                               JOIN public.claim_message_evidence e ON e.claim_id = d.dst_id AND e.org_id = d.org_id
                              WHERE d.org_id = p_org AND d.src_kind = 'claim' AND d.src_id = c.id AND d.relation = 'derived_from'
                                AND d.dst_kind = 'claim' AND e.message_id = p_message))))
$$;

CREATE OR REPLACE FUNCTION kg_supersede_candidates(p_thread text, p_message text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_org    text := current_setting('app.current_org', true);
  v_src    record;
  v_owner  text;
  v_author text;
BEGIN
  IF v_org IS NULL OR v_org = '' THEN RAISE EXCEPTION 'KG_NO_TENANT' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v_src FROM kg_conflict_source(v_org, p_thread, p_message);
  IF NOT FOUND THEN RETURN jsonb_build_object('fresh', '[]'::jsonb, 'live', '[]'::jsonb); END IF;
  v_owner := CASE WHEN v_src.with_personal THEN v_src.owner END;
  SELECT m.author_id INTO v_author FROM chat_messages m WHERE m.org_id = v_org AND m.id = p_message;
  RETURN jsonb_build_object(
    'fresh', (SELECT coalesce(jsonb_agg(jsonb_build_object(
                'id', c.id, 'kind', c.claim_kind, 'statement', c.statement, 'authorId', v_author) ORDER BY c.id), '[]'::jsonb)
                FROM claims c
               WHERE c.org_id = v_org AND c.scope_kind = 'chat_session' AND c.scope_id = p_thread
                 AND c.claim_kind = 'decision' AND kg_conflict_newer_ok(v_org, p_thread, p_message, c.id)),
    'live', (SELECT coalesce(jsonb_agg(jsonb_build_object(
                'id', c.id, 'kind', c.claim_kind, 'statement', c.statement, 'scope', c.scope_kind,
                'authorId', CASE WHEN c.scope_kind = 'personal' THEN c.scope_id ELSE kg_supersede_session_author(v_org, c.id) END)
                ORDER BY c.id), '[]'::jsonb)
                FROM claims c
               WHERE c.org_id = v_org
                 AND ((c.scope_kind = 'chat_session' AND c.scope_id = p_thread) OR (c.scope_kind = 'personal' AND c.scope_id = v_owner))
                 AND kg_supersede_older_ok(v_org, p_thread, p_message, v_owner, c.id)));
END
$$;

-- ─────────────────────────────── 取代 ───────────────────────────────
-- p = { action_id, thread_id, message_id, supersedes: [{ newer, olders: [id, …] }], prompts: [{ newer, older }] }
-- 复核不过的旧条静默跳过（判定和落表之间状态可能变了）；一条新决定一张提示 / 一张卡；返回开了几张（提示 + 卡）。
CREATE OR REPLACE FUNCTION kg_apply_supersedes(p jsonb) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_org      text := current_setting('app.current_org', true);
  v_thread   text := p->>'thread_id';
  v_message  text := p->>'message_id';
  v_id       text := p->>'action_id';
  v_src      record;
  v_owner    text;
  v_author   text;
  v_item     jsonb;
  v_newer    record;
  v_older    record;
  v_olders   text[];
  v_rep      text;
  v_set      text[];
  v_restore  jsonb;
  v_session  text[] := '{}';
  v_personal text[] := '{}';
  v_key      text;
  v_csession text[] := '{}';
  v_cpersonal text[] := '{}';
  n          int := 0;
  m          int := 0;
BEGIN
  IF v_org IS NULL OR v_org = '' THEN RAISE EXCEPTION 'KG_NO_TENANT' USING ERRCODE = '42501'; END IF;
  IF NOT public.kernel_org_is_writable(v_org) THEN
    RAISE EXCEPTION 'KG_ORG_FROZEN: organization % is read-only', v_org USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_src FROM kg_conflict_source(v_org, v_thread, v_message);
  IF NOT FOUND THEN RETURN 0; END IF;
  v_owner := CASE WHEN v_src.with_personal THEN v_src.owner END;
  SELECT m.author_id INTO v_author FROM chat_messages m WHERE m.org_id = v_org AND m.id = v_message;
  IF v_author IS NULL THEN RETURN 0; END IF;

  -- 与 F10 / F11 / F16 同一把会话锁、同一个顺序（先会话、后个人空间）。
  PERFORM pg_advisory_xact_lock(hashtext('kg_scope:' || v_org || '|chat_session|' || v_thread));
  IF v_owner IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtext('kg_scope:' || v_org || '|personal|' || v_owner));
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(coalesce(p->'supersedes', '[]'::jsonb)) LOOP
    CONTINUE WHEN v_item->>'newer' IS NULL;
    SELECT * INTO v_newer FROM claims WHERE org_id = v_org AND id = v_item->>'newer' FOR UPDATE;
    CONTINUE WHEN NOT FOUND;
    CONTINUE WHEN v_newer.claim_kind IS DISTINCT FROM 'decision' OR NOT kg_conflict_newer_ok(v_org, v_thread, v_message, v_newer.id);
    -- 一条新决定只取代一次：撤销过的不会因为任务重试又被取代
    CONTINUE WHEN EXISTS (SELECT 1 FROM kg_supersede_notices x WHERE x.org_id = v_org AND x.newer_claim_id = v_newer.id);

    v_olders := '{}';
    FOR v_older IN
      SELECT c.* FROM claims c
       WHERE c.org_id = v_org AND c.id IN (SELECT jsonb_array_elements_text(coalesce(v_item->'olders', '[]'::jsonb)))
       ORDER BY (c.scope_kind = 'chat_session') DESC, c.id
       FOR UPDATE
    LOOP
      CONTINUE WHEN v_older.id = v_newer.id OR NOT kg_supersede_older_ok(v_org, v_thread, v_message, v_owner, v_older.id);
      -- 同一作者（不同作者之间不取代，只走 F16）
      CONTINUE WHEN v_author IS DISTINCT FROM
        (CASE WHEN v_older.scope_kind = 'personal' THEN v_older.scope_id ELSE kg_supersede_session_author(v_org, v_older.id) END);
      v_olders := v_olders || v_older.id;
    END LOOP;
    CONTINUE WHEN cardinality(v_olders) = 0;
    v_rep := v_olders[1];

    -- 连同所有者本人由这些旧条晋升出去的、还活着的 L1 副本（同 F16 keep_new）
    SELECT array_agg(DISTINCT x) INTO v_set FROM (
      SELECT unnest(v_olders) AS x
      UNION
      SELECT pc.id FROM claims pc
       WHERE v_owner IS NOT NULL AND pc.org_id = v_org AND pc.scope_kind = 'personal' AND pc.scope_id = v_owner
         AND pc.revoked_at IS NULL AND pc.status <> 'superseded'
         AND EXISTS (SELECT 1 FROM ontology_edges d WHERE d.org_id = v_org AND d.src_kind = 'claim' AND d.src_id = pc.id
                       AND d.relation = 'derived_from' AND d.dst_kind = 'claim' AND d.dst_id = ANY(v_olders))) s;
    PERFORM 1 FROM claims WHERE org_id = v_org AND id = ANY(v_set) FOR UPDATE;

    -- 撤销快照：当时的状态、这次会被 F07 级联收掉的活边、新条原来的 supersedes
    v_restore := jsonb_build_object(
      'claims', (SELECT jsonb_agg(jsonb_build_object('id', c.id, 'status', c.status) ORDER BY c.id)
                   FROM claims c WHERE c.org_id = v_org AND c.id = ANY(v_set)),
      'edges', (SELECT coalesce(jsonb_agg(e.id ORDER BY e.id), '[]'::jsonb) FROM ontology_edges e
                 WHERE e.org_id = v_org AND e.status = 'active'
                   AND ((e.src_kind = 'claim' AND e.src_id = ANY(v_set)) OR (e.dst_kind = 'claim' AND e.dst_id = ANY(v_set)))),
      'newer_supersedes', v_newer.supersedes_claim_id);

    UPDATE claims SET status = 'superseded', revoked_at = now(), revocation_reason = 'decision_changed', updated_at = now()
     WHERE org_id = v_org AND id = ANY(v_set) AND revoked_at IS NULL;
    UPDATE claims SET supersedes_claim_id = v_rep, updated_at = now()
     WHERE org_id = v_org AND id = v_newer.id
       AND ((SELECT c.scope_kind FROM claims c WHERE c.org_id = v_org AND c.id = v_rep) = 'chat_session' OR v_owner IS NOT NULL);

    INSERT INTO kg_supersede_notices (id, org_id, thread_id, message_id, newer_claim_id, older_claim_id, restore, detected_by_action_id)
    VALUES (v_id || '-' || n, v_org, v_thread, v_message, v_newer.id, v_rep, v_restore, v_id);
    n := n + 1;
    v_session := v_session || v_newer.id;
    v_session := v_session || ARRAY(SELECT c.id FROM claims c WHERE c.org_id = v_org AND c.id = ANY(v_set) AND c.scope_kind = 'chat_session');
    v_personal := v_personal || ARRAY(SELECT c.id FROM claims c WHERE c.org_id = v_org AND c.id = ANY(v_set) AND c.scope_kind = 'personal');
  END LOOP;

  -- 低把握（frame_only）：只开一张 possible_change 卡，两条都不改状态（选之前都照常生效、都召回）。复核同上。
  FOR v_item IN SELECT * FROM jsonb_array_elements(coalesce(p->'prompts', '[]'::jsonb)) LOOP
    CONTINUE WHEN v_item->>'newer' IS NULL OR v_item->>'older' IS NULL OR v_item->>'newer' = v_item->>'older';
    SELECT * INTO v_newer FROM claims WHERE org_id = v_org AND id = v_item->>'newer' FOR UPDATE;
    CONTINUE WHEN NOT FOUND;
    SELECT * INTO v_older FROM claims WHERE org_id = v_org AND id = v_item->>'older' FOR UPDATE;
    CONTINUE WHEN NOT FOUND;
    CONTINUE WHEN v_newer.claim_kind IS DISTINCT FROM 'decision' OR NOT kg_conflict_newer_ok(v_org, v_thread, v_message, v_newer.id);
    CONTINUE WHEN NOT kg_supersede_older_ok(v_org, v_thread, v_message, v_owner, v_older.id);
    CONTINUE WHEN v_author IS DISTINCT FROM
      (CASE WHEN v_older.scope_kind = 'personal' THEN v_older.scope_id ELSE kg_supersede_session_author(v_org, v_older.id) END);
    -- 一条新决定只问一次（任务重试不再开第二张）；已经自动取代过的不再问
    CONTINUE WHEN EXISTS (SELECT 1 FROM kg_supersede_notices x WHERE x.org_id = v_org AND x.newer_claim_id = v_newer.id);
    CONTINUE WHEN EXISTS (SELECT 1 FROM kg_conflict_prompts x WHERE x.org_id = v_org AND x.newer_claim_id = v_newer.id);
    v_key := kg_conflict_statement_key(v_newer.statement);
    -- 同一旧条、同样说法已经问过（卡还开着 / 选了两条都保留）⇒ 不再问（同 F16 I-19）
    CONTINUE WHEN EXISTS (SELECT 1 FROM kg_conflict_prompts x
                           WHERE x.org_id = v_org AND x.older_claim_id = v_older.id AND x.newer_key = v_key
                             AND x.status IN ('open', 'ignored', 'kept_both'));
    INSERT INTO kg_conflict_prompts (id, org_id, thread_id, message_id, newer_claim_id, older_claim_id, newer_key, rank,
                                     detected_by_action_id, kind)
    VALUES (v_id || '-c' || m, v_org, v_thread, v_message, v_newer.id, v_older.id, v_key, m, v_id || '-c', 'possible_change');
    m := m + 1;
    v_csession := v_csession || v_newer.id;
    IF v_older.scope_kind = 'personal' THEN v_cpersonal := v_cpersonal || v_older.id; ELSE v_csession := v_csession || v_older.id; END IF;
  END LOOP;

  -- 会话作用域留一条（revision 前进；来源抽屉按 payload.claims 查）；个人空间的旧条单独在个人空间留一条（同 F16）。
  IF n > 0 THEN
    INSERT INTO ontology_actions (id, org_id, scope_kind, scope_id, actor_kind, actor_id, action_type, payload, source_ref, outcome)
    VALUES (v_id, v_org, 'chat_session', v_thread, 'system', 'kg-supersede-detector', 'supersedeDecision',
            jsonb_build_object('message_id', v_message, 'notices', n, 'reason', 'decision_changed',
                               'claims', (SELECT coalesce(jsonb_agg(DISTINCT jsonb_build_object('id', x)), '[]'::jsonb) FROM unnest(v_session) x)),
            v_message, 'accepted');
    IF cardinality(v_personal) > 0 THEN
      INSERT INTO ontology_actions (id, org_id, scope_kind, scope_id, actor_kind, actor_id, action_type, payload, source_ref, outcome)
      VALUES (v_id || '-l1', v_org, 'personal', v_owner, 'system', 'kg-supersede-detector', 'supersedeDecision',
              jsonb_build_object('thread_id', v_thread, 'reason', 'decision_changed',
                                 'claims', (SELECT jsonb_agg(DISTINCT jsonb_build_object('id', x)) FROM unnest(v_personal) x)),
              v_message, 'accepted');
    END IF;
  END IF;
  IF m > 0 THEN
    INSERT INTO ontology_actions (id, org_id, scope_kind, scope_id, actor_kind, actor_id, action_type, payload, source_ref, outcome)
    VALUES (v_id || '-c', v_org, 'chat_session', v_thread, 'system', 'kg-supersede-detector', 'detectPossibleChange',
            jsonb_build_object('message_id', v_message, 'prompts', m,
                               'claims', (SELECT coalesce(jsonb_agg(DISTINCT jsonb_build_object('id', x)), '[]'::jsonb) FROM unnest(v_csession) x)),
            v_message, 'accepted');
    IF cardinality(v_cpersonal) > 0 THEN
      INSERT INTO ontology_actions (id, org_id, scope_kind, scope_id, actor_kind, actor_id, action_type, payload, source_ref, outcome)
      VALUES (v_id || '-c-l1', v_org, 'personal', v_owner, 'system', 'kg-supersede-detector', 'detectPossibleChange',
              jsonb_build_object('thread_id', v_thread,
                                 'claims', (SELECT jsonb_agg(DISTINCT jsonb_build_object('id', x)) FROM unnest(v_cpersonal) x)),
              v_message, 'accepted');
    END IF;
  END IF;
  RETURN n + m;
END
$$;

-- ─────────────────────────────── 撤销（人的动作）───────────────────────────────
-- p = { action_id, thread_id, based_on_revision, action: { type: undoSupersede, noticeId } }
CREATE OR REPLACE FUNCTION kg_undo_supersede(p jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_org      text := current_setting('app.current_org', true);
  v_user     text := current_setting('app.current_user_id', true);
  v_thread   text := p->>'thread_id';
  v_action   jsonb := p->'action';
  v_id       text := p->>'action_id';
  v_rev      bigint;
  v_notice   record;
  v_c        jsonb;
  v_row      record;
  v_session  text[] := '{}';
  v_personal text[] := '{}';
BEGIN
  IF v_org IS NULL OR v_org = '' THEN RAISE EXCEPTION 'KG_NO_TENANT' USING ERRCODE = '42501'; END IF;
  IF NOT public.kernel_org_is_writable(v_org) THEN
    RAISE EXCEPTION 'KG_ORG_FROZEN: organization % is read-only', v_org USING ERRCODE = '42501';
  END IF;
  IF v_user IS NULL OR v_user = '' THEN RAISE EXCEPTION 'KG_ACTOR_NOT_HUMAN: no signed-in user' USING ERRCODE = '42501'; END IF;
  IF NOT EXISTS (SELECT 1 FROM chat_threads t WHERE t.id = v_thread AND t.org_id = v_org AND t.created_by = v_user) THEN
    RAISE EXCEPTION 'KG_NOT_OWNER: only the thread owner edits its knowledge' USING ERRCODE = '42501';
  END IF;
  IF v_action->>'type' IS DISTINCT FROM 'undoSupersede' OR v_action->>'noticeId' IS NULL THEN
    RAISE EXCEPTION 'KG_INVALID_ACTION: %', v_action->>'type' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('kg_scope:' || v_org || '|chat_session|' || v_thread));
  PERFORM pg_advisory_xact_lock(hashtext('kg_scope:' || v_org || '|personal|' || v_user));
  SELECT count(*) INTO v_rev FROM ontology_actions a
   WHERE a.org_id = v_org AND a.scope_kind = 'chat_session' AND a.scope_id = v_thread AND a.outcome = 'accepted';
  IF (p->>'based_on_revision')::bigint IS DISTINCT FROM v_rev THEN
    RAISE EXCEPTION 'KG_REVISION_CHANGED: based on %, current %', p->>'based_on_revision', v_rev USING ERRCODE = '40001';
  END IF;

  -- 本会话的、还没撤销过的提示。别的会话的 id、撤销过的、不存在的——同一个出口。
  SELECT * INTO v_notice FROM kg_supersede_notices
   WHERE org_id = v_org AND id = v_action->>'noticeId' AND thread_id = v_thread AND status = 'applied'
   FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'KG_PROMPT_NOT_FOUND' USING ERRCODE = '23503'; END IF;

  FOR v_c IN SELECT * FROM jsonb_array_elements(coalesce(v_notice.restore->'claims', '[]'::jsonb)) LOOP
    SELECT * INTO v_row FROM claims WHERE org_id = v_org AND id = v_c->>'id' FOR UPDATE;
    CONTINUE WHEN NOT FOUND;
    -- 只恢复「因这次改口而失效」、且调用方有权动的：本会话的，或调用方本人个人空间的
    CONTINUE WHEN v_row.revoked_at IS NULL OR v_row.revocation_reason IS DISTINCT FROM 'decision_changed';
    CONTINUE WHEN NOT ((v_row.scope_kind = 'chat_session' AND v_row.scope_id = v_thread)
                    OR (v_row.scope_kind = 'personal' AND v_row.scope_id = v_user));
    -- 会话里的结论：原话还在才恢复（原话被删了就没有可恢复的东西，同 F07）
    CONTINUE WHEN v_row.scope_kind = 'chat_session'
      AND NOT EXISTS (SELECT 1 FROM claim_message_evidence e WHERE e.org_id = v_org AND e.claim_id = v_row.id AND e.stance = 'supporting')
      AND NOT EXISTS (SELECT 1 FROM claim_segments s WHERE s.claim_id = v_row.id AND s.stance = 'supporting');
    UPDATE claims SET status = v_c->>'status', revoked_at = NULL, revocation_reason = NULL, updated_at = now()
     WHERE org_id = v_org AND id = v_row.id;
    IF v_row.scope_kind = 'personal' THEN v_personal := v_personal || v_row.id; ELSE v_session := v_session || v_row.id; END IF;
  END LOOP;
  IF cardinality(v_session) + cardinality(v_personal) = 0 THEN
    RAISE EXCEPTION 'KG_CLAIM_NOT_FOUND: the superseded decision is gone' USING ERRCODE = '23503';
  END IF;

  -- 放回 F07 级联收掉的边：快照里的、现在仍是失效的、两端都还在（结论端点还活着）的
  UPDATE ontology_edges e SET status = 'active', invalidated_at = NULL
   WHERE e.org_id = v_org AND e.status = 'invalidated'
     AND e.id IN (SELECT jsonb_array_elements_text(coalesce(v_notice.restore->'edges', '[]'::jsonb)))
     AND (e.src_kind <> 'claim' OR EXISTS (SELECT 1 FROM claims c WHERE c.org_id = v_org AND c.id = e.src_id AND c.revoked_at IS NULL))
     AND (e.dst_kind <> 'claim' OR EXISTS (SELECT 1 FROM claims c WHERE c.org_id = v_org AND c.id = e.dst_id AND c.revoked_at IS NULL))
     AND (e.src_kind <> 'chat_message' OR EXISTS (SELECT 1 FROM chat_messages m WHERE m.org_id = v_org AND m.id = e.src_id))
     AND (e.dst_kind <> 'chat_message' OR EXISTS (SELECT 1 FROM chat_messages m WHERE m.org_id = v_org AND m.id = e.dst_id))
     AND (e.src_kind <> 'segment' OR EXISTS (SELECT 1 FROM segments s WHERE s.org_id = v_org AND s.id = e.src_id))
     AND (e.dst_kind <> 'segment' OR EXISTS (SELECT 1 FROM segments s WHERE s.org_id = v_org AND s.id = e.dst_id))
     AND (e.src_kind <> 'object' OR EXISTS (SELECT 1 FROM ontology_objects o WHERE o.org_id = v_org AND o.id = e.src_id))
     AND (e.dst_kind <> 'object' OR EXISTS (SELECT 1 FROM ontology_objects o WHERE o.org_id = v_org AND o.id = e.dst_id));

  -- 新决定仍在；它指向旧条的 supersedes 放回原样
  UPDATE claims SET supersedes_claim_id = v_notice.restore->>'newer_supersedes', updated_at = now()
   WHERE org_id = v_org AND id = v_notice.newer_claim_id AND supersedes_claim_id = v_notice.older_claim_id;
  UPDATE kg_supersede_notices SET status = 'undone', undone_by = v_user, undone_at = now() WHERE id = v_notice.id;

  INSERT INTO ontology_actions (id, org_id, scope_kind, scope_id, actor_kind, actor_id, action_type, payload, outcome)
  VALUES (v_id, v_org, 'chat_session', v_thread, 'human', v_user, 'undoSupersede',
          jsonb_build_object('action', v_action,
                             'claims', (SELECT jsonb_agg(jsonb_build_object('id', x)) FROM unnest(v_session || v_notice.newer_claim_id) x),
                             'objects', '[]'::jsonb),
          'accepted');
  IF cardinality(v_personal) > 0 THEN
    INSERT INTO ontology_actions (id, org_id, scope_kind, scope_id, actor_kind, actor_id, action_type, payload, outcome)
    VALUES (v_id || '-l1', v_org, 'personal', v_user, 'human', v_user, 'undoSupersede',
            jsonb_build_object('thread_id', v_thread, 'claims', (SELECT jsonb_agg(jsonb_build_object('id', x)) FROM unnest(v_personal) x)),
            'accepted');
  END IF;
  RETURN jsonb_build_object('revision', kg_thread_revision(v_thread), 'action_id', v_id);
END
$$;

-- ─────────────────── F16 出口按卡的种类分支（#4290 possible_change） ───────────────────
-- 重建 F16 `kg_resolve_conflict`（20260924290000），只加 kind 分支，其余逐字不变：
--   - possible_change + keep_both（界面上的 [两条都保留]）：只关卡（kept_both），不记适用条件、两条状态都不动（开卡时本来
--     就没转 contested）；ignore 界面上不给，直接调用时同样只关卡（ignored）；
--   - possible_change + keep_new：新条若已有本人个人空间里活着的副本（#4283 自动记下的），转 accepted，不再晋升出第二份；
--     conflict 卡的 keep_new 逐字同 F16（新条开卡时转了 contested，#4283 不会替它记副本，照旧 kg_promote_claim）。
-- p = { action_id, thread_id, based_on_revision, action: { type: resolveConflict, promptId, resolution, conditions? } }
CREATE OR REPLACE FUNCTION kg_resolve_conflict(p jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_org     text := current_setting('app.current_org', true);
  v_user    text := current_setting('app.current_user_id', true);
  v_thread  text := p->>'thread_id';
  v_action  jsonb := p->'action';
  v_res     text := p->'action'->>'resolution';
  v_id      text := p->>'action_id';
  v_rev     bigint;
  v_prompt  record;
  v_newer   record;
  v_older   record;
  v_promote boolean := false;
  v_l1      text;
  v_claims  jsonb;
  v_kind    text;
BEGIN
  IF v_org IS NULL OR v_org = '' THEN RAISE EXCEPTION 'KG_NO_TENANT' USING ERRCODE = '42501'; END IF;
  IF NOT public.kernel_org_is_writable(v_org) THEN
    RAISE EXCEPTION 'KG_ORG_FROZEN: organization % is read-only', v_org USING ERRCODE = '42501';
  END IF;
  IF v_user IS NULL OR v_user = '' THEN RAISE EXCEPTION 'KG_ACTOR_NOT_HUMAN: no signed-in user' USING ERRCODE = '42501'; END IF;
  IF NOT EXISTS (SELECT 1 FROM chat_threads t WHERE t.id = v_thread AND t.org_id = v_org AND t.created_by = v_user) THEN
    RAISE EXCEPTION 'KG_NOT_OWNER: only the thread owner edits its knowledge' USING ERRCODE = '42501';
  END IF;
  IF v_action->>'type' IS DISTINCT FROM 'resolveConflict' OR v_res IS NULL OR v_res NOT IN ('keep_new', 'keep_both', 'ignore') THEN
    RAISE EXCEPTION 'KG_INVALID_ACTION: %', v_action->>'type' USING ERRCODE = '22023';
  END IF;

  -- 锁顺序同 F11：先会话、后个人空间。
  PERFORM pg_advisory_xact_lock(hashtext('kg_scope:' || v_org || '|chat_session|' || v_thread));
  PERFORM pg_advisory_xact_lock(hashtext('kg_scope:' || v_org || '|personal|' || v_user));
  SELECT count(*) INTO v_rev FROM ontology_actions a
   WHERE a.org_id = v_org AND a.scope_kind = 'chat_session' AND a.scope_id = v_thread AND a.outcome = 'accepted';
  IF (p->>'based_on_revision')::bigint IS DISTINCT FROM v_rev THEN
    RAISE EXCEPTION 'KG_REVISION_CHANGED: based on %, current %', p->>'based_on_revision', v_rev USING ERRCODE = '40001';
  END IF;

  -- 提醒：本会话的、还开着的。别的会话的 id、处理过的、不存在的——同一个出口。
  SELECT * INTO v_prompt FROM kg_conflict_prompts
   WHERE org_id = v_org AND id = v_action->>'promptId' AND thread_id = v_thread AND status = 'open'
   FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'KG_PROMPT_NOT_FOUND' USING ERRCODE = '23503'; END IF;
  -- #4290：低把握改口的卡界面上只有两个出口（取代 / 两条都保留）；ignore 若被直接调用，同 keep_both 只关卡
  -- （两条本来就没转 contested，没有「保持冲突」可言），记作 ignored。
  v_kind := v_prompt.kind;
  SELECT * INTO v_newer FROM claims WHERE org_id = v_org AND id = v_prompt.newer_claim_id FOR UPDATE;
  SELECT * INTO v_older FROM claims WHERE org_id = v_org AND id = v_prompt.older_claim_id FOR UPDATE;
  -- 两条里有一条已经被改写 / 忘掉 / 取代：这张卡说的那一对已经不存在了
  IF v_newer.revoked_at IS NOT NULL OR v_newer.status = 'superseded' OR v_older.revoked_at IS NOT NULL OR v_older.status = 'superseded'
     OR NOT (v_newer.scope_kind = 'chat_session' AND v_newer.scope_id = v_thread)
     OR NOT ((v_older.scope_kind = 'chat_session' AND v_older.scope_id = v_thread) OR (v_older.scope_kind = 'personal' AND v_older.scope_id = v_user)) THEN
    RAISE EXCEPTION 'KG_PROMPT_NOT_FOUND: the conflicting pair has changed' USING ERRCODE = '23503';
  END IF;

  -- 先把这张卡结掉，再动两条结论：结论变成 superseded 会触发 kg_conflict_close_on_change（见下），
  -- 它只收「还开着 / 被忽略」的卡——这张卡此刻已经不是了，不会被当成「因为别处的改动而结束」。
  UPDATE kg_conflict_prompts
     SET status = CASE v_res WHEN 'keep_new' THEN 'kept_new' WHEN 'keep_both' THEN 'kept_both' ELSE 'ignored' END,
         resolved_by = v_user, resolved_at = now(),
         newer_condition = CASE WHEN v_res = 'keep_both' AND v_kind = 'conflict' THEN nullif(btrim(v_action->'conditions'->>'newer'), '') END,
         older_condition = CASE WHEN v_res = 'keep_both' AND v_kind = 'conflict' THEN nullif(btrim(v_action->'conditions'->>'older'), '') END
   WHERE id = v_prompt.id;

  IF v_res = 'keep_new' THEN
    -- 旧条在长期记忆里（本身在个人空间，或有本人的 L1 副本）⇒ 新条也记进去，长期记忆里留的是新说法。
    v_promote := v_older.scope_kind = 'personal' OR EXISTS (
      SELECT 1 FROM ontology_edges d JOIN claims pc ON pc.id = d.src_id AND pc.org_id = d.org_id
       WHERE d.org_id = v_org AND d.relation = 'derived_from' AND d.status = 'active' AND d.dst_kind = 'claim' AND d.dst_id = v_older.id
         AND pc.scope_kind = 'personal' AND pc.scope_id = v_user AND pc.revoked_at IS NULL);
    -- 本人由旧条晋升出去的 L1 副本一并失效：F07 的级联只在「所有来源都失效」时才收 L1（副本可能还合并了
    -- 别的会话的来源），那样长期记忆里会同时留着新旧两种说法。用户选了「以新的为准」，旧说法就不该再被召回。
    UPDATE claims pc SET status = 'superseded', revoked_at = now(), revocation_reason = 'conflict_keep_new', updated_at = now()
     WHERE pc.org_id = v_org AND pc.scope_kind = 'personal' AND pc.scope_id = v_user AND pc.revoked_at IS NULL
       AND EXISTS (SELECT 1 FROM ontology_edges d WHERE d.org_id = v_org AND d.src_kind = 'claim' AND d.src_id = pc.id
                     AND d.relation = 'derived_from' AND d.dst_kind = 'claim' AND d.dst_id = v_older.id);
    UPDATE claims SET status = 'superseded', revoked_at = now(), revocation_reason = 'conflict_keep_new', updated_at = now()
     WHERE org_id = v_org AND id = v_older.id;
    -- supersedes 只在同一作用域里连：会话里的结论不能指着一条别人看不到的个人空间 id。
    UPDATE claims SET status = 'accepted', reviewed_by = v_user, updated_at = now(),
                      supersedes_claim_id = CASE WHEN v_older.scope_kind = 'chat_session' THEN v_older.id ELSE supersedes_claim_id END
     WHERE org_id = v_org AND id = v_newer.id;
    IF v_promote THEN
      -- #4290：possible_change 卡的新条没转 contested，#4283 可能已经把它自动记进了本人个人空间（「AI 记下的」）——
      -- 那一份就是长期记忆里的新说法：转「你确认过」，不再晋升出第二份。conflict 卡不走这里（v_l1 为空 ⇒ 逐字同 F16）。
      IF v_kind = 'possible_change' THEN
        SELECT pc.id INTO v_l1 FROM claims pc
         WHERE pc.org_id = v_org AND pc.scope_kind = 'personal' AND pc.scope_id = v_user AND pc.revoked_at IS NULL AND pc.status <> 'superseded'
           AND EXISTS (SELECT 1 FROM ontology_edges d WHERE d.org_id = v_org AND d.src_kind = 'claim' AND d.src_id = pc.id
                         AND d.relation = 'derived_from' AND d.status = 'active' AND d.dst_kind = 'claim' AND d.dst_id = v_newer.id)
         ORDER BY pc.id LIMIT 1 FOR UPDATE;
      END IF;
      IF v_l1 IS NOT NULL THEN
        UPDATE claims SET status = 'accepted', reviewed_by = v_user, updated_at = now()
         WHERE org_id = v_org AND id = v_l1 AND status IN ('proposed', 'reviewed');
      ELSE
        v_l1 := kg_promote_claim(jsonb_build_object('action_id', v_id || '-p', 'thread_id', v_thread, 'claim_id', v_newer.id));
      END IF;
      IF v_older.scope_kind = 'personal' THEN
        UPDATE claims SET supersedes_claim_id = v_older.id WHERE org_id = v_org AND id = v_l1 AND id <> v_older.id;
      END IF;
    END IF;

  ELSIF v_res = 'keep_both' AND v_kind = 'conflict' THEN
    UPDATE claims SET status = 'accepted', reviewed_by = v_user, updated_at = now()
     WHERE org_id = v_org AND id IN (v_newer.id, v_older.id);
  END IF;
  -- ignore：两条保持冲突；这一对不再提醒（开卡时按 status = ignored 挡住）
  -- #4290 possible_change + keep_both：两条本来就没转 contested，只关卡（kept_both 同样挡住同一对再问）

  v_claims := CASE WHEN v_older.scope_kind = 'chat_session'
                   THEN jsonb_build_array(jsonb_build_object('id', v_newer.id), jsonb_build_object('id', v_older.id))
                   ELSE jsonb_build_array(jsonb_build_object('id', v_newer.id)) END;
  INSERT INTO ontology_actions (id, org_id, scope_kind, scope_id, actor_kind, actor_id, action_type, payload, outcome)
  VALUES (v_id, v_org, 'chat_session', v_thread, 'human', v_user, 'resolveConflict',
          jsonb_build_object('action', v_action, 'claims', v_claims, 'objects', '[]'::jsonb), 'accepted');
  IF v_older.scope_kind = 'personal' AND v_res <> 'ignore' AND NOT (v_kind = 'possible_change' AND v_res = 'keep_both') THEN
    INSERT INTO ontology_actions (id, org_id, scope_kind, scope_id, actor_kind, actor_id, action_type, payload, outcome)
    VALUES (v_id || '-l1', v_org, 'personal', v_user, 'human', v_user, 'resolveConflict',
            jsonb_build_object('thread_id', v_thread, 'resolution', v_res, 'claims', jsonb_build_array(jsonb_build_object('id', v_older.id))),
            'accepted');
  END IF;
  -- 重数一遍而不是 v_rev + 1：取代旧条可能顺带结束了同一旧条上别的卡（kg_conflict_close_on_change 各记一条）。
  RETURN jsonb_build_object('revision', kg_thread_revision(v_thread), 'action_id', v_id);
END
$$;

REVOKE ALL ON FUNCTION kg_supersede_session_author(text, text), kg_supersede_older_ok(text, text, text, text, text),
  kg_supersede_candidates(text, text), kg_apply_supersedes(jsonb), kg_undo_supersede(jsonb) FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_rw') THEN
    GRANT EXECUTE ON FUNCTION kg_supersede_candidates(text, text), kg_apply_supersedes(jsonb), kg_undo_supersede(jsonb) TO app_rw;
  END IF;
END
$$;

-- 停用组织的冻结策略（F22 单一事实源，新租户表建完调用一次）
SELECT kernel_apply_org_freeze_policies();

/*
 * Phase 18 F16 —— 矛盾提醒（uc-18-6 D / uc-18-1 A3，契约 KgConflictPrompt、applyHumanAction{resolveConflict}）。
 *
 * 流程：抽取（F06）把一条用户消息的结论交给执行器之后，同一个任务里接着判矛盾——
 *   ① `kg_conflict_candidates(thread, message)`：只读。这条消息刚抽出的结论（model / proposed），
 *      以及「你确认过」的结论（reviewed_by 非空、accepted 或已在冲突中）：本会话的，外加——只在个人线程、
 *      且这条消息就是会话所有者本人说的时候——所有者本人个人空间的（从本会话晋升出去的副本不重复算）。
 *   ② 应用层纯函数（domain/knowledge-graph/conflict.ts）判哪几对算矛盾、排好先后。
 *   ③ `kg_open_conflicts(jsonb)`：在会话锁下逐对复核（①的条件原样再判一遍、两行 FOR UPDATE），
 *      两条转 contested、给旧的那条挂一条 contradicting 证据（这条消息）、开一张提醒（kg_conflict_prompts）。
 * 判定规则只在 ② 一处；这里只保证「被判为矛盾的一对确实是一新一旧、都在调用方有权动的范围里」。
 *
 * 出口：`kg_resolve_conflict(jsonb)` —— 人的动作（I-15），与 F10 `kg_apply_human_action` 同一套
 * 前置（所有者、会话锁、revision），分成单独的函数是为了不整段重写 F10 的函数体：
 *   - keep_new：旧条 superseded（revoked_at，原因 conflict_keep_new，F07 的级联把它的边和 L1 副本一起收掉），
 *     新条 accepted；旧条在个人空间、或旧条有过本人的 L1 副本时，新条同一动作里记进个人空间（F11 kg_promote_claim），
 *     长期记忆里留下的是新的说法。
 *   - keep_both：两条都 accepted，各记一句适用条件，结束冲突。
 *   - ignore：两条保持 contested；这一对（旧条 + 同样说法的新条）不再提醒（I-19）。
 *
 * 冲突怎么结束：除了上面三个出口，一对里任一条经**别的路**失效（F10 改写 / 忘掉、F07 原话被删、另一张卡
 * 「以新的为准」取代了共用的旧条……）⇒ 触发器 `kg_conflict_close_on_change` 把这张卡（开着的或被忽略的）
 * 记为 closed_by_change，另一条若已没有别的未了结冲突，就从 contested 放回去（有人确认过 ⇒ accepted，否则 proposed），
 * 可以重新确认、晋升。放在数据库触发器里，是因为改动的来路不止一条，任何一条漏了都会把另一条永远卡在冲突里。
 * **触发器从不等锁**：它跑在一条结论的 UPDATE 里（已持有那一行，通常还有本会话锁），这时再去**等**别的会话的锁 /
 * 个人空间锁 / 另一行，就把「会话锁 → 个人空间锁 → 行」的顺序倒过来了，跨会话会死锁（同一条个人空间结论可以是
 * 所有者好几个个人线程里的卡的旧条）。所以触发器里一律「试一下」：锁都能立刻拿到（本事务已持有的 advisory lock
 * 可重入，照样立刻拿到）⇒ 当场结束；有一样拿不到 ⇒ 把卡 id 放进 `kg_conflict_close_queue` 就返回。
 * 队列由抽取 worker 的每一轮 tick 排空（`kg_conflict_close_drain()`，一次一张卡、一张卡一个事务，按
 * 会话锁 → 个人空间锁 → 行的正常顺序等锁，再判一遍、结束、放回），可重复执行。
 * ⚠ 放回去的判据只看这张表：同一条结论如果还被 F10 的「标冲突」手工标过（那一对不在这张表里），也会被放回——
 *   标冲突的另一条通常就是这里的另一条，接受这个近似。
 *
 * I-19 的「同一对」按**旧条 id + 新说法的归一文本**认：同一句话再说一遍，抽取会产生一条新 id 的结论，
 * 按 id 认就会再弹一次。旧条被改写（新 id）或被取代后，这个键自然失效——「直到其中一条被改」。
 */

-- ─────────────────────────────── 提醒表 ───────────────────────────────
CREATE TABLE IF NOT EXISTS kg_conflict_prompts (
  id              text PRIMARY KEY,
  org_id          text NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  thread_id       text NOT NULL,
  -- 说出新说法的那条消息：这张卡挂在它所在的那一轮回答下面（getTurnMemory）。
  -- 消息删了置空而不是连删：删消息会经 F07 让新条失效，kg_conflict_close_on_change 要靠这一行去结束冲突、
  -- 把另一条放回来。外键级联与 F07 的证据触发器谁先跑没有保证，连删的话那一行可能已经没了，另一条就永远卡在冲突里。
  -- 置空之后这张卡挂不到任何一轮上（读的时候按 message_id 找），行留着做审计。
  message_id      text REFERENCES chat_messages (id) ON DELETE SET NULL,
  newer_claim_id  text NOT NULL REFERENCES claims (id) ON DELETE CASCADE,
  older_claim_id  text NOT NULL REFERENCES claims (id) ON DELETE CASCADE,
  -- 新说法的归一文本（I-19 的键）：kg_conflict_statement_key()
  newer_key       text NOT NULL,
  -- 同一次判定里的先后（0 = 最重要）：一轮只出一张，取最小的那张（R4 E3 / I-18）
  rank            integer NOT NULL CHECK (rank >= 0),
  -- closed_by_change：一对里有一条在别处被改写 / 忘掉 / 取代（含原话被删），冲突随之结束（R7-2「直到其中一条被改」）
  status          text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'kept_new', 'kept_both', 'ignored', 'closed_by_change')),
  newer_condition text CHECK (newer_condition IS NULL OR length(newer_condition) <= 200),
  older_condition text CHECK (older_condition IS NULL OR length(older_condition) <= 200),
  detected_by_action_id text NOT NULL,
  resolved_by     text,
  resolved_at     timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CHECK (newer_claim_id <> older_claim_id),
  CHECK ((status = 'open') = (resolved_at IS NULL)),
  UNIQUE (org_id, older_claim_id, newer_claim_id)
);
CREATE INDEX IF NOT EXISTS kg_conflict_prompts_message_idx ON kg_conflict_prompts (org_id, message_id, rank);
CREATE INDEX IF NOT EXISTS kg_conflict_prompts_pair_idx ON kg_conflict_prompts (org_id, older_claim_id, newer_key);
-- 触发器按「这条结论在哪些卡里」找卡：旧条走上面的索引，新条走这一条。
CREATE INDEX IF NOT EXISTS kg_conflict_prompts_newer_idx ON kg_conflict_prompts (org_id, newer_claim_id);

ALTER TABLE kg_conflict_prompts ENABLE ROW LEVEL SECURITY;
ALTER TABLE kg_conflict_prompts FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS kg_conflict_prompts_tenant ON kg_conflict_prompts;
-- 表属主例外（同 F02 kg_is_table_owner 的约定）：结束冲突的触发器 / 队列排空以属主身份运行，云上的属主角色
-- 不是超级用户、没有 BYPASSRLS（FORCE RLS 对它生效）；没有租户上下文的级联（例如按 org 的清理）里它也要看得到卡。
-- 这些 SECURITY DEFINER 函数自己按 org_id 限定每一条语句。app_rw 不是属主角色的成员，例外对它不成立。
CREATE POLICY kg_conflict_prompts_tenant ON kg_conflict_prompts
  USING (org_id = current_setting('app.current_org', true) OR (SELECT public.kg_is_table_owner()))
  WITH CHECK (org_id = current_setting('app.current_org', true) OR (SELECT public.kg_is_table_owner()));
-- 可见性跟随两条结论（子查询受 claims 的个人空间策略约束）：旧条在所有者个人空间里时，
-- 会话的其他成员连这张卡存在都看不到（I-14）。
DROP POLICY IF EXISTS kg_conflict_prompts_claims_visible ON kg_conflict_prompts;
CREATE POLICY kg_conflict_prompts_claims_visible ON kg_conflict_prompts AS RESTRICTIVE
  USING ((SELECT public.kg_is_table_owner())
      OR (EXISTS (SELECT 1 FROM claims c WHERE c.id = newer_claim_id AND c.org_id = kg_conflict_prompts.org_id)
          AND EXISTS (SELECT 1 FROM claims c WHERE c.id = older_claim_id AND c.org_id = kg_conflict_prompts.org_id)));
-- 只读：开卡与处理都经下面的 SECURITY DEFINER 函数。
REVOKE ALL ON kg_conflict_prompts FROM app_rw;
GRANT SELECT ON kg_conflict_prompts TO app_rw;

-- I-19 的键：NFKC、去空白、小写。「上线改到 10/1」与「上线改到 10／1 」是同一句话。
CREATE OR REPLACE FUNCTION kg_conflict_statement_key(p_statement text) RETURNS text
LANGUAGE sql IMMUTABLE AS $$ SELECT lower(regexp_replace(normalize(p_statement, NFKC), '\s+', '', 'g')) $$;

-- 这条消息能不能引出矛盾提醒，以及能不能拿所有者的个人空间来比：
--   消息在本会话、人说的、不是更窄可见范围的消息；个人空间只在个人线程里、且消息是所有者本人说的。
CREATE OR REPLACE FUNCTION kg_conflict_source(p_org text, p_thread text, p_message text)
RETURNS TABLE (owner text, with_personal boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp
AS $$
  -- 个人空间还要求调用方已声明「以所有者身份」（app.current_user_id = 所有者）：没声明就不碰任何人的个人空间（I-14 默认关）。
  SELECT t.created_by, (t.project_id IS NULL AND m.author_id = t.created_by
                        AND t.created_by = current_setting('app.current_user_id', true))
    FROM public.chat_messages m JOIN public.chat_threads t ON t.id = m.thread_id AND t.org_id = m.org_id
   WHERE m.org_id = p_org AND m.id = p_message AND m.thread_id = p_thread
     AND m.author_kind = 'human' AND m.visibility_scope IS NULL AND m.raw_transcript = false
$$;

-- 「你确认过」的旧条：活着、有人确认过（reviewed_by）、accepted 或已在冲突中（被忽略的那一对还要能挡住重复提醒）。
-- 本会话的；或者所有者本人个人空间的（p_owner 非空时），但从本会话晋升出去的副本不算——本会话的原条已经在候选里。
CREATE OR REPLACE FUNCTION kg_conflict_older_ok(p_org text, p_thread text, p_owner text, p_claim text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.claims c
     WHERE c.org_id = p_org AND c.id = p_claim AND c.revoked_at IS NULL
       AND c.status IN ('accepted', 'contested') AND c.reviewed_by IS NOT NULL
       AND ((c.scope_kind = 'chat_session' AND c.scope_id = p_thread)
         OR (p_owner IS NOT NULL AND c.scope_kind = 'personal' AND c.scope_id = p_owner
             AND NOT EXISTS (SELECT 1 FROM public.ontology_edges d JOIN public.claims src ON src.id = d.dst_id AND src.org_id = d.org_id
                              WHERE d.org_id = p_org AND d.src_kind = 'claim' AND d.src_id = c.id AND d.relation = 'derived_from'
                                AND d.dst_kind = 'claim' AND d.status = 'active'
                                AND src.scope_kind = 'chat_session' AND src.scope_id = p_thread))))
$$;

-- 这条消息刚抽出的新条：本会话、模型提出、还没人看过、由这条消息支撑。
CREATE OR REPLACE FUNCTION kg_conflict_newer_ok(p_org text, p_thread text, p_message text, p_claim text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.claims c
     WHERE c.org_id = p_org AND c.id = p_claim AND c.scope_kind = 'chat_session' AND c.scope_id = p_thread
       AND c.created_by = 'model' AND c.status = 'proposed' AND c.revoked_at IS NULL
       AND EXISTS (SELECT 1 FROM public.claim_message_evidence e
                    WHERE e.claim_id = c.id AND e.org_id = p_org AND e.message_id = p_message AND e.stance = 'supporting'))
$$;

-- 会话所有者（只回 id）：判矛盾的系统任务据此以所有者身份声明 app.current_user_id，才读得到所有者的个人空间。
CREATE OR REPLACE FUNCTION kg_thread_owner(p_thread text) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp
AS $$ SELECT t.created_by FROM public.chat_threads t WHERE t.id = p_thread AND t.org_id = current_setting('app.current_org', true) $$;

-- 会话知识的 revision（与 F10 kg_apply_human_action 同一口径：本会话作用域 accepted 动作数）。
-- 以调用方身份执行（RLS 照常）：一个动作可能连带触发别的动作（结束冲突），返回给客户端的号要重数。
CREATE OR REPLACE FUNCTION kg_thread_revision(p_thread text) RETURNS bigint
LANGUAGE sql STABLE SET search_path = pg_catalog, public, pg_temp
AS $$ SELECT count(*) FROM public.ontology_actions a
       WHERE a.org_id = current_setting('app.current_org', true) AND a.scope_kind = 'chat_session'
         AND a.scope_id = p_thread AND a.outcome = 'accepted' $$;

-- ─────────────────────────────── ① 候选 ───────────────────────────────
CREATE OR REPLACE FUNCTION kg_conflict_candidates(p_thread text, p_message text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_org   text := current_setting('app.current_org', true);
  v_src   record;
  v_owner text;
BEGIN
  IF v_org IS NULL OR v_org = '' THEN RAISE EXCEPTION 'KG_NO_TENANT' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v_src FROM kg_conflict_source(v_org, p_thread, p_message);
  IF NOT FOUND THEN RETURN jsonb_build_object('fresh', '[]'::jsonb, 'confirmed', '[]'::jsonb); END IF;
  v_owner := CASE WHEN v_src.with_personal THEN v_src.owner END;
  RETURN jsonb_build_object(
    'fresh', (SELECT coalesce(jsonb_agg(jsonb_build_object(
                'id', c.id, 'kind', coalesce(c.claim_kind, 'fact'), 'statement', c.statement,
                'confidence', coalesce(c.confidence, 0.5), 'about', kg_conflict_about(v_org, c.id)) ORDER BY c.id), '[]'::jsonb)
                FROM claims c
               WHERE c.org_id = v_org AND c.scope_kind = 'chat_session' AND c.scope_id = p_thread
                 AND kg_conflict_newer_ok(v_org, p_thread, p_message, c.id)),
    'confirmed', (SELECT coalesce(jsonb_agg(jsonb_build_object(
                'id', c.id, 'kind', coalesce(c.claim_kind, 'fact'), 'statement', c.statement,
                'scope', c.scope_kind, 'confirmedAt', c.updated_at, 'about', kg_conflict_about(v_org, c.id)) ORDER BY c.id), '[]'::jsonb)
                FROM claims c
               WHERE c.org_id = v_org
                 AND ((c.scope_kind = 'chat_session' AND c.scope_id = p_thread) OR (c.scope_kind = 'personal' AND c.scope_id = v_owner))
                 AND kg_conflict_older_ok(v_org, p_thread, v_owner, c.id)));
END
$$;

-- 一条结论涉及的实体名（活的 about 边）。
CREATE OR REPLACE FUNCTION kg_conflict_about(p_org text, p_claim text) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT coalesce(jsonb_agg(o.name ORDER BY o.name), '[]'::jsonb)
    FROM public.ontology_edges e JOIN public.ontology_objects o ON o.id = e.dst_id AND o.org_id = e.org_id
   WHERE e.org_id = p_org AND e.src_kind = 'claim' AND e.src_id = p_claim AND e.dst_kind = 'object'
     AND e.relation = 'about' AND e.status = 'active'
$$;

-- ─────────────────────────────── ③ 开卡 ───────────────────────────────
-- p = { action_id, thread_id, message_id, pairs: [{ newer, older }] }（pairs 按重要性排好）。
-- 复核不过的一对静默跳过（判定和落表之间状态可能变了：旧条刚被忘掉、新条刚被确认），返回开了几张。
CREATE OR REPLACE FUNCTION kg_open_conflicts(p jsonb) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_org     text := current_setting('app.current_org', true);
  v_thread  text := p->>'thread_id';
  v_message text := p->>'message_id';
  v_id      text := p->>'action_id';
  v_src     record;
  v_owner   text;
  v_pair    jsonb;
  v_newer   record;
  v_older   record;
  v_key     text;
  v_done    text[] := '{}';
  v_claims  text[] := '{}';
  v_personal text[] := '{}';
  n         int := 0;
BEGIN
  IF v_org IS NULL OR v_org = '' THEN RAISE EXCEPTION 'KG_NO_TENANT' USING ERRCODE = '42501'; END IF;
  IF NOT public.kernel_org_is_writable(v_org) THEN
    RAISE EXCEPTION 'KG_ORG_FROZEN: organization % is read-only', v_org USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_src FROM kg_conflict_source(v_org, v_thread, v_message);
  IF NOT FOUND THEN RETURN 0; END IF;
  v_owner := CASE WHEN v_src.with_personal THEN v_src.owner END;

  -- 与 F10 / F11 同一把会话锁：并发的确认 / 忘掉 / 晋升排在这次开卡之前或之后。
  PERFORM pg_advisory_xact_lock(hashtext('kg_scope:' || v_org || '|chat_session|' || v_thread));
  IF v_owner IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtext('kg_scope:' || v_org || '|personal|' || v_owner));
  END IF;

  FOR v_pair IN SELECT * FROM jsonb_array_elements(coalesce(p->'pairs', '[]'::jsonb)) LOOP
    -- 锁住两行再判：判完到写之间谁也改不了它们。
    CONTINUE WHEN v_pair->>'newer' IS NULL OR v_pair->>'older' IS NULL OR v_pair->>'newer' = v_pair->>'older';
    SELECT * INTO v_newer FROM claims WHERE org_id = v_org AND id = v_pair->>'newer' FOR UPDATE;
    CONTINUE WHEN NOT FOUND;
    SELECT * INTO v_older FROM claims WHERE org_id = v_org AND id = v_pair->>'older' FOR UPDATE;
    CONTINUE WHEN NOT FOUND;
    -- 新条：还没人看过；同一次判定里已经配过一对的（刚转 contested、上一轮已核过）也算——
    -- 一条新说法可以同时和两条旧的冲突。
    CONTINUE WHEN NOT (v_newer.id = ANY(v_done) OR kg_conflict_newer_ok(v_org, v_thread, v_message, v_newer.id));
    CONTINUE WHEN NOT kg_conflict_older_ok(v_org, v_thread, v_owner, v_older.id);
    v_key := kg_conflict_statement_key(v_newer.statement);
    -- I-19：同一旧条、同样说法的新条已经提醒过（还开着、被忽略、或两条都留了）⇒ 不再提醒
    CONTINUE WHEN EXISTS (SELECT 1 FROM kg_conflict_prompts x
                           WHERE x.org_id = v_org AND x.older_claim_id = v_older.id AND x.newer_key = v_key
                             AND x.status IN ('open', 'ignored', 'kept_both'));

    UPDATE claims SET status = 'contested', updated_at = now()
     WHERE org_id = v_org AND id IN (v_newer.id, v_older.id) AND status <> 'contested';
    -- uc-18-1 A3：「写一条 contradicting 证据」—— 旧条上记下「这条消息说的不一样」
    PERFORM kg_insert_claim_evidence(v_org, v_older.scope_kind, v_older.scope_id, v_older.id,
      jsonb_build_object('message_id', v_message, 'stance', 'contradicting', 'excerpt', ''));
    INSERT INTO kg_conflict_prompts (id, org_id, thread_id, message_id, newer_claim_id, older_claim_id, newer_key, rank, detected_by_action_id)
    VALUES (v_id || '-' || n, v_org, v_thread, v_message, v_newer.id, v_older.id, v_key, n, v_id);
    n := n + 1;
    v_done := v_done || v_newer.id;
    IF NOT v_newer.id = ANY(v_claims) THEN v_claims := v_claims || v_newer.id; END IF;
    IF v_older.scope_kind = 'personal' THEN
      IF NOT v_older.id = ANY(v_personal) THEN v_personal := v_personal || v_older.id; END IF;
    ELSIF NOT v_older.id = ANY(v_claims) THEN
      v_claims := v_claims || v_older.id;
    END IF;
  END LOOP;

  IF n = 0 THEN RETURN 0; END IF;
  -- 会话作用域留一条（revision 前进；来源抽屉的「谁 / 何时」按 payload.claims 查）。个人空间的旧条单独在
  -- 个人空间留一条：会话里的审计不带别人看不到的个人空间 id。
  INSERT INTO ontology_actions (id, org_id, scope_kind, scope_id, actor_kind, actor_id, action_type, payload, source_ref, outcome)
  VALUES (v_id, v_org, 'chat_session', v_thread, 'system', 'kg-conflict-detector', 'detectConflict',
          jsonb_build_object('message_id', v_message, 'prompts', n,
                             'claims', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', x)), '[]'::jsonb) FROM unnest(v_claims) x)),
          v_message, 'accepted');
  IF cardinality(v_personal) > 0 THEN
    INSERT INTO ontology_actions (id, org_id, scope_kind, scope_id, actor_kind, actor_id, action_type, payload, source_ref, outcome)
    VALUES (v_id || '-l1', v_org, 'personal', v_owner, 'system', 'kg-conflict-detector', 'detectConflict',
            jsonb_build_object('thread_id', v_thread,
                               'claims', (SELECT jsonb_agg(jsonb_build_object('id', x)) FROM unnest(v_personal) x)),
            v_message, 'accepted');
  END IF;
  RETURN n;
END
$$;

-- ─────────────────────────────── 出口：人的三种选择 ───────────────────────────────
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
         newer_condition = CASE WHEN v_res = 'keep_both' THEN nullif(btrim(v_action->'conditions'->>'newer'), '') END,
         older_condition = CASE WHEN v_res = 'keep_both' THEN nullif(btrim(v_action->'conditions'->>'older'), '') END
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
      v_l1 := kg_promote_claim(jsonb_build_object('action_id', v_id || '-p', 'thread_id', v_thread, 'claim_id', v_newer.id));
      IF v_older.scope_kind = 'personal' THEN
        UPDATE claims SET supersedes_claim_id = v_older.id WHERE org_id = v_org AND id = v_l1 AND id <> v_older.id;
      END IF;
    END IF;

  ELSIF v_res = 'keep_both' THEN
    UPDATE claims SET status = 'accepted', reviewed_by = v_user, updated_at = now()
     WHERE org_id = v_org AND id IN (v_newer.id, v_older.id);
  END IF;
  -- ignore：两条保持冲突；这一对不再提醒（开卡时按 status = ignored 挡住）

  v_claims := CASE WHEN v_older.scope_kind = 'chat_session'
                   THEN jsonb_build_array(jsonb_build_object('id', v_newer.id), jsonb_build_object('id', v_older.id))
                   ELSE jsonb_build_array(jsonb_build_object('id', v_newer.id)) END;
  INSERT INTO ontology_actions (id, org_id, scope_kind, scope_id, actor_kind, actor_id, action_type, payload, outcome)
  VALUES (v_id, v_org, 'chat_session', v_thread, 'human', v_user, 'resolveConflict',
          jsonb_build_object('action', v_action, 'claims', v_claims, 'objects', '[]'::jsonb), 'accepted');
  IF v_older.scope_kind = 'personal' AND v_res <> 'ignore' THEN
    INSERT INTO ontology_actions (id, org_id, scope_kind, scope_id, actor_kind, actor_id, action_type, payload, outcome)
    VALUES (v_id || '-l1', v_org, 'personal', v_user, 'human', v_user, 'resolveConflict',
            jsonb_build_object('thread_id', v_thread, 'resolution', v_res, 'claims', jsonb_build_array(jsonb_build_object('id', v_older.id))),
            'accepted');
  END IF;
  -- 重数一遍而不是 v_rev + 1：取代旧条可能顺带结束了同一旧条上别的卡（kg_conflict_close_on_change 各记一条）。
  RETURN jsonb_build_object('revision', kg_thread_revision(v_thread), 'action_id', v_id);
END
$$;

-- ─────────────────────────────── 一对里有一条在别处变了 ⇒ 冲突结束 ───────────────────────────────
-- 触发器拿不到锁时的待办：只放卡 id。这张表上的任何东西都不能让触发器的 INSERT 等：
--   - 不设唯一约束——唯一约束下两个事务同时放同一张卡，后一个会等前一个提交。重复的行无害：排空按卡处理，
--     处理过的卡再处理是空操作。
--   - **不设外键**——外键检查会对被引用行加 KEY SHARE：指向 kg_conflict_prompts 时，恰好在排空 / 处理那张卡的
--     事务（持有那一行的 FOR UPDATE）面前等住，D2 就又回来了；指向 organizations 时，删 org 的事务持有 org 行、
--     再去删本 org 的结论（等我们），也是一个环。卡没了 ⇒ 排空时锁 key 为 NULL，直接删掉队列行；org 没了 ⇒
--     它的队列行排空时同样找不到卡、删掉。
--   - attempts / not_before / last_error：排空失败（例如等锁超时）的那一行往后推，不挡住同一 org 后面的行（见排空）。
CREATE TABLE IF NOT EXISTS kg_conflict_close_queue (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  org_id      text NOT NULL,
  prompt_id   text NOT NULL,
  attempts    integer NOT NULL DEFAULT 0,
  not_before  timestamptz NOT NULL DEFAULT now(),
  last_error  text,
  enqueued_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS kg_conflict_close_queue_org_idx ON kg_conflict_close_queue (org_id, not_before, id);
ALTER TABLE kg_conflict_close_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE kg_conflict_close_queue FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS kg_conflict_close_queue_tenant ON kg_conflict_close_queue;
CREATE POLICY kg_conflict_close_queue_tenant ON kg_conflict_close_queue
  USING (org_id = current_setting('app.current_org', true) OR (SELECT public.kg_is_table_owner()))
  WITH CHECK (org_id = current_setting('app.current_org', true) OR (SELECT public.kg_is_table_owner()));
-- 写入与删除只经下面的 SECURITY DEFINER 函数；app_rw 只能看（排障）。
REVOKE ALL ON kg_conflict_close_queue FROM app_rw;
GRANT SELECT ON kg_conflict_close_queue TO app_rw;

-- 在调用方已经拿好锁（会话锁、需要时的个人空间锁、卡这一行、另一条这一行）之后结束一张卡：
-- 记 closed_by_change；另一条若是 contested、且没有别的未了结的卡（另一端还活着）让它继续冲突，就放回
-- accepted（有人确认过）/ proposed；记审计。本函数自己不拿任何锁（UPDATE 的都是调用方已锁住的行）。
-- 审计：会话作用域一条 closeConflict（只带会话里的 id），个人空间的结论在它自己的作用域另记一条。
-- 没有租户上下文（app.current_org 不是这个 org）时不写审计、revision 也就不动：那种调用来自系统级清理，
-- 没有哪个客户端拿着这次的 revision；卡与结论的状态照样改（属主例外让这里看得到卡），面板下次读到的就是新状态。
CREATE OR REPLACE FUNCTION kg_conflict_close_locked(p_prompt_id text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_p       record;
  v_newer   record;
  v_older   record;
  v_dead    record;
  v_partner record;
  v_audit   boolean;
BEGIN
  SELECT * INTO v_p FROM public.kg_conflict_prompts p WHERE p.id = p_prompt_id AND p.status IN ('open', 'ignored');
  IF NOT FOUND THEN RETURN false; END IF;
  SELECT * INTO v_newer FROM public.claims c WHERE c.org_id = v_p.org_id AND c.id = v_p.newer_claim_id;
  SELECT * INTO v_older FROM public.claims c WHERE c.org_id = v_p.org_id AND c.id = v_p.older_claim_id;
  -- 哪一条变了：失效的那条；两条都还活着 ⇒ 这张卡没什么可结束的
  IF v_newer.revoked_at IS NOT NULL OR v_newer.status = 'superseded' THEN
    v_dead := v_newer; v_partner := v_older;
  ELSIF v_older.revoked_at IS NOT NULL OR v_older.status = 'superseded' THEN
    v_dead := v_older; v_partner := v_newer;
  ELSE
    RETURN false;
  END IF;
  v_audit := current_setting('app.current_org', true) IS NOT DISTINCT FROM v_p.org_id;

  UPDATE public.kg_conflict_prompts SET status = 'closed_by_change', resolved_at = now(), resolved_by = NULL WHERE id = v_p.id;
  UPDATE public.claims c
     SET status = CASE WHEN c.reviewed_by IS NOT NULL THEN 'accepted' ELSE 'proposed' END, updated_at = now()
   WHERE c.org_id = v_p.org_id AND c.id = v_partner.id AND c.status = 'contested' AND c.revoked_at IS NULL
     AND NOT EXISTS (
       SELECT 1 FROM public.kg_conflict_prompts x
         JOIN public.claims o ON o.org_id = x.org_id
                             AND o.id = CASE WHEN x.newer_claim_id = v_partner.id THEN x.older_claim_id ELSE x.newer_claim_id END
        WHERE x.org_id = v_p.org_id AND x.status IN ('open', 'ignored')
          AND (x.newer_claim_id = v_partner.id OR x.older_claim_id = v_partner.id)
          AND o.revoked_at IS NULL AND o.status <> 'superseded');

  IF v_audit THEN
    INSERT INTO public.ontology_actions (id, org_id, scope_kind, scope_id, actor_kind, actor_id, action_type, payload, outcome)
    VALUES ('kgclose-' || v_p.id, v_p.org_id, 'chat_session', v_p.thread_id, 'system', 'kg-conflict-detector', 'closeConflict',
            jsonb_build_object('prompt_id', v_p.id, 'reason', 'claim_changed',
              'claims', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', x.id)), '[]'::jsonb)
                           FROM (VALUES (v_dead.id, v_dead.scope_kind), (v_partner.id, v_partner.scope_kind)) x (id, scope_kind)
                          WHERE x.scope_kind = 'chat_session')), 'accepted')
    ON CONFLICT (id) DO NOTHING;
    IF v_dead.scope_kind = 'personal' OR v_partner.scope_kind = 'personal' THEN
      INSERT INTO public.ontology_actions (id, org_id, scope_kind, scope_id, actor_kind, actor_id, action_type, payload, outcome)
      VALUES ('kgclose-' || v_p.id || '-l1', v_p.org_id, 'personal',
              CASE WHEN v_dead.scope_kind = 'personal' THEN v_dead.scope_id ELSE v_partner.scope_id END,
              'system', 'kg-conflict-detector', 'closeConflict',
              jsonb_build_object('thread_id', v_p.thread_id, 'reason', 'claim_changed',
                'claims', (SELECT jsonb_agg(jsonb_build_object('id', x.id))
                             FROM (VALUES (v_dead.id, v_dead.scope_kind), (v_partner.id, v_partner.scope_kind)) x (id, scope_kind)
                            WHERE x.scope_kind = 'personal')), 'accepted')
      ON CONFLICT (id) DO NOTHING;
    END IF;
  END IF;
  RETURN true;
END
$$;

-- 这张卡所在会话的锁 key、以及需要的个人空间 key（两条里在个人空间的那条的主人；没有就 NULL）。
CREATE OR REPLACE FUNCTION kg_conflict_prompt_lock_keys(p_prompt_id text, OUT thread_key bigint, OUT personal_key bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT hashtext('kg_scope:' || p.org_id || '|chat_session|' || p.thread_id)::bigint,
         (SELECT hashtext('kg_scope:' || p.org_id || '|personal|' || c.scope_id)::bigint FROM public.claims c
           WHERE c.org_id = p.org_id AND c.id IN (p.newer_claim_id, p.older_claim_id) AND c.scope_kind = 'personal' LIMIT 1)
    FROM public.kg_conflict_prompts p WHERE p.id = p_prompt_id
$$;

-- 结论变成失效（revoked_at）或被取代（superseded）时：它所在的、还开着 / 被忽略的卡逐张「试着」当场结束。
-- **从不等**：会话锁、个人空间锁用 try；卡这一行、另一条这一行用 NOWAIT。有一样拿不到 ⇒ 放进队列，交给 worker。
CREATE OR REPLACE FUNCTION kg_conflict_close_on_change() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_p    record;
  v_keys record;
  v_done boolean;
BEGIN
  IF NOT (NEW.revoked_at IS NOT NULL OR NEW.status = 'superseded') OR OLD.revoked_at IS NOT NULL OR OLD.status = 'superseded' THEN
    RETURN NULL;
  END IF;
  FOR v_p IN SELECT p.id, p.newer_claim_id, p.older_claim_id FROM public.kg_conflict_prompts p
              WHERE p.org_id = NEW.org_id AND p.status IN ('open', 'ignored')
                AND (p.newer_claim_id = NEW.id OR p.older_claim_id = NEW.id)
              ORDER BY p.id
  LOOP
    v_done := false;
    SELECT * INTO v_keys FROM kg_conflict_prompt_lock_keys(v_p.id);
    IF pg_try_advisory_xact_lock(v_keys.thread_key)
       AND (v_keys.personal_key IS NULL OR pg_try_advisory_xact_lock(v_keys.personal_key)) THEN
      BEGIN
        PERFORM 1 FROM public.kg_conflict_prompts p WHERE p.id = v_p.id FOR UPDATE NOWAIT;
        PERFORM 1 FROM public.claims c WHERE c.org_id = NEW.org_id AND c.id IN (v_p.newer_claim_id, v_p.older_claim_id)
         ORDER BY c.id FOR UPDATE NOWAIT;
        PERFORM kg_conflict_close_locked(v_p.id);
        v_done := true;
      EXCEPTION WHEN lock_not_available THEN
        v_done := false;
      END;
    END IF;
    IF NOT v_done THEN
      INSERT INTO public.kg_conflict_close_queue (org_id, prompt_id) VALUES (NEW.org_id, v_p.id);
    END IF;
  END LOOP;
  RETURN NULL;
END
$$;

DROP TRIGGER IF EXISTS kg_conflict_close_on_change_trg ON claims;
CREATE TRIGGER kg_conflict_close_on_change_trg AFTER UPDATE OF status, revoked_at ON claims
  FOR EACH ROW EXECUTE FUNCTION kg_conflict_close_on_change();

-- 排空一张：本 org 队列里到期（not_before 已过）的最早那一行。按正常顺序**等**锁（会话锁 → 个人空间锁 → 卡 →
-- 两条结论），再判再结束。一次只处理一张、调用方一张一个事务：同一事务里连拿两个会话的锁，两个排空并发时就会互相等。
-- 等锁有上限（lock_timeout 1 秒，只在这一步里）：别的事务长时间占着那张卡，这一行记一次失败、往后推
-- （30 秒 × 4^(次数-1)，最长一天），接着处理后面的行——失败的一行不会把整个 org 的队列堵死。
-- 不丢弃：失败满 5 次仍按一天一次重试，并 RAISE WARNING 留日志；丢掉就等于让另一条永远卡在冲突里。
-- 返回 true = 处理了一行（成功或记了失败），false = 没有到期的行。
CREATE OR REPLACE FUNCTION kg_conflict_close_drain() RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_org  text := current_setting('app.current_org', true);
  v_q    record;
  v_keys record;
  v_p    record;
  v_err  text;
  v_lt   text := current_setting('lock_timeout');
BEGIN
  IF v_org IS NULL OR v_org = '' THEN RAISE EXCEPTION 'KG_NO_TENANT' USING ERRCODE = '42501'; END IF;
  SELECT q.id, q.prompt_id, q.attempts INTO v_q FROM public.kg_conflict_close_queue q
   WHERE q.org_id = v_org AND q.not_before <= now() ORDER BY q.id LIMIT 1;
  IF NOT FOUND THEN RETURN false; END IF;
  BEGIN
    PERFORM set_config('lock_timeout', '1s', true);
    SELECT * INTO v_keys FROM kg_conflict_prompt_lock_keys(v_q.prompt_id);
    IF v_keys.thread_key IS NOT NULL THEN
      PERFORM pg_advisory_xact_lock(v_keys.thread_key);
      IF v_keys.personal_key IS NOT NULL THEN PERFORM pg_advisory_xact_lock(v_keys.personal_key); END IF;
      SELECT p.newer_claim_id, p.older_claim_id INTO v_p FROM public.kg_conflict_prompts p WHERE p.id = v_q.prompt_id FOR UPDATE;
      PERFORM 1 FROM public.claims c WHERE c.org_id = v_org AND c.id IN (v_p.newer_claim_id, v_p.older_claim_id) ORDER BY c.id FOR UPDATE;
      PERFORM kg_conflict_close_locked(v_q.prompt_id);
    END IF;
    DELETE FROM public.kg_conflict_close_queue q WHERE q.org_id = v_org AND q.prompt_id = v_q.prompt_id;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
    UPDATE public.kg_conflict_close_queue
       SET attempts = attempts + 1, last_error = left(v_err, 500),
           not_before = now() + make_interval(secs => least(30 * power(4, least(v_q.attempts, 10)), 86400))
     WHERE id = v_q.id;
    IF v_q.attempts + 1 >= 5 THEN
      RAISE WARNING 'kg conflict close for prompt % keeps failing (% attempts): %', v_q.prompt_id, v_q.attempts + 1, v_err;
    END IF;
  END;
  PERFORM set_config('lock_timeout', v_lt, true);
  RETURN true;
END
$$;

-- 队列里有到期活的 org（只回 id）：worker 按 org 进租户上下文排空。
CREATE OR REPLACE FUNCTION kg_conflict_close_pending_orgs() RETURNS SETOF text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp
AS $$ SELECT DISTINCT org_id FROM public.kg_conflict_close_queue WHERE not_before <= now() $$;

REVOKE ALL ON FUNCTION kg_conflict_close_locked(text), kg_conflict_prompt_lock_keys(text), kg_conflict_close_drain(),
  kg_conflict_close_pending_orgs() FROM PUBLIC;
REVOKE ALL ON FUNCTION kg_conflict_close_on_change(), kg_thread_owner(text), kg_thread_revision(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION kg_conflict_statement_key(text), kg_conflict_source(text, text, text),
  kg_conflict_older_ok(text, text, text, text), kg_conflict_newer_ok(text, text, text, text),
  kg_conflict_candidates(text, text), kg_conflict_about(text, text), kg_open_conflicts(jsonb), kg_resolve_conflict(jsonb) FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_rw') THEN
    GRANT EXECUTE ON FUNCTION kg_conflict_candidates(text, text), kg_open_conflicts(jsonb), kg_resolve_conflict(jsonb),
      kg_thread_owner(text), kg_thread_revision(text), kg_conflict_close_drain(), kg_conflict_close_pending_orgs() TO app_rw;
  END IF;
END
$$;

-- 停用组织的冻结策略（F22 单一事实源，新租户表建完调用一次）
SELECT kernel_apply_org_freeze_policies();

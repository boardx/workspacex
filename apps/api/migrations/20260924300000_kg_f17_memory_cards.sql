/*
 * Phase 18 F17 —— 对话里「记住 / 忘掉」确认卡（uc-18-6 A / B，06-UX U-4，契约 KgMemoryCard、actOnMemoryCard）。
 *
 * 两个入口，一个人、一个系统：
 *   ① `kg_open_memory_card(jsonb)`：执行器在这一轮开始时（召回旁边）识别到明确的「记住：…」「忘掉 …」，
 *      只**开一张 open 的卡**（I-17：Agent 只能创建 open 状态的卡片），不改任何一条记忆。数据库这一侧复核：
 *        - 这条消息是会话所有者本人在本会话里说的（E1：不是所有者 ⇒ 不出卡）；
 *        - 记住卡只在所有者的个人线程（长期记忆 = 个人空间，与 F11 晋升同一条边界；项目会话 ⇒ 不出卡）；
 *        - 忘掉卡的每一条都是本会话的活结论，或（只在个人线程里）所有者本人个人空间的活结论——
 *          与 F08/F12 召回的候选范围一致：卡上列的就是「下一轮会被召回的」那些。每条记下当时的说法（basis），
 *          点击时对不上 ⇒ KG_CARD_STALE（E2）。
 *   ② `kg_act_on_memory_card(jsonb)`：人的动作（I-15 / I-17），执行身份 = 登录用户，actor_kind 必须是 human。
 *        - remember：以本人身份新建一条 human / accepted 结论（证据 = 那句「记住：…」），再经 F11 的
 *          `kg_promote_claim` 记到个人空间（同一个动作，uc-18-6 A2）；长期记忆里已有同一句 ⇒ 合并，不复制第二份。
 *        - forget：选中的条目逐条失效（revocation_reason = user_forgot），F07 的级联把边和 L1 副本一起收掉。
 *        - dismiss：卡片关闭，不写本体。
 *      锁顺序同 F10 / F11 / F16：先会话、后个人空间；卡片行与要改的结论行 FOR UPDATE。
 *
 * 一轮至多一张主动卡、冲突卡优先（I-18）在读侧（pg-knowledge-read.ts getTurnMemory）判：同一轮既有开着的
 * 矛盾提醒又有这张卡时，先出矛盾卡；矛盾处理完，这张卡在同一轮回答下出现——用户明确说的「记住 / 忘掉」不丢。
 */

CREATE TABLE IF NOT EXISTS kg_memory_cards (
  id           text PRIMARY KEY,
  org_id       text NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  thread_id    text NOT NULL,
  -- 这一轮的 agent run：回答落库后 chat_messages.agent_run_id 指向它，getTurnMemory 经它找到这张卡。
  run_id       text NOT NULL,
  -- 用户说「记住 / 忘掉」的那条消息：记住卡新建结论的证据就是它。消息删了，卡跟着没。
  message_id   text NOT NULL REFERENCES chat_messages (id) ON DELETE CASCADE,
  kind         text NOT NULL CHECK (kind IN ('remember', 'forget')),
  -- [{ claimId: text|null, statement, scope: chat_session|personal, basis: 出卡时的说法（归一）|null }]
  items        jsonb NOT NULL CHECK (jsonb_typeof(items) = 'array' AND jsonb_array_length(items) BETWEEN 1 AND 20),
  -- 卡上有所有者个人空间的条目：只有所有者本人读得到这张卡（I-14）。
  has_personal boolean NOT NULL DEFAULT false,
  status       text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'done', 'dismissed')),
  created_by   text NOT NULL,
  acted_by     text,
  acted_at     timestamptz,
  action_ids   jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(action_ids) = 'array'),
  created_at   timestamptz NOT NULL DEFAULT now(),
  CHECK ((status = 'open') = (acted_at IS NULL)),
  CHECK ((status = 'open') = (acted_by IS NULL)),
  UNIQUE (org_id, run_id)
);
CREATE INDEX IF NOT EXISTS kg_memory_cards_thread_idx ON kg_memory_cards (org_id, thread_id);

ALTER TABLE kg_memory_cards ENABLE ROW LEVEL SECURITY;
ALTER TABLE kg_memory_cards FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS kg_memory_cards_tenant ON kg_memory_cards;
CREATE POLICY kg_memory_cards_tenant ON kg_memory_cards
  USING (org_id = current_setting('app.current_org', true))
  WITH CHECK (org_id = current_setting('app.current_org', true));
DROP POLICY IF EXISTS kg_memory_cards_personal_owner ON kg_memory_cards;
CREATE POLICY kg_memory_cards_personal_owner ON kg_memory_cards AS RESTRICTIVE
  USING (NOT has_personal OR created_by = current_setting('app.current_user_id', true) OR (SELECT public.kg_is_table_owner()));
-- 只读：开卡与处理都经下面的 SECURITY DEFINER 函数。
REVOKE ALL ON kg_memory_cards FROM app_rw;
GRANT SELECT ON kg_memory_cards TO app_rw;

-- 条目「当时的样子」：出卡那一刻的说法（归一文本，同 kg_conflict_statement_key）。点击时这一条已经不在
-- （被改写 / 忘掉 / 取代）或说法变了 ⇒ KG_CARD_STALE（E2）。只看说法、不看状态：出卡之后这一条被确认、
-- 被标矛盾，卡上列的还是用户看到的那句话，点「忘掉 / 记住」照样成立（矛盾态的记住由晋升拒绝）。
CREATE OR REPLACE FUNCTION kg_claim_basis(p_statement text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, public, pg_temp
AS $$ SELECT lower(regexp_replace(normalize(p_statement, NFKC), '\s+', '', 'g')) $$;

-- 路由事实：这张卡属于哪个会话（不回内容）。调用方先按会话可见性判定，再决定能不能动它。
CREATE OR REPLACE FUNCTION kg_memory_card_thread(p_card text) RETURNS text
LANGUAGE sql STABLE SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT k.thread_id FROM public.kg_memory_cards k
   WHERE k.org_id = current_setting('app.current_org', true) AND k.id = p_card
$$;

-- ─────────────────────────────── ① 开卡（系统） ───────────────────────────────
-- p = { card_id, thread_id, run_id, message_id, requester, kind, statement?（remember）, claim_ids?（forget，按相关度排好） }
-- 返回 { outcome: opened | not_owner | not_personal | no_items, card_id? }；不开卡的情况不报错（对话照常）。
CREATE OR REPLACE FUNCTION kg_open_memory_card(p jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_org     text := current_setting('app.current_org', true);
  v_thread  text := p->>'thread_id';
  v_message text := p->>'message_id';
  v_user    text := p->>'requester';
  v_kind    text := p->>'kind';
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

  -- E1：只有会话所有者本人说的话才出卡。
  SELECT t.project_id, t.created_by INTO v_t FROM chat_threads t WHERE t.org_id = v_org AND t.id = v_thread;
  IF NOT FOUND OR v_user IS NULL OR v_t.created_by IS DISTINCT FROM v_user
     OR NOT EXISTS (SELECT 1 FROM chat_messages m
                     WHERE m.org_id = v_org AND m.id = v_message AND m.thread_id = v_thread
                       AND m.author_kind = 'human' AND m.author_id = v_user
                       AND m.visibility_scope IS NULL AND m.raw_transcript = false) THEN
    RETURN jsonb_build_object('outcome', 'not_owner');
  END IF;

  -- 同一个 run 重试：沿用第一次开的那张。
  SELECT k.id INTO v_card FROM kg_memory_cards k WHERE k.org_id = v_org AND k.run_id = p->>'run_id';
  IF v_card IS NOT NULL THEN RETURN jsonb_build_object('outcome', 'opened', 'card_id', v_card); END IF;

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

  INSERT INTO kg_memory_cards (id, org_id, thread_id, run_id, message_id, kind, items, has_personal, created_by)
  VALUES (p->>'card_id', v_org, v_thread, p->>'run_id', v_message, v_kind, v_items,
          EXISTS (SELECT 1 FROM jsonb_array_elements(v_items) i WHERE i->>'scope' = 'personal'), v_user)
  ON CONFLICT (org_id, run_id) DO NOTHING;
  SELECT k.id INTO v_card FROM kg_memory_cards k WHERE k.org_id = v_org AND k.run_id = p->>'run_id';
  RETURN jsonb_build_object('outcome', 'opened', 'card_id', v_card);
END
$$;

-- 卡片的契约形状（KgMemoryCard）：卡片本身的状态，不做读侧的「过期」判定（那在 getTurnMemory）。
CREATE OR REPLACE FUNCTION kg_memory_card_json(p_id text, p_status text, p_kind text, p_items jsonb) RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT jsonb_build_object('cardId', p_id, 'kind', p_kind, 'state', p_status,
    'items', (SELECT coalesce(jsonb_agg(jsonb_build_object('claimId', i->'claimId', 'statement', i->>'statement') ORDER BY n), '[]'::jsonb)
                FROM jsonb_array_elements(p_items) WITH ORDINALITY AS a(i, n)))
$$;

-- ─────────────────────────────── ② 人的决定 ───────────────────────────────
-- p = { action_id, card_id, decision: accept|dismiss, actor_kind, claim_ids?（forget 选中的）, edited_statement?（remember 改过的字） }
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
  v_sel     text[];
  v_keep    jsonb := '[]'::jsonb;
  v_l0      text[] := '{}';
  v_l1      text[] := '{}';
  v_actions text[] := '{}';
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

  SELECT k.thread_id INTO v_thread FROM kg_memory_cards k WHERE k.org_id = v_org AND k.id = p->>'card_id';
  IF v_thread IS NULL THEN RAISE EXCEPTION 'KG_CARD_NOT_FOUND' USING ERRCODE = '23503'; END IF;
  SELECT t.project_id INTO v_project FROM chat_threads t WHERE t.org_id = v_org AND t.id = v_thread AND t.created_by = v_user;
  IF NOT FOUND THEN RAISE EXCEPTION 'KG_NOT_OWNER: only the thread owner manages its memory' USING ERRCODE = '42501'; END IF;

  -- 锁顺序同 F10 / F11 / F16：先会话、后个人空间。
  PERFORM pg_advisory_xact_lock(hashtext('kg_scope:' || v_org || '|chat_session|' || v_thread));
  PERFORM pg_advisory_xact_lock(hashtext('kg_scope:' || v_org || '|personal|' || v_user));
  SELECT * INTO v_card FROM kg_memory_cards k WHERE k.org_id = v_org AND k.id = p->>'card_id' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'KG_CARD_NOT_FOUND' USING ERRCODE = '23503'; END IF;
  IF v_card.created_by IS DISTINCT FROM v_user THEN
    RAISE EXCEPTION 'KG_NOT_OWNER: only the person who asked manages this card' USING ERRCODE = '42501';
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
    PERFORM kg_promote_claim(jsonb_build_object('action_id', v_id || '-p', 'thread_id', v_thread, 'claim_id', v_claim,
                                                'mode', CASE WHEN v_target IS NULL THEN 'new' ELSE 'merge' END,
                                                'target_claim_id', v_target));
    v_actions := v_actions || (v_id || '-p');
    v_keep := jsonb_build_array(jsonb_build_object('claimId', v_claim, 'statement', v_stmt, 'scope', 'chat_session', 'basis', NULL));

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
    -- 边核边改就会把它误判成「期间被改过」。
    FOR v_item IN SELECT i FROM jsonb_array_elements(v_card.items) i WHERE i->>'claimId' = ANY(v_sel) ORDER BY i->>'claimId' LOOP
      SELECT * INTO v_c FROM claims c WHERE c.org_id = v_org AND c.id = v_item->>'claimId' FOR UPDATE;
      IF NOT FOUND OR v_c.revoked_at IS NOT NULL OR v_c.status = 'superseded'
         OR NOT ((v_item->>'scope' = 'chat_session' AND v_c.scope_kind = 'chat_session' AND v_c.scope_id = v_thread)
              OR (v_item->>'scope' = 'personal' AND v_c.scope_kind = 'personal' AND v_c.scope_id = v_user AND v_project IS NULL))
         OR kg_claim_basis(v_c.statement) IS DISTINCT FROM v_item->>'basis' THEN
        RAISE EXCEPTION 'KG_CARD_STALE: % changed since the card was made', v_item->>'claimId' USING ERRCODE = '40001';
      END IF;
      IF v_c.scope_kind = 'personal' THEN v_l1 := v_l1 || v_c.id; ELSE v_l0 := v_l0 || v_c.id; END IF;
    END LOOP;
    UPDATE claims SET status = 'superseded', revoked_at = now(), revocation_reason = 'user_forgot', updated_at = now()
     WHERE org_id = v_org AND id = ANY(v_l0 || v_l1) AND revoked_at IS NULL;
    IF cardinality(v_l0) > 0 THEN
      INSERT INTO ontology_actions (id, org_id, scope_kind, scope_id, actor_kind, actor_id, action_type, payload, source_ref, outcome)
      VALUES (v_id, v_org, 'chat_session', v_thread, 'human', v_user, 'revokeClaim',
              jsonb_build_object('action', jsonb_build_object('type', 'revokeClaim', 'reason', 'user_forgot'), 'via', 'memoryCard',
                                 'card_id', v_card.id, 'objects', '[]'::jsonb,
                                 'claims', (SELECT jsonb_agg(jsonb_build_object('id', x)) FROM unnest(v_l0) x)),
              v_card.id, 'accepted');
      v_actions := v_actions || v_id;
    END IF;
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
  END IF;

  UPDATE kg_memory_cards
     SET status = 'done', acted_by = v_user, acted_at = now(), items = v_keep,
         has_personal = EXISTS (SELECT 1 FROM jsonb_array_elements(v_keep) i WHERE i->>'scope' = 'personal'),
         action_ids = to_jsonb(v_actions)
   WHERE id = v_card.id;
  RETURN jsonb_build_object('card', kg_memory_card_json(v_card.id, 'done', v_card.kind, v_keep), 'action_ids', to_jsonb(v_actions));
END
$$;

REVOKE ALL ON FUNCTION kg_claim_basis(text), kg_memory_card_thread(text), kg_open_memory_card(jsonb), kg_memory_card_json(text, text, text, jsonb),
  kg_act_on_memory_card(jsonb) FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_rw') THEN
    GRANT EXECUTE ON FUNCTION kg_claim_basis(text), kg_memory_card_thread(text), kg_open_memory_card(jsonb), kg_act_on_memory_card(jsonb) TO app_rw;
  END IF;
END
$$;

-- 停用组织的冻结策略（F22 单一事实源，新租户表建完调用一次）
SELECT kernel_apply_org_freeze_policies();

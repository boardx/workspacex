/*
 * Issue #4363（第二批 S6，epic #4359）—— 记忆的时间维度：有效期、待办状态、链式取代历史；顺带修 #4307。
 *
 * 北极星：用户在新会话里不用重复自己说过的背景——也不该被**过时的**背景打扰（「这周我在上海」到了下周还被当真），
 * 做完了的待办不该再被当成没做。
 *
 * ① 有效期：`claims.valid_from` / `claims.valid_to` 两列 F02（20260924180000）就有了（含 claims_validity_chk），一直没人写。
 *    **不另起 valid_until 列**（同一事实不得声明在两处）：契约与应用层叫 `validUntil`，落在 `valid_to`，左闭右开。
 *    抽取批次（kg_apply_batch）从这一版起接受每条结论的 `valid_from` / `valid_until` / `due_at`（本迁移重建该函数，其余逐字不变）。
 *    「过期了没有」只在应用层一处判（domain/knowledge-graph/claim-time.ts claimExpired）：召回排除、面板 / 大脑页标「已过期」。
 *    个人空间的副本（#4283 自动记入、F11 晋升、R7 记到项目）继承来源的有效期与截止：见 ④。
 * ② 待办状态：`claims.todo_status`（open / done / dropped，只有待办有）+ `claims.due_at`（可空）。
 *    新写入的待办由触发器补 open；存量待办本迁移回填 open。改状态只经 `kg_set_todo_status`（人的动作，只有所有者：
 *    会话里的 = 会话创建者，个人空间的 = 空间主人）；同一件待办在会话与个人空间各有一份（derived_from 活边相连）时一起改。
 * ③ #4307：`kg_apply_supersedes` 收「随旧决定一起转 superseded 的个人副本」时只沿**活的** derived_from 边
 *    （与 F07 20260927100000「只数活来源」同一条规则：被 #4283 撤销摘掉的来源不再支撑副本，也就不该拖着副本一起被取代）。
 *    本迁移重建该函数，只改那一处。撤销（kg_undo_supersede）按快照 restore.claims 恢复——不在集合里的副本不进快照、
 *    撤销也不碰它，恢复路径天然对称，不用改。
 * ④ 副本继承：一条 derived_from 边（副本 → 来源）写进来、而这是副本的**第一个**来源时，副本照抄来源的有效期、截止与待办状态。
 *    合并进已有副本（第二个来源）不改副本——已经长期有效的记忆不因为又说了一次「这周」而变成会过期。
 */

-- ─────────────────────────────── ② 待办状态 ───────────────────────────────
ALTER TABLE claims ADD COLUMN IF NOT EXISTS todo_status text;
ALTER TABLE claims ADD COLUMN IF NOT EXISTS due_at      timestamptz;
ALTER TABLE claims DROP CONSTRAINT IF EXISTS claims_todo_status_chk;
ALTER TABLE claims ADD CONSTRAINT claims_todo_status_chk
  CHECK (todo_status IS NULL OR (claim_kind = 'todo' AND todo_status IN ('open', 'done', 'dropped')));

-- 新写入的待办补 open；改成别的类别的清掉（CHECK 只允许待办有状态）。
CREATE OR REPLACE FUNCTION kg_todo_status_default() RETURNS trigger
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF NEW.claim_kind = 'todo' THEN
    NEW.todo_status := coalesce(NEW.todo_status, 'open');
  ELSE
    NEW.todo_status := NULL;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS kg_todo_status_default_trg ON claims;
CREATE TRIGGER kg_todo_status_default_trg BEFORE INSERT OR UPDATE OF claim_kind, todo_status ON claims
  FOR EACH ROW EXECUTE FUNCTION kg_todo_status_default();

-- 回填：存量待办一律 open（迁移以属主身份运行，写守卫放行）。可重放：已有状态的不动。
UPDATE claims SET todo_status = 'open' WHERE claim_kind = 'todo' AND todo_status IS NULL;

-- ─────────────────────────────── ④ 副本继承有效期 / 截止 / 待办状态 ───────────────────────────────
CREATE OR REPLACE FUNCTION kg_copy_inherits_time() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  -- 只在这是副本的第一个 derived_from 来源时继承（合并进已有副本不改副本）
  IF EXISTS (SELECT 1 FROM ontology_edges d
              WHERE d.org_id = NEW.org_id AND d.src_kind = 'claim' AND d.src_id = NEW.src_id AND d.relation = 'derived_from'
                AND d.dst_kind = 'claim' AND d.id <> NEW.id AND d.status = 'active') THEN
    RETURN NEW;
  END IF;
  UPDATE claims p
     SET valid_from = CASE WHEN p.valid_to IS NULL AND s.valid_to IS NOT NULL THEN s.valid_from ELSE p.valid_from END,
         valid_to = coalesce(p.valid_to, s.valid_to),
         due_at = coalesce(p.due_at, s.due_at),
         todo_status = CASE WHEN p.claim_kind = 'todo' AND s.claim_kind = 'todo' THEN coalesce(s.todo_status, p.todo_status) ELSE p.todo_status END,
         updated_at = now()
    FROM claims s
   WHERE p.org_id = NEW.org_id AND p.id = NEW.src_id AND s.org_id = NEW.org_id AND s.id = NEW.dst_id
     AND ((p.valid_to IS NULL AND s.valid_to IS NOT NULL) OR (p.due_at IS NULL AND s.due_at IS NOT NULL)
          OR (p.claim_kind = 'todo' AND s.claim_kind = 'todo' AND p.todo_status IS DISTINCT FROM s.todo_status));
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS kg_copy_inherits_time_trg ON ontology_edges;
CREATE TRIGGER kg_copy_inherits_time_trg AFTER INSERT ON ontology_edges
  FOR EACH ROW WHEN (NEW.relation = 'derived_from' AND NEW.src_kind = 'claim' AND NEW.dst_kind = 'claim')
  EXECUTE FUNCTION kg_copy_inherits_time();

-- ─────────────────────────────── ⑤ 改写一条结论不丢时间字段（#4492 review） ───────────────────────────────
-- F10 reviseClaim（20260924220000）插一条新结论（supersedes_claim_id = 旧条），只写 valid_from = now()：
-- 改个说法，做完了的待办会变回「还没做」、丢掉截止，「这周」的有效期会变成长期有效。
-- 规则：新行带着 supersedes_claim_id、且自己**没有任何**时间字段（valid_to / due_at 都空）⇒ 照抄旧条的
--   valid_to、due_at；旧条有有效期窗口时 valid_from 也照抄（改的是说法，不是「从什么时候起成立」——窗口保持原样，
--   也保证 valid_from < valid_to）；旧条长期有效时 valid_from 保持新行自己的（now()，即记录时间，同 F03）。
--   待办状态：新旧都是待办 ⇒ 照抄旧条的状态（done / dropped 不因改写复活）。
-- 只在 INSERT 时判；新行自己带了时间字段（将来的调用方明确给了）⇒ 尊重新行，一个字段都不抄。
-- F17 记忆卡的 editedStatement 不走这里：那是用户在卡上改过的「记住：…」原话，落成一条新结论（没有 supersedes_claim_id，
-- 也没有可继承的旧条）；时间说法由它自己的抽取产生，不是改写。
CREATE OR REPLACE FUNCTION kg_revise_inherits_time() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_old record;
BEGIN
  IF NEW.supersedes_claim_id IS NULL OR NEW.valid_to IS NOT NULL OR NEW.due_at IS NOT NULL THEN
    RETURN NEW;
  END IF;
  SELECT c.claim_kind, c.valid_from, c.valid_to, c.due_at, c.todo_status INTO v_old
    FROM claims c WHERE c.org_id = NEW.org_id AND c.id = NEW.supersedes_claim_id;
  IF NOT FOUND THEN RETURN NEW; END IF;
  IF v_old.valid_to IS NOT NULL THEN
    NEW.valid_from := v_old.valid_from;
    NEW.valid_to := v_old.valid_to;
  END IF;
  NEW.due_at := v_old.due_at;
  IF NEW.claim_kind = 'todo' AND v_old.claim_kind = 'todo' AND NEW.todo_status IS NULL THEN
    NEW.todo_status := v_old.todo_status;
  END IF;
  RETURN NEW;
END;
$$;
-- 触发器按名字顺序执行：本触发器（kg_revise…）先于 kg_todo_status_default_trg，抄来的状态不会被补成 open。
DROP TRIGGER IF EXISTS kg_revise_inherits_time_trg ON claims;
CREATE TRIGGER kg_revise_inherits_time_trg BEFORE INSERT ON claims
  FOR EACH ROW WHEN (NEW.supersedes_claim_id IS NOT NULL) EXECUTE FUNCTION kg_revise_inherits_time();
REVOKE ALL ON FUNCTION kg_revise_inherits_time() FROM PUBLIC;

-- ─────────────────────────────── ② 改待办状态（人的动作） ───────────────────────────────
-- p = { action_id, claim_id, status }。返回 { claim_id, status, claim_ids }（claim_ids = 一起改了的，含它自己）。
-- 找不到 / 不是待办 / 已失效 / 调用方不是所有者 ⇒ 同一个 KG_CLAIM_NOT_FOUND（不让人探测别人的会话 / 空间里有没有这条）。
CREATE OR REPLACE FUNCTION kg_set_todo_status(p jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_org     text := current_setting('app.current_org', true);
  v_user    text := current_setting('app.current_user_id', true);
  v_status  text := p->>'status';
  v_id      text := p->>'action_id';
  v_claim   record;
  v_ids     text[];
  v_scope   record;
  n         int := 0;
BEGIN
  IF v_org IS NULL OR v_org = '' THEN RAISE EXCEPTION 'KG_NO_TENANT' USING ERRCODE = '42501'; END IF;
  IF NOT public.kernel_org_is_writable(v_org) THEN
    RAISE EXCEPTION 'KG_ORG_FROZEN: organization % is read-only', v_org USING ERRCODE = '42501';
  END IF;
  IF v_user IS NULL OR v_user = '' THEN RAISE EXCEPTION 'KG_ACTOR_NOT_HUMAN: no signed-in user' USING ERRCODE = '42501'; END IF;
  IF v_status IS NULL OR v_status NOT IN ('open', 'done', 'dropped') THEN
    RAISE EXCEPTION 'KG_INVALID_REQUEST: status %', v_status USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_claim FROM claims c WHERE c.org_id = v_org AND c.id = p->>'claim_id';
  IF NOT FOUND OR v_claim.claim_kind IS DISTINCT FROM 'todo' OR v_claim.revoked_at IS NOT NULL OR v_claim.status = 'superseded'
     OR NOT ((v_claim.scope_kind = 'personal' AND v_claim.scope_id = v_user)
          OR (v_claim.scope_kind = 'chat_session'
              AND EXISTS (SELECT 1 FROM chat_threads t WHERE t.org_id = v_org AND t.id = v_claim.scope_id AND t.created_by = v_user))) THEN
    RAISE EXCEPTION 'KG_CLAIM_NOT_FOUND' USING ERRCODE = '23503';
  END IF;

  -- 同一件待办的其它份：derived_from 活边相连（副本 → 来源，两个方向各一跳，再从来源到它的其它副本）、调用方同样是所有者的
  SELECT array_agg(DISTINCT x) INTO v_ids FROM (
    SELECT v_claim.id AS x
    UNION SELECT d.dst_id FROM ontology_edges d WHERE d.org_id = v_org AND d.src_kind = 'claim' AND d.src_id = v_claim.id
      AND d.relation = 'derived_from' AND d.dst_kind = 'claim' AND d.status = 'active'
    UNION SELECT d.src_id FROM ontology_edges d WHERE d.org_id = v_org AND d.dst_kind = 'claim' AND d.relation = 'derived_from'
      AND d.src_kind = 'claim' AND d.status = 'active'
      AND (d.dst_id = v_claim.id
           OR d.dst_id IN (SELECT e.dst_id FROM ontology_edges e WHERE e.org_id = v_org AND e.src_kind = 'claim' AND e.src_id = v_claim.id
                             AND e.relation = 'derived_from' AND e.dst_kind = 'claim' AND e.status = 'active'))) s
   WHERE EXISTS (SELECT 1 FROM claims c WHERE c.org_id = v_org AND c.id = s.x AND c.claim_kind = 'todo'
                   AND c.revoked_at IS NULL AND c.status <> 'superseded'
                   AND ((c.scope_kind = 'personal' AND c.scope_id = v_user)
                     OR (c.scope_kind = 'chat_session'
                         AND EXISTS (SELECT 1 FROM chat_threads t WHERE t.org_id = v_org AND t.id = c.scope_id AND t.created_by = v_user))));

  -- 与其它人的动作同一组作用域锁、同一个顺序（先会话、后个人空间）
  FOR v_scope IN SELECT s.scope_kind, s.scope_id FROM (SELECT DISTINCT c.scope_kind, c.scope_id FROM claims c WHERE c.org_id = v_org AND c.id = ANY(v_ids)) s
                  ORDER BY (s.scope_kind = 'personal'), s.scope_id LOOP
    PERFORM pg_advisory_xact_lock(hashtext('kg_scope:' || v_org || '|' || v_scope.scope_kind || '|' || v_scope.scope_id));
  END LOOP;
  PERFORM 1 FROM claims c WHERE c.org_id = v_org AND c.id = ANY(v_ids) FOR UPDATE;

  UPDATE claims SET todo_status = v_status, updated_at = now()
   WHERE org_id = v_org AND id = ANY(v_ids) AND todo_status IS DISTINCT FROM v_status;

  -- 审计：每个作用域一条（会话的 revision 前进，面板重读即见）
  FOR v_scope IN SELECT s.scope_kind, s.scope_id FROM (SELECT DISTINCT c.scope_kind, c.scope_id FROM claims c WHERE c.org_id = v_org AND c.id = ANY(v_ids)) s
                  ORDER BY (s.scope_kind = 'personal'), s.scope_id LOOP
    INSERT INTO ontology_actions (id, org_id, scope_kind, scope_id, actor_kind, actor_id, action_type, payload, outcome)
    VALUES (CASE WHEN n = 0 THEN v_id ELSE v_id || '-' || n END, v_org, v_scope.scope_kind, v_scope.scope_id, 'human', v_user,
            'setTodoStatus',
            jsonb_build_object('status', v_status, 'claim_id', v_claim.id,
                               'claims', (SELECT jsonb_agg(jsonb_build_object('id', c.id) ORDER BY c.id) FROM claims c
                                           WHERE c.org_id = v_org AND c.id = ANY(v_ids)
                                             AND c.scope_kind = v_scope.scope_kind AND c.scope_id = v_scope.scope_id)),
            'accepted');
    n := n + 1;
  END LOOP;

  RETURN jsonb_build_object('claim_id', v_claim.id, 'status', v_status,
                            'claim_ids', (SELECT jsonb_agg(x ORDER BY x) FROM unnest(v_ids) x));
END
$$;

REVOKE ALL ON FUNCTION kg_set_todo_status(jsonb), kg_copy_inherits_time(), kg_todo_status_default() FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_rw') THEN
    GRANT EXECUTE ON FUNCTION kg_set_todo_status(jsonb) TO app_rw;
  END IF;
END
$$;

-- ─────────────────────────────── ① 抽取批次写有效期 / 截止（kg_apply_batch 重建） ───────────────────────────────
-- 与 20260924190000 逐字相同，只有 INSERT INTO claims 那一句多写 valid_to / due_at、valid_from 取批次给的值（缺省仍是 now()）。
CREATE OR REPLACE FUNCTION kg_apply_batch(p jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_org        text := current_setting('app.current_org', true);
  v_user       text := current_setting('app.current_user_id', true);
  v_scope_kind text := p->>'scope_kind';
  v_scope_id   text := p->>'scope_id';
  v_actor      text := p->>'actor_kind';
  v_created_by text;
  v_existing   text;
  v_n          int;
  o jsonb; c jsonb; e jsonb; ev jsonb;
  v_objects int := 0; v_claims int := 0; v_edges int := 0;
BEGIN
  IF v_org IS NULL OR v_org = '' THEN
    RAISE EXCEPTION 'KG_NO_TENANT' USING ERRCODE = '42501';
  END IF;
  -- F22：冻结的 org 只读。函数属主在本地 / CI 是超级用户，_org_frozen_* 策略对它不生效，必须显式判。
  IF NOT public.kernel_org_is_writable(v_org) THEN
    RAISE EXCEPTION 'KG_ORG_FROZEN: organization % is read-only', v_org USING ERRCODE = '42501';
  END IF;
  IF NOT kg_scope_enabled(v_scope_kind) THEN
    RAISE EXCEPTION 'KG_SCOPE_NOT_ENABLED: %', v_scope_kind USING ERRCODE = '42501';
  END IF;
  -- I-14：个人空间只能由本人写入
  IF v_scope_kind = 'personal' AND v_scope_id IS DISTINCT FROM v_user THEN
    RAISE EXCEPTION 'KG_NOT_OWNER: personal scope % is not the current user', v_scope_id USING ERRCODE = '42501';
  END IF;
  -- 人工动作的执行身份就是登录用户本人（I-15）：reviewed_by 不能由调用方随便填。
  IF v_actor = 'human' AND p->>'actor_id' IS DISTINCT FROM v_user THEN
    RAISE EXCEPTION 'KG_NOT_OWNER: human actor % is not the current user', p->>'actor_id' USING ERRCODE = '42501';
  END IF;
  v_created_by := CASE v_actor WHEN 'human' THEN 'human' WHEN 'model' THEN 'model' ELSE 'import' END;

  -- I-7 幂等：同一源、同一 pipeline 版本已经成功处理过 ⇒ 原样返回，不重复写。
  -- 先拿事务级 advisory lock：两个并发的重复任务否则都会「先查没有、再各写一份」。
  IF p->>'source_ref' IS NOT NULL AND p->>'pipeline_version' IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtext('kg_apply:' || v_org || '|' || (p->>'source_ref') || '|' || (p->>'pipeline_version')));
    SELECT a.id INTO v_existing FROM ontology_actions a
     WHERE a.org_id = v_org AND a.source_ref = p->>'source_ref' AND a.pipeline_version = p->>'pipeline_version'
       AND a.outcome = 'accepted'
     LIMIT 1;
    IF v_existing IS NOT NULL THEN
      RETURN jsonb_build_object('action_id', v_existing, 'deduplicated', true, 'objects', 0, 'claims', 0, 'edges', 0);
    END IF;
  END IF;

  FOR o IN SELECT * FROM jsonb_array_elements(coalesce(p->'objects', '[]'::jsonb)) LOOP
    INSERT INTO ontology_objects (id, org_id, scope_kind, scope_id, object_kind, name, aliases, created_by)
    VALUES (o->>'id', v_org, v_scope_kind, v_scope_id, o->>'object_kind', o->>'name',
            coalesce(ARRAY(SELECT jsonb_array_elements_text(o->'aliases')), '{}'), v_created_by)
    ON CONFLICT (id) DO NOTHING;
    -- 只数真正写进去的：同 id 已存在（实体解析复用了旧实体）不算新写入。
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_objects := v_objects + v_n;
  END LOOP;

  FOR c IN SELECT * FROM jsonb_array_elements(coalesce(p->'claims', '[]'::jsonb)) LOOP
    -- I-4：模型产出的结论生命周期最高到 proposed
    IF v_actor <> 'human' AND c->>'status' <> 'proposed' THEN
      RAISE EXCEPTION 'KG_ACTOR_NOT_HUMAN: model/system may only propose, got %', c->>'status' USING ERRCODE = '42501';
    END IF;
    -- I-5：至少一条 supporting 证据
    IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(coalesce(c->'evidence', '[]'::jsonb)) x WHERE x->>'stance' = 'supporting') THEN
      RAISE EXCEPTION 'KG_EVIDENCE_REQUIRED: claim % has no supporting evidence', c->>'id' USING ERRCODE = '23514';
    END IF;
    INSERT INTO claims (id, org_id, statement, status, tsv, claim_kind, confidence, created_by, reviewed_by,
                        scope_kind, scope_id, valid_from, valid_to, due_at)
    VALUES (c->>'id', v_org, c->>'statement', c->>'status', to_tsvector('simple', c->>'statement'),
            c->>'claim_kind', (c->>'confidence')::real,
            v_created_by, CASE WHEN v_actor = 'human' THEN v_user END,
            v_scope_kind, v_scope_id,
            -- #4363（S6）：有效期 / 截止（缺省：从现在起长期有效、没有截止）。起止颠倒由 claims_validity_chk 拒收（23514）。
            coalesce((c->>'valid_from')::timestamptz, now()), (c->>'valid_until')::timestamptz, (c->>'due_at')::timestamptz);
    FOR ev IN SELECT * FROM jsonb_array_elements(c->'evidence') LOOP
      PERFORM kg_insert_claim_evidence(v_org, v_scope_kind, v_scope_id, c->>'id', ev);
    END LOOP;
    v_claims := v_claims + 1;
  END LOOP;

  FOR e IN SELECT * FROM jsonb_array_elements(coalesce(p->'edges', '[]'::jsonb)) LOOP
    IF NOT kg_endpoint_exists(v_org, v_user, e->>'src_kind', e->>'src_id') OR NOT kg_endpoint_exists(v_org, v_user, e->>'dst_kind', e->>'dst_id') THEN
      RAISE EXCEPTION 'KG_EDGE_ENDPOINT_NOT_FOUND: edge %', e->>'id' USING ERRCODE = '23503';
    END IF;
    INSERT INTO ontology_edges (id, org_id, src_kind, src_id, dst_kind, dst_id, relation, created_by, scope_kind, scope_id)
    VALUES (e->>'id', v_org, e->>'src_kind', e->>'src_id', e->>'dst_kind', e->>'dst_id', e->>'relation',
            v_created_by, v_scope_kind, v_scope_id)
    ON CONFLICT (id) DO NOTHING;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_edges := v_edges + v_n;
  END LOOP;

  INSERT INTO ontology_actions (id, org_id, scope_kind, scope_id, actor_kind, actor_id, action_type, payload,
                                source_ref, pipeline_version, outcome)
  VALUES (p->>'action_id', v_org, v_scope_kind, v_scope_id, v_actor, p->>'actor_id', p->>'action_type',
          p - 'action_id', p->>'source_ref', p->>'pipeline_version', 'accepted');

  RETURN jsonb_build_object('action_id', p->>'action_id', 'deduplicated', false,
                            'objects', v_objects, 'claims', v_claims, 'edges', v_edges);
END
$$;

-- ─────────────────────────────── ③ #4307：取代只沿活的 derived_from 边收副本（kg_apply_supersedes 重建） ───────────────────────────────
-- 与 20260926140000 逐字相同，只在收副本的 EXISTS 里多了 `d.status = 'active'`。
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
    -- #4307（S6）：只沿**活的** derived_from 边——被 #4283 撤销摘掉（detached）的来源已不再支撑那份副本（F07 同一条规则）。
    SELECT array_agg(DISTINCT x) INTO v_set FROM (
      SELECT unnest(v_olders) AS x
      UNION
      SELECT pc.id FROM claims pc
       WHERE v_owner IS NOT NULL AND pc.org_id = v_org AND pc.scope_kind = 'personal' AND pc.scope_id = v_owner
         AND pc.revoked_at IS NULL AND pc.status <> 'superseded'
         AND EXISTS (SELECT 1 FROM ontology_edges d WHERE d.org_id = v_org AND d.src_kind = 'claim' AND d.src_id = pc.id
                       AND d.relation = 'derived_from' AND d.dst_kind = 'claim' AND d.dst_id = ANY(v_olders)
                       AND d.status = 'active')) s;
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


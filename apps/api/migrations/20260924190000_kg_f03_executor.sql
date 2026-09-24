/*
 * Phase 18 F03 —— ontology_actions 执行器的数据库一半（契约束 chat-knowledge-graph I-1/I-3/I-4/I-5/I-7）。
 *
 * ## 写入只有一个入口
 *
 * - `kg_apply_batch(jsonb)`：把一批候选（实体 / 结论 + 证据 / 边）连同一条 accepted 的
 *   `ontology_actions` 行在**同一个事务**里落表。应用层（`application/knowledge-graph/apply-ontology-batch.ts`）
 *   先做完整校验，这里再校验一遍不变量——两层都挡，任何一层漏了另一层兜住。
 * - `kg_record_rejected(jsonb)`：被拒的动作也要留痕（uc-18-1 E2「记 rejected 及原因，可在审计里查」）。
 * - 两个函数都是 SECURITY DEFINER：`app_rw` 对 ontology_objects / ontology_actions 没有写权限（F02）。
 *
 * ## 为什么还要一个触发器
 *
 * `claims` / `ontology_edges` / `claim_segments` 在 0009 就给了 `app_rw` 写权限（检索夹具、F45 删除级联在用），
 * F02 没有收回。于是「带作用域的本体行」还有一条绕过执行器的路：app_rw 直接 INSERT。
 * `kg_scoped_write_guard` 堵这条路：**以 app_rw 身份**写入带 scope 的结论 / 边、或给带 scope 的结论挂证据，一律拒绝。
 * 在 SECURITY DEFINER 函数里 `current_user` 是函数属主，所以执行器的写入不受影响；没有 scope 的旧行也不受影响。
 *
 * ⚠ 这是「同一个 app_rw 连接上的 SQL 注入 / 被污染的依赖」之外的防线：能跑任意 SQL 的攻击者也能调用
 *   kg_apply_batch。真正的凭据隔离（独立的 kg_writer 角色，同 `diagnosticsReaderConfig()` 的做法）
 *   需要新增部署凭据与 PGlite 角色，记为硬化后续项，不在 MVP 里做。
 */

-- ─────────────────────────────── 作用域开关（I-1） ───────────────────────────────
-- 本阶段只开放两级。外扩时改这里（一处），不改表、不改执行器代码。
CREATE OR REPLACE FUNCTION kg_scope_enabled(p_scope_kind text) RETURNS boolean
LANGUAGE sql IMMUTABLE AS $$ SELECT p_scope_kind IN ('chat_session', 'personal') $$;

-- ─────────────────────────────── 绕过执行器的直写：拒绝 ───────────────────────────────
CREATE OR REPLACE FUNCTION kg_scoped_write_guard() RETURNS trigger
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_protected boolean;
BEGIN
  -- 「本体行」= 带作用域的行，或由模型 / 人（经执行器）产生的行（created_by ∈ model/human）。
  -- 只看 NEW 不够：UPDATE 可以把作用域清空、把 created_by 改掉来「洗白」一行，所以 OLD 也算。
  -- I-8「结论的作用域终生不变」也由此得到保证（app_rw 碰不到本体行）。
  IF TG_TABLE_NAME = 'claim_segments' THEN
    SELECT c.scope_kind IS NOT NULL OR c.created_by IN ('model', 'human') INTO v_protected
      FROM public.claims c WHERE c.id = NEW.claim_id;
  ELSE
    v_protected := NEW.scope_kind IS NOT NULL OR NEW.created_by IN ('model', 'human')
      OR (TG_OP = 'UPDATE' AND (OLD.scope_kind IS NOT NULL OR OLD.created_by IN ('model', 'human')));
  END IF;
  IF coalesce(v_protected, false) AND current_user = 'app_rw' THEN
    RAISE EXCEPTION 'KG_WRITE_OUTSIDE_EXECUTOR: % rows written by the model or a person, or carrying a knowledge scope, are written only through kg_apply_batch', TG_TABLE_NAME
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS kg_scoped_write_guard_trg ON claims;
CREATE TRIGGER kg_scoped_write_guard_trg BEFORE INSERT OR UPDATE ON claims
  FOR EACH ROW EXECUTE FUNCTION kg_scoped_write_guard();
DROP TRIGGER IF EXISTS kg_scoped_write_guard_trg ON ontology_edges;
CREATE TRIGGER kg_scoped_write_guard_trg BEFORE INSERT OR UPDATE ON ontology_edges
  FOR EACH ROW EXECUTE FUNCTION kg_scoped_write_guard();
DROP TRIGGER IF EXISTS kg_scoped_write_guard_trg ON claim_segments;
CREATE TRIGGER kg_scoped_write_guard_trg BEFORE INSERT OR UPDATE ON claim_segments
  FOR EACH ROW EXECUTE FUNCTION kg_scoped_write_guard();

-- ─────────────────────────────── 被拒动作留痕 ───────────────────────────────
CREATE OR REPLACE FUNCTION kg_record_rejected(p jsonb) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_org        text := current_setting('app.current_org', true);
  v_user       text := current_setting('app.current_user_id', true);
  v_scope_kind text := p->>'scope_kind';
  v_scope_id   text := p->>'scope_id';
  v_payload    jsonb := coalesce(p->'payload', '{}'::jsonb);
BEGIN
  IF v_org IS NULL OR v_org = '' THEN
    RAISE EXCEPTION 'KG_NO_TENANT' USING ERRCODE = '42501';
  END IF;
  -- 冻结的 org 什么都不写（F22）。属主身份下 RLS 的 _org_frozen_* 策略可能不生效（超级用户），所以显式判。
  IF NOT public.kernel_org_is_writable(v_org) THEN
    RAISE EXCEPTION 'KG_ORG_FROZEN: organization % is read-only', v_org USING ERRCODE = '42501';
  END IF;
  -- 想写别人个人空间被拒（KG_NOT_OWNER）：这条留痕不能记进那个人的个人空间——
  -- 既写不进（RLS），也不该让被写的人的审计里出现别人的内容。记在 org 级，目标作用域放进 payload。
  IF v_scope_kind = 'personal' AND v_scope_id IS DISTINCT FROM v_user THEN
    v_payload := v_payload || jsonb_build_object('attempted_scope', jsonb_build_object('kind', v_scope_kind, 'id', v_scope_id));
    v_scope_kind := 'org';
    v_scope_id := v_org;
  END IF;
  INSERT INTO ontology_actions (id, org_id, scope_kind, scope_id, actor_kind, actor_id, action_type, payload,
                                source_ref, pipeline_version, outcome, reject_code, reject_reason)
  VALUES (p->>'action_id', v_org, v_scope_kind, v_scope_id, p->>'actor_kind', p->>'actor_id',
          p->>'action_type', v_payload, p->>'source_ref', p->>'pipeline_version',
          'rejected', p->>'reject_code', p->>'reject_reason')
  ON CONFLICT (id) DO NOTHING;
  RETURN p->>'action_id';
END
$$;

-- ─────────────────────────────── 证据写入（F06 会替换它以接收消息证据） ───────────────────────────────
CREATE OR REPLACE FUNCTION kg_insert_claim_evidence(p_org text, p_scope_kind text, p_scope_id text, p_claim_id text, ev jsonb)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM segments s WHERE s.id = ev->>'segment_id' AND s.org_id = p_org) THEN
    RAISE EXCEPTION 'KG_EVIDENCE_NOT_FOUND: segment %', ev->>'segment_id' USING ERRCODE = '23503';
  END IF;
  INSERT INTO claim_segments (claim_id, org_id, segment_id, stance)
  VALUES (p_claim_id, p_org, ev->>'segment_id', ev->>'stance')
  ON CONFLICT DO NOTHING;
END
$$;

-- 边的端点必须存在于本 org（实体 / 结论可以是本批刚写的）。不校验会在 canonical 里堆积悬空边。
CREATE OR REPLACE FUNCTION kg_endpoint_exists(p_org text, p_kind text, p_id text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT CASE p_kind
    WHEN 'object'       THEN EXISTS (SELECT 1 FROM ontology_objects o WHERE o.id = p_id AND o.org_id = p_org)
    WHEN 'claim'        THEN EXISTS (SELECT 1 FROM claims c WHERE c.id = p_id AND c.org_id = p_org)
    WHEN 'segment'      THEN EXISTS (SELECT 1 FROM segments s WHERE s.id = p_id AND s.org_id = p_org)
    WHEN 'chat_message' THEN EXISTS (SELECT 1 FROM chat_messages m WHERE m.id = p_id AND m.org_id = p_org)
    ELSE false
  END
$$;

-- ─────────────────────────────── 唯一写入口 ───────────────────────────────
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
                        scope_kind, scope_id, valid_from)
    VALUES (c->>'id', v_org, c->>'statement', c->>'status', to_tsvector('simple', c->>'statement'),
            c->>'claim_kind', (c->>'confidence')::real,
            v_created_by, CASE WHEN v_actor = 'human' THEN v_user END,
            v_scope_kind, v_scope_id, now());
    FOR ev IN SELECT * FROM jsonb_array_elements(c->'evidence') LOOP
      PERFORM kg_insert_claim_evidence(v_org, v_scope_kind, v_scope_id, c->>'id', ev);
    END LOOP;
    v_claims := v_claims + 1;
  END LOOP;

  FOR e IN SELECT * FROM jsonb_array_elements(coalesce(p->'edges', '[]'::jsonb)) LOOP
    IF NOT kg_endpoint_exists(v_org, e->>'src_kind', e->>'src_id') OR NOT kg_endpoint_exists(v_org, e->>'dst_kind', e->>'dst_id') THEN
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

REVOKE ALL ON FUNCTION kg_apply_batch(jsonb), kg_record_rejected(jsonb), kg_scope_enabled(text),
  kg_insert_claim_evidence(text, text, text, text, jsonb), kg_endpoint_exists(text, text, text) FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_rw') THEN
    GRANT EXECUTE ON FUNCTION kg_apply_batch(jsonb), kg_record_rejected(jsonb), kg_scope_enabled(text) TO app_rw;
  END IF;
END
$$;

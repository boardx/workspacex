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
CREATE OR REPLACE FUNCTION kg_scoped_write_guard() RETURNS trigger AS $$
DECLARE
  v_scoped boolean;
BEGIN
  IF TG_TABLE_NAME = 'claim_segments' THEN
    SELECT c.scope_kind IS NOT NULL INTO v_scoped FROM claims c WHERE c.id = NEW.claim_id;
  ELSE
    v_scoped := NEW.scope_kind IS NOT NULL;
  END IF;
  IF coalesce(v_scoped, false) AND current_user = 'app_rw' THEN
    RAISE EXCEPTION 'KG_WRITE_OUTSIDE_EXECUTOR: % rows with a knowledge scope are written only through kg_apply_batch', TG_TABLE_NAME
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
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
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

-- ─────────────────────────────── 唯一写入口 ───────────────────────────────
CREATE OR REPLACE FUNCTION kg_apply_batch(p jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
DECLARE
  v_org        text := current_setting('app.current_org', true);
  v_user       text := current_setting('app.current_user_id', true);
  v_scope_kind text := p->>'scope_kind';
  v_scope_id   text := p->>'scope_id';
  v_actor      text := p->>'actor_kind';
  v_created_by text;
  v_existing   text;
  o jsonb; c jsonb; e jsonb; ev jsonb;
  v_objects int := 0; v_claims int := 0; v_edges int := 0;
BEGIN
  IF v_org IS NULL OR v_org = '' THEN
    RAISE EXCEPTION 'KG_NO_TENANT' USING ERRCODE = '42501';
  END IF;
  IF NOT kg_scope_enabled(v_scope_kind) THEN
    RAISE EXCEPTION 'KG_SCOPE_NOT_ENABLED: %', v_scope_kind USING ERRCODE = '42501';
  END IF;
  -- I-14：个人空间只能由本人写入
  IF v_scope_kind = 'personal' AND v_scope_id IS DISTINCT FROM v_user THEN
    RAISE EXCEPTION 'KG_NOT_OWNER: personal scope % is not the current user', v_scope_id USING ERRCODE = '42501';
  END IF;
  v_created_by := CASE v_actor WHEN 'human' THEN 'human' WHEN 'model' THEN 'model' ELSE 'import' END;

  -- I-7 幂等：同一源、同一 pipeline 版本已经成功处理过 ⇒ 原样返回，不重复写。
  IF p->>'source_ref' IS NOT NULL AND p->>'pipeline_version' IS NOT NULL THEN
    SELECT a.id INTO v_existing FROM ontology_actions a
     WHERE a.org_id = v_org AND a.source_ref = p->>'source_ref' AND a.pipeline_version = p->>'pipeline_version'
       AND a.outcome = 'accepted' AND a.action_type = p->>'action_type'
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
    v_objects := v_objects + 1;
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
    VALUES (c->>'id', v_org, c->>'statement', c->>'status', to_tsvector('simple', c->>'statement'), c->>'claim_kind', (c->>'confidence')::real,
            v_created_by, CASE WHEN v_actor = 'human' THEN p->>'actor_id' END,
            v_scope_kind, v_scope_id, now());
    FOR ev IN SELECT * FROM jsonb_array_elements(c->'evidence') LOOP
      -- 证据段必须属于本 org（RLS 之外再挡一次：SECURITY DEFINER 下 RLS 仍按属主身份生效与否取决于 FORCE）
      IF NOT EXISTS (SELECT 1 FROM segments s WHERE s.id = ev->>'segment_id' AND s.org_id = v_org) THEN
        RAISE EXCEPTION 'KG_EVIDENCE_NOT_FOUND: segment %', ev->>'segment_id' USING ERRCODE = '23503';
      END IF;
      INSERT INTO claim_segments (claim_id, org_id, segment_id, stance)
      VALUES (c->>'id', v_org, ev->>'segment_id', ev->>'stance')
      ON CONFLICT DO NOTHING;
    END LOOP;
    v_claims := v_claims + 1;
  END LOOP;

  FOR e IN SELECT * FROM jsonb_array_elements(coalesce(p->'edges', '[]'::jsonb)) LOOP
    INSERT INTO ontology_edges (id, org_id, src_kind, src_id, dst_kind, dst_id, relation, created_by, scope_kind, scope_id)
    VALUES (e->>'id', v_org, e->>'src_kind', e->>'src_id', e->>'dst_kind', e->>'dst_id', e->>'relation',
            v_created_by, v_scope_kind, v_scope_id)
    ON CONFLICT (id) DO NOTHING;
    v_edges := v_edges + 1;
  END LOOP;

  INSERT INTO ontology_actions (id, org_id, scope_kind, scope_id, actor_kind, actor_id, action_type, payload,
                                source_ref, pipeline_version, outcome)
  VALUES (p->>'action_id', v_org, v_scope_kind, v_scope_id, v_actor, p->>'actor_id', p->>'action_type',
          p - 'action_id', p->>'source_ref', p->>'pipeline_version', 'accepted');

  RETURN jsonb_build_object('action_id', p->>'action_id', 'deduplicated', false,
                            'objects', v_objects, 'claims', v_claims, 'edges', v_edges);
END
$$;

REVOKE ALL ON FUNCTION kg_apply_batch(jsonb), kg_record_rejected(jsonb), kg_scope_enabled(text) FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_rw') THEN
    GRANT EXECUTE ON FUNCTION kg_apply_batch(jsonb), kg_record_rejected(jsonb), kg_scope_enabled(text) TO app_rw;
  END IF;
END
$$;

/*
 * Phase 18 S8（#4365，epic #4359）—— 个人空间的记忆整合（去重 / 实体合一 / 矛盾开卡）+ 抽取 SLO 的数据库一半。
 *
 * ## 一、整合（默认关，平台管理员在后台打开）
 *
 * 部署级开关 `kg_consolidation_state`（全库单例，**默认 false**，同 `kg_extraction_state` 的形状）。worker
 * （apps/api/src/infrastructure/knowledge-graph/kg-consolidation-worker.ts）每轮先读它，关着就什么都不做。
 *
 * 一次整合 = 一个用户、一个 org 的一次「运行」（`kg_consolidation_runs`），每一处改动一行（`kg_consolidation_changes`），
 * 行里存着撤销所需的全部原值（`restore`）。三种改动：
 *   - `claim_merge`：两条说的是同一件事的个人记忆，保留一条（keep），另一条（other）软失效
 *     （`revoked_at` + `revocation_reason = consolidated_duplicate`，行不删）；other 的来源——消息证据、附件证据、
 *     derived_from 边、about 边——逐条复制到 keep 上（**所有来源都保留**），复制了哪几条记在 restore 里。
 *     F07 的级联照常把 other 自己的边收掉；收掉了哪几条也记在 restore 里。
 *   - `entity_merge`：同一个实体的两种写法，合进保留方（同 F10 mergeObjects：改指向 + 别名并入 + merged_into），
 *     改了哪几条边的哪一端、保留方原来的别名，记在 restore 里。
 *   - `conflict_opened`：两条个人记忆彼此矛盾 ⇒ 开一张 F16 的冲突卡（`kg_conflict_prompts`），**不裁决**。
 *     F16 的卡挂在「新说法」所在的会话一轮下面，由人选「以新的为准 / 两条都留 / 忽略」（kg_resolve_conflict 原样）。
 *     所以新的那条要找回它在本人个人对话里的来源结论（活的 derived_from 边）：卡的一对是「那条会话结论 ↔ 旧的个人记忆」，
 *     与 F16 自己开的卡同构。找不到这样的来源（例如手工记入、来源对话已删）⇒ 不开卡，只计数（`conflicts_unsurfaced`）。
 *
 * 撤销（`kg_consolidation_undo`，人的动作，只有本人）：逆序逐条还原；某一条的前提已经变了（keep 已被忘掉、卡已被人处理……）
 * ⇒ 那一条记 `undo_skipped` 并写明原因，其余照常还原，整次运行记 `partially_undone`。
 *
 * 审计：每次整合、每次撤销各在本人个人空间留一条 `ontology_actions`（append-only）；会话侧开卡另留一条（同 F16）。
 *
 * ## 为什么全部是 SECURITY DEFINER 函数
 *
 * 个人空间的行对 app_rw 只在 `app.current_user_id = 本人` 时可见，写只经 kg_* 函数（F03 `kg_scoped_write_guard`）。
 * 系统 worker 以「本人」身份声明 app.current_user_id 后调用（同 F16 asThreadOwner 的做法）；每个函数都再判一次
 * 「scope_id = 声明的本人」——definer 身份看得见全 org 的个人空间行（F02 头注的代价条款）。
 *
 * ## 二、抽取 SLO
 *
 * `kg_extraction_slo_counts(lease_seconds, max_attempts)`：全库现数——租约过期仍未完成的行（卡住）、用完重试的行（死信）、
 * 待处理积压与最老一条的等待秒数。只回数字，不回任何内容；租约秒数与重试上限由调用方传入
 * （单一事实源在 pg-kg-extraction.ts 的 KG_EXTRACTION_LEASE_SECONDS / KG_EXTRACTION_MAX_ATTEMPTS）。
 */

-- ─────────────────────────────── 部署开关（默认关） ───────────────────────────────
CREATE TABLE IF NOT EXISTS kg_consolidation_state (
  singleton  boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  enabled    boolean NOT NULL DEFAULT false,
  updated_at timestamptz
);
INSERT INTO kg_consolidation_state (singleton, enabled) VALUES (true, false) ON CONFLICT DO NOTHING;
COMMENT ON TABLE kg_consolidation_state IS
  'kernel-no-tenant-data: 部署级记忆整合开关，全库单例（singleton 行），不属于任何组织——同 kg_extraction_state。';
REVOKE ALL ON kg_consolidation_state FROM app_rw;
GRANT SELECT ON kg_consolidation_state TO app_rw;

CREATE OR REPLACE FUNCTION kg_consolidation_set_enabled(v boolean) RETURNS boolean
LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp
AS $$ UPDATE public.kg_consolidation_state SET enabled = v, updated_at = now() WHERE singleton RETURNING enabled $$;
REVOKE ALL ON FUNCTION kg_consolidation_set_enabled(boolean) FROM PUBLIC;

-- ─────────────────────────────── 运行与改动（审计 + 撤销依据） ───────────────────────────────
CREATE TABLE IF NOT EXISTS kg_consolidation_runs (
  id            text PRIMARY KEY,
  org_id        text NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  user_id       text NOT NULL CHECK (length(user_id) > 0),
  status        text NOT NULL DEFAULT 'applied' CHECK (status IN ('applied', 'undone', 'partially_undone')),
  claim_merges  integer NOT NULL DEFAULT 0,
  entity_merges integer NOT NULL DEFAULT 0,
  conflicts     integer NOT NULL DEFAULT 0,
  conflicts_unsurfaced integer NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now(),
  finished_at   timestamptz,
  undone_at     timestamptz,
  undone_by     text,
  CHECK ((status = 'applied') = (undone_at IS NULL))
);
CREATE INDEX IF NOT EXISTS kg_consolidation_runs_user_idx ON kg_consolidation_runs (org_id, user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS kg_consolidation_changes (
  id         text PRIMARY KEY,
  run_id     text NOT NULL REFERENCES kg_consolidation_runs (id) ON DELETE CASCADE,
  org_id     text NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  user_id    text NOT NULL,
  ordinal    integer NOT NULL CHECK (ordinal >= 0),
  kind       text NOT NULL CHECK (kind IN ('claim_merge', 'entity_merge', 'conflict_opened')),
  -- claim_merge：保留的结论 / 被合掉的结论；entity_merge：保留的实体 / 被合进来的实体；
  -- conflict_opened：旧的个人记忆 / 新说法（卡上的会话结论，见 restore.newer_personal）
  kept_id    text NOT NULL,
  other_id   text NOT NULL,
  basis      text,
  score      real,
  restore    jsonb NOT NULL,
  status     text NOT NULL DEFAULT 'applied' CHECK (status IN ('applied', 'undone', 'undo_skipped')),
  undo_note  text CHECK (undo_note IS NULL OR length(undo_note) <= 200),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (run_id, ordinal)
);
CREATE INDEX IF NOT EXISTS kg_consolidation_changes_run_idx ON kg_consolidation_changes (org_id, run_id, ordinal);

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['kg_consolidation_runs', 'kg_consolidation_changes']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_tenant', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I USING (org_id = current_setting(''app.current_org'', true) OR (SELECT public.kg_is_table_owner())) '
      'WITH CHECK (org_id = current_setting(''app.current_org'', true) OR (SELECT public.kg_is_table_owner()))',
      t || '_tenant', t);
    -- 只有本人（I-14，同个人空间的 RESTRICTIVE 策略）：改动行里的 id 指向本人的个人记忆。
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_owner', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I AS RESTRICTIVE USING (user_id = current_setting(''app.current_user_id'', true) OR (SELECT public.kg_is_table_owner())) '
      'WITH CHECK (user_id = current_setting(''app.current_user_id'', true) OR (SELECT public.kg_is_table_owner()))',
      t || '_owner', t);
    EXECUTE format('REVOKE ALL ON %I FROM app_rw', t);
    EXECUTE format('GRANT SELECT ON %I TO app_rw', t);
  END LOOP;
END
$$;

-- ─────────────────────────────── 待整合的用户（系统读，只回 id） ───────────────────────────────
-- 有活的个人记忆（≥ 2 条结论或 ≥ 2 个实体），且上一次整合之后有新的 / 改过的——没有新东西的人不重复跑。
CREATE OR REPLACE FUNCTION kg_consolidation_pending_users(p_limit integer)
RETURNS TABLE (org_id text, user_id text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp
AS $$
  WITH spaces AS (
    SELECT c.org_id, c.scope_id AS user_id, max(c.updated_at) AS touched, count(*) AS n
      FROM public.claims c
     WHERE c.scope_kind = 'personal' AND c.revoked_at IS NULL AND c.status <> 'superseded'
     GROUP BY c.org_id, c.scope_id
    UNION ALL
    SELECT o.org_id, o.scope_id, max(o.updated_at), count(*)
      FROM public.ontology_objects o
     WHERE o.scope_kind = 'personal' AND o.merged_into IS NULL
     GROUP BY o.org_id, o.scope_id
  ), agg AS (
    SELECT s.org_id, s.user_id, max(s.touched) AS touched, max(s.n) AS n FROM spaces s GROUP BY s.org_id, s.user_id
  )
  SELECT a.org_id, a.user_id FROM agg a
   WHERE a.n >= 2 AND public.kernel_org_is_writable(a.org_id)
     AND NOT EXISTS (SELECT 1 FROM public.kg_consolidation_runs r
                      WHERE r.org_id = a.org_id AND r.user_id = a.user_id AND coalesce(r.finished_at, r.created_at) >= a.touched)
   ORDER BY a.touched DESC, a.org_id, a.user_id
   LIMIT greatest(p_limit, 0)
$$;

-- 调用方必须已声明 app.current_user_id = 本人（worker 以本人身份、或本人的请求）。返回声明的本人；没声明 ⇒ 抛。
CREATE OR REPLACE FUNCTION kg_consolidation_actor(p_user text) RETURNS text
LANGUAGE plpgsql STABLE SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_user text := nullif(current_setting('app.current_user_id', true), '');
BEGIN
  IF current_setting('app.current_org', true) IS NULL OR current_setting('app.current_org', true) = '' THEN
    RAISE EXCEPTION 'KG_NO_TENANT' USING ERRCODE = '42501';
  END IF;
  IF v_user IS NULL OR v_user IS DISTINCT FROM p_user THEN
    RAISE EXCEPTION 'KG_NOT_OWNER: consolidation acts only as the space owner' USING ERRCODE = '42501';
  END IF;
  RETURN v_user;
END
$$;

-- ─────────────────────────────── 候选（系统读：只交给纯函数判定，不回请求方） ───────────────────────────────
-- claims：本人个人空间最近的 p_limit 条活结论；objects：本人个人空间未合并的实体；
-- similar：两边都有同一嵌入模型向量、同类型的结论对的余弦（预筛 ≥ 0.85；最终门槛在应用层纯函数里）。
CREATE OR REPLACE FUNCTION kg_consolidation_candidates(p_user text, p_limit integer) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_org  text := current_setting('app.current_org', true);
  v_user text := public.kg_consolidation_actor(p_user);
BEGIN
  RETURN (
    WITH cand AS (
      SELECT c.* FROM public.claims c
       WHERE c.org_id = v_org AND c.scope_kind = 'personal' AND c.scope_id = v_user
         AND c.revoked_at IS NULL AND c.status IN ('proposed', 'reviewed', 'accepted', 'contested')
       ORDER BY c.created_at DESC, c.id LIMIT greatest(p_limit, 0)
    )
    SELECT jsonb_build_object(
      'claims', (SELECT coalesce(jsonb_agg(jsonb_build_object(
                   'id', c.id, 'kind', coalesce(c.claim_kind, 'fact'), 'statement', c.statement, 'status', c.status,
                   'reviewed', c.reviewed_by IS NOT NULL, 'createdAt', c.created_at,
                   'about', (SELECT coalesce(jsonb_agg(DISTINCT e.dst_id), '[]'::jsonb) FROM public.ontology_edges e
                              WHERE e.org_id = v_org AND e.src_kind = 'claim' AND e.src_id = c.id AND e.dst_kind = 'object'
                                AND e.relation = 'about' AND e.status = 'active')) ORDER BY c.id), '[]'::jsonb) FROM cand c),
      'objects', (SELECT coalesce(jsonb_agg(jsonb_build_object(
                   'id', o.id, 'kind', o.object_kind, 'name', o.name, 'aliases', to_jsonb(o.aliases), 'createdAt', o.created_at) ORDER BY o.id), '[]'::jsonb)
                    FROM public.ontology_objects o
                   WHERE o.org_id = v_org AND o.scope_kind = 'personal' AND o.scope_id = v_user AND o.merged_into IS NULL),
      'similar', (SELECT coalesce(jsonb_agg(jsonb_build_object('a', x.a, 'b', x.b, 'cosine', x.cosine) ORDER BY x.a, x.b), '[]'::jsonb)
                    FROM (SELECT DISTINCT ON (a.id, b.id) a.id AS a, b.id AS b, 1 - (ea.embedding <=> eb.embedding) AS cosine
                            FROM cand a JOIN cand b ON a.id < b.id AND coalesce(a.claim_kind, 'fact') = coalesce(b.claim_kind, 'fact')
                            JOIN public.object_embeddings ea ON ea.org_id = v_org AND ea.target_kind = 'claim' AND ea.target_id = a.id
                            JOIN public.object_embeddings eb ON eb.org_id = v_org AND eb.target_kind = 'claim' AND eb.target_id = b.id
                                                            AND eb.model = ea.model AND eb.model_version = ea.model_version
                           WHERE 1 - (ea.embedding <=> eb.embedding) >= 0.85
                           ORDER BY a.id, b.id, 1 - (ea.embedding <=> eb.embedding) DESC) x)
    )
  );
END
$$;

-- ─────────────────────────────── 开一次运行 ───────────────────────────────
CREATE OR REPLACE FUNCTION kg_consolidation_begin(p_run text, p_user text) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_org  text := current_setting('app.current_org', true);
  v_user text := public.kg_consolidation_actor(p_user);
BEGIN
  IF NOT public.kernel_org_is_writable(v_org) THEN
    RAISE EXCEPTION 'KG_ORG_FROZEN: organization % is read-only', v_org USING ERRCODE = '42501';
  END IF;
  INSERT INTO public.kg_consolidation_runs (id, org_id, user_id) VALUES (p_run, v_org, v_user);
  RETURN p_run;
END
$$;

CREATE OR REPLACE FUNCTION kg_consolidation_next_ordinal(p_run text) RETURNS integer
LANGUAGE sql STABLE SET search_path = pg_catalog, public, pg_temp
AS $$ SELECT coalesce(max(ordinal) + 1, 0) FROM public.kg_consolidation_changes WHERE run_id = p_run $$;

-- ─────────────────────────────── 合并（结论去重 + 实体合一），一个事务、本人个人空间锁 ───────────────────────────────
-- p = { run_id, user_id, entity_merges: [{keep, merge}], claim_merges: [{keep, merge, basis, score}] }
-- 每一对在锁下复核（两边都还活着、都在本人空间、同类型）；不过的静默跳过。返回实际落下的条数。
CREATE OR REPLACE FUNCTION kg_consolidation_apply_merges(p jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_org   text := current_setting('app.current_org', true);
  v_run   text := p->>'run_id';
  v_user  text := public.kg_consolidation_actor(p->>'user_id');
  v_item  jsonb;
  v_keep  record;
  v_other record;
  v_id    text;
  v_ord   integer;
  v_edges_inv text[];
  v_edges_add text[];
  v_ev    jsonb;
  v_seg   jsonb;
  v_dst   text[];
  v_src   text[];
  v_n_claims  integer := 0;
  v_n_objects integer := 0;
  v_ids   jsonb := '[]'::jsonb;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM kg_consolidation_runs r WHERE r.id = v_run AND r.org_id = v_org AND r.user_id = v_user AND r.status = 'applied') THEN
    RAISE EXCEPTION 'KG_CONSOLIDATION_RUN_NOT_FOUND' USING ERRCODE = '23503';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('kg_scope:' || v_org || '|personal|' || v_user));

  -- ① 实体合一（先做：结论的 about 边随之指向保留方）
  FOR v_item IN SELECT * FROM jsonb_array_elements(coalesce(p->'entity_merges', '[]'::jsonb)) LOOP
    CONTINUE WHEN v_item->>'keep' IS NULL OR v_item->>'merge' IS NULL OR v_item->>'keep' = v_item->>'merge';
    SELECT * INTO v_keep FROM ontology_objects WHERE org_id = v_org AND id = v_item->>'keep' FOR UPDATE;
    CONTINUE WHEN NOT FOUND;
    SELECT * INTO v_other FROM ontology_objects WHERE org_id = v_org AND id = v_item->>'merge' FOR UPDATE;
    CONTINUE WHEN NOT FOUND;
    CONTINUE WHEN v_keep.scope_kind <> 'personal' OR v_keep.scope_id <> v_user OR v_keep.merged_into IS NOT NULL
               OR v_other.scope_kind <> 'personal' OR v_other.scope_id <> v_user OR v_other.merged_into IS NOT NULL
               OR v_keep.object_kind <> v_other.object_kind;
    v_ord := kg_consolidation_next_ordinal(v_run);
    v_id := v_run || '-' || v_ord;
    WITH u AS (UPDATE ontology_edges SET dst_id = v_keep.id
                WHERE org_id = v_org AND scope_kind = 'personal' AND scope_id = v_user AND dst_kind = 'object' AND dst_id = v_other.id
                RETURNING id)
    SELECT coalesce(array_agg(id ORDER BY id), '{}') INTO v_dst FROM u;
    WITH u AS (UPDATE ontology_edges SET src_id = v_keep.id
                WHERE org_id = v_org AND scope_kind = 'personal' AND scope_id = v_user AND src_kind = 'object' AND src_id = v_other.id
                RETURNING id)
    SELECT coalesce(array_agg(id ORDER BY id), '{}') INTO v_src FROM u;
    UPDATE ontology_objects k
       SET aliases = coalesce((SELECT array_agg(DISTINCT a ORDER BY a) FROM unnest(v_keep.aliases || v_other.name || v_other.aliases) a
                                WHERE a <> v_keep.name), '{}'), updated_at = now()
     WHERE k.org_id = v_org AND k.id = v_keep.id;
    UPDATE ontology_objects SET merged_into = v_keep.id, updated_at = now() WHERE org_id = v_org AND id = v_other.id;
    INSERT INTO kg_consolidation_changes (id, run_id, org_id, user_id, ordinal, kind, kept_id, other_id, basis, score, restore)
    VALUES (v_id, v_run, v_org, v_user, v_ord, 'entity_merge', v_keep.id, v_other.id, 'name', 1,
            jsonb_build_object('keep_aliases_before', to_jsonb(v_keep.aliases),
                               'keep_aliases_after', (SELECT to_jsonb(aliases) FROM ontology_objects WHERE org_id = v_org AND id = v_keep.id),
                               'dst_edges', to_jsonb(v_dst), 'src_edges', to_jsonb(v_src),
                               'kept_name', v_keep.name, 'other_name', v_other.name));
    v_n_objects := v_n_objects + 1;
  END LOOP;

  -- ② 结论去重：other 的来源全部复制到 keep，other 软失效
  FOR v_item IN SELECT * FROM jsonb_array_elements(coalesce(p->'claim_merges', '[]'::jsonb)) LOOP
    CONTINUE WHEN v_item->>'keep' IS NULL OR v_item->>'merge' IS NULL OR v_item->>'keep' = v_item->>'merge';
    -- 按 id 顺序上锁，两个并发的整合（不会有：同一把个人空间锁）之外，也与执行器的行锁顺序一致
    PERFORM 1 FROM claims WHERE org_id = v_org AND id IN (v_item->>'keep', v_item->>'merge') ORDER BY id FOR UPDATE;
    SELECT * INTO v_keep FROM claims WHERE org_id = v_org AND id = v_item->>'keep';
    CONTINUE WHEN NOT FOUND;
    SELECT * INTO v_other FROM claims WHERE org_id = v_org AND id = v_item->>'merge';
    CONTINUE WHEN NOT FOUND;
    CONTINUE WHEN v_keep.scope_kind IS DISTINCT FROM 'personal' OR v_keep.scope_id IS DISTINCT FROM v_user
               OR v_other.scope_kind IS DISTINCT FROM 'personal' OR v_other.scope_id IS DISTINCT FROM v_user
               OR v_keep.revoked_at IS NOT NULL OR v_other.revoked_at IS NOT NULL
               OR v_keep.status NOT IN ('proposed', 'reviewed', 'accepted') OR v_other.status NOT IN ('proposed', 'reviewed', 'accepted')
               OR coalesce(v_keep.claim_kind, 'fact') <> coalesce(v_other.claim_kind, 'fact');
    v_ord := kg_consolidation_next_ordinal(v_run);
    v_id := v_run || '-' || v_ord;
    -- 来源：消息证据
    WITH ins AS (
      INSERT INTO claim_message_evidence (claim_id, org_id, message_id, stance, excerpt, created_at)
      SELECT v_keep.id, v_org, e.message_id, e.stance, e.excerpt, e.created_at FROM claim_message_evidence e
       WHERE e.org_id = v_org AND e.claim_id = v_other.id
      ON CONFLICT DO NOTHING RETURNING message_id, stance)
    SELECT coalesce(jsonb_agg(jsonb_build_object('message_id', message_id, 'stance', stance)), '[]'::jsonb) INTO v_ev FROM ins;
    -- 来源：附件证据
    WITH ins AS (
      INSERT INTO claim_segments (claim_id, org_id, segment_id, stance)
      SELECT v_keep.id, v_org, s.segment_id, s.stance FROM claim_segments s WHERE s.org_id = v_org AND s.claim_id = v_other.id
      ON CONFLICT DO NOTHING RETURNING segment_id, stance)
    SELECT coalesce(jsonb_agg(jsonb_build_object('segment_id', segment_id, 'stance', stance)), '[]'::jsonb) INTO v_seg FROM ins;
    -- 来源：derived_from（来自哪条会话结论）与 about（涉及哪个实体）边——keep 上还没有同样的活边才补
    WITH ins AS (
      INSERT INTO ontology_edges (id, org_id, src_kind, src_id, dst_kind, dst_id, relation, created_by, scope_kind, scope_id)
      SELECT v_id || '-e' || row_number() OVER (ORDER BY e.id), v_org, 'claim', v_keep.id, e.dst_kind, e.dst_id, e.relation,
             e.created_by, 'personal', v_user
        FROM ontology_edges e
       WHERE e.org_id = v_org AND e.src_kind = 'claim' AND e.src_id = v_other.id AND e.status = 'active'
         AND e.relation IN ('derived_from', 'about')
         AND NOT EXISTS (SELECT 1 FROM ontology_edges k
                          WHERE k.org_id = v_org AND k.src_kind = 'claim' AND k.src_id = v_keep.id AND k.status = 'active'
                            AND k.relation = e.relation AND k.dst_kind = e.dst_kind AND k.dst_id = e.dst_id)
      RETURNING id)
    SELECT coalesce(array_agg(id ORDER BY id), '{}') INTO v_edges_add FROM ins;
    -- other 自己的活边：F07 的级联会收掉它们，撤销时要放回来
    SELECT coalesce(array_agg(e.id ORDER BY e.id), '{}') INTO v_edges_inv FROM ontology_edges e
     WHERE e.org_id = v_org AND e.status = 'active'
       AND ((e.src_kind = 'claim' AND e.src_id = v_other.id) OR (e.dst_kind = 'claim' AND e.dst_id = v_other.id));
    UPDATE claims SET status = 'superseded', revoked_at = now(), revocation_reason = 'consolidated_duplicate', updated_at = now()
     WHERE org_id = v_org AND id = v_other.id;
    INSERT INTO kg_consolidation_changes (id, run_id, org_id, user_id, ordinal, kind, kept_id, other_id, basis, score, restore)
    VALUES (v_id, v_run, v_org, v_user, v_ord, 'claim_merge', v_keep.id, v_other.id, v_item->>'basis',
            nullif(v_item->>'score', '')::real,
            jsonb_build_object('other_status', v_other.status, 'evidence_added', v_ev, 'segments_added', v_seg,
                               'edges_added', to_jsonb(v_edges_add), 'edges_invalidated', to_jsonb(v_edges_inv)));
    v_ids := v_ids || jsonb_build_array(jsonb_build_object('id', v_keep.id), jsonb_build_object('id', v_other.id));
    v_n_claims := v_n_claims + 1;
  END LOOP;

  IF v_n_claims + v_n_objects > 0 THEN
    UPDATE kg_consolidation_runs SET claim_merges = claim_merges + v_n_claims, entity_merges = entity_merges + v_n_objects
     WHERE id = v_run;
    INSERT INTO ontology_actions (id, org_id, scope_kind, scope_id, actor_kind, actor_id, action_type, payload, outcome)
    VALUES (v_run || '-merge', v_org, 'personal', v_user, 'system', 'kg-consolidator', 'consolidateMemory',
            jsonb_build_object('run_id', v_run, 'claim_merges', v_n_claims, 'entity_merges', v_n_objects, 'claims', v_ids),
            'accepted');
  END IF;
  RETURN jsonb_build_object('claim_merges', v_n_claims, 'entity_merges', v_n_objects);
END
$$;

-- ─────────────────────────────── 矛盾开卡（一对一个事务：会话锁 → 个人空间锁，与 F16 同一顺序） ───────────────────────────────
-- p = { run_id, user_id, newer, older }（两条都是本人个人记忆；newer 较新）。
-- 返回 'opened' | 'unsurfaced'（新的那条在本人个人对话里找不到活的来源）| 'skipped'（复核不过 / 已提醒过）。
CREATE OR REPLACE FUNCTION kg_consolidation_open_conflict(p jsonb) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_org    text := current_setting('app.current_org', true);
  v_run    text := p->>'run_id';
  v_user   text := public.kg_consolidation_actor(p->>'user_id');
  v_newer  record;
  v_older  record;
  v_src    record;
  v_msg    text;
  v_key    text;
  v_id     text;
  v_ord    integer;
  v_had_ev boolean;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM kg_consolidation_runs r WHERE r.id = v_run AND r.org_id = v_org AND r.user_id = v_user AND r.status = 'applied') THEN
    RAISE EXCEPTION 'KG_CONSOLIDATION_RUN_NOT_FOUND' USING ERRCODE = '23503';
  END IF;
  -- 新说法在本人个人对话（本人创建、非项目）里的来源结论：活的、由它而来（活的 derived_from 边），取最近的一条；
  -- 以及那条来源结论在那个会话里的原话消息（卡挂在它那一轮下面）。
  SELECT s.id, s.scope_id AS thread_id, s.statement INTO v_src
    FROM ontology_edges d
    JOIN claims s ON s.org_id = d.org_id AND s.id = d.dst_id
    JOIN chat_threads t ON t.org_id = s.org_id AND t.id = s.scope_id
   WHERE d.org_id = v_org AND d.src_kind = 'claim' AND d.src_id = p->>'newer' AND d.relation = 'derived_from'
     AND d.dst_kind = 'claim' AND d.status = 'active'
     AND s.scope_kind = 'chat_session' AND s.revoked_at IS NULL AND s.status IN ('proposed', 'reviewed', 'accepted')
     AND t.created_by = v_user AND t.project_id IS NULL
   ORDER BY s.created_at DESC, s.id DESC LIMIT 1;
  IF NOT FOUND THEN
    UPDATE kg_consolidation_runs SET conflicts_unsurfaced = conflicts_unsurfaced + 1 WHERE id = v_run;
    RETURN 'unsurfaced';
  END IF;
  SELECT e.message_id INTO v_msg FROM claim_message_evidence e JOIN chat_messages m ON m.id = e.message_id AND m.org_id = e.org_id
   WHERE e.org_id = v_org AND e.claim_id = v_src.id AND e.stance = 'supporting' AND m.thread_id = v_src.thread_id
   ORDER BY m.created_at DESC, m.id DESC LIMIT 1;
  IF v_msg IS NULL THEN
    UPDATE kg_consolidation_runs SET conflicts_unsurfaced = conflicts_unsurfaced + 1 WHERE id = v_run;
    RETURN 'unsurfaced';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('kg_scope:' || v_org || '|chat_session|' || v_src.thread_id));
  PERFORM pg_advisory_xact_lock(hashtext('kg_scope:' || v_org || '|personal|' || v_user));
  PERFORM 1 FROM claims WHERE org_id = v_org AND id IN (v_src.id, p->>'older', p->>'newer') ORDER BY id FOR UPDATE;
  SELECT * INTO v_newer FROM claims WHERE org_id = v_org AND id = v_src.id;
  IF NOT FOUND THEN RETURN 'skipped'; END IF;
  SELECT * INTO v_older FROM claims WHERE org_id = v_org AND id = p->>'older';
  IF NOT FOUND THEN RETURN 'skipped'; END IF;
  IF v_older.scope_kind IS DISTINCT FROM 'personal' OR v_older.scope_id IS DISTINCT FROM v_user
     OR v_older.revoked_at IS NOT NULL OR v_older.status NOT IN ('proposed', 'reviewed', 'accepted')
     OR v_newer.revoked_at IS NOT NULL OR v_newer.status NOT IN ('proposed', 'reviewed', 'accepted')
     OR NOT EXISTS (SELECT 1 FROM claims n WHERE n.org_id = v_org AND n.id = p->>'newer' AND n.scope_kind = 'personal'
                     AND n.scope_id = v_user AND n.revoked_at IS NULL AND n.status IN ('proposed', 'reviewed', 'accepted')) THEN
    RETURN 'skipped';
  END IF;
  v_key := kg_conflict_statement_key(v_newer.statement);
  -- I-19：同一旧条、同样说法已经提醒过（开着 / 忽略 / 两条都留）⇒ 不再提醒；这一对已有卡 ⇒ 不重复开
  IF EXISTS (SELECT 1 FROM kg_conflict_prompts x WHERE x.org_id = v_org AND x.older_claim_id = v_older.id AND x.newer_key = v_key
                AND x.status IN ('open', 'ignored', 'kept_both'))
     OR EXISTS (SELECT 1 FROM kg_conflict_prompts x WHERE x.org_id = v_org AND x.older_claim_id = v_older.id AND x.newer_claim_id = v_newer.id) THEN
    RETURN 'skipped';
  END IF;

  v_ord := kg_consolidation_next_ordinal(v_run);
  v_id := v_run || '-' || v_ord;
  v_had_ev := EXISTS (SELECT 1 FROM claim_message_evidence e WHERE e.org_id = v_org AND e.claim_id = v_older.id
                         AND e.message_id = v_msg AND e.stance = 'contradicting');
  UPDATE claims SET status = 'contested', updated_at = now() WHERE org_id = v_org AND id IN (v_newer.id, v_older.id);
  IF NOT v_had_ev THEN
    PERFORM kg_insert_claim_evidence(v_org, 'personal', v_user, v_older.id,
      jsonb_build_object('message_id', v_msg, 'stance', 'contradicting', 'excerpt', ''));
  END IF;
  INSERT INTO kg_conflict_prompts (id, org_id, thread_id, message_id, newer_claim_id, older_claim_id, newer_key, rank, detected_by_action_id, kind)
  VALUES (v_id, v_org, v_src.thread_id, v_msg, v_newer.id, v_older.id, v_key, 0, v_run || '-c' || v_ord, 'conflict');
  INSERT INTO kg_consolidation_changes (id, run_id, org_id, user_id, ordinal, kind, kept_id, other_id, basis, score, restore)
  VALUES (v_id, v_run, v_org, v_user, v_ord, 'conflict_opened', v_older.id, v_newer.id, 'conflict', 1,
          jsonb_build_object('prompt_id', v_id, 'thread_id', v_src.thread_id, 'message_id', v_msg, 'newer_personal', p->>'newer',
                             'newer_status', v_newer.status, 'older_status', v_older.status, 'evidence_added', NOT v_had_ev));
  UPDATE kg_consolidation_runs SET conflicts = conflicts + 1 WHERE id = v_run;
  -- 审计：会话侧一条（revision 前进，同 F16），个人空间一条
  INSERT INTO ontology_actions (id, org_id, scope_kind, scope_id, actor_kind, actor_id, action_type, payload, source_ref, outcome)
  VALUES (v_run || '-c' || v_ord, v_org, 'chat_session', v_src.thread_id, 'system', 'kg-consolidator', 'detectConflict',
          jsonb_build_object('message_id', v_msg, 'prompts', 1, 'via', 'consolidation', 'claims', jsonb_build_array(jsonb_build_object('id', v_newer.id))),
          v_msg, 'accepted');
  INSERT INTO ontology_actions (id, org_id, scope_kind, scope_id, actor_kind, actor_id, action_type, payload, source_ref, outcome)
  VALUES (v_run || '-c' || v_ord || '-l1', v_org, 'personal', v_user, 'system', 'kg-consolidator', 'consolidateMemory',
          jsonb_build_object('run_id', v_run, 'conflict_prompt', v_id, 'claims', jsonb_build_array(jsonb_build_object('id', v_older.id))),
          v_msg, 'accepted');
  RETURN 'opened';
END
$$;

-- 收尾：记下结束时间（待整合判定按它比「之后有没有新的 / 改过的」——本次合并自己改动的 updated_at 不算新东西）。
-- 一处改动都没有的运行也留一行（计数全 0）：否则「从来没有可合的」人每一轮都会被重新选中；列表读口不展示空运行。
CREATE OR REPLACE FUNCTION kg_consolidation_finish(p_run text, p_user text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_org  text := current_setting('app.current_org', true);
  v_user text := public.kg_consolidation_actor(p_user);
BEGIN
  UPDATE kg_consolidation_runs SET finished_at = now() WHERE id = p_run AND org_id = v_org AND user_id = v_user;
  RETURN EXISTS (SELECT 1 FROM kg_consolidation_changes c WHERE c.run_id = p_run AND c.org_id = v_org);
END
$$;

-- ─────────────────────────────── 撤销（人的动作，只有本人） ───────────────────────────────
CREATE OR REPLACE FUNCTION kg_consolidation_undo(p_run text, p_action_id text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_org   text := current_setting('app.current_org', true);
  v_user  text := nullif(current_setting('app.current_user_id', true), '');
  v_run   record;
  v_ch    record;
  v_note  text;
  v_keep  record;
  v_other record;
  v_r     jsonb;
  v_thread text;
  v_done  integer := 0;
  v_skip  integer := 0;
  v_ids   jsonb := '[]'::jsonb;
BEGIN
  IF v_org IS NULL OR v_org = '' THEN RAISE EXCEPTION 'KG_NO_TENANT' USING ERRCODE = '42501'; END IF;
  IF v_user IS NULL THEN RAISE EXCEPTION 'KG_ACTOR_NOT_HUMAN' USING ERRCODE = '42501'; END IF;
  IF NOT public.kernel_org_is_writable(v_org) THEN
    RAISE EXCEPTION 'KG_ORG_FROZEN: organization % is read-only', v_org USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_run FROM kg_consolidation_runs r WHERE r.id = p_run AND r.org_id = v_org AND r.user_id = v_user FOR UPDATE;
  IF NOT FOUND OR v_run.status = 'undone' THEN
    RAISE EXCEPTION 'KG_CONSOLIDATION_RUN_NOT_FOUND' USING ERRCODE = '23503';
  END IF;
  -- 锁顺序：涉及的会话锁（按 id）→ 个人空间锁，与 F16 / 开卡同一顺序
  FOR v_thread IN SELECT DISTINCT c.restore->>'thread_id' FROM kg_consolidation_changes c
                   WHERE c.run_id = p_run AND c.kind = 'conflict_opened' AND c.status = 'applied' ORDER BY 1 LOOP
    PERFORM pg_advisory_xact_lock(hashtext('kg_scope:' || v_org || '|chat_session|' || v_thread));
  END LOOP;
  PERFORM pg_advisory_xact_lock(hashtext('kg_scope:' || v_org || '|personal|' || v_user));

  FOR v_ch IN SELECT * FROM kg_consolidation_changes c WHERE c.run_id = p_run AND c.org_id = v_org AND c.status = 'applied'
               ORDER BY c.ordinal DESC FOR UPDATE LOOP
    v_note := NULL;
    v_r := v_ch.restore;
    IF v_ch.kind = 'conflict_opened' THEN
      IF NOT EXISTS (SELECT 1 FROM kg_conflict_prompts x WHERE x.org_id = v_org AND x.id = v_r->>'prompt_id' AND x.status = 'open') THEN
        v_note := '这张冲突卡已经处理过（或已随记忆改动结束），不再撤回';
      ELSE
        DELETE FROM kg_conflict_prompts WHERE org_id = v_org AND id = v_r->>'prompt_id';
        IF (v_r->>'evidence_added')::boolean THEN
          DELETE FROM claim_message_evidence
           WHERE org_id = v_org AND claim_id = v_ch.kept_id AND message_id = v_r->>'message_id' AND stance = 'contradicting';
        END IF;
        -- 两条放回开卡之前的状态（只在它们仍是「有矛盾」、且没有别的未了结冲突时）
        UPDATE claims c SET status = CASE c.id WHEN v_ch.kept_id THEN v_r->>'older_status' ELSE v_r->>'newer_status' END, updated_at = now()
         WHERE c.org_id = v_org AND c.id IN (v_ch.kept_id, v_ch.other_id) AND c.status = 'contested' AND c.revoked_at IS NULL
           AND NOT EXISTS (SELECT 1 FROM kg_conflict_prompts x WHERE x.org_id = v_org AND x.status = 'open'
                            AND (x.newer_claim_id = c.id OR x.older_claim_id = c.id));
      END IF;
    ELSIF v_ch.kind = 'entity_merge' THEN
      SELECT * INTO v_other FROM ontology_objects WHERE org_id = v_org AND id = v_ch.other_id FOR UPDATE;
      IF NOT FOUND OR v_other.merged_into IS DISTINCT FROM v_ch.kept_id THEN
        v_note := '这个实体之后又被改动过，不再拆回';
      ELSE
        UPDATE ontology_objects SET merged_into = NULL, updated_at = now() WHERE org_id = v_org AND id = v_ch.other_id;
        UPDATE ontology_edges SET dst_id = v_ch.other_id
         WHERE org_id = v_org AND id IN (SELECT jsonb_array_elements_text(v_r->'dst_edges')) AND dst_kind = 'object' AND dst_id = v_ch.kept_id;
        UPDATE ontology_edges SET src_id = v_ch.other_id
         WHERE org_id = v_org AND id IN (SELECT jsonb_array_elements_text(v_r->'src_edges')) AND src_kind = 'object' AND src_id = v_ch.kept_id;
        UPDATE ontology_objects SET aliases = ARRAY(SELECT jsonb_array_elements_text(v_r->'keep_aliases_before')), updated_at = now()
         WHERE org_id = v_org AND id = v_ch.kept_id AND to_jsonb(aliases) = v_r->'keep_aliases_after';
      END IF;
    ELSE  -- claim_merge
      PERFORM 1 FROM claims WHERE org_id = v_org AND id IN (v_ch.kept_id, v_ch.other_id) ORDER BY id FOR UPDATE;
      SELECT * INTO v_other FROM claims WHERE org_id = v_org AND id = v_ch.other_id;
      IF NOT FOUND OR v_other.revoked_at IS NULL OR v_other.revocation_reason IS DISTINCT FROM 'consolidated_duplicate' THEN
        v_note := '被合掉的那条之后又被改动过，不再恢复';
      ELSE
        -- 先恢复被合掉的那条（它自己的证据还在），再撤掉复制到保留方的来源：保留方不会因为少了复制来的证据而失去支撑
        UPDATE claims SET status = v_r->>'other_status', revoked_at = NULL, revocation_reason = NULL, updated_at = now()
         WHERE org_id = v_org AND id = v_ch.other_id;
        -- 它自己的边：另一端还活着才放回
        UPDATE ontology_edges e SET status = 'active', invalidated_at = NULL
         WHERE e.org_id = v_org AND e.status = 'invalidated' AND e.id IN (SELECT jsonb_array_elements_text(v_r->'edges_invalidated'))
           AND (e.dst_kind <> 'claim' OR e.dst_id = v_ch.other_id
                OR EXISTS (SELECT 1 FROM claims x WHERE x.org_id = v_org AND x.id = e.dst_id AND x.revoked_at IS NULL))
           AND (e.src_kind <> 'claim' OR e.src_id = v_ch.other_id
                OR EXISTS (SELECT 1 FROM claims x WHERE x.org_id = v_org AND x.id = e.src_id AND x.revoked_at IS NULL))
           AND (e.dst_kind <> 'object' OR EXISTS (SELECT 1 FROM ontology_objects o WHERE o.org_id = v_org AND o.id = e.dst_id AND o.merged_into IS NULL));
        DELETE FROM ontology_edges WHERE org_id = v_org AND id IN (SELECT jsonb_array_elements_text(v_r->'edges_added'));
        IF EXISTS (SELECT 1 FROM claims k WHERE k.org_id = v_org AND k.id = v_ch.kept_id) THEN
          DELETE FROM claim_message_evidence e
           WHERE e.org_id = v_org AND e.claim_id = v_ch.kept_id
             AND (e.message_id, e.stance) IN (SELECT x->>'message_id', x->>'stance' FROM jsonb_array_elements(v_r->'evidence_added') x);
          DELETE FROM claim_segments s
           WHERE s.org_id = v_org AND s.claim_id = v_ch.kept_id
             AND (s.segment_id, s.stance) IN (SELECT x->>'segment_id', x->>'stance' FROM jsonb_array_elements(v_r->'segments_added') x);
        END IF;
      END IF;
    END IF;
    IF v_note IS NULL THEN
      UPDATE kg_consolidation_changes SET status = 'undone' WHERE id = v_ch.id;
      v_done := v_done + 1;
      v_ids := v_ids || jsonb_build_array(jsonb_build_object('id', v_ch.kept_id), jsonb_build_object('id', v_ch.other_id));
    ELSE
      UPDATE kg_consolidation_changes SET status = 'undo_skipped', undo_note = v_note WHERE id = v_ch.id;
      v_skip := v_skip + 1;
    END IF;
  END LOOP;

  UPDATE kg_consolidation_runs SET status = CASE WHEN v_skip = 0 THEN 'undone' ELSE 'partially_undone' END,
         undone_at = now(), undone_by = v_user
   WHERE id = p_run;
  INSERT INTO ontology_actions (id, org_id, scope_kind, scope_id, actor_kind, actor_id, action_type, payload, outcome)
  VALUES (p_action_id, v_org, 'personal', v_user, 'human', v_user, 'undoConsolidation',
          jsonb_build_object('run_id', p_run, 'undone', v_done, 'skipped', v_skip, 'claims', v_ids), 'accepted');
  RETURN jsonb_build_object('undone', v_done, 'skipped', v_skip);
END
$$;

-- ─────────────────────────────── 本人的整合记录（读，只有本人） ───────────────────────────────
-- 最近 p_limit 次有改动的运行，每处改动带两边的文字（本人个人空间的结论 / 实体名；卡上的会话结论来自本人个人对话）。
CREATE OR REPLACE FUNCTION kg_consolidation_list(p_limit integer) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_org  text := current_setting('app.current_org', true);
  v_user text := nullif(current_setting('app.current_user_id', true), '');
BEGIN
  IF v_org IS NULL OR v_org = '' THEN RAISE EXCEPTION 'KG_NO_TENANT' USING ERRCODE = '42501'; END IF;
  IF v_user IS NULL THEN RETURN '[]'::jsonb; END IF;
  RETURN (
    SELECT coalesce(jsonb_agg(jsonb_build_object(
             'runId', r.id, 'createdAt', r.created_at, 'status', r.status, 'undoneAt', r.undone_at,
             'conflictsUnsurfaced', r.conflicts_unsurfaced,
             'changes', (SELECT coalesce(jsonb_agg(jsonb_build_object(
                           'changeId', c.id, 'kind', c.kind, 'status', c.status, 'undoNote', c.undo_note, 'basis', c.basis,
                           'keptId', c.kept_id, 'otherId', c.other_id,
                           'keptText', CASE WHEN c.kind = 'entity_merge' THEN c.restore->>'kept_name'
                                            ELSE (SELECT k.statement FROM claims k WHERE k.org_id = v_org AND k.id = c.kept_id
                                                    AND k.scope_kind = 'personal' AND k.scope_id = v_user) END,
                           'otherText', CASE WHEN c.kind = 'entity_merge' THEN c.restore->>'other_name'
                                             WHEN c.kind = 'conflict_opened' THEN
                                               (SELECT k.statement FROM claims k WHERE k.org_id = v_org AND k.id = c.restore->>'newer_personal'
                                                   AND k.scope_kind = 'personal' AND k.scope_id = v_user)
                                             ELSE (SELECT k.statement FROM claims k WHERE k.org_id = v_org AND k.id = c.other_id
                                                     AND k.scope_kind = 'personal' AND k.scope_id = v_user) END,
                           'threadId', c.restore->>'thread_id') ORDER BY c.ordinal), '[]'::jsonb)
                           FROM kg_consolidation_changes c WHERE c.run_id = r.id AND c.org_id = v_org)
           ) ORDER BY r.created_at DESC, r.id DESC), '[]'::jsonb)
      FROM (SELECT * FROM kg_consolidation_runs r
             WHERE r.org_id = v_org AND r.user_id = v_user AND (r.claim_merges + r.entity_merges + r.conflicts) > 0
             ORDER BY r.created_at DESC, r.id DESC LIMIT greatest(p_limit, 0)) r
  );
END
$$;

-- ─────────────────────────────── 抽取 SLO：全库现数（只回数字） ───────────────────────────────
CREATE OR REPLACE FUNCTION kg_extraction_slo_counts(p_lease_seconds integer, p_max_attempts integer)
RETURNS TABLE (stuck_leases bigint, dead_letters bigint, backlog bigint, oldest_pending_seconds bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT count(*) FILTER (WHERE q.locked_at IS NOT NULL AND q.locked_at < now() - make_interval(secs => p_lease_seconds)
                            AND q.attempts < p_max_attempts),
         count(*) FILTER (WHERE q.attempts >= p_max_attempts),
         count(*) FILTER (WHERE q.attempts < p_max_attempts),
         coalesce(extract(epoch FROM now() - min(q.enqueued_at) FILTER (WHERE q.attempts < p_max_attempts))::bigint, 0)
    FROM public.kg_extraction_queue q
$$;

REVOKE ALL ON FUNCTION kg_consolidation_pending_users(integer), kg_consolidation_actor(text),
  kg_consolidation_candidates(text, integer), kg_consolidation_begin(text, text), kg_consolidation_next_ordinal(text),
  kg_consolidation_apply_merges(jsonb), kg_consolidation_open_conflict(jsonb), kg_consolidation_finish(text, text),
  kg_consolidation_undo(text, text), kg_consolidation_list(integer), kg_extraction_slo_counts(integer, integer) FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_rw') THEN
    GRANT EXECUTE ON FUNCTION kg_consolidation_set_enabled(boolean), kg_consolidation_pending_users(integer),
      kg_consolidation_candidates(text, integer), kg_consolidation_begin(text, text),
      kg_consolidation_apply_merges(jsonb), kg_consolidation_open_conflict(jsonb), kg_consolidation_finish(text, text),
      kg_consolidation_undo(text, text), kg_consolidation_list(integer), kg_extraction_slo_counts(integer, integer) TO app_rw;
  END IF;
END
$$;

SELECT kernel_apply_org_freeze_policies();

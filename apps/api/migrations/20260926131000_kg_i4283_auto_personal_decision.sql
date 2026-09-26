/*
 * issue #4283（人类决定，2026-09-26）—— 本人说出的「决定」自动记进**说话人自己的**个人空间（可撤销）。
 *
 * ## 为什么要一条新的数据库路径（而不是复用 F11 `kg_promote_claim`）
 *
 * F11 的晋升是人的动作：要求已登录的会话所有者（KG_ACTOR_NOT_HUMAN / KG_NOT_OWNER）、只限个人线程，
 * 并在同一事务里把原结论转 accepted（I-9 / U-3）。F03 `kg_apply_batch` 写个人空间要求 scope_id = 登录用户（I-14）。
 * 抽取 worker 是系统身份、没有登录用户，所以两条既有路径都（正确地）拒绝它。人类决定要的恰恰是
 * 「不点晋升也记下，但仍是『AI 记下的』」，这与 I-9「先转 accepted」直接冲突——不能绕过那两道守卫，
 * 只能为下面这**一种**情形开一条最窄的新路：
 *
 *   **一条模型提出（proposed）的会话结论，它的全部支持证据都是同一个人类作者本人在本会话里发的消息
 *   ⇒ 复制一份到这个作者本人的个人空间，仍是 proposed（「AI 记下的」），derived_from 连回原结论。**
 *
 * 「是不是决定类」由应用层 `decisionLike()`（domain/knowledge-graph/decision-claim.ts）判——那份词表是唯一事实源，
 * 这里不复写第二份（AGENTS.md「同一事实不得声明在两处」）。数据库守的是**安全边界**：写进谁的空间只由证据
 * 消息的作者决定，调用方给不出、也改不了目标空间。所以即使应用层判错了决定类，最坏也只是作者本人
 * 空间里多一条他自己说过的话（可一键撤销），绝不会进别人的空间。
 *
 * ## 例外与守卫（相对 phase-18 不变量，domain.md）
 *
 *   - I-3 只经数据库函数写：三个函数都是 SECURITY DEFINER；app_rw 仍对本体表没有写权限（F03 写守卫照旧）。
 *   - I-4 模型上限：副本 created_by = model、status = proposed、reviewed_by 为空；原结论不改状态。
 *   - I-5 证据必达：副本挂上原结论的全部证据；没有支持证据 ⇒ KG_EVIDENCE_REVOKED。
 *   - I-8 晋升是复制：derived_from 边连回 L0；L0 作用域不变。
 *   - **I-9 的例外（本迁移唯一放宽）**：非 accepted 的 L0 可以产生 L1 副本、且不先转 accepted——仅限
 *     「作者本人的话 → 作者本人空间」这一条，由 `kg_auto_copy_eligible` 判定。
 *   - **I-14 的例外（写，不是读）**：系统身份写入某人的个人空间，目标 = 证据消息作者，不取调用方参数；
 *     调用方若声明了登录用户（app.current_user_id），必须就是这个作者（人的请求不能替别人触发）。
 *     读仍只有本人（RLS 不变）。
 *   - 作用域纪律：org 取自 app.current_org，所有查询按 org 限定；个人空间开关走 kg_scope_enabled。
 *   - 被排除：模型 / agent 消息、转写原文（raw_transcript：可能是别人的发言）、可见范围更窄的消息、
 *     带附件片段证据的结论、冲突态（contested）、已经有过本人副本的结论（撤销后重试不会再复制回来）。
 *   - search_path 固定为 pg_catalog, public, pg_temp（pg_temp 最后），不创建任何临时对象。
 *   - 授权只给 app_rw 执行这三个函数（和 kg_promote_claim 同一角色）。
 *
 * ## 撤销（`kg_undo_auto_copy`，人的动作，I-15）
 *
 * 只撤「AI 记下的」那份：调用者本人空间里、由系统自动复制（derived_from 边 created_by = model）、仍是 proposed 的副本。
 *   - 副本只有这一个来源 ⇒ 副本失效（revocation_reason = user_revoked），F07 的级联把它的边一起收掉；
 *   - 副本还有别的活来源（同一决定在别处也说过、合并进来的）⇒ 只摘掉这一个来源（边失效 + 只由它带来的证据），
 *     副本继续由其余来源支撑。
 * 用户确认过（accepted）的不算「AI 记下的」，这里不动（KG_CLAIM_NOT_FOUND），与 F17「撤销只撤这次新建的东西」同一纪律。
 * 原结论被删 / 撤回：F07 `kg_cascade_claim_revocation` / `kg_revoke_unsupported_claim` 原样生效（副本的证据
 * 就是原消息；原结论失效 ⇒ 所有来源都失效的副本一并失效）。
 *
 * ## F11 合并到「AI 记下的」副本
 *
 * 人点「记到我的长期记忆」本身就是确认（U-3）。自动副本存在后，同一句话再手动晋升会被去重判为 duplicate、
 * 合并进这份 proposed 副本——`kg_promote_claim` 的 merge 分支原来不改目标状态，于是人点了晋升、副本却仍是
 * 「AI 记下的」。这里重建 `kg_promote_claim`，唯一改动：merge 目标若是 proposed / reviewed，同一动作里以晋升人身份转 accepted。
 */

-- ─────────────────────────────── 资格判定 ───────────────────────────────
-- 这条会话结论的支持证据是否**全部**来自 p_author 本人在本会话里发的人类消息（至少一条），且没有附件片段证据。
CREATE OR REPLACE FUNCTION kg_auto_copy_eligible(p_org text, p_claim text, p_author text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.claims c
     WHERE c.org_id = p_org AND c.id = p_claim AND c.scope_kind = 'chat_session'
       AND EXISTS (SELECT 1 FROM public.claim_message_evidence e
                    WHERE e.org_id = p_org AND e.claim_id = c.id AND e.stance = 'supporting')
       AND NOT EXISTS (SELECT 1 FROM public.claim_segments s WHERE s.claim_id = c.id AND s.stance = 'supporting')
       AND NOT EXISTS (
         SELECT 1 FROM public.claim_message_evidence e
           LEFT JOIN public.chat_messages m ON m.id = e.message_id AND m.org_id = e.org_id
          WHERE e.org_id = p_org AND e.claim_id = c.id AND e.stance = 'supporting'
            AND (m.id IS NULL OR m.thread_id IS DISTINCT FROM c.scope_id OR m.author_kind <> 'human'
                 OR m.author_id IS DISTINCT FROM p_author OR m.raw_transcript OR m.visibility_scope IS NOT NULL)))
$$;

-- 一条消息的人类作者（本人发的、不是转写、没有更窄的可见范围、仍是本 org 成员）；否则 NULL。
CREATE OR REPLACE FUNCTION kg_auto_copy_author(p_org text, p_thread text, p_message text) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT m.author_id FROM public.chat_messages m
   WHERE m.org_id = p_org AND m.id = p_message AND m.thread_id = p_thread
     AND m.author_kind = 'human' AND m.author_id IS NOT NULL AND m.raw_transcript = false AND m.visibility_scope IS NULL
     AND EXISTS (SELECT 1 FROM public.org_memberships om WHERE om.org_id = p_org AND om.user_id = m.author_id)
$$;

-- ─────────────────────────────── 候选（系统读，供应用层判决定类 + 去重） ───────────────────────────────
-- 只回：作者 id、这条消息刚抽出的可复制结论（id + 说法）、作者本人个人空间的活结论（id + 说法，去重用）。
-- 与 F16 kg_conflict_candidates 同一性质：系统替作者做派生，内容只交给判定规则，不回任何请求方。
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
    'fresh', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'statement', c.statement) ORDER BY c.created_at, c.id), '[]'::jsonb)
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

-- ─────────────────────────────── 复制（系统写） ───────────────────────────────
-- p: { action_id, thread_id, message_id, claim_id, mode: new|merge, target_claim_id? }。返回个人空间那条的 id。
CREATE OR REPLACE FUNCTION kg_auto_copy_decision(p jsonb) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_org     text := current_setting('app.current_org', true);
  v_caller  text := nullif(current_setting('app.current_user_id', true), '');
  v_thread  text := p->>'thread_id';
  v_claim   text := p->>'claim_id';
  v_id      text := p->>'action_id';
  v_mode    text := coalesce(p->>'mode', 'new');
  v_author  text;
  v_target  text;
  v_src     record;
  v_obj     record;
  v_pobj    text;
  n         int := 0;
BEGIN
  IF v_org IS NULL OR v_org = '' THEN RAISE EXCEPTION 'KG_NO_TENANT' USING ERRCODE = '42501'; END IF;
  IF NOT public.kernel_org_is_writable(v_org) THEN
    RAISE EXCEPTION 'KG_ORG_FROZEN: organization % is read-only', v_org USING ERRCODE = '42501';
  END IF;
  IF NOT public.kg_scope_enabled('personal') THEN
    RAISE EXCEPTION 'KG_SCOPE_NOT_ENABLED: personal' USING ERRCODE = '42501';
  END IF;
  IF v_mode NOT IN ('new', 'merge') THEN RAISE EXCEPTION 'KG_INVALID_ACTION: mode %', v_mode USING ERRCODE = '22023'; END IF;
  -- 目标空间只由证据消息的作者决定（不取调用方参数）。
  v_author := public.kg_auto_copy_author(v_org, v_thread, p->>'message_id');
  IF v_author IS NULL THEN
    RAISE EXCEPTION 'KG_NOT_AUTHOR: message is not a member''s own statement in this thread' USING ERRCODE = '42501';
  END IF;
  IF v_caller IS NOT NULL AND v_caller <> v_author THEN
    RAISE EXCEPTION 'KG_NOT_OWNER: only the author''s own statements go to the author''s own space' USING ERRCODE = '42501';
  END IF;

  -- 锁顺序同 F10 / F11 / F16 / F17：先会话、后个人空间。
  PERFORM pg_advisory_xact_lock(hashtext('kg_scope:' || v_org || '|chat_session|' || v_thread));
  SELECT * INTO v_src FROM claims c
   WHERE c.org_id = v_org AND c.id = v_claim AND c.scope_kind = 'chat_session' AND c.scope_id = v_thread
     AND c.revoked_at IS NULL AND c.status <> 'superseded'
   FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'KG_CLAIM_NOT_FOUND' USING ERRCODE = '23503'; END IF;
  IF v_src.status = 'contested' THEN
    RAISE EXCEPTION 'KG_CONTESTED_NEEDS_RESOLUTION: resolve the conflict before copying' USING ERRCODE = '23514';
  END IF;
  -- 只复制「AI 记下的」（模型提出、还没人看过）：人已经确认过的走 F11 手动晋升。
  IF v_src.created_by <> 'model' OR v_src.status <> 'proposed' THEN
    RAISE EXCEPTION 'KG_CLAIM_NOT_FOUND: not an AI-recorded claim' USING ERRCODE = '23503';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM claim_message_evidence e
                  WHERE e.org_id = v_org AND e.claim_id = v_claim AND e.message_id = p->>'message_id' AND e.stance = 'supporting') THEN
    RAISE EXCEPTION 'KG_EVIDENCE_REVOKED: this message does not support the claim' USING ERRCODE = '23514';
  END IF;
  IF NOT public.kg_auto_copy_eligible(v_org, v_claim, v_author) THEN
    RAISE EXCEPTION 'KG_NOT_AUTHOR: the claim rests on something other than the author''s own words' USING ERRCODE = '42501';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('kg_scope:' || v_org || '|personal|' || v_author));

  -- 幂等：已经复制过（任务重试）⇒ 原样返回那一条；复制过又被撤销 ⇒ 不再复制（KG_CLAIM_NOT_FOUND）。
  SELECT d.src_id INTO v_target FROM ontology_edges d JOIN claims pc ON pc.id = d.src_id AND pc.org_id = d.org_id
   WHERE d.org_id = v_org AND d.relation = 'derived_from' AND d.src_kind = 'claim' AND d.dst_kind = 'claim' AND d.dst_id = v_claim
     AND pc.scope_kind = 'personal' AND pc.scope_id = v_author
   ORDER BY (d.status = 'active' AND pc.revoked_at IS NULL) DESC
   LIMIT 1;
  IF v_target IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM ontology_edges d JOIN claims pc ON pc.id = d.src_id AND pc.org_id = d.org_id
                WHERE d.org_id = v_org AND d.relation = 'derived_from' AND d.src_id = v_target AND d.dst_kind = 'claim'
                  AND d.dst_id = v_claim AND d.status = 'active' AND pc.revoked_at IS NULL) THEN
      RETURN v_target;
    END IF;
    RAISE EXCEPTION 'KG_CLAIM_NOT_FOUND: the personal copy was undone' USING ERRCODE = '23503';
  END IF;

  IF v_mode = 'merge' THEN
    SELECT c.id INTO v_target FROM claims c
     WHERE c.org_id = v_org AND c.id = p->>'target_claim_id' AND c.scope_kind = 'personal' AND c.scope_id = v_author
       AND c.revoked_at IS NULL AND c.status NOT IN ('superseded', 'contested')
     FOR UPDATE;
    IF v_target IS NULL THEN RAISE EXCEPTION 'KG_CLAIM_NOT_FOUND: merge target' USING ERRCODE = '23503'; END IF;
  ELSE
    v_target := v_id || '-p';
    -- I-4：模型产出（系统代记）最高到 proposed，reviewed_by 为空——界面上仍是「AI 记下的」。
    INSERT INTO claims (id, org_id, statement, status, tsv, claim_kind, confidence, created_by, reviewed_by,
                        scope_kind, scope_id, valid_from)
    VALUES (v_target, v_org, v_src.statement, 'proposed', to_tsvector('simple', v_src.statement), v_src.claim_kind,
            v_src.confidence, 'model', NULL, 'personal', v_author, now());
    -- 相关实体在 L1 做实体解析（同 F11）：同名（不分大小写）同类型复用，没有就新建。
    FOR v_obj IN
      SELECT o.* FROM ontology_edges e JOIN ontology_objects o ON o.id = e.dst_id AND o.org_id = e.org_id
       WHERE e.org_id = v_org AND e.src_kind = 'claim' AND e.src_id = v_claim AND e.dst_kind = 'object'
         AND e.relation IN ('about', 'decided_by') AND e.status = 'active'
    LOOP
      n := n + 1;
      SELECT po.id INTO v_pobj FROM ontology_objects po
       WHERE po.org_id = v_org AND po.scope_kind = 'personal' AND po.scope_id = v_author AND po.merged_into IS NULL
         AND po.object_kind = v_obj.object_kind AND lower(po.name) = lower(v_obj.name)
       LIMIT 1;
      IF v_pobj IS NULL THEN
        v_pobj := v_id || '-o' || n;
        INSERT INTO ontology_objects (id, org_id, scope_kind, scope_id, object_kind, name, aliases, created_by)
        VALUES (v_pobj, v_org, 'personal', v_author, v_obj.object_kind, v_obj.name, v_obj.aliases, 'model');
      END IF;
      INSERT INTO ontology_edges (id, org_id, src_kind, src_id, dst_kind, dst_id, relation, created_by, scope_kind, scope_id)
      SELECT v_id || '-e' || n, v_org, 'claim', v_target, 'object', v_pobj, e.relation, 'model', 'personal', v_author
        FROM ontology_edges e WHERE e.org_id = v_org AND e.src_kind = 'claim' AND e.src_id = v_claim
         AND e.dst_kind = 'object' AND e.dst_id = v_obj.id AND e.status = 'active' LIMIT 1
      ON CONFLICT (id) DO NOTHING;
      v_pobj := NULL;
    END LOOP;
  END IF;

  -- 证据原样挂上（merge 时追加）——就是作者本人的那条消息（上面已核对）。
  INSERT INTO claim_message_evidence (claim_id, org_id, message_id, stance, excerpt)
    SELECT v_target, org_id, message_id, stance, excerpt FROM claim_message_evidence WHERE claim_id = v_claim AND org_id = v_org
  ON CONFLICT DO NOTHING;
  -- 来源链（I-8）：L1 → L0。created_by = model 标出这是系统代记的来源，撤销只认这种边。
  INSERT INTO ontology_edges (id, org_id, src_kind, src_id, dst_kind, dst_id, relation, created_by, scope_kind, scope_id)
  VALUES (v_id || '-d', v_org, 'claim', v_target, 'claim', v_claim, 'derived_from', 'model', 'personal', v_author);

  INSERT INTO ontology_actions (id, org_id, scope_kind, scope_id, actor_kind, actor_id, action_type, payload, outcome)
  VALUES (v_id, v_org, 'personal', v_author, 'system', 'kg-decision-auto-copy', 'autoCopyDecision',
          jsonb_build_object('thread_id', v_thread, 'message_id', p->>'message_id', 'mode', v_mode,
                             'claims', jsonb_build_array(jsonb_build_object('id', v_claim), jsonb_build_object('id', v_target))),
          'accepted');
  RETURN v_target;
END
$$;

-- ─────────────────────────────── 撤销（人的动作） ───────────────────────────────
-- p: { action_id, thread_id, claim_id（会话里的原结论） }。返回 { personal_claim_id, outcome: revoked|detached }。
CREATE OR REPLACE FUNCTION kg_undo_auto_copy(p jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_org    text := current_setting('app.current_org', true);
  v_user   text := current_setting('app.current_user_id', true);
  v_thread text := p->>'thread_id';
  v_claim  text := p->>'claim_id';
  v_id     text := p->>'action_id';
  v_edge   text;
  v_copy   record;
  v_outcome text;
BEGIN
  IF v_org IS NULL OR v_org = '' THEN RAISE EXCEPTION 'KG_NO_TENANT' USING ERRCODE = '42501'; END IF;
  IF NOT public.kernel_org_is_writable(v_org) THEN
    RAISE EXCEPTION 'KG_ORG_FROZEN: organization % is read-only', v_org USING ERRCODE = '42501';
  END IF;
  IF v_user IS NULL OR v_user = '' THEN RAISE EXCEPTION 'KG_ACTOR_NOT_HUMAN: no signed-in user' USING ERRCODE = '42501'; END IF;

  PERFORM pg_advisory_xact_lock(hashtext('kg_scope:' || v_org || '|personal|' || v_user));
  -- 本人空间里、系统代记的、由这条会话结论而来的那份（别人的空间 / 不存在 / 人确认过的 ⇒ 同一个出口）。
  SELECT d.id AS edge_id, pc.* INTO v_copy
    FROM ontology_edges d
    JOIN claims pc ON pc.id = d.src_id AND pc.org_id = d.org_id
    JOIN claims src ON src.id = d.dst_id AND src.org_id = d.org_id
   WHERE d.org_id = v_org AND d.relation = 'derived_from' AND d.src_kind = 'claim' AND d.dst_kind = 'claim'
     AND d.dst_id = v_claim AND d.status = 'active' AND d.created_by = 'model'
     AND src.scope_kind = 'chat_session' AND src.scope_id = v_thread
     AND pc.scope_kind = 'personal' AND pc.scope_id = v_user AND pc.revoked_at IS NULL AND pc.status = 'proposed'
   LIMIT 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'KG_CLAIM_NOT_FOUND' USING ERRCODE = '23503'; END IF;
  v_edge := v_copy.edge_id;
  PERFORM 1 FROM claims WHERE org_id = v_org AND id = v_copy.id FOR UPDATE;

  IF EXISTS (SELECT 1 FROM ontology_edges d JOIN claims s ON s.id = d.dst_id AND s.org_id = d.org_id
              WHERE d.org_id = v_org AND d.relation = 'derived_from' AND d.src_kind = 'claim' AND d.src_id = v_copy.id
                AND d.dst_kind = 'claim' AND d.id <> v_edge AND d.status = 'active' AND s.revoked_at IS NULL) THEN
    -- 还有别的活来源：只摘掉这一个来源，副本继续由其余来源支撑。
    UPDATE ontology_edges SET status = 'invalidated', invalidated_at = now() WHERE org_id = v_org AND id = v_edge;
    DELETE FROM claim_message_evidence pe
     WHERE pe.org_id = v_org AND pe.claim_id = v_copy.id
       AND pe.message_id IN (SELECT e.message_id FROM claim_message_evidence e WHERE e.org_id = v_org AND e.claim_id = v_claim)
       AND NOT EXISTS (SELECT 1 FROM ontology_edges d JOIN claim_message_evidence e2 ON e2.claim_id = d.dst_id AND e2.org_id = d.org_id
                        WHERE d.org_id = v_org AND d.relation = 'derived_from' AND d.src_id = v_copy.id AND d.dst_kind = 'claim'
                          AND d.status = 'active' AND e2.message_id = pe.message_id);
    v_outcome := 'detached';
  ELSE
    UPDATE claims SET status = 'superseded', revoked_at = now(), revocation_reason = 'user_revoked', updated_at = now()
     WHERE org_id = v_org AND id = v_copy.id;
    v_outcome := 'revoked';
  END IF;

  INSERT INTO ontology_actions (id, org_id, scope_kind, scope_id, actor_kind, actor_id, action_type, payload, outcome)
  VALUES (v_id, v_org, 'personal', v_user, 'human', v_user, 'undoAutoCopy',
          jsonb_build_object('thread_id', v_thread, 'outcome', v_outcome,
                             'claims', jsonb_build_array(jsonb_build_object('id', v_claim), jsonb_build_object('id', v_copy.id))),
          'accepted');
  RETURN jsonb_build_object('personal_claim_id', v_copy.id, 'outcome', v_outcome);
END
$$;

-- ─────────────────────────────── F11：合并到 proposed 的目标时一并确认 ───────────────────────────────
-- 与 20260924240000_kg_f11_promote_personal.sql 逐字相同，只在 merge 分支加了「目标 proposed/reviewed ⇒ accepted」。
CREATE OR REPLACE FUNCTION kg_promote_claim(p jsonb) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_org     text := current_setting('app.current_org', true);
  v_user    text := current_setting('app.current_user_id', true);
  v_thread  text := p->>'thread_id';
  v_claim   text := p->>'claim_id';
  v_id      text := p->>'action_id';
  v_mode    text := coalesce(p->>'mode', 'new');
  v_target  text;
  v_src     record;
  v_obj     record;
  v_pobj    text;
  n         int := 0;
BEGIN
  IF v_org IS NULL OR v_org = '' THEN RAISE EXCEPTION 'KG_NO_TENANT' USING ERRCODE = '42501'; END IF;
  IF NOT public.kernel_org_is_writable(v_org) THEN
    RAISE EXCEPTION 'KG_ORG_FROZEN: organization % is read-only', v_org USING ERRCODE = '42501';
  END IF;
  IF v_user IS NULL OR v_user = '' THEN RAISE EXCEPTION 'KG_ACTOR_NOT_HUMAN: no signed-in user' USING ERRCODE = '42501'; END IF;
  IF NOT EXISTS (SELECT 1 FROM chat_threads t WHERE t.id = v_thread AND t.org_id = v_org AND t.created_by = v_user) THEN
    RAISE EXCEPTION 'KG_NOT_OWNER: only the thread owner promotes its knowledge' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM chat_threads t WHERE t.id = v_thread AND t.org_id = v_org AND t.project_id IS NULL) THEN
    RAISE EXCEPTION 'KG_SCOPE_NOT_PERSONAL: only personal threads promote to personal knowledge' USING ERRCODE = '42501';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('kg_scope:' || v_org || '|chat_session|' || v_thread));
  SELECT * INTO v_src FROM claims c
   WHERE c.org_id = v_org AND c.id = v_claim AND c.scope_kind = 'chat_session' AND c.scope_id = v_thread
     AND c.revoked_at IS NULL AND c.status <> 'superseded'
   FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'KG_CLAIM_NOT_FOUND' USING ERRCODE = '23503'; END IF;
  IF v_src.status = 'contested' THEN
    RAISE EXCEPTION 'KG_CONTESTED_NEEDS_RESOLUTION: resolve the conflict before promoting' USING ERRCODE = '23514';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM claim_message_evidence e WHERE e.claim_id = v_claim AND e.stance = 'supporting')
     AND NOT EXISTS (SELECT 1 FROM claim_segments s WHERE s.claim_id = v_claim AND s.stance = 'supporting') THEN
    RAISE EXCEPTION 'KG_EVIDENCE_REVOKED: the sources of this claim are gone' USING ERRCODE = '23514';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('kg_scope:' || v_org || '|personal|' || v_user));

  IF v_src.status IN ('proposed', 'reviewed') THEN
    UPDATE claims SET status = 'accepted', reviewed_by = v_user, updated_at = now()
     WHERE org_id = v_org AND id = v_claim AND status IN ('proposed', 'reviewed');
    INSERT INTO ontology_actions (id, org_id, scope_kind, scope_id, actor_kind, actor_id, action_type, payload, outcome)
    VALUES (v_id || '-c', v_org, 'chat_session', v_thread, 'human', v_user, 'confirmClaim',
            jsonb_build_object('action', jsonb_build_object('type', 'confirmClaim', 'claimId', v_claim), 'via', 'promoteToPersonal',
                               'claims', jsonb_build_array(jsonb_build_object('id', v_claim)), 'objects', '[]'::jsonb),
            'accepted');
  END IF;

  IF v_mode = 'merge' THEN
    SELECT c.id INTO v_target FROM claims c
     WHERE c.org_id = v_org AND c.id = p->>'target_claim_id' AND c.scope_kind = 'personal' AND c.scope_id = v_user
       AND c.revoked_at IS NULL AND c.status NOT IN ('superseded', 'contested')
     FOR UPDATE;
    IF v_target IS NULL THEN RAISE EXCEPTION 'KG_CLAIM_NOT_FOUND: merge target' USING ERRCODE = '23503'; END IF;
    -- issue #4283：目标是「AI 记下的」（系统自动记进个人空间的决定）⇒ 人点晋升即确认（U-3）。
    UPDATE claims SET status = 'accepted', reviewed_by = v_user, updated_at = now()
     WHERE org_id = v_org AND id = v_target AND status IN ('proposed', 'reviewed');
  ELSE
    v_target := v_id || '-p';
    INSERT INTO claims (id, org_id, statement, status, tsv, claim_kind, confidence, created_by, reviewed_by,
                        scope_kind, scope_id, valid_from)
    VALUES (v_target, v_org, v_src.statement, 'accepted', to_tsvector('simple', v_src.statement), v_src.claim_kind,
            1, 'human', v_user, 'personal', v_user, now());
    FOR v_obj IN
      SELECT o.* FROM ontology_edges e JOIN ontology_objects o ON o.id = e.dst_id AND o.org_id = e.org_id
       WHERE e.org_id = v_org AND e.src_kind = 'claim' AND e.src_id = v_claim AND e.dst_kind = 'object'
         AND e.relation IN ('about', 'decided_by') AND e.status = 'active'
    LOOP
      n := n + 1;
      SELECT po.id INTO v_pobj FROM ontology_objects po
       WHERE po.org_id = v_org AND po.scope_kind = 'personal' AND po.scope_id = v_user AND po.merged_into IS NULL
         AND po.object_kind = v_obj.object_kind AND lower(po.name) = lower(v_obj.name)
       LIMIT 1;
      IF v_pobj IS NULL THEN
        v_pobj := v_id || '-o' || n;
        INSERT INTO ontology_objects (id, org_id, scope_kind, scope_id, object_kind, name, aliases, created_by)
        VALUES (v_pobj, v_org, 'personal', v_user, v_obj.object_kind, v_obj.name, v_obj.aliases, 'human');
      END IF;
      INSERT INTO ontology_edges (id, org_id, src_kind, src_id, dst_kind, dst_id, relation, created_by, scope_kind, scope_id)
      SELECT v_id || '-e' || n, v_org, 'claim', v_target, 'object', v_pobj, e.relation, 'human', 'personal', v_user
        FROM ontology_edges e WHERE e.org_id = v_org AND e.src_kind = 'claim' AND e.src_id = v_claim
         AND e.dst_kind = 'object' AND e.dst_id = v_obj.id AND e.status = 'active' LIMIT 1
      ON CONFLICT (id) DO NOTHING;
      v_pobj := NULL;
    END LOOP;
  END IF;

  INSERT INTO claim_message_evidence (claim_id, org_id, message_id, stance, excerpt)
    SELECT v_target, org_id, message_id, stance, excerpt FROM claim_message_evidence WHERE claim_id = v_claim
  ON CONFLICT DO NOTHING;
  INSERT INTO claim_segments (claim_id, org_id, segment_id, stance)
    SELECT v_target, org_id, segment_id, stance FROM claim_segments WHERE claim_id = v_claim
  ON CONFLICT DO NOTHING;
  INSERT INTO ontology_edges (id, org_id, src_kind, src_id, dst_kind, dst_id, relation, created_by, scope_kind, scope_id)
  SELECT v_id || '-d', v_org, 'claim', v_target, 'claim', v_claim, 'derived_from', 'human', 'personal', v_user
   WHERE NOT EXISTS (SELECT 1 FROM ontology_edges d
                      WHERE d.org_id = v_org AND d.src_kind = 'claim' AND d.src_id = v_target AND d.dst_kind = 'claim'
                        AND d.dst_id = v_claim AND d.relation = 'derived_from' AND d.status = 'active')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO ontology_actions (id, org_id, scope_kind, scope_id, actor_kind, actor_id, action_type, payload, outcome)
  VALUES (v_id, v_org, 'personal', v_user, 'human', v_user, 'promoteToPersonal',
          jsonb_build_object('thread_id', v_thread, 'mode', v_mode,
                             'claims', jsonb_build_array(jsonb_build_object('id', v_claim), jsonb_build_object('id', v_target))),
          'accepted');
  RETURN v_target;
END
$$;

REVOKE ALL ON FUNCTION kg_auto_copy_eligible(text, text, text), kg_auto_copy_author(text, text, text),
  kg_auto_copy_candidates(text, text), kg_auto_copy_decision(jsonb), kg_undo_auto_copy(jsonb), kg_promote_claim(jsonb) FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_rw') THEN
    -- 只授三个入口；两个判定助手只在 SECURITY DEFINER 函数内部用，不对 app_rw 开放。
    GRANT EXECUTE ON FUNCTION kg_auto_copy_candidates(text, text), kg_auto_copy_decision(jsonb), kg_undo_auto_copy(jsonb),
      kg_promote_claim(jsonb) TO app_rw;
  END IF;
END
$$;

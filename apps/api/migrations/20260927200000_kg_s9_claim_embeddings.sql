/*
 * Phase 18 S9（#4366，epic #4359）—— 结论 / 实体的嵌入流水线：写入即排队，worker 嵌入后落 object_embeddings。
 *
 * ## 数据流（与 F04 图投影同一形状）
 *
 *   claims / ontology_objects 写入（只经 F03 执行器等 kg_* 函数）
 *     └─ AFTER 触发器 → kg_embedding_outbox（同一事务：结论落了，「待嵌入」就一定在）
 *        文本变了（statement / name / aliases）⇒ 同一触发器先删掉这个目标的旧向量：召回永远不会用旧文本的向量。
 *   嵌入 worker（apps/api/src/infrastructure/knowledge-graph/kg-embedding-worker.ts）
 *     └─ 按 org 调 kg_embedding_pending() 取文本 → 部署配置的嵌入模型（EmbeddingPort）→ kg_embedding_write() 落向量
 *
 * 嵌入服务挂了 / 没配置：outbox 行原样保留，结论照常写入（不在同一事务），召回的向量通道记为不可用、
 * 只走字面 + 图（#4366 的降级路径）。恢复后 worker 自动补齐。
 *
 * ## 为什么 pending 函数返回正文、而且是 SECURITY DEFINER
 *
 * 嵌入要把文本交给模型，文本必须出库——这是本流水线与 F04（图里只有 id）唯一的不同。个人空间的结论对 app_rw
 * 只在 `app.current_user_id` = 本人时可见（F02 的 personal_owner 策略），系统 worker 没有「本人」，所以取文本
 * 与写向量都走属主身份的函数，每条语句写死 `org_id = app.current_org`（同 F04 的理由：SECURITY DEFINER 下 RLS 不生效）。
 * 文本只进嵌入模型、换回一个向量，不回任何请求方；写回的向量仍受 object_embeddings 的 target_visible 策略约束——
 * 召回读它时（app_rw、设了 app.current_user_id）别人个人空间的向量读不到。
 *
 * ## 只在登记了嵌入模型时排队
 *
 * 没有任何登记模型（embedding_models 为空）的库，永远不会有人消费 outbox：不排（同 F04「没有 AGE 不排」）。
 * 登记第一个 / 新的模型时，触发器把所有活目标补排一次（登记是运维动作，一次性）；本迁移末尾对已登记模型的库补排一次。
 */

CREATE TABLE IF NOT EXISTS kg_embedding_outbox (
  id          bigserial PRIMARY KEY,
  org_id      text NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  target_kind text NOT NULL CHECK (target_kind IN ('object', 'claim')),
  target_id   text NOT NULL,
  -- 单个目标嵌入失败（维度不符、坏数据）不拖垮整批：记次数与原因，超过上限不再重试（kg_embedding_dead_count 报出来）。
  -- 嵌入服务整体不可用不算某个目标的错，不计次数（见 kg_embedding_fail 的调用方）。
  attempts    integer NOT NULL DEFAULT 0,
  last_error  text,
  enqueued_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS kg_embedding_outbox_target_idx
  ON kg_embedding_outbox (org_id, target_kind, target_id, id);

ALTER TABLE kg_embedding_outbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE kg_embedding_outbox FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS kg_embedding_outbox_tenant ON kg_embedding_outbox;
CREATE POLICY kg_embedding_outbox_tenant ON kg_embedding_outbox
  USING (org_id = current_setting('app.current_org', true))
  WITH CHECK (org_id = current_setting('app.current_org', true));
REVOKE ALL ON kg_embedding_outbox FROM app_rw;
GRANT SELECT ON kg_embedding_outbox TO app_rw;

-- 单个目标的重试上限：唯一的一处定义。
CREATE OR REPLACE FUNCTION kg_embedding_max_attempts() RETURNS integer
LANGUAGE sql IMMUTABLE AS $$ SELECT 5 $$;

-- 「这个目标该被嵌入的文本」的唯一定义：活结论的 statement；活实体的名字 + 别名。不活 ⇒ NULL（不嵌入、出队）。
CREATE OR REPLACE FUNCTION kg_embedding_text(p_org text, p_kind text, p_id text) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT CASE p_kind
    WHEN 'claim' THEN (SELECT c.statement FROM public.claims c
                        WHERE c.org_id = p_org AND c.id = p_id AND c.scope_kind IS NOT NULL
                          AND c.revoked_at IS NULL AND c.status <> 'superseded')
    ELSE (SELECT btrim(o.name || ' ' || array_to_string(o.aliases, ' ')) FROM public.ontology_objects o
           WHERE o.org_id = p_org AND o.id = p_id AND o.scope_kind IS NOT NULL AND o.merged_into IS NULL)
  END
$$;

CREATE OR REPLACE FUNCTION kg_enqueue_embedding() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_kind text := CASE TG_TABLE_NAME WHEN 'ontology_objects' THEN 'object' ELSE 'claim' END;
  v_changed boolean;
BEGIN
  IF NEW.scope_kind IS NULL THEN RETURN NULL; END IF;
  IF TG_OP = 'UPDATE' THEN
    -- 两张表的列不同：分开写（一个表达式里同时引用两边的列，另一张表的触发器执行时会找不到字段）。
    IF v_kind = 'claim' THEN
      v_changed := OLD.statement IS DISTINCT FROM NEW.statement;
    ELSE
      v_changed := OLD.name IS DISTINCT FROM NEW.name OR OLD.aliases IS DISTINCT FROM NEW.aliases;
    END IF;
    -- 只有文本变了才需要重嵌：状态 / 三态 / 撤销的变化由召回的候选集（活结论）处理，向量不变。
    IF NOT v_changed THEN RETURN NULL; END IF;
    -- 旧向量是旧文本的：立刻删掉，召回不会拿它去匹配新说法。
    DELETE FROM public.object_embeddings
     WHERE org_id = NEW.org_id AND target_kind = v_kind AND target_id = NEW.id;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.embedding_models) THEN RETURN NULL; END IF;
  INSERT INTO public.kg_embedding_outbox (org_id, target_kind, target_id) VALUES (NEW.org_id, v_kind, NEW.id);
  RETURN NULL;
END
$$;

DROP TRIGGER IF EXISTS kg_enqueue_embedding_trg ON claims;
CREATE TRIGGER kg_enqueue_embedding_trg AFTER INSERT OR UPDATE OF statement ON claims
  FOR EACH ROW EXECUTE FUNCTION kg_enqueue_embedding();
DROP TRIGGER IF EXISTS kg_enqueue_embedding_trg ON ontology_objects;
CREATE TRIGGER kg_enqueue_embedding_trg AFTER INSERT OR UPDATE OF name, aliases ON ontology_objects
  FOR EACH ROW EXECUTE FUNCTION kg_enqueue_embedding();

-- 补排：所有活目标各排一行（已有同一目标的待处理行就不重复排）。
CREATE OR REPLACE FUNCTION kg_embedding_enqueue_all() RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  n bigint;
BEGIN
  WITH live AS (
    SELECT c.org_id, 'claim'::text AS target_kind, c.id AS target_id FROM public.claims c
     WHERE c.scope_kind IS NOT NULL AND c.revoked_at IS NULL AND c.status <> 'superseded'
    UNION ALL
    SELECT o.org_id, 'object', o.id FROM public.ontology_objects o
     WHERE o.scope_kind IS NOT NULL AND o.merged_into IS NULL
  ), ins AS (
    INSERT INTO public.kg_embedding_outbox (org_id, target_kind, target_id)
    SELECT l.org_id, l.target_kind, l.target_id FROM live l
     WHERE NOT EXISTS (SELECT 1 FROM public.kg_embedding_outbox q
                        WHERE q.org_id = l.org_id AND q.target_kind = l.target_kind AND q.target_id = l.target_id)
    RETURNING 1
  )
  SELECT count(*) INTO n FROM ins;
  RETURN n;
END
$$;

-- 登记新模型（运维动作）⇒ 全部活目标补排一次：新模型要有向量才有召回。
CREATE OR REPLACE FUNCTION kg_embedding_model_registered() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  PERFORM public.kg_embedding_enqueue_all();
  RETURN NULL;
END
$$;
DROP TRIGGER IF EXISTS kg_embedding_model_registered_trg ON embedding_models;
CREATE TRIGGER kg_embedding_model_registered_trg AFTER INSERT ON embedding_models
  FOR EACH STATEMENT EXECUTE FUNCTION kg_embedding_model_registered();

-- ─────────────────────────────── worker 入口 ───────────────────────────────

-- 有待嵌入的 org：只给 id，不给内容；worker 据此逐个 org 进 withTenant。
CREATE OR REPLACE FUNCTION kg_embedding_pending_orgs() RETURNS SETOF text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp
AS $$ SELECT DISTINCT org_id FROM kg_embedding_outbox WHERE attempts < kg_embedding_max_attempts() $$;

/*
 * 本 org 待嵌入的目标（按目标聚合，同一目标排了多行只嵌一次）：文本 + 文本的 md5（写回时核对：取出之后文本又变了 ⇒
 * 不写旧文本的向量，新排的那行会再来）+ 本轮看到的最大 outbox id（写回 / 失败时只删到它为止，之后到的行留给下一轮）。
 * 已经不活的目标（撤销 / 被取代 / 合并 / 删除）没有文本：直接出队，不返回。
 */
CREATE OR REPLACE FUNCTION kg_embedding_pending(p_limit integer DEFAULT 16)
RETURNS TABLE (target_kind text, target_id text, content text, content_md5 text, max_id bigint)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_org text := current_setting('app.current_org', true);
  t record;
  v_text text;
BEGIN
  IF v_org IS NULL OR v_org = '' THEN
    RAISE EXCEPTION 'KG_NO_TENANT' USING ERRCODE = '42501';
  END IF;
  FOR t IN
    WITH picked AS (
      SELECT q.id, q.target_kind, q.target_id FROM kg_embedding_outbox q
       WHERE q.org_id = v_org AND q.attempts < kg_embedding_max_attempts()
       ORDER BY q.id LIMIT greatest(1, least(p_limit, 64))
       FOR UPDATE SKIP LOCKED
    )
    SELECT p.target_kind, p.target_id, max(p.id) AS max_id FROM picked p GROUP BY p.target_kind, p.target_id ORDER BY min(p.id)
  LOOP
    v_text := kg_embedding_text(v_org, t.target_kind, t.target_id);
    IF v_text IS NULL OR v_text = '' THEN
      DELETE FROM kg_embedding_outbox q
       WHERE q.org_id = v_org AND q.target_kind = t.target_kind AND q.target_id = t.target_id AND q.id <= t.max_id;
      CONTINUE;
    END IF;
    target_kind := t.target_kind; target_id := t.target_id; content := v_text; content_md5 := md5(v_text); max_id := t.max_id;
    RETURN NEXT;
  END LOOP;
END
$$;

/*
 * 写回一个向量。结果：
 *   'written' —— 落了（同模型同版本的旧向量被替换），出队；
 *   'stale'   —— 取出之后文本变了 / 目标不活了：不写，出队到 p_max_id（文本变了的那次已另排了新行）。
 * 模型未登记 / 维度不符由 object_embeddings 上既有的外键与维度触发器拒绝（抛错 ⇒ 调用方记一次失败）。
 */
CREATE OR REPLACE FUNCTION kg_embedding_write(
  p_kind text, p_id text, p_model text, p_model_version text, p_content_md5 text, p_embedding text, p_max_id bigint
) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_org text := current_setting('app.current_org', true);
  v_text text;
  v_outcome text;
BEGIN
  IF v_org IS NULL OR v_org = '' THEN
    RAISE EXCEPTION 'KG_NO_TENANT' USING ERRCODE = '42501';
  END IF;
  IF p_kind NOT IN ('claim', 'object') THEN
    RAISE EXCEPTION 'KG_EMBEDDING_BAD_KIND' USING ERRCODE = '22023';
  END IF;
  v_text := kg_embedding_text(v_org, p_kind, p_id);
  IF v_text IS NULL OR md5(v_text) <> p_content_md5 THEN
    v_outcome := 'stale';
  ELSE
    INSERT INTO object_embeddings (org_id, target_kind, target_id, model, model_version, embedding)
    VALUES (v_org, p_kind, p_id, p_model, p_model_version, p_embedding::vector)
    ON CONFLICT (target_kind, target_id, model, model_version)
      DO UPDATE SET embedding = EXCLUDED.embedding, created_at = now();
    v_outcome := 'written';
  END IF;
  DELETE FROM kg_embedding_outbox q
   WHERE q.org_id = v_org AND q.target_kind = p_kind AND q.target_id = p_id AND q.id <= p_max_id;
  RETURN v_outcome;
END
$$;

-- 单个目标失败：记一次（原因只存截断后的错误码 / 消息，由调用方保证不含正文）。
CREATE OR REPLACE FUNCTION kg_embedding_fail(p_kind text, p_id text, p_max_id bigint, p_error text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_org text := current_setting('app.current_org', true);
BEGIN
  IF v_org IS NULL OR v_org = '' THEN
    RAISE EXCEPTION 'KG_NO_TENANT' USING ERRCODE = '42501';
  END IF;
  UPDATE kg_embedding_outbox q SET attempts = q.attempts + 1, last_error = left(p_error, 200)
   WHERE q.org_id = v_org AND q.target_kind = p_kind AND q.target_id = p_id AND q.id <= p_max_id;
END
$$;

-- 全局死信数（只有数字）：worker 发现它变大就报错。
CREATE OR REPLACE FUNCTION kg_embedding_dead_count() RETURNS bigint
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp
AS $$ SELECT count(DISTINCT (org_id, target_kind, target_id)) FROM kg_embedding_outbox WHERE attempts >= kg_embedding_max_attempts() $$;

REVOKE ALL ON FUNCTION kg_embedding_text(text, text, text), kg_enqueue_embedding(), kg_embedding_enqueue_all(),
  kg_embedding_model_registered(), kg_embedding_pending_orgs(), kg_embedding_pending(integer),
  kg_embedding_write(text, text, text, text, text, text, bigint), kg_embedding_fail(text, text, bigint, text),
  kg_embedding_dead_count() FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_rw') THEN
    -- worker 只需要这五个；补排走登记模型的触发器或迁移角色。
    GRANT EXECUTE ON FUNCTION kg_embedding_pending_orgs(), kg_embedding_pending(integer),
      kg_embedding_write(text, text, text, text, text, text, bigint), kg_embedding_fail(text, text, bigint, text),
      kg_embedding_dead_count() TO app_rw;
  END IF;
END
$$;

-- 已登记模型的库：现有的活目标补排一次（空库 / 没有登记模型 ⇒ 空操作；重放幂等：已排的不重复排）。
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM embedding_models) THEN
    PERFORM kg_embedding_enqueue_all();
  END IF;
END
$$;

SELECT kernel_apply_org_freeze_policies();

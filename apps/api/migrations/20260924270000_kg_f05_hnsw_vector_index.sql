/*
 * Phase 18 F05 —— segment_embeddings / object_embeddings 的 HNSW 索引（uc-18-2 R9、uc-18-1 R11④）。
 *
 * ## 为什么不是一条 `CREATE INDEX ... USING hnsw (embedding vector_cosine_ops)`
 *
 * 两张表的 `embedding` 列都是**不带维度**的 `vector`（0009 / F02：维度属于嵌入模型，按 model/version
 * 分区、换维度走双写）。pgvector 的 ANN 索引要求固定维度，对不带维度的列建 HNSW 会直接报
 * 「column does not have dimensions」。把列改成 `vector(N)` 等于替产品选了一个模型，而且让双写失效。
 *
 * 所以索引是**每个登记模型一条**的部分表达式索引（pgvector README 对多维度列给的就是这个写法）：
 *
 *   CREATE INDEX <表>_hnsw_<md5(model, version) 前 16 位> ON <表>
 *     USING hnsw ((embedding::vector(<dims>)) vector_cosine_ops)
 *     WHERE model = '<model>' AND model_version = '<version>';
 *
 * - 距离算子沿用召回一直在用的 `<=>`（余弦），所以是 `vector_cosine_ops`；
 * - 查询要命中它，ORDER BY 必须写成同一个表达式 `embedding::vector(dims) <=> $q::vector(dims)`，
 *   且 WHERE 里带 model / model_version——见 `infrastructure/retrieval/hnsw-ann.ts`。
 *
 * ## 谁来建：embedding_models 上的触发器
 *
 * 登记一个模型（运维动作，owner 身份，见 register-embedding-model.ts）⇒ 两张表各得一条索引；
 * 改维度 ⇒ 旧索引先删再按新维度建（表里还有旧维度的行就会建失败——那本来就是非法状态，R9 要求换维度走新
 * version 双写）；删除登记 ⇒ 索引一起删。**「每个登记模型都有 HNSW 索引」因此是数据库里的不变量**，
 * 不靠谁记得跑一个脚本。本迁移末尾对已登记的模型补建一次（重放幂等：IF NOT EXISTS）。
 *
 * ## 维度上限：fail closed
 *
 * pgvector 的 `vector` 类型 HNSW 最多 2000 维。超过的模型**拒绝登记**（22023），而不是静默不建索引、
 * 让那个模型悄悄退回全表精确扫描——那是「看起来能用、上量后才慢到超时」的失败，不在今天暴露就会在最坏的
 * 时候暴露。要支持更高维度，得另起一个 feature（halfvec / 量化），不是在这里默默放宽。
 * 这个上限的**唯一出处**是契约 `RETRIEVAL_EMBEDDING_LIMITS.maxDimensions`（packages/contracts/src/
 * retrieval-embedding.ts）；下面函数里的 2000 只是 SQL 引不到 TS 常量时的复写，两者由
 * `tests/retrieval/kg-hnsw-permission-recall.test.ts` 钉在一起（等于上限可登记、上限 + 1 被拒）。
 * `registerEmbeddingModel` 在碰数据库之前就按契约常量拒绝，错误码 `embedding_model_dimensions_exceed_index_limit`。
 *
 * ## 运维须知（只写明，不在本迁移里改）
 *
 * - **登记新模型会短暂挡住写入。** 触发器里的 `CREATE INDEX` 不带 CONCURRENTLY（触发器跑在登记事务里，
 *   CONCURRENTLY 不能在事务块中执行），建索引期间对两张 embedding 表持 SHARE 锁：读照常，写入（向量 worker、
 *   附件索引）会排队到登记事务提交。新模型登记时还没有属于它的行，索引本身是空的，但部分索引也要把整张表
 *   扫一遍判断谓词，耗时随表大小增长；而且 SHARE 锁要等其它事务的 ROW EXCLUSIVE 放掉才拿得到。所以大表上
 *   **请在低峰登记**，并给登记会话设 `lock_timeout`。
 *   若将来要给已有大量行的模型补索引，应在事务外手工 `CREATE INDEX CONCURRENTLY` 同名同定义，再登记。
 * - **迭代扫描的延迟上界。** pgvector ≥ 0.8 的 `hnsw.iterative_scan` 在过滤很严时会一直扫到
 *   `hnsw.max_scan_tuples`（默认 20000）才停；那种查询的延迟由这个上限而不是 k 决定。扫到上限仍不足 k 条时，
 *   查询侧会再跑一次精确扫描补全（`hnsw-ann.ts`）——所以最坏情况是「一次扫满上限的索引读 + 一次精确扫描」。
 *   召回 P95 < 1.5 秒（S0-4）若在大租户上吃紧，先调 `max_scan_tuples`，不要关掉补全。
 *
 * ## 与权限过滤的关系（R9 的真正风险）
 *
 * HNSW 先按距离取候选、RLS 与作用域谓词后过滤；过滤掉的多了，返回就不足 k 条——用户被告知「没有这份材料」。
 * 本迁移只建索引；「过滤后仍取满 k 条」由查询侧负责（ef_search + pgvector ≥ 0.8 的迭代扫描 + 取不满时按
 * 精确扫描补全），召回率门槛由 `tests/retrieval/kg-hnsw-permission-recall.test.ts` 判。
 */

CREATE OR REPLACE FUNCTION embedding_hnsw_index_name(tbl text, model text, model_version text)
RETURNS text LANGUAGE sql IMMUTABLE
SET search_path = pg_catalog, public, pg_temp
-- 分隔符用 \x1f（单元分隔符）：避免 ('a/b','c') 与 ('a','b/c') 撞名。
AS $$ SELECT tbl || '_hnsw_' || left(md5(model || E'\x1f' || model_version), 16) $$;

CREATE OR REPLACE FUNCTION embedding_hnsw_ensure(p_model text, p_model_version text, p_dims integer)
RETURNS void LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  t text;
BEGIN
  IF p_dims > 2000 THEN
    RAISE EXCEPTION 'embedding model %/% has % dimensions; the HNSW index on vector supports at most 2000 (F05 requires every registered model to be HNSW-indexed)',
      p_model, p_model_version, p_dims
      USING ERRCODE = '22023';
  END IF;
  FOREACH t IN ARRAY ARRAY['segment_embeddings', 'object_embeddings']
  LOOP
    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS %I ON public.%I USING hnsw ((embedding::vector(%s)) vector_cosine_ops) '
      'WHERE model = %L AND model_version = %L',
      public.embedding_hnsw_index_name(t, p_model, p_model_version), t, p_dims, p_model, p_model_version);
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION embedding_hnsw_drop(p_model text, p_model_version text)
RETURNS void LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['segment_embeddings', 'object_embeddings']
  LOOP
    EXECUTE format('DROP INDEX IF EXISTS public.%I', public.embedding_hnsw_index_name(t, p_model, p_model_version));
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION embedding_models_hnsw_sync() RETURNS trigger LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM public.embedding_hnsw_drop(OLD.model, OLD.model_version);
    RETURN OLD;
  END IF;
  IF TG_OP = 'UPDATE' AND (OLD.model, OLD.model_version, OLD.dims) IS DISTINCT FROM (NEW.model, NEW.model_version, NEW.dims) THEN
    PERFORM public.embedding_hnsw_drop(OLD.model, OLD.model_version);
  END IF;
  PERFORM public.embedding_hnsw_ensure(NEW.model, NEW.model_version, NEW.dims);
  RETURN NEW;
END;
$$;

-- 这几个函数只该由登记表上的触发器调用；app_rw 本来也不是表属主、建不了索引，这里把 EXECUTE 也收掉。
REVOKE ALL ON FUNCTION embedding_hnsw_ensure(text, text, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION embedding_hnsw_drop(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION embedding_models_hnsw_sync() FROM PUBLIC;

DROP TRIGGER IF EXISTS embedding_models_hnsw_sync_trg ON embedding_models;
CREATE TRIGGER embedding_models_hnsw_sync_trg
  AFTER INSERT OR UPDATE OR DELETE ON embedding_models
  FOR EACH ROW EXECUTE FUNCTION embedding_models_hnsw_sync();

-- 已登记的模型补建（空库上是空操作；重放幂等）。
SELECT embedding_hnsw_ensure(model, model_version, dims) FROM embedding_models;

-- ## ANALYZE 与多维度并存
--
-- 按设计同一列里会同时有不同维度的行（双写换维度，R9）。ANALYZE 给 `embedding` 列算统计时要用
-- vector 的比较函数排序样本，而 pgvector 比较两个维度不同的向量直接报「different vector dimensions」——
-- 于是只要两个模型的行同时存在，ANALYZE（以及 autovacuum 的自动 analyze）就在这两张表上**整表失败**，
-- 其它列（org_id / model）的统计也跟着拿不到，而规划器正要靠它们在「HNSW 后过滤」和「btree 预过滤 +
-- 精确排序」之间做选择。这一列的统计对规划没有用处（没有谁按向量值做等值 / 范围过滤），关掉它。
-- 每条部分索引的表达式统计（`embedding::vector(dims)`）只覆盖同一模型的行，不受影响。
ALTER TABLE segment_embeddings ALTER COLUMN embedding SET STATISTICS 0;
ALTER TABLE object_embeddings ALTER COLUMN embedding SET STATISTICS 0;

COMMENT ON COLUMN segment_embeddings.embedding IS
  'Unconstrained dimension by design: the dimension belongs to the embedding model. Enforced against '
  'embedding_models by trigger. ANN: one partial HNSW expression index per registered model '
  '(migration 20260924270000_kg_f05_hnsw_vector_index), gated by kg-hnsw-permission-recall.test.ts.';

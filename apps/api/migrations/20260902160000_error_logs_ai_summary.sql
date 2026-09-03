-- 系统异常 AI 摘要（人类 2026-09-02 要求：后台「反馈与迭代 → 系统异常」看到的是原始
-- 异常字段，需要跟反馈卡片一样有一段给人看的文字，供人类决定怎么处理）。
--
-- ai_title / ai_summary：`PgErrorLogWriter.record()` 落库之后**异步**（不阻塞记录本身）
-- 调用 `summarizeErrorLog` 生成，写不进来就一直是 NULL——`list()` 据此渲染
-- 「AI 还没生成/这次没生成出来」，不是伪造一段摘要。见该用例头注。
--
-- 权限维持 error_logs 既有的"app_rw 不能读表"边界（见 20260901024515 / 20260902012105
-- 两条迁移头注）：
--   · 写回摘要走 SECURITY DEFINER 函数 kernel_write_error_log_ai_summary，只给
--     EXECUTE——app_rw 能"设置某个已知 id 的摘要"，不能 SELECT 这张表的任何内容。
--   · 插入改成 RETURNING id 需要 app_rw 有 SELECT(id)；id 是自增序号，不是内容，
--     单独放行不违反"诊断内容只有 app_diag_ro 能读"这条边界。
--
-- ⚠ **不修改 `kernel_read_error_logs`，新建 `kernel_read_error_logs_with_ai_summary`**：
--   `CREATE OR REPLACE FUNCTION` 不能改变返回类型（这里要多出 ai_title/ai_summary
--   两列），而 `kernel_read_error_logs` 是 20260902012105 那条**已经上线**的迁移建的——
--   本仓迁移只前进不改历史（AGENTS.md「仓库即唯一事实来源」一节的推论）,改那个文件会让
--   已经跑过它的环境与"迁移幂等重放"这条门控（`migrate:check` 强制 `force:true`
--   把全部文件在同一个库上重放一遍）当场对不上——本迁移写好之后用这条门控实测过一次
--   `CREATE OR REPLACE` 撞"cannot change return type of existing function"，这不是假设。
--   `kernel_read_error_logs` 因此原样留着（既有测试仍然直接调用它，行为不变），
--   `PgErrorLogWriter.list()` 改调新函数。

ALTER TABLE error_logs ADD COLUMN IF NOT EXISTS ai_title text;
ALTER TABLE error_logs ADD COLUMN IF NOT EXISTS ai_summary text;

GRANT SELECT (id) ON error_logs TO app_rw;

CREATE OR REPLACE FUNCTION kernel_write_error_log_ai_summary(p_id bigint, p_title text, p_summary text)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  UPDATE error_logs SET ai_title = p_title, ai_summary = p_summary WHERE id = p_id;
$$;

COMMENT ON FUNCTION kernel_write_error_log_ai_summary(bigint, text, text) IS
  'PgErrorLogWriter 异步回填 AI 摘要用的窄口径写入。SECURITY DEFINER 以表主体身份运行，
   EXECUTE 只授给 app_rw；app_rw 因此能"设置某个已知 id 的两个摘要列"，但既不能
   SELECT 这张表，也不能 UPDATE 除这两列之外的任何字段（函数体写死了列名）。
   反证见 pg-error-log-writer-real-postgres.test.ts：app_rw 直连仍然对 error_logs
   没有裸 SELECT/UPDATE 权限，唯一的写回路径就是这个函数。';

REVOKE ALL ON FUNCTION kernel_write_error_log_ai_summary(bigint, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION kernel_write_error_log_ai_summary(bigint, text, text) TO app_rw;

CREATE OR REPLACE FUNCTION kernel_read_error_logs_with_ai_summary(p_limit integer, p_before_id bigint DEFAULT NULL)
RETURNS TABLE (id bigint, trace_id text, msg text, detail jsonb, created_at timestamptz, ai_title text, ai_summary text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT e.id, e.trace_id, e.msg, e.detail, e.created_at, e.ai_title, e.ai_summary
    FROM error_logs e
   WHERE p_before_id IS NULL OR e.id < p_before_id
   ORDER BY e.id DESC
   LIMIT LEAST(GREATEST(p_limit, 0), 200);
$$;

COMMENT ON FUNCTION kernel_read_error_logs_with_ai_summary(integer, bigint) IS
  '`kernel_read_error_logs` 的替代读路径（多 ai_title/ai_summary 两列）——见本文件头注
   "不修改 kernel_read_error_logs" 一节。EXECUTE 只授给 app_diag_ro，与旧函数完全同一套
   权限模型：PUBLIC 已显式 REVOKE，app_rw 对这个函数、对这张表一无所有。';

REVOKE ALL ON FUNCTION kernel_read_error_logs_with_ai_summary(integer, bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION kernel_read_error_logs_with_ai_summary(integer, bigint) TO app_diag_ro;

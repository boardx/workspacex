-- 系统异常的生命周期管理 + 标签（人类 2026-09-03 要求：「反馈与迭代 → 系统异常」要跟
-- 缺陷反馈一样能标签管理、能转下一步——转「已转入开发」需要一个可填写的说明字段，
-- 也可以转「不做」做存档；同一张表加标签，供筛选/搜索）。
--
-- ## 为什么不是 `product_feedback` 那一整套（domain 状态机 + 状态流水表 + GitHub issue +
--    邮件通知）
--
-- `error_logs` 与 `product_feedback` 是两类不同的东西：后者是**用户提交**的、需要
-- 回应提交人（邮件通知、GitHub issue 联动）的一条反馈；前者是**系统自动捕获**的异常，
-- 没有"提交人"这个角色要通知，本次人类要求的范围只是"状态可以往前推、可以存档、
-- 能打标签筛选"——不比照 `product_feedback` 建一张状态流水表/邮件通知/GitHub 联动，
-- 那是这个用户要求以外的范围（见 AGENTS.md「范围纪律」）。当前状态/理由/备注直接落在
-- `error_logs` 行上，不是不需要审计，是这一轮明确不做，需要时再登记 issue 补一张事件表。
--
-- ## 为什么还是走 SECURITY DEFINER 函数，不直接 GRANT UPDATE/SELECT
--
-- `error_logs` 既有边界（见 20260901024515 头注）：`app_rw` 不能裸 SELECT/UPDATE 这张表，
-- 诊断内容（msg/detail）只有 `app_diag_ro` 能读。这条边界本次不放宽——新增的
-- status/status_reason/dev_note/tags 四列同样只能通过下面两个新函数读写，`list()`
-- 改读的函数只授给 `app_diag_ro`，与既有 `kernel_read_error_logs_with_ai_summary`
-- 同一套权限模型（见该函数注释）。

ALTER TABLE error_logs ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT '待处理';
ALTER TABLE error_logs ADD COLUMN IF NOT EXISTS status_reason text;
ALTER TABLE error_logs ADD COLUMN IF NOT EXISTS dev_note text;
ALTER TABLE error_logs ADD COLUMN IF NOT EXISTS tags text[] NOT NULL DEFAULT '{}'::text[];

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'error_logs_status_check'
  ) THEN
    ALTER TABLE error_logs
      ADD CONSTRAINT error_logs_status_check CHECK (status IN ('待处理', '已转入开发', '不做'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS error_logs_status_idx ON error_logs (status);
-- GIN 索引供"按标签筛选"用（即便当前只在应用层用 `&&`/`@>`，索引先建好，
-- 不为一条以后可能要用的查询单独再开一次迁移）。
CREATE INDEX IF NOT EXISTS error_logs_tags_idx ON error_logs USING GIN (tags);

-- 用来在写之前校验转移合法性、并让"只改标签/只改备注"的局部更新不必先猜其余三列的
-- 现值——四列都是生命周期管理本身的字段，不是诊断内容（msg/detail），放行给 app_rw
-- 不违反"诊断内容只有 app_diag_ro 能读"这条边界。
CREATE OR REPLACE FUNCTION kernel_read_error_log_lifecycle(p_id bigint)
RETURNS TABLE (status text, status_reason text, dev_note text, tags text[])
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT e.status, e.status_reason, e.dev_note, e.tags FROM error_logs e WHERE e.id = p_id;
$$;

COMMENT ON FUNCTION kernel_read_error_log_lifecycle(bigint) IS
  '应用层校验生命周期转移合法性、合并局部更新用的窄口径读取——只返回生命周期四列，不是
   诊断内容（msg/detail）。';

REVOKE ALL ON FUNCTION kernel_read_error_log_lifecycle(bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION kernel_read_error_log_lifecycle(bigint) TO app_rw;

CREATE OR REPLACE FUNCTION kernel_write_error_log_lifecycle(
  p_id bigint, p_status text, p_status_reason text, p_dev_note text, p_tags text[]
)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  UPDATE error_logs
     SET status = p_status, status_reason = p_status_reason, dev_note = p_dev_note, tags = p_tags
   WHERE id = p_id;
$$;

COMMENT ON FUNCTION kernel_write_error_log_lifecycle(bigint, text, text, text, text[]) IS
  '系统异常生命周期（状态/理由/开发备注/标签）的唯一写入口。SECURITY DEFINER 以表主体
   身份运行，EXECUTE 只授给 app_rw；函数体写死了列名，app_rw 因此不能借道这个函数
   触达 msg/detail 之外的任何写权限，更不能裸 UPDATE 这张表。';

REVOKE ALL ON FUNCTION kernel_write_error_log_lifecycle(bigint, text, text, text, text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION kernel_write_error_log_lifecycle(bigint, text, text, text, text[]) TO app_rw;

-- `list()` 的新读路径——比 `kernel_read_error_logs_with_ai_summary` 多 status/
-- status_reason/dev_note/tags 四列。不能 `CREATE OR REPLACE` 旧函数改返回类型
-- （20260902160000 头注已经用真实 Postgres 验证过这一点），所以是新函数、新名字，
-- 旧函数原样保留（既有测试仍直接调用它，行为不变）。
CREATE OR REPLACE FUNCTION kernel_read_error_logs_with_lifecycle(p_limit integer, p_before_id bigint DEFAULT NULL)
RETURNS TABLE (
  id bigint, trace_id text, msg text, detail jsonb, created_at timestamptz,
  ai_title text, ai_summary text,
  status text, status_reason text, dev_note text, tags text[]
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT e.id, e.trace_id, e.msg, e.detail, e.created_at, e.ai_title, e.ai_summary,
         e.status, e.status_reason, e.dev_note, e.tags
    FROM error_logs e
   WHERE p_before_id IS NULL OR e.id < p_before_id
   ORDER BY e.id DESC
   LIMIT LEAST(GREATEST(p_limit, 0), 200);
$$;

COMMENT ON FUNCTION kernel_read_error_logs_with_lifecycle(integer, bigint) IS
  '`kernel_read_error_logs_with_ai_summary` 的替代读路径（多生命周期/标签四列）——同一套
   权限模型，EXECUTE 只授给 app_diag_ro，PUBLIC 已显式 REVOKE。';

REVOKE ALL ON FUNCTION kernel_read_error_logs_with_lifecycle(integer, bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION kernel_read_error_logs_with_lifecycle(integer, bigint) TO app_diag_ro;

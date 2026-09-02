-- 给"平台超管读系统异常"开一条读路径——但**不**把 `error_logs` 的表级 SELECT 直接
-- 授给 `app_rw`（那是本文件第一版做的事，被 `pg-error-log-writer-real-postgres.test.ts`
-- 的反证「app_rw（进程自身的运行时身份）读不到诊断内容列，不是只对新 HTTP 面收窄」
-- 抓了个正着：CI 在真实 Postgres 上验证了「运行时凭据本身也不能读」这条边界，
-- 表级 GRANT SELECT 会让**任何**拿到 app_rw 凭据的东西（不只是这条新 controller）
-- 都能读到全部诊断内容，把"只对新 HTTP 面收窄"变成了"对整个运行时进程收窄"——
-- 范围完全不对，而且直接推翻了 `20260901024515` 里刚立下的边界。
--
-- ## 这次改用什么：SECURITY DEFINER 函数，不改表级权限
--
-- `kernel_read_error_logs` 由迁移/owner 角色（表的所有者）定义，`SECURITY DEFINER`
-- 让它执行时用的是**定义者**的权限，不是调用者（`app_rw`）的权限——这与
-- `kernel_project_is_writable`（见 `20260801120000_f124_project_archive_readonly.sql`）
-- 同一个模式，同一个理由：把"能不能看到某些行"的判定收进一个参数化的函数入口，
-- 而不是把整张表的读权限交出去。`app_rw` 只拿到这一个函数的 `EXECUTE`，表本身的
-- `SELECT` 授权维持 `20260901024515` 定的样子不变（只有 `created_at` 那一列，给
-- `sweepExpiredErrorLogs` 的 DELETE WHERE 用）——`app_rw` 直接 `SELECT trace_id,
-- msg, detail FROM error_logs` 今天、以后都必须 `permission denied`，这正是那条
-- 反证测试守着的事实。
--
-- ## 为什么这仍然是"新增一条窄读路径"，不是走后门绕开边界
--
-- `SECURITY DEFINER` 函数不是无限制的：它只做一件事（按 id 游标倒序翻页
-- `error_logs`），没有可供调用方注入的动态 SQL，参数是两个标量（`p_limit`/
-- `p_before_id`），`SET search_path = public, pg_temp` 防的是经典的
-- search_path 劫持攻击（调用者在自己 schema 里放一个同名对象抢先匹配）。
-- 谁能调用这个函数、调用之后数据到不到得了 HTTP 响应，仍然由应用层的
-- `PlatformSuperuserGuard` 把守——这条迁移只解除"数据库层面结构上无法读"，
-- 不改变"谁被允许读"这件事的判定位置。
CREATE OR REPLACE FUNCTION kernel_read_error_logs(p_limit integer, p_before_id bigint DEFAULT NULL)
RETURNS TABLE (id bigint, trace_id text, msg text, detail jsonb, created_at timestamptz)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT e.id, e.trace_id, e.msg, e.detail, e.created_at
    FROM error_logs e
   WHERE p_before_id IS NULL OR e.id < p_before_id
   ORDER BY e.id DESC
   LIMIT p_limit;
$$;

COMMENT ON FUNCTION kernel_read_error_logs(integer, bigint) IS
  '平台超管专用的 error_logs 只读翻页面（system-error-log.controller.ts 的唯一读入口）。'
  'SECURITY DEFINER：以定义者（表 owner）的权限执行，app_rw 因此无需表级 SELECT 即可'
  '读到内容——这与 kernel_project_is_writable 是同一个模式。app_rw 对 error_logs 本身'
  '仍然只有 INSERT/DELETE（+ created_at 单列 SELECT，见 20260901024515），直接'
  'SELECT trace_id/msg/detail 必须 permission denied，由'
  'pg-error-log-writer-real-postgres.test.ts 的反证守着。';

GRANT EXECUTE ON FUNCTION kernel_read_error_logs(integer, bigint) TO app_rw;

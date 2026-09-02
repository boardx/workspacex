-- 拓宽 `error_logs` 的读权限：给 `app_rw` 加回表级 SELECT。
--
-- ## 为什么这不是撤销 2026-09-01 review finding #1，而是它预留的下一步
--
-- `20260901024515_error_logs.sql` 把 `app_rw` 收到只有 INSERT/DELETE，是因为
-- **当时没有任何路径需要读它**——那个 REVOKE 关掉的是"没人用、纯粹多余"的权限面，
-- 不是一条"这张表永远不可读"的产品决策。该文件自己的头注写得很清楚：
-- 把它开成 HTTP 接口是"a real access-control design task, out of scope for this
-- fix, tracked as a follow-up if ever wanted"——本迁移就是那个 follow-up：
-- 系统异常自动捕获需要在后台展示，一个只能写不能读的表撑不起这件事。
--
-- ## 为什么放行的是「人类经 AskUserQuestion 确认的最小方案」，不是默认最大权限
--
-- 人类在这次改动里被问到并明确选择了：新增一个**平台超管**概念（部署环境变量
-- 白名单，不落库、与组织角色无关），HTTP 读口只对这个身份放行，而不是对任意
-- 组织 admin 放行——`error_logs` 没有 `org_id`（基础设施自观测，很多异常发生在
-- 租户上下文确定之前），按组织角色开放会让任意一个组织的管理员看到全平台所有
-- 组织的异常详情，是一次跨租户数据泄露。这条 GRANT 只解除"app_rw 结构上无法
-- SELECT"这一层数据库权限；实际把守的是应用层的白名单判定
-- （`apps/api/src/interface/controllers/system-error-log.controller.ts`）——RLS
-- 在这里帮不上忙，因为这张表本来就不是按 `org_id`切分的租户数据，装不进
-- `withTenant` 的隔离模型。
--
-- ## 仍然不放开 UPDATE
--
-- `sweepExpiredErrorLogs` 只做 DELETE，任何读路径也只做 SELECT——`error_logs`
-- 的每一行从写入到过期删除之间都不该被改写，UPDATE 因此仍然不在 app_rw 的授权里。
GRANT SELECT ON error_logs TO app_rw;

COMMENT ON TABLE error_logs IS
  'kernel-no-tenant-data: unhandled-exception diagnostic log, deliberately has no org_id (many '
  'of the errors it records happen before any tenant context exists, e.g. a failed login). '
  'app_rw holds INSERT/DELETE/SELECT -- table-wide SELECT added 2026-09-02 for the '
  'platform-superuser-only admin read surface (system-error-log.controller.ts); read access '
  'is gated in application code (an env-var email whitelist, independent of org role), not '
  'RLS -- this table has no org_id to scope RLS on. See '
  'pg-error-log-writer.ts''s header for the original read-access boundary this widens.';

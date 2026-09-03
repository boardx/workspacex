-- 给"平台超管读系统异常"开一条读路径——用一个**与 `app_rw` 彻底分开的数据库凭据**，
-- 不是 `app_rw` 换一种语法读到同一份内容。
--
-- ## 这条迁移在同一个 PR 里错了三次，逐条记录，不删旧的失败尝试
--
-- **第一次**：直接 `GRANT SELECT ON error_logs TO app_rw`。被
-- `pg-error-log-writer-real-postgres.test.ts` 的反证「app_rw（进程自身的运行时身份）
-- 读不到诊断内容列，不是只对新 HTTP 面收窄」当场拦下——这条反证从 2026-09-01
-- （PR #2444 review finding #1）起就守着「拿到 app_rw 凭据的任何东西都不该读到
-- 诊断内容」，表级 GRANT 直接把这件事作废。
--
-- **第二次**：改用 `SECURITY DEFINER` 函数 `kernel_read_error_logs`，把 `EXECUTE`
-- 授给 `app_rw`。语法不同，**威胁模型下的暴露面完全一样**：任何能借着 `app_rw`
-- 连接跑 SQL 的东西（SQL 注入、依赖被攻破——正是 finding #1 当初要防的那类事），
-- 一样可以直接 `SELECT * FROM kernel_read_error_logs(...)` 拿到全部内容，
-- `PlatformSuperuserGuard` 完全绕过——那道 guard 挡的是 HTTP 路由，从没打算、
-- 也没有能力挡一条已经在跑原始 SQL 的连接。
--
-- **第三次**：改成新角色 `app_diag_ro`，`EXECUTE` 只授给它、不授给 `app_rw`——但漏了
-- 一步：PostgreSQL 对新建函数**默认把 `EXECUTE` 授给 `PUBLIC`**，不显式
-- `REVOKE ... FROM PUBLIC` 的话，`app_rw`（和这个数据库里的任何角色）会通过 `PUBLIC`
-- **继承**到执行权限，跟有没有对 `app_rw` 单独 `GRANT` 无关——上一步的"只授给
-- app_diag_ro"因此从未真正生效过。本仓其它受保护函数
-- （`wsx_visible_artifacts`、`wave2_publish_skill_version`、
-- `kernel_export_direction_ok`）都在 `CREATE FUNCTION` 之后立刻做这一步，这次漏掉了。
-- ## 这次真正做对：一个新角色，只有它能读
--
-- `app_diag_ro`——一个新建的、专用于这一件事的角色，**不是** `app_rw` 的别名、
-- 不共享连接池、不共享凭据（`infrastructure/db/pg-config.ts` 的
-- `diagnosticsReaderConfig()`，一个独立的 `DatabasePort` 实例，见该文件与
-- `pg-error-log-writer.ts` 的头注）。`kernel_read_error_logs` 的 `EXECUTE` 只
-- 授给 `app_diag_ro`；`app_rw` 对这个函数、对这张表，一无所有——不多不少，还是
-- `20260901024515` 定的那样（INSERT/DELETE + `created_at` 单列 SELECT）。
-- 一个被攻破的 `app_rw` 会话因此**拿不到任何新东西**：它今天不能读，明天也不能。
--
-- `app_diag_ro` 本身也不直接拿表级 `SELECT`——它只有这一个函数的 `EXECUTE`，
-- 函数内部把 `p_limit` 钳制到 200，纵深防御：就算调用方（今天只有
-- `PgErrorLogWriter.list()`，将来万一被接错）传一个夸张的 limit，也翻不出一页
-- 之外的内容。

/* ─────────────────────── ① app_diag_ro：一个新角色，先建 ─────────────────────── */

-- 必须在下面 GRANT 之前建：GRANT ... TO 一个不存在的角色会直接报错。
-- 同 0001-kernel-roles.sql 的模式：一次性写全部属性，只在漂移时才 ALTER，
-- 避免并行迁移 worker 之间的 `tuple concurrently updated`（见该文件头注的教训）。
DO $$
DECLARE
  r record;
BEGIN
  SELECT rolsuper, rolcreatedb, rolcreaterole, rolbypassrls
    INTO r FROM pg_roles WHERE rolname = 'app_diag_ro';

  IF NOT FOUND THEN
    CREATE ROLE app_diag_ro LOGIN PASSWORD 'app_diag_ro_dev'
      NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
  ELSIF r.rolsuper OR r.rolcreatedb OR r.rolcreaterole OR r.rolbypassrls THEN
    ALTER ROLE app_diag_ro NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
  END IF;
END
$$;

-- Usage 且仅 usage：这个角色不该能建任何东西，也不该默认继承 public 上的其它权限。
REVOKE ALL ON SCHEMA public FROM app_diag_ro;
GRANT USAGE ON SCHEMA public TO app_diag_ro;

/* ─────────────────────── ② 读函数，只对 app_diag_ro 开放 ─────────────────────── */

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
   LIMIT LEAST(GREATEST(p_limit, 0), 200);
$$;

COMMENT ON FUNCTION kernel_read_error_logs(integer, bigint) IS
  '平台超管专用的 error_logs 只读翻页面。EXECUTE 只授给 app_diag_ro——一个与 app_rw '
  '彻底分开的凭据，见 pg-config.ts 的 diagnosticsReaderConfig()。PUBLIC 已显式 REVOKE，'
  'app_rw 对这个函数、对这张表一无所有；直接 SELECT trace_id/msg/detail 必须 '
  'permission denied，由 pg-error-log-writer-real-postgres.test.ts 的反证守着。'
  'p_limit 在函数内部钳制到 200，纵深防御，不依赖调用方守规矩。';

-- ⚠ 必须在 GRANT 给 app_diag_ro 之前——PostgreSQL 新建函数默认对 PUBLIC 开放
--   EXECUTE，不显式收回的话，app_rw 会通过 PUBLIC 继承到执行权限，跟有没有单独
--   GRANT 给它无关（本文件"第三次犯的错"，见文件头）。同 wsx_visible_artifacts /
--   wave2_publish_skill_version / kernel_export_direction_ok 的既有模式。
REVOKE ALL ON FUNCTION kernel_read_error_logs(integer, bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION kernel_read_error_logs(integer, bigint) TO app_diag_ro;

-- ⚠ 明确不授给 app_rw——这是本文件第二次尝试犯的错，写在这里防止有人以为漏了一行
--   而"补上"。app_rw 对本函数没有、也不该有任何权限。

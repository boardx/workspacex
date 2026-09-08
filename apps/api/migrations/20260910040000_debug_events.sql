-- `debug_events` -- 后台 debug recorder 的落盘表（issue #3082，源自 #2873 的复盘）。
--
-- `error_logs` 只在异常抛出来那一刻有一行；这张表记的是**围绕它发生了什么**：每个 HTTP
-- 请求的结果与耗时、卡住超过阈值的请求、未处理异常、业务显式打的诊断点，全部带 trace_id
-- 串联。写入由 `DebugRecorder` 批量完成（`application/diagnostics/debug-recorder.ts`）。
--
-- ⚠ 与 `error_logs` 同一条纪律，故意 NO `org_id`：这是基础设施自我观测，很多事件发生在
--   租户上下文之前（登录、健康探测、被 guard 拒掉的请求）。`org_id` 作为普通列存在
--   （可为 NULL，纯粹是查询过滤用），但**不是**租户归属——`lint-permission-paths.mjs` 按
--   `org_id` 列判"租户表"，所以这里的列名叫 `org_ref`，避免被误判成需要 RLS 的租户表。
--
-- ## 权限边界（照抄 error_logs 的三层，见 20260901024515 / 20260902012105 头注）
-- - `app_rw`：INSERT（写）、DELETE + SELECT(id, created_at)（保留期/条数裁剪的 WHERE 需要）、
--   序列 USAGE。**没有**表级 SELECT——运行时角色读不到诊断内容。
-- - `app_diag_ro`：只有两个 SECURITY DEFINER 读函数的 EXECUTE，控制器经
--   `DIAGNOSTICS_READER_DB_PORT` 调用。PUBLIC 显式 REVOKE。
CREATE TABLE IF NOT EXISTS debug_events (
  id          BIGSERIAL PRIMARY KEY,
  trace_id    TEXT NOT NULL,
  kind        TEXT NOT NULL,
  level       TEXT NOT NULL CHECK (level IN ('info', 'warn', 'error')),
  msg         TEXT NOT NULL,
  data        JSONB,
  duration_ms INTEGER,
  user_ref    TEXT,
  org_ref     TEXT,
  created_at  TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS debug_events_trace_id_idx ON debug_events (trace_id, id);
CREATE INDEX IF NOT EXISTS debug_events_created_at_idx ON debug_events (created_at);
CREATE INDEX IF NOT EXISTS debug_events_kind_idx ON debug_events (kind, id DESC);
CREATE INDEX IF NOT EXISTS debug_events_level_idx ON debug_events (level, id DESC) WHERE level <> 'info';

REVOKE ALL ON debug_events FROM app_rw;
GRANT INSERT, DELETE ON debug_events TO app_rw;
GRANT SELECT (id, created_at) ON debug_events TO app_rw;
GRANT USAGE ON SEQUENCE debug_events_id_seq TO app_rw;

COMMENT ON TABLE debug_events IS
  'kernel-no-tenant-data: debug recorder 的结构化诊断事件流（请求流水/卡住请求/异常/业务打点），'
  '故意没有 org_id（org_ref 只是过滤用的引用列，不是租户归属）。app_rw 只有 INSERT/DELETE '
  '与 (id, created_at) 的 SELECT；诊断内容只能经 kernel_read_debug_events / '
  'kernel_read_debug_trace 由 app_diag_ro 读。见 apps/api/src/application/ports/debug-trace.port.ts。';

/* ─────────────────────── 读函数：只对 app_diag_ro 开放 ─────────────────────── */

CREATE OR REPLACE FUNCTION kernel_read_debug_events(
  p_limit     integer,
  p_before_id bigint       DEFAULT NULL,
  p_trace_id  text         DEFAULT NULL,
  p_kind      text         DEFAULT NULL,
  p_level     text         DEFAULT NULL,
  p_since     timestamptz  DEFAULT NULL,
  p_until     timestamptz  DEFAULT NULL,
  p_q         text         DEFAULT NULL,
  p_user_ref  text         DEFAULT NULL
)
RETURNS TABLE (
  id bigint, trace_id text, kind text, level text, msg text, data jsonb,
  duration_ms integer, user_ref text, org_ref text, created_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT e.id, e.trace_id, e.kind, e.level, e.msg, e.data,
         e.duration_ms, e.user_ref, e.org_ref, e.created_at
    FROM debug_events e
   WHERE (p_before_id IS NULL OR e.id < p_before_id)
     AND (p_trace_id  IS NULL OR e.trace_id = p_trace_id)
     -- kind 前缀匹配：`agent_run` 命中 `agent_run.started` / `agent_run.failed` …
     AND (p_kind      IS NULL OR e.kind = p_kind OR e.kind LIKE p_kind || '.%')
     AND (p_level     IS NULL OR e.level = p_level)
     AND (p_since     IS NULL OR e.created_at >= p_since)
     AND (p_until     IS NULL OR e.created_at <= p_until)
     AND (p_q         IS NULL OR e.msg ILIKE '%' || p_q || '%')
     AND (p_user_ref  IS NULL OR e.user_ref = p_user_ref)
   ORDER BY e.id DESC
   LIMIT LEAST(GREATEST(p_limit, 0), 501);
$$;

CREATE OR REPLACE FUNCTION kernel_read_debug_trace(p_trace_id text)
RETURNS TABLE (
  id bigint, trace_id text, kind text, level text, msg text, data jsonb,
  duration_ms integer, user_ref text, org_ref text, created_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT e.id, e.trace_id, e.kind, e.level, e.msg, e.data,
         e.duration_ms, e.user_ref, e.org_ref, e.created_at
    FROM debug_events e
   WHERE e.trace_id = p_trace_id
   ORDER BY e.created_at ASC, e.id ASC
   LIMIT 2000;
$$;

-- ⚠ 先 REVOKE PUBLIC 再 GRANT：新建函数默认对 PUBLIC 开放 EXECUTE（20260902012105 头注的教训）。
REVOKE ALL ON FUNCTION kernel_read_debug_events(integer, bigint, text, text, text, timestamptz, timestamptz, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION kernel_read_debug_events(integer, bigint, text, text, text, timestamptz, timestamptz, text, text) TO app_diag_ro;
REVOKE ALL ON FUNCTION kernel_read_debug_trace(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION kernel_read_debug_trace(text) TO app_diag_ro;

COMMENT ON FUNCTION kernel_read_debug_trace(text) IS
  '一条链路（trace_id）的全部诊断事件，按时间正序。EXECUTE 只授 app_diag_ro，app_rw 无权。';
COMMENT ON FUNCTION kernel_read_debug_events(integer, bigint, text, text, text, timestamptz, timestamptz, text, text) IS
  '按条件倒序翻页 debug_events（id 游标）。p_limit 内部钳到 501（调用方多取一条判 hasMore）。EXECUTE 只授 app_diag_ro。';

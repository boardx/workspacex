-- D9 —— `health.queueDepth` 的真实来源（issue #4225）。
--
-- `ingestion_outbox` 是 RLS FORCE 的租户表，上报方在 withoutTenant（无租户上下文）会话里直接
-- `SELECT count(*)` 永远读到 0。同 `kernel_benchmark_counts_for_report()` 一样给一个 SECURITY DEFINER
-- 的唯一读口，且更窄：**只回一个计数**——`pending` 状态的出站任务条数，不回任何行、列值或组织标识。
-- 只算 kind = 'organization' 的组织——personal-local 在函数体内就被 JOIN 条件排除（D16/D22）。
--
-- 可重放：CREATE OR REPLACE。
CREATE OR REPLACE FUNCTION kernel_queue_depth_for_report()
RETURNS bigint
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
  SELECT count(*) FROM ingestion_outbox q JOIN organizations o ON o.id = q.org_id AND o.kind = 'organization'
    WHERE q.status = 'pending'
$$;
REVOKE ALL ON FUNCTION kernel_queue_depth_for_report() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION kernel_queue_depth_for_report() TO app_rw;

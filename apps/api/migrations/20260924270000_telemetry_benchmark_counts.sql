-- D9 —— `benchmark.runsPerSeatPerWeek` 的真实来源（契约 `instanceTelemetry.TelemetryBenchmark`，ACCEPTED）。
--
-- 上报方在 withoutTenant 下读不到 RLS FORCE 的租户表，于是同 `kernel_first_value_facts_for_report()`
-- 一样给一个 SECURITY DEFINER 的唯一读口，但更窄：**只回一行两个计数**，不回任何行、列值或组织标识。
--   · run_count  = 周期 (p_start, p_end] 内 `agent_runs` 的条数（每条 = 一次 agent 运行）；
--   · seat_count = 当前 `org_memberships` 里的不同 user_id 数（席位）。
-- 两者都只算 kind = 'organization' 的组织——personal-local 在函数体内就被 JOIN 条件排除（D16/D22）。
--
-- 可重放：CREATE OR REPLACE。
CREATE OR REPLACE FUNCTION kernel_benchmark_counts_for_report(p_start timestamptz, p_end timestamptz)
RETURNS TABLE(run_count bigint, seat_count bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
  SELECT
    (SELECT count(*) FROM agent_runs r JOIN organizations o ON o.id = r.org_id AND o.kind = 'organization'
      WHERE r.created_at > p_start AND r.created_at <= p_end),
    (SELECT count(DISTINCT m.user_id) FROM org_memberships m JOIN organizations o ON o.id = m.org_id AND o.kind = 'organization')
$$;
REVOKE ALL ON FUNCTION kernel_benchmark_counts_for_report(timestamptz, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION kernel_benchmark_counts_for_report(timestamptz, timestamptz) TO app_rw;

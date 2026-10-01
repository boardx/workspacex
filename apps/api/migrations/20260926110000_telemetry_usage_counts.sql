-- D9 —— `usage` 分节（契约 `instanceTelemetry.TelemetryUsage`，ACCEPTED）的真实来源，#4226。
--
-- 同 `kernel_benchmark_counts_for_report()`：上报方在 withoutTenant 下读不到 RLS FORCE 的租户表，
-- 于是给一个 SECURITY DEFINER 的唯一读口，**只回一行计数**，不回任何行、组织标识或内容列值：
--   · run_count          = 周期 (p_start, p_end] 内 `agent_runs` 条数；
--   · token_count        = 周期内 `token_usage_events.tokens_total` 之和；
--   · seat_count         = 当前 `org_memberships` 不同 user_id 数；
--   · organization_count = kind = 'organization' 的组织数；
--   · capability_runs    = {能力编号: 周期内运行数}。能力编号来自运行快照 `agent_runs.skill_version_ids`
--     指向的 `skill_versions.manifest->>'capabilityId'`——starter pack 导入时按 digest 校验过的包清单原样写入
--     （源头是各 SKILL.md frontmatter 的 `capability_id`）。清单里没有、或不符合契约格式的技能**不计入**
--     （不编号、不猜）。一次运行挂多个同编号技能只计一次。
-- 全部子查询都 JOIN organizations 限定 kind = 'organization'——personal-local 在函数体内排除（D16/D22）。
--
-- 可重放：CREATE OR REPLACE。
CREATE OR REPLACE FUNCTION kernel_usage_counts_for_report(p_start timestamptz, p_end timestamptz)
RETURNS TABLE(run_count bigint, token_count bigint, seat_count bigint, organization_count bigint, capability_runs jsonb)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
  SELECT
    (SELECT count(*) FROM agent_runs r JOIN organizations o ON o.id = r.org_id AND o.kind = 'organization'
      WHERE r.created_at > p_start AND r.created_at <= p_end),
    (SELECT coalesce(sum(t.tokens_total), 0)::bigint FROM token_usage_events t JOIN organizations o ON o.id = t.org_id AND o.kind = 'organization'
      WHERE t.occurred_at > p_start AND t.occurred_at <= p_end),
    (SELECT count(DISTINCT m.user_id) FROM org_memberships m JOIN organizations o ON o.id = m.org_id AND o.kind = 'organization'),
    (SELECT count(*) FROM organizations o WHERE o.kind = 'organization'),
    (SELECT coalesce(jsonb_object_agg(c.capability_id, c.n), '{}'::jsonb) FROM (
      SELECT v.manifest->>'capabilityId' AS capability_id, count(DISTINCT r.id) AS n
        FROM agent_runs r JOIN organizations o ON o.id = r.org_id AND o.kind = 'organization'
        CROSS JOIN LATERAL jsonb_array_elements_text(r.skill_version_ids) AS sv(version_id)
        JOIN skill_versions v ON v.id = sv.version_id
       WHERE r.created_at > p_start AND r.created_at <= p_end
         AND v.manifest->>'capabilityId' ~ '^(WX-S[0-9]+|[a-z][a-z0-9]*-[A-Za-z0-9._-]{1,48})$'
       GROUP BY 1 ORDER BY 2 DESC, 1 LIMIT 500) c)
$$;
REVOKE ALL ON FUNCTION kernel_usage_counts_for_report(timestamptz, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION kernel_usage_counts_for_report(timestamptz, timestamptz) TO app_rw;

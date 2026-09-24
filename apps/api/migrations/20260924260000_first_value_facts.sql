-- backlog E3 —— 第一个价值时刻的本地事实（契约 `first-value-events.ts` 的 `FirstValueLocalFact`，D33）。
--
-- 每个组织每一步至多一行：`(org_id, step)` 唯一，写入用 ON CONFLICT DO NOTHING ⇒ **先写者胜**，
-- `occurred_at` 永远是第一次发生的时刻。只有步名与时刻，**无任何自由文本**——本表永不离开实例；
-- 上报方（`pg-telemetry-facts.ts`）只把它聚合成计数，且仅在 `usage` / `benchmark` 同意开启时。
--
-- `org_kind` 在写入时由 organizations.kind 派生（不是调用方自报），以便上报 SQL 在本表内就能排除
-- personal-local。步名取值的唯一事实源是契约 `FirstValueStep`，这里不复述枚举 CHECK
-- （写入侧只接受契约枚举，见 `pg-first-value-facts.ts`）。
--
-- 可重放：IF NOT EXISTS / DROP-then-CREATE。
CREATE TABLE IF NOT EXISTS first_value_facts (
  org_id      text NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  org_kind    text NOT NULL CHECK (org_kind IN ('organization', 'personal-local')),
  step        text NOT NULL CHECK (step ~ '^[a-z_]{1,64}$'),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, step)
);

ALTER TABLE first_value_facts ENABLE ROW LEVEL SECURITY;
ALTER TABLE first_value_facts FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS first_value_facts_tenant ON first_value_facts;
CREATE POLICY first_value_facts_tenant ON first_value_facts
  USING (org_id = current_setting('app.current_org', true))
  WITH CHECK (org_id = current_setting('app.current_org', true));

GRANT SELECT, INSERT ON first_value_facts TO app_rw;

-- F22 的停用冻结：新建租户表必须自己补这一次调用。
SELECT kernel_apply_org_freeze_policies();

-- 上报方的唯一跨租户读口（RLS FORCE 下 withoutTenant 读不到任何行）。SECURITY DEFINER，但：
--   · 在函数体内就排除 personal-local（D16/D22）；
--   · 不返回 org_id，只返回一个本次调用内的序号 `org_ref`（dense_rank），离开数据库的
--     行里没有任何可识别组织的东西——上报方只拿它在内存里做「每组织最早时刻」聚合。
CREATE OR REPLACE FUNCTION kernel_first_value_facts_for_report()
RETURNS TABLE(org_ref bigint, step text, occurred_at timestamptz)
LANGUAGE sql SECURITY DEFINER SET search_path=public,pg_temp AS $$
  SELECT dense_rank() OVER (ORDER BY f.org_id), f.step, f.occurred_at
    FROM first_value_facts f
   WHERE f.org_kind = 'organization'
$$;
REVOKE ALL ON FUNCTION kernel_first_value_facts_for_report() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION kernel_first_value_facts_for_report() TO app_rw;

COMMENT ON TABLE first_value_facts IS
  'E3 第一个价值时刻本地事实：每组织每步第一次发生的时刻（先写者胜）。永不离开实例；上报只取聚合计数。';

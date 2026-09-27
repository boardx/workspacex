/**
 * D9 —— 运行事实的 SQL 来源。**本文件只许碰 `TELEMETRY_FACT_TABLES` 里的表**，且只取计数 / 比率 /
 * 状态列——不读任何客户内容表。由 `tests/telemetry/telemetry-no-content-tables.test.ts`
 * 静态扫描本文件所有 FROM/JOIN 引用的表机械核对（能红）。
 *
 * 各字段来源：
 * - `uptimeRatio` / `latencyP50Ms` / `latencyP95Ms`：周期内 `service_uptime_checks` 的探活记录
 *   （实例自我探活，见 issue #2645）。周期内 0 条 ⇒ 无真实来源 ⇒ 整节缺席（返回 `null`）。
 * - `queueDepth`：`kernel_queue_depth_for_report()`——SECURITY DEFINER 函数（`ingestion_outbox` 是 RLS FORCE，
 *   withoutTenant 直读恒为 0，#4225），函数体内数 `pending` 行，**只算 `kind = 'organization'` 的组织**
 *   ——`personal-local` 组织的行在函数体内就被 JOIN 条件排除；只回一个计数。
 * - `diskUsedRatio`：本进程工作目录所在文件系统的 `statfs`。
 * - `migrationVersion`：`_kernel_migrations` 已应用的迁移条数，补零到 4 位（迁移文件名是时间戳，
 *   契约要 4 位数字，条数是能如实给出的单调版本号）。
 * - `firstValueFacts`（E3）：`kernel_first_value_facts_for_report()`——SECURITY DEFINER 函数，函数体内
 *   就排除 personal-local，且只回 `org_ref`（本次调用内的 dense_rank 序号）而不是 org_id；这里再把序号
 *   拼成契约要求形状的不透明本地标识，只在内存里交给契约 `aggregateFirstValueFunnel` /
 *   `firstValueMedianMinutes` 聚合成计数。
 * - `runsPerSeatPerWeek`（benchmark）：`kernel_benchmark_counts_for_report(start, end)`——SECURITY DEFINER
 *   函数，函数体内连接组织表限定 kind = 'organization'，只回一行两个计数：周期内 `agent_runs` 条数、
 *   当前 `org_memberships` 不同 user_id 数。= run_count / seat_count / 周期周数。seat_count = 0 ⇒ 分母
 *   不存在 ⇒ `null`（整节缺席，不造数）。
 * - `usageBase`：`kernel_usage_counts_for_report(start, end)`——SECURITY DEFINER 函数（#4226），函数体内每个子查询
 *   都连接组织表限定 kind = 'organization'，只回一行计数：runCount（agent_runs）/ tokenCount
 *   （token_usage_events.tokens_total 之和）/ seatCount / organizationCount / 按能力编号分组的运行数。能力编号
 *   来自运行快照指向的 `skill_versions.manifest.capabilityId`（starter pack 导入时从包清单原样写入，源头是
 *   SKILL.md frontmatter 的 `capability_id`）；没有编号的技能不计入 skillPackRuns（不编号、不猜）。这里再按契约
 *   逐条校验一次，不合格的编号丢弃。函数无行 ⇒ `null`（整节缺席）。
 */
import { statfs } from "node:fs/promises";
import { firstValueEvents as FV, instanceTelemetry as T } from "@repo/contracts";
import type { DatabasePort } from "../../application/ports/database.port";
import type {
  FirstValueLocalFact, TelemetryFactsSource, TelemetryHealthFacts, TelemetryUsageBase,
} from "../../application/telemetry/telemetry-ports";

/** 白名单：上报方允许读取的全部表。加表 = 改这里 + 过静态门评审。 */
export const TELEMETRY_FACT_TABLES = [
  "service_uptime_checks", "_kernel_migrations",
  // queueDepth：只经这个函数取一个计数（ingestion_outbox 是 RLS FORCE，直读恒 0，#4225）。
  "kernel_queue_depth_for_report",
  // E3：只经这个函数读 first_value_facts（已排除 personal-local、不回 org_id）。
  "kernel_first_value_facts_for_report",
  // benchmark：只经这个函数取两个计数（已排除 personal-local、不回任何行）。
  "kernel_benchmark_counts_for_report",
  // usage：只经这个函数取计数（已排除 personal-local、不回任何行；token_usage_events 只能经它读）。
  "kernel_usage_counts_for_report",
] as const;

const UPTIME_SQL = `SELECT count(*)::int AS total,
       count(*) FILTER (WHERE is_up)::int AS up,
       percentile_cont(0.5) WITHIN GROUP (ORDER BY latency_ms) FILTER (WHERE is_up AND latency_ms IS NOT NULL) AS p50,
       percentile_cont(0.95) WITHIN GROUP (ORDER BY latency_ms) FILTER (WHERE is_up AND latency_ms IS NOT NULL) AS p95
  FROM service_uptime_checks
 WHERE checked_at > $1 AND checked_at <= $2`;

const QUEUE_SQL = `SELECT q::int AS n FROM kernel_queue_depth_for_report() AS q`;

const MIGRATIONS_SQL = `SELECT count(*)::int AS n FROM _kernel_migrations`;

const FIRST_VALUE_SQL = `SELECT org_ref, step, occurred_at FROM kernel_first_value_facts_for_report()`;

const BENCHMARK_SQL = `SELECT run_count, seat_count FROM kernel_benchmark_counts_for_report($1, $2)`;

const USAGE_SQL = `SELECT run_count, token_count, seat_count, organization_count, capability_runs FROM kernel_usage_counts_for_report($1, $2)`;

const SkillPackRun = T.TelemetryUsage.shape.skillPackRuns.element;

/** 纯函数：把函数回的一行计数折成契约形状；编号不合契约的条目丢弃（不改写、不猜）。 */
export function usageBaseFrom(row: {
  run_count: string | number; token_count: string | number; seat_count: string | number;
  organization_count: string | number; capability_runs: Record<string, string | number> | null;
}): TelemetryUsageBase {
  const skillPackRuns = Object.entries(row.capability_runs ?? {})
    .map(([capabilityId, n]) => SkillPackRun.safeParse({ capabilityId, runCount: Number(n) }))
    .flatMap((r) => (r.success ? [r.data] : []))
    .sort((a, b) => b.runCount - a.runCount || a.capabilityId.localeCompare(b.capabilityId))
    .slice(0, 500);
  return {
    runCount: Number(row.run_count),
    tokenCount: Number(row.token_count),
    seatCount: Number(row.seat_count),
    organizationCount: Number(row.organization_count),
    skillPackRuns,
  };
}

const WEEK_MS = 7 * 86_400_000;

/** 纯算术：无席位或周期非正 ⇒ 无分母 ⇒ `null`。 */
export function runsPerSeatPerWeekFrom(runCount: number, seatCount: number, periodMs: number): number | null {
  if (!(seatCount > 0) || !(periodMs > 0) || !(runCount >= 0)) return null;
  return runCount / seatCount / (periodMs / WEEK_MS);
}

export class PgTelemetryFacts implements TelemetryFactsSource {
  constructor(
    private readonly db: DatabasePort,
    private readonly diskPath: string = process.cwd(),
  ) {}

  async health(periodStart: Date, periodEnd: Date): Promise<{ facts: TelemetryHealthFacts; personalLocalExcluded: true } | null> {
    return this.db.withoutTenant(async (s) => {
      const u = (await s.query<{ total: number; up: number; p50: number | null; p95: number | null }>(UPTIME_SQL, [periodStart, periodEnd])).rows[0];
      if (!u || u.total === 0) return null;
      const queue = (await s.query<{ n: number }>(QUEUE_SQL)).rows[0]?.n ?? 0;
      const migrations = (await s.query<{ n: number }>(MIGRATIONS_SQL)).rows[0]?.n ?? 0;
      if (migrations > 9999) return null;
      const fs = await statfs(this.diskPath);
      const diskUsedRatio = fs.blocks > 0 ? Math.min(1, Math.max(0, (fs.blocks - fs.bfree) / fs.blocks)) : 0;
      return {
        facts: {
          uptimeRatio: u.up / u.total,
          latencyP50Ms: Number(u.p50 ?? 0),
          latencyP95Ms: Number(u.p95 ?? 0),
          queueDepth: queue,
          diskUsedRatio,
          migrationVersion: String(migrations).padStart(4, "0"),
        },
        personalLocalExcluded: true,
      };
    });
  }

  async firstValueFacts(): Promise<{ facts: readonly FirstValueLocalFact[]; personalLocalExcluded: true }> {
    const rows = await this.db.withoutTenant(async (s) =>
      (await s.query<{ org_ref: string | number; step: string; occurred_at: Date }>(FIRST_VALUE_SQL)).rows);
    const facts: FirstValueLocalFact[] = [];
    for (const r of rows) {
      const parsed = FV.FirstValueLocalFact.safeParse({
        orgId: `org-r${String(r.org_ref)}`,
        orgKind: "standard",
        step: r.step,
        occurredAt: new Date(r.occurred_at).toISOString(),
      });
      if (parsed.success) facts.push(parsed.data);
    }
    return { facts, personalLocalExcluded: true };
  }

  async usageBase(periodStart: Date, periodEnd: Date): Promise<TelemetryUsageBase | null> {
    const row = await this.db.withoutTenant(async (s) =>
      (await s.query<Parameters<typeof usageBaseFrom>[0]>(USAGE_SQL, [periodStart, periodEnd])).rows[0]);
    return row ? usageBaseFrom(row) : null;
  }

  async runsPerSeatPerWeek(periodStart: Date, periodEnd: Date): Promise<number | null> {
    const row = await this.db.withoutTenant(async (s) =>
      (await s.query<{ run_count: string | number; seat_count: string | number }>(BENCHMARK_SQL, [periodStart, periodEnd])).rows[0]);
    if (!row) return null;
    return runsPerSeatPerWeekFrom(Number(row.run_count), Number(row.seat_count), periodEnd.getTime() - periodStart.getTime());
  }
}

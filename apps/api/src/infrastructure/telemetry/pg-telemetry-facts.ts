/**
 * D9 —— 运行事实的 SQL 来源。**本文件只许碰 `TELEMETRY_FACT_TABLES` 里的表**，且只取计数 / 比率 /
 * 状态列——不读任何客户内容表。由 `tests/telemetry/telemetry-no-content-tables.test.ts`
 * 静态扫描本文件所有 FROM/JOIN 引用的表机械核对（能红）。
 *
 * 各字段来源：
 * - `uptimeRatio` / `latencyP50Ms` / `latencyP95Ms`：周期内 `service_uptime_checks` 的探活记录
 *   （实例自我探活，见 issue #2645）。周期内 0 条 ⇒ 无真实来源 ⇒ 整节缺席（返回 `null`）。
 * - `queueDepth`：`ingestion_outbox` 中 `pending` 行数，**只算 `kind = 'organization'` 的组织**
 *   ——`personal-local` 组织的行在 SQL 层就被 JOIN 条件排除。
 * - `diskUsedRatio`：本进程工作目录所在文件系统的 `statfs`。
 * - `migrationVersion`：`_kernel_migrations` 已应用的迁移条数，补零到 4 位（迁移文件名是时间戳，
 *   契约要 4 位数字，条数是能如实给出的单调版本号）。
 * - `firstValueFacts`（E3）：`kernel_first_value_facts_for_report()`——SECURITY DEFINER 函数，函数体内
 *   就排除 personal-local，且只回 `org_ref`（本次调用内的 dense_rank 序号）而不是 org_id；这里再把序号
 *   拼成契约要求形状的不透明本地标识，只在内存里交给契约 `aggregateFirstValueFunnel` /
 *   `firstValueMedianMinutes` 聚合成计数。
 * - `usageBase` / `runsPerSeatPerWeek`：本实例尚无真实来源（skillPackRuns 能力编号映射不存在）⇒ `null`。
 */
import { statfs } from "node:fs/promises";
import { firstValueEvents as FV } from "@repo/contracts";
import type { DatabasePort } from "../../application/ports/database.port";
import type {
  FirstValueLocalFact, TelemetryFactsSource, TelemetryHealthFacts, TelemetryUsageBase,
} from "../../application/telemetry/telemetry-ports";

/** 白名单：上报方允许读取的全部表。加表 = 改这里 + 过静态门评审。 */
export const TELEMETRY_FACT_TABLES = [
  "service_uptime_checks", "ingestion_outbox", "organizations", "_kernel_migrations",
  // E3：只经这个函数读 first_value_facts（已排除 personal-local、不回 org_id）。
  "kernel_first_value_facts_for_report",
] as const;

const UPTIME_SQL = `SELECT count(*)::int AS total,
       count(*) FILTER (WHERE is_up)::int AS up,
       percentile_cont(0.5) WITHIN GROUP (ORDER BY latency_ms) FILTER (WHERE is_up AND latency_ms IS NOT NULL) AS p50,
       percentile_cont(0.95) WITHIN GROUP (ORDER BY latency_ms) FILTER (WHERE is_up AND latency_ms IS NOT NULL) AS p95
  FROM service_uptime_checks
 WHERE checked_at > $1 AND checked_at <= $2`;

const QUEUE_SQL = `SELECT count(*)::int AS n
  FROM ingestion_outbox q
  JOIN organizations o ON o.id = q.org_id AND o.kind = 'organization'
 WHERE q.status = 'pending'`;

const MIGRATIONS_SQL = `SELECT count(*)::int AS n FROM _kernel_migrations`;

const FIRST_VALUE_SQL = `SELECT org_ref, step, occurred_at FROM kernel_first_value_facts_for_report()`;

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

  async usageBase(): Promise<TelemetryUsageBase | null> {
    return null;
  }

  async runsPerSeatPerWeek(): Promise<number | null> {
    return null;
  }
}

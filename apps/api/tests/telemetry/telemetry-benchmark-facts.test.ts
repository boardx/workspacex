/**
 * D9 benchmark 来源：`runsPerSeatPerWeek` 只经 `kernel_benchmark_counts_for_report()` 取两个计数；
 * 函数体排除 personal-local、只回计数；无席位 ⇒ `null`（整节缺席）；`usageBase` 仍缺席（skillPackRuns 无来源）。
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { instanceTelemetry as T } from "@repo/contracts";
import type { DatabasePort, TenantSession } from "../../src/application/ports/database.port";
import { PgTelemetryFacts, runsPerSeatPerWeekFrom } from "../../src/infrastructure/telemetry/pg-telemetry-facts";

/** 与 telemetry-no-content-tables.test.ts 同一扫描规则（不 import 测试文件以免重复注册用例）。 */
const referencedTables = (src: string): string[] =>
  [...new Set([...src.matchAll(/\b(?:FROM|JOIN)\s+([a-z_][a-z0-9_.]*)/gi)].map((m) => m[1]!.toLowerCase()))];

const MIGRATION = join(import.meta.dirname, "../../migrations/20260924270000_telemetry_benchmark_counts.sql");
const SRC = join(import.meta.dirname, "../../src/infrastructure/telemetry/pg-telemetry-facts.ts");

function fakeDb(rows: Record<string, unknown>[]): DatabasePort & { calls: { sql: string; params?: readonly unknown[] }[] } {
  const calls: { sql: string; params?: readonly unknown[] }[] = [];
  const s: TenantSession = { query: async (sql, params) => { calls.push({ sql, params }); return { rows: rows as never[], rowCount: rows.length } as never; } };
  type Fn = (s: TenantSession) => Promise<unknown>;
  return { calls, withTenant: async (_o: unknown, fn: Fn) => fn(s), withoutTenant: async (fn: Fn) => fn(s) } as never;
}

const start = new Date("2026-09-23T00:00:00Z");
const end = new Date("2026-09-24T00:00:00Z");

describe("runsPerSeatPerWeek 的真实来源", () => {
  it("一天 14 次运行、2 个席位 ⇒ 每席每周 49；结果能过契约 TelemetryBenchmark", async () => {
    const db = fakeDb([{ run_count: "14", seat_count: "2" }]);
    const rps = await new PgTelemetryFacts(db).runsPerSeatPerWeek(start, end);
    expect(rps).toBeCloseTo(49);
    expect(db.calls[0]!.sql).toMatch(/FROM kernel_benchmark_counts_for_report\(\$1, \$2\)/);
    expect(db.calls[0]!.params).toEqual([start, end]);
    expect(T.TelemetryBenchmark.safeParse({ runsPerSeatPerWeek: rps, firstValueMedianMinutes: 10 }).success).toBe(true);
  });

  it("反例：零席位 / 函数无行 ⇒ null（分母不存在，不造数）", async () => {
    expect(await new PgTelemetryFacts(fakeDb([{ run_count: 5, seat_count: 0 }])).runsPerSeatPerWeek(start, end)).toBeNull();
    expect(await new PgTelemetryFacts(fakeDb([])).runsPerSeatPerWeek(start, end)).toBeNull();
    expect(runsPerSeatPerWeekFrom(3, 1, 0)).toBeNull();
    expect(runsPerSeatPerWeekFrom(0, 4, 86_400_000)).toBe(0);
  });

  it("usageBase 仍缺席：skillPackRuns 的能力编号没有来源，不以空数组冒充零次运行", async () => {
    const db = fakeDb([]);
    expect(await new PgTelemetryFacts(db).usageBase()).toBeNull();
    expect(db.calls).toEqual([]);
  });
});

const fnBody = (sql: string): string =>
  /FUNCTION kernel_benchmark_counts_for_report\([^)]*\)[\s\S]*?AS \$\$([\s\S]*?)\$\$/.exec(sql)?.[1] ?? "";

/** 顶层 SELECT 列表里每一项都必须是一个 `(SELECT count(...) FROM ... JOIN organizations o ... kind = 'organization' ...)` 子查询。 */
function benchmarkBodyViolations(body: string): string[] {
  const bad: string[] = [];
  if (body.trim().length === 0) return ["empty"];
  const subs = [...body.matchAll(/\(SELECT\s+([\s\S]*?)\s+FROM\s+([\s\S]*?)\)(?:,|\s*$)/g)];
  if (subs.length !== 2) bad.push(`expected 2 count subqueries, got ${subs.length}`);
  for (const m of subs) {
    if (!/^count\((\*|DISTINCT \w+\.user_id)\)$/.test(m[1]!.trim())) bad.push(`non-count select: ${m[1]}`);
    if (!/JOIN organizations o ON o\.id = \w+\.org_id AND o\.kind = 'organization'/.test(m[2]!)) bad.push(`no personal-local exclusion: ${m[2]}`);
  }
  for (const t of referencedTables(body)) if (!["agent_runs", "org_memberships", "organizations"].includes(t)) bad.push(`table ${t}`);
  return bad;
}

describe("kernel_benchmark_counts_for_report：只回计数、排除 personal-local", () => {
  it("迁移里的函数体合规，上报方只经函数读、不直接碰 agent_runs / org_memberships", () => {
    expect(benchmarkBodyViolations(fnBody(readFileSync(MIGRATION, "utf8")))).toEqual([]);
    const tables = referencedTables(readFileSync(SRC, "utf8"));
    expect(tables).toContain("kernel_benchmark_counts_for_report");
    expect(tables).not.toContain("agent_runs");
    expect(tables).not.toContain("org_memberships");
  });

  it("自检：回 user_id、漏掉 kind 限定、读内容表 ⇒ 门会红", () => {
    const wrap = (b: string) => fnBody(`CREATE FUNCTION kernel_benchmark_counts_for_report(a timestamptz, b timestamptz) AS $$${b}$$`);
    expect(benchmarkBodyViolations(wrap(`SELECT (SELECT m.user_id FROM org_memberships m JOIN organizations o ON o.id = m.org_id AND o.kind = 'organization'), (SELECT count(*) FROM agent_runs r JOIN organizations o ON o.id = r.org_id AND o.kind = 'organization')`))).not.toEqual([]);
    expect(benchmarkBodyViolations(wrap(`SELECT (SELECT count(*) FROM agent_runs r JOIN organizations o ON o.id = r.org_id), (SELECT count(DISTINCT m.user_id) FROM org_memberships m JOIN organizations o ON o.id = m.org_id AND o.kind = 'organization')`))).not.toEqual([]);
    expect(benchmarkBodyViolations(wrap(`SELECT (SELECT count(*) FROM chat_messages r JOIN organizations o ON o.id = r.org_id AND o.kind = 'organization'), (SELECT count(DISTINCT m.user_id) FROM org_memberships m JOIN organizations o ON o.id = m.org_id AND o.kind = 'organization')`))).not.toEqual([]);
  });
});

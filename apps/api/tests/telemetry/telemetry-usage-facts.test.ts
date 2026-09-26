/**
 * #4226 usage 分节来源（DB-free）：`usageBase` 只经 `kernel_usage_counts_for_report()` 取计数；
 * 结果过契约 `TelemetryUsage`；没有能力编号 / 编号不合契约的技能不进 skillPackRuns；函数体只回计数、
 * 排除 personal-local；token_usage_events 不在白名单、只经函数读。consent 关 ⇒ 不发，见 run-telemetry-cycle.test.ts。
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { instanceTelemetry as T } from "@repo/contracts";
import type { DatabasePort, TenantSession } from "../../src/application/ports/database.port";
import { PgTelemetryFacts, TELEMETRY_FACT_TABLES, usageBaseFrom } from "../../src/infrastructure/telemetry/pg-telemetry-facts";

/** 与 telemetry-no-content-tables.test.ts 同一扫描规则，另跳过 `JOIN LATERAL`（不是表）。 */
const referencedTables = (src: string): string[] =>
  [...new Set([...src.matchAll(/\b(?:FROM|JOIN)\s+(?!LATERAL\b)([a-z_][a-z0-9_.]*)/gi)].map((m) => m[1]!.toLowerCase()))];

const MIGRATION = join(import.meta.dirname, "../../migrations/20260926100000_telemetry_usage_counts.sql");
const SRC = join(import.meta.dirname, "../../src/infrastructure/telemetry/pg-telemetry-facts.ts");

function fakeDb(rows: Record<string, unknown>[]): DatabasePort & { calls: { sql: string; params?: readonly unknown[] }[] } {
  const calls: { sql: string; params?: readonly unknown[] }[] = [];
  const s: TenantSession = { query: async (sql, params) => { calls.push({ sql, params }); return { rows: rows as never[], rowCount: rows.length } as never; } };
  type Fn = (s: TenantSession) => Promise<unknown>;
  return { calls, withTenant: async (_o: unknown, fn: Fn) => fn(s), withoutTenant: async (fn: Fn) => fn(s) } as never;
}
const start = new Date("2026-09-23T00:00:00Z");
const end = new Date("2026-09-24T00:00:00Z");
const row = (capability_runs: Record<string, string | number> | null) =>
  ({ run_count: "12", token_count: "3400", seat_count: "5", organization_count: "2", capability_runs });

describe("usageBase 的真实来源", () => {
  it("函数一行计数 ⇒ 契约形状；能过 TelemetryUsage", async () => {
    const db = fakeDb([row({ "WX-S007": 4, "acme-report.v2": "1" })]);
    const base = await new PgTelemetryFacts(db).usageBase(start, end);
    expect(db.calls[0]!.sql).toMatch(/FROM kernel_usage_counts_for_report\(\$1, \$2\)/);
    expect(db.calls[0]!.params).toEqual([start, end]);
    expect(base).toEqual({
      runCount: 12, tokenCount: 3400, seatCount: 5, organizationCount: 2,
      skillPackRuns: [{ capabilityId: "WX-S007", runCount: 4 }, { capabilityId: "acme-report.v2", runCount: 1 }],
    });
    expect(T.TelemetryUsage.safeParse(base).success).toBe(true);
  });

  it("反例：没有编号的技能不计入（空 ⇒ 空数组，其余计数照常）；编号不合契约的条目丢弃", () => {
    expect(usageBaseFrom(row(null)).skillPackRuns).toEqual([]);
    expect(usageBaseFrom(row({})).skillPackRuns).toEqual([]);
    const b = usageBaseFrom(row({ "数据分析": 3, "data-analysis ": 2, "WX-S1": 1 }));
    expect(b.skillPackRuns).toEqual([{ capabilityId: "WX-S1", runCount: 1 }]);
    expect(T.TelemetryUsage.safeParse(b).success).toBe(true);
  });

  it("函数无行 ⇒ null（整节缺席，不造数）", async () => {
    expect(await new PgTelemetryFacts(fakeDb([])).usageBase(start, end)).toBeNull();
  });
});

const fnBody = (sql: string): string =>
  /FUNCTION kernel_usage_counts_for_report\([^)]*\)[\s\S]*?AS \$\$([\s\S]*?)\$\$/.exec(sql)?.[1] ?? "";

/** 函数体：只碰五张表；每条租户事实表的 FROM 同行 JOIN organizations 限定 kind；SELECT 列表只有聚合与能力编号分组键。 */
function usageBodyViolations(body: string): string[] {
  const bad: string[] = [];
  if (body.trim().length === 0) return ["empty"];
  for (const t of referencedTables(body)) {
    if (!["agent_runs", "token_usage_events", "org_memberships", "organizations", "skill_versions"].includes(t)) bad.push(`table ${t}`);
  }
  for (const m of body.matchAll(/FROM\s+(agent_runs|token_usage_events|org_memberships)\s+(\w+)([^\n]*)/g)) {
    if (!new RegExp(`JOIN organizations o ON o\\.id = ${m[2]}\\.org_id AND o\\.kind = 'organization'`).test(m[3]!)) bad.push(`no personal-local exclusion: ${m[1]}`);
  }
  if (/FROM\s+organizations\s+o\b(?![^\n]*o\.kind = 'organization')/.test(body)) bad.push("organizations without kind");
  for (const m of body.matchAll(/SELECT\s+([\s\S]*?)\s+FROM/g)) {
    for (const raw of m[1]!.split(/,(?![^(]*\))/)) {
      let item = raw.trim();
      while (/^\(?SELECT\s+/.test(item)) item = item.replace(/^\(?SELECT\s+/, "");
      if (item.length === 0) continue;
      if (/^(count\(|coalesce\(sum\(|coalesce\(jsonb_object_agg\()/.test(item)) continue;
      if (item === "v.manifest->>'capabilityId' AS capability_id") continue;
      bad.push(`non-aggregate select: ${item}`);
    }
  }
  return bad;
}

describe("kernel_usage_counts_for_report：只回计数、排除 personal-local", () => {
  it("迁移里的函数体合规；只授 app_rw；上报方只经函数读", () => {
    const sql = readFileSync(MIGRATION, "utf8");
    expect(usageBodyViolations(fnBody(sql))).toEqual([]);
    expect(sql).toMatch(/SECURITY DEFINER/);
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION kernel_usage_counts_for_report\(timestamptz, timestamptz\) FROM PUBLIC/);
    expect([...sql.matchAll(/GRANT EXECUTE ON FUNCTION kernel_usage_counts_for_report\([^)]*\) TO (\w+)/g)].map((m) => m[1])).toEqual(["app_rw"]);
    // 没有编号的技能在 SQL 层就不进分组（NULL 不匹配正则）
    expect(sql).toMatch(/AND v\.manifest->>'capabilityId' ~ '\^\(WX-S\[0-9\]\+\|/);
    const tables = referencedTables(readFileSync(SRC, "utf8"));
    expect(tables).toContain("kernel_usage_counts_for_report");
    for (const t of ["agent_runs", "token_usage_events", "org_memberships", "skill_versions"]) expect(tables).not.toContain(t);
    expect(TELEMETRY_FACT_TABLES as readonly string[]).not.toContain("token_usage_events");
  });

  it("自检：回行值、漏 kind 限定、读内容表 ⇒ 门会红", () => {
    const wrap = (b: string) => fnBody(`CREATE FUNCTION kernel_usage_counts_for_report(a timestamptz, b timestamptz) AS $$${b}$$`);
    expect(usageBodyViolations(wrap(`SELECT (SELECT t.tokens_total FROM token_usage_events t JOIN organizations o ON o.id = t.org_id AND o.kind = 'organization')`))).not.toEqual([]);
    expect(usageBodyViolations(wrap(`SELECT (SELECT count(*) FROM agent_runs r JOIN organizations o ON o.id = r.org_id)`))).not.toEqual([]);
    expect(usageBodyViolations(wrap(`SELECT (SELECT count(*) FROM chat_messages r JOIN organizations o ON o.id = r.org_id AND o.kind = 'organization')`))).not.toEqual([]);
    expect(usageBodyViolations(wrap(`SELECT (SELECT count(*) FROM organizations o)`))).not.toEqual([]);
    expect(usageBodyViolations(wrap(`SELECT (SELECT r.org_id FROM agent_runs r JOIN organizations o ON o.id = r.org_id AND o.kind = 'organization')`))).not.toEqual([]);
  });
});

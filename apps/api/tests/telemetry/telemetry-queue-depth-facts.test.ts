/**
 * D9 queueDepth 来源（#4225）：`ingestion_outbox` 是 RLS FORCE，上报方的 withoutTenant 会话直读恒为 0。
 * 所以 `health.queueDepth` 只经 SECURITY DEFINER 的 `kernel_queue_depth_for_report()` 取**一个计数**；
 * 函数体只有一个 JOIN organizations 限定 kind = 'organization' 的 pending `count(*)`；上报方不直接读该表。
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { DatabasePort, TenantSession } from "../../src/application/ports/database.port";
import { PgTelemetryFacts } from "../../src/infrastructure/telemetry/pg-telemetry-facts";

/** 与 telemetry-no-content-tables.test.ts 同一扫描规则（不 import 测试文件以免重复注册用例）。 */
const referencedTables = (src: string): string[] =>
  [...new Set([...src.matchAll(/\b(?:FROM|JOIN)\s+([a-z_][a-z0-9_.]*)/gi)].map((m) => m[1]!.toLowerCase()))];

const MIGRATION = join(import.meta.dirname, "../../migrations/20260926100000_telemetry_queue_depth.sql");
const SRC = join(import.meta.dirname, "../../src/infrastructure/telemetry/pg-telemetry-facts.ts");

const fnBody = (sql: string): string =>
  /FUNCTION kernel_queue_depth_for_report\(\)[\s\S]*?AS \$\$([\s\S]*?)\$\$/.exec(sql)?.[1] ?? "";

/** 函数体必须恰好是：SELECT count(*) FROM ingestion_outbox q JOIN organizations o ON ... kind='organization' WHERE q.status='pending'。 */
function queueBodyViolations(body: string): string[] {
  const b = body.trim().replace(/\s+/g, " ");
  if (b.length === 0) return ["empty"];
  const bad: string[] = [];
  const selects = [...b.matchAll(/\bSELECT\b/gi)].length;
  if (selects !== 1) bad.push(`expected exactly 1 SELECT, got ${selects}`);
  const list = /^SELECT\s+([\s\S]*?)\s+FROM\s/i.exec(b)?.[1] ?? "";
  if (list.trim() !== "count(*)") bad.push(`non-count select: ${list}`);
  if (!/JOIN organizations o ON o\.id = q\.org_id AND o\.kind = 'organization'/.test(b)) bad.push("no personal-local exclusion");
  if (!/WHERE q\.status = 'pending'$/.test(b)) bad.push("not limited to pending");
  for (const t of referencedTables(b)) if (!["ingestion_outbox", "organizations"].includes(t)) bad.push(`table ${t}`);
  return bad;
}

function fakeDb(queueRows: Record<string, unknown>[]): DatabasePort & { calls: string[] } {
  const calls: string[] = [];
  const s = {
    query: async (sql: string) => {
      calls.push(sql);
      if (/service_uptime_checks/.test(sql)) return { rows: [{ total: 2, up: 2, p50: 5, p95: 9 }], rowCount: 1 };
      if (/kernel_queue_depth_for_report/.test(sql)) return { rows: queueRows, rowCount: queueRows.length };
      return { rows: [{ n: 12 }], rowCount: 1 };
    },
  } as unknown as TenantSession;
  type Fn = (s: TenantSession) => Promise<unknown>;
  return { calls, withTenant: async (_o: unknown, fn: Fn) => fn(s), withoutTenant: async (fn: Fn) => fn(s) } as never;
}

describe("health.queueDepth 只经 kernel_queue_depth_for_report()", () => {
  it("函数回的计数就是 queueDepth；上报方不直读 ingestion_outbox", async () => {
    const db = fakeDb([{ n: 7 }]);
    const h = await new PgTelemetryFacts(db).health(new Date(0), new Date());
    expect(h?.facts.queueDepth).toBe(7);
    expect(db.calls.some((sql) => /FROM kernel_queue_depth_for_report\(\)/.test(sql))).toBe(true);
    expect(db.calls.some((sql) => /ingestion_outbox/.test(sql))).toBe(false);
    const tables = referencedTables(readFileSync(SRC, "utf8"));
    expect(tables).toContain("kernel_queue_depth_for_report");
    expect(tables).not.toContain("ingestion_outbox");
  });

  it("迁移里的函数体只有一个计数，且 SECURITY DEFINER、search_path 固定、只授予 app_rw", () => {
    const sql = readFileSync(MIGRATION, "utf8");
    expect(queueBodyViolations(fnBody(sql))).toEqual([]);
    expect(sql).toMatch(/RETURNS bigint\s+LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS \$\$/);
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION kernel_queue_depth_for_report\(\) FROM PUBLIC;/);
    const grants = [...sql.matchAll(/GRANT EXECUTE ON FUNCTION kernel_queue_depth_for_report\(\) TO (\w+)/g)].map((m) => m[1]);
    expect(grants).toEqual(["app_rw"]);
  });

  it("自检：回列值、漏掉 kind 限定、不限 pending、读内容表、多一个子查询 ⇒ 门会红", () => {
    const wrap = (b: string) => fnBody(`CREATE FUNCTION kernel_queue_depth_for_report() AS $$${b}$$`);
    const ok = "SELECT count(*) FROM ingestion_outbox q JOIN organizations o ON o.id = q.org_id AND o.kind = 'organization' WHERE q.status = 'pending'";
    expect(queueBodyViolations(wrap(ok))).toEqual([]);
    expect(queueBodyViolations(wrap(ok.replace("count(*)", "q.org_id")))).not.toEqual([]);
    expect(queueBodyViolations(wrap(ok.replace(" AND o.kind = 'organization'", "")))).not.toEqual([]);
    expect(queueBodyViolations(wrap(ok.replace(" WHERE q.status = 'pending'", "")))).not.toEqual([]);
    expect(queueBodyViolations(wrap(ok.replace("ingestion_outbox", "chat_messages")))).not.toEqual([]);
    expect(queueBodyViolations(wrap(`${ok} AND q.id IN (SELECT id FROM ingestion_outbox)`))).not.toEqual([]);
    expect(queueBodyViolations(wrap(""))).toEqual(["empty"]);
  });
});

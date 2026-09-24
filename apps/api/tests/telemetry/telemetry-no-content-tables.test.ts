/**
 * D9 静态门：上报方的 SQL 只许引用白名单表，不许读任何客户内容表（聊天、文件、产出物……）。
 * 扫描 `pg-telemetry-facts.ts` 源码里所有 FROM / JOIN 后的表名；自检用例证明这道门能红。
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { TELEMETRY_FACT_TABLES } from "../../src/infrastructure/telemetry/pg-telemetry-facts";

const SRC = join(import.meta.dirname, "../../src/infrastructure/telemetry/pg-telemetry-facts.ts");

export function referencedTables(src: string): string[] {
  const out = new Set<string>();
  for (const m of src.matchAll(/\b(?:FROM|JOIN)\s+([a-z_][a-z0-9_.]*)/gi)) out.add(m[1]!.toLowerCase());
  return [...out];
}

function violations(src: string): string[] {
  return referencedTables(src).filter((t) => !(TELEMETRY_FACT_TABLES as readonly string[]).includes(t));
}

describe("上报方不读客户内容表", () => {
  it("pg-telemetry-facts.ts 引用的每张表都在白名单内，且至少扫到一张（空集不算绿）", () => {
    const src = readFileSync(SRC, "utf8");
    expect(referencedTables(src).length).toBeGreaterThan(0);
    expect(violations(src)).toEqual([]);
  });

  it("白名单本身不含已知的客户内容表", () => {
    for (const t of ["chat_messages", "chat_threads", "artifacts", "files", "error_logs", "token_usage_events"]) {
      expect(TELEMETRY_FACT_TABLES as readonly string[]).not.toContain(t);
    }
  });

  it("自检：一旦 SQL 读 chat_messages，门会红", () => {
    expect(violations("SELECT count(*) FROM chat_messages m JOIN organizations o ON o.id = m.org_id")).toEqual(["chat_messages"]);
  });

  it("personal-local 排除落在 SQL 层：凡按组织计数的查询都 JOIN organizations 且限定 kind = 'organization'", () => {
    const src = readFileSync(SRC, "utf8");
    const perOrg = [...src.matchAll(/`([^`]*\bFROM\s+ingestion_outbox[^`]*)`/g)].map((m) => m[1]!);
    expect(perOrg.length).toBeGreaterThan(0);
    for (const sql of perOrg) expect(sql).toMatch(/JOIN organizations o ON o\.id = \w+\.org_id AND o\.kind = 'organization'/);
  });

  it("状态仓储只碰自己的单行表", () => {
    const src = readFileSync(join(import.meta.dirname, "../../src/infrastructure/telemetry/pg-telemetry-state-repository.ts"), "utf8");
    const tables = [...src.matchAll(/\b(?:FROM|JOIN|INTO|UPDATE)\s+([a-z_][a-z0-9_]*)/gi)].map((m) => m[1]);
    expect(new Set(tables)).toEqual(new Set(["instance_telemetry_state"]));
  });
});

/** 权限门豁免（lint-permission-paths 条目 (b)）的依据：读租户表的每条 SQL 只做聚合计数。 */
export function nonAggregateTenantSql(src: string): string[] {
  const bad: string[] = [];
  for (const m of src.matchAll(/`(SELECT[\s\S]*?)`/g)) {
    const sql = m[1]!;
    if (!/\b(ingestion_outbox|organizations)\b/i.test(sql)) continue;
    const select = /SELECT\s+([\s\S]*?)\s+FROM/i.exec(sql)?.[1] ?? "";
    if (!/^count\(\*\)(::int)?\s+AS\s+\w+$/i.test(select.trim())) bad.push(sql.split("\n")[0]!);
  }
  return bad;
}

describe("读租户表只做聚合计数", () => {
  it("pg-telemetry-facts.ts 里读 ingestion_outbox/organizations 的 SQL 全是 count(*)", () => {
    const src = readFileSync(SRC, "utf8");
    expect(src).toMatch(/ingestion_outbox/);
    expect(nonAggregateTenantSql(src)).toEqual([]);
  });

  it("自检：取行或取列的 SQL 会被抓到", () => {
    expect(nonAggregateTenantSql("`SELECT o.name FROM organizations o`")).toHaveLength(1);
    expect(nonAggregateTenantSql("`SELECT count(*)::int AS n FROM ingestion_outbox`")).toEqual([]);
  });
});

/** E3：first_value_facts 只经 SECURITY DEFINER 函数读；函数排除 personal-local、不回 org_id。 */
describe("第一个价值时刻事实：只经报告函数、已排除 personal-local、不回组织标识", () => {
  const MIGRATION = join(import.meta.dirname, "../../migrations/20260924260000_first_value_facts.sql");
  const fnBody = (sql: string): string =>
    /FUNCTION kernel_first_value_facts_for_report\(\)[\s\S]*?AS \$\$([\s\S]*?)\$\$/.exec(sql)?.[1] ?? "";
  const selectList = (body: string): string => (/SELECT\s+([\s\S]*?)\s+FROM/i.exec(body)?.[1] ?? "").replace(/OVER\s*\([^)]*\)/gi, "");

  it("上报方不直接读 first_value_facts 表，只调用报告函数", () => {
    const tables = referencedTables(readFileSync(SRC, "utf8"));
    expect(tables).toContain("kernel_first_value_facts_for_report");
    expect(tables).not.toContain("first_value_facts");
  });

  it("报告函数体：只读 first_value_facts、限定 org_kind = 'organization'、SELECT 列表里没有 org_id", () => {
    const body = fnBody(readFileSync(MIGRATION, "utf8"));
    expect(body.length).toBeGreaterThan(0);
    expect(referencedTables(body)).toEqual(["first_value_facts"]);
    expect(body).toMatch(/WHERE f\.org_kind = 'organization'/);
    expect(selectList(body)).toMatch(/dense_rank\(\)/);
    expect(selectList(body)).not.toMatch(/org_id/);
  });

  it("自检：函数体若回 org_id 或漏掉 personal-local 排除，门会红", () => {
    const body = fnBody("CREATE FUNCTION kernel_first_value_facts_for_report() AS $$ SELECT f.org_id, f.step FROM first_value_facts f $$");
    expect(body).not.toMatch(/WHERE f\.org_kind = 'organization'/);
    expect(selectList(body)).toMatch(/org_id/);
  });
});

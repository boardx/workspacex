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

/**
 * lint-permission-paths 豁免（`pg-first-value-facts.ts`）的依据，逐条可红：
 *   ① 只碰 `first_value_facts` / `organizations` 两张表；② 从不 `withoutTenant`；
 *   ③ 读 first_value_facts 只选 `step` / `occurred_at`；④ 读 organizations 只在 INSERT…SELECT 里取
 *      `o.id` / `o.kind`（派生 org_kind），从不交还调用方；⑤ 唯一的读方法 `listForOrg` 的调用方
 *      （first-value.controller.ts）先判组织管理员。
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = readFileSync(join(import.meta.dirname, "../../src/infrastructure/first-value/pg-first-value-facts.ts"), "utf8");
const CTRL = readFileSync(join(import.meta.dirname, "../../src/interface/controllers/first-value.controller.ts"), "utf8");

const tables = (src: string) => [...src.matchAll(/\b(?:FROM|JOIN|INTO|UPDATE)\s+([a-z_][a-z0-9_]*)/gi)].map((m) => m[1]!);
const selects = (src: string) => [...src.matchAll(/SELECT\s+([\s\S]*?)\s+FROM\s+([a-z_]+)/gi)].map((m) => ({ cols: m[1]!.trim(), table: m[2]! }));

function violations(src: string, ctrl: string): string[] {
  const v: string[] = [];
  const ts = tables(src);
  if (ts.length === 0) v.push("no tables scanned");
  for (const t of ts) if (!["first_value_facts", "organizations"].includes(t)) v.push(`table ${t}`);
  if (/withoutTenant/.test(src)) v.push("withoutTenant");
  for (const s of selects(src)) {
    if (s.table === "first_value_facts" && s.cols !== "step, occurred_at") v.push(`cols ${s.cols}`);
    if (s.table === "organizations" && !/^o\.id, o\.kind, \$2, \$3$/.test(s.cols)) v.push(`org cols ${s.cols}`);
  }
  if (!/orgRole !== "admin"[\s\S]*ForbiddenException[\s\S]*listForOrg/.test(ctrl)) v.push("controller admin check before listForOrg");
  return v;
}

describe("pg-first-value-facts 豁免条件", () => {
  it("当前源码满足全部条件（且至少扫到表，空集不算绿）", () => {
    expect(selects(SRC).length).toBeGreaterThan(0);
    expect(violations(SRC, CTRL)).toEqual([]);
  });

  it("变异：读别的表 / withoutTenant / 多选列 / 去掉管理员判定 都会红", () => {
    expect(violations(SRC.replace("FROM first_value_facts WHERE", "FROM chat_messages WHERE"), CTRL).length).toBeGreaterThan(0);
    expect(violations(SRC + "\nthis.db.withoutTenant", CTRL)).toContain("withoutTenant");
    expect(violations(SRC.replace("SELECT step, occurred_at", "SELECT org_id, step, occurred_at"), CTRL).length).toBeGreaterThan(0);
    expect(violations(SRC.replace("SELECT o.id, o.kind", "SELECT o.id, o.name"), CTRL).length).toBeGreaterThan(0);
    expect(violations(SRC, CTRL.replace('orgRole !== "admin"', "false"))).toContain("controller admin check before listForOrg");
  });
});

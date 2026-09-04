/**
 * `lint-permission-paths` 对 `pg-feedback-draft-repository.ts` 的豁免**不是一句声明，是这个文件在守**
 * （形态照抄 `tests/skill/trial-run-store-reads-are-actor-scoped.test.ts`，脚本 allowlist 里那条
 * 逐字写着「那个测试若被删除，本条目必须跟着删」）。
 *
 * 豁免前提：草稿是提交人私有物，「只有 owner 能读写」由每条 SQL 的谓词 `owner_id = $n` 表达。
 * 本测试断言：① 每条 SELECT/UPDATE/DELETE 带 `owner_id = $` 与 `org_id = $`；② INSERT 带两列；
 * ③ 没有 `withoutTenant`；④ 只碰 `product_feedback_drafts` 这一张表。
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SOURCE_PATH = join(import.meta.dirname, "..", "..", "src", "infrastructure", "feedback", "pg-feedback-draft-repository.ts");

describe("草稿仓储的豁免前提：每条读写都按 owner 收窄", () => {
  const raw = readFileSync(SOURCE_PATH, "utf8");
  // 先剥掉注释——头注里的反引号（`product_feedback_drafts`、`withoutTenant`）会让 SQL 字面量的匹配跨到代码里。
  const source = raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  // 先按顺序取出**所有**反引号字面量再筛 SQL——直接用「含关键字的反引号对」会在遇到不含关键字的
  // 字面量（`SELECT_COLUMNS` 常量、错误文案）时把开/闭反引号配错对。
  const statements = [...source.matchAll(/`([^`]*)`/g)]
    .map((m) => m[1]!)
    .filter((lit) => /^\s*(?:SELECT|UPDATE|INSERT|DELETE)\b/i.test(lit));

  it("actually found the SQL in the file — otherwise this test would pass vacuously", () => {
    expect(statements.length).toBeGreaterThanOrEqual(6);
    expect(source).toContain("product_feedback_drafts");
  });

  it("every SELECT / UPDATE / DELETE is scoped to the owner AND the org", () => {
    const offenders = statements.filter((sql) => {
      if (/\bINSERT\s+INTO\b/i.test(sql)) return false;
      return !/\bowner_id\s*=\s*\$/i.test(sql) || !/\borg_id\s*=\s*\$/i.test(sql);
    });
    expect(offenders, `unscoped statements:\n${offenders.join("\n---\n")}`).toEqual([]);
  });

  it("INSERT writes org_id and owner_id", () => {
    const inserts = statements.filter((sql) => /\bINSERT\s+INTO\b/i.test(sql));
    expect(inserts.length).toBeGreaterThanOrEqual(1);
    for (const sql of inserts) {
      expect(sql).toMatch(/org_id/);
      expect(sql).toMatch(/owner_id/);
    }
  });

  it("never opens a session without a tenant", () => {
    expect(source).not.toContain("withoutTenant");
  });

  it("names no tenant table other than product_feedback_drafts", () => {
    const tables = new Set<string>();
    for (const sql of statements) {
      for (const m of sql.matchAll(/\b(?:FROM|JOIN|INTO|UPDATE)\s+(\w+)/gi)) tables.add(m[1]!.toLowerCase());
    }
    expect([...tables]).toEqual(["product_feedback_drafts"]);
  });
});

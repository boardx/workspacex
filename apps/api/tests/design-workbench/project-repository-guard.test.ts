/**
 * `lint-permission-paths` 对 `pg-design-project-repository.ts` 的豁免**不是一句声明,是这个文件在守**
 * （形态照抄 `tests/feedback/draft-repository-guard.test.ts`,脚本 allowlist 里那条逐字写着
 * 「那个测试若被删除,本条目必须跟着删」）。
 *
 * 豁免前提与草稿仓储**相反**：设计项目「组织内全员可读,仅 owner 可改/删/推送」——
 * ① 写方法（`update`/`delete`/`appendChat`/`pushToInbox`）每条 UPDATE/DELETE 都带
 *   `owner_id = $` 与 `org_id = $`；
 * ② 读方法（`get`/`listForOrg`）只按 `org_id = $` 收窄,不要求 `owner_id`——这是刻意的；
 * ③ INSERT 带 `org_id`；
 * ④ 没有 `withoutTenant`；
 * ⑤ 只碰 `design_projects`/`design_project_chat_messages`/`product_feedback` 三张表。
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SOURCE_PATH = join(
  import.meta.dirname,
  "..",
  "..",
  "src",
  "infrastructure",
  "design-workbench",
  "pg-design-project-repository.ts",
);

describe("设计项目仓储的豁免前提：写按 owner+org 收窄,读只按 org 收窄", () => {
  const raw = readFileSync(SOURCE_PATH, "utf8");
  const source = raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const statements = [...source.matchAll(/`([^`]*)`/g)]
    .map((m) => m[1]!)
    .filter((lit) => /^\s*(?:SELECT|UPDATE|INSERT|DELETE)\b/i.test(lit));

  it("actually found the SQL in the file — otherwise this test would pass vacuously", () => {
    expect(statements.length).toBeGreaterThanOrEqual(8);
    expect(source).toContain("design_projects");
  });

  it("every UPDATE / DELETE targeting design_projects (or chat) is scoped to owner AND org", () => {
    const writes = statements.filter(
      (sql) => /\b(UPDATE|DELETE)\b/i.test(sql) && /\bdesign_projects\b/i.test(sql),
    );
    expect(writes.length).toBeGreaterThanOrEqual(4);
    const offenders = writes.filter((sql) => !/\bowner_id\s*=\s*\$/i.test(sql) || !/\borg_id\s*=\s*\$/i.test(sql));
    expect(offenders, `unscoped writes:\n${offenders.join("\n---\n")}`).toEqual([]);
  });

  it("get/listForOrg style SELECTs on design_projects are scoped to org only (owner not required — full-org visibility)", () => {
    const selects = statements.filter((sql) => /^\s*SELECT/i.test(sql) && /\bdesign_projects\b/i.test(sql));
    expect(selects.length).toBeGreaterThanOrEqual(1);
    for (const sql of selects) {
      expect(sql).toMatch(/org_id\s*=\s*\$/i);
    }
  });

  it("INSERT writes org_id", () => {
    const inserts = statements.filter((sql) => /\bINSERT\s+INTO\b/i.test(sql));
    expect(inserts.length).toBeGreaterThanOrEqual(1);
    for (const sql of inserts) {
      expect(sql).toMatch(/org_id/);
    }
  });

  it("never opens a session without a tenant", () => {
    expect(source).not.toContain("withoutTenant");
  });

  it("names no tenant table other than design_projects / design_project_chat_messages / product_feedback", () => {
    const tables = new Set<string>();
    for (const sql of statements) {
      for (const m of sql.matchAll(/\b(?:FROM|JOIN|INTO|UPDATE)\s+(\w+)/gi)) tables.add(m[1]!.toLowerCase());
    }
    expect([...tables].sort()).toEqual(["design_project_chat_messages", "design_projects", "product_feedback"]);
  });

  it("the product_feedback UPDATE (resolved_by_design_id) is scoped to org (not owner — writing to a feedback row, not a design project row)", () => {
    const fbUpdate = statements.find((sql) => /\bUPDATE\s+product_feedback\b/i.test(sql));
    expect(fbUpdate).toBeDefined();
    expect(fbUpdate).toMatch(/org_id\s*=\s*\$/i);
  });
});

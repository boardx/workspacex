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
 *
 * ⚠ 2026-09-08：`SELECT_COLUMNS` 里长出了一个读 `design_project_ref_images` 的子查询，而
 *   本文件原来抓 SQL 的正则看到的是**未展开**的 `${SELECT_COLUMNS}` 字面量——那张新表
 *   一条断言也没碰到，⑤ 会静悄悄地继续通过。这正是「为错误理由通过」的形态：测试还绿，
 *   但它守的东西已经不完整了。所以这里先把常量展开再抓 SQL。
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
  // 先把 `SELECT_COLUMNS` 就地展开——否则每条读语句在这里都只是 `${SELECT_COLUMNS}` 这个字面量，
  // 里面读了哪些表看不见（见文件头注的 2026-09-08 那条）。
  const selectColumns = /const SELECT_COLUMNS = `([\s\S]*?)`;/.exec(source)?.[1] ?? "";
  const expanded = source.replaceAll("${SELECT_COLUMNS}", selectColumns);
  const statements = [...expanded.matchAll(/`([^`]*)`/g)]
    .map((m) => m[1]!)
    .filter((lit) => /^\s*(?:SELECT|UPDATE|INSERT|DELETE)\b/i.test(lit));

  it("actually found the SQL in the file — otherwise this test would pass vacuously", () => {
    expect(statements.length).toBeGreaterThanOrEqual(8);
    expect(source).toContain("design_projects");
    // 展开真的发生了：没展开的话下面「都碰了哪些表」这条会看不见子查询里的表。
    expect(selectColumns).toContain("owner_id");
    expect(expanded).not.toContain("${SELECT_COLUMNS}");
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

  it("names no tenant table other than design_projects / chat / versions / ref_images / product_feedback", () => {
    const tables = new Set<string>();
    for (const sql of statements) {
      for (const m of sql.matchAll(/\b(?:FROM|JOIN|INTO|UPDATE)\s+(\w+)/gi)) tables.add(m[1]!.toLowerCase());
    }
    expect([...tables].sort()).toEqual([
      "design_project_chat_messages",
      // 迭代 13：`SELECT_COLUMNS` 里聚参考图元信息的子查询——它按 `org_id = design_projects.org_id`
      // 收窄（下一条断言钉住），可见性跟随所属项目。
      "design_project_ref_images",
      "design_project_prototype_versions",
      "design_projects",
      "product_feedback",
    ].sort());
  });

  it("the ref-image subquery inside SELECT_COLUMNS is scoped to the project's own org and project", () => {
    const sub = selectColumns;
    expect(sub).toContain("design_project_ref_images");
    expect(sub).toMatch(/r\.org_id\s*=\s*design_projects\.org_id/);
    expect(sub).toMatch(/r\.project_id\s*=\s*design_projects\.id/);
    // ⭐ 反证：把 org 谓词去掉 ⇒ 上面第二条红。字节**不**出现在这个投影里（V55）。
    expect(sub).not.toMatch(/\bbytes\b|object_key/);
  });

  it("the product_feedback UPDATE (resolved_by_design_id) is scoped to org (not owner — writing to a feedback row, not a design project row)", () => {
    const fbUpdate = statements.find((sql) => /\bUPDATE\s+product_feedback\b/i.test(sql));
    expect(fbUpdate).toBeDefined();
    expect(fbUpdate).toMatch(/org_id\s*=\s*\$/i);
  });
});

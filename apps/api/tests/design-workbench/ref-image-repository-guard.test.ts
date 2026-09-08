/**
 * `lint-permission-paths` 对 `pg-ref-image-repository.ts` 的豁免**不是一句声明，是这个文件在守**
 * （形态照抄同目录的 `project-repository-guard.test.ts`，脚本 allowlist 里那条逐字写着
 * 「那个测试若被删除，本条目必须跟着删」）。
 *
 * 豁免前提与 `pg-design-project-repository.ts` **同源**：参考图的可见性跟随它所属的设计项目
 * ——组织内全员可读，仅 owner 可传/可删。所以：
 * ① 每条语句都按 `org_id = $` 收窄；
 * ② 读方法**不**带 `owner_id` 谓词（跟随项目的「全组织可读」，这是刻意的，不是漏了）；
 * ③ 「仅 owner 可改」由用例层 `ref-images.ts` 取项目时的 owner 校验表达——在仓储层再判一次
 *   不是更安全，是把同一条规则声明在两处；
 * ④ 没有 `withoutTenant`；
 * ⑤ 只碰 `design_project_ref_images` 一张表；
 * ⑥ 投影里没有字节（V55：`RefImage` 不含字节，字节在 `ObjectStore`）。
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SOURCE_PATH = join(
  import.meta.dirname, "..", "..", "src", "infrastructure", "design-workbench", "pg-ref-image-repository.ts",
);

describe("参考图仓储的豁免前提：每条语句按 org 收窄，读不要求 owner", () => {
  const raw = readFileSync(SOURCE_PATH, "utf8");
  const source = raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const statements = [...source.matchAll(/`([^`]*)`/g)]
    .map((m) => m[1]!)
    .filter((lit) => /^\s*(?:SELECT|UPDATE|INSERT|DELETE)\b/i.test(lit));

  it("actually found the SQL — otherwise every assertion below passes vacuously", () => {
    // 三个方法各一条：listByProject / insert / remove。少于 3 说明文件改了而这个守卫没跟上。
    expect(statements.length).toBe(3);
    expect(source).toContain("design_project_ref_images");
  });

  it("every statement is scoped to org_id", () => {
    const offenders = statements.filter((sql) => !/org_id/i.test(sql));
    expect(offenders, `unscoped:\n${offenders.join("\n---\n")}`).toEqual([]);
  });

  it("reads are scoped to org + project only — owner is deliberately NOT a predicate here", () => {
    const selects = statements.filter((sql) => /^\s*SELECT/i.test(sql));
    expect(selects.length).toBe(1);
    expect(selects[0]).toMatch(/org_id\s*=\s*\$/i);
    expect(selects[0]).toMatch(/project_id\s*=\s*\$/i);
    // ⚠ 这条断言的方向与直觉相反：出现 owner_id 才是**错**的。可见性跟随项目（全组织可读），
    //   在这里加一条 owner 谓词会让"别人的项目里的参考图看不见"，与项目本身的可见性不一致。
    expect(selects[0]).not.toMatch(/owner_id/i);
  });

  it("DELETE is scoped to org + project + image id (never a bare id)", () => {
    const del = statements.find((sql) => /^\s*DELETE/i.test(sql));
    expect(del).toBeDefined();
    expect(del).toMatch(/org_id\s*=\s*\$/i);
    expect(del).toMatch(/project_id\s*=\s*\$/i);
    // ⭐ 反证：只按 id 删 ⇒ 这两条红。跨项目/跨组织按 id 猜删是这条断言在挡的事。
  });

  it("INSERT writes org_id and project_id", () => {
    const ins = statements.find((sql) => /\bINSERT\s+INTO\b/i.test(sql));
    expect(ins).toBeDefined();
    expect(ins).toMatch(/org_id/);
    expect(ins).toMatch(/project_id/);
  });

  it("never opens a session without a tenant", () => {
    expect(source).not.toContain("withoutTenant");
  });

  it("names no tenant table other than design_project_ref_images", () => {
    const tables = new Set<string>();
    for (const sql of statements) {
      for (const m of sql.matchAll(/\b(?:FROM|JOIN|INTO|UPDATE)\s+(\w+)/gi)) tables.add(m[1]!.toLowerCase());
    }
    expect([...tables]).toEqual(["design_project_ref_images"]);
  });
});

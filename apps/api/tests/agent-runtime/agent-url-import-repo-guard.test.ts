/**
 * #1415 —— `lint-permission-paths` 白名单条目
 * `src/infrastructure/agent-import/pg-agent-url-import-repository.ts` 的**守卫测试**。
 *
 * 与 `tests/skill/url-import-repo-guard.test.ts` 同一条纪律：那条白名单条目声称
 * 「授权已在 `import-agent-from-url.ts` 中、且在取回之前发生」，本文件把这句声明
 * 变成机械事实——条目依赖的任一前提破掉，这里当场红。
 *
 * ⛔ **若本文件被删除，那条白名单条目必须一起删除。**
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const REPO = new URL(
  "../../src/infrastructure/agent-import/pg-agent-url-import-repository.ts",
  import.meta.url,
);
const USE_CASE = new URL(
  "../../src/application/agent-import/import-agent-from-url.ts",
  import.meta.url,
);

const repoSource = readFileSync(REPO, "utf8");
const useCaseSource = readFileSync(USE_CASE, "utf8");

/** 本仓储**允许**命名的租户表——多一张就说明这个文件长出了新的读面。 */
const ALLOWED_TABLES = new Set(["agent_url_imports", "agents"]);

/** 从 SQL 里抠出 FROM / JOIN / INTO / UPDATE 后面的表名。 */
function tablesNamedIn(source: string): Set<string> {
  const found = new Set<string>();
  const re = /\b(?:FROM|JOIN|INTO|UPDATE)\s+([a-z_][a-z0-9_]*)/gi;
  for (const match of source.matchAll(re)) {
    const name = match[1];
    if (name !== undefined) found.add(name.toLowerCase());
  }
  return found;
}

describe("白名单条目的前提：仓储侧", () => {
  it("只命名允许的两张租户表", () => {
    const unexpected = [...tablesNamedIn(repoSource)].filter((t) => !ALLOWED_TABLES.has(t));
    expect(unexpected).toEqual([]);
  });

  /** 正样本：尺子有效——它确实认得出表名，不是恒返回空集。 */
  it("装置自检：解析器真的能认出表名", () => {
    expect(tablesNamedIn(repoSource).has("agent_url_imports")).toBe(true);
    expect(tablesNamedIn("SELECT 1 FROM some_other_table")).toEqual(new Set(["some_other_table"]));
  });

  /** `withoutTenant` 会绕过 RLS 的租户隔离，本文件永远不该出现它。 */
  it("从不使用 withoutTenant", () => {
    expect(repoSource.includes("withoutTenant")).toBe(false);
  });
});

describe("白名单条目的前提：授权确实存在，且在取回之前", () => {
  it("用例层有 admin 组织成员判定", () => {
    expect(useCaseSource).toContain("findOrgMembership");
    expect(useCaseSource).toContain('orgRole !== "admin"');
    expect(useCaseSource).toContain("IMPORT_NOT_ORG_ADMIN");
  });

  /**
   * ⚠ 位置断言：授权必须排在**取回调用之前**。
   *   只断言「存在」不够——排在取回之后的授权挡不住 SSRF 探测。
   */
  it("授权判定排在 deps.fetch 调用之前", () => {
    const authAt = useCaseSource.indexOf("findOrgMembership");
    const fetchAt = useCaseSource.indexOf("await deps.fetch(");
    expect(authAt).toBeGreaterThan(-1);
    expect(fetchAt).toBeGreaterThan(-1);
    expect(authAt).toBeLessThan(fetchAt);
  });
});

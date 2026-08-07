/**
 * #595 —— `lint-permission-paths` 白名单条目
 * `src/infrastructure/skill/pg-skill-url-import-repository.ts` 的**守卫测试**。
 *
 * ## 这个文件存在的唯一理由
 *
 * 那条白名单条目声称：**授权已在 `import-skill-from-url.ts` 中、且在取回之前发生**。
 * ⚠ 一条白名单条目如果只是一句声明，它就是「写下时为真、上游改动后为假」的
 *   标准形状——而且**没有任何东西会红**。
 *
 * ⇒ 本文件把那句声明变成**机械事实**：条目依赖的每一个前提破掉，这里当场红。
 *
 * ⛔ **若本文件被删除，那条白名单条目必须一起删除。**（与 F117 / F119 / F124
 *   等既有条目同一约定，见 `scripts/lint-permission-paths.mjs` 各条目末句。）
 *
 * ## 为什么「排在取回之前」也要断言
 *
 * 授权若排在取回之后，一个非 admin 仍然能让服务端**替他发出站请求**——
 * 即使最终不落库，那已经是一个可被利用的 SSRF 探测器。
 * ⇒ 「有授权」和「授权在正确的位置」是两件事，分别断言。
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const REPO = new URL(
  "../../src/infrastructure/skill/pg-skill-url-import-repository.ts",
  import.meta.url,
);
const USE_CASE = new URL(
  "../../src/application/skill-import/import-skill-from-url.ts",
  import.meta.url,
);

const repoSource = readFileSync(REPO, "utf8");
const useCaseSource = readFileSync(USE_CASE, "utf8");

/**
 * 本仓储**允许**命名的租户表。多一张就说明这个文件长出了新的读面，
 * 而白名单条目的正当性只覆盖当前这五张。
 *
 * `capability_listings`（2026-08-07 补）：同 `pg-skill-starter-import-repository.ts`
 * 早就有的那一步——只 INSERT 调用者刚创建的 skill 自己的目录行，从不 SELECT，
 * 不是新的读面，是补齐姊妹写路径漏掉的一步。
 */
const ALLOWED_TABLES = new Set([
  "skills",
  "skill_versions",
  "skill_version_files",
  "skill_url_imports",
  "capability_listings",
]);

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
  it("只命名允许的五张租户表", () => {
    const unexpected = [...tablesNamedIn(repoSource)].filter((t) => !ALLOWED_TABLES.has(t));
    expect(unexpected).toEqual([]);
  });

  /** 正样本：尺子有效——它确实认得出表名，不是恒返回空集。 */
  it("装置自检：解析器真的能认出表名", () => {
    expect(tablesNamedIn(repoSource).has("skill_url_imports")).toBe(true);
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

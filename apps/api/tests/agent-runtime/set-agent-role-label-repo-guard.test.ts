/**
 * #1705（#728 D-1）—— `lint-permission-paths` 白名单条目
 * `src/infrastructure/agent/pg-set-agent-role-label-repository.ts` 的**守卫测试**。
 *
 * 与 `self-publish-repo-guard.test.ts` / `create-agent-repo-guard.test.ts` 同一形状、
 * 同一理由：那条白名单条目声称「授权已在 `set-agent-role-label.ts` 中、且在仓储调用
 * 之前发生」——
 * ⚠ 一条只是一句声明的白名单条目是「写下时为真、上游改动后为假」的标准形状，
 *   且没有任何东西会红。本文件把那句声明变成机械事实。
 *
 * ⛔ **若本文件被删除，那条白名单条目必须一起删除。**
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const REPO = new URL(
  "../../src/infrastructure/agent/pg-set-agent-role-label-repository.ts",
  import.meta.url,
);
const USE_CASE = new URL(
  "../../src/application/agent/set-agent-role-label.ts",
  import.meta.url,
);

const repoSource = readFileSync(REPO, "utf8");
const useCaseSource = readFileSync(USE_CASE, "utf8");

/**
 * 本仓储**允许**命名的两张租户表——`agents`（主写）+ `capability_listings`
 * （面板投影，`id = agentId`）。多一张就说明这个文件长出了新的读面。
 */
const ALLOWED_TABLES = new Set(["agents", "capability_listings"]);

function tablesNamedIn(source: string): Set<string> {
  const found = new Set<string>();
  const re = /\b(?:FROM|JOIN|INTO|UPDATE)\s+([a-z_][a-z0-9_]*)/gi;
  for (const match of source.matchAll(re)) {
    const name = match[1];
    if (name !== undefined) found.add(name.toLowerCase());
  }
  return found;
}

describe("#1705 白名单条目的前提：仓储侧", () => {
  it("只命名允许的两张租户表", () => {
    const unexpected = [...tablesNamedIn(repoSource)].filter((t) => !ALLOWED_TABLES.has(t));
    expect(unexpected).toEqual([]);
  });

  /** 正样本：尺子有效——它确实认得出表名，不是恒返回空集。 */
  it("装置自检：解析器真的能认出表名", () => {
    expect(tablesNamedIn(repoSource).has("agents")).toBe(true);
    expect(tablesNamedIn(repoSource).has("capability_listings")).toBe(true);
    expect(tablesNamedIn("SELECT 1 FROM some_other_table")).toEqual(new Set(["some_other_table"]));
  });

  it("从不使用 withoutTenant", () => {
    expect(repoSource.includes("withoutTenant")).toBe(false);
  });
});

describe("#1705 白名单条目的前提：授权确实存在，且在仓储调用之前", () => {
  it("用例层有 admin 组织成员判定", () => {
    expect(useCaseSource).toContain("findOrgMembership");
    expect(useCaseSource).toContain('orgRole !== "admin"');
    expect(useCaseSource).toContain('"ROLE_INSUFFICIENT"');
  });

  it("授权判定排在 deps.repository.setRoleLabel 调用之前", () => {
    const authAt = useCaseSource.indexOf("findOrgMembership");
    const writeAt = useCaseSource.indexOf("deps.repository.setRoleLabel(");
    expect(authAt).toBeGreaterThan(-1);
    expect(writeAt).toBeGreaterThan(-1);
    expect(authAt).toBeLessThan(writeAt);
  });

  it("agent 不存在时不得静默成功——用例把 false 翻成 AGENT_NOT_FOUND", () => {
    expect(useCaseSource).toContain('SetAgentRoleLabelError("AGENT_NOT_FOUND")');
  });
});

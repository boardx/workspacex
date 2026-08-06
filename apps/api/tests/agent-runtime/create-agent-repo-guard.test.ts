/**
 * #617 —— `lint-permission-paths` 白名单条目
 * `src/infrastructure/agent/pg-create-agent-repository.ts` 的**守卫测试**。
 *
 * 与 `tests/agent-runtime/agent-skill-pins-repo-guard.test.ts` 同一形状、同一理由：
 * 那条白名单条目声称「授权已在 `create-agent.ts` 中、且在仓储调用之前发生」——
 * ⚠ 一条只是一句声明的白名单条目是「写下时为真、上游改动后为假」的标准形状，
 *   且没有任何东西会红。本文件把那句声明变成机械事实。
 *
 * ⛔ **若本文件被删除，那条白名单条目必须一起删除。**
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const REPO = new URL(
  "../../src/infrastructure/agent/pg-create-agent-repository.ts",
  import.meta.url,
);
const USE_CASE = new URL(
  "../../src/application/agent/create-agent.ts",
  import.meta.url,
);

const repoSource = readFileSync(REPO, "utf8");
const useCaseSource = readFileSync(USE_CASE, "utf8");

/** 本仓储**允许**命名的租户表。多一张就说明这个文件长出了新的读面。 */
const ALLOWED_TABLES = new Set(["agents"]);

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
  it("只命名允许的一张租户表（agents）", () => {
    const unexpected = [...tablesNamedIn(repoSource)].filter((t) => !ALLOWED_TABLES.has(t));
    expect(unexpected).toEqual([]);
  });

  /** 正样本：尺子有效——它确实认得出表名，不是恒返回空集。 */
  it("装置自检：解析器真的能认出表名", () => {
    expect(tablesNamedIn(repoSource).has("agents")).toBe(true);
    expect(tablesNamedIn("SELECT 1 FROM some_other_table")).toEqual(new Set(["some_other_table"]));
  });

  it("从不使用 withoutTenant", () => {
    expect(repoSource.includes("withoutTenant")).toBe(false);
  });
});

describe("白名单条目的前提：授权确实存在，且在仓储调用之前", () => {
  it("用例层有 admin 组织成员判定", () => {
    expect(useCaseSource).toContain("findOrgMembership");
    expect(useCaseSource).toContain('orgRole !== "admin"');
    expect(useCaseSource).toContain('"ROLE_INSUFFICIENT"');
  });

  /**
   * ⚠ 位置断言：授权必须排在**两个仓储调用之前**——`newAgentId`/`findForClone`/`insert`
   *   三个都是。只断言「存在」不够：排在仓储调用之后的授权挡不住一个非 admin 用
   *   AGENT_NOT_FOUND 与 AGENT_MARKET_NOT_AVAILABLE 两种响应差异去探测组织内部信息。
   */
  it("授权判定排在 deps.repository.findForClone / .insert 调用之前", () => {
    const authAt = useCaseSource.indexOf("findOrgMembership");
    const findForCloneAt = useCaseSource.indexOf("deps.repository.findForClone(");
    const insertAt = useCaseSource.indexOf("deps.repository.insert(");
    expect(authAt).toBeGreaterThan(-1);
    expect(findForCloneAt).toBeGreaterThan(-1);
    expect(insertAt).toBeGreaterThan(-1);
    expect(authAt).toBeLessThan(findForCloneAt);
    expect(authAt).toBeLessThan(insertAt);
  });
});

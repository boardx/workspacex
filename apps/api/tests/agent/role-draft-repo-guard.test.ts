/**
 * AG01 —— `lint-permission-paths` 白名单条目 `agent-version-insert.ts` 与
 * `pg-agent-role-draft-repository.ts` 的守卫测试：把条目里的三条前提变成机械事实。
 * ⛔ 若本文件被删除，那两条白名单条目必须一起删除。
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const insertSrc = read("../../src/infrastructure/agent/agent-version-insert.ts");
const repoSrc = read("../../src/infrastructure/agent/pg-agent-role-draft-repository.ts");
const useCaseSrc = read("../../src/application/agent/update-agent-role-draft.ts");

function tablesNamedIn(source: string): Set<string> {
  const found = new Set<string>();
  for (const m of source.matchAll(/\b(?:FROM|JOIN|INTO|UPDATE)\s+([a-z_][a-z0-9_]*)/gi)) {
    if (m[1] !== undefined) found.add(m[1].toLowerCase());
  }
  // 模板里的条件表名：`FROM ${cond ? "agents" : "agent_versions"}`
  for (const m of source.matchAll(/FROM \$\{[^}]*\}/g)) {
    for (const t of m[0].matchAll(/"([a-z_]+)"/g)) if (t[1] !== undefined) found.add(t[1]);
  }
  return found;
}

describe("AG01 role draft / version insert allowlist premises", () => {
  it("both files name only agents / agent_versions", () => {
    for (const src of [insertSrc, repoSrc]) {
      expect([...tablesNamedIn(src)].filter((t) => t !== "agents" && t !== "agent_versions")).toEqual([]);
    }
    expect(tablesNamedIn(insertSrc).has("agent_versions")).toBe(true); // 装置自检
    expect(tablesNamedIn(repoSrc).has("agents")).toBe(true);
  });

  it("neither file calls withoutTenant", () => {
    expect(insertSrc).not.toMatch(/withoutTenant/);
    expect(repoSrc).not.toMatch(/withoutTenant/);
  });

  it("agent-version-insert has exactly one statement: the INSERT ... SELECT", () => {
    expect(insertSrc.match(/session\.query/g)).toHaveLength(1);
    expect(insertSrc).toMatch(/INSERT INTO agent_versions[\s\S]*SELECT/);
  });

  it("the admin check exists and precedes both repository calls", () => {
    const gate = useCaseSrc.indexOf('membership.orgRole !== "admin"');
    expect(gate).toBeGreaterThan(-1);
    expect(useCaseSrc.indexOf("deps.repository.find(")).toBeGreaterThan(gate);
    expect(useCaseSrc.indexOf("deps.repository.save(")).toBeGreaterThan(gate);
  });
});

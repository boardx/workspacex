/**
 * F950（2026-08-16 delta）—— 把 `pg-project-topic-repository.ts` 与
 * `pg-project-prep-repository.ts` 两条 `lint-permission-paths` 豁免的前提钉成机械事实，
 * 同 `tags-repo-guard.test.ts` 那批 guard 测试的形状。
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

function codeLines(body: string): string[] {
  return body.split("\n").filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l));
}

function namedTables(source: string): string[] {
  return [...new Set([...source.matchAll(/\b(?:FROM|INTO|UPDATE|JOIN)\s+([a-z_][a-z0-9_]*)/gi)].map((m) => m[1]!.toLowerCase()))].sort();
}

describe("F950 pg-project-topic-repository.ts 权限豁免前提", () => {
  const SRC = fileURLToPath(new URL("../../src/infrastructure/templates/pg-project-topic-repository.ts", import.meta.url));
  const source = codeLines(readFileSync(SRC, "utf8")).join("\n");

  it("① 只命名 project_topics 一张表", () => {
    expect(namedTables(source)).toEqual(["project_topics"]);
  });

  it("② 没有 withoutTenant，且确实走 withTenant", () => {
    expect(source).not.toContain("withoutTenant");
    expect(source).toContain("withTenant");
  });
});

describe("F950 pg-project-prep-repository.ts 权限豁免前提", () => {
  const SRC = fileURLToPath(new URL("../../src/infrastructure/templates/pg-project-prep-repository.ts", import.meta.url));
  const source = codeLines(readFileSync(SRC, "utf8")).join("\n");

  it("① 只命名 projects/groups/agenda_segments 三张表", () => {
    expect(namedTables(source)).toEqual(["agenda_segments", "groups", "projects"]);
  });

  it("② 全部是读——没有 INSERT/UPDATE/DELETE", () => {
    expect(source).not.toMatch(/\bINSERT\s+INTO\b/i);
    expect(source).not.toMatch(/\bUPDATE\s+\w+\s+SET\b/i);
    expect(source).not.toMatch(/\bDELETE\s+FROM\b/i);
    expect(source).toMatch(/\bSELECT\b/i);
  });

  it("③ 只回四个裸整数字段，不含 name/scenario 等内容字段", () => {
    for (const forbidden of ["scenario", "name:", "\\.name\\b"]) {
      expect(source, `不该出现内容字段：${forbidden}`).not.toMatch(new RegExp(forbidden));
    }
  });
});

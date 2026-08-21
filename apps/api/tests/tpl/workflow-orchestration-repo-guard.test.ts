/**
 * #1680 gap-fill —— 把 `pg-workflow-orchestration-repository.ts` 那条
 * `lint-permission-paths` 豁免的前提钉成机械事实（同 `grouping-repo-guard.test.ts`/
 * `project-prep-repo-guard.test.ts` 的既有先例）。
 *
 * 豁免前提只有两条：
 *   ① 本文件名到的租户表恰好是 `project_workflow_orchestration`/`workflow_template_catalog` 两张。
 *   ② 从不出现 `withoutTenant`——三个方法都必须真的走 `withTenant`，否则 RLS 隔离在这个
 *      文件里就是一句注释。
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SRC = fileURLToPath(
  new URL("../../src/infrastructure/templates/pg-workflow-orchestration-repository.ts", import.meta.url),
);

function codeLines(body: string): string[] {
  return body.split("\n").filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l));
}

describe("#1680 pg-workflow-orchestration-repository.ts 权限豁免前提", () => {
  const source = codeLines(readFileSync(SRC, "utf8")).join("\n");

  it("① 名到的表恰好是允许的两张", () => {
    const named = [...new Set(
      [...source.matchAll(/\b(?:FROM|INTO|UPDATE|JOIN)\s+([a-z_][a-z0-9_]*)/gi)].map((m) => m[1]!.toLowerCase()),
    )].filter((t) => t !== "set").sort();
    expect(named).toEqual(["project_workflow_orchestration", "workflow_template_catalog"].sort());
  });

  it("② 没有 withoutTenant，三个方法都走 withTenant", () => {
    expect(source).not.toContain("withoutTenant");
    expect(source.match(/withTenant/g)?.length ?? 0).toBeGreaterThanOrEqual(4);
  });

  it("③ 阳性对照：两张表确实各自被读写过（不是完全不出现）", () => {
    expect(source).toMatch(/project_workflow_orchestration/);
    expect(source).toMatch(/workflow_template_catalog/);
  });
});

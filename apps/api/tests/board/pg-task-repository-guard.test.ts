/**
 * lint-permission-paths 白名单的反证：`pg-task-repository.ts` 只碰
 * `tasks`/`task_status_audit`/`project_memberships` 三张表，从不调用 `withoutTenant`，
 * 且非特权分支（groupLead/member）的 WHERE 子句恒带 owner/executor/同组三个判据之一 --
 * 见 `scripts/lint-permission-paths.mjs` 里对本文件的豁免条目：这个测试就是那条豁免
 * 承诺的"若删除，条目必须一并删除"的那个测试。
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

describe("F02/F06 lint-permission-paths 豁免反证：pg-task-repository.ts", () => {
  const src = fileURLToPath(new URL("../../src/infrastructure/board/pg-task-repository.ts", import.meta.url));
  const body = readFileSync(src, "utf8");
  const code = body
    .split("\n")
    .filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l))
    .join("\n");

  it("(a) 不引用 tasks/task_status_audit/project_memberships 之外的租户表", () => {
    const refs = [...code.matchAll(/\b(?:FROM|JOIN|INTO|UPDATE)\s+(\w+)/gi)].map((m) => m[1]!.toLowerCase());
    const allowed = new Set(["tasks", "task_status_audit", "project_memberships"]);
    const other = refs.filter((t) => !allowed.has(t));
    expect(other, `不应出现的表引用：${other.join(",")}`).toEqual([]);
  });

  it("(b) 从不调用 withoutTenant", () => {
    expect(code).not.toMatch(/withoutTenant/);
  });

  it("(c) 非特权分支的 WHERE 子句恒带 owner_user_id / executor / 同组 EXISTS 三个判据之一", () => {
    expect(code).toMatch(/owner_user_id\s*=\s*\$\$\{selfIdx\}/);
    expect(code).toMatch(/executor\s*=\s*\$\$\{selfIdx\}/);
    expect(code).toMatch(/EXISTS \(/);
    expect(code).toMatch(/pm\.group_id\s*=\s*\$\$\{groupIdx\}/);
  });
});

/**
 * #4615 —— `pg-whiteboard-project-access.ts` 的 permission-lint 豁免前提（源码分析，不需要 PostgreSQL）：
 *   (a) 只出现 `project_resource_links` / `projects` 两张租户表；
 *   (b) 所有查询都在调用方交来的 TenantSession 上跑（没有 withoutTenant，也不自己开 withTenant）；
 *   (c) 链接查询绑定 org_id 与 kind='whiteboard'；
 *   (d) 判定本身交给 `resolveWhiteboardProjectRole`（→ resolveProjectLayer），这里不写成员 SQL。
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("../../src/infrastructure/whiteboard/pg-whiteboard-project-access.ts", import.meta.url), "utf8");
const lint = readFileSync(new URL("../../scripts/lint-permission-paths.mjs", import.meta.url), "utf8");

function audit(code: string): string[] {
  const errors: string[] = [];
  const sql = [...code.matchAll(/`([^`]*)`/g)].map((m) => m[1]!);
  const tables = new Set(sql.flatMap((q) => [...q.matchAll(/\b(?:FROM|JOIN|INTO|UPDATE)\s+(\w+)/gi)].map((m) => m[1]!.toLowerCase())));
  const allowed = new Set(["project_resource_links", "projects"]);
  if ([...tables].some((t) => !allowed.has(t))) errors.push("table scope");
  if (/\.withoutTenant\s*\(/.test(code)) errors.push("withoutTenant");
  if (/this\.db\b|\bnew PgDatabase\b/.test(code)) errors.push("own connection");
  if (!/WHERE l\.org_id = \$1 AND l\.kind = 'whiteboard' AND l\.resource_id = \$2/.test(code)) errors.push("link tenant scope");
  if (!/JOIN projects p ON p\.id = l\.project_id AND p\.org_id = l\.org_id/.test(code)) errors.push("project tenant join");
  if (!/resolveWhiteboardProjectRole\(/.test(code)) errors.push("single decision path");
  if (/project_memberships|general_project_members|research_project_members/.test(code.replace(/\/\*[\s\S]*?\*\//g, ""))) errors.push("membership SQL");
  if (!/requested !== orgId\) throw/.test(code)) errors.push("session tenant binding");
  return errors;
}

describe("whiteboard project-access permission exemption", () => {
  it("keeps its two-table, caller-session, single-decision shape", () => {
    expect(audit(source)).toEqual([]);
    expect(lint).toContain("tests/whiteboard/project-access-guard.test.ts");
    expect(lint).toContain("src/infrastructure/whiteboard/pg-whiteboard-project-access.ts");
  });
  it("detects an added table, membership SQL and a dropped tenant predicate", () => {
    expect(audit(`${source}\nconst injected = \`SELECT * FROM whiteboard_members\`;`)).toContain("table scope");
    expect(audit(`${source}\nconst injected = \`SELECT role FROM general_project_members\`;`)).toContain("membership SQL");
    expect(audit(source.replace("WHERE l.org_id = $1 AND l.kind", "WHERE l.kind"))).toContain("link tenant scope");
    expect(audit(source.replace("if (requested !== orgId) throw", "if (false) throw"))).toContain("session tenant binding");
  });
});

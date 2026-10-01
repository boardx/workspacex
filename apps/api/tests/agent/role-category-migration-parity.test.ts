/**
 * 批次 2 角色类别：DB CHECK 的取值集合必须与契约 `AgentRoleCategory` 一致（单源 + 机械核对）。
 * 纯文件读取，不连数据库。
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { agentRole } from "@repo/contracts";

const DIR = join(__dirname, "../../migrations");

function latestCheckValues(table: string): string[] {
  const files = readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort();
  let values: string[] | null = null;
  const re = new RegExp(`ALTER TABLE ${table} ADD CONSTRAINT ${table}_role_category_check\\s+CHECK \\(role_category IS NULL OR role_category IN \\(([^)]*)\\)\\)`);
  for (const f of files) {
    const m = re.exec(readFileSync(join(DIR, f), "utf8"));
    if (m) values = [...m[1]!.matchAll(/'([a-z_]+)'/g)].map((x) => x[1]!);
  }
  if (values === null) throw new Error(`no ${table} role_category constraint migration found`);
  return values;
}

describe("agent role_category CHECK = contract AgentRoleCategory", () => {
  for (const table of ["agents", "agent_versions"]) {
    it(`${table}`, () => {
      expect([...latestCheckValues(table)].sort()).toEqual([...agentRole.AgentRoleCategory.options].sort());
    });
  }
});

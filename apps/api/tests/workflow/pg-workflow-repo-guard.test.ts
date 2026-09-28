/**
 * WF01/WF02 —— pins the conditions under which lint-permission-paths.mjs exempts the workflow PG repositories
 * (see WF01_WORKFLOW_REASON / WF02_WORKFLOW_REASON there). If this file is deleted, those allowlist entries must go too.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const API = fileURLToPath(new URL("../..", import.meta.url));
const FILES = [
  "src/infrastructure/workflow/pg-workflow-definition-repository.ts",
  "src/infrastructure/workflow/pg-workflow-instance-repository.ts",
  "src/infrastructure/workflow/pg-workflow-receipt-store.ts",
  "src/infrastructure/workflow/pg-workflow-lease-store.ts",
];
const ALLOWED_TABLES = new Set([
  "workflow_definitions", "workflow_definition_versions", "workflow_instances", // WF01
  "workflow_receipts", "workflow_leases", // WF02
]);

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : p.endsWith(".ts") ? [p] : [];
  });
}

describe("WF01 workflow repository permission boundary", () => {
  it.each(FILES)("%s names only workflow tables and never uses withoutTenant", (f) => {
    const src = readFileSync(join(API, f), "utf8");
    expect(src).not.toMatch(/withoutTenant/);
    const tables = [...src.matchAll(/\b(?:FROM|INTO|UPDATE|JOIN)\s+([a-z_]+)/g)].map((m) => m[1]);
    expect(tables.length).toBeGreaterThan(0);
    for (const t of tables) expect(ALLOWED_TABLES.has(t!), t).toBe(true);
  });

  it("no interface/ module reaches the workflow repositories yet (visibility must be attached there first)", () => {
    const offenders = walk(join(API, "src/interface")).filter((p) => /infrastructure\/workflow\//.test(readFileSync(p, "utf8")));
    expect(offenders).toEqual([]);
  });
});

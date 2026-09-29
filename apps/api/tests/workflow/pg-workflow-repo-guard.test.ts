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
  "src/infrastructure/workflow/pg-workflow-event-store.ts",
];
const ALLOWED_TABLES = new Set([
  "workflow_definitions", "workflow_definition_versions", "workflow_instances", // WF01
  "workflow_receipts", "workflow_leases", // WF02
  "workflow_events", "workflow_stage_outputs", // WF03
]);
/** WF03：准入/角色适配器只读标识，表集合单列。 */
const ACCESS_FILE = "src/infrastructure/workflow/pg-workflow-access.ts";
const ACCESS_TABLES = new Set(["org_memberships", "agents", "agent_versions"]);
/** WF04：能力授权配置只读，表集合单列。 */
const CAPABILITY_FILE = "src/infrastructure/workflow/pg-effect-capability-authority.ts";
const CAPABILITY_TABLES = new Set(["workflow_capability_grants"]);
/** WF06：触发器两步读——withoutTenant 只能碰 workflow_trigger_lookup（无 org_id，非租户表）。 */
const TRIGGER_FILE = "src/infrastructure/workflow/pg-workflow-trigger-store.ts";
const TRIGGER_TENANT_TABLES = new Set(["workflow_triggers"]);
// workflow_trigger_webhook_secrets(id)：只读 workflow_trigger_lookup 密钥列的 SECURITY DEFINER 函数（迁移 20260929060000）。
const TRIGGER_NO_TENANT_TABLES = new Set(["workflow_trigger_lookup", "workflow_trigger_webhook_secrets"]);

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

  it("WF03 access adapter names only membership/agent tables, never uses withoutTenant, selects no agent content", () => {
    const src = readFileSync(join(API, ACCESS_FILE), "utf8");
    expect(src).not.toMatch(/withoutTenant/);
    const tables = [...src.matchAll(/\b(?:FROM|INTO|UPDATE|JOIN)\s+([a-z_]+)/g)].map((m) => m[1]);
    for (const t of tables) expect(ACCESS_TABLES.has(t!), t).toBe(true);
    expect(src).not.toMatch(/\binstructions\b|\btool_policy\b/);
  });

  it("WF04 capability authority adapter names only workflow_capability_grants, never uses withoutTenant", () => {
    const src = readFileSync(join(API, CAPABILITY_FILE), "utf8");
    expect(src).not.toMatch(/withoutTenant/);
    const tables = [...src.matchAll(/\b(?:FROM|INTO|UPDATE|JOIN)\s+([a-z_]+)/g)].map((m) => m[1]);
    expect(tables.length).toBeGreaterThan(0);
    for (const t of tables) expect(CAPABILITY_TABLES.has(t!), t).toBe(true);
  });

  it("WF06 trigger store's only withoutTenant call names workflow_trigger_lookup (not a tenant table); its only tenant-table read (workflow_triggers) always goes through withTenant", () => {
    const src = readFileSync(join(API, TRIGGER_FILE), "utf8");
    const tables = [...src.matchAll(/\b(?:FROM|INTO|UPDATE|JOIN)\s+([a-z_]+)/g)].map((m) => m[1]);
    expect(tables.length).toBeGreaterThan(0);
    for (const t of tables) expect(TRIGGER_TENANT_TABLES.has(t!) || TRIGGER_NO_TENANT_TABLES.has(t!), t).toBe(true);
    // withoutTenant(...) 的调用块只允许出现 workflow_trigger_lookup；出现 workflow_triggers 就说明
    // 有一条租户表读绕开了 withTenant。
    const withoutTenantBlocks = [...src.matchAll(/withoutTenant\([\s\S]*?\n\s*\);/g)].map((m) => m[0]);
    expect(withoutTenantBlocks.length).toBeGreaterThan(0);
    for (const block of withoutTenantBlocks) {
      expect(block).toMatch(/workflow_trigger_lookup|workflow_trigger_webhook_secrets/);
      expect(block).not.toMatch(/\bworkflow_triggers\b/);
    }
  });

  // WF03 加了 HTTP 面（workflow-runtime.controller.ts）：它只经应用层门面（可见性在 instance-projection.ts 判），
  // 仍不直接 import 任何 PG 适配器——这条继续守住。
  it("no interface/ module reaches the workflow repositories directly (visibility is decided in the application layer)", () => {
    const offenders = walk(join(API, "src/interface")).filter((p) => /infrastructure\/workflow\//.test(readFileSync(p, "utf8")));
    expect(offenders).toEqual([]);
  });
});

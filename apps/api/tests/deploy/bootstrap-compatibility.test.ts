import { describe, expect, it } from "vitest";
import { BOOTSTRAP_RELATIONS, guardBootstrapReadOnly, initialBootstrapResult, parseBootstrapCompatibilityOutput, probeBootstrapCompatibility, type BootstrapProbeInput, type ReadOnlyClient } from "../../src/infrastructure/deploy/bootstrap-compatibility";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { DEFAULT_AGENT_TEMPLATE } from "../../src/infrastructure/agent/pg-default-agent-repository";
import { DEEP_RESEARCH_AGENT_TEMPLATE } from "../../src/infrastructure/agent/pg-deep-research-agent-repository";
import { IMAGE_GEN_AGENT_TEMPLATE } from "../../src/infrastructure/agent/pg-image-gen-agent-repository";

const input: BootstrapProbeInput = { sourceSha: "a".repeat(40), phase: "prebuild", email: "admin@example.test", password: "A-valid-Password-123!", displayName: "Administrator", orgName: "Production" };
type Options = { guard?: string; missingColumn?: boolean; missingConstraint?: boolean; permission?: boolean; markers?: number; credentials?: number; duplicateAgent?: boolean; existingAgent?: boolean; wrongProvider?: boolean; rollbackFailure?: boolean; sequencePermission?: boolean };
function fake(options: Options = {}): ReadOnlyClient & { statements: string[] } {
  const statements: string[] = [];
  return { statements, async query(sql, args = []) {
    statements.push(sql);
    if (sql === "ROLLBACK" && options.rollbackFailure) throw new Error("SECRET DSN should never be output");
    if (sql.startsWith("SHOW")) return { rows: [{ transaction_read_only: options.guard ?? "on" }] };
    if (sql.includes("information_schema")) {
      const r = BOOTSTRAP_RELATIONS[args[0] as keyof typeof BOOTSTRAP_RELATIONS];
      return { rows: r.columns.slice(options.missingColumn ? 1 : 0).map(column_name => ({ column_name })) };
    }
    if (sql.includes("has_table_privilege")) return { rows: [{ allowed: options.permission !== false }] };
    if (sql.includes("AS conname")) return { rows: (options.missingConstraint ? [] : args[0] as string[]).map(conname => ({ conname })) };
    if (sql.includes("pg_index")) return { rows: [{ valid: true }] };
    if (sql.includes("has_function_privilege")) return { rows: [{ present: true, allowed: true }] };
    if (sql.includes("has_sequence_privilege")) return { rows: options.sequencePermission === false ? [{ allowed: false }] : [] };
    if (sql.includes("AS markers")) return { rows: [{ markers: options.markers ?? 1, credentials: options.credentials ?? 1 }] };
    if (sql.includes("password_hash")) return { rows: [{ user_id: "user-private", password_hash: "private-hash", email_verified_at: new Date() }] };
    if (sql.includes("kernel_user_org_ids")) return { rows: [{ org_id: "org-private", org_role: "admin" }] };
    if (sql.includes("SELECT name,kind")) return { rows: [{ name: input.orgName, kind: "organization" }] };
    if (sql.includes("LEFT JOIN")) {
      if (options.duplicateAgent) return { rows: [{}, {}] };
      if (!options.existingAgent) return { rows: [] };
      const template = [DEFAULT_AGENT_TEMPLATE, DEEP_RESEARCH_AGENT_TEMPLATE, IMAGE_GEN_AGENT_TEMPLATE].find(t => t.stableName === args[1])!;
      return { rows: [{ id: "agent-private", org_id: "org-private", agent_id: "agent-private", version_org: "org-private",
        model_provider: options.wrongProvider ? "wrong-provider" : template.resolveModel().provider,
        published_at: new Date(), listing_id: "agent-private", listing_org: "org-private", listing_kind: "agent" }] };
    }
    if (sql.includes("AS collision")) return { rows: [{ collision: false }] };
    return { rows: [] };
  } };
}
describe("read-only bootstrap compatibility", () => {
  it("checks matching administrator and three missing idempotent seeds without writes", async () => {
    const db = fake(); const result = await probeBootstrapCompatibility(db, input, async () => true);
    expect(result.ready).toBe(true); expect(result.stateClass).toBe("matching-existing");
    expect(db.statements[0]).toBe("BEGIN TRANSACTION READ ONLY"); expect(db.statements.at(-1)).toBe("ROLLBACK");
    expect(db.statements.filter(s => s.includes("LEFT JOIN"))).toHaveLength(3);
    const output = JSON.stringify(result); expect(output).not.toContain("user-private"); expect(output).not.toContain("private-hash"); expect(output).not.toContain(input.password);
    expect(result.productionWriteStatements).toBe(0);
  });
  it("classifies a genuinely empty installation", async () => {
    expect((await probeBootstrapCompatibility(fake({ markers: 0, credentials: 0 }), input)).stateClass).toBe("empty");
  });
  it.each([
    [{ guard: "off" }, "BOOTSTRAP_READ_ONLY_GUARD_FAILED"],
    [{ missingColumn: true }, "BOOTSTRAP_DB_SCHEMA_INCOMPATIBLE"],
    [{ missingConstraint: true }, "BOOTSTRAP_DB_SCHEMA_INCOMPATIBLE"],
    [{ permission: false }, "BOOTSTRAP_DB_PERMISSION_INCOMPATIBLE"],
    [{ sequencePermission: false }, "BOOTSTRAP_DB_PERMISSION_INCOMPATIBLE"],
    [{ markers: 0 }, "BOOTSTRAP_STATE_CONFLICT"],
    [{ duplicateAgent: true }, "BOOTSTRAP_AGENT_SEED_INCOMPATIBLE"],
    [{ existingAgent: true, wrongProvider: true }, "BOOTSTRAP_AGENT_SEED_INCOMPATIBLE"],
    [{ rollbackFailure: true }, "BOOTSTRAP_READ_ONLY_GUARD_FAILED"],
  ] as const)("fails closed and always rolls back for %j", async (options, code) => {
    const db = fake(options); const r = await probeBootstrapCompatibility(db, input, async () => true);
    expect(r.ready).toBe(false); expect(r.blockers).toContain(code); expect(db.statements.at(-1)).toBe("ROLLBACK"); expect(r.productionWriteStatements).toBe(0);
  });
  it("rejects mismatching administrator password without leaking it", async () => {
    const r = await probeBootstrapCompatibility(fake(), input, async () => false);
    expect(r.blockers).toEqual(["BOOTSTRAP_EXISTING_ADMIN_MISMATCH"]);
  });
  it("accepts all three published seed identities using canonical provider mappings", async () => {
    expect((await probeBootstrapCompatibility(fake({ existingAgent: true }), input, async () => true)).ready).toBe(true);
  });
  it("invalid password policy fails before opening a transaction", async () => {
    const db = fake(); const r = await probeBootstrapCompatibility(db, { ...input, password: "x" });
    expect(r.blockers).toEqual(["BOOTSTRAP_INPUT_INVALID"]); expect(db.statements).toHaveLength(0);
  });
  it("requires exact image digest only in preactivate", () => {
    expect(initialBootstrapResult(input).blockers).toEqual([]);
    expect(initialBootstrapResult({ ...input, phase: "preactivate" }).blockers).toContain("BOOTSTRAP_INPUT_INVALID");
  });
  it("rejects injected INSERT before a driver receives it", async () => {
    const db = fake(); const guarded = guardBootstrapReadOnly(db);
    await expect(guarded.query("INSERT INTO credentials VALUES ($1)", ["secret"])).rejects.toThrow("BOOTSTRAP_READ_ONLY_GUARD_FAILED");
    await expect(guarded.query("SELECT 1; DELETE FROM credentials")).rejects.toThrow();
    expect(db.statements).toHaveLength(0);
  });
  it("rejects pnpm noise or duplicate machine records", () => {
    const line = `CN_BOOTSTRAP_COMPAT_JSON=${JSON.stringify(initialBootstrapResult(input))}`;
    expect(parseBootstrapCompatibilityOutput(line).sourceSha).toBe(input.sourceSha);
    expect(() => parseBootstrapCompatibilityOutput(`pnpm noise\n${line}`)).toThrow("BOOTSTRAP_MACHINE_OUTPUT_INVALID");
    expect(() => parseBootstrapCompatibilityOutput(`${line}\n${line}`)).toThrow("BOOTSTRAP_MACHINE_OUTPUT_INVALID");
  });
  it("loads actual source entry/dependency closure without contacting a database", () => {
    const script = resolve("apps/api/scripts/provision-admin-compatibility.ts");
    const run = spawnSync(process.execPath, ["--import", "tsx", script, "--static"], {
      timeout: 10000, encoding: "utf8", cwd: resolve("apps/api"), env: { ...process.env,
        WORKSPACEX_DEPLOY_PROFILE: "starter", PGHOST: "127.0.0.1", PGPORT: "1", PGDATABASE: "probe_never_connected",
        PGSSLMODE: "disable", PGSSLROOTCERT: "", APP_DB_USER: "app_rw", APP_DB_PASSWORD: "fixture-credential-at-least-16",
        CN_BOOTSTRAP_SOURCE_SHA: input.sourceSha, CN_BOOTSTRAP_PHASE: "prebuild",
        PROVISION_ADMIN_EMAIL: input.email, PROVISION_ADMIN_PASSWORD: input.password,
        PROVISION_ADMIN_NAME: input.displayName, PROVISION_ORG_NAME: input.orgName,
      },
    });
    expect(run.status).toBe(0); const r = parseBootstrapCompatibilityOutput(run.stdout);
    expect(r.ready).toBe(true); expect(r.readOnlyTransaction).toBe(false);
  });
});

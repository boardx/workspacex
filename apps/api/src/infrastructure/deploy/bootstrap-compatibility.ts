import { createHash } from "node:crypto";
import { auth } from "@repo/contracts";
import bcrypt from "bcryptjs";
import { DEFAULT_AGENT_TEMPLATE } from "../agent/pg-default-agent-repository";
import { DEEP_RESEARCH_AGENT_TEMPLATE } from "../agent/pg-deep-research-agent-repository";
import { IMAGE_GEN_AGENT_TEMPLATE } from "../agent/pg-image-gen-agent-repository";
import { BOOTSTRAP_WRITE_COLUMNS as W } from "./bootstrap-write-columns";
import { AGENT_ROLE_COLUMN_OF } from "../agent/agent-version-insert";

export interface ReadOnlyClient { query(sql: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>; }
export function guardBootstrapReadOnly(client: ReadOnlyClient): ReadOnlyClient {
  return { async query(sql, values) {
    // Fixed probe statements only; parameters hold all caller/DB values. Prevent a future
    // accidental write before PostgreSQL's read-only transaction supplies the second guard.
    if (!/^(SELECT\b|SHOW transaction_read_only$|SET LOCAL statement_timeout = '5000ms'$|BEGIN TRANSACTION READ ONLY$|ROLLBACK$)/.test(sql)
      || /;|--|\/\*|\b(INSERT|UPDATE|DELETE|MERGE|COPY|CREATE|ALTER|DROP|TRUNCATE|CALL|DO|LOCK)\b/i.test(sql)) {
      throw new Error("BOOTSTRAP_READ_ONLY_GUARD_FAILED");
    }
    return client.query(sql, values);
  } };
}
export type BootstrapPhase = "prebuild" | "preactivate";
export interface BootstrapProbeInput {
  sourceSha: string; phase: BootstrapPhase; imageDigest?: string;
  migrationInventory?: ReadonlyArray<{ name: string; checksum: string }>;
  email: string; password: string; displayName: string; orgName: string;
}
export interface BootstrapCompatibilityResult {
  schemaVersion: 1; sourceSha: string; phase: BootstrapPhase; imageDigest?: string;
  ready: boolean; readOnlyTransaction: boolean; productionWriteStatements: 0;
  stateClass: "unknown" | "empty" | "matching-existing" | "conflict";
  checks: Record<string, boolean>; blockers: string[]; adminEmailSha256?: string;
}

export function parseBootstrapCompatibilityOutput(output: string): BootstrapCompatibilityResult {
  const lines = output.trimEnd().split("\n");
  if (lines.length !== 1 || !lines[0]!.startsWith("CN_BOOTSTRAP_COMPAT_JSON=")) throw new Error("BOOTSTRAP_MACHINE_OUTPUT_INVALID");
  let value: unknown;
  try { value = JSON.parse(lines[0]!.slice("CN_BOOTSTRAP_COMPAT_JSON=".length)); } catch { throw new Error("BOOTSTRAP_MACHINE_OUTPUT_INVALID"); }
  if (!value || typeof value !== "object" || (value as BootstrapCompatibilityResult).schemaVersion !== 1
    || typeof (value as BootstrapCompatibilityResult).ready !== "boolean"
    || !Array.isArray((value as BootstrapCompatibilityResult).blockers)) throw new Error("BOOTSTRAP_MACHINE_OUTPUT_INVALID");
  return value as BootstrapCompatibilityResult;
}

/** Catalog requirements for the canonical bootstrap and three exported seed templates.
 * Kept in TypeScript beside the repositories, never copied into the release shell.
 * Agent frozen columns come from the actual version INSERT mapping.
 */
export const BOOTSTRAP_RELATIONS = {
  auth_bootstrap_state: { columns: W.marker, privileges: ["SELECT", "INSERT"] },
  credentials: { columns: W.credential, privileges: ["SELECT", "INSERT"] },
  organizations: { columns: W.personalLocal, privileges: ["SELECT", "INSERT"] },
  org_memberships: { columns: W.membership, privileges: ["SELECT", "INSERT"] },
  agents: { columns: [...W.agentInsertColumns, ...Object.values(AGENT_ROLE_COLUMN_OF)], privileges: ["SELECT", "INSERT", "UPDATE"] },
  agent_versions: { columns: [...W.version, ...Object.values(AGENT_ROLE_COLUMN_OF)], privileges: ["SELECT", "INSERT"] },
  capability_listings: { columns: W.listing, privileges: ["SELECT", "INSERT"] },
} as const;
const constraints = ["credentials_email_uniq", "agents_stable_name_uniq", "agent_versions_semantic_uniq", "capability_listings_uniq"];
const seeds = [DEFAULT_AGENT_TEMPLATE, DEEP_RESEARCH_AGENT_TEMPLATE, IMAGE_GEN_AGENT_TEMPLATE];
const fail = (result: BootstrapCompatibilityResult, code: string): void => { result.blockers.push(code); };

export function initialBootstrapResult(input: BootstrapProbeInput): BootstrapCompatibilityResult {
  const valid = auth.operations.bootstrapFirstUser.in.safeParse(input).success
    && /^[a-f0-9]{40}$/.test(input.sourceSha)
    && (input.phase === "prebuild" || input.phase === "preactivate")
    && (input.phase !== "preactivate" || /^sha256:[a-f0-9]{64}$/.test(input.imageDigest ?? ""));
  return { schemaVersion: 1, sourceSha: input.sourceSha, phase: input.phase,
    ...(input.phase === "preactivate" ? { imageDigest: input.imageDigest } : {}),
    ready: false, readOnlyTransaction: false, productionWriteStatements: 0, stateClass: "unknown",
    checks: { [input.phase === "prebuild" ? "sourceEntrypoint" : "imageEntrypoint"]: true,
      inputContract: valid, schemaContract: false, permissionContract: false, agentSeedContract: false },
    blockers: valid ? [] : ["BOOTSTRAP_INPUT_INVALID"] };
}

/** Only catalog/read queries and transaction-local tenant context. Never calls bootstrap/seed writes. */
export async function probeBootstrapCompatibility(client: ReadOnlyClient, input: BootstrapProbeInput,
  verifyPassword = (password: string, hash: string) => bcrypt.compare(password, hash),
): Promise<BootstrapCompatibilityResult> {
  client = guardBootstrapReadOnly(client);
  const result = initialBootstrapResult(input);
  if (result.blockers.length) return result;
  result.adminEmailSha256 = createHash("sha256").update(input.email.trim().toLowerCase()).digest("hex");
  let began = false;
  try {
    await client.query("BEGIN TRANSACTION READ ONLY"); began = true;
    const guard = await client.query("SHOW transaction_read_only");
    if (guard.rows[0]?.transaction_read_only !== "on") {
      fail(result, "BOOTSTRAP_READ_ONLY_GUARD_FAILED"); return result;
    }
    result.readOnlyTransaction = true;
    await client.query("SET LOCAL statement_timeout = '5000ms'");
    if (input.phase === "preactivate") {
      const expected = input.migrationInventory;
      const ledger = await client.query("SELECT name,checksum FROM public._kernel_migrations ORDER BY name COLLATE \"C\"");
      const actual = new Map(ledger.rows.map(row => [row.name, row.checksum]));
      if (!expected?.length || actual.size !== ledger.rows.length || actual.size !== expected.length
        || new Set(expected.map(row => row.name)).size !== expected.length
        || expected.some(row => !/^[a-f0-9]{64}$/.test(row.checksum) || actual.get(row.name) !== row.checksum)) {
        fail(result, "BOOTSTRAP_DB_SCHEMA_INCOMPATIBLE"); return result;
      }
      result.checks.migrationLedgerContract = true;
    }
    for (const [name, requirement] of Object.entries(BOOTSTRAP_RELATIONS)) {
      const r = await client.query("SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=$1", [name]);
      const found = new Set(r.rows.map(row => row.column_name));
      if (requirement.columns.some(column => !found.has(column))) { fail(result, "BOOTSTRAP_DB_SCHEMA_INCOMPATIBLE"); return result; }
      for (const privilege of requirement.privileges) {
        const p = await client.query("SELECT has_table_privilege(current_user,$1,$2) AS allowed", [`public.${name}`, privilege]);
        if (p.rows[0]?.allowed !== true) { fail(result, "BOOTSTRAP_DB_PERMISSION_INCOMPATIBLE"); return result; }
      }
    }
    const catalog = await client.query("SELECT c.relname AS conname FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid WHERE i.indisunique AND i.indisvalid AND c.relnamespace='public'::regnamespace AND c.relname=ANY($1::text[])", [constraints]);
    const names = new Set(catalog.rows.map(row => row.conname));
    const localUnique = await client.query("SELECT i.indisunique AND i.indisvalid AS valid FROM pg_index i WHERE i.indexrelid=to_regclass('public.organizations_one_personal_local_per_user')");
    const functionPermission = await client.query("SELECT to_regprocedure('public.kernel_user_org_ids(text)') IS NOT NULL AS present, has_function_privilege(current_user,to_regprocedure('public.kernel_user_org_ids(text)'),'EXECUTE') AS allowed");
    if (constraints.some(name => !names.has(name)) || localUnique.rows[0]?.valid !== true || functionPermission.rows[0]?.present !== true) {
      fail(result, "BOOTSTRAP_DB_SCHEMA_INCOMPATIBLE"); return result;
    }
    result.checks.schemaContract = true;
    if (functionPermission.rows[0]?.allowed !== true) { fail(result, "BOOTSTRAP_DB_PERMISSION_INCOMPATIBLE"); return result; }
    result.checks.permissionContract = true;
    // Defaults may acquire sequences in a later repository revision. Catalog privilege
    // checks discover those dependencies; they never advance a sequence to test access.
    const sequences = await client.query("SELECT has_sequence_privilege(current_user,s.oid,'USAGE,SELECT') AS allowed FROM pg_class s JOIN pg_depend d ON d.objid=s.oid JOIN pg_class t ON t.oid=d.refobjid WHERE s.relkind='S' AND t.relnamespace='public'::regnamespace AND t.relname=ANY($1::text[])", [Object.keys(BOOTSTRAP_RELATIONS)]);
    if (sequences.rows.some(row => row.allowed !== true)) { result.checks.permissionContract = false; fail(result, "BOOTSTRAP_DB_PERMISSION_INCOMPATIBLE"); return result; }
    const state = await client.query("SELECT (SELECT count(*)::int FROM auth_bootstrap_state WHERE singleton=true) AS markers, (SELECT count(*)::int FROM credentials) AS credentials");
    const markers = state.rows[0]?.markers; const credentials = state.rows[0]?.credentials;
    if (markers === 0 && credentials === 0) {
      result.stateClass = "empty"; result.checks.agentSeedContract = true; result.ready = true; return result;
    }
    if (markers !== 1 || typeof credentials !== "number" || credentials < 1) {
      result.stateClass = "conflict"; fail(result, "BOOTSTRAP_STATE_CONFLICT"); return result;
    }
    const admin = await client.query("SELECT user_id,password_hash,email_verified_at FROM credentials WHERE email=$1", [input.email.trim().toLowerCase()]);
    const credential = admin.rows[0];
    if (admin.rows.length !== 1 || !credential?.email_verified_at || typeof credential.password_hash !== "string"
      || !await verifyPassword(input.password, credential.password_hash)) {
      result.stateClass = "conflict"; fail(result, "BOOTSTRAP_EXISTING_ADMIN_MISMATCH"); return result;
    }
    const memberships = await client.query("SELECT org_id,org_role FROM kernel_user_org_ids($1)", [credential.user_id]);
    const matches: string[] = [];
    for (const membership of memberships.rows) {
      if (membership.org_role !== "admin" || typeof membership.org_id !== "string") continue;
      await client.query("SELECT set_config('app.current_org',$1,true)", [membership.org_id]);
      const org = await client.query("SELECT name,kind FROM organizations WHERE id=$1", [membership.org_id]);
      if (org.rows[0]?.name === input.orgName && org.rows[0]?.kind === "organization") matches.push(membership.org_id);
    }
    if (matches.length !== 1) { result.stateClass = "conflict"; fail(result, "BOOTSTRAP_EXISTING_ADMIN_MISMATCH"); return result; }
    await client.query("SELECT set_config('app.current_org',$1,true)", [matches[0]]);
    for (const template of seeds) {
      const agents = await client.query("SELECT a.id,a.org_id,a.published_version_id,v.agent_id,v.org_id AS version_org,v.model_provider,v.published_at,c.id AS listing_id,c.org_id AS listing_org,c.kind AS listing_kind FROM agents a LEFT JOIN agent_versions v ON v.id=a.published_version_id AND v.org_id=a.org_id LEFT JOIN capability_listings c ON c.id=a.id WHERE a.org_id=$1 AND a.stable_name=$2", [matches[0], template.stableName]);
      if (agents.rows.length > 1) { fail(result, "BOOTSTRAP_AGENT_SEED_INCOMPATIBLE"); return result; }
      if (agents.rows.length === 1) {
        const a = agents.rows[0]!;
        if (a.org_id !== matches[0] || a.agent_id !== a.id || a.version_org !== matches[0]
          || a.model_provider !== template.resolveModel().provider || !a.published_at
          || a.listing_id !== a.id || a.listing_org !== matches[0] || a.listing_kind !== "agent") {
          fail(result, "BOOTSTRAP_AGENT_SEED_INCOMPATIBLE"); return result;
        }
      } else {
        const collision = await client.query("SELECT (EXISTS(SELECT 1 FROM agents WHERE org_id=$1 AND lower(name)=lower($2)) OR EXISTS(SELECT 1 FROM capability_listings WHERE org_id=$1 AND kind='agent' AND name=$2)) AS collision", [matches[0], template.name]);
        if (collision.rows[0]?.collision !== false) { fail(result, "BOOTSTRAP_AGENT_SEED_INCOMPATIBLE"); return result; }
      }
    }
    result.stateClass = "matching-existing"; result.checks.agentSeedContract = true; result.ready = true;
  } catch (error) {
    fail(result, error instanceof Error && error.message === "BOOTSTRAP_READ_ONLY_GUARD_FAILED"
      ? "BOOTSTRAP_READ_ONLY_GUARD_FAILED" : "BOOTSTRAP_COMPATIBILITY_UNKNOWN");
  } finally {
    if (began) try { await client.query("ROLLBACK"); } catch {
      result.ready = false; result.readOnlyTransaction = false; fail(result, "BOOTSTRAP_READ_ONLY_GUARD_FAILED");
    }
  }
  return result;
}

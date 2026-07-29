#!/usr/bin/env node
/**
 * lint-permission-paths.mjs -- the structural half of R7 "permission travels along the
 * data path" (UC-0.3 R7 / R12 V10, coherence X-1).
 *
 * `permission-filter.ts` makes it impossible to DISCLOSE tenant content without a
 * decision: the payload is unreachable except through `disclose()`. What it cannot do is
 * stop someone reading the table directly and never wrapping the rows at all. That is the
 * bypass this script closes.
 *
 * ## The rule
 *
 * A file under `apps/api/src` that names a tenant-carrying table in SQL must
 *   (a) live under `src/infrastructure/`  -- data access is not a controller's job, and
 *   (b) import `application/security/permission-filter` -- i.e. hand back `Guarded<T>`.
 * Anything else is a read path that reaches tenant rows with no decision attached.
 *
 * ## The table list is derived, never written down
 *
 * Tenant tables come from parsing `apps/api/migrations/*.sql`: any CREATE TABLE whose body
 * declares `org_id`, plus whatever those columns REFERENCE (that is how `organizations` is
 * found). Same derivation as `kernel_tenant_table_audit()` in the database, for the same
 * reason: a hand-maintained list is missing exactly the table someone just added, and the
 * gate stays green while the newest table is the unguarded one.
 *
 * ## The allowlist, and why it is three files
 *
 * Enumerated here rather than inferred, and each entry states what makes it different --
 * an allowlist without reasons grows.
 */
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join, relative, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const API = join(dirname(fileURLToPath(import.meta.url)), "..");
const MIGRATIONS = join(API, "migrations");
const FILTER_MODULE = "application/security/permission-filter";

/**
 * Files permitted to read tenant tables without going through the filter.
 *
 * Every entry is a place where the filter CANNOT apply, not a place where it was
 * inconvenient. Keep it at three; a fourth needs an argument this shape:
 */
const ALLOWLIST = new Map([
  [
    "src/infrastructure/identity/pg-identity-repository.ts",
    "reads the memberships and bindings the decision is MADE from -- guarding it with the decision would be circular",
  ],
  [
    "src/interface/controllers/kernel-probe.controller.ts",
    "the RLS evidence surface (UC-0.6): it must read rls_probe with NO application-level filtering, because the whole point is proving the database layer alone isolates",
  ],
  [
    "src/infrastructure/db/migrator.ts",
    "schema/DDL machinery; its rls_probe row count feeds the migration idempotency digest, not a response",
  ],
  [
    "src/infrastructure/auth/pg-registration-repository.ts",
    "F19 registration: WRITE-ONLY against tenant tables. `Guarded<T>` protects DISCLOSURE -- it makes it impossible to hand tenant content to a requester without a decision. This path discloses nothing: at the moment it runs the organization does not exist yet and there is no requester to judge, because the caller is an anonymous visitor holding an invite code. Wrapping an INSERT in a permission decision would mean asking 'may this person read the row they are creating', which has no answer. ⚠ The exemption is valid ONLY while the file stays write-only, so it is not left as a claim: tests/auth/registration-repo-is-write-only.test.ts parses the file and fails if any statement naming a tenant table is not an INSERT. If that test is ever deleted, this entry must go with it.",
  ],
  [
    "src/infrastructure/provenance/pg-provenance-repository.ts",
    "provenance_events (and provenance_notifications, which holds only 'who was told about which event') is the AUDIT TRAIL, not tenant content: an append-only record of who touched what. Guarding it with the same filter would be circular in the same way the identity repository is -- the trail is what you consult to answer 'was that read authorised', so it cannot itself require the answer first. Who may READ the trail is enforced one layer up, in application/provenance/query-provenance.ts (project lead sees their project, everyone sees their own, nobody sees a stranger's), and that rule has its own tests.",
  ],
]);

/** Parse the migrations for tenant-carrying table names. */
function tenantTables() {
  const tables = new Set();
  const roots = new Set();
  if (!existsSync(MIGRATIONS)) return tables;
  for (const f of readdirSync(MIGRATIONS).filter((n) => n.endsWith(".sql")).sort()) {
    const sql = readFileSync(join(MIGRATIONS, f), "utf8");
    for (const m of sql.matchAll(/CREATE TABLE(?:\s+IF NOT EXISTS)?\s+(\w+)\s*\(([\s\S]*?)\n\);/gi)) {
      const [, name, body] = m;
      if (!/^\s*org_id\b/m.test(body)) continue;
      tables.add(name.toLowerCase());
      // Whatever org_id points at is the tenant root -- `organizations` is discovered, not typed.
      for (const r of body.matchAll(/^\s*org_id\b[^,]*?REFERENCES\s+(\w+)/gim)) roots.add(r[1].toLowerCase());
    }
  }
  for (const r of roots) tables.add(r);
  return tables;
}

function walk(dir, out = []) {
  for (const n of readdirSync(dir)) {
    if (n === "node_modules" || n.startsWith(".")) continue;
    const p = join(dir, n);
    statSync(p).isDirectory() ? walk(p, out) : /\.ts$/.test(n) && out.push(p);
  }
  return out;
}

const TABLES = tenantTables();
const ROOTS = process.argv.slice(2).length ? process.argv.slice(2) : [join(API, "src")];

let fail = 0;
let scanned = 0;

// `FROM x` / `JOIN x` / `INTO x` / `UPDATE x` / `DELETE FROM x`. Deliberately SQL-keyword
// anchored: a bare identifier match would fire on the word `projects` in prose. This
// project has two precedents for a noisy gate being muted, so over-firing is treated as a
// failure mode of equal weight.
const SQL_REF = /\b(?:FROM|JOIN|INTO|UPDATE)\s+(\w+)/gi;

for (const root of ROOTS) {
  const abs = root.startsWith("/") ? root : join(API, "..", "..", root);
  if (!existsSync(abs)) {
    console.log(`  (skipping ${root}: does not exist)`);
    continue;
  }
  for (const file of walk(abs)) {
    scanned++;
    const rel = relative(API, file);
    if (ALLOWLIST.has(rel)) continue;
    const body = readFileSync(file, "utf8");
    const guarded = body.includes(FILTER_MODULE);
    const inInfra = rel.includes("/infrastructure/") || rel.startsWith("infrastructure/");

    body.split("\n").forEach((line, i) => {
      // A comment naming a table is documentation of the rule, not a violation of it
      // (same exemption lint-error-leak makes, for the same reason).
      if (/^\s*(\*|\/\/|\/\*)/.test(line)) return;
      for (const m of line.matchAll(SQL_REF)) {
        const t = m[1].toLowerCase();
        if (!TABLES.has(t)) continue;
        if (inInfra && guarded) return;
        console.error(`✗ ${rel}:${i + 1}  reads tenant table \`${t}\` outside the guarded read path`);
        console.error(
          inInfra
            ? `    It is in infrastructure/ but does not import ${FILTER_MODULE}: it returns raw rows, so whatever calls it has nothing forcing a permission decision.`
            : `    Tenant data must be read in infrastructure/ and returned as Guarded<T> (${FILTER_MODULE}).`,
        );
        console.error(
          `    Why: UC-0.3 R7 -- a scope on an Artifact must reach its segments, embeddings, graph nodes, cache entries and Context Pack items. An unguarded read is how "you cannot see the original but the summary launders it out" happens.`,
        );
        fail++;
        return;
      }
    });
  }
}

console.log(
  fail === 0
    ? `✅ lint-permission-paths: every tenant-table read goes through the guarded read path`
    : `\n❌ ${fail} unguarded tenant read(s). See UC-0.3 R7 / coherence X-1.`,
);
// Machine-readable, asserted by permission-propagation-six-paths.test.ts. Against an empty
// tree, or with a table list that failed to parse, this gate exits 0 while testing nothing
// -- so the test asserts these numbers, not the exit code.
console.log(`scanned=${scanned} tenant-tables=${TABLES.size} allowlisted=${ALLOWLIST.size}`);
process.exit(fail === 0 ? 0 : 1);

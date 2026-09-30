/** Read-only inventory. A passing plan never authorizes migration or activation. */
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

export interface MigrationIdentity { name: string; checksum: string }
export type MigrationRisk = "additive" | "contract" | "destructive" | "unknown";
export interface PendingMigration extends MigrationIdentity { risk: MigrationRisk }
export interface LegacyDriftEvidence {
  name: string; ledgerChecksum: string; sourceChecksum: string;
  baselineSourceChecksum: string; runningImageSourceChecksum: string;
  evidenceSha256: string;
}
export interface MigrationPlanInput {
  targetSha: string; baselineSha: string; ledger: MigrationIdentity[];
  legacyDriftEvidence?: LegacyDriftEvidence[];
}
const sha = /^[a-f0-9]{40}$/;
const hash = /^[a-f0-9]{64}$/;
export const migrationHash = (value: string | Buffer): string => createHash("sha256").update(value).digest("hex");
const canonicalHash = (value: unknown): string => migrationHash(JSON.stringify(value));
const compare = (a: MigrationIdentity, b: MigrationIdentity): number => a.name < b.name ? -1 : a.name > b.name ? 1 : 0;

/** Conservative triage only: dynamic SQL and unrecognized statements remain unknown.
 * No SQL is executed. Dollar bodies, quoted identifiers, strings and comments cannot
 * earn additive classification. Even additive DDL still requires rehearsal/backup.
 */
export function classifyMigration(sql: string): MigrationRisk {
  const text = sql.replace(/--[^\n]*(?:\n|$)/g, " ").replace(/\/\*[\s\S]*?\*\//g, " ").trim();
  if (/\b(?:DROP|TRUNCATE)\b|\bDELETE\s+FROM\b/i.test(text) || /\bALTER\b[\s\S]*\bRENAME\b/i.test(text)) return "destructive";
  if (/\$|['"]|\/\*|\*\//.test(text)) return "unknown";
  const statements = text.split(";").map(part => part.trim()).filter(Boolean);
  if (!statements.length) return "unknown";
  const identifier = "[A-Za-z_][A-Za-z0-9_]*";
  const type = "(?:smallint|integer|bigint|text|boolean|uuid|date|timestamp|timestamptz|jsonb|real|double precision)";
  const column = `${identifier}\\s+${type}(?:\\s+(?:NOT NULL|NULL|PRIMARY KEY|UNIQUE))*`;
  const table = new RegExp(`^CREATE\\s+TABLE\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?${identifier}\\s*\\(\\s*${column}(?:\\s*,\\s*${column})*\\s*\\)$`, "i");
  const index = new RegExp(`^CREATE\\s+(?:UNIQUE\\s+)?INDEX\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?${identifier}\\s+ON\\s+${identifier}\\s*\\(\\s*${identifier}(?:\\s*,\\s*${identifier})*\\s*\\)$`, "i");
  if (statements.every(statement => table.test(statement) || index.test(statement))) return "additive";
  if (statements.every(statement => /^ALTER\s+TABLE\s+/i.test(statement))) return "contract";
  return "unknown";
}

/** Pure comparison, also used for synthetic failure probes. Inventories are ordered
 * exactly as migrationFiles(), and include every SQL file, not a regex subset.
 */
export function compareMigrationInventory(input: MigrationPlanInput, files: Array<MigrationIdentity & { sql: string }>) {
  const blockers: string[] = [];
  if (!sha.test(input.targetSha) || !sha.test(input.baselineSha)) blockers.push("invalid_exact_sha");
  const ledger = input.ledger.map(({ name, checksum }) => ({ name, checksum })).sort(compare);
  const names = new Set<string>();
  for (const entry of ledger) {
    if (!entry.name.endsWith(".sql") || entry.name.includes("/") || entry.name.includes("\\") || !hash.test(entry.checksum)) blockers.push("invalid_ledger_entry");
    if (names.has(entry.name)) blockers.push(`duplicate_ledger:${entry.name}`);
    names.add(entry.name);
  }
  const sourceNames = new Set<string>();
  let previous: string | undefined;
  for (const file of files) {
    if (sourceNames.has(file.name) || (previous !== undefined && previous >= file.name)) blockers.push(`invalid_source_order:${file.name}`);
    if (!hash.test(file.checksum) || migrationHash(file.sql) !== file.checksum) blockers.push(`source_checksum_mismatch:${file.name}`);
    sourceNames.add(file.name); previous = file.name;
  }
  const drift: Array<{ name: string; ledgerChecksum: string; sourceChecksum: string; evidence: LegacyDriftEvidence | null }> = [];
  for (const applied of ledger) {
    const source = files.find(file => file.name === applied.name);
    if (!source) { blockers.push(`applied_source_missing:${applied.name}`); continue; }
    if (source.checksum !== applied.checksum) {
      const supplied = input.legacyDriftEvidence?.find(item => item.name === applied.name);
      const evidence = supplied && supplied.ledgerChecksum === applied.checksum && supplied.sourceChecksum === source.checksum
        && supplied.baselineSourceChecksum === source.checksum && supplied.runningImageSourceChecksum === source.checksum
        && hash.test(supplied.evidenceSha256) ? {
          name: supplied.name, ledgerChecksum: supplied.ledgerChecksum, sourceChecksum: supplied.sourceChecksum,
          baselineSourceChecksum: supplied.baselineSourceChecksum, runningImageSourceChecksum: supplied.runningImageSourceChecksum,
          evidenceSha256: supplied.evidenceSha256,
        } : null;
      drift.push({ name: applied.name, ledgerChecksum: applied.checksum, sourceChecksum: source.checksum, evidence });
      blockers.push(`applied_checksum_drift:${applied.name}`);
      if (!evidence) blockers.push(`legacy_drift_evidence_missing:${applied.name}`);
    }
  }
  const pending: PendingMigration[] = files.filter(file => !names.has(file.name)).map(file => ({ name: file.name, checksum: file.checksum, risk: classifyMigration(file.sql) }));
  for (const file of pending) if (file.risk !== "additive") blockers.push(`pending_${file.risk}:${file.name}`);
  // A newly introduced filename before an already-applied migration changes execution history.
  const lastApplied = ledger.at(-1)?.name;
  for (const file of pending) if (lastApplied && file.name < lastApplied) blockers.push(`out_of_order_pending:${file.name}`);
  const body = {
    schemaVersion: 1 as const, targetSha: input.targetSha, baselineSha: input.baselineSha,
    baselineLedgerSha256: canonicalHash(ledger), sourceInventorySha256: canonicalHash(files.map(({ name, checksum }) => ({ name, checksum }))),
    pendingSha256: canonicalHash(pending.map(({ name, checksum }) => ({ name, checksum }))),
    ledger, pending, drift, blockers: [...new Set(blockers)].sort(),
    ready: blockers.length === 0, scope: "read-only-plan" as const,
    productionMigrationAuthorized: false as const,
  };
  return { ...body, planSha256: canonicalHash(body) };
}

/** The caller supplies an offline, frozen checkout. Verify source BEFORE importing
 * its actual migrator authority; module initialization does not connect to a DB.
 */
export async function generateMigrationPlan(checkout: string, input: MigrationPlanInput) {
  const root = realpathSync(resolve(checkout));
  const git = (...args: string[]) => execFileSync("git", ["-C", root, ...args], { encoding: "utf8" }).trim();
  if (!sha.test(input.targetSha) || git("rev-parse", "HEAD") !== input.targetSha) throw new Error("target checkout SHA mismatch");
  const migratorPath = "apps/api/src/infrastructure/db/migrator.ts";
  const migrationPath = "apps/api/migrations";
  if (git("status", "--porcelain", "--untracked-files=all", "--", migratorPath, migrationPath)) throw new Error("migration source is not frozen");
  const authority = await import(pathToFileURL(join(root, migratorPath)).href) as { migrationFiles: (dir: string) => string[] };
  if (typeof authority.migrationFiles !== "function") throw new Error("canonical migrationFiles authority missing");
  const dir = join(root, migrationPath);
  const files = authority.migrationFiles(dir).map(name => {
    const path = join(dir, name);
    if (!lstatSync(path).isFile() || realpathSync(path) !== path) throw new Error(`migration must be a regular tracked file: ${name}`);
    const sql = readFileSync(path, "utf8");
    // HEAD content is a second independent binding, including ignored files omitted by status.
    if (git("ls-files", "--error-unmatch", "--", `${migrationPath}/${name}`) !== `${migrationPath}/${name}`
      || migrationHash(execFileSync("git", ["-C", root, "show", `${input.targetSha}:${migrationPath}/${name}`])) !== migrationHash(sql)) throw new Error(`migration differs from target: ${name}`);
    return { name, checksum: migrationHash(sql), sql };
  });
  return compareMigrationInventory(input, files);
}

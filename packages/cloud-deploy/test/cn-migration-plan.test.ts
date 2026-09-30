import { describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { classifyMigration, compareMigrationInventory, generateMigrationPlan, migrationHash } from "../src/cn-migration-plan";
const sql = "CREATE TABLE IF NOT EXISTS fresh (id integer);";
const file = (name: string, text = sql) => ({ name, checksum: migrationHash(text), sql: text });
const input = { targetSha: "a".repeat(40), baselineSha: "b".repeat(40), ledger: [] as Array<{ name: string; checksum: string }> };

describe("CN read-only migration provenance", () => {
  it("binds every pending filename/checksum and baseline independently of ledger query order", () => {
    const files = [file("0001.sql"), file("0002.sql"), file("0003.sql")];
    const ledger = files.slice(0, 2).map(({ name, checksum }) => ({ name, checksum }));
    const result = compareMigrationInventory({ ...input, ledger }, files);
    expect(result.ready).toBe(true);
    expect(result.productionMigrationAuthorized).toBe(false);
    expect(result.pending.map(item => item.name)).toEqual(["0003.sql"]);
    expect(compareMigrationInventory({ ...input, ledger: [...ledger].reverse() }, files)).toEqual(result);
    expect(compareMigrationInventory({ ...input, ledger }, [...files, file("0004.sql")]).pendingSha256).not.toBe(result.pendingSha256);
    expect(compareMigrationInventory({ ...input, baselineSha: "c".repeat(40), ledger }, files).planSha256).not.toBe(result.planSha256);
  });
  it("rejects forged checksums, duplicate or missing applied source, and unsorted authority output", () => {
    expect(compareMigrationInventory(input, [{ ...file("0001.sql"), checksum: "c".repeat(64) }]).ready).toBe(false);
    expect(compareMigrationInventory({ ...input, ledger: [{ name: "missing.sql", checksum: "c".repeat(64) }] }, []).blockers).toContain("applied_source_missing:missing.sql");
    expect(compareMigrationInventory({ ...input, ledger: [{ name: "x.sql", checksum: "c".repeat(64) }, { name: "x.sql", checksum: "c".repeat(64) }] }, []).ready).toBe(false);
    expect(compareMigrationInventory(input, [file("0002.sql"), file("0001.sql")]).blockers).toContain("invalid_source_order:0001.sql");
    expect(compareMigrationInventory({ ...input, targetSha: "main" }, []).ready).toBe(false);
  });
  it("rejects insertion before applied history", () => {
    const applied = file("0002.sql");
    expect(compareMigrationInventory({ ...input, ledger: [applied] }, [file("0001.sql"), applied]).blockers).toContain("out_of_order_pending:0001.sql");
  });
  it("requires exact legacy evidence without allowing it to waive drift", () => {
    const source = file("F82.sql");
    const ledgerChecksum = "d".repeat(64);
    const args = { ...input, ledger: [{ name: source.name, checksum: ledgerChecksum }] };
    const absent = compareMigrationInventory(args, [source]);
    expect(absent.blockers).toContain("legacy_drift_evidence_missing:F82.sql");
    const evidence = { name: source.name, ledgerChecksum, sourceChecksum: source.checksum, baselineSourceChecksum: source.checksum, runningImageSourceChecksum: source.checksum, evidenceSha256: "e".repeat(64) };
    const result = compareMigrationInventory({ ...args, legacyDriftEvidence: [evidence] }, [source]);
    expect(result.drift[0]?.evidence).toEqual(evidence);
    expect(result.blockers).not.toContain("legacy_drift_evidence_missing:F82.sql");
    expect(result.ready).toBe(false);
    expect(compareMigrationInventory({ ...args, legacyDriftEvidence: [{ ...evidence, runningImageSourceChecksum: "f".repeat(64) }] }, [source]).drift[0]?.evidence).toBeNull();
  });
  it.each([
    ["DROP TABLE old;", "destructive"], ["ALTER TABLE old RENAME TO newer;", "destructive"],
    ["DELETE FROM agents;", "destructive"], ["ALTER TABLE x ADD COLUMN y integer;", "contract"],
    ["DO $$ BEGIN EXECUTE 'DROP TABLE x'; END $$;", "destructive"],
    ["DO $$ BEGIN PERFORM 1; END $$;", "unknown"], ["SELECT 1;", "unknown"],
    ["CREATE TABLE x AS SELECT * FROM y;", "unknown"], ["CREATE TABLE x (v text DEFAULT 'abc');", "unknown"],
    ["CREATE TABLE x (id integer) INHERITS (old);", "unknown"],
    ["CREATE TABLE x (id integer DEFAULT dangerous());", "unknown"],
    ["CREATE TABLE x (id integer REFERENCES old);", "unknown"],
    [sql, "additive"], ["-- DROP TABLE x\nCREATE INDEX idx ON fresh (id);", "additive"],
  ])("classifies SQL conservatively: %s", (text, expected) => {
    expect(classifyMigration(text)).toBe(expected);
    if (expected !== "additive") expect(compareMigrationInventory(input, [file("0001.sql", text)]).ready).toBe(false);
  });
  it("uses canonical migrationFiles including non-numbered SQL, and rejects dirty frozen checkout", async () => {
    const root = mkdtempSync(join(tmpdir(), "cn-plan-test-"));
    const git = (...args: string[]) => execFileSync("git", ["-C", root, ...args], { encoding: "utf8" }).trim();
    try {
      mkdirSync(join(root, "apps/api/src/infrastructure/db"), { recursive: true });
      mkdirSync(join(root, "apps/api/migrations"), { recursive: true });
      writeFileSync(join(root, "package.json"), '{"type":"module"}');
      writeFileSync(join(root, "apps/api/src/infrastructure/db/migrator.ts"), 'import { readdirSync } from "node:fs"; export const migrationFiles = (dir: string) => readdirSync(dir).filter(name => name.endsWith(".sql")).sort();');
      writeFileSync(join(root, "apps/api/migrations/F82.sql"), sql);
      writeFileSync(join(root, "apps/api/migrations/not-a-migration.txt"), "ignored");
      git("init", "--quiet"); git("add", ".");
      git("-c", "user.name=Migration Test", "-c", "user.email=migration-test@example.invalid", "-c", "core.hooksPath=/dev/null", "commit", "--quiet", "-m", "fixture");
      const targetSha = git("rev-parse", "HEAD");
      const plan = await generateMigrationPlan(root, { ...input, targetSha });
      expect(plan.pending.map(item => item.name)).toEqual(["F82.sql"]);
      await expect(generateMigrationPlan(root, input)).rejects.toThrow("SHA mismatch");
      writeFileSync(join(root, "apps/api/migrations/F82.sql"), "SELECT 1;");
      await expect(generateMigrationPlan(root, { ...input, targetSha })).rejects.toThrow("not frozen");
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});

/**
 * issue #465 — the mechanical half of `pg-recording-repository.ts`'s allowlist entry in
 * `scripts/lint-permission-paths.mjs`.
 *
 * The entry claims three things. A claim in a comment is not a constraint, and the allowlist
 * itself says so ("⚠ The exemption is valid ONLY while ... so it is not left as a claim"),
 * so each one is asserted here:
 *
 *   1. the file names ONLY the five recording tables — the moment it reaches `artifacts`,
 *      `segments`, `content_items` or anything else, it has become a general read surface and
 *      the exemption's argument (write path + the reads that gate the write) stops holding;
 *   2. it never calls `withoutTenant` — RLS is the floor under everything above, and a
 *      tenant-less query reads every organization's recordings while looking ordinary;
 *   3. nothing under `src/interface/` imports it — controllers reach it through
 *      `RECORDING_UNIT_OF_WORK`, so the day someone wires a route straight to the
 *      repository, this goes red and the decision has to be attached there.
 *
 * ⚠ If this file is deleted, the allowlist entry must go with it.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const API_DIR = fileURLToPath(new URL("../..", import.meta.url));
const REPO_FILE = join(API_DIR, "src/infrastructure/recording/pg-recording-repository.ts");

/** Exactly the tables the allowlist entry declares. */
const DECLARED = new Set([
  "recording_sessions",
  "recording_tracks",
  "recording_segments",
  "recording_consent_cells",
  "recording_operation_idempotency",
]);

/** Same keyword-anchored form `lint-permission-paths.mjs` uses, deliberately. */
const SQL_REF = /\b(?:FROM|JOIN|INTO|UPDATE)\s+(\w+)/gi;

function referencedTables(source: string): string[] {
  const found: string[] = [];
  for (const line of source.split("\n")) {
    if (/^\s*(\*|\/\/|\/\*)/.test(line)) continue;
    for (const m of line.matchAll(SQL_REF)) found.push(m[1]!.toLowerCase());
  }
  return found;
}

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith(".ts")) out.push(p);
  }
  return out;
}

describe("pg-recording-repository stays inside its allowlist argument", () => {
  const source = readFileSync(REPO_FILE, "utf8");

  it("names no table outside the five it declares", () => {
    const tables = referencedTables(source);
    // Positive control FIRST. An assertion that a set is a subset of another passes
    // vacuously when the parse found nothing, which is exactly how a scanner rots into a
    // green no-op after an unrelated formatting change.
    expect(tables.length).toBeGreaterThan(5);
    expect(new Set(tables).has("recording_sessions")).toBe(true);
    expect([...new Set(tables)].filter((t) => !DECLARED.has(t))).toEqual([]);
  });

  it("never escapes the tenant transaction", () => {
    // Comment lines are skipped for the same reason `lint-permission-paths.mjs` skips them:
    // the allowlist entry and this file's own header NAME `withoutTenant` in prose, and a
    // gate that fires on its own documentation is a gate that gets muted.
    const code = source.split("\n").filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l));
    expect(code.some((l) => l.includes("withoutTenant"))).toBe(false);
    // Positive control: the tenant-scoped call it DOES make is still there, so a rename
    // that deletes both cannot leave this assertion passing on an empty file.
    expect(code.some((l) => l.includes("withTenant"))).toBe(true);
  });

  it("is not reachable from the interface layer", () => {
    const importers = walk(join(API_DIR, "src/interface")).filter((f) =>
      readFileSync(f, "utf8").includes("infrastructure/recording/pg-recording-repository"),
    );
    expect(importers).toEqual([]);
  });
});

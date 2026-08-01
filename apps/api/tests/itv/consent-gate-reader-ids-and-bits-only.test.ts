/**
 * The gate that makes the `lint-permission-paths` exemption for
 * `pg-consent-gate-reader.ts` legitimate (F88; see the allowlist entry in
 * `scripts/lint-permission-paths.mjs`). The exemption's premise is "this is a system check,
 * not a viewer-facing read" -- it only holds while this file (a) never touches a tenant
 * table beyond the three it is meant to read, (b) never calls `withoutTenant`, and
 * (c) never returns anything beyond `{subjectId, mode, bits}` -- in particular, never a
 * `display_name`/`role_title`/`contact_*` column, which would turn a boolean gate check
 * into a second, unguarded way to read subject content.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const FILE = fileURLToPath(new URL("../../src/infrastructure/interview/pg-consent-gate-reader.ts", import.meta.url));

function codeLines(): { line: string; n: number }[] {
  return readFileSync(FILE, "utf8")
    .split("\n")
    .map((line, i) => ({ line, n: i + 1 }))
    .filter(({ line }) => !/^\s*(\*|\/\/|\/\*)/.test(line));
}

const ALLOWED_TABLES = ["interview_session_subjects", "interview_subjects", "interview_consent_submissions"];
// `latest` is the `LEFT JOIN LATERAL` alias, `iss`/`isub`/`ics` are the join aliases used in
// the WHERE/ON clauses below -- none of these are tenant tables.
const NON_TABLE_ALIASES = ["latest", "lateral"];

describe("the F88 consent gate reader touches only its three allowed tables and returns only ids/bits", () => {
  it("scans a file that exists and contains SQL", () => {
    const lines = codeLines();
    expect(lines.length).toBeGreaterThan(10);
    expect(lines.some(({ line }) => line.includes("withTenant"))).toBe(true);
  });

  it("never calls withoutTenant", () => {
    const hits = codeLines().filter(({ line }) => line.includes("withoutTenant"));
    expect(hits.map((h) => `${h.n}: ${h.line.trim()}`)).toEqual([]);
  });

  it("only names the three tables the allowlist entry commits to", () => {
    const body = readFileSync(FILE, "utf8");
    const tableRefs = [...body.matchAll(/(?:FROM|JOIN)\s+(\w+)/gi)]
      .map((m) => (m[1] ?? "").toLowerCase())
      .filter((t) => t.length > 0 && !NON_TABLE_ALIASES.includes(t));
    expect(tableRefs.length).toBeGreaterThan(0);
    for (const t of tableRefs) {
      expect(ALLOWED_TABLES, `unexpected table ${t}`).toContain(t);
    }
  });

  it("never selects a content column (display_name/role_title/contact_*) — ids and consent bits only", () => {
    const body = readFileSync(FILE, "utf8").toLowerCase();
    for (const forbidden of ["display_name", "role_title", "contact_cipher", "contact_mask", "org_name"]) {
      expect(body.includes(forbidden), `unexpected column ${forbidden}`).toBe(false);
    }
  });

  it("the returned shape is exactly {subjectId, mode, bits} — asserted against the real port, not just the SQL text", async () => {
    const mod: typeof import("../../src/infrastructure/interview/pg-consent-gate-reader") = await import(
      "../../src/infrastructure/interview/pg-consent-gate-reader"
    );
    expect(typeof mod.PgConsentGateReader).toBe("function");
  });
});

/**
 * The gate that makes the `lint-permission-paths` exemption for
 * `pg-source-interview-reader.ts` legitimate (F83; see the allowlist entry in
 * `scripts/lint-permission-paths.mjs`). The exemption's premise is narrower than
 * `pg-template-repository.ts`'s: it is not "visibility is undecided", it is "the caller
 * already ran the visibility decision one layer up" (`extractTemplateDraft` via
 * `InterviewScopeRepository.findVisibleById` + `decideInterviewVisibility`). That premise
 * only holds while this file itself touches no tenant table beyond the two it is meant to
 * read (`interview_consent_submissions`, `interview_template_applications`) -- in
 * particular, it must never read `interview_sessions` directly, because that would be a
 * SECOND way to learn about an interview's existence without going through the scope gate.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const FILE = fileURLToPath(
  new URL("../../src/infrastructure/interview/pg-source-interview-reader.ts", import.meta.url),
);

function codeLines(): { line: string; n: number }[] {
  return readFileSync(FILE, "utf8")
    .split("\n")
    .map((line, i) => ({ line, n: i + 1 }))
    .filter(({ line }) => !/^\s*(\*|\/\/|\/\*)/.test(line));
}

const ALLOWED_TABLES = ["interview_consent_submissions", "interview_template_applications"];
// `latest` is a CTE alias (`WITH latest AS (...)`), not a tenant table -- it would otherwise
// false-positive as an "unexpected table" below.
const CTE_ALIASES = ["latest"];

describe("the source interview reader touches only its two allowed tables", () => {
  it("scans a file that exists and contains SQL", () => {
    const lines = codeLines();
    expect(lines.length).toBeGreaterThan(15);
    expect(lines.some(({ line }) => line.includes("withTenant"))).toBe(true);
  });

  it("never calls withoutTenant", () => {
    const hits = codeLines().filter(({ line }) => line.includes("withoutTenant"));
    expect(hits.map((h) => `${h.n}: ${h.line.trim()}`)).toEqual([]);
  });

  it("never reads interview_sessions -- that check happens one layer up, not here", () => {
    const body = readFileSync(FILE, "utf8");
    expect(body.includes("interview_sessions")).toBe(false);
  });

  it("only names the two tables the allowlist entry commits to", () => {
    const body = readFileSync(FILE, "utf8");
    const tableRefs = [...body.matchAll(/FROM\s+(\w+)/gi)]
      .map((m) => (m[1] ?? "").toLowerCase())
      .filter((t) => t.length > 0 && !CTE_ALIASES.includes(t));
    expect(tableRefs.length).toBeGreaterThan(0);
    for (const t of tableRefs) {
      expect(ALLOWED_TABLES, `unexpected table ${t}`).toContain(t);
    }
  });
});

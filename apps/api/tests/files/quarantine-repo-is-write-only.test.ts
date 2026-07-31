/**
 * The gate that makes the `lint-permission-paths` exemption for
 * `pg-quarantine-repository.ts` legitimate (F35, uc-22-2 E2).
 *
 * Same shape as `tests/auth/registration-repo-is-write-only.test.ts`: the linter's
 * allowlist entry claims this file only ever INSERTs into `malware_quarantine_records`,
 * never reads it back for disclosure. That premise stops being true quietly the moment
 * someone adds a `SELECT` to it (to power a "compliance review" screen, say) and the
 * linter stays silent because the file is already allowlisted. So the premise is enforced
 * here rather than trusted.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const FILE = fileURLToPath(
  new URL("../../src/infrastructure/files/pg-quarantine-repository.ts", import.meta.url),
);

const TENANT_TABLES = ["malware_quarantine_records"];

/** Same anchoring as lint-permission-paths.mjs. */
const SQL_REF = /\b(FROM|JOIN|INTO|UPDATE)\s+(\w+)/gi;

function codeLines(): { line: string; n: number }[] {
  return readFileSync(FILE, "utf8")
    .split("\n")
    .map((line, i) => ({ line, n: i + 1 }))
    .filter(({ line }) => !/^\s*(\*|\/\/|\/\*)/.test(line));
}

describe("the quarantine repository is write-only against tenant tables", () => {
  it("scans a file that exists and contains SQL (otherwise this gate is decorative)", () => {
    const lines = codeLines();
    const refs = lines.flatMap(({ line }) => [...line.matchAll(SQL_REF)]);
    expect(refs.length, "found no SQL at all -- the assertions below would be vacuous").toBeGreaterThan(0);
  });

  it("every tenant-table reference is an INSERT INTO, and no other keyword reaches one", () => {
    const violations: string[] = [];
    const seen = new Set<string>();
    for (const { line, n } of codeLines()) {
      for (const m of line.matchAll(SQL_REF)) {
        const keyword = m[1]!.toUpperCase();
        const table = m[2]!.toLowerCase();
        if (!TENANT_TABLES.includes(table)) continue;
        seen.add(table);
        const isInsert = keyword === "INTO" && /\bINSERT\s+INTO\b/i.test(line);
        if (!isInsert) violations.push(`${n}: ${keyword} ${table} -- ${line.trim()}`);
      }
    }
    expect(
      violations,
      `the allowlist entry in lint-permission-paths.mjs claims this file is write-only. It is not:\n  ${violations.join("\n  ")}\n  Either guard the read, or remove the allowlist entry.`,
    ).toEqual([]);

    expect(
      [...seen].sort(),
      "this file no longer writes to the tenant table it is allowlisted for -- remove the allowlist entry",
    ).toEqual([...TENANT_TABLES].sort());
  });

  it("the allowlist entry is actually present, and names this file", () => {
    const lint = readFileSync(
      fileURLToPath(new URL("../../scripts/lint-permission-paths.mjs", import.meta.url)),
      "utf8",
    );
    expect(lint).toContain("src/infrastructure/files/pg-quarantine-repository.ts");
    expect(lint).toContain("quarantine-repo-is-write-only.test.ts");
  });
});

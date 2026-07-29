/**
 * The gate that makes the `lint-permission-paths` exemption legitimate.
 *
 * ## Why this file exists
 *
 * `pg-registration-repository.ts` writes to `organizations` and `org_memberships` without
 * going through `permission-filter`, so it is on that linter's ALLOWLIST -- which grew from
 * four entries to five for it, and `permission-propagation-six-paths.test.ts` deliberately
 * makes that growth something you have to come back and justify.
 *
 * The justification is: `Guarded<T>` protects DISCLOSURE, and a registration discloses
 * nothing -- the organization does not exist yet and the caller is an anonymous visitor
 * holding an invite code, so "may this person read the row they are creating" has no
 * answer.
 *
 * ⚠ That argument holds only while the file is WRITE-ONLY against tenant tables. Premises
 * like that stop being true quietly: someone adds a `SELECT name FROM organizations` to
 * return a nicer response, the linter stays silent because the file is allowlisted, and an
 * unguarded tenant read now exists in a file specifically exempted from the check for
 * unguarded tenant reads.
 *
 * So the premise is enforced here rather than trusted. The exemption carries its own gate.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const FILE = fileURLToPath(
  new URL("../../src/infrastructure/auth/pg-registration-repository.ts", import.meta.url),
);

/**
 * The tenant tables this file is allowed to touch, and only by inserting.
 *
 * Hardcoded rather than derived from the migrations on purpose: this is a statement about
 * ONE file's permitted surface, not a schema-wide classification. If the file starts naming
 * a tenant table that is not on this list, the `unexpected` assertion below fires.
 */
const TENANT_TABLES = ["organizations", "org_memberships"];

/** Statement keywords that reach a table. Same anchoring as lint-permission-paths.mjs. */
const SQL_REF = /\b(FROM|JOIN|INTO|UPDATE)\s+(\w+)/gi;

function codeLines(): { line: string; n: number }[] {
  return readFileSync(FILE, "utf8")
    .split("\n")
    .map((line, i) => ({ line, n: i + 1 }))
    // Comments naming a table are documentation of the rule, not a use of it -- the same
    // exemption the linter itself makes.
    .filter(({ line }) => !/^\s*(\*|\/\/|\/\*)/.test(line));
}

describe("the registration repository is write-only against tenant tables", () => {
  it("scans a file that exists and contains SQL (otherwise this gate is decorative)", () => {
    const lines = codeLines();
    expect(lines.length).toBeGreaterThan(50);
    const refs = lines.flatMap(({ line }) => [...line.matchAll(SQL_REF)]);
    expect(refs.length, "found no SQL at all -- the assertions below would be vacuous").toBeGreaterThan(3);
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
        // INTO is the only keyword that may reach one, and it must be an INSERT INTO --
        // `SELECT ... INTO` is a read wearing the same keyword.
        const isInsert = keyword === "INTO" && /\bINSERT\s+INTO\b/i.test(line);
        if (!isInsert) violations.push(`${n}: ${keyword} ${table} -- ${line.trim()}`);
      }
    }
    expect(
      violations,
      `the allowlist entry in lint-permission-paths.mjs claims this file is write-only. It is not:\n  ${violations.join("\n  ")}\n  Either guard the read, or remove the allowlist entry.`,
    ).toEqual([]);

    // Non-vacuity, the part that matters most: if the file stopped mentioning tenant tables
    // at all -- renamed, refactored, moved -- the loop above would find nothing and pass.
    // Then the allowlist entry would be exempting a file that no longer needs exempting,
    // and this gate would be guarding nothing.
    expect(
      [...seen].sort(),
      "this file no longer writes to the tenant tables it is allowlisted for -- remove the allowlist entry",
    ).toEqual([...TENANT_TABLES].sort());
  });

  it("counter-proof: the same check DOES catch a read", () => {
    // The scanner, run against the shape it exists to reject. Without this, a regex that
    // matched nothing would be indistinguishable from a clean file.
    const bad = `      const r = await s.query("SELECT name FROM organizations WHERE id = $1", [id]);`;
    const hits = [...bad.matchAll(SQL_REF)].filter(
      (m) => TENANT_TABLES.includes(m[2]!.toLowerCase()) && !/\bINSERT\s+INTO\b/i.test(bad),
    );
    expect(hits.length, "the scanner would not have caught a SELECT from a tenant table").toBe(1);

    // ...and does not fire on the legitimate shape.
    const good = `    await s.query("INSERT INTO organizations (id, name, kind) VALUES ($1,$2,'organization')", []);`;
    const falsePositives = [...good.matchAll(SQL_REF)].filter(
      (m) => TENANT_TABLES.includes(m[2]!.toLowerCase()) && !/\bINSERT\s+INTO\b/i.test(good),
    );
    expect(falsePositives.length).toBe(0);
  });

  it("the allowlist entry is actually present, and names this file", () => {
    // A gate for an exemption that was removed is dead weight; a gate whose exemption was
    // renamed is worse, because it keeps passing.
    const lint = readFileSync(
      fileURLToPath(new URL("../../scripts/lint-permission-paths.mjs", import.meta.url)),
      "utf8",
    );
    expect(lint).toContain("src/infrastructure/auth/pg-registration-repository.ts");
    // The reason must reference this test, so deleting the test is a visible lie in the
    // linter rather than a silent loss of coverage.
    expect(lint).toContain("registration-repo-is-write-only.test.ts");
  });
});

/**
 * The gate that makes the `lint-permission-paths` exemption for
 * `pg-template-repository.ts` legitimate (F82; see the allowlist entry in
 * `scripts/lint-permission-paths.mjs` and the raise in `permission-propagation-six-paths.test.ts`).
 *
 * ## Why this file exists
 *
 * The template's visibility range is `[待定 D-16]` in `contracts/interview/domain.md` --
 * still undecided. A `decideTemplateVisibility` written today would be inventing the rule
 * the design-signoff deferred, so the repository is allowlisted instead of guarded.
 *
 * That is only an honest position while the repository's actual reach stays bounded to
 * exactly what RLS already promises -- one organization's rows, nothing coarser (no
 * `withoutTenant` escape) and nothing looser (no query missing an `org_id` predicate that
 * would, on a policy bug elsewhere, silently widen past the tenant boundary). This file
 * enforces that boundary by parsing the source, the same way
 * `registration-repo-is-write-only.test.ts` enforces its own allowlist premise.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const FILE = fileURLToPath(
  new URL("../../src/infrastructure/interview/pg-template-repository.ts", import.meta.url),
);

function codeLines(): { line: string; n: number }[] {
  return readFileSync(FILE, "utf8")
    .split("\n")
    .map((line, i) => ({ line, n: i + 1 }))
    // A comment naming a table/keyword is documentation, not a use of it -- the same
    // exemption lint-permission-paths.mjs itself makes.
    .filter(({ line }) => !/^\s*(\*|\/\/|\/\*)/.test(line));
}

describe("the template repository stays scoped to RLS's own boundary", () => {
  it("scans a file that exists and contains SQL (otherwise this gate is decorative)", () => {
    const lines = codeLines();
    expect(lines.length).toBeGreaterThan(50);
    const withTenantCalls = lines.filter(({ line }) => line.includes("withTenant"));
    expect(withTenantCalls.length, "found no withTenant calls at all -- the assertions below would be vacuous").toBeGreaterThan(3);
  });

  it("never calls withoutTenant -- there is no cross-tenant escape hatch in this file", () => {
    const hits = codeLines().filter(({ line }) => line.includes("withoutTenant"));
    expect(
      hits.map((h) => `${h.n}: ${h.line.trim()}`),
      "withoutTenant bypasses RLS; the allowlist entry's premise is that this file stays bounded BY RLS, not that it can opt out of it",
    ).toEqual([]);
  });

  it("every SQL statement that touches a template/interview table is a parameterised, tenant-scoped call", () => {
    // Every method in this file is `(orgId, ...) => this.db.withTenant(orgId, async (s) => ...)`
    // -- so the enforceable, low-false-positive version of "every query is org-scoped" is:
    // every exported method signature takes `orgId: OrgId` as its first parameter, and every
    // one of its query bodies runs inside the `withTenant` callback (never `s.query` reached
    // from outside one). We check the second half structurally: count of `withTenant(` call
    // sites must equal count of interface methods that touch the database (create/update/
    // getHead/getVersion/list/usedCount/apply/getAppliedSnapshot) -- if a method starts
    // running SQL outside that wrapper, this count silently drops out of lockstep.
    const body = readFileSync(FILE, "utf8");
    const withTenantSites = [...body.matchAll(/this\.db\.withTenant\(/g)].length;
    const asyncMethods = [
      "create", "update", "getHead", "getVersion", "list", "usedCount", "apply", "getAppliedSnapshot",
    ];
    for (const name of asyncMethods) {
      const re = new RegExp(`async ${name}\\([^)]*\\)[^{]*\\{`);
      expect(re.test(body), `method ${name} not found with the expected async signature`).toBe(true);
    }
    expect(
      withTenantSites,
      "expected exactly one this.db.withTenant(...) wrapper per database-touching method",
    ).toBe(asyncMethods.length);
  });
});

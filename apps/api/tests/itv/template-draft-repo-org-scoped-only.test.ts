/**
 * The gate that makes the `lint-permission-paths` exemption for
 * `pg-template-draft-repository.ts` legitimate (F83; see the allowlist entry in
 * `scripts/lint-permission-paths.mjs`). Same shape as
 * `template-repo-org-scoped-only.test.ts` (F82) -- template visibility is `[待定 D-16]`,
 * and a draft is a not-yet-a-template of exactly that same undecided kind.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const FILE = fileURLToPath(
  new URL("../../src/infrastructure/interview/pg-template-draft-repository.ts", import.meta.url),
);

function codeLines(): { line: string; n: number }[] {
  return readFileSync(FILE, "utf8")
    .split("\n")
    .map((line, i) => ({ line, n: i + 1 }))
    .filter(({ line }) => !/^\s*(\*|\/\/|\/\*)/.test(line));
}

describe("the template draft repository stays scoped to RLS's own boundary", () => {
  it("scans a file that exists and contains SQL", () => {
    const lines = codeLines();
    expect(lines.length).toBeGreaterThan(20);
    const withTenantCalls = lines.filter(({ line }) => line.includes("withTenant"));
    expect(withTenantCalls.length).toBeGreaterThan(2);
  });

  it("never calls withoutTenant", () => {
    const hits = codeLines().filter(({ line }) => line.includes("withoutTenant"));
    expect(hits.map((h) => `${h.n}: ${h.line.trim()}`)).toEqual([]);
  });

  it("every method (save/get/markConfirmed) is org-scoped, exactly one withTenant per method", () => {
    const body = readFileSync(FILE, "utf8");
    const withTenantSites = [...body.matchAll(/this\.db\.withTenant\(/g)].length;
    const asyncMethods = ["save", "get", "markConfirmed"];
    for (const name of asyncMethods) {
      const re = new RegExp(`async ${name}\\([^)]*\\)[^{]*\\{`);
      expect(re.test(body), `method ${name} not found with the expected async signature`).toBe(true);
    }
    expect(withTenantSites).toBe(asyncMethods.length);
  });
});

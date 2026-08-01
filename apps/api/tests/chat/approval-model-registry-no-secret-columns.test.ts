/**
 * Keeps `scripts/lint-permission-paths.mjs`'s allowlist entry for
 * `pg-approval-model-registry.ts` honest (F112).
 *
 * That entry exempts the file from the `guard()`/`Guarded<T>` requirement ONLY because its
 * one query is limited to four non-sensitive `models` columns (`id, kind, display_name,
 * unit_price`) and never touches `model_secrets` (credential/endpoint ciphertext). This is a
 * static, source-level check -- the same style as `tests/capability/model/
 * admission-test-gate.test.ts` for the sibling exemption it is modelled on. If someone widens
 * the query to `SELECT *` or joins in `model_secrets`, this test goes red before any runtime
 * assertion would have a chance to.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

describe("pg-approval-model-registry.ts stays limited to non-secret model columns", () => {
  it("never names model_secrets or a credential/endpoint-shaped identifier", () => {
    const path = fileURLToPath(
      new URL("../../src/infrastructure/chat/pg-approval-model-registry.ts", import.meta.url),
    );
    const source = readFileSync(path, "utf-8");
    expect(source).not.toMatch(/model_secrets/);
    expect(source.toLowerCase()).not.toMatch(/credential|ciphertext|endpoint/);
  });

  it("its one SELECT reads exactly the four allowlisted columns, nothing more", () => {
    const path = fileURLToPath(
      new URL("../../src/infrastructure/chat/pg-approval-model-registry.ts", import.meta.url),
    );
    const source = readFileSync(path, "utf-8");
    const selectMatch = source.match(/SELECT\s+([\s\S]*?)\s+FROM\s+models/i);
    expect(selectMatch, "expected exactly one SELECT ... FROM models").not.toBeNull();
    const columns = selectMatch![1]!
      .split(",")
      .map((c) => c.trim())
      .filter((c) => c.length > 0);
    expect(new Set(columns)).toEqual(new Set(["id", "kind", "display_name", "unit_price"]));
  });
});

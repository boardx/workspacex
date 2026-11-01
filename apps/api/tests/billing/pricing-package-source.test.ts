import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { renderPersonalCreditPackages } from "../../scripts/generate-personal-credit-packages";

it("keeps the SQL seed mechanically generated from the server price catalog", () => {
  const sql = readFileSync(new URL("../../migrations/20261101220000_personal_credit_packages.sql", import.meta.url), "utf8");
  expect(sql).toBe(renderPersonalCreditPackages());
});

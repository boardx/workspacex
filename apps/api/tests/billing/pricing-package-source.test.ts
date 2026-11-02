import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { renderPersonalCreditPackages } from "../../scripts/generate-personal-credit-packages";
import { renderProductConfigurationSchema } from "../../scripts/generate-product-configuration-schema";

it("keeps the SQL seed mechanically generated from the server price catalog", () => {
  const sql = readFileSync(new URL("../../migrations/20261101220000_personal_credit_packages.sql", import.meta.url), "utf8");
  expect(sql).toBe(renderPersonalCreditPackages());
});

it("keeps the configuration forward migration generated from historical seed defaults", () => {
  const sql = readFileSync(new URL("../../migrations/20261102050000_product_configuration.sql", import.meta.url), "utf8");
  expect(sql).toBe(renderProductConfigurationSchema());
});

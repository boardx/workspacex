import { afterAll, beforeAll, expect, it } from "vitest";
import type { DatabasePort, TenantSession } from "../../src/application/ports/database.port";
import { CatalogProductConflict, CatalogProductMissing } from "../../src/application/billing/admin-product-catalog";
import { PgAdminProductCatalog } from "../../src/infrastructure/billing/pg-admin-product-catalog";
import { readProductConfiguration } from "../../src/infrastructure/billing/product-catalog-configuration";
import { PgDatabase } from "../../src/infrastructure/db/pg-database";
import { appConfig } from "../../src/infrastructure/db/pg-config";
import { asApp, asOwner, ensureDatabase, migrateOnce } from "../support/db";

const db = new PgDatabase(appConfig());
const writer: DatabasePort = {
  withTenant: db.withTenant.bind(db),
  close: async () => {},
  withoutTenant: <T>(run: (session: TenantSession) => Promise<T>) => asOwner(async client => {
    await client.query("BEGIN");
    try {
      await client.query("SET LOCAL ROLE app_billing_tariff_writer");
      const result = await run({ query: async (sql, params) => {
        const result = await client.query(sql, params ? [...params] : undefined);
        return { rows: result.rows };
      } });
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  }),
};

beforeAll(async () => { ensureDatabase(); await migrateOnce(); });
afterAll(async () => { await db.close(); });

it("edits market-specific prices with the dedicated writer and refreshes the checkout catalog", async () => {
  const catalog = new PgAdminProductCatalog(db, writer);
  const cn = await catalog.list("cn");
  const us = await catalog.list("us");
  const product = cn.items.find(item => item.sku === "pro-cn-month-v1");
  if (!product) throw new Error("Expected seeded CN subscription");
  const before = await db.withoutTenant(s => readProductConfiguration(s, "cn"));
  const update = {
    market: product.market, sku: product.sku, expectedRevision: product.revision,
    values: { ...product.values, amountMinor: product.values.amountMinor + 100 },
  };
  await expect(asApp(null, c => c.query("UPDATE credit_packages SET amount_fen=1 WHERE package_id=$1", [product.sku])))
    .rejects.toThrow();
  await expect(catalog.update("catalog-test-operator", { ...update, market: "us" })).rejects.toBeInstanceOf(CatalogProductMissing);
  const changed = await catalog.update("catalog-test-operator", update);
  try {
    await expect(catalog.update("catalog-test-operator", update)).rejects.toBeInstanceOf(CatalogProductConflict);
    const after = await db.withoutTenant(s => readProductConfiguration(s, "cn"));
    expect(after.version).not.toBe(before.version);
    expect(after.rows.find(row => row.package_id === product.sku)?.amount_fen).toBe(update.values.amountMinor);
    expect(await catalog.list("us")).toEqual(us);
    const audit = await asOwner(async c => (await c.query(
      "SELECT market, old_value, new_value FROM billing_product_catalog_changes WHERE actor_id=$1 AND sku=$2",
      ["catalog-test-operator", product.sku],
    )).rows);
    expect(audit).toContainEqual({ market: "cn", old_value: product, new_value: changed });
  } finally {
    await catalog.update("catalog-test-cleanup", { ...update, expectedRevision: changed.revision, values: product.values });
  }
});

import type { adminCatalogOperations } from "@repo/contracts/billing-pricing";
import type { z } from "zod";

export type UpdateCatalogProduct = z.infer<typeof adminCatalogOperations.update.in>;
export type CatalogMarket = z.infer<typeof adminCatalogOperations.list.in>["market"];

export abstract class AdminProductCatalog {
  abstract list(market: CatalogMarket): Promise<z.infer<typeof adminCatalogOperations.list.out>>;
  abstract update(actorId: string, input: UpdateCatalogProduct): Promise<z.infer<typeof adminCatalogOperations.update.out>>;
}

export class CatalogProductMissing extends Error {}
export class CatalogProductConflict extends Error {}
export class CatalogProductInvalid extends Error {}
export class CatalogWriterUnavailable extends Error {}

import "reflect-metadata";
import { afterEach, describe, expect, it } from "vitest";
import { NestFactory, APP_GUARD } from "@nestjs/core";
import type { INestApplication } from "@nestjs/common";
import { PricingCatalog } from "@repo/contracts/billing-pricing";
import type { BillingProvider } from "@repo/contracts/billing-credits";
import { BillingCatalogService, type BillingCatalogConfig } from "../../src/application/billing/billing-catalog-service";
import { BillingCatalogController } from "../../src/interface/controllers/billing-catalog.controller";
import { DeploymentBillingConfig } from "../../src/infrastructure/billing/deployment-billing-config";
import { PrincipalGuard } from "../../src/interface/guards/principal.guard";
import { PRINCIPAL_RESOLVER_PORT } from "../../src/application/ports/principal-resolver.port";
import { toOrgId } from "../../src/domain/org-id";

import {PERSONAL_PRICE_CATALOG,PERSONAL_PRICE_CATALOG_VERSION} from "../../src/domain/billing/personal-price-catalog";
const seedReader={read:async(_principal:unknown,market:"cn"|"us")=>({version:PERSONAL_PRICE_CATALOG_VERSION,products:PERSONAL_PRICE_CATALOG[market].map(product=>({...product}))})};
const principal = { userId: "catalog-user", orgId: toOrgId("catalog-org") };
function config(market: "cn" | "us" | null, providers: BillingProvider[] = []) {
  return { getPricingMarket: () => market, getPublicConfig: () => ({ enabledProviders: [...providers] }) };
}
let app: INestApplication | undefined;
afterEach(async () => { if (app) { await app.close(); app = undefined; } });
async function startCatalogApp(cfg: BillingCatalogConfig): Promise<string> {
  app = await NestFactory.create({ module: class CatalogFixture {}, controllers: [BillingCatalogController], providers: [
      { provide: BillingCatalogService, useValue: new BillingCatalogService(cfg,seedReader) },
      { provide: PRINCIPAL_RESOLVER_PORT, useValue: { resolve: async (headers: Record<string, string | undefined>) => headers.authorization === "Bearer catalog-fixture" ? principal : null } },
      { provide: APP_GUARD, useClass: PrincipalGuard },
    ] }, { logger: false });
    await app.listen(0, "127.0.0.1");
  return app.getUrl();
}

describe("server-owned personal pricing catalog", () => {
  it.each([
    ["cn", "CNY", [19900, 199000, 12900, 59900, 219900]],
    ["us", "USD", [2900, 29000, 1900, 8900, 32900]],
  ] as const)("serves exact %s minor-unit prices and credit quantities", async (market, currency, amounts) => {
    const result = PricingCatalog.parse(await new BillingCatalogService(config(market),seedReader).catalog(principal));
    expect(result.market).toBe(market);
    expect(result.products.map(product => product.amountMinor)).toEqual(amounts);
    expect(result.products.every(product => product.currency === currency)).toBe(true);
    expect(result.products.map(product => product.kind === "subscription" ? product.monthlyCredits : product.credits)).toEqual([20000, 20000, 10000, 50000, 200000]);
    expect(result.products.filter(product => product.kind === "subscription").map(product => product.cycle)).toEqual(["month", "year"]);
    expect(new Set(result.products.map(product => product.sku)).size).toBe(5);
  });
  it("uses the deployment snapshot and never silently defaults an unknown market", async () => {
    for (const [deployment, market] of [["cn", "cn"], ["us", "us"], ["devapp", "cn"], ["bad", null], ["", null]] as const) {
      expect(new DeploymentBillingConfig({ BILLING_DEPLOYMENT: deployment }).getPricingMarket()).toBe(market);
    }
    await expect(new BillingCatalogService(config(null),seedReader).catalog(principal)).rejects.toThrow();
  });
  it("disables purchase without hiding prices and does not expose mutable catalog state", async () => {
    const service = new BillingCatalogService(config("us", []),seedReader);
    const first = await service.catalog(principal);
    expect(first.enabledProviders).toEqual([]);
    expect(first.products).toHaveLength(5);
    first.products[0]!.amountMinor = 1;
    expect((await service.catalog(principal)).products[0]!.amountMinor).toBe(2900);
    expect((await new BillingCatalogService(config("cn", ["wechat", "stripe"]),seedReader).catalog(principal)).enabledProviders).toEqual(["wechat", "stripe"]);
  });
  it("returns 503 for an unconfigured deployment instead of inventing a market", async () => {
    const base = await startCatalogApp(config(null));
    const response = await fetch(`${base}/billing/catalog`, { headers: { authorization: "Bearer catalog-fixture" } });
    expect(response.status).toBe(503);
  });
  it("serves real HTTP through the existing PrincipalGuard and rejects client market/price input", async () => {
    const base = await startCatalogApp(config("us", ["stripe"]));
    expect((await fetch(`${base}/billing/catalog`)).status).toBe(401);
    const response = await fetch(`${base}/billing/catalog`, { headers: { authorization: "Bearer catalog-fixture" } });
    expect(response.status).toBe(200);
    const result = PricingCatalog.parse(await response.json());
    expect(result.market).toBe("us");
    expect(result.products[0]!.amountMinor).toBe(2900);
    expect((await fetch(`${base}/billing/catalog?market=cn&amountMinor=1`, { headers: { authorization: "Bearer catalog-fixture" } })).status).toBe(400);
  });
});

// Configuration is authoritative; defaults are not a runtime price directory.
it("reads subscription money and monthly credits from the injected configured catalog",async()=>{
 const reader={read:async()=>({version:"configured-v2",products:[{sku:"pro-us-year-v1",kind:"subscription" as const,currency:"USD" as const,amountMinor:31234,cycle:"year" as const,monthlyCredits:23500}]})};
 const result=await new BillingCatalogService(config("us",["stripe"]),reader).catalog(principal);
 expect(result.version).toBe("configured-v2");
 expect(result.products).toEqual([{sku:"pro-us-year-v1",kind:"subscription",currency:"USD",amountMinor:31234,cycle:"year",monthlyCredits:23500}]);
});
it("reads each configuration version afresh without changing a previously returned snapshot",async()=>{
 let amountMinor=31234,version="configured-v2";
 const reader={read:async()=>({version,products:[{sku:"credit-us-10000-v1",kind:"credit_topup" as const,currency:"USD" as const,amountMinor,credits:12345}]})};
 const service=new BillingCatalogService(config("us",["stripe"]),reader);
 const original=await service.catalog(principal);amountMinor=29900;version="configured-v3";
 const current=await service.catalog(principal);
 expect(original.version).toBe("configured-v2");expect(original.products[0]!.amountMinor).toBe(31234);
 expect(current.version).toBe("configured-v3");expect(current.products[0]!.amountMinor).toBe(29900);
});

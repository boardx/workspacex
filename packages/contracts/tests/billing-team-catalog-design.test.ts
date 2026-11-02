import {expect,it} from "vitest";
import {TeamCatalog} from "../src/billing-team";
import {PricingCatalog} from "../src/billing-pricing";
const month={sku:"team-cn-month-v1",kind:"subscription",currency:"CNY",amountMinor:99900,cycle:"month",includedSeats:5,monthlyCredits:100000,additionalSeatAmountMinor:14900,additionalSeatMonthlyCredits:15000};
const catalog={orgId:"org-a",version:"pricing-v1",market:"cn",enabledProviders:["wechat","stripe"],products:[month,{...month,sku:"team-cn-year-v1",cycle:"year",amountMinor:999000,additionalSeatAmountMinor:149000},{sku:"credit-cn-10000-v1",kind:"credit_topup",currency:"CNY",amountMinor:12900,credits:10000}]};
it("keeps base capacity, monthly pool and additional seat pricing on one subscription product",()=>{
 expect(TeamCatalog.parse(catalog)).toEqual(catalog);
 expect(TeamCatalog.safeParse({...catalog,enabledProviders:[],products:[]}).success).toBe(true);
});
it("shares permanent top-up product semantics with the adopted personal catalog",()=>{
 const personal={version:catalog.version,market:catalog.market,enabledProviders:catalog.enabledProviders,products:[catalog.products[2]]};
 expect(PricingCatalog.parse(personal).products[0]).toEqual(TeamCatalog.parse(catalog).products[2]);
});
it.each([
 {includedSeats:4},{monthlyCredits:1200000},{additionalSeatMonthlyCredits:20000},
 {amountMinor:0},{additionalSeatAmountMinor:0},{additionalSeatAmountMinor:0.5},
 {kind:"enterprise"},{contractId:"contract-1"},{ownerId:"org-b"},
])("rejects incompatible or injected product facts %j",patch=>{
 expect(TeamCatalog.safeParse({...catalog,products:[{...month,...patch}]}).success).toBe(false);
});
it("enforces market currency, unique SKUs/providers and organization scope",()=>{
 for(const patch of [{orgId:""},{market:"us"},{products:[month,month]},{enabledProviders:["wechat","wechat"]},{plan:"enterprise"}])
  expect(TeamCatalog.safeParse({...catalog,...patch}).success).toBe(false);
});
it("supports USD Stripe and dev CNY Stripe while rejecting WeChat USD",()=>{
 const usd={...catalog,market:"us",enabledProviders:["stripe"],products:[{...month,currency:"USD",amountMinor:14900,additionalSeatAmountMinor:2500}]};
 expect(TeamCatalog.parse(usd)).toEqual(usd);
 expect(TeamCatalog.safeParse({...usd,enabledProviders:["wechat"]}).success).toBe(false);
});
it("retains the existing personal catalog shape and validation",()=>{
 const personal={version:"pricing-v1",market:"cn",enabledProviders:["wechat"],products:[{sku:"pro-cn-month-v1",kind:"subscription",currency:"CNY",amountMinor:19900,cycle:"month",monthlyCredits:20000}]};
 expect(PricingCatalog.parse(personal)).toEqual(personal);
 expect(PricingCatalog.safeParse({...personal,orgId:"org-a"}).success).toBe(false);
 expect(PricingCatalog.safeParse({...personal,products:[{...personal.products[0],monthlyCredits:100000}]}).success).toBe(false);
 for(const patch of [{market:"us"},{products:[personal.products[0],personal.products[0]]},{enabledProviders:["wechat","wechat"]}])
  expect(PricingCatalog.safeParse({...personal,...patch}).success).toBe(false);
});

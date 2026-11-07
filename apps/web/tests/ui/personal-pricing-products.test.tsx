import * as React from "react";
import {afterEach,expect,it,vi} from "vitest";
import {cleanup,fireEvent,render,screen} from "@testing-library/react";
import {PersonalPricingProducts} from "@/components/billing/personal-pricing-products";
import type {PricingCatalog,PricingSubscriptionInfo} from "@repo/contracts/billing-pricing";
const catalog:PricingCatalog={version:"pricing-test",market:"cn",enabledProviders:["wechat","stripe"],products:[
 {sku:"month-quote",kind:"subscription",cycle:"month",currency:"CNY",amountMinor:19900,monthlyCredits:20000},
 {sku:"year-quote",kind:"subscription",cycle:"year",currency:"CNY",amountMinor:199000,monthlyCredits:20000},
 {sku:"pack-quote",kind:"credit_topup",currency:"CNY",amountMinor:12900,credits:10000},
]};
const free:PricingSubscriptionInfo={status:"none",planRef:null,plan:null,currentPeriodEnd:null,billingCycle:null,renewalMode:null,cancelAtPeriodEnd:false,welcomeCreditGrant:{status:"none",grant:null}};
afterEach(cleanup);
it("selects the actual annual SKU and differentiates Wechat manual and Stripe automatic renewal",()=>{
 const select=vi.fn();render(<PersonalPricingProducts kind="plans" catalog={catalog} entitlement={free} onSelect={select} onClose={()=>{}}/>);
 fireEvent.click(screen.getByTestId("pricing-cycle-year"));expect(screen.getByTestId("pricing-total").textContent).toContain("1,990.00");
 expect(screen.getByTestId("pricing-renewal-note").textContent).toContain("到期后手动续费");
 fireEvent.click(screen.getByTestId("pricing-provider-stripe"));expect(screen.getByTestId("pricing-renewal-note").textContent).toContain("自动续费");
 fireEvent.click(screen.getByTestId("pricing-continue-checkout"));expect(select).toHaveBeenCalledTimes(1);expect(select).toHaveBeenCalledWith("year-quote","stripe");
});
it("blocks a second Pro purchase while the original purchase or financial review is unresolved",()=>{
 render(<PersonalPricingProducts kind="plans" catalog={catalog} entitlement={{...free,checkoutPending:true}} onSelect={()=>{}} onClose={()=>{}}/>);
 expect(screen.getByTestId("pricing-continue-checkout").hasAttribute("disabled")).toBe(true);expect(screen.getByText(/原订阅付款/)).toBeTruthy();
});
it("never offers Wechat for USD and labels credit packs as one-time purchases",()=>{
 const us:PricingCatalog={...catalog,market:"us",products:[{sku:"usd-pack",kind:"credit_topup",currency:"USD",amountMinor:1900,credits:10000}]},select=vi.fn();
 render(<PersonalPricingProducts kind="credits" catalog={us} entitlement={free} onSelect={select} onClose={()=>{}}/>);
 expect(screen.queryByTestId("pricing-provider-wechat")).toBeNull();expect(screen.getByTestId("pricing-renewal-note").textContent).toContain("不自动续费");
 fireEvent.click(screen.getByTestId("pricing-continue-checkout"));expect(select).toHaveBeenCalledTimes(1);expect(select).toHaveBeenCalledWith("usd-pack","stripe");
});
it("keeps quoting visible but prevents checkout when new sales are disabled",()=>{
 render(<PersonalPricingProducts kind="credits" catalog={{...catalog,enabledProviders:[]}} entitlement={free} onSelect={()=>{}} onClose={()=>{}}/>);
 expect(screen.getByTestId("pricing-total").textContent).toContain("129.00");expect(screen.getByTestId("pricing-continue-checkout").hasAttribute("disabled")).toBe(true);
});

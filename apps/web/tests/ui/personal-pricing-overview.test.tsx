import * as React from "react";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { PersonalPricingOverview } from "@/components/billing/personal-pricing-overview";
const catalog={version:"pricing-test",market:"us",enabledProviders:["stripe"],products:[{sku:"pro-us-year",kind:"subscription",cycle:"year",currency:"USD",amountMinor:29000,monthlyCredits:20000},{sku:"credits-us",kind:"credit_topup",currency:"USD",amountMinor:1900,credits:10000}]};
const wallet={ownerType:"user",ownerId:"payer",balance:8600,permanentBalance:8600,totalPurchased:10000,totalGranted:0,updatedAt:"2026-11-01T00:00:00Z"};
const entitlement={status:"none",planRef:null,plan:null,currentPeriodEnd:null,billingCycle:null,renewalMode:null,cancelAtPeriodEnd:false,creditGrant:{status:"none",grant:null},welcomeCreditGrant:{status:"none",grant:null}};
function setup(walletReply:unknown=wallet,entitlementReply:unknown=entitlement,portal="https://billing.stripe.com/p/session/fixture"){
 const request=vi.fn(async (input:string,init:RequestInit)=>{
  expect(init.headers).toMatchObject({Authorization:"Bearer session"});const path=new URL(input).pathname;
  if(path==="/billing/catalog")return new Response(JSON.stringify(catalog));
  if(path==="/billing/subscription/entitlement")return new Response(JSON.stringify(entitlementReply));
  if(path==="/billing/subscription/history")return new Response(JSON.stringify({items:[],hasMore:false}));
  if(path==="/billing/subscription/management-link")return new Response(JSON.stringify({url:portal}));
  if(path==="/billing/wallet")return new Response(JSON.stringify({wallet:walletReply}));
  throw Error("unexpected_endpoint");
 });vi.stubGlobal("fetch",request);return request;
}
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
it("reads the new authenticated catalog and entitlement without calling retired subscription info",async()=>{
 const requests=setup(),purchase=vi.fn();render(<PersonalPricingOverview userId="payer" sessionToken="session" onPurchase={purchase}/>);
 expect((await screen.findByTestId("pricing-wallet-balance")).textContent).toContain("8,600");await screen.findByText("尚无订阅");
 fireEvent.click(screen.getByTestId("pricing-buy-credits"));expect(purchase).toHaveBeenCalledWith("credits",catalog,expect.objectContaining({plan:null}));
 expect(requests.mock.calls.some(([url])=>new URL(url).pathname==="/billing/subscription")).toBe(false);
});
it("does not display a foreign wallet while keeping the valid subscription card visible",async()=>{
 setup({...wallet,ownerId:"someone-else"});render(<PersonalPricingOverview userId="payer" sessionToken="session" onPurchase={()=>{}}/>);
 await screen.findByTestId("pricing-wallet-error");expect(screen.queryByTestId("pricing-wallet-balance")).toBeNull();await screen.findByText("尚无订阅");
});
it("does not infer permanent credits from an older wallet payload",async()=>{
 const {permanentBalance:_missing,...old}=wallet;setup(old);render(<PersonalPricingOverview userId="payer" sessionToken="session" onPurchase={()=>{}}/>);
 await screen.findByTestId("pricing-wallet-error");expect(screen.queryByTestId("pricing-wallet-balance")).toBeNull();
});

it("rejects an unsafe management destination without navigating",async()=>{
 const paid={...entitlement,status:"active",plan:"pro",planRef:"pro-us-year",billingCycle:"year",renewalMode:"automatic",paymentProvider:"stripe",currentPeriodEnd:"2077-11-01T00:00:00Z"};
 setup(wallet,paid,"https://untrusted.example/p/session/foreign");const navigate=vi.fn();
 render(<PersonalPricingOverview userId="payer" sessionToken="session" onPurchase={()=>{}} navigate={navigate}/>);
 fireEvent.click(await screen.findByTestId("pricing-manage-subscription"));await screen.findByText(/暂时无法打开订阅管理/);expect(navigate).not.toHaveBeenCalled();
});
it("removes old account data immediately when the authenticated scope changes",async()=>{
 setup();const view=render(<PersonalPricingOverview userId="payer" sessionToken="session" onPurchase={()=>{}}/>);
 await screen.findByTestId("pricing-wallet-balance");view.rerender(<PersonalPricingOverview userId="other-payer" sessionToken="new-session" onPurchase={()=>{}}/>);
 expect(screen.queryByTestId("pricing-wallet-balance")).toBeNull();expect(screen.queryByText("尚无订阅")).toBeNull();
});

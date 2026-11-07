import * as React from "react";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { PersonalPricingAccount } from "@/components/billing/personal-pricing-account";
import type { PricingCatalog, PricingSubscriptionInfo } from "@repo/contracts/billing-pricing";
const catalog: PricingCatalog = {version:"pricing-test",market:"cn",enabledProviders:["wechat","stripe"],products:[
 {sku:"pro-year",kind:"subscription",cycle:"year",currency:"CNY",amountMinor:199000,monthlyCredits:20000},
 {sku:"pack-10k",kind:"credit_topup",currency:"CNY",amountMinor:12900,credits:10000},
]};
const wallet = {ownerType:"user" as const,ownerId:"payer",balance:8600,permanentBalance:8600,totalPurchased:10000,totalGranted:0,updatedAt:"2026-11-01T00:00:00Z"};
const free: PricingSubscriptionInfo = {status:"none",planRef:null,plan:null,currentPeriodEnd:null,billingCycle:null,renewalMode:null,cancelAtPeriodEnd:false,creditGrant:{status:"none",grant:null},welcomeCreditGrant:{status:"none",grant:null}};
afterEach(()=>{cleanup();vi.useRealTimers();});
it("does not invent a welcome gift for an account without a grant",()=>{
 render(<PersonalPricingAccount wallet={wallet} entitlement={free} catalog={catalog} onPurchase={()=>{}} onManage={()=>{}} />);
 expect(screen.getByTestId("pricing-wallet-balance").textContent).toContain("8,600");
 expect(screen.queryByText(/1,000/)).toBeNull(); expect(screen.getByText("尚无订阅")).toBeTruthy();
});
it("shows actual welcome credit and the recorded expiry, without claiming a paid subscription",()=>{
 const entitlement:PricingSubscriptionInfo={...free,welcomeCreditGrant:{status:"granted",grant:{credits:1000,remainingCredits:640,grantedAt:"2026-11-01T00:00:00Z",expiresAt:"2026-12-01T00:00:00Z"}}};
 render(<PersonalPricingAccount wallet={wallet} entitlement={entitlement} catalog={catalog} onPurchase={()=>{}} onManage={()=>{}} />);
 expect(screen.getByTestId("pricing-quota").textContent).toContain("640");expect(screen.getByTestId("pricing-quota").textContent).toContain("1,000");
 expect(screen.getByTestId("pricing-quota-expiry").textContent).toContain("2026/12/1");expect(screen.queryByTestId("pricing-payment-expiry")).toBeNull();
});
it("separates annual payment expiry, monthly quota and actual Stripe renewal in a CNY deployment",()=>{
 vi.useFakeTimers();vi.setSystemTime(new Date("2026-11-15T00:00:00Z"));
 const entitlement:PricingSubscriptionInfo={...free,status:"active",plan:"pro",planRef:"pro-year",billingCycle:"year",renewalMode:"automatic",paymentProvider:"stripe",currentPeriodEnd:"2027-11-01T00:00:00Z",creditGrant:{status:"granted",grant:{credits:20000,remainingCredits:14600,periodStart:"2026-11-01T00:00:00Z",periodEnd:"2026-12-01T00:00:00Z"}}};
 const purchase=vi.fn(),manage=vi.fn();render(<PersonalPricingAccount wallet={wallet} entitlement={entitlement} catalog={catalog} onPurchase={purchase} onManage={manage} />);
 expect(screen.getByTestId("pricing-quota").textContent).toContain("14,600");
 expect(screen.getByTestId("pricing-quota-expiry").textContent).toContain("2026/12/1");expect(screen.getByTestId("pricing-payment-expiry").textContent).toContain("2027/11/1");
 expect(screen.getByTestId("pricing-renewal-note").textContent).toContain("Stripe 自动续费");
 expect(screen.getByTestId("pricing-renewal-note").textContent).not.toContain("微信");
 fireEvent.click(screen.getByTestId("pricing-manage-subscription"));expect(manage).toHaveBeenCalledOnce();
 fireEvent.click(screen.getByTestId("pricing-buy-credits"));expect(purchase).toHaveBeenCalledWith("credits");
});
it("shows canceled renewal with preserved paid rights and a personal debt warning",()=>{
 vi.useFakeTimers();vi.setSystemTime(new Date("2026-11-15T00:00:00Z"));
 const entitlement:PricingSubscriptionInfo={...free,status:"active",plan:"pro",planRef:"pro-year",billingCycle:"year",renewalMode:"automatic",paymentProvider:"stripe",cancelAtPeriodEnd:true,currentPeriodEnd:"2027-11-01T00:00:00Z"};
 render(<PersonalPricingAccount wallet={{...wallet,balance:-25,permanentBalance:-25}} entitlement={entitlement} catalog={catalog} onPurchase={()=>{}} onManage={()=>{}} />);
 expect(screen.getByTestId("pricing-renewal-note").textContent).toContain("已取消下一期自动续费");expect(screen.getByText(/25.*已开始的请求/)).toBeTruthy();
 expect(screen.getByTestId("pricing-plan-badge").textContent).toContain("使用中");
});

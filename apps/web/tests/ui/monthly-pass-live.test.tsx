import * as React from "react";
import {afterEach,expect,it,vi} from "vitest";
import {act,cleanup,fireEvent,render,screen,waitFor} from "@testing-library/react";
import {BillingOverview} from "@/components/billing/billing-overview";
import {navigateToStripe} from "@/components/billing/stripe-navigation";
vi.mock("@/components/billing/stripe-navigation",()=>({navigateToStripe:vi.fn()}));
const none={status:"none",planRef:null,currentPeriodEnd:null,cancelAtPeriodEnd:false};
function setup(initial:Record<string,unknown>=none){
 let current=initial;const fetcher=vi.fn(async(input:string,options?:RequestInit)=>{
  const path=new URL(input).pathname;
  return new Response(JSON.stringify(path.endsWith("/config")?{enabledProviders:["stripe","wechat"]}:path.endsWith("/wallet")?{wallet:{ownerType:"user",ownerId:"u",balance:100,totalPurchased:100,totalGranted:0,updatedAt:"2026-10-30"}}:path.endsWith("-link")?{url:"https://checkout.stripe.com/c/pay/monthly"}:current));
 });vi.stubGlobal("fetch",fetcher);return {fetcher,set:(value:Record<string,unknown>)=>{current=value;}};
}
afterEach(()=>{cleanup();vi.unstubAllGlobals();vi.clearAllMocks();window.history.replaceState({},"","/billing");vi.useRealTimers();});
it("shows one clear price and sends one POST even on repeated purchase clicks",async()=>{
 const f=setup();render(<BillingOverview userId="u" sessionToken="s"/>);
 const buy=await screen.findByRole("button",{name:"购买月度套餐"});expect(screen.getByText("¥180")).toBeTruthy();
 expect(screen.queryByText("支付渠道")).toBeNull();fireEvent.click(buy);fireEvent.click(buy);
 await waitFor(()=>expect(navigateToStripe).toHaveBeenCalledTimes(1));
 const calls=f.fetcher.mock.calls.filter(([url])=>url.includes("upgrade-link"));expect(calls).toHaveLength(1);expect(calls[0]![1]?.method).toBe("POST");
});
it("shows manual expiry and remaining credit without cancellation controls",async()=>{
 setup({status:"active",planRef:"monthly_pass_v1",purchaseMode:"manual_monthly",currentPeriodEnd:"2026-11-30T00:00:00Z",cancelAtPeriodEnd:true,creditGrant:{status:"granted",grant:{credits:20000,remainingCredits:16000,periodStart:"2026-10-30T00:00:00Z",periodEnd:"2026-11-30T00:00:00Z"}}});
 render(<BillingOverview userId="u" sessionToken="s"/>);await screen.findByText("16,000 / 20,000 credit");
 expect(screen.queryByRole("button",{name:"管理订阅"})).toBeNull();expect(screen.queryByRole("button",{name:"购买月度套餐"})).toBeNull();
 expect(screen.getByText(/到期手动续费/)).toBeTruthy();
});
it("resumes a server-persisted pending order after reload and offers one refresh action",async()=>{
 setup({...none,purchaseMode:"manual_monthly",checkoutPending:true});render(<BillingOverview userId="u" sessionToken="s"/>);
 fireEvent.click(await screen.findByRole("button",{name:"继续付款"}));await waitFor(()=>expect(navigateToStripe).toHaveBeenCalledTimes(1));
 expect(screen.queryAllByText(/正在确认付款/)).toHaveLength(1);
});
it("keeps confirmed account details visible during refresh and refreshes wallet after grant",async()=>{
 const f=setup({...none,purchaseMode:"manual_monthly",checkoutPending:true});render(<BillingOverview userId="u" sessionToken="s"/>);
 await screen.findByRole("button",{name:"继续付款"});f.set({...none,status:"active",purchaseMode:"manual_monthly",checkoutPending:false,currentPeriodEnd:"2026-11-30T00:00:00Z",creditGrant:{status:"granted",grant:{credits:20000,remainingCredits:20000,periodStart:"2026-10-30T00:00:00Z",periodEnd:"2026-11-30T00:00:00Z"}}});
 fireEvent.click(screen.getByRole("button",{name:"刷新状态"}));await screen.findByText("20,000 / 20,000 credit");
 await waitFor(()=>expect(f.fetcher.mock.calls.filter(([url])=>url.includes("/wallet")).length).toBeGreaterThan(1));
});
it("offers manual renewal after expiry",async()=>{
 setup({...none,status:"canceled",purchaseMode:"manual_monthly",currentPeriodEnd:"2026-09-30T00:00:00Z"});render(<BillingOverview userId="u" sessionToken="s"/>);await screen.findByRole("button",{name:"续费 ¥180"});
});

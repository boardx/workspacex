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
 render(<BillingOverview userId="u" sessionToken="s"/>);expect((await screen.findByRole("progressbar",{name:"本期剩余 credit"})).getAttribute("aria-valuenow")).toBe("80");
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
 fireEvent.click(screen.getByRole("button",{name:"刷新状态"}));expect((await screen.findByRole("progressbar",{name:"本期剩余 credit"})).getAttribute("aria-valuenow")).toBe("100");
 await waitFor(()=>expect(f.fetcher.mock.calls.filter(([url])=>url.includes("/wallet")).length).toBeGreaterThan(1));
});
it("offers manual renewal after expiry",async()=>{
 setup({...none,status:"canceled",purchaseMode:"manual_monthly",currentPeriodEnd:"2026-09-30T00:00:00Z"});render(<BillingOverview userId="u" sessionToken="s"/>);await screen.findByRole("button",{name:"续费 ¥180"});
});
it("re-arms a full month expiry timer beyond the browser timer limit",async()=>{
 vi.useFakeTimers();vi.setSystemTime(new Date("2026-10-30T00:00:00Z"));
 const f=setup({status:"active",planRef:"monthly_pass_v1",purchaseMode:"manual_monthly",currentPeriodEnd:"2026-11-30T00:00:00Z",cancelAtPeriodEnd:true});
 const view=render(<BillingOverview userId="u" sessionToken="s"/>);await act(async()=>{await vi.advanceTimersByTimeAsync(0);});
 await act(async()=>{await vi.advanceTimersByTimeAsync(25*86400000);});expect(f.fetcher.mock.calls.filter(([url])=>url.endsWith("/billing/subscription"))).toHaveLength(1);
 f.set({...none,status:"canceled",purchaseMode:"manual_monthly",currentPeriodEnd:"2026-11-30T00:00:00Z"});
 await act(async()=>{await vi.advanceTimersByTimeAsync(6*86400000+200);});expect(screen.getByRole("button",{name:"续费 ¥180"})).toBeTruthy();view.unmount();
});
it("blocks another purchase when a paid order needs financial reconciliation",async()=>{
 setup({...none,status:"incomplete",purchaseMode:"manual_monthly",paymentReviewRequired:true});render(<BillingOverview userId="u" sessionToken="s"/>);
 await screen.findByText(/付款需要人工核对/);expect(screen.queryByRole("button",{name:"购买月度套餐"})).toBeNull();expect(screen.queryByRole("button",{name:"继续付款"})).toBeNull();
});
it("labels a retained balance as stale if the post-payment wallet refresh fails",async()=>{
 let grant=false,failWallet=false;const fetcher=vi.fn(async(input:string)=>{
  const path=new URL(input).pathname;
  if(path.endsWith("/config"))return new Response(JSON.stringify({enabledProviders:["stripe"]}));
  if(path.endsWith("/wallet"))return failWallet?new Response("{}",{status:503}):new Response(JSON.stringify({wallet:{ownerType:"user",ownerId:"u",balance:100,totalPurchased:100,totalGranted:0,updatedAt:"2026-10-30"}}));
  return new Response(JSON.stringify(grant?{status:"active",planRef:"monthly_pass_v1",purchaseMode:"manual_monthly",currentPeriodEnd:"2026-11-30T00:00:00Z",cancelAtPeriodEnd:true,creditGrant:{status:"granted",grant:{credits:20000,remainingCredits:20000,periodStart:"2026-10-30T00:00:00Z",periodEnd:"2026-11-30T00:00:00Z"}}}:none));
 });vi.stubGlobal("fetch",fetcher);render(<BillingOverview userId="u" sessionToken="s"/>);await screen.findByRole("button",{name:"购买月度套餐"});grant=true;failWallet=true;
 fireEvent.click(screen.getByRole("button",{name:"刷新状态"}));await screen.findByTestId("err-billing-wallet");
 expect(screen.getByTestId("billing-wallet-balance").textContent).toContain("100");expect(screen.getByText(/显示上次查询结果/)).toBeTruthy();
 failWallet=false;fireEvent.click(screen.getByRole("button",{name:"重试额度查询"}));await waitFor(()=>expect(screen.queryByTestId("err-billing-wallet")).toBeNull());
});

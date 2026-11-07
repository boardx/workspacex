import * as React from "react";
import {afterEach,expect,it,vi} from "vitest";
import {act,cleanup,fireEvent,render,screen,waitFor} from "@testing-library/react";
import {BillingOverview} from "@/components/billing/billing-overview";
import {navigateToStripe} from "@/components/billing/stripe-navigation";
vi.mock("@/components/billing/stripe-navigation",()=>({navigateToStripe:vi.fn()}));
const info=(status:string)=>({status,planRef:null,currentPeriodEnd:null,cancelAtPeriodEnd:false});
function setup(status="none",configured=true,link="https://checkout.stripe.com/c/pay/test"){
 const fetcher=vi.fn(async(url:string,_options?:RequestInit)=>{
  const path=new URL(url).pathname;return new Response(JSON.stringify(path.endsWith("/config")?{enabledProviders:configured?["stripe"]:[]}:path.endsWith("/wallet")?{wallet:{ownerType:"user",ownerId:"u",balance:1,totalPurchased:1,totalGranted:0,updatedAt:"2026-10-10"}}:path.endsWith("-link")?{url:link}:info(status)));
 });vi.stubGlobal("fetch",fetcher);return fetcher;
}
const mount=()=>render(<BillingOverview userId="u" sessionToken="s"/>);
afterEach(()=>{cleanup();vi.unstubAllGlobals();vi.clearAllMocks();sessionStorage.clear();window.history.replaceState({},"","/billing");vi.useRealTimers();});
it.each(["active","trialing","past_due","unpaid","incomplete","paused"])("preserves legacy %s management without offering a new sale",async status=>{
 const f=setup(status,false,"https://billing.stripe.com/p/session/test");mount();fireEvent.click(await screen.findByRole("button",{name:"管理订阅"}));
 await waitFor(()=>expect(navigateToStripe).toHaveBeenCalledWith("https://billing.stripe.com/p/session/test"));
 expect(f.mock.calls.some(([url])=>url.includes("upgrade-link"))).toBe(false);
});
it("hides new purchase when Stripe is disabled",async()=>{setup("none",false);mount();await screen.findByTestId("billing-subscription-status");expect(screen.queryByRole("button",{name:"购买月度套餐"})).toBeNull();});
it.each(["https://evil.test/pay","https://checkout.stripe.com.evil.test/pay"])("rejects untrusted checkout %s",async url=>{
 setup("none",true,url);mount();fireEvent.click(await screen.findByRole("button",{name:"购买月度套餐"}));await screen.findByRole("alert");expect(navigateToStripe).not.toHaveBeenCalled();
});
it("bounds return polling and never creates a checkout just from a query parameter",async()=>{
 window.history.replaceState({},"","/billing?subscription_return=1");vi.useFakeTimers();const f=setup();const view=mount();
 await act(async()=>{await vi.advanceTimersByTimeAsync(0);});
 for(let n=0;n<6;n++)await act(async()=>{await vi.advanceTimersByTimeAsync(3000);});
 expect(f.mock.calls.filter(([url])=>new URL(url).pathname==="/billing/subscription")).toHaveLength(7);
 await act(async()=>{await vi.advanceTimersByTimeAsync(60000);});expect(f.mock.calls.filter(([url])=>new URL(url).pathname==="/billing/subscription")).toHaveLength(7);
 expect(f.mock.calls.some(([url])=>url.includes("upgrade-link"))).toBe(false);view.unmount();
});
it("refreshes after a legacy Portal return to show delayed cancellation",async()=>{
 window.history.replaceState({},"","/billing?subscription_management_return=1");vi.useFakeTimers();const f=setup("active");const original=f.getMockImplementation()!;let reads=0;
 f.mockImplementation((url,opts)=>new URL(url).pathname==="/billing/subscription"?Promise.resolve(new Response(JSON.stringify({...info("active"),cancelAtPeriodEnd:++reads>1}))):original(url,opts));
 const view=mount();await act(async()=>{await vi.advanceTimersByTimeAsync(0);});await act(async()=>{await vi.advanceTimersByTimeAsync(3000);});expect(screen.getByText(/原订阅已停止续费/)).toBeTruthy();view.unmount();
});
it("aborts an in-flight purchase on unmount and cannot navigate the next account",async()=>{
 let finish:((v:Response)=>void)|undefined;const f=setup(),original=f.getMockImplementation()!;
 f.mockImplementation((url,opts)=>url.includes("upgrade-link")?new Promise<Response>(r=>{finish=r;}):original(url,opts));
 const view=mount();fireEvent.click(await screen.findByRole("button",{name:"购买月度套餐"}));view.unmount();
 await act(async()=>{finish?.(new Response(JSON.stringify({url:"https://checkout.stripe.com/c/pay/old"})));});expect(navigateToStripe).not.toHaveBeenCalled();
});
it("stops timers on unmount",async()=>{
 window.history.replaceState({},"","/billing?subscription_return=1");vi.useFakeTimers();const f=setup(),view=mount();await act(async()=>{await vi.advanceTimersByTimeAsync(0);});view.unmount();await act(async()=>{await vi.advanceTimersByTimeAsync(60000);});
 expect(f.mock.calls.filter(([url])=>new URL(url).pathname==="/billing/subscription")).toHaveLength(1);
});
it("a failed refresh preserves the last snapshot but hides financial actions until retry",async()=>{
 const f=setup("active"),original=f.getMockImplementation()!;let failed=false;
 f.mockImplementation((url,opts)=>failed&&new URL(url).pathname==="/billing/subscription"?Promise.resolve(new Response("{}",{status:503})):original(url,opts));mount();await screen.findByRole("button",{name:"管理订阅"});failed=true;
 fireEvent.click(screen.getByRole("button",{name:"刷新状态"}));await screen.findByTestId("err-billing-subscription");expect(screen.queryByRole("button",{name:"管理订阅"})).toBeNull();expect(screen.queryByRole("button",{name:"购买月度套餐"})).toBeNull();
 failed=false;fireEvent.click(screen.getByRole("button",{name:"刷新状态"}));await screen.findByRole("button",{name:"管理订阅"});
});
it("shows a single error when the subscription cannot be read",async()=>{
 const f=setup(),original=f.getMockImplementation()!;f.mockImplementation((url,opts)=>new URL(url).pathname==="/billing/subscription"?Promise.resolve(new Response("{}",{status:503})):original(url,opts));mount();await screen.findByTestId("err-billing-subscription");expect(screen.queryByRole("button",{name:"购买月度套餐"})).toBeNull();
});
it("posts WeChat monthly provider and renders server QR without navigation",async()=>{
 const f=setup("none",true,"weixin://wxpay/bizpayurl?pr=monthly-real");const original=f.getMockImplementation()!;
 f.mockImplementation((url,opts)=>new URL(url).pathname.endsWith("/config")?Promise.resolve(new Response(JSON.stringify({enabledProviders:["wechat","stripe"]}))):original(url,opts));
 mount();await screen.findByRole("button",{name:"购买月度套餐"});fireEvent.click(screen.getByLabelText("微信支付"));fireEvent.click(screen.getByRole("button",{name:"购买月度套餐"}));
 expect(await screen.findByRole("img",{name:"月度套餐微信支付二维码"})).toBeTruthy();
 const call=f.mock.calls.find(([url])=>url.includes("upgrade-link"))!;expect(JSON.parse(String(call[1]?.body))).toEqual({provider:"wechat"});expect(navigateToStripe).not.toHaveBeenCalled();
});
it("locks monthly pending continuation to original provider",async()=>{
 const f=setup();const original=f.getMockImplementation()!;
 f.mockImplementation((url,opts)=>new URL(url).pathname.endsWith("/config")?Promise.resolve(new Response(JSON.stringify({enabledProviders:["wechat","stripe"]}))):new URL(url).pathname==="/billing/subscription"?Promise.resolve(new Response(JSON.stringify({...info("none"),checkoutPending:true,paymentProvider:"stripe"}))):original(url,opts));
 mount();await screen.findByRole("button",{name:"继续付款"});expect((screen.getByLabelText("Stripe") as HTMLInputElement).checked).toBe(true);expect((screen.getByLabelText("微信支付") as HTMLInputElement).disabled).toBe(true);
 fireEvent.click(screen.getByRole("button",{name:"继续付款"}));await waitFor(()=>expect(navigateToStripe).toHaveBeenCalled());
 expect(JSON.parse(String(f.mock.calls.find(([url])=>url.includes("upgrade-link"))![1]?.body))).toEqual({provider:"stripe"});
});

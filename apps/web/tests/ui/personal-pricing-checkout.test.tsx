import * as React from "react";
import QRCode from "qrcode";
import {afterEach,expect,it,vi} from "vitest";
import {cleanup,fireEvent,render,screen,waitFor} from "@testing-library/react";
import {PersonalPricingCheckout} from "@/components/billing/personal-pricing-checkout";
import {loadPersonalCheckout,beginPersonalCheckout,bindPersonalCheckout} from "@/components/billing/personal-checkout-state";
import type {PricingCatalog,PricingSubscriptionInfo} from "@repo/contracts/billing-pricing";
vi.mock("qrcode",()=>({default:{toCanvas:vi.fn(async()=>{})}}));
const userId="payer",ref="bg20261102000000abcdef";
const catalog:PricingCatalog={version:"pricing-test",market:"cn",enabledProviders:["wechat"],products:[{sku:"pack",kind:"credit_topup",currency:"CNY",amountMinor:12900,credits:10000}]};
const entitlement:PricingSubscriptionInfo={status:"none",planRef:null,plan:null,currentPeriodEnd:null,billingCycle:null,renewalMode:null,cancelAtPeriodEnd:false,welcomeCreditGrant:{status:"none",grant:null}};
const result={purchaseRef:ref,url:"weixin://wxpay/bizpayurl?pr=fixture",expiresAt:"2077-11-02T00:00:00Z",provider:"wechat",renewalMode:"manual"};
const order={orderNo:ref,ownerType:"user",ownerId:userId,provider:"wechat",status:"PENDING",packageId:"pack",amountFen:12900,currency:"CNY",baseCredits:10000,bonusCredits:0,qrCodeUrl:result.url,createdAt:"2026-11-02T00:00:00Z",expiredAt:result.expiresAt,paidAt:null,notifyAt:null,closedAt:null,lastErrorCode:null};
const reply=(value:unknown)=>new Response(JSON.stringify(value));
function mount(onPaid=vi.fn()){return render(<PersonalPricingCheckout kind="credits" userId={userId} sessionToken="session" catalog={catalog} entitlement={entitlement} onClose={()=>{}} onPaid={onPaid}/>);}
afterEach(()=>{cleanup();localStorage.clear();vi.unstubAllGlobals();vi.mocked(QRCode.toCanvas).mockReset().mockResolvedValue(undefined);});
it("saves the original request before posting and only shows success after the owned server outcome",async()=>{
 let paid=false,posts=0;const onPaid=vi.fn();vi.stubGlobal("fetch",vi.fn(async(input:string,init:RequestInit)=>{
  expect(init.headers).toMatchObject({Authorization:"Bearer session"});const path=new URL(input).pathname;
  if(path==="/billing/checkout"){posts++;expect(loadPersonalCheckout(localStorage,userId)?.request).toEqual(JSON.parse(String(init.body)));return reply(result);}
  if(path===`/billing/orders/${ref}`)return reply({order:{...order,status:paid?"SUCCESS":"PENDING",paidAt:paid?"2026-11-02T00:01:00Z":null}});
  throw Error("unexpected_endpoint");
 }));mount(onPaid);fireEvent.click(await screen.findByTestId("pricing-continue-checkout"));
 await screen.findByTestId("pricing-checkout-qr");expect(onPaid).not.toHaveBeenCalled();expect(posts).toBe(1);
 paid=true;fireEvent.click(screen.getByTestId("pricing-refresh-payment"));await screen.findByTestId("pricing-checkout-success");
 expect(onPaid).toHaveBeenCalledTimes(1);expect(loadPersonalCheckout(localStorage,userId)).toBeNull();expect(screen.queryByTestId("pricing-checkout-qr")).toBeNull();
});
it("retries an ambiguous POST only on user action and reuses its original idempotency key",async()=>{
 const bodies:unknown[]=[];vi.stubGlobal("fetch",vi.fn(async(input:string,init:RequestInit)=>{
  if(new URL(input).pathname==="/billing/checkout"){bodies.push(JSON.parse(String(init.body)));if(bodies.length===1)throw Error("network_unknown");return reply(result);}return reply({order});
 }));mount();fireEvent.click(await screen.findByTestId("pricing-continue-checkout"));await screen.findByTestId("pricing-resume-payment");
 expect(bodies).toHaveLength(1);fireEvent.click(screen.getByTestId("pricing-resume-payment"));await screen.findByTestId("pricing-checkout-qr");expect(bodies).toHaveLength(2);expect(bodies[1]).toEqual(bodies[0]);
});
it("restores a paid order and never redisplays its old payment address or creates another payment",async()=>{
 const request={sku:"pack",catalogVersion:catalog.version,provider:"wechat" as const,idempotencyKey:"original-request-key-123"};beginPersonalCheckout(localStorage,userId,request);bindPersonalCheckout(localStorage,userId,request.idempotencyKey,result);
 const requests=vi.fn(async(input:string)=>{expect(new URL(input).pathname).toBe(`/billing/orders/${ref}`);return reply({order:{...order,status:"SUCCESS",paidAt:"2026-11-02T00:01:00Z"}});});vi.stubGlobal("fetch",requests);mount();
 expect(screen.queryByTestId("pricing-checkout-qr")).toBeNull();await screen.findByTestId("pricing-checkout-success");expect(requests).toHaveBeenCalledTimes(1);
});
it("does not render another payer's payment link or claim a successful payment",async()=>{
 vi.stubGlobal("fetch",vi.fn(async(input:string)=>new URL(input).pathname==="/billing/checkout"?reply(result):reply({order:{...order,ownerId:"foreign-payer",status:"SUCCESS",paidAt:"2026-11-02T00:01:00Z"}})));const paid=vi.fn();mount(paid);fireEvent.click(await screen.findByTestId("pricing-continue-checkout"));
 await screen.findByTestId("pricing-payment-read-error");expect(paid).not.toHaveBeenCalled();expect(screen.queryByTestId("pricing-checkout-qr")).toBeNull();expect(loadPersonalCheckout(localStorage,userId)).not.toBeNull();
});
it("retains a manually reviewed payment without showing success or another payable checkout",async()=>{
 vi.stubGlobal("fetch",vi.fn(async(input:string)=>new URL(input).pathname==="/billing/checkout"?reply(result):reply({order:{...order,status:"FAILED"}})));
 const paid=vi.fn();mount(paid);fireEvent.click(await screen.findByTestId("pricing-continue-checkout"));await screen.findByText(/付款需要人工核实/);
 expect(paid).not.toHaveBeenCalled();expect(screen.queryByTestId("pricing-checkout-qr")).toBeNull();expect(screen.queryByTestId("pricing-continue-checkout")).toBeNull();expect(loadPersonalCheckout(localStorage,userId)).not.toBeNull();
});
it("only releases the original local purchase after confirmed closure and explicit reselection",async()=>{
 let posts=0;vi.stubGlobal("fetch",vi.fn(async(input:string)=>{if(new URL(input).pathname==="/billing/checkout"){posts++;return reply(result);}return reply({order:{...order,status:"CLOSED",closedAt:"2026-11-02T00:01:00Z"}});}));
 mount();fireEvent.click(await screen.findByTestId("pricing-continue-checkout"));await screen.findByText("订单已确认关闭。");expect(loadPersonalCheckout(localStorage,userId)).not.toBeNull();
 fireEvent.click(screen.getByRole("button",{name:"重新选择套餐"}));await screen.findByTestId("pricing-continue-checkout");expect(loadPersonalCheckout(localStorage,userId)).toBeNull();expect(posts).toBe(1);
});
it("hides an expired payment address without inventing a closed order or allowing another purchase",async()=>{
 const expiresAt=new Date(Date.now()-1000).toISOString(),expiredResult={...result,expiresAt};
 vi.stubGlobal("fetch",vi.fn(async(input:string)=>new URL(input).pathname==="/billing/checkout"?reply(expiredResult):reply({order:{...order,expiredAt:expiresAt}})));
 mount();fireEvent.click(await screen.findByTestId("pricing-continue-checkout"));await screen.findByText(/付款时间已过/);
 expect(screen.queryByTestId("pricing-checkout-qr")).toBeNull();expect(screen.queryByText("订单已确认关闭。")).toBeNull();expect(loadPersonalCheckout(localStorage,userId)).not.toBeNull();
});
it("keeps the original key when the page closes during an unresolved creation response",async()=>{
 let finish:((response:Response)=>void)|undefined;const paid=vi.fn();vi.stubGlobal("fetch",vi.fn(()=>new Promise<Response>(resolve=>{finish=resolve;})));
 const view=mount(paid);fireEvent.click(await screen.findByTestId("pricing-continue-checkout"));await waitFor(()=>expect(finish).toBeTypeOf("function"));
 const original=loadPersonalCheckout(localStorage,userId);view.unmount();finish!(reply(result));await Promise.resolve();
 expect(loadPersonalCheckout(localStorage,userId)?.request).toEqual(original?.request);expect(loadPersonalCheckout(localStorage,userId)?.result).toBeNull();expect(paid).not.toHaveBeenCalled();
});

it("redraws a failed QR after refreshing the same pending order without creating a second payment",async()=>{
 vi.mocked(QRCode.toCanvas).mockRejectedValueOnce(Error("canvas_unavailable")).mockResolvedValue(undefined);
 let posts=0;vi.stubGlobal("fetch",vi.fn(async(input:string)=>{if(new URL(input).pathname==="/billing/checkout"){posts++;return reply(result);}return reply({order});}));
 mount();fireEvent.click(await screen.findByTestId("pricing-continue-checkout"));await screen.findByText(/二维码暂时无法显示/);
 fireEvent.click(screen.getByTestId("pricing-refresh-payment"));
 await waitFor(()=>expect(QRCode.toCanvas).toHaveBeenCalledTimes(2));expect(await screen.findByTestId("pricing-checkout-qr")).toBeVisible();
 expect(screen.queryByText(/二维码暂时无法显示/)).toBeNull();expect(posts).toBe(1);
});
it.each(["SUCCESS","FAILED","CLOSED"])("reads %s after a checkout reference with no original payment binding",async status=>{
 let posts=0;const paid=vi.fn();vi.stubGlobal("fetch",vi.fn(async(input:string)=>{if(new URL(input).pathname==="/billing/checkout"){posts++;return reply({...result,url:null,expiresAt:null});}return reply({order:{...order,status,qrCodeUrl:null,expiredAt:null,paidAt:status==="SUCCESS"?"2026-11-02T00:01:00Z":null}});}));
 mount(paid);fireEvent.click(await screen.findByTestId("pricing-continue-checkout"));
 if(status==="SUCCESS"){await screen.findByTestId("pricing-checkout-success");expect(paid).toHaveBeenCalledTimes(1);expect(loadPersonalCheckout(localStorage,userId)).toBeNull();}
 else{await screen.findByText(status==="FAILED"?/付款需要人工核实/:"订单已确认关闭。");expect(paid).not.toHaveBeenCalled();expect(loadPersonalCheckout(localStorage,userId)?.result).toMatchObject({purchaseRef:ref,url:null,expiresAt:null});}
 expect(screen.queryByTestId("pricing-checkout-qr")).toBeNull();expect(screen.queryByTestId("pricing-resume-payment")).toBeNull();expect(posts).toBe(1);expect(QRCode.toCanvas).not.toHaveBeenCalled();
});
it("never treats a missing checkout address as payment proof when the authoritative read fails",async()=>{
 let posts=0;const paid=vi.fn();vi.stubGlobal("fetch",vi.fn(async(input:string)=>{if(new URL(input).pathname==="/billing/checkout"){posts++;return reply({...result,url:null,expiresAt:null});}return new Response("{}",{status:503});}));
 mount(paid);fireEvent.click(await screen.findByTestId("pricing-continue-checkout"));await screen.findByTestId("pricing-payment-read-error");
 expect(paid).not.toHaveBeenCalled();expect(screen.queryByTestId("pricing-checkout-success")).toBeNull();expect(screen.queryByTestId("pricing-checkout-qr")).toBeNull();expect(posts).toBe(1);expect(loadPersonalCheckout(localStorage,userId)).not.toBeNull();
});
it.each([false,true])("never redirects a newly returned paid Stripe checkout, missing binding: %s",async absent=>{
 const usdCatalog:PricingCatalog={...catalog,market:"us",enabledProviders:["stripe"],products:[{sku:"pack",kind:"credit_topup",currency:"USD",amountMinor:1900,credits:10000}]};
 const stripe={...result,provider:"stripe",url:"https://checkout.stripe.com/c/pay/fixture"},paid=vi.fn(),navigate=vi.fn();let reads=0,posts=0;
 vi.stubGlobal("fetch",vi.fn(async(input:string)=>{if(new URL(input).pathname==="/billing/checkout"){posts++;return reply({...stripe,...(absent?{url:null,expiresAt:null}:{})});}reads++;return reply({order:{...order,provider:"stripe",currency:"USD",amountFen:1900,status:"SUCCESS",qrCodeUrl:stripe.url,paidAt:"2026-11-02T00:01:00Z"}});}));
 render(<PersonalPricingCheckout kind="credits" userId={userId} sessionToken="session" catalog={usdCatalog} entitlement={entitlement} onClose={()=>{}} onPaid={paid} navigate={navigate}/>);
 fireEvent.click(await screen.findByTestId("pricing-continue-checkout"));await screen.findByTestId("pricing-checkout-success");
 expect(paid).toHaveBeenCalledTimes(1);expect(navigate).not.toHaveBeenCalled();expect(screen.queryByText("前往 Stripe 付款")).toBeNull();expect(reads).toBe(1);expect(posts).toBe(1);
});

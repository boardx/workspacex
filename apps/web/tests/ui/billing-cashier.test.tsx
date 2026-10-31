import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { BillingOverview } from "@/components/billing/billing-overview";
const wallet={ownerType:"user",ownerId:"user-a",balance:100,totalPurchased:100,totalGranted:0,updatedAt:"2026-10-16T00:00:00Z"};
const pack={packageId:"p1",ownerType:"user",region:"cn",currency:"CNY",amountFen:9900,displayAmount:"¥99.00",baseCredits:100,bonusCredits:20,bonusRate:0.2,totalCredits:120};
function setup(items:unknown[]=[pack]){
 vi.stubGlobal("fetch",vi.fn(async(url:string)=>{
  const path=new URL(url).pathname;
  const body=path.endsWith("/config")?{enabledProviders:["wechat"]}:path.endsWith("/wallet")?{wallet}:path.endsWith("/packages")?{items}:path.endsWith("/transactions")?{items:[],nextCursor:null}:{status:"none",planRef:null,currentPeriodEnd:null,cancelAtPeriodEnd:false};
  return new Response(JSON.stringify(body));
 }));
 render(<BillingOverview userId="user-a" sessionToken="cashier-test-session"/>);
}
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
describe("F06 live cashier entry",()=>{
 it("opens real package selection from configured account",async()=>{
  setup();fireEvent.click(await screen.findByRole("button",{name:"充值 credit"}));
  expect(await screen.findByTestId("billing-cashier-dialog")).toBeTruthy();
  expect(await screen.findByText("¥99.00")).toBeTruthy();
  expect(screen.queryByTestId("billing-qr-code-area")).toBeNull();
 });
 it("does not invent packages for an empty catalog",async()=>{
  setup([]);fireEvent.click(await screen.findByRole("button",{name:"充值 credit"}));
  expect(await screen.findByTestId("billing-packages-empty")).toBeTruthy();
  expect(screen.queryByTestId("billing-generate-qr")).toBeNull();
 });
});

import { act } from "@testing-library/react";
import { LiveCashierDialog } from "@/components/billing/live-cashier-dialog";
import QRCode from "qrcode";
vi.mock("qrcode",()=>({default:{toCanvas:vi.fn().mockResolvedValue(undefined)}}));
const order={orderNo:"bg20261016000000abcdef",ownerType:"user",ownerId:"user-a",provider:"wechat",status:"PENDING",packageId:"p1",amountFen:9900,baseCredits:100,bonusCredits:20,currency:"CNY",qrCodeUrl:"weixin://wxpay/bizpayurl?pr=real-server-intent",createdAt:"2026-10-16T00:00:00Z",paidAt:null,notifyAt:null,expiredAt:new Date(Date.now()+900000).toISOString(),closedAt:null,lastErrorCode:null};
function reply(body:unknown,status=200){return Promise.resolve(new Response(JSON.stringify(body),{status}));}
function live(options:{post?:()=>Promise<Response>;get?:()=>Promise<Response>;wallet?:()=>Promise<Response>;ledger?:()=>Promise<Response>;items?:unknown[];providers?:("wechat"|"stripe")[]}={}){
 const fetcher=vi.fn((url:string,init:RequestInit)=>{
  const path=new URL(url).pathname;
  if(path.endsWith("/config"))return reply({enabledProviders:options.providers??["wechat"]});
  if(path.endsWith("/packages"))return reply({items:options.items??[pack]});
  if(path.endsWith("/wallet"))return options.wallet?.()??reply({wallet});
  if(path.endsWith("/transactions"))return options.ledger?.()??reply({items:[],nextCursor:null});
  if(init.method==="POST")return options.post?.()??reply({order});
  return options.get?.()??reply({order});
 });vi.stubGlobal("fetch",fetcher);
 const credited=vi.fn();
 const props={owner:{ownerType:"user" as const,ownerId:"user-a"},sessionToken:"cashier-test-session",open:true,onOpenChange:vi.fn(),onCredited:credited};
 const view=render(<LiveCashierDialog {...props}/>);
 return {fetcher,credited,props,view};
}
async function generate(){fireEvent.click(await screen.findByRole("radio"));fireEvent.click(screen.getByTestId("billing-generate-qr"));}
afterEach(()=>{vi.useRealTimers();vi.mocked(QRCode.toCanvas).mockReset().mockResolvedValue(undefined);});
describe("F06 real cashier financial lifecycle",()=>{
 it("posts only server package identity once during a deferred request",async()=>{
  let finish!:(response:Response)=>void;
  const f=live({post:()=>new Promise(resolve=>{finish=resolve;})});await generate();
  fireEvent.click(screen.getByTestId("billing-generate-qr"));
  const posts=()=>f.fetcher.mock.calls.filter(([,init])=>init.method==="POST");
  expect(posts()).toHaveLength(1);
  expect(JSON.parse(String(posts()[0]![1].body))).toEqual({ownerType:"user",packageId:"p1",provider:"wechat"});
  await act(async()=>{finish(await reply({order}));});
  expect(await screen.findByTestId("billing-qr-code-area")).toBeTruthy();
  expect(QRCode.toCanvas).toHaveBeenCalledWith(expect.anything(),order.qrCodeUrl,expect.anything());
 });
 it("keeps an uncertain create failure from being resubmitted",async()=>{
  const f=live({post:()=>reply({},500)});await generate();await screen.findByTestId("billing-refresh-hint");
  expect((screen.getByTestId("billing-generate-qr") as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByTestId("billing-generate-qr"));
  expect(f.fetcher.mock.calls.filter(([,init])=>init.method==="POST")).toHaveLength(1);
  expect(screen.queryByTestId("billing-qr-code-area")).toBeNull();
 });
 it("keeps the current order and QR on a failed status read",async()=>{
  live({get:()=>reply({},502)});await generate();await screen.findByTestId("billing-qr-code-area");
  fireEvent.click(screen.getByTestId("billing-refresh-status"));
  expect((await screen.findByTestId("billing-refresh-hint")).textContent).toContain("订单已保留");
  expect(screen.getByTestId("billing-qr-code-area")).toBeTruthy();
  expect(screen.queryByTestId("billing-success-badge")).toBeNull();
 });
 it("serializes manual and timed polling, then stops after SUCCESS",async()=>{
  let finish!:(response:Response)=>void;
  const f=live({get:()=>new Promise(resolve=>{finish=resolve;})});await generate();await screen.findByTestId("billing-qr-code-area");
  vi.useFakeTimers();fireEvent.click(screen.getByTestId("billing-refresh-status"));
  await act(async()=>{await vi.advanceTimersByTimeAsync(3000);});
  const gets=()=>f.fetcher.mock.calls.filter(([url])=>String(url).includes(`/orders/${order.orderNo}`));
  expect(gets()).toHaveLength(1);
  await act(async()=>{finish(await reply({order:{...order,status:"SUCCESS",paidAt:new Date().toISOString()}}));});
  expect(screen.getByTestId("billing-success-badge")).toBeTruthy();
  expect(screen.queryByTestId("billing-qr-code-area")).toBeNull();
  await act(async()=>{await vi.advanceTimersByTimeAsync(9000);});expect(gets()).toHaveLength(1);
  expect(f.credited).toHaveBeenCalledTimes(1);
  expect(f.fetcher.mock.calls.filter(([url])=>String(url).endsWith("/wallet?ownerType=user"))).toHaveLength(2);
  expect(f.fetcher.mock.calls.filter(([url])=>String(url).includes("/transactions?"))).toHaveLength(2);
 });
 it.each([401,403,404])("masks all sensitive content on a definitive %s order denial",async(status)=>{
  live({get:()=>reply({},status)});await generate();await screen.findByTestId("billing-qr-code-area");
  fireEvent.click(screen.getByTestId("billing-refresh-status"));await screen.findByTestId("billing-cashier-denied");
  expect(screen.queryByTestId("billing-qr-code-area")).toBeNull();
  expect(screen.queryByText(`订单号：${order.orderNo}`)).toBeNull();
  expect(screen.queryByTestId("billing-updated-balance")).toBeNull();
 });
 it("does not block package selection on wallet outage",async()=>{
  live({wallet:()=>reply({},503)});
  expect(await screen.findByRole("radio")).toBeTruthy();
  expect(await screen.findByRole("button",{name:"重试余额查询"})).toBeTruthy();
  await generate();expect(await screen.findByTestId("billing-qr-code-area")).toBeTruthy();
 });
 it.each([
  {...order,ownerId:"another-user"},
  {...order,qrCodeUrl:"https://remote-qr.example/pay"},
  {...order,packageId:"unexpected-package"},
 ])("does not display forged create result %#",async(forged)=>{
  live({post:()=>reply({order:forged})});await generate();await screen.findByTestId("billing-refresh-hint");
  expect(screen.queryByTestId("billing-qr-code-area")).toBeNull();
 });
 it("hides expired QR without inventing CLOSED or regenerating an intent",async()=>{
  const f=live({post:()=>reply({order:{...order,expiredAt:new Date(Date.now()-1000).toISOString()}})});await generate();
  expect(await screen.findByTestId("billing-qr-expired")).toBeTruthy();
  expect(screen.queryByTestId("billing-qr-code-area")).toBeNull();
  expect(screen.queryByTestId("billing-regenerate")).toBeNull();
  expect(f.fetcher.mock.calls.filter(([,init])=>init.method==="POST")).toHaveLength(1);
 });
 it("does not encourage paying again after an accounting failure",async()=>{
  live({get:()=>reply({order:{...order,status:"FAILED",lastErrorCode:"invalid_amount"}})});await generate();await screen.findByTestId("billing-qr-code-area");fireEvent.click(screen.getByTestId("billing-refresh-status"));
  expect((await screen.findByRole("alert")).textContent).toContain("勿再次付款");
  expect(screen.queryByTestId("billing-generate-qr")).toBeNull();expect(screen.queryByTestId("billing-regenerate")).toBeNull();
 });
 it("redraws a QR locally without creating a second payment",async()=>{
  vi.mocked(QRCode.toCanvas).mockRejectedValueOnce(new Error("canvas failed"));
  const f=live();await generate();fireEvent.click(await screen.findByRole("button",{name:"重新绘制二维码"}));
  await act(async()=>{});expect(QRCode.toCanvas).toHaveBeenCalledTimes(2);
  expect(f.fetcher.mock.calls.filter(([,init])=>init.method==="POST")).toHaveLength(1);
 });
 it("retains a known order across closing and reopening",async()=>{
  const f=live();await generate();await screen.findByTestId("billing-qr-code-area");
  f.view.rerender(<LiveCashierDialog {...f.props} open={false}/>);
  expect(screen.queryByTestId("billing-cashier-dialog")).toBeNull();
  f.view.rerender(<LiveCashierDialog {...f.props}/>);await screen.findByTestId("billing-qr-code-area");
  expect(f.fetcher.mock.calls.filter(([,init])=>init.method==="POST")).toHaveLength(1);
 });
});

describe("F06 refreshed accounting and stale result protection",()=>{
 it("hides old accounting while SUCCESS wallet and ledger are pending",async()=>{
  let wallets=0,ledgers=0;
  live({wallet:()=>++wallets===1?reply({wallet}):new Promise(()=>undefined),ledger:()=>++ledgers===1?reply({items:[],nextCursor:null}):new Promise(()=>undefined),get:()=>reply({order:{...order,status:"SUCCESS",paidAt:new Date().toISOString()}})});
  await generate();await screen.findByTestId("billing-qr-code-area");fireEvent.click(screen.getByTestId("billing-refresh-status"));
  await screen.findByTestId("billing-success-badge");
  expect(screen.queryByTestId("billing-updated-balance")).toBeNull();
  expect(screen.queryByTestId("billing-ledger-empty")).toBeNull();
  expect(screen.getByText("支付已确认，正在刷新余额…")).toBeTruthy();
 });
 it("retains SUCCESS when a later read returns a stale payable status",async()=>{
  let reads=0;
  live({get:()=>reply({order:++reads===1?{...order,status:"SUCCESS",paidAt:new Date().toISOString()}:order})});await generate();await screen.findByTestId("billing-qr-code-area");
  fireEvent.click(screen.getByTestId("billing-refresh-status"));await screen.findByTestId("billing-success-badge");
  fireEvent.click(screen.getByTestId("billing-refresh-status"));await screen.findByTestId("billing-refresh-hint");
  expect(screen.getByTestId("billing-success-badge")).toBeTruthy();expect(screen.queryByTestId("billing-qr-code-area")).toBeNull();
 });
 it("aborts old owner requests and ignores their late payment reply",async()=>{
  let finish!:(response:Response)=>void;
  const f=live({get:()=>new Promise(resolve=>{finish=resolve;})});await generate();await screen.findByTestId("billing-qr-code-area");
  fireEvent.click(screen.getByTestId("billing-refresh-status"));
  const oldRequest=f.fetcher.mock.calls.find(([url])=>String(url).includes(`/orders/${order.orderNo}`));
  f.view.rerender(<LiveCashierDialog {...f.props} owner={{ownerType:"user",ownerId:"user-b"}} sessionToken="new-user-session"/>);
  expect((oldRequest![1].signal as AbortSignal).aborted).toBe(true);
  await act(async()=>{finish(await reply({order:{...order,status:"SUCCESS",paidAt:new Date().toISOString()}}));});
  expect(screen.queryByTestId("billing-success-badge")).toBeNull();expect(screen.queryByTestId("billing-qr-code-area")).toBeNull();
 });
});

import { CashierLedgerHistory } from "@/components/billing/cashier-ledger-history";
import { renderHook } from "@testing-library/react";
import { useCashierOrder } from "@/components/billing/use-cashier-order";
const txn={txnId:"t1",type:"purchase",direction:1,credits:100,balanceAfter:100,sourceType:"payment_order",sourceId:order.orderNo,operatorId:null,reason:null,createdAt:"2026-10-16T00:00:00Z"} as const;
describe("F06 full ledger pagination",()=>{
 it("keeps existing records and cursor through an error, then deduplicates the last page",async()=>{
  let calls=0;
  vi.stubGlobal("fetch",vi.fn((url:string)=>{
   expect(new URL(url).searchParams.get("cursor")).toBe("next-page");
   return ++calls===1?reply({},503):reply({items:[txn,{...txn,txnId:"t2"},{...txn,txnId:"t2"}],nextCursor:null});
  }));
  render(<CashierLedgerHistory owner={{ownerType:"user",ownerId:"user-a"}} sessionToken="cashier-test-session" initial={{items:[txn],nextCursor:"next-page"}} onDenied={vi.fn()}/>);
  fireEvent.click(screen.getByTestId("billing-view-all-ledger"));fireEvent.click(await screen.findByRole("button",{name:"重试加载流水"}));
  await act(async()=>{});
  expect(screen.getByTestId("billing-ledger-table").querySelectorAll("tbody tr")).toHaveLength(2);
  expect(screen.queryByRole("button",{name:"加载更多流水"})).toBeNull();
 });
});

describe("F06 purchase navigation intent",()=>{
 it("consumes an explicit configured purchase intent once and restores a safe focus target",async()=>{
  const f=live();f.view.unmount();const consumed=vi.fn();
  const view=render(<BillingOverview userId="user-a" sessionToken="cashier-test-session" openOnReady onPurchaseOpened={consumed}/>);
  await screen.findByTestId("billing-cashier-dialog");expect(consumed).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole("button",{name:"关闭"}));
  await act(async()=>{});
  expect(screen.queryByTestId("billing-cashier-dialog")).toBeNull();
  await waitFor(()=>expect(document.activeElement).toBe(screen.getByRole("button",{name:"充值 credit"})));
  view.rerender(<BillingOverview userId="user-a" sessionToken="cashier-test-session" openOnReady onPurchaseOpened={consumed}/>);
  expect(consumed).toHaveBeenCalledTimes(1);expect(screen.queryByTestId("billing-cashier-dialog")).toBeNull();
 });
});

describe("F06 payment confirmation safety",()=>{
 it("removes the payable QR while verified payment is PROCESSING without claiming SUCCESS",async()=>{
  live({get:()=>reply({order:{...order,status:"PROCESSING"}})});await generate();await screen.findByTestId("billing-qr-code-area");
  fireEvent.click(screen.getByTestId("billing-refresh-status"));await screen.findByTestId("billing-processing-hint");
  expect(screen.queryByTestId("billing-qr-code-area")).toBeNull();expect(screen.queryByTestId("billing-success-badge")).toBeNull();
 });
});

describe("F06 closed paid-funds recovery and legal late-payment transitions",()=>{
 it.each(["invalid_amount","wechat_upstream_failed"])("retains closed %s orders without a repay action or success claim",async lastErrorCode=>{
  const f=live({get:()=>reply({order:{...order,status:"CLOSED",closedAt:new Date().toISOString(),lastErrorCode}})});
  await generate();await screen.findByTestId("billing-qr-code-area");
  fireEvent.click(screen.getByTestId("billing-refresh-status"));
  expect(await screen.findByTestId("billing-manual-recovery")).toBeTruthy();
  expect(screen.getByTestId("billing-order-no").textContent).toContain(order.orderNo);
  expect(screen.queryByTestId("billing-regenerate")).toBeNull();
  expect(screen.queryByTestId("billing-qr-code-area")).toBeNull();
  expect(screen.queryByTestId("billing-success-badge")).toBeNull();
  expect(screen.getByTestId("billing-refresh-status")).toBeTruthy();
  expect(f.fetcher.mock.calls.filter(([,init])=>init.method==="POST")).toHaveLength(1);
  expect(f.credited).not.toHaveBeenCalled();
 });
 it.each(["invalid_amount","wechat_upstream_failed",null])("enforces closed recovery eligibility inside the hook for %s",async lastErrorCode=>{
  const closed={...order,status:"CLOSED",closedAt:new Date().toISOString(),lastErrorCode};
  const fetcher=vi.fn((_url:string,init:RequestInit)=>reply({order:init.method==="POST"?order:closed}));
  vi.stubGlobal("fetch",fetcher);
  const {result}=renderHook(()=>useCashierOrder({ownerType:"user",ownerId:"user-a"},"cashier-test-session",true));
  await act(async()=>{await result.current.create("p1");});
  await act(async()=>{await result.current.refresh();});
  expect(result.current.order).toMatchObject(closed);
  act(()=>result.current.regenerate());
  if(lastErrorCode!==null)expect(result.current.order).toMatchObject(closed);
  else expect(result.current.order).toBeNull();
  await act(async()=>{await result.current.create("p1");});
  expect(fetcher.mock.calls.filter(([,init])=>init.method==="POST")).toHaveLength(lastErrorCode===null?2:1);
 });
 it.each(["PENDING","PROCESSING","FAILED"])("rejects CLOSED regression to %s and preserves the existing order",async status=>{
  let reads=0;
  live({get:()=>reply({order:{...order,status:++reads===1?"CLOSED":status,closedAt:new Date().toISOString()}})});
  await generate();await screen.findByTestId("billing-qr-code-area");
  fireEvent.click(screen.getByTestId("billing-refresh-status"));await screen.findByTestId("billing-regenerate");
  fireEvent.click(screen.getByTestId("billing-refresh-status"));await screen.findByTestId("billing-refresh-hint");
  expect(screen.getByTestId("billing-order-status").textContent).toBe("已关闭");
  expect(screen.queryByTestId("billing-qr-code-area")).toBeNull();
  expect(screen.queryByTestId("billing-success-badge")).toBeNull();
 });
 it("accepts late SUCCESS after CLOSED and refreshes accounting instead of blocking real funds",async()=>{
  let reads=0,walletReads=0;
  const f=live({wallet:()=>reply({wallet:{...wallet,balance:++walletReads===1?100:220}}),get:()=>reply({order:{...order,status:++reads===1?"CLOSED":"SUCCESS",closedAt:reads===1?new Date().toISOString():null,paidAt:reads===1?null:new Date().toISOString()}})});
  await generate();await screen.findByTestId("billing-qr-code-area");
  fireEvent.click(screen.getByTestId("billing-refresh-status"));await screen.findByTestId("billing-regenerate");
  fireEvent.click(screen.getByTestId("billing-refresh-status"));await screen.findByTestId("billing-success-badge");
  await waitFor(()=>expect(screen.getByTestId("billing-updated-balance").textContent).toContain("220"));
  expect(walletReads).toBe(2);expect(f.credited).toHaveBeenCalledTimes(1);
  expect(screen.queryByTestId("billing-regenerate")).toBeNull();
 });
});


describe("F06 confirmed repeat purchase",()=>{
 it.each(["SUCCESS", "CLOSED"] as const)("starts a new purchase after %s even while an old status refresh is pending",async status=>{
  let reads=0,posts=0,finish!:(response:Response)=>void;
  const completed={...order,status,closedAt:status==="CLOSED"?new Date().toISOString():null};
  const next={...order,orderNo:"bg20261016000000mnopqr",qrCodeUrl:"weixin://wxpay/bizpayurl?pr=next-intent"};
  const fetcher=vi.fn((_url:string,init:RequestInit)=>init.method==="POST"
   ?reply({order:++posts===1?order:next})
   :++reads===1?reply({order:completed}):new Promise<Response>(resolve=>{finish=resolve;}));
  vi.stubGlobal("fetch",fetcher);
  const {result}=renderHook(()=>useCashierOrder({ownerType:"user",ownerId:"user-a"},"cashier-test-session",true));
  await act(async()=>{await result.current.create("p1");});
  await act(async()=>{await result.current.refresh();});
  let refreshing!:Promise<void>;
  act(()=>{refreshing=result.current.refresh();});
  const oldSignal=fetcher.mock.calls.at(-1)![1].signal as AbortSignal;
  act(()=>{if(status==="SUCCESS")result.current.buyAgain();else result.current.regenerate();});
  expect(result.current.order).toBeNull();
  expect(oldSignal.aborted).toBe(true);
  await act(async()=>{await result.current.create("p1");});
  expect(result.current.order?.orderNo).toBe(next.orderNo);
  await act(async()=>{finish(await reply({order:completed}));await refreshing;});
  expect(result.current.order?.orderNo).toBe(next.orderNo);
  expect(posts).toBe(2);
 });
 it("keeps packages visible and locked while the current order is payable",async()=>{
  live();await generate();await screen.findByTestId("billing-qr-code-area");
  expect((screen.getByRole("radio") as HTMLInputElement).disabled).toBe(true);
  expect(screen.getByRole("radiogroup",{name:"充值套餐"})).toBeTruthy();
 });
 it("retains SUCCESS on reopen until an explicit buy again, then creates a distinct order",async()=>{
  let posts=0;
  const next={...order,orderNo:"bg20261016000000ghijkl",qrCodeUrl:"weixin://wxpay/bizpayurl?pr=second-intent"};
  const f=live({post:()=>reply({order:++posts===1?order:next}),get:()=>reply({order:{...order,status:"SUCCESS",paidAt:new Date().toISOString()}})});
  await generate();await screen.findByTestId("billing-qr-code-area");
  fireEvent.click(screen.getByTestId("billing-refresh-status"));await screen.findByTestId("billing-success-badge");
  f.view.rerender(<LiveCashierDialog {...f.props} open={false}/>);
  f.view.rerender(<LiveCashierDialog {...f.props}/>);
  expect(await screen.findByTestId("billing-success-badge")).toBeTruthy();expect(posts).toBe(1);
  fireEvent.click(screen.getByRole("button",{name:"再次购买"}));
  expect(await screen.findByRole("radio")).toBeTruthy();expect(posts).toBe(1);
  expect(screen.queryByTestId("billing-success-badge")).toBeNull();
  await generate();expect(await screen.findByTestId("billing-order-no")).toHaveProperty("textContent",`订单号：${next.orderNo}`);
  expect(posts).toBe(2);expect(f.credited).toHaveBeenCalledTimes(1);
 });
 it.each(["PENDING","PROCESSING","FAILED","CLOSED"] as const)("does not offer another purchase for %s",async status=>{
  live({get:()=>reply({order:{...order,status,lastErrorCode:status==="CLOSED"?"invalid_amount":null}})});
  await generate();await screen.findByTestId("billing-qr-code-area");fireEvent.click(screen.getByTestId("billing-refresh-status"));
  await waitFor(()=>expect(screen.getByTestId("billing-order-status").textContent).toBe(({PENDING:"待支付",PROCESSING:"确认到账中",FAILED:"到账处理失败",CLOSED:"等待人工处理"})[status]));
  expect(screen.queryByRole("button",{name:"再次购买"})).toBeNull();
 });
});


describe("F06 explicit creation rejection",()=>{
 it("allows a manual retry after structured upstream rejection without showing a fake QR",async()=>{
  let posts=0;const f=live({post:()=>++posts===1?reply({error:"bad_gateway",code:"wechat_upstream_failed"},502):reply({order})});
  await generate();await screen.findByTestId("billing-refresh-hint");
  expect(screen.queryByTestId("billing-qr-code-area")).toBeNull();
  expect((screen.getByTestId("billing-generate-qr") as HTMLButtonElement).disabled).toBe(false);
  expect(posts).toBe(1);
  fireEvent.click(screen.getByTestId("billing-generate-qr"));
  expect(await screen.findByTestId("billing-qr-code-area")).toBeTruthy();expect(posts).toBe(2);
  expect(f.credited).not.toHaveBeenCalled();
 });
 it.each([{error:"bad_gateway"},{code:"unknown"}])("keeps an unclassified 502 uncertain: %j",async body=>{
  const f=live({post:()=>reply(body,502)});await generate();await screen.findByTestId("billing-refresh-hint");
  expect((screen.getByTestId("billing-generate-qr") as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByTestId("billing-generate-qr"));
  expect(f.fetcher.mock.calls.filter(([,init])=>init.method==="POST")).toHaveLength(1);
  expect(screen.queryByTestId("billing-qr-code-area")).toBeNull();
 });
});

describe("customer cancellation",()=>{
 it("closes the actual server order, hides its QR and allows selecting another package",async()=>{
  const closed={...order,status:"CLOSED",closedAt:new Date().toISOString()};
  const f=live({post:()=>reply({order})});await generate();
  await screen.findByTestId("billing-qr-code-area");
  f.fetcher.mockImplementation((url:string,init:RequestInit)=>{
   if(new URL(url).pathname.endsWith("/cancel")&&init.method==="POST")return reply({order:closed});
   return reply({order});
  });
  fireEvent.click(screen.getByRole("button",{name:/^取消订单$/}));
  await screen.findByTestId("billing-regenerate");
  expect(screen.queryByTestId("billing-qr-code-area")).toBeNull();
  expect(f.fetcher.mock.calls.some(([url,init])=>new URL(url).pathname.endsWith(`/billing/orders/${order.orderNo}/cancel`)&&init.method==="POST")).toBe(true);
 });
 it("keeps the original order when cancellation cannot be confirmed",async()=>{
  const f=live();await generate();await screen.findByTestId("billing-qr-code-area");
  f.fetcher.mockImplementation(()=>reply({code:"wechat_upstream_failed"},502));
  fireEvent.click(screen.getByRole("button",{name:/^取消订单$/}));
  await waitFor(()=>expect(screen.getByTestId("billing-refresh-hint").textContent).toContain("取消结果尚未确认"));
  expect(screen.queryByTestId("billing-regenerate")).toBeNull();
  expect(screen.getByTestId("billing-order-no").textContent).toContain(order.orderNo);
 });
});

it.each(["https://evil.test/pay","weixin://wxpay/bizpayurl?pr=bad"])("rejects unsafe Stripe order %s",async url=>{
 live({providers:["stripe"],post:()=>reply({order:{...order,provider:"stripe",qrCodeUrl:url}})});await generate();
 await screen.findByTestId("billing-refresh-hint");expect(screen.queryByRole("link",{name:"前往 Stripe 付款"})).toBeNull();
});
it("retains Stripe order and locks provider while pending",async()=>{
 const f=live({providers:["wechat","stripe"],post:()=>reply({order:{...order,provider:"stripe",qrCodeUrl:"https://checkout.stripe.com/c/pay/test"}})});
 await screen.findByText("Stripe");fireEvent.click(screen.getByLabelText("Stripe"));fireEvent.click(screen.getByTestId("billing-generate-qr"));
 expect(await screen.findByRole("link",{name:"前往 Stripe 付款"})).toBeTruthy();expect((screen.getByLabelText("微信支付") as HTMLInputElement).disabled).toBe(true);
 expect(JSON.parse(String(f.fetcher.mock.calls.find(([,init])=>init.method==="POST")![1].body)).provider).toBe("stripe");
});
it("keeps an already paid Stripe creation response and refreshes its credits",async()=>{
 live({providers:["stripe"],post:()=>reply({order:{...order,provider:"stripe",qrCodeUrl:"pending",status:"SUCCESS",paidAt:new Date().toISOString()}})});
 await generate();
 expect(await screen.findByTestId("billing-success-badge")).toBeTruthy();
 expect(screen.queryByRole("link",{name:"前往 Stripe 付款"})).toBeNull();
 expect(screen.queryByText(/暂时无法确认结果/)).toBeNull();
});

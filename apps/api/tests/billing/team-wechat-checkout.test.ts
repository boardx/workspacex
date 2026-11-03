import { generateKeyPairSync } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
import type { TeamPaymentSnapshot } from "../../src/application/billing/team-payment-provider.port";
import { TeamWechatCheckoutClient } from "../../src/infrastructure/billing/team-wechat-checkout-client";
import { DeploymentBillingConfig } from "../../src/infrastructure/billing/deployment-billing-config";
import { BILLING_ACCOUNTING_GENERATION } from "../../src/domain/billing/billing-generation";
import { TEAM_PAYMENT_PRODUCT } from "../../src/domain/billing/team-payment-product";
const privateKey=generateKeyPairSync("rsa",{modulusLength:2048}).privateKey.export({type:"pkcs8",format:"pem"}).toString();
const config=new DeploymentBillingConfig({BILLING_DEPLOYMENT:"cn",WECHAT_PAY_APP_ID:"wx-team",WECHAT_PAY_MCH_ID:"1900000000",WECHAT_PAY_API_V3_KEY:"01234567890123456789012345678901",WECHAT_PAY_MCH_SERIAL_NO:"ABC123",WECHAT_PAY_PRIVATE_KEY:privateKey,WECHAT_PAY_NOTIFY_URL:"https://example.test/wechat"});
function purchase():TeamPaymentSnapshot { return {purchaseRef:"team-purchase_ABC123",createdAt:new Date(),checkoutExpiresAt:new Date(Date.now()+600000),quote:{purpose:"initial",orgId:"org-team",generation:BILLING_ACCOUNTING_GENERATION,quoteRef:"quote-team",catalogVersion:"frozen",sku:"frozen-team",provider:"wechat",currency:"CNY",amountMinor:43210,createdAt:new Date().toISOString(),expiresAt:new Date(Date.now()-1000).toISOString(),seats:7,monthlyCredits:123456,billingCycle:"year",renewalMode:"manual",planVersion:1} as TeamPaymentSnapshot["quote"]}; }
const client=()=>new TeamWechatCheckoutClient(config,{info(){},error(){}});
afterEach(()=>vi.unstubAllGlobals());
it.each(["initial","renewal","credit_topup"])("uses frozen %s facts and stable merchant reference",async purpose=>{
 const p=purchase();const intent={...p,quote:{...p.quote,purpose}} as TeamPaymentSnapshot;
 const fetcher=vi.fn(async(_url:string,_options?:RequestInit)=>new Response(JSON.stringify({code_url:"weixin://wxpay/bizpayurl?pr=team"})));vi.stubGlobal("fetch",fetcher);
 const a=await client().createCheckout(intent);await client().createCheckout(intent);
 expect(a).toEqual({sessionRef:p.purchaseRef,url:"weixin://wxpay/bizpayurl?pr=team",expiresAt:p.checkoutExpiresAt});
 const bodies=fetcher.mock.calls.map(call=>JSON.parse(String(call[1]?.body)));
 expect(bodies[0]).toMatchObject({out_trade_no:p.purchaseRef,amount:{total:43210,currency:"CNY"},time_expire:p.checkoutExpiresAt.toISOString(),attach:`${TEAM_PAYMENT_PRODUCT}:${p.quote.generation}:${p.purchaseRef}`});
 expect(bodies[0]).toEqual(bodies[1]);expect(bodies[0]).not.toHaveProperty("contract_id");expect(bodies[0].attach).not.toContain("org-team");expect(bodies[0].description).toContain("Team");
});
it.each(["short","bad/ref","a".repeat(33)])("rejects illegal merchant reference %s",async purchaseRef=>{const f=vi.fn();vi.stubGlobal("fetch",f);await expect(client().createCheckout({...purchase(),purchaseRef})).rejects.toThrow();expect(f).not.toHaveBeenCalled();});
it.each([{currency:"USD"},{provider:"stripe"},{amountMinor:0},{amountMinor:1.5},{generation:"unknown"},{purpose:"add_seats"},{renewalMode:"automatic"}])("rejects unsupported snapshot %j",async patch=>{const p=purchase(),f=vi.fn();vi.stubGlobal("fetch",f);await expect(client().createCheckout({...p,quote:{...p.quote,...patch}} as TeamPaymentSnapshot)).rejects.toThrow();expect(f).not.toHaveBeenCalled();});
it.each([new Date(NaN),new Date(Date.now()+30000)])("rejects invalid or near deadline",async checkoutExpiresAt=>{const f=vi.fn();vi.stubGlobal("fetch",f);await expect(client().createCheckout({...purchase(),checkoutExpiresAt})).rejects.toThrow();expect(f).not.toHaveBeenCalled();});
it("refuses disabled deployment",async()=>{const f=vi.fn();vi.stubGlobal("fetch",f);await expect(new TeamWechatCheckoutClient(new DeploymentBillingConfig({BILLING_DEPLOYMENT:"us"}),{info(){},error(){}}).createCheckout(purchase())).rejects.toThrow();expect(f).not.toHaveBeenCalled();});
it("inherits QR validation",async()=>{vi.stubGlobal("fetch",vi.fn(async()=>new Response(JSON.stringify({code_url:"https://evil.test"}))));await expect(client().createCheckout(purchase())).rejects.toThrow("wechat_upstream_failed");});
it.each(["month","year"])("preserves the frozen billing cycle %s in the merchant description",async billingCycle=>{const p=purchase();let description="";vi.stubGlobal("fetch",vi.fn(async(_url:string,options?:RequestInit)=>{description=JSON.parse(String(options?.body)).description;return new Response(JSON.stringify({code_url:"weixin://wxpay/bizpayurl?pr=cycle"}));}));await client().createCheckout({...p,quote:{...p.quote,billingCycle}} as TeamPaymentSnapshot);expect(description).toContain(billingCycle==="year"?"年付":"月付");});
it("keeps legacy Native default description and wire body equivalent",async()=>{
 const {WechatNativeClient}=await import("../../src/infrastructure/billing/wechat-native-client");

 const bodies:unknown[]=[];vi.stubGlobal("fetch",vi.fn(async(_url:string,options?:RequestInit)=>{bodies.push(JSON.parse(String(options?.body)));return new Response(JSON.stringify({code_url:"weixin://wxpay/bizpayurl?pr=legacy"}));}));
 const native=new WechatNativeClient(config,{info(){},error(){}}),order={orderNo:"legacy-test",ownerType:"user" as const,ownerId:"legacy-user",createdBy:"legacy-user",packageId:"legacy-package",amountFen:123,currency:"CNY" as const,baseCredits:120,bonusCredits:3,provider:"wechat" as const,status:"PENDING" as const,createdAt:new Date().toISOString(),expiredAt:new Date(Date.now()+600000).toISOString(),paidAt:null,notifyAt:null,closedAt:null,lastErrorCode:null};
 await native.createNativeOrder(order);await native.createNativeCheckout({orderNo:order.orderNo,amountFen:order.amountFen,currency:order.currency,expiredAt:order.expiredAt,description:`WorkspaceX ${order.baseCredits+order.bonusCredits} credits`});
 expect(bodies[0]).toEqual(bodies[1]);expect(bodies[0]).toMatchObject({description:"WorkspaceX 123 credits"});
});

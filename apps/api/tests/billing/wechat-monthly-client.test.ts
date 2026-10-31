import {afterEach,expect,it,vi} from "vitest";
import {generateKeyPairSync} from "node:crypto";
import {DeploymentBillingConfig} from "../../src/infrastructure/billing/deployment-billing-config";
import {WechatMonthlyPassClient} from "../../src/infrastructure/billing/wechat-monthly-pass-client";
import {MonthlyCheckoutRouter} from "../../src/infrastructure/billing/monthly-checkout-router";
import {MonthlyPassService,type MonthlyOrder} from "../../src/application/billing/monthly-pass-service";
import {MonthlyWechatCreditingStore} from "../../src/infrastructure/billing/monthly-wechat-crediting-store";
import type {DatabasePort,TenantSession} from "../../src/application/ports/database.port";
import type {VerifiedPaymentReceipt} from "../../src/application/billing/billing-notify-ports";
import {toOrgId} from "../../src/domain/org-id";
const privateKey=generateKeyPairSync("rsa",{modulusLength:2048}).privateKey.export({type:"pkcs8",format:"pem"}).toString();
const config=new DeploymentBillingConfig({BILLING_DEPLOYMENT:"cn",WECHAT_PAY_APP_ID:"wx-test",WECHAT_PAY_MCH_ID:"1900000000",WECHAT_PAY_API_V3_KEY:"01234567890123456789012345678901",WECHAT_PAY_MCH_SERIAL_NO:"ABC123",WECHAT_PAY_PRIVATE_KEY:privateKey,WECHAT_PAY_NOTIFY_URL:"https://example.test/wechat"});
const order:MonthlyOrder={orderId:"00000000-0000-4000-8000-000000006050",userId:"wechat-user",provider:"wechat",sessionRef:"bg20261031090000abc123",state:"pending",createdAt:new Date(),periodStart:null,periodEnd:null,remainingCredits:0};
function fixture(createdAt=order.createdAt){
 const db={withoutTenant:async(run:Parameters<DatabasePort["withoutTenant"]>[0])=>run({query:async()=>({rows:[{order_id:order.orderId,session_ref:order.sessionRef,created_at:createdAt,checkout_url:"weixin://wxpay/bizpayurl?pr=test"}],rowCount:1})} as unknown as TenantSession)} as unknown as DatabasePort;
 return {db,client:new WechatMonthlyPassClient(config,db,{info(){},error(){}})};
}
const upstream=(patch:Record<string,unknown>={})=>({appid:"wx-test",mchid:"1900000000",out_trade_no:order.sessionRef,trade_state:"SUCCESS",transaction_id:"420000123456",amount:{total:18000,currency:"CNY"},...patch});
afterEach(()=>vi.unstubAllGlobals());
it("creates fixed-price WeChat Native month with durable order number and no recurring agreement",async()=>{
 const {client}=fixture(),fetcher=vi.fn(async(_url:string,_options?:RequestInit)=>new Response(JSON.stringify({code_url:"weixin://wxpay/bizpayurl?pr=test"})));vi.stubGlobal("fetch",fetcher);
 expect(await client.create(order)).toMatchObject({id:order.sessionRef,url:"weixin://wxpay/bizpayurl?pr=test"});
 const [url,options]=fetcher.mock.calls[0] as unknown as [string,RequestInit];
 expect(url).toBe("https://api.mch.weixin.qq.com/v3/pay/transactions/native");
 expect(JSON.parse(String(options.body))).toMatchObject({out_trade_no:order.sessionRef,amount:{total:18000,currency:"CNY"}});
});
it("queries the fixed merchant endpoint and maps only verified payment facts",async()=>{
 const {client}=fixture(),fetcher=vi.fn(async(_url:string,_options?:RequestInit)=>new Response(JSON.stringify(upstream())));vi.stubGlobal("fetch",fetcher);
 expect(await client.retrieve(order.sessionRef!)).toMatchObject({status:"complete",amount_total:18000,payment_intent:"wx_420000123456",metadata:{provider:"wechat",order_ref:order.orderId}});
 expect(fetcher.mock.calls[0]?.[0]).toBe(`https://api.mch.weixin.qq.com/v3/pay/transactions/out-trade-no/${order.sessionRef}?mchid=1900000000`);
});
it.each([{amount:{total:1,currency:"CNY"}},{mchid:"other"},{out_trade_no:"other"},{trade_state:"REFUND"}])("rejects mismatched query %j",async patch=>{
 const {client}=fixture();vi.stubGlobal("fetch",vi.fn(async()=>new Response(JSON.stringify(upstream(patch)))));
 await expect(client.retrieve(order.sessionRef!)).rejects.toThrow();
});
it("does not expire an order merely because its local timer elapsed",async()=>{
 const {client}=fixture(new Date(Date.now()-1000000));
 vi.stubGlobal("fetch",vi.fn().mockResolvedValueOnce(new Response(JSON.stringify(upstream({trade_state:"NOTPAY"})))).mockResolvedValueOnce(new Response(null,{status:204})).mockResolvedValueOnce(new Response(JSON.stringify(upstream()))));
 expect(await client.retrieve(order.sessionRef!)).toMatchObject({status:"complete",payment_status:"paid"});
});
it("routes signed monthly receipt to the same grant boundary and rejects mismatched funds",async()=>{
 const {db,client}=fixture();vi.stubGlobal("fetch",vi.fn(async()=>new Response(JSON.stringify(upstream()))));
 const settle=vi.fn(async()=>{}),legacy={accept:vi.fn(),processOne:vi.fn(),due:vi.fn(),auditRejection:vi.fn()};
 const monthly=new MonthlyPassService({latest:async()=>order,reserve:async()=>order,bind:async()=>{},expire:async()=>{},settle},new MonthlyCheckoutRouter(client,client));
 const store=new MonthlyWechatCreditingStore(db,legacy,monthly,client);
 const receipt={orderNo:order.sessionRef,tradeState:"SUCCESS",amountFen:18000,currency:"CNY",transactionId:"420000123456",signatureVerified:true} as VerifiedPaymentReceipt;
 await expect(store.accept({...receipt,amountFen:1})).rejects.toThrow("order_mismatch");expect(settle).not.toHaveBeenCalled();
 await expect(store.accept(receipt)).resolves.toEqual({completed:true,manual:false});expect(settle).toHaveBeenCalledTimes(1);expect(legacy.accept).not.toHaveBeenCalled();
});
it("denies disabled monthly provider before reserving an order",async()=>{
 const reserve=vi.fn(),{client}=fixture();
 const monthly=new MonthlyPassService({latest:async()=>null,reserve,bind:async()=>{},expire:async()=>{},settle:async()=>{}},new MonthlyCheckoutRouter({enabled:()=>false,liveMode:()=>false,create:vi.fn(),retrieve:vi.fn()},client));
 await expect(monthly.checkout({userId:"u",orgId:toOrgId("o")},"stripe")).rejects.toMatchObject({code:"payment_provider_not_configured"});expect(reserve).not.toHaveBeenCalled();
});

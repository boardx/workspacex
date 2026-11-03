import {createPublicKey,generateKeyPairSync,sign} from "node:crypto";
import {afterEach,expect,it,vi} from "vitest";
import {TeamWechatPaymentClient} from "../../src/infrastructure/billing/team-wechat-payment-client";
import {DeploymentBillingConfig} from "../../src/infrastructure/billing/deployment-billing-config";
import {BILLING_ACCOUNTING_GENERATION as generation} from "../../src/domain/billing/billing-generation";
import {TEAM_PAYMENT_PRODUCT} from "../../src/domain/billing/team-payment-product";
const key=generateKeyPairSync("rsa",{modulusLength:2048}).privateKey,platformKey=generateKeyPairSync("rsa",{modulusLength:2048}).privateKey;
const config=new DeploymentBillingConfig({BILLING_DEPLOYMENT:"cn",WECHAT_PAY_APP_ID:"wx-team",WECHAT_PAY_MCH_ID:"1900000000",WECHAT_PAY_API_V3_KEY:"01234567890123456789012345678901",WECHAT_PAY_MCH_SERIAL_NO:"ABC123",WECHAT_PAY_PRIVATE_KEY:key.export({type:"pkcs8",format:"pem"}).toString(),WECHAT_PAY_NOTIFY_URL:"https://example.test/wechat",WECHAT_PAY_PLATFORM_KEY_ID:"PUB_KEY_ID_TEAM",WECHAT_PAY_PLATFORM_PUBLIC_KEY:createPublicKey(platformKey).export({type:"spki",format:"pem"}).toString()});
const p={purchaseRef:"bt20261102010000ABC123",createdAt:new Date("2026-11-02T01:00:00Z"),checkoutExpiresAt:new Date("2026-11-02T01:15:00Z"),quote:{generation,provider:"wechat",currency:"CNY",amountMinor:43210}} as never;
const facts={appid:"wx-team",mchid:"1900000000",out_trade_no:"bt20261102010000ABC123",trade_state:"SUCCESS",transaction_id:"420001234",success_time:"2026-11-02T01:01:00Z",attach:`${TEAM_PAYMENT_PRODUCT}:${generation}:bt20261102010000ABC123`,amount:{total:43210,currency:"CNY"}};
function response(patch:Record<string,unknown>={},signed=true,status=200){const raw=JSON.stringify({...facts,...patch}),timestamp=String(Math.floor(Date.now()/1000)),nonce="team-fixture";return new Response(raw,{status,headers:signed?{"Wechatpay-Timestamp":timestamp,"Wechatpay-Nonce":nonce,"Wechatpay-Serial":"PUB_KEY_ID_TEAM","Wechatpay-Signature":sign("RSA-SHA256",Buffer.from(`${timestamp}\n${nonce}\n${raw}\n`),platformKey).toString("base64")}: {}});}
const client=()=>new TeamWechatPaymentClient(config,{info(){},error(){}});
afterEach(()=>vi.unstubAllGlobals());
it("requires a signed authoritative merchant read and preserves actual paid time",async()=>{vi.stubGlobal("fetch",vi.fn(async()=>response()));expect(await client().read(p)).toEqual({state:"paid",paymentRef:"wx_420001234",paidAt:new Date(facts.success_time),amountMinor:43210,currency:"CNY"});});
it.each([{appid:"other"},{mchid:"other"},{out_trade_no:"other"},{attach:"personal:other"},{amount:{total:-1,currency:"CNY"}},{amount:{total:"43210",currency:"CNY"}},{transaction_id:"../bad"},{success_time:"2026-11-01T01:00:00Z"},{trade_state:"REFUND"}])("refuses mismatched signed facts %j",async patch=>{vi.stubGlobal("fetch",vi.fn(async()=>response(patch)));await expect(client().read(p)).rejects.toThrow();});
it("refuses missing upstream signature",async()=>{vi.stubGlobal("fetch",vi.fn(async()=>response({},false)));await expect(client().read(p)).rejects.toThrow("signature_invalid");});
it("authoritatively rechecks a payment racing closure",async()=>{vi.stubGlobal("fetch",vi.fn().mockResolvedValueOnce(response({trade_state:"NOTPAY"})).mockResolvedValueOnce(new Response(null,{status:204})).mockResolvedValueOnce(response()));expect(await client().reconcile(p)).toMatchObject({state:"paid"});});

it("releases a never-created intent only after a signed not-found and the immutable checkout deadline",async()=>{
 vi.stubGlobal("fetch",vi.fn(async()=>response({code:"ORDER_NOT_EXIST"},true,404)));
 expect(await client().read(p)).toEqual({state:"closed"});
 expect(await client().read(Object.assign({},p,{checkoutExpiresAt:new Date(Date.now()+60000)}) as never)).toEqual({state:"pending"});
});

it("retains signed real cash amounts for reconciliation instead of dropping a mismatched payment",async()=>{
 vi.stubGlobal("fetch",vi.fn(async()=>response({amount:{total:1,currency:"USD"}})));
 expect(await client().read(p)).toMatchObject({state:"paid",amountMinor:1,currency:"USD",paymentRef:"wx_420001234"});
});

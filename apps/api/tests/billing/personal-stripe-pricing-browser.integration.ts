/** Actual adopted USD page/API/PG through the trusted DevApp test-market configuration with an independent pinned-version Stripe HTTP fixture and raw HMAC callbacks.
 * Only identity chrome and hosted provider pages are intercepted in Chromium; no billing HTTP is intercepted.
 */
import {beforeAll,beforeEach,afterAll,it,expect,vi} from "vitest";
import {createServer,type Server} from "node:http";
import {createHmac,randomBytes} from "node:crypto";
import {mkdirSync,writeFileSync} from "node:fs";
import {resolve} from "node:path";
import type {Page} from "playwright";
import {PersonalCheckoutResult} from "@repo/contracts/billing-pricing";
import {notifyFixture} from "./wechat-notify-fixture";
import {user} from "./order-fixture";
import {asOwner} from "../support/db";
import {ownedPricingBrowser} from "../support/owned-pricing-browser";
import {cleanPersonalPricingFixtures,openPersonalPricingPage} from "../support/personal-pricing-fixtures";
import {personalPurchaseView,type PersonalPurchaseRow} from "../../src/infrastructure/billing/pg-personal-checkout-repository";
import {personalStripePaymentFixture} from "./personal-stripe-payment-fixture";
import {BILLING_ACCOUNTING_GENERATION} from "../../src/domain/billing/billing-generation";
import {creditMonthBoundary} from "../../src/domain/billing/personal-credit-calendar";
import {STRIPE_API_VERSION} from "../../src/infrastructure/billing/stripe-portal-client";
import {PersonalPaymentRecoveryWorker} from "../../src/infrastructure/billing/personal-payment-recovery-worker";
import {PersonalCreditPeriodWorker} from "../../src/infrastructure/billing/personal-credit-period-worker";
const evidence=process.env.PERSONAL_STRIPE_BROWSER_EVIDENCE_DIR??resolve(import.meta.dirname,"../test-results/personal-stripe-pricing");
const secret=`whsec_${randomBytes(16).toString("hex")}`,key=`sk_test_${randomBytes(16).toString("hex")}`,nativeFetch=globalThis.fetch;
type Entry={purchase:ReturnType<typeof personalPurchaseView>;open:Record<string,unknown>;complete:Record<string,unknown>;paid:boolean;anchor:Date;financial?:ReturnType<typeof personalStripePaymentFixture>};
const sessions=new Map<string,Entry>(),requests:{path:string;body:string}[]=[];
let fixture:Awaited<ReturnType<typeof notifyFixture>>|undefined,owned:Awaited<ReturnType<typeof ownedPricingBrowser>>|undefined,server:Server|undefined;
let loseCheckoutResponse=false;
// Financial fixtures: exact f04 owners, cleaned before legacy identity cleanup; epoch reset only after module workers drain.
async function hosted(page:Page){
 await page.route("https://checkout.stripe.com/**",route=>route.fulfill({contentType:"text/html",body:"<h1>Independent hosted Stripe Checkout fixture</h1>"}));
 await page.route("https://billing.stripe.com/**",route=>route.fulfill({contentType:"text/html",body:"<h1>Independent hosted Stripe portal fixture</h1>"}));
}
async function start(page:Page,kind:"plans"|"credits",year=false){
 await hosted(page);await openPersonalPricingPage(page,owned!.origin);await page.getByTestId(kind==="plans"?"pricing-open-plans":"pricing-buy-credits").click();if(year)await page.getByTestId("pricing-cycle-year").click();
 expect(await page.getByTestId("pricing-provider-wechat").count()).toBe(0);
 const [response]=await Promise.all([page.waitForResponse(r=>new URL(r.url()).pathname==="/__fullstack_api/billing/checkout"&&r.request().method()==="POST"),page.getByTestId("pricing-continue-checkout").click()]);expect(response.status()).toBe(201);
 const result=PersonalCheckoutResult.parse(await response.json());await page.waitForURL("https://checkout.stripe.com/**");expect(page.url()).toBe(result.url);expect(new URL(page.url()).hash).toBe("#fidkdWxFixture%2Fcheckout");
 expect(result.provider).toBe("stripe");expect(result.renewalMode).toBe(kind==="plans"?"automatic":"manual");return result;
}
async function callback(type:string,object:Record<string,unknown>){
 const body=Buffer.from(JSON.stringify({object:"event",id:`evt_${randomBytes(10).toString("hex")}`,type,data:{object}})),timestamp=String(Math.floor(Date.now()/1000));
 const signature=createHmac("sha256",secret).update(`${timestamp}.`).update(body).digest("hex");
 return nativeFetch(`${fixture!.base}/billing/webhooks/stripe`,{method:"POST",headers:{"content-type":"application/json","stripe-signature":`t=${timestamp},v1=${signature}`},body:new Uint8Array(body)});
}
async function complete(page:Page,ref:string){
 const entry=[...sessions.values()].find(e=>e.purchase.purchaseRef===ref)!;entry.paid=true;
 expect((await callback("checkout.session.completed",entry.complete)).status).toBe(200);expect((await callback("checkout.session.completed",entry.complete)).status).toBe(200);
 await page.goto(`${owned!.origin}/billing?purchase_ref=${encodeURIComponent(ref)}`);await page.getByTestId("pricing-checkout-success").waitFor();await page.getByTestId("pricing-payment-done").click();await page.getByTestId("pricing-wallet-balance").waitFor();return entry;
}
beforeAll(async()=>{
 mkdirSync(evidence,{recursive:true});
 server=createServer(async(req,res)=>{
  try{
   const chunks:Buffer[]=[];for await(const chunk of req)chunks.push(Buffer.from(chunk));const body=Buffer.concat(chunks).toString("utf8"),path=new URL(req.url!,"http://fixture").pathname;requests.push({path,body});
   expect(req.headers.authorization).toBe(`Bearer ${key}`);expect(req.headers["stripe-version"]).toBe(STRIPE_API_VERSION);let value:unknown;
   if(path==="/v1/checkout/sessions"&&req.method==="POST"){
    const input=new URLSearchParams(body),ref=input.get("client_reference_id")!;
    const row=(await asOwner(c=>c.query<PersonalPurchaseRow>("SELECT * FROM billing_personal_purchases WHERE purchase_ref=$1",[ref]))).rows[0]!;
    const purchase=personalPurchaseView(row),anchor=new Date(Math.floor(Date.now()/1000)*1000),recurring=purchase.product.kind==="subscription";
    expect(input.get("mode")).toBe(recurring?"subscription":"payment");expect(input.get("line_items[0][price_data][currency]")).toBe("usd");expect(Number(input.get("line_items[0][price_data][unit_amount]"))).toBe(purchase.product.amountMinor);expect(input.get("adaptive_pricing[enabled]")).toBe("false");expect(req.headers["idempotency-key"]).toBe(`personal-purchase:${ref}`);
    const financial=recurring?personalStripePaymentFixture(purchase,anchor):undefined;
    const complete:Record<string,unknown>=financial?.checkout??{object:"checkout.session",id:`cs_${ref}`,livemode:false,mode:"payment",status:"complete",payment_status:"paid",amount_total:purchase.product.amountMinor,currency:"usd",client_reference_id:ref,payment_intent:`pi_${ref}`,metadata:{product:"personal_pricing_v1",purchase_ref:ref,generation:purchase.generation,sku:purchase.product.sku},expires_at:anchor.getTime()/1000+86400,url:null};
    const open={...complete,status:"open",payment_status:"unpaid",subscription:null,url:`https://checkout.stripe.com/c/pay/${ref}#fidkdWxFixture%2Fcheckout`};sessions.set(String(complete.id),{purchase,open,complete,paid:false,anchor,financial});
    if(loseCheckoutResponse){res.statusCode=500;res.end(JSON.stringify({error:{code:"fixture_lost_checkout_response"}}));return;}value=open;
   }else if(path.startsWith("/v1/checkout/sessions/")){const entry=sessions.get(path.split("/").at(-1)!)!;value=entry.paid?entry.complete:entry.open;}
   else if(path.startsWith("/v1/subscriptions/"))value=[...sessions.values()].find(e=>e.financial?.subscription.id===path.split("/").at(-1))?.financial?.subscription;
   else if(path.startsWith("/v1/invoices/"))value=[...sessions.values()].find(e=>e.financial?.invoice.id===path.split("/").at(-1))?.financial?.invoice;
   else if(path==="/v1/invoices"){const sub=new URL(req.url!,"http://fixture").searchParams.get("subscription");value={object:"list",has_more:false,data:[...sessions.values()].filter(e=>e.paid&&e.financial?.subscription.id===sub).map(e=>e.financial!.invoice)};}
   else if(path.startsWith("/v1/prices/"))value=[...sessions.values()].find(e=>e.financial?.price.id===path.split("/").at(-1))?.financial?.price;
   else if(path==="/v1/billing_portal/sessions"){const customer=new URLSearchParams(body).get("customer");expect([...sessions.values()].some(e=>e.financial?.subscription.customer===customer)).toBe(true);value={object:"billing_portal.session",customer,url:"https://billing.stripe.com/p/session/fixture"};}
   if(!value)throw Error("unexpected_stripe_operation");res.setHeader("content-type","application/json");res.end(JSON.stringify(value));
  }catch{res.statusCode=500;res.end(JSON.stringify({error:{code:"fixture_protocol_failed"}}));}
 });
 await new Promise<void>((resolve,reject)=>{server!.once("error",reject);server!.listen(0,"127.0.0.1",resolve);});const address=server.address();if(!address||typeof address==="string")throw Error("provider address missing");
 fixture=await notifyFixture(false,{billingEnv:{BILLING_DEPLOYMENT:"devapp",BILLING_CATALOG_MARKET:"us",BILLING_WECHAT_ENABLED:"false",BILLING_STRIPE_ENABLED:"true",STRIPE_SECRET_KEY:key,STRIPE_WEBHOOK_SECRET:secret,STRIPE_RETURN_URL:"https://billing.example.test/billing"}});
 const wechatFetch=globalThis.fetch;vi.stubGlobal("fetch",(input:string|URL|Request,init?:RequestInit)=>{const url=new URL(input instanceof Request?input.url:String(input));return url.origin==="https://api.stripe.com"?nativeFetch(`http://127.0.0.1:${address.port}${url.pathname}${url.search}`,init):wechatFetch(input,init);});
 await ownedPricingBrowser(fixture.base,evidence,handle=>{owned=handle;});
},120000);
beforeEach(async()=>{for(const context of owned!.browser.contexts())await context.close();await cleanPersonalPricingFixtures();await fixture!.reset();sessions.clear();requests.length=0;loseCheckoutResponse=false;await asOwner(c=>c.query("UPDATE billing_pricing_epoch SET generation=$1,activated_at=clock_timestamp() WHERE singleton=true",[BILLING_ACCOUNTING_GENERATION]));});
afterAll(async()=>{try{await owned?.close();}finally{try{if(fixture){await fixture.app.get(PersonalPaymentRecoveryWorker).onModuleDestroy();await fixture.app.get(PersonalCreditPeriodWorker).onModuleDestroy();await cleanPersonalPricingFixtures();await asOwner(c=>c.query("UPDATE billing_pricing_epoch SET generation=NULL,activated_at=NULL WHERE singleton=true"));await fixture.close();}}finally{if(server){server.closeAllConnections();await new Promise<void>(r=>server!.close(()=>r()));}}}},120000);
it("buys USD monthly Pro, opens its verified portal and preserves paid rights after canceling next renewal",async()=>{
 const page=await owned!.browser.newPage({viewport:{width:1280,height:1000}}),result=await start(page,"plans"),entry=await complete(page,result.purchaseRef);
 await expect.poll(()=>page.getByTestId("pricing-quota").textContent()).toContain("20,000");expect(await page.getByTestId("pricing-renewal-note").textContent()).toContain("Stripe 自动续费");
 expect(entry.purchase.product.amountMinor).toBe(2900);await page.getByTestId("pricing-manage-subscription").click();await page.waitForURL("https://billing.stripe.com/**");expect(requests.filter(r=>r.path==="/v1/billing_portal/sessions")).toHaveLength(1);
 entry.financial!.subscription.cancel_at_period_end=true;expect((await callback("customer.subscription.updated",entry.financial!.subscription)).status).toBe(200);
 await page.goto(`${owned!.origin}/billing?subscription_management_return=1`);await expect.poll(()=>page.getByTestId("pricing-renewal-note").textContent()).toContain("已取消下一期自动续费");expect(await page.getByTestId("pricing-plan-badge").textContent()).toContain("使用中");
 const wallet=(await asOwner(c=>c.query("SELECT total_granted,balance::text FROM credit_wallets WHERE owner_type='user' AND owner_id=$1",[user]))).rows[0];expect(wallet).toEqual({total_granted:20000,balance:"20000.00"});await page.screenshot({path:resolve(evidence,"usd-month-cancel-retains-rights.png"),fullPage:true});
},120000);
it("charges USD290 annually while displaying only the first monthly 20000-credit grant",async()=>{
 const page=await owned!.browser.newPage({viewport:{width:1280,height:1000}}),result=await start(page,"plans",true),entry=await complete(page,result.purchaseRef);
 expect(entry.purchase.product.amountMinor).toBe(29000);const info=await(await fixture!.request("/billing/subscription/entitlement")).json();expect(info).toMatchObject({billingCycle:"year",renewalMode:"automatic",currentPeriodEnd:creditMonthBoundary(entry.anchor,12).toISOString(),creditGrant:{grant:{credits:20000,periodEnd:creditMonthBoundary(entry.anchor,1).toISOString()}}});
 await page.getByTestId("pricing-payment-expiry").waitFor();await page.screenshot({path:resolve(evidence,"usd-annual-account.png"),fullPage:true});
},120000);
it("buys the USD19 permanent pack once without creating a subscription or inventing a paid timestamp",async()=>{
 const page=await owned!.browser.newPage({viewport:{width:390,height:844}}),result=await start(page,"credits"),entry=await complete(page,result.purchaseRef);expect(entry.purchase.product.amountMinor).toBe(1900);
 await expect.poll(()=>page.getByTestId("pricing-wallet-balance").textContent()).toContain("10,000");const facts=await asOwner(async c=>({wallet:(await c.query("SELECT balance::text,total_purchased,total_granted FROM credit_wallets WHERE owner_type='user' AND owner_id=$1",[user])).rows[0],terms:(await c.query("SELECT count(*)::int AS n FROM billing_personal_terms WHERE user_id=$1",[user])).rows[0].n,receipt:(await c.query("SELECT paid_at FROM billing_personal_payment_receipts WHERE purchase_ref=$1",[result.purchaseRef])).rows[0]}));expect(facts).toEqual({wallet:{balance:"10000.00",total_purchased:10000,total_granted:0},terms:0,receipt:{paid_at:null}});
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);await page.screenshot({path:resolve(evidence,"usd-permanent-account.png"),fullPage:true});await page.getByRole("button",{name:"刷新订阅历史",exact:true}).click();await page.screenshot({path:resolve(evidence,"usd-permanent-mobile-history.png"),fullPage:true});writeFileSync(resolve(evidence,"receipt.json"),JSON.stringify({billingHttpIntercepted:false,productionMerchantAccepted:false,provider:"independent pinned Stripe HTTP/HMAC fixture; DevApp USD/test credentials",...facts},null,2));
},120000);
it("recovers paid Stripe after the original checkout response is lost without creating or opening another payment",async()=>{
 const page=await owned!.browser.newPage({viewport:{width:1280,height:1000}});await hosted(page);await openPersonalPricingPage(page,owned!.origin);await page.getByTestId("pricing-open-plans").click();loseCheckoutResponse=true;
 const [first]=await Promise.all([page.waitForResponse(r=>new URL(r.url()).pathname==="/__fullstack_api/billing/checkout"&&r.request().method()==="POST"),page.getByTestId("pricing-continue-checkout").click()]);expect(first.status()).toBe(503);await page.getByTestId("pricing-resume-payment").waitFor();
 const originalBody=JSON.parse(first.request().postData()!),entry=[...sessions.values()][0]!;expect(sessions.size).toBe(1);entry.paid=true;
 expect((await callback("checkout.session.completed",entry.complete)).status).toBe(200);expect((await callback("checkout.session.completed",entry.complete)).status).toBe(200);
 const before=(await asOwner(c=>c.query("SELECT balance::text,total_granted FROM credit_wallets WHERE owner_type='user' AND owner_id=$1",[user]))).rows[0];expect(before).toEqual({balance:"20000.00",total_granted:20000});
 const read=page.waitForResponse(r=>new URL(r.url()).pathname===`/__fullstack_api/billing/orders/${entry.purchase.purchaseRef}`&&r.request().method()==="GET");
 const [retry]=await Promise.all([page.waitForResponse(r=>new URL(r.url()).pathname==="/__fullstack_api/billing/checkout"&&r.request().method()==="POST"),page.getByTestId("pricing-resume-payment").click()]);expect(retry.status()).toBe(201);expect(JSON.parse(retry.request().postData()!)).toEqual(originalBody);
 expect(PersonalCheckoutResult.parse(await retry.json())).toMatchObject({purchaseRef:entry.purchase.purchaseRef,url:null,expiresAt:null});const response=await read;expect(response.status()).toBe(200);expect(await response.json()).toMatchObject({order:{status:"SUCCESS",qrCodeUrl:null,expiredAt:null}});
 await page.getByTestId("pricing-checkout-success").waitFor();expect(new URL(page.url()).origin).toBe(owned!.origin);expect(await page.getByTestId("pricing-checkout-qr").count()).toBe(0);expect(await page.getByRole("button",{name:"前往 Stripe 付款",exact:true}).count()).toBe(0);expect(requests.filter(r=>r.path==="/v1/checkout/sessions")).toHaveLength(1);
 await page.screenshot({path:resolve(evidence,"usd-paid-without-checkout-binding.png"),fullPage:true});await page.getByTestId("pricing-payment-done").click();await expect.poll(()=>page.getByTestId("pricing-quota").textContent()).toContain("20,000");
 const after=await asOwner(async c=>({wallet:(await c.query("SELECT balance::text,total_granted FROM credit_wallets WHERE owner_type='user' AND owner_id=$1",[user])).rows[0],receipts:(await c.query("SELECT count(*)::int AS n FROM billing_personal_payment_receipts WHERE purchase_ref=$1",[entry.purchase.purchaseRef])).rows[0].n}));expect(after).toEqual({wallet:before,receipts:1});
},120000);

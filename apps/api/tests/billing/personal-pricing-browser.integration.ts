// @global-scope-fixture table:credentials: only f04-order-user; notifyFixture.reset/close deletes that exact credential after modern accounting cleanup.
/** Adopted production page -> actual BillingModule/PG -> signed independent merchant fixture.
 * Only session identity display is intercepted in Chromium; no billing HTTP is mocked.
 */
import {beforeAll,beforeEach,afterAll,it,expect} from "vitest";
import type {Page} from "playwright";
import {resolve} from "node:path";
import {mkdirSync,writeFileSync} from "node:fs";
import {PersonalCheckoutResult} from "@repo/contracts/billing-pricing";
import {notifyFixture} from "./wechat-notify-fixture";
import {user} from "./order-fixture";
import {asOwner} from "../support/db";
import {cleanPersonalPricingFixtures,openPersonalPricingPage} from "../support/personal-pricing-fixtures";
import {ownedPricingBrowser} from "../support/owned-pricing-browser";
import {BILLING_ACCOUNTING_GENERATION} from "../../src/domain/billing/billing-generation";
import {creditMonthBoundary} from "../../src/domain/billing/personal-credit-calendar";
import {PersonalPaymentRecoveryWorker} from "../../src/infrastructure/billing/personal-payment-recovery-worker";
import {PersonalCreditPeriodWorker} from "../../src/infrastructure/billing/personal-credit-period-worker";
const evidence=process.env.PERSONAL_PRICING_BROWSER_EVIDENCE_DIR??resolve(import.meta.dirname,"../../../../phases/phase-21-billing-payment/design-deltas/personal-payments/evidence/real-browser");
let fixture:Awaited<ReturnType<typeof notifyFixture>>|undefined,owned:Awaited<ReturnType<typeof ownedPricingBrowser>>|undefined;
// Fixture ownership: only f04-order-user/other new financial rows; cleanup before the shared legacy fixture releases identities.
// Epoch ownership: dedicated isolated DB restored inactive after all module workers drain.
async function create(page:Page){
 const created=page.waitForResponse(r=>new URL(r.url()).pathname==="/__fullstack_api/billing/checkout"&&r.request().method()==="POST");
 await page.getByTestId("pricing-continue-checkout").click();const response=await created;expect(response.status()).toBe(201);
 const result=PersonalCheckoutResult.parse(await response.json());await page.getByTestId("pricing-checkout-qr").waitFor();
 await expect.poll(()=>page.getByTestId("pricing-checkout-qr").evaluate(element=>{const canvas=element as HTMLCanvasElement;const pixels=canvas.getContext("2d")!.getImageData(0,0,canvas.width,canvas.height).data;let dark=0;for(let i=0;i<pixels.length;i+=4)if(pixels[i]!<80&&pixels[i+3]!>0)dark++;return dark;})).toBeGreaterThan(100);
 return result;
}
async function pay(ref:string,amount:number){
 const native=fixture!.state.requests.find(r=>r.out_trade_no===ref);expect(native?.attach).toBe(`${BILLING_ACCOUNTING_GENERATION}:${ref}`);
 const payment={appid:"wx-f04-fixture",mchid:"1900000001",out_trade_no:ref,transaction_id:`tx${ref}`,trade_state:"SUCCESS",success_time:new Date().toISOString(),amount:{total:amount,currency:"CNY"},attach:native!.attach};
 fixture!.state.paidMonthly.set(ref,payment);const notice=fixture!.notice(ref,payment);
 expect((await fixture!.post(notice.body,notice.headers)).status).toBe(200);expect((await fixture!.post(notice.body,notice.headers)).status).toBe(200);
 return new Date(payment.success_time);
}
beforeAll(async()=>{mkdirSync(evidence,{recursive:true});fixture=await notifyFixture(false,{platformVerification:true});await ownedPricingBrowser(fixture.base,evidence,handle=>{owned=handle;});},120000);
beforeEach(async()=>{for(const context of owned!.browser.contexts())await context.close();await cleanPersonalPricingFixtures();await fixture!.reset();await asOwner(c=>c.query("UPDATE billing_pricing_epoch SET generation=$1,activated_at=clock_timestamp() WHERE singleton=true",[BILLING_ACCOUNTING_GENERATION]));});
afterAll(async()=>{try{await owned?.close();}finally{if(fixture){await fixture.app.get(PersonalPaymentRecoveryWorker).onModuleDestroy();await fixture.app.get(PersonalCreditPeriodWorker).onModuleDestroy();await cleanPersonalPricingFixtures();await asOwner(c=>c.query("UPDATE billing_pricing_epoch SET generation=NULL,activated_at=NULL WHERE singleton=true"));await fixture.close();}}},120000);
it("shows the actual 30-day welcome grant and buys permanent credits through real UI/API/signed merchant/PG",async()=>{
 await asOwner(c=>c.query("INSERT INTO credentials(user_id,email,display_name,password_hash) VALUES($1,$2,'Pricing payer','$2b$12$test-fixture-already-hashed')",[user,`${user}@pricing.test`]));
 const page=await owned!.browser.newPage({viewport:{width:1280,height:1000}});await openPersonalPricingPage(page,owned!.origin);
 expect(await page.getByTestId("pricing-wallet-balance").textContent()).toContain("0");expect(await page.getByTestId("pricing-quota").textContent()).toContain("1,000");
 const gift=(await asOwner(c=>c.query("SELECT p.period_start AS granted,p.period_end AS expires FROM credit_subscription_periods p JOIN credit_wallets w USING(wallet_id) WHERE w.owner_type='user' AND w.owner_id=$1 AND p.source_kind='welcome'",[user]))).rows[0];expect(gift.granted).not.toBeNull();expect(gift.expires.getTime()-gift.granted.getTime()).toBe(30*86400000);
 await page.screenshot({path:resolve(evidence,"free-actual-30-days.png"),fullPage:true});
 await page.getByTestId("pricing-buy-credits").click();expect(await page.getByTestId("pricing-renewal-note").textContent()).toContain("不自动续费");
 const result=await create(page);expect(result.renewalMode).toBe("manual");await page.screenshot({path:resolve(evidence,"credits-pending-qr.png"),fullPage:true});
 const rejected=fixture!.notice(result.purchaseRef,{amount:{total:1,currency:"CNY"}});expect((await fixture!.post(rejected.body,rejected.headers)).status).toBe(400);
 await pay(result.purchaseRef,12900);await page.getByTestId("pricing-refresh-payment").click();await page.getByTestId("pricing-checkout-success").waitFor();
 await expect.poll(()=>page.getByTestId("pricing-wallet-balance").textContent()).toContain("10,000");expect(await page.getByTestId("pricing-checkout-qr").count()).toBe(0);
 expect((await fixture!.request(`/billing/orders/${result.purchaseRef}`,undefined,"f04-other")).status).toBe(404);
 const facts=await asOwner(async c=>({receipts:(await c.query("SELECT count(*)::int AS n FROM billing_personal_payment_receipts WHERE purchase_ref=$1",[result.purchaseRef])).rows[0].n,
  wallet:(await c.query("SELECT balance::text,total_purchased FROM credit_wallets WHERE owner_type='user' AND owner_id=$1",[user])).rows[0]}));
 expect(facts).toEqual({receipts:1,wallet:{balance:"11000.00",total_purchased:10000}});
 await page.screenshot({path:resolve(evidence,"credits-confirmed.png"),fullPage:true});await page.getByTestId("pricing-payment-done").click();await page.getByTestId("pricing-wallet-balance").waitFor();await page.screenshot({path:resolve(evidence,"credits-account.png"),fullPage:true});writeFileSync(resolve(evidence,"credits-receipt.json"),JSON.stringify({billingHttpIntercepted:false,identity:"HTTP principal and identity chrome fixtures",paymentProvider:"independent RSA loopback",productionMerchantAccepted:false,...facts},null,2));
},120000);
it("buys annual Wechat Pro once and renders yearly payment expiry separately from the first monthly quota",async()=>{
 const page=await owned!.browser.newPage({viewport:{width:1280,height:1000}});await openPersonalPricingPage(page,owned!.origin);await page.getByTestId("pricing-open-plans").click();await page.getByTestId("pricing-cycle-year").click();
 expect(await page.getByTestId("pricing-total").textContent()).toContain("1,990.00");expect(await page.getByTestId("pricing-renewal-note").textContent()).toContain("手动续费");
 const result=await create(page);const anchor=await pay(result.purchaseRef,199000);await page.getByTestId("pricing-refresh-payment").click();await page.getByTestId("pricing-checkout-success").waitFor();
 await expect.poll(()=>page.getByTestId("pricing-plan-badge").textContent()).toContain("Pro");await expect.poll(()=>page.getByTestId("pricing-quota").textContent()).toContain("20,000");
 const entitlement=await(await fixture!.request("/billing/subscription/entitlement")).json();expect(entitlement).toMatchObject({plan:"pro",billingCycle:"year",renewalMode:"manual",currentPeriodEnd:creditMonthBoundary(anchor,12).toISOString(),creditGrant:{grant:{credits:20000,periodEnd:creditMonthBoundary(anchor,1).toISOString()}}});
 expect(await page.getByTestId("pricing-payment-expiry").textContent()).not.toEqual(await page.getByTestId("pricing-quota-expiry").textContent());
 const facts=await asOwner(async c=>({terms:(await c.query("SELECT count(*)::int AS n FROM billing_personal_terms WHERE user_id=$1",[user])).rows[0].n,granted:(await c.query("SELECT total_granted FROM credit_wallets WHERE owner_type='user' AND owner_id=$1",[user])).rows[0].total_granted}));expect(facts).toEqual({terms:1,granted:20000});
 await page.screenshot({path:resolve(evidence,"annual-pro-confirmed.png"),fullPage:true});await page.getByTestId("pricing-payment-done").click();await page.getByTestId("pricing-payment-expiry").waitFor();await page.screenshot({path:resolve(evidence,"annual-pro-account.png"),fullPage:true});
},120000);

import {afterAll,beforeAll,expect,it} from "vitest";
import {asOwner,ensureDatabase,migrateOnce} from "../support/db";
import {PgDatabase} from "../../src/infrastructure/db/pg-database";
import {appConfig} from "../../src/infrastructure/db/pg-config";
import {grantPaidSubscriptionPeriod} from "../../src/infrastructure/billing/pg-credit-periods";
import {createHash} from "node:crypto";
import {PgBillingStripeWebhookStore} from "../../src/infrastructure/billing/pg-billing-stripe-webhook-store";
// @global-scope-fixture table:billing_subscriptions: exact cbf-test owner IDs are removed after this isolated fixture.
// @global-scope-fixture table:credit_wallets: exact cbf-test wallets and their periods/ledger are removed after this isolated fixture.
// @global-scope-fixture table:billing_stripe_bindings: exact cbf-test subscription binding is removed after this isolated fixture.
const user="cbf-test-a",sub="sub_cbfA",price="price_cbfMonth",customer="cus_cbfA";
let db:PgDatabase;
const start=Math.floor(Date.now()/1000)-10*86400,end=start+30*86400;
const invoice={id:"in_cbfA",object:"invoice",customer,status:"paid",amount_remaining:0,currency:"usd",billing_reason:"subscription_cycle",parent:{type:"subscription_details",subscription_details:{subscription:sub}},lines:{has_more:false,data:[{quantity:1,parent:{type:"subscription_item_details",subscription_item_details:{proration:false,subscription:sub}},pricing:{type:"price_details",price_details:{price}},period:{start,end}}]}};
let state="active",interval="month",fail=false;
const provider={checkout:async()=>({}),subscription:async()=>{if(fail)throw Error("provider failure");return {id:sub,object:"subscription",customer,status:state,cancel_at_period_end:false,latest_invoice:invoice.id,items:{has_more:false,data:[{price:{id:price,recurring:{}},current_period_start:start,current_period_end:end}]}};},invoice:async()=>invoice,price:async()=>({id:price,object:"price",currency:"usd",type:"recurring",recurring:{interval,interval_count:1,usage_type:"licensed"}})};
beforeAll(async()=>{ensureDatabase();await migrateOnce();db=new PgDatabase(appConfig());await asOwner(async c=>{
 await c.query("INSERT INTO billing_subscriptions(user_id,customer_ref,subscription_ref,status,plan_ref,current_period_start,current_period_end,cancel_at_period_end,binding_generation) VALUES($1,$2,$3,'active',$4,$5,$6,false,1)",[user,customer,sub,price,new Date(start*1000),new Date(end*1000)]);
 await c.query("INSERT INTO billing_stripe_bindings(user_id,customer_ref,subscription_ref,binding_generation) VALUES($1,$2,$3,1)",[user,customer,sub]);
 await c.query("INSERT INTO credit_wallets(owner_type,owner_id,balance) VALUES('user',$1,7)",[user]);
});});
afterAll(async()=>{await asOwner(async c=>{await c.query("DELETE FROM credit_subscription_periods WHERE subscription_ref=$1",[sub]);await c.query("DELETE FROM credit_transactions WHERE wallet_id IN (SELECT wallet_id FROM credit_wallets WHERE owner_id=$1)",[user]);await c.query("DELETE FROM credit_wallets WHERE owner_id=$1",[user]);await c.query("DELETE FROM billing_webhook_events WHERE provider_event_id LIKE 'evt_creditbackfill_%'");await c.query("DELETE FROM billing_subscriptions WHERE user_id=$1",[user]);await c.query("DELETE FROM billing_stripe_bindings WHERE user_id=$1",[user]);});await db.close();});
const balance=async()=>(await asOwner(c=>c.query("SELECT balance::text FROM credit_wallets WHERE owner_id=$1",[user]))).rows[0].balance;
async function run(apply=false,plans=[price]){const {backfillSubscriptionCredits}=await import("../../src/infrastructure/billing/subscription-credit-backfill");return backfillSubscriptionCredits(db,provider,{apply,plans,after:"cbf-test-",until:"cbf-test-z",limit:1});}
it("dry-run verifies payment without touching balance, then concurrent helper/application and rerun grant once",async()=>{
 expect(await run()).toMatchObject({eligible:1,blocked:0,applied:0,nextAfter:user});expect(await balance()).toBe("7.00");
 const [report]=await Promise.all([run(true),db.withoutTenant(s=>grantPaidSubscriptionPeriod(s,{userId:user,subscriptionRef:sub,invoiceRef:invoice.id,planRef:price,periodStart:new Date(start*1000),periodEnd:new Date(end*1000)}))]);
 expect(report).toMatchObject({applied:1,blocked:0});expect(await balance()).toBe("20007.00");
 expect(await run(true)).toMatchObject({applied:1,blocked:0});expect(await balance()).toBe("20007.00");
});
it("reports unsupported plans, annual and trial before switching, and permits recovery after provider error",async()=>{
 expect(await run(false,[])).toMatchObject({blocked:1,items:[{reason:"unmapped_plan"}]});
 interval="year";expect(await run()).toMatchObject({blocked:1,items:[{reason:"unsupported_paid_period"}]});interval="month";
 state="trialing";expect(await run()).toMatchObject({blocked:1});state="active";
 fail=true;expect(await run(true)).toMatchObject({blocked:1,items:[{reason:"verification_failed"}]});fail=false;
 expect(await run(true)).toMatchObject({blocked:0});expect(await balance()).toBe("20007.00");
});
it("resumes deterministically after the last user without revisiting earlier users",async()=>{
 const {backfillSubscriptionCredits}=await import("../../src/infrastructure/billing/subscription-credit-backfill");
 expect(await backfillSubscriptionCredits(db,provider,{apply:false,plans:[price],after:user,until:"cbf-test-z",limit:1})).toMatchObject({scanned:0,nextAfter:null,blocked:0});
});
it("never fills an unpaid or historic invoice as the current entitlement",async()=>{
 invoice.status="open";expect(await run(true)).toMatchObject({blocked:1});invoice.status="paid";
 const period=invoice.lines.data[0]!.period;period.start-=30*86400;period.end-=30*86400;
 expect(await run(true)).toMatchObject({blocked:1});period.start+=30*86400;period.end+=30*86400;
 expect(await balance()).toBe("20007.00");
});
it.each([false,true])("blocks unresolved bindings even with an absent/terminal subscription snapshot (%s)",async terminal=>{
 await asOwner(async c=>{
  if(terminal)await c.query("UPDATE billing_subscriptions SET status='canceled' WHERE user_id=$1",[user]);else await c.query("DELETE FROM billing_subscriptions WHERE user_id=$1",[user]);
  await c.query("INSERT INTO billing_stripe_bindings(user_id,customer_ref,subscription_ref,binding_generation,synchronization_uncertain) VALUES($1,$2,'sub_cbfUnresolved',2,true)",[user,customer]);
 });
 try{expect(await run()).toMatchObject({scanned:1,blocked:1,items:[{reason:"unresolved_binding"}]});}
 finally{await asOwner(async c=>{await c.query("DELETE FROM billing_stripe_bindings WHERE subscription_ref='sub_cbfUnresolved'");await c.query("INSERT INTO billing_subscriptions(user_id,customer_ref,subscription_ref,status,plan_ref,current_period_start,current_period_end,cancel_at_period_end,binding_generation) VALUES($1,$2,$3,'active',$4,$5,$6,false,1) ON CONFLICT(user_id) DO UPDATE SET status='active'",[user,customer,sub,price,new Date(start*1000),new Date(end*1000)]);});}
});
it("blocks a no-grant locked reread and recovers the same invoice even after a legacy ok audit",async()=>{
 const raceUser="cbf-test-race",raceSub="sub_cbfRace",raceCustomer="cus_cbfRace",invoiceId="in_cbfRace";
 const raceInvoice={...invoice,id:invoiceId,customer:raceCustomer,parent:{type:"subscription_details",subscription_details:{subscription:raceSub}},lines:{...invoice.lines,data:invoice.lines.data.map(line=>({...line,parent:{type:"subscription_item_details",subscription_item_details:{proration:false,subscription:raceSub}}}))}};
 let racing=true,reads=0;
 const raceProvider={...provider,invoice:async()=>raceInvoice,subscription:async()=>({...await provider.subscription(),id:raceSub,customer:raceCustomer,latest_invoice:invoiceId,status:racing&&++reads>1?"trialing":"active"})};
 const event={id:"evt_creditbackfill_"+createHash("sha256").update(`${raceSub}:${invoiceId}`).digest("hex"),type:"invoice.paid",object:{id:invoiceId}};
 const {backfillSubscriptionCredits}=await import("../../src/infrastructure/billing/subscription-credit-backfill");
 const reconcile=()=>backfillSubscriptionCredits(db,raceProvider,{apply:true,plans:[price],after:"cbf-test-r",until:"cbf-test-s",limit:1});
 await asOwner(async c=>{
  await c.query("INSERT INTO billing_subscriptions(user_id,customer_ref,subscription_ref,status,plan_ref,current_period_start,current_period_end,cancel_at_period_end,binding_generation) VALUES($1,$2,$3,'active',$4,$5,$6,false,1)",[raceUser,raceCustomer,raceSub,price,new Date(start*1000),new Date(end*1000)]);
  await c.query("INSERT INTO billing_stripe_bindings(user_id,customer_ref,subscription_ref,binding_generation) VALUES($1,$2,$3,1)",[raceUser,raceCustomer,raceSub]);
  await c.query("INSERT INTO credit_wallets(owner_type,owner_id,balance) VALUES('user',$1,7)",[raceUser]);
 });
 try{
  expect(await reconcile()).toMatchObject({blocked:1,applied:0,nextAfter:raceUser});
  expect((await asOwner(c=>c.query("SELECT count(*)::int AS n FROM billing_webhook_events WHERE provider_event_id=$1",[event.id]))).rows[0].n).toBe(0);
  // Older code could already have committed an ok event without granting. Recover that exact ID.
  expect(await new PgBillingStripeWebhookStore(db).apply(event,raceProvider)).toBe(true);
  racing=false;
  expect(await reconcile()).toMatchObject({blocked:0,applied:1});
  expect(await reconcile()).toMatchObject({blocked:0,applied:1});
  expect((await asOwner(c=>c.query("SELECT balance::text FROM credit_wallets WHERE owner_id=$1",[raceUser]))).rows[0].balance).toBe("20007.00");
 }finally{await asOwner(async c=>{
  await c.query("DELETE FROM credit_subscription_periods WHERE subscription_ref=$1",[raceSub]);
  await c.query("DELETE FROM credit_transactions WHERE wallet_id IN (SELECT wallet_id FROM credit_wallets WHERE owner_id=$1)",[raceUser]);
  await c.query("DELETE FROM credit_wallets WHERE owner_id=$1",[raceUser]);
  await c.query("DELETE FROM billing_webhook_events WHERE provider_event_id=$1",[event.id]);
  await c.query("DELETE FROM billing_subscriptions WHERE user_id=$1",[raceUser]);
  await c.query("DELETE FROM billing_stripe_bindings WHERE user_id=$1",[raceUser]);
 });}
});

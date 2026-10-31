// Runtime-owned monthly orders: only exact recorded fixture users are removed.
// @global-scope-fixture table:credit_wallets: exact recorded fixture users; dependent periods and transactions removed first.
import {afterAll,beforeAll,expect,it} from "vitest";
import {randomUUID} from "node:crypto";
import {ensureDatabase,migrateOnce,asOwner} from "../support/db";
import {PgDatabase} from "../../src/infrastructure/db/pg-database";
import {appConfig} from "../../src/infrastructure/db/pg-config";
import {toOrgId} from "../../src/domain/org-id";
import {PgBillingSubscriptionRepository} from "../../src/infrastructure/billing/pg-billing-subscription-repository";
import {PgMonthlyPassRepository} from "../../src/infrastructure/billing/pg-monthly-pass-repository";
import {monthlyPassEnd,validateMonthlyCheckout} from "../../src/application/billing/monthly-pass-service";
const db=new PgDatabase(appConfig()), repo=new PgMonthlyPassRepository(db), owners:string[]=[];
const principal=()=>{const userId=`monthly-6038-${randomUUID()}`;owners.push(userId);return {userId,orgId:toOrgId("monthly-6038")};};
beforeAll(async()=>{ensureDatabase();await migrateOnce();},120_000);
afterAll(async()=>{await asOwner(async c=>{
  await c.query("DELETE FROM billing_payment_conflicts WHERE user_id=ANY($1::text[])",[owners]);
  await c.query("DELETE FROM billing_subscriptions WHERE user_id=ANY($1::text[])",[owners]);
  await c.query("DELETE FROM billing_monthly_orders WHERE user_id=ANY($1::text[])",[owners]);
  await c.query("DELETE FROM credit_subscription_periods WHERE wallet_id IN (SELECT wallet_id FROM credit_wallets WHERE owner_id=ANY($1::text[]))",[owners]);
  await c.query("DELETE FROM credit_transactions WHERE wallet_id IN (SELECT wallet_id FROM credit_wallets WHERE owner_id=ANY($1::text[]))",[owners]);
  await c.query("DELETE FROM credit_wallets WHERE owner_id=ANY($1::text[])",[owners]);
});await db.close();});
const paid=(id:string,session="cs_test_6038")=>({id:session,object:"checkout.session",mode:"payment",status:"complete",payment_status:"paid",amount_total:18000,currency:"cny",livemode:false,client_reference_id:id,metadata:{product:"monthly_pass_v1",order_ref:id},payment_intent:`pi_${id.replaceAll("-","")}`});
it("clamps a calendar month at month end without dropping time",()=>{
 expect(monthlyPassEnd(new Date("2026-01-31T12:34:56Z")).toISOString()).toBe("2026-02-28T12:34:56.000Z");
 expect(monthlyPassEnd(new Date("2028-01-31T12:34:56Z")).toISOString()).toBe("2028-02-29T12:34:56.000Z");
 expect(monthlyPassEnd(new Date("2026-12-30T23:59:59Z")).toISOString()).toBe("2027-01-30T23:59:59.000Z");
});
it.each([{amount_total:17999},{amount_total:20000},{currency:"usd"},{livemode:true},{mode:"subscription"},{payment_status:"unpaid"},{client_reference_id:"other"},{subscription:"sub_wrong"}])("rejects mismatched payment facts %j",patch=>{
 const session={...paid("order"),...patch};expect(()=>validateMonthlyCheckout(session,"order",false)).toThrow();
});
it("serializes cross-tab checkout creation to one durable order",async()=>{
 const p=principal();const orders=await Promise.all([repo.reserve(p),repo.reserve(p),repo.reserve(p)]);
 expect(new Set(orders.map(o=>o.orderId)).size).toBe(1);
 expect((await repo.latest(p))?.state).toBe("pending");
});
it("binds checkout to the principal and grants once for duplicate deliveries",async()=>{
 const p=principal(),o=await repo.reserve(p),session=paid(o.orderId,`cs_${randomUUID().replaceAll("-","")}`);
 await expect(repo.bind(principal(),o.orderId,session.id)).rejects.toThrow();
 await repo.bind(p,o.orderId,session.id);
 await Promise.all([repo.settle(o.orderId,session),repo.settle(o.orderId,session)]);
 const pass=await repo.latest(p);expect(pass?.state).toBe("paid");
 const snapshot=await asOwner(c=>c.query("SELECT amount_minor::text,currency FROM billing_monthly_orders WHERE order_id=$1",[o.orderId]));expect(snapshot.rows).toEqual([{amount_minor:"18000",currency:"CNY"}]);
 const history=await new PgBillingSubscriptionRepository(db,{info(){},error(){}}).history(p,{limit:5,offset:0});expect(history.items).toHaveLength(1);expect(history.items[0]).toMatchObject({amountMinor:18000,currency:"CNY",item:"Pro 月度订阅"});
 const balances=await asOwner(c=>c.query("SELECT balance::text,total_granted FROM credit_wallets WHERE owner_type='user' AND owner_id=$1",[p.userId]));
 expect(balances.rows).toEqual([{balance:"20000.00",total_granted:20000}]);
 await expect(repo.reserve(p)).rejects.toThrow("already_subscribed");
 expect(await repo.latest(principal())).toBeNull();
});
it("never grants a different Checkout or reassigns a paid order",async()=>{
 const p=principal(),o=await repo.reserve(p),session=paid(o.orderId,`cs_${randomUUID().replaceAll("-","")}`);
 await repo.bind(p,o.orderId,session.id);
 await expect(repo.settle(o.orderId,{...session,id:"cs_other"})).rejects.toThrow();
 expect((await repo.latest(p))?.state).toBe("pending");
});
it("retains permanent credit and expires the pass without waiting for a Stripe cancellation",async()=>{
 const p=principal();await asOwner(c=>c.query("INSERT INTO credit_wallets(owner_type,owner_id,balance) VALUES('user',$1,7)",[p.userId]));
 const o=await repo.reserve(p),session=paid(o.orderId,`cs_${randomUUID().replaceAll("-","")}`);await repo.bind(p,o.orderId,session.id);await repo.settle(o.orderId,session);
 const result=await asOwner(async c=>{
  await c.query("UPDATE billing_monthly_orders SET period_start=period_start-interval '2 months',period_end=period_end-interval '2 months' WHERE order_id=$1",[o.orderId]);
  await c.query("UPDATE credit_subscription_periods SET period_start=period_start-interval '2 months',period_end=period_end-interval '2 months' WHERE subscription_ref=$1",[`pass_${o.orderId}`]);
 });void result;
 const pass=await repo.latest(p);expect(pass?.periodEnd?.getTime()).toBeLessThan(Date.now());
 expect((await repo.reserve(p)).orderId).not.toBe(o.orderId);
 const {PgBillingWalletRepository}=await import("../../src/infrastructure/billing/pg-billing-wallet-repository");
 expect((await new PgBillingWalletRepository(db).wallet({orgId:p.orgId,ownerType:"user",ownerId:p.userId})).wallet).toMatchObject({balance:7,permanentBalance:7,subscriptionCredits:0});
});

// @global-scope-fixture table:billing_subscriptions: exact recorded owners are removed by afterAll.
it("defers a manual payment if a historical recurring payment wins the user lock",async()=>{
 const p=principal(),o=await repo.reserve(p),session=paid(o.orderId,`cs_${randomUUID().replaceAll("-","")}`);await repo.bind(p,o.orderId,session.id);
 await asOwner(c=>c.query("INSERT INTO billing_subscriptions(user_id,subscription_ref,status,current_period_end) VALUES($1,$2,'active',now()+interval '1 month')",[p.userId,`sub_${o.orderId}`]));
 await expect(repo.settle(o.orderId,session)).rejects.toThrow("dependency_unavailable");
 expect((await asOwner(c=>c.query("SELECT 1 FROM billing_payment_conflicts WHERE user_id=$1",[p.userId]))).rows).toHaveLength(1);
 expect((await asOwner(c=>c.query("SELECT 1 FROM credit_wallets WHERE owner_id=$1",[p.userId]))).rows).toHaveLength(0);
 await expect(repo.reserve(p)).rejects.toThrow();
});

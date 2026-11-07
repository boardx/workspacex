import {afterAll,beforeAll,expect,it} from "vitest";
import {randomUUID} from "node:crypto";
import {ensureDatabase,migrateOnce,asOwner} from "../support/db";
import {PgDatabase} from "../../src/infrastructure/db/pg-database";
import {appConfig} from "../../src/infrastructure/db/pg-config";
import {toOrgId} from "../../src/domain/org-id";
import {PgMonthlyPassRepository} from "../../src/infrastructure/billing/pg-monthly-pass-repository";
import {validateMonthlyCheckout} from "../../src/application/billing/monthly-pass-service";
const db=new PgDatabase(appConfig()),repo=new PgMonthlyPassRepository(db),users:string[]=[];
const principal=()=>{const userId=`monthly-wechat-${randomUUID()}`;users.push(userId);return {userId,orgId:toOrgId("monthly-wechat-fixture")};};
beforeAll(async()=>{ensureDatabase();await migrateOnce();},120_000);
afterAll(async()=>{await asOwner(async s=>{
 for(const table of ["billing_payment_conflicts","billing_monthly_orders"])await s.query(`DELETE FROM ${table} WHERE user_id=ANY($1::text[])`,[users]);
 for(const table of ["credit_subscription_periods","credit_transactions"])await s.query(`DELETE FROM ${table} WHERE wallet_id IN (SELECT wallet_id FROM credit_wallets WHERE owner_id=ANY($1::text[]))`,[users]);
 await s.query("DELETE FROM credit_wallets WHERE owner_id=ANY($1::text[])",[users]);
});await db.close();});
it("reserves a WeChat identity before network and grants a calendar month exactly once",async()=>{
 const p=principal(),o=await repo.reserve(p,"wechat");
 expect(o.provider).toBe("wechat");expect(o.sessionRef).toMatch(/^bm\d{14}[A-Za-z0-9]{6}$/);
 const session={object:"checkout.session",mode:"payment",status:"complete",payment_status:"paid",livemode:true,
  id:o.sessionRef,payment_intent:`wx_${randomUUID().replaceAll("-","")}`,amount_total:18000,currency:"cny",client_reference_id:o.orderId,
  metadata:{product:"monthly_pass_v1",order_ref:o.orderId,provider:"wechat"}};
 expect(()=>validateMonthlyCheckout(session,o.orderId,true,"wechat")).not.toThrow();
 await expect(repo.settle(o.orderId,{...session,amount_total:1})).rejects.toThrow();
 await expect(repo.settle(o.orderId,{...session,id:"cs_wrong",metadata:{...session.metadata,provider:"stripe"}})).rejects.toThrow();
 await Promise.all([repo.settle(o.orderId,session),repo.settle(o.orderId,session)]);
 expect(await repo.latest(p)).toMatchObject({state:"paid",remainingCredits:20000});
 expect((await asOwner(s=>s.query("SELECT balance::text FROM credit_wallets WHERE owner_id=$1",[p.userId]))).rows).toEqual([{balance:"20000.00"}]);
 await expect(repo.reserve(p,"stripe")).rejects.toThrow("already_subscribed");
});
it("refuses cross-provider switching while a payment outcome is unknown",async()=>{
 const p=principal(),o=await repo.reserve(p,"wechat");
 expect((await repo.reserve(p,"wechat")).orderId).toBe(o.orderId);
 await expect(repo.reserve(p,"stripe")).rejects.toThrow("dependency_unavailable");
});

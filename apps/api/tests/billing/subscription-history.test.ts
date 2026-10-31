// @global-scope-fixture table:billing_monthly_orders: exact history-6054 fixture users, cleanup removes their orders only.
// @global-scope-fixture table:billing_subscriptions: exact random legacy-history users, each case deletes its snapshot in finally.
import {afterAll,beforeAll,expect,it} from "vitest";
import {randomUUID} from "node:crypto";
import {ensureDatabase,migrateOnce,asOwner} from "../support/db";
import {PgDatabase} from "../../src/infrastructure/db/pg-database";
import {appConfig} from "../../src/infrastructure/db/pg-config";
import {toOrgId} from "../../src/domain/org-id";
import {PgBillingSubscriptionRepository} from "../../src/infrastructure/billing/pg-billing-subscription-repository";
import {operations} from "@repo/contracts/billing-subscription";
const db=new PgDatabase(appConfig()),repo=new PgBillingSubscriptionRepository(db,{error(){},info(){}});
const users=[`history-6054-${randomUUID()}`,`history-6054-${randomUUID()}`];
const principal=(i=0)=>({orgId:toOrgId('history-6054'),userId:users[i]!});
beforeAll(async()=>{ensureDatabase();await migrateOnce();await asOwner(async c=>{
 for(const [i,u] of users.entries())for(let n=0;n<2;n++)await c.query(`INSERT INTO billing_monthly_orders(order_id,user_id,state,session_ref,payment_ref,period_start,period_end,amount_minor,currency) VALUES($1,$2,'paid',$3,$4,$5,$6,$7,$8)`,[randomUUID(),u,`cs_${i}${n}_${randomUUID().replaceAll('-','')}`,`pi_${i}${n}_${randomUUID().replaceAll('-','')}`,`2026-0${n+1}-01T00:00:00Z`,`2026-0${n+2}-01T00:00:00Z`,n?18000:null,n?'CNY':null]);
});},120000);
afterAll(async()=>{await asOwner(c=>c.query('DELETE FROM billing_monthly_orders WHERE user_id=ANY($1::text[])',[users]));await db.close();});
it('scopes history to authenticated user, sorts and paginates without provider references',async()=>{
 const first=await repo.history(principal(),{limit:1,offset:0});expect(first.hasMore).toBe(true);expect(first.items).toHaveLength(1);expect(first.items[0]).toMatchObject({item:'Pro 月度订阅',amountMinor:18000,currency:'CNY',periodStart:'2026-02-01T00:00:00.000Z'});
 const second=await repo.history(principal(),{limit:1,offset:1});expect(second.hasMore).toBe(false);expect(second.items[0]).toMatchObject({amountMinor:null,currency:null});
 const other=await repo.history(principal(1),{limit:20,offset:0});expect(other.items.every(x=>!first.items.some(y=>y.id===x.id))).toBe(true);expect(JSON.stringify(first)).not.toMatch(/pi_|cs_|user_id/);
});
it('rejects owner spoofing and invalid page sizes',()=>{
 expect(operations.getSubscriptionHistory.in.safeParse({userId:users[1]}).success).toBe(false);
 expect(operations.getSubscriptionHistory.in.safeParse({limit:'101'}).success).toBe(false);
 expect(operations.getSubscriptionHistory.in.safeParse({offset:'-1'}).success).toBe(false);
});
it('retains a confirmed legacy subscription when cancellation completes',async()=>{
 const userId=`legacy-history-${randomUUID()}`,owner={...principal(),userId};
 try{
  await asOwner(c=>c.query("INSERT INTO billing_subscriptions(user_id,subscription_ref,status,current_period_start,current_period_end) VALUES($1,$2,'active','2026-01-01Z','2026-02-01Z')",[userId,`sub_${randomUUID()}`]));
  const active=await repo.history(owner,{limit:5,offset:0});expect(active.items).toHaveLength(1);
  await asOwner(c=>c.query("UPDATE billing_subscriptions SET status='canceled' WHERE user_id=$1",[userId]));
  const canceled=await repo.history(owner,{limit:5,offset:0});expect(canceled).toEqual(active);
  expect(canceled.items[0]).toMatchObject({item:'Pro 订阅',periodStart:'2026-01-01T00:00:00.000Z',periodEnd:'2026-02-01T00:00:00.000Z',amountMinor:null,currency:null});
  expect((await repo.history(principal(),{limit:100,offset:0})).items).not.toContainEqual(canceled.items[0]);
 }finally{await asOwner(c=>c.query('DELETE FROM billing_subscriptions WHERE user_id=$1',[userId]));}
});
it.each(['incomplete','incomplete_expired'])('excludes unconfirmed legacy subscription %s',async status=>{
 const userId=`legacy-history-${randomUUID()}`;
 try{
  await asOwner(c=>c.query('INSERT INTO billing_subscriptions(user_id,subscription_ref,status) VALUES($1,$2,$3)',[userId,`sub_${randomUUID()}`,status]));
  expect(await repo.history({...principal(),userId},{limit:5,offset:0})).toEqual({items:[],hasMore:false});
 }finally{await asOwner(c=>c.query('DELETE FROM billing_subscriptions WHERE user_id=$1',[userId]));}
});

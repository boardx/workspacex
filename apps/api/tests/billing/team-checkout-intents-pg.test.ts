// @global-scope-fixture table:billing_personal_purchases: cross-owner claim probe uses a random exact purchase ref and deletes it in its finally block.
// @global-scope-fixture table:credit_wallets: legacy paid-period claim probe uses an exact user wallet and deletes it in its finally block.
import {readFileSync} from "node:fs";
import {randomUUID} from "node:crypto";
import {afterAll,beforeAll,expect,it,vi} from "vitest";
import {ensureDatabase,migrateOnce,seedOrg,addOrgMember,asOwner,asApp} from "../support/db";
import {PgDatabase} from "../../src/infrastructure/db/pg-database";
import {appConfig} from "../../src/infrastructure/db/pg-config";
import {toOrgId} from "../../src/domain/org-id";
import {TEAM_CHECKOUT_UNRESERVED_ERRORS} from "@repo/contracts/billing-team";
import {TeamCheckoutService} from "../../src/application/billing/team-checkout-service";
import {PgTeamPaymentRepository} from "../../src/infrastructure/billing/pg-team-payment-repository";
import {PgTeamCheckoutRepository} from "../../src/infrastructure/billing/pg-team-checkout-repository";
import {BILLING_ACCOUNTING_GENERATION as generation} from "../../src/domain/billing/billing-generation";
const org=toOrgId(`team-buy-${randomUUID().slice(0,8)}`),user=`${org}-admin`,db=new PgDatabase(appConfig());
const principal={orgId:org,userId:user};
const access={authorize:async()=>org};
const repo=new PgTeamCheckoutRepository(db,access as never,()=>true);
const requests:string[]=[];
let originalRef="",originalKey="";
const verifiedUnreserved:string[]=[];
beforeAll(async()=>{ensureDatabase();await migrateOnce();await seedOrg({orgId:org,kind:"organization",ownerUserId:user,projectId:`${org}-project`});await addOrgMember(org,user,"admin",null);await asOwner(c=>c.query("UPDATE billing_pricing_epoch SET generation=$1,activated_at=clock_timestamp() WHERE singleton=true",[generation]));});
afterAll(async()=>{await asOwner(async c=>{
 await c.query("DELETE FROM credit_transactions WHERE wallet_id IN (SELECT wallet_id FROM credit_wallets WHERE owner_type='team' AND owner_id=$1)",[org]);await c.query("DELETE FROM credit_subscription_periods WHERE wallet_id IN (SELECT wallet_id FROM credit_wallets WHERE owner_type='team' AND owner_id=$1)",[org]);await c.query("DELETE FROM credit_wallets WHERE owner_type='team' AND owner_id=$1",[org]);
 await c.query("DELETE FROM billing_team_receipts WHERE org_id=$1",[org]);await c.query("DELETE FROM billing_team_terms WHERE org_id=$1",[org]);await c.query("DELETE FROM billing_team_purchases WHERE org_id=$1",[org]);await c.query("DELETE FROM billing_team_quotes WHERE org_id=$1",[org]);await c.query("DELETE FROM org_commercial_licenses WHERE org_id=$1",[org]);await c.query("UPDATE billing_pricing_epoch SET generation=NULL,activated_at=NULL WHERE singleton=true");
});await db.close();});
async function quote(){
 const quoteRef=`q-${randomUUID()}`,now=new Date(),q={orgId:org,generation,quoteRef,catalogVersion:"frozen-catalog",sku:"team-month",provider:"wechat",currency:"CNY",amountMinor:12345,createdAt:now.toISOString(),expiresAt:new Date(now.getTime()+300000).toISOString(),purpose:"initial",seats:5,monthlyCredits:100000,billingCycle:"month",renewalMode:"manual",planVersion:0};
 await asOwner(c=>c.query("INSERT INTO billing_team_quotes(quote_ref,org_id,generation,quote,created_at,expires_at) VALUES($1,$2,$3,$4,$5,$6)",[quoteRef,org,generation,q,now,q.expiresAt]));
 requests.push(quoteRef);return {quoteRef,idempotencyKey:`key-${randomUUID()}`};
}
it("concurrent original key creates one frozen intent and pending capacity",async()=>{
 const input=await quote();originalKey=input.idempotencyKey;
 const extras=Array.from({length:5},(_,i)=>`${org}-capacity-${i}`);
 for(const id of extras)await addOrgMember(org,id,"consultant",null);
 try{
  await expect(repo.reserve(principal,org,input)).rejects.toThrow("capacity_insufficient");
  expect(await asOwner(async c=>(await c.query("SELECT count(*)::int AS n FROM billing_team_purchases WHERE org_id=$1",[org])).rows[0].n)).toBe(0);
  expect(await asOwner(async c=>(await c.query("SELECT count(*)::int AS n FROM org_commercial_licenses WHERE org_id=$1",[org])).rows[0].n)).toBe(0);
  verifiedUnreserved.push("capacity_insufficient");
 }finally{await asOwner(c=>c.query("DELETE FROM org_memberships WHERE org_id=$1 AND user_id=ANY($2::text[])",[org,extras]));}
 const items=await Promise.all([repo.reserve(principal,org,input),repo.reserve(principal,org,input)]);
 originalRef=items[0].purchaseRef;
 expect(items[0].purchaseRef).toBe(items[1].purchaseRef);
 expect(items[0].quote.amountMinor).toBe(12345);
 expect(await asApp(org,async c=>(await c.query("SELECT pending_purchase_ref FROM org_commercial_licenses WHERE org_id=$1",[org])).rows[0].pending_purchase_ref)).toBe(items[0].purchaseRef);
 await expect(repo.reserve(principal,org,{...input,quoteRef:"wrong"})).rejects.toThrow("idempotency_conflict");
 await expect(asApp(org,c=>c.query("UPDATE billing_team_purchases SET quote='{}' WHERE purchase_ref=$1",[items[0].purchaseRef]))).rejects.toThrow(/permission denied/);
 await expect(repo.reserve(principal,org,await quote())).rejects.toThrow("commercial_change_pending");
});
it("a non-admin cannot reserve even when reaching the transaction directly",async()=>{
 await expect(repo.reserve({...principal,userId:"outsider"},org,await quote())).rejects.toThrow("forbidden");
});

it("settles one real payment once and rejects its reuse in a personal receipt",async()=>{
 const paidAt=new Date();
 const payments=new PgTeamPaymentRepository(db);
 const proof={provider:"wechat" as const,purchaseRef:originalRef,paymentRef:`wx_${org.replaceAll("-","")}`,amountMinor:12345,currency:"CNY",paidAt};
 const results=await Promise.all([payments.settle(org,proof),payments.settle(org,proof)]);
 expect(results).toEqual([{completed:true,manual:false},{completed:true,manual:false}]);
 const outcome=await repo.result(org,originalRef);
 expect(outcome.status).toBe("SUCCESS");expect(outcome.fulfillment?.firstCreditsApplied).toBe(100000);
 expect(outcome.fulfillment?.ledgerRef).toBeTruthy();
 expect(await asOwner(async c=>(await c.query("SELECT count(*)::int AS n FROM credit_transactions t JOIN credit_wallets w USING(wallet_id) WHERE w.owner_type='team' AND w.owner_id=$1 AND t.type='subscription_grant'",[org])).rows[0].n)).toBe(1);
 const ref=`bp${randomUUID().replaceAll("-","").slice(0,25)}`;
 await asOwner(c=>c.query("INSERT INTO billing_personal_purchases(purchase_ref,user_id,idempotency_key,generation,catalog_version,provider,product) VALUES($1,$2,$3,$4,'fixture','wechat','{}')",[ref,user,`personal-${randomUUID()}`,generation]));
 try{await expect(asOwner(c=>c.query("INSERT INTO billing_personal_payment_receipts(provider,payment_ref,purchase_ref,amount_minor,currency,paid_at) VALUES('wechat',$1,$2,12345,'CNY',$3)",[proof.paymentRef,ref,paidAt]))).rejects.toThrow("payment_claim_owner_conflict");}
 finally{await asOwner(c=>c.query("DELETE FROM billing_personal_purchases WHERE purchase_ref=$1",[ref]));}
});

it("mechanically rejects the same real Team cash through legacy monthly and order lanes",async()=>{
 const paymentRef=`wx_${org.replaceAll("-","")}`;
 await expect(asOwner(c=>c.query("INSERT INTO billing_monthly_orders(order_id,user_id,state,provider,payment_ref,period_start,period_end) VALUES($1,$2,'paid','wechat',$3,now(),now()+interval '1 month')",[randomUUID(),user,paymentRef]))).rejects.toThrow("payment_claim_owner_conflict");
 await expect(asOwner(c=>c.query("INSERT INTO billing_orders(order_no,owner_type,owner_id,created_by,package_id,amount_fen,base_credits,currency,provider,status,qr_code_url,channel_order_no,expired_at) VALUES('bg20261102010000ABC123','user',$1,$1,'credit-cn-10000-v1',12900,10000,'CNY','wechat','SUCCESS','weixin://fixture',$2,now()+interval '1 hour')",[user,paymentRef.slice(3)]))).rejects.toThrow("payment_claim_owner_conflict");
});

it("rejects a legacy paid-period reuse and replays both new migrations over paid facts",async()=>{
 const wallet=await asOwner(async c=>(await c.query("INSERT INTO credit_wallets(owner_type,owner_id) VALUES('user',$1) RETURNING wallet_id",[user])).rows[0].wallet_id);
 try{await expect(asOwner(c=>c.query("INSERT INTO credit_subscription_periods(wallet_id,subscription_ref,invoice_ref,plan_ref,period_start,period_end,granted_hundredths,remaining_hundredths) VALUES($1,'legacy-sub',$2,'sku',now(),now()+interval '1 month',10000,10000)",[wallet,`wx_${org.replaceAll("-","")}`]))).rejects.toThrow("payment_claim_owner_conflict");}
 finally{await asOwner(c=>c.query("DELETE FROM credit_wallets WHERE wallet_id=$1",[wallet]));}
 const migrations=["20261102070000_team_purchase_core.sql","20261102071000_payment_claim_ownership.sql","20261102072000_team_product_seed.sql"];
 for(let replay=0;replay<2;replay++)for(const file of migrations){const sql=readFileSync(new URL(`../../migrations/${file}`,import.meta.url),"utf8");await asOwner(c=>c.query(sql));}
 expect((await repo.result(org,originalRef)).status).toBe("SUCCESS");
});

// Mutate a seeded default only within a rolled-back owner transaction; seed replay preserves operator changes.
it("seed replay never overwrites configured Team money",async()=>{
 const seed=readFileSync(new URL("../../migrations/20261102072000_team_product_seed.sql",import.meta.url),"utf8");
 await asOwner(async c=>{await c.query("BEGIN");try{
  await c.query("UPDATE credit_packages SET amount_fen=77777 WHERE package_id='team-cn-month-v1'");await c.query(seed);await c.query(seed);
  expect((await c.query("SELECT amount_fen FROM credit_packages WHERE package_id='team-cn-month-v1'")).rows[0].amount_fen).toBe(77777);
 }finally{await c.query("ROLLBACK");}});
});

it("only no-reference checkout refusals are classified unreserved and never call a merchant or create financial facts",async()=>{
 const merchant={provider:"wechat",enabled:()=>true,createCheckout:vi.fn(async()=>{throw Error("merchant must not be called");})};
 const service=(r:PgTeamCheckoutRepository)=>new TeamCheckoutService(r,merchant as never);
 const expired=new PgTeamCheckoutRepository(db,access as never,()=>false,()=>new Date(Date.now()+3600000));
 async function reject(r:PgTeamCheckoutRepository,quoteRef:string,code:string){
  const key=`unreserved-${randomUUID()}`;
  await expect(service(r).checkout(principal,org,{quoteRef,idempotencyKey:key})).rejects.toThrow(code);
  expect(await asOwner(async c=>(await c.query("SELECT count(*)::int AS n FROM billing_team_purchases WHERE org_id=$1 AND idempotency_key=$2",[org,key])).rows[0].n)).toBe(0);
  expect(merchant.createCheckout).not.toHaveBeenCalled();verifiedUnreserved.push(code);
 }
 const originalQuoteRef=requests[0];if(!originalQuoteRef)throw Error("fixture initial quote missing");
 const expiredForNew=new PgTeamCheckoutRepository(db,access as never,()=>true,()=>new Date(Date.now()+3600000));
 await reject(expiredForNew,originalQuoteRef,"quote_expired");
 await reject(repo,originalQuoteRef,"PLAN_VERSION_CONFLICT");
 await asOwner(c=>c.query("UPDATE organization_plans SET plan='enterprise',version=2 WHERE org_id=$1",[org]));
 try{await reject(repo,originalQuoteRef,"unsupported_plan_transition");}
 finally{await asOwner(c=>c.query("UPDATE organization_plans SET plan='ordinary',version=1 WHERE org_id=$1",[org]));}
 const qref=`q-${randomUUID()}`;
 await asOwner(async c=>{
  const old=(await c.query("SELECT quote FROM billing_team_quotes WHERE quote_ref=$1",[originalQuoteRef])).rows[0].quote;
  const now=new Date(),renewal={...old,quoteRef:qref,purpose:"renewal",planVersion:1,createdAt:now.toISOString(),expiresAt:new Date(now.getTime()+300000).toISOString()};
  await c.query("INSERT INTO billing_team_quotes(quote_ref,org_id,generation,quote,created_at,expires_at) VALUES($1,$2,$3,$4,$5,$6)",[qref,org,generation,renewal,now,renewal.expiresAt]);
  await c.query("UPDATE org_commercial_licenses SET pending_seats=5,pending_purchase_ref='another-owned-operation' WHERE org_id=$1",[org]);
 });
 try{await reject(repo,qref,"commercial_change_pending");}
 finally{await asOwner(c=>c.query("UPDATE org_commercial_licenses SET pending_seats=NULL,pending_purchase_ref=NULL WHERE org_id=$1",[org]));}
 await reject(repo,qref,"already_subscribed");
 expect(new Set(verifiedUnreserved)).toEqual(new Set(TEAM_CHECKOUT_UNRESERVED_ERRORS));
 const replay=await service(expired).checkout(principal,org,{quoteRef:originalQuoteRef,idempotencyKey:originalKey});
 expect(replay).toMatchObject({purchaseRef:originalRef,status:"SUCCESS"});expect(merchant.createCheckout).not.toHaveBeenCalled();
 expect(await asOwner(async c=>(await c.query("SELECT count(*)::int AS n FROM billing_team_receipts WHERE org_id=$1",[org])).rows[0].n)).toBe(1);
 expect(await asOwner(async c=>(await c.query("SELECT count(*)::int AS n FROM credit_transactions t JOIN credit_wallets w USING(wallet_id) WHERE w.owner_type='team' AND w.owner_id=$1 AND t.type='subscription_grant'",[org])).rows[0].n)).toBe(1);
});

// @global-scope-fixture table:credit_wallets: unique personal wallet owners, their periods and transactions are cleaned in afterAll.
import {randomUUID} from "node:crypto";
import {beforeAll,afterAll,expect,it} from "vitest";
import {ensureDatabase,migrateOnce,seedOrg,addOrgMember,asOwner} from "../support/db";
import {PgDatabase} from "../../src/infrastructure/db/pg-database";
import {appConfig} from "../../src/infrastructure/db/pg-config";
import {toOrgId} from "../../src/domain/org-id";
import {BILLING_ACCOUNTING_GENERATION as generation} from "../../src/domain/billing/billing-generation";
import {PgTeamCheckoutRepository} from "../../src/infrastructure/billing/pg-team-checkout-repository";
import {PgTeamPaymentRepository} from "../../src/infrastructure/billing/pg-team-payment-repository";
import {PgCreditConsumption} from "../../src/infrastructure/billing/pg-credit-consumption";
import type {TokenUsageRecord} from "../../src/application/agent-run/ports";
const org=toOrgId(`team-ai-${randomUUID().slice(0,8)}`),user=`${org}-admin`,db=new PgDatabase(appConfig());
const local=toOrgId(`${org}-personal`),localUser=`${org}-personal-user`;
const start=new Date("2026-01-31T10:00:00Z"),paidAt=new Date("2026-01-31T10:01:00Z"),beforeExpiry=new Date("2026-02-01T10:00:00Z"),expired=new Date("2027-01-31T10:01:00Z");
let at=beforeExpiry;
const accounting=new PgCreditConsumption(db,()=>at);
const input=(id:string)=>({requestId:id,userId:user,runId:null,modelProvider:"test",modelId:"test-model",startedAt:beforeExpiry.toISOString(),executionAttemptId:null,projectId:null,maximumTokens:100});
const reserve=(id:string)=>db.withTenant(org,s=>accounting.reserveInSession(s,org,input(id)));
beforeAll(async()=>{
 ensureDatabase();await migrateOnce();await seedOrg({orgId:org,kind:"organization",projectId:`${org}-project`});await addOrgMember(org,user,"admin",null);
 await asOwner(c=>c.query("UPDATE billing_pricing_epoch SET generation=$1,activated_at=clock_timestamp() WHERE singleton=true",[generation]));
 const quoteRef=`quote-${randomUUID()}`,quote={orgId:org,generation,quoteRef,catalogVersion:"frozen",sku:"team-year",provider:"wechat",currency:"CNY",amountMinor:12345,createdAt:start.toISOString(),expiresAt:new Date(start.getTime()+300000).toISOString(),purpose:"initial",seats:5,monthlyCredits:100000,billingCycle:"year",renewalMode:"manual",planVersion:0};
 await asOwner(c=>c.query("INSERT INTO billing_team_quotes(quote_ref,org_id,generation,quote,created_at,expires_at) VALUES($1,$2,$3,$4,$5,$6)",[quoteRef,org,generation,quote,start,quote.expiresAt]));
 const p=await new PgTeamCheckoutRepository(db,{authorize:async()=>org} as never,()=>true,()=>start).reserve({orgId:org,userId:user},org,{quoteRef,idempotencyKey:`ai-${randomUUID()}`});
 await new PgTeamPaymentRepository(db,()=>beforeExpiry).settle(org,{provider:"wechat",purchaseRef:p.purchaseRef,paymentRef:`wx_${randomUUID().replaceAll("-","")}`,amountMinor:12345,currency:"CNY",paidAt});
 const topupRef=`quote-${randomUUID()}`,topup={orgId:org,generation,quoteRef:topupRef,catalogVersion:"frozen",sku:"pack",provider:"wechat",currency:"CNY",amountMinor:12900,createdAt:start.toISOString(),expiresAt:quote.expiresAt,purpose:"credit_topup",credits:10000,renewalMode:"manual"};
 await asOwner(c=>c.query("INSERT INTO billing_team_quotes(quote_ref,org_id,generation,quote,created_at,expires_at) VALUES($1,$2,$3,$4,$5,$6)",[topupRef,org,generation,topup,start,topup.expiresAt]));
 const pack=await new PgTeamCheckoutRepository(db,{authorize:async()=>org} as never,()=>true,()=>start).reserve({orgId:org,userId:user},org,{quoteRef:topupRef,idempotencyKey:`pack-${randomUUID()}`});
 await new PgTeamPaymentRepository(db,()=>beforeExpiry).settle(org,{provider:"wechat",purchaseRef:pack.purchaseRef,paymentRef:`wx_${randomUUID().replaceAll("-","")}`,amountMinor:12900,currency:"CNY",paidAt});

});
afterAll(async()=>{await asOwner(async c=>{
 await c.query("DELETE FROM credit_consumption_requests WHERE org_id IN ($1,$2)",[org,local]);
 await c.query("DELETE FROM credit_transactions WHERE wallet_id IN (SELECT wallet_id FROM credit_wallets WHERE owner_type='user' AND owner_id=ANY($1))",[[localUser,user]]);await c.query("DELETE FROM credit_subscription_periods WHERE wallet_id IN (SELECT wallet_id FROM credit_wallets WHERE owner_type='user' AND owner_id=ANY($1))",[[localUser,user]]);await c.query("DELETE FROM credit_wallets WHERE owner_type='user' AND owner_id=ANY($1)",[[localUser,user]]);
 await c.query("DELETE FROM credit_transactions WHERE wallet_id IN (SELECT wallet_id FROM credit_wallets WHERE owner_type='team' AND owner_id=$1)",[org]);await c.query("DELETE FROM credit_subscription_periods WHERE wallet_id IN (SELECT wallet_id FROM credit_wallets WHERE owner_type='team' AND owner_id=$1)",[org]);await c.query("DELETE FROM credit_wallets WHERE owner_type='team' AND owner_id=$1",[org]);
 for(const t of ["billing_team_receipts","billing_team_terms","billing_team_purchases","billing_team_quotes","org_commercial_licenses"])await c.query(`DELETE FROM ${t} WHERE org_id=$1`,[org]);
 await c.query("UPDATE billing_pricing_epoch SET generation=NULL,activated_at=NULL WHERE singleton=true");
});await db.close();});
it("non-enterprise paid Team uses personal payer before and after expiry; admitted receipts still finish",async()=>{
 const id=`ai-${randomUUID()}`;await asOwner(c=>c.query("INSERT INTO credit_wallets(owner_type,owner_id,balance) VALUES('user',$1,1)",[user]));await reserve(id);at=expired;
 await asOwner(c=>c.query("INSERT INTO credit_wallets(owner_type,owner_id,balance) VALUES('user',$1,-1) ON CONFLICT(owner_type,owner_id) DO UPDATE SET balance=-1",[user]));
 await expect(reserve(`expired-${randomUUID()}`)).rejects.toMatchObject({code:"credit_required",ownerType:"user",ownerId:user});
 await expect(reserve(id)).resolves.toBeUndefined();
 const usage:TokenUsageRecord={eventId:id,userId:user,runId:null,modelProvider:"test",modelId:"test-model",tokensTotal:11,promptTokens:11,completionTokens:0,totalSource:"reported",outcome:"succeeded",requestEndedAt:new Date(expired.getTime()+1000).toISOString()};
 await db.withTenant(org,s=>accounting.settleInSession(s,org,usage));
 expect(await asOwner(async c=>(await c.query("SELECT state FROM credit_consumption_requests WHERE request_id=$1",[id])).rows[0].state)).toBe("settled");
});
it("active Enterprise still passes the same request/receipt accounting after the old Team term ends",async()=>{
 await asOwner(c=>c.query("UPDATE organization_plans SET plan='enterprise',version=version+1 WHERE org_id=$1",[org]));at=expired;
 const id=`enterprise-${randomUUID()}`;await reserve(id);
 await db.withTenant(org,s=>accounting.settleInSession(s,org,{eventId:id,userId:user,runId:null,modelProvider:"test",modelId:"test-model",tokensTotal:0,promptTokens:0,completionTokens:0,totalSource:"reported",outcome:"succeeded"}));
 expect(await asOwner(async c=>(await c.query("SELECT state FROM credit_consumption_requests WHERE request_id=$1",[id])).rows[0].state)).toBe("settled");
});

it("preserves the default personal request path without requiring a Team license",async()=>{
 await seedOrg({orgId:local,kind:"personal-local",ownerUserId:localUser,projectId:`${local}-project`});await addOrgMember(local,localUser,"admin",null);
 await asOwner(c=>c.query("INSERT INTO credit_wallets(owner_type,owner_id,balance) VALUES('user',$1,1)",[localUser]));
 const id=`personal-${randomUUID()}`,request={...input(id),userId:localUser};
 await expect(db.withTenant(local,s=>accounting.reserveInSession(s,local,request))).resolves.toBeUndefined();
 await db.withTenant(local,s=>accounting.settleInSession(s,local,{eventId:id,userId:localUser,runId:null,modelProvider:"test",modelId:"test-model",tokensTotal:0,promptTokens:0,completionTokens:0,totalSource:"reported",outcome:"succeeded"}));
});

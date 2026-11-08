// @global-scope-fixture table:credit_wallets: unique personal wallet owners are deleted in afterAll; the isolated runner also drops the owned database.
import {randomUUID} from "node:crypto";
import {beforeAll,afterAll,beforeEach,expect,it} from "vitest";
import {ensureDatabase,migrateOnce,seedOrg,addOrgMember,asOwner} from "../support/db";
import {PgDatabase} from "../../src/infrastructure/db/pg-database";
import {appConfig} from "../../src/infrastructure/db/pg-config";
import {toOrgId,type OrgId} from "../../src/domain/org-id";
import {BILLING_ACCOUNTING_GENERATION as generation} from "../../src/domain/billing/billing-generation";
import {PgCreditConsumption} from "../../src/infrastructure/billing/pg-credit-consumption";
import {PgTeamCheckoutRepository} from "../../src/infrastructure/billing/pg-team-checkout-repository";
import {PgTeamPaymentRepository} from "../../src/infrastructure/billing/pg-team-payment-repository";
const prefix=`fallback-${randomUUID().slice(0,8)}`,user=`${prefix}-user`,other=`${prefix}-other`;
const unpaid=toOrgId(`${prefix}-unpaid`),second=toOrgId(`${prefix}-second`),team=toOrgId(`${prefix}-team`),enterprise=toOrgId(`${prefix}-enterprise`);
const orgs=[unpaid,second,team,enterprise],db=new PgDatabase(appConfig());
let at=new Date(),priorEpoch:unknown;
const credits=new PgCreditConsumption(db,()=>at);
const input=(id:string)=>({requestId:`${prefix}-${id}`,userId:user,runId:null,modelProvider:"test",modelId:"fixture",executionAttemptId:null,projectId:null,startedAt:at.toISOString(),maximumTokens:1000});
const reserve=(org:OrgId,id:string)=>db.withTenant(org,s=>credits.reserveInSession(s,org,input(id)));
const settle=(org:OrgId,id:string)=>db.withTenant(org,s=>credits.settleInSession(s,org,{eventId:input(id).requestId,userId:user,runId:null,modelProvider:"test",modelId:"fixture",tokensTotal:1000,promptTokens:600,completionTokens:400,totalSource:"reported",outcome:"succeeded"}));
const owner=(id:string)=>asOwner(async c=>(await c.query("SELECT w.owner_type,w.owner_id,r.state FROM credit_consumption_requests r JOIN credit_wallets w USING(wallet_id) WHERE r.request_id=$1",[input(id).requestId])).rows[0]);
const balance=(type:string,id:string)=>asOwner(async c=>Number((await c.query("SELECT balance FROM credit_wallets WHERE owner_type=$1 AND owner_id=$2",[type,id])).rows[0]?.balance));
beforeAll(async()=>{
 ensureDatabase();await migrateOnce();
 await asOwner(async c=>{priorEpoch=(await c.query("SELECT generation,activated_at FROM billing_pricing_epoch WHERE singleton")).rows[0];await c.query("UPDATE billing_pricing_epoch SET generation=$1,activated_at=clock_timestamp() WHERE singleton",[generation]);});
 for(const org of orgs){await seedOrg({orgId:org,projectId:`${org}-project`});await addOrgMember(org,user,"admin",null);}
 await asOwner(c=>c.query("INSERT INTO organization_plans(org_id,plan,version,updated_by,billing_generation) VALUES($1,'enterprise',1,'operator',$2)",[enterprise,generation]));
 const quoteRef=`quote-${randomUUID()}`,quote={orgId:team,generation,quoteRef,catalogVersion:"frozen",sku:"team-year",provider:"wechat",currency:"CNY",amountMinor:12345,createdAt:at.toISOString(),expiresAt:new Date(at.getTime()+300000).toISOString(),purpose:"initial",seats:5,monthlyCredits:100000,billingCycle:"year",renewalMode:"manual",planVersion:0};
 await asOwner(c=>c.query("INSERT INTO billing_team_quotes(quote_ref,org_id,generation,quote,created_at,expires_at) VALUES($1,$2,$3,$4,$5,$6)",[quoteRef,team,generation,quote,at,quote.expiresAt]));
 const p=await new PgTeamCheckoutRepository(db,{authorize:async()=>team} as never,()=>true,()=>at).reserve({orgId:team,userId:user},team,{quoteRef,idempotencyKey:`paid-${randomUUID()}`});
 await new PgTeamPaymentRepository(db,()=>at).settle(team,{provider:"wechat",purchaseRef:p.purchaseRef,paymentRef:`wx_${randomUUID().replaceAll("-","")}`,amountMinor:12345,currency:"CNY",paidAt:at});
 await asOwner(c=>c.query("INSERT INTO credit_wallets(owner_type,owner_id,balance) VALUES('user',$1,20000),('user',$2,30000),('team',$3,10)",[user,other,enterprise]));
});
beforeEach(async()=>{at=new Date();await asOwner(async c=>{await c.query("DELETE FROM credit_consumption_requests WHERE org_id=ANY($1::text[])",[orgs]);await c.query("UPDATE credit_wallets SET balance=20000,held_hundredths=0,unbounded_requests=0 WHERE owner_type='user' AND owner_id=$1",[user]);await c.query("UPDATE credit_wallets SET balance=10,held_hundredths=0,unbounded_requests=0 WHERE owner_type='team' AND owner_id=ANY($1::text[])",[[team,enterprise]]);await c.query("UPDATE credit_subscription_periods SET remaining_hundredths=0 WHERE wallet_id IN (SELECT wallet_id FROM credit_wallets WHERE owner_type='team' AND owner_id=$1)",[team]);});});
afterAll(async()=>{await asOwner(async c=>{
 await c.query("DELETE FROM credit_consumption_requests WHERE org_id=ANY($1::text[])",[orgs]);
 await c.query("DELETE FROM credit_transactions WHERE wallet_id IN (SELECT wallet_id FROM credit_wallets WHERE owner_type='user' AND owner_id=ANY($1::text[]))",[[user,other]]);
 await c.query("DELETE FROM credit_subscription_periods WHERE wallet_id IN (SELECT wallet_id FROM credit_wallets WHERE owner_type='user' AND owner_id=ANY($1::text[]))",[[user,other]]);
 await c.query("DELETE FROM credit_wallets WHERE owner_type='user' AND owner_id=ANY($1::text[])",[[user,other]]);
 const old=priorEpoch as {generation:string|null;activated_at:Date|null};await c.query("UPDATE billing_pricing_epoch SET generation=$1,activated_at=$2 WHERE singleton",[old.generation,old.activated_at]);
});await db.close();});
it("uses the authenticated initiator's personal wallet when the organization has no license or wallet",async()=>{
 await reserve(unpaid,"unpaid");await settle(unpaid,"unpaid");await settle(unpaid,"unpaid");
 expect(await owner("unpaid")).toMatchObject({owner_type:"user",owner_id:user,state:"settled"});expect(await balance("user",user)).toBe(19999);expect(await balance("user",other)).toBe(30000);
});
it("keeps non-enterprise personal payer fixed across later Team wallet changes",async()=>{
 await reserve(team,"team-first");await asOwner(c=>c.query("UPDATE credit_wallets SET balance=-2 WHERE owner_type='team' AND owner_id=$1",[team]));await reserve(team,"team-first");await settle(team,"team-first");
 expect(await owner("team-first")).toMatchObject({owner_type:"user",owner_id:user});expect(await balance("team",team)).toBe(-2);expect(await balance("user",user)).toBe(19999);
});
it("falls back from exhausted Team and never changes the persisted payer after it is funded",async()=>{
 await asOwner(c=>c.query("UPDATE credit_wallets SET balance=-2 WHERE owner_type='team' AND owner_id=$1",[team]));await reserve(team,"personal-first");await asOwner(c=>c.query("UPDATE credit_wallets SET balance=10 WHERE owner_type='team' AND owner_id=$1",[team]));await reserve(team,"personal-first");await settle(team,"personal-first");
 expect(await owner("personal-first")).toMatchObject({owner_type:"user",owner_id:user});expect(await balance("team",team)).toBe(10);expect(await balance("user",user)).toBe(19999);
});
it("preserves legal Enterprise overdraft even when personal funds are negative",async()=>{
 await asOwner(c=>c.query("UPDATE credit_wallets SET balance=-2 WHERE (owner_type='team' AND owner_id=$1) OR (owner_type='user' AND owner_id=$2)",[enterprise,user]));await reserve(enterprise,"enterprise");await settle(enterprise,"enterprise");expect(await owner("enterprise")).toMatchObject({owner_type:"team",owner_id:enterprise});expect(await balance("team",enterprise)).toBe(-3);expect(await balance("user",user)).toBe(-2);
});
it("refuses personal zero before dispatch without a debit",async()=>{
 await asOwner(c=>c.query("UPDATE credit_wallets SET balance=0 WHERE owner_type='user' AND owner_id=$1",[user]));
 await expect(reserve(unpaid,"zero")).rejects.toMatchObject({code:"credit_required",ownerType:"user",ownerId:user});
 expect(await owner("zero")).toBeUndefined();expect(await balance("user",user)).toBe(0);
});
it("serializes two organizations sharing one personal wallet and rejects foreign replay",async()=>{
 await Promise.all([reserve(unpaid,"parallel-a"),reserve(second,"parallel-b")]);await Promise.all([settle(unpaid,"parallel-a"),settle(second,"parallel-b")]);expect(await balance("user",user)).toBe(19998);
 await expect(db.withTenant(unpaid,s=>credits.reserveInSession(s,unpaid,{...input("parallel-a"),userId:other}))).rejects.toBeTruthy();expect(await balance("user",other)).toBe(30000);
});

it("non-enterprise payer remains personal regardless of stale Team subscription metadata",async()=>{
 await asOwner(c=>c.query("UPDATE credit_wallets SET balance=0 WHERE owner_type='team' AND owner_id=$1",[team]));
 await reserve(team,"team-zero");expect(await owner("team-zero")).toMatchObject({owner_type:"user",owner_id:user});
 await asOwner(c=>c.query("UPDATE organization_plans SET billing_generation='untrusted' WHERE org_id=$1",[team]));
 try{await reserve(team,"bad-generation");expect(await owner("bad-generation")).toMatchObject({owner_type:"user",owner_id:user});expect(await balance("user",user)).toBe(20000);}
 finally{await asOwner(c=>c.query("UPDATE organization_plans SET billing_generation=$2 WHERE org_id=$1",[team,generation]));}
});
it("keeps Enterprise organization ownership even before a wallet exists",async()=>{
 const fresh=toOrgId(`${prefix}-fresh-enterprise`);orgs.push(fresh);await seedOrg({orgId:fresh,projectId:`${fresh}-project`});await addOrgMember(fresh,user,"admin",null);
 await asOwner(c=>c.query("INSERT INTO organization_plans(org_id,plan,version,updated_by,billing_generation) VALUES($1,'enterprise',1,'operator',$2)",[fresh,generation]));
 await reserve(fresh,"enterprise-new-wallet");await settle(fresh,"enterprise-new-wallet");
 expect(await owner("enterprise-new-wallet")).toMatchObject({owner_type:"team",owner_id:fresh});expect(await balance("team",fresh)).toBe(-1);
});
it("settles personal fallback concurrently with same-org admission without lock inversion",async()=>{
 await reserve(unpaid,"settling");
 await Promise.all([settle(unpaid,"settling"),reserve(unpaid,"starting")]);
 await settle(unpaid,"starting");expect(await balance("user",user)).toBe(19998);
});
it("rejects cross-org and changed-bound replay without a second hold or debit",async()=>{
 await reserve(unpaid,"fixed");
 await expect(reserve(second,"fixed")).rejects.toMatchObject({code:"credit_accounting_unavailable"});
 await expect(db.withTenant(unpaid,s=>credits.reserveInSession(s,unpaid,{...input("fixed"),maximumTokens:2000}))).rejects.toMatchObject({code:"credit_accounting_unavailable"});
 await settle(unpaid,"fixed");await settle(unpaid,"fixed");expect(await balance("user",user)).toBe(19999);
});

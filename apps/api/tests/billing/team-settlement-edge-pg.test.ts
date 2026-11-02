import {randomUUID} from "node:crypto";
import {beforeAll,afterAll,expect,it} from "vitest";
import {ensureDatabase,migrateOnce,seedOrg,addOrgMember,asOwner} from "../support/db";
import {PgDatabase} from "../../src/infrastructure/db/pg-database";
import {appConfig} from "../../src/infrastructure/db/pg-config";
import {toOrgId} from "../../src/domain/org-id";
import {BILLING_ACCOUNTING_GENERATION as generation} from "../../src/domain/billing/billing-generation";
import {PgTeamCheckoutRepository} from "../../src/infrastructure/billing/pg-team-checkout-repository";
import {PgTeamPaymentRepository} from "../../src/infrastructure/billing/pg-team-payment-repository";
import {grantDueTeamTerms} from "../../src/infrastructure/billing/team-credit-terms";
import {lockOrganizationCapacity} from "../../src/infrastructure/org-capacity/pg-commercial-capacity";
import {requireActivePricingEpoch} from "../../src/infrastructure/billing/personal-pricing-epoch";
const db=new PgDatabase(appConfig()),owners:string[]=[];
const start=new Date("2026-01-31T10:00:00Z"),applied=new Date("2026-03-01T10:00:00Z");
beforeAll(async()=>{ensureDatabase();await migrateOnce();await asOwner(c=>c.query("UPDATE billing_pricing_epoch SET generation=$1,activated_at=clock_timestamp() WHERE singleton=true",[generation]));});
afterAll(async()=>{await asOwner(async c=>{for(const org of owners){
 await c.query("DELETE FROM credit_transactions WHERE wallet_id IN (SELECT wallet_id FROM credit_wallets WHERE owner_type='team' AND owner_id=$1)",[org]);await c.query("DELETE FROM credit_subscription_periods WHERE wallet_id IN (SELECT wallet_id FROM credit_wallets WHERE owner_type='team' AND owner_id=$1)",[org]);await c.query("DELETE FROM credit_wallets WHERE owner_type='team' AND owner_id=$1",[org]);
 for(const table of ["billing_team_receipts","billing_team_terms","billing_team_purchases","billing_team_quotes","org_commercial_licenses"])await c.query(`DELETE FROM ${table} WHERE org_id=$1`,[org]);
 }await c.query("UPDATE billing_pricing_epoch SET generation=NULL,activated_at=NULL WHERE singleton=true");});await db.close();});
async function fixture(){
 const org=toOrgId(`team-edge-${randomUUID().slice(0,8)}`),user=`${org}-admin`;owners.push(org);
 await seedOrg({orgId:org,kind:"organization",projectId:`${org}-project`});await addOrgMember(org,user,"admin",null);
 const quoteRef=`tq-${randomUUID()}`,quote={orgId:org,generation,quoteRef,catalogVersion:"frozen",sku:"team-year",provider:"wechat",currency:"CNY",amountMinor:12345,createdAt:start.toISOString(),expiresAt:new Date(start.getTime()+300000).toISOString(),purpose:"initial",seats:5,monthlyCredits:100000,billingCycle:"year",renewalMode:"manual",planVersion:0};
 await asOwner(c=>c.query("INSERT INTO billing_team_quotes(quote_ref,org_id,generation,quote,created_at,expires_at) VALUES($1,$2,$3,$4,$5,$6)",[quoteRef,org,generation,quote,start,quote.expiresAt]));
 const repo=new PgTeamCheckoutRepository(db,{authorize:async()=>org} as never,()=>true,()=>start);
 const input={quoteRef,idempotencyKey:`edge-${randomUUID()}`};
 const p=await repo.reserve({userId:user,orgId:org},org,input);
 const proof={provider:"wechat" as const,purchaseRef:p.purchaseRef,paymentRef:`wx_${randomUUID().replaceAll("-","")}`,amountMinor:quote.amountMinor,currency:"CNY",paidAt:new Date(start.getTime()+60000)};
 return {org,user,p,proof,input};
}
it("retains late cash and Plan-version races as real reconciliation receipts without financial side effects",async()=>{
 for(const mode of ["late","version","amount"]){
  const f=await fixture();
  if(mode==="version")await asOwner(c=>c.query("INSERT INTO organization_plans(org_id,plan,version,updated_by,billing_generation) VALUES($1,'ordinary',1,$2,$3)",[f.org,f.user,generation]));
  const proof={...f.proof,...(mode==="late"?{paidAt:new Date(start.getTime()+900001)}:{}),...(mode==="amount"?{amountMinor:12346}:{})};
  expect(await new PgTeamPaymentRepository(db,()=>applied).settle(f.org,proof)).toEqual({completed:true,manual:true});
  await asOwner(async c=>{
   expect((await c.query("SELECT paid_at,amount_minor,manual_review FROM billing_team_receipts WHERE purchase_ref=$1",[f.p.purchaseRef])).rows[0]).toMatchObject({paid_at:proof.paidAt,amount_minor:String(proof.amountMinor),manual_review:true});
   expect((await c.query("SELECT count(*)::int AS n FROM billing_team_terms WHERE org_id=$1",[f.org])).rows[0].n).toBe(0);
   expect((await c.query("SELECT count(*)::int AS n FROM credit_wallets WHERE owner_type='team' AND owner_id=$1",[f.org])).rows[0].n).toBe(0);
  });
 }
});
it("does not revive an expired first window; the original-anchor current month still grants once after Enterprise",async()=>{
 const f=await fixture();expect(await new PgTeamPaymentRepository(db,()=>applied).settle(f.org,f.proof)).toEqual({completed:true,manual:false});
 await asOwner(async c=>{
  const receipt=(await c.query("SELECT fulfillment FROM billing_team_purchases WHERE purchase_ref=$1",[f.p.purchaseRef])).rows[0].fulfillment;
  expect(receipt).toMatchObject({firstCreditsApplied:0,ledgerRef:null,firstCreditPeriod:{periodEnd:"2026-02-28T10:01:00.000Z"}});
  await c.query("UPDATE organization_plans SET plan='enterprise',version=version+1 WHERE org_id=$1",[f.org]);
 });
 for(let retry=0;retry<2;retry++)await db.withTenant(f.org,async s=>{await lockOrganizationCapacity(s,f.org);await requireActivePricingEpoch(s);await grantDueTeamTerms(s,f.org,applied);});
 await asOwner(async c=>{
  const periods=(await c.query("SELECT p.period_start,p.period_end,p.granted_hundredths::text FROM credit_subscription_periods p JOIN credit_wallets w USING(wallet_id) WHERE w.owner_type='team' AND w.owner_id=$1",[f.org])).rows;
  expect(periods).toEqual([{period_start:new Date("2026-02-28T10:01:00Z"),period_end:new Date("2026-03-31T10:01:00Z"),granted_hundredths:"10000000"}]);
  expect((await c.query("SELECT count(*)::int AS n FROM credit_transactions t JOIN credit_wallets w USING(wallet_id) WHERE w.owner_type='team' AND w.owner_id=$1 AND type='subscription_grant'",[f.org])).rows[0].n).toBe(1);
 });
});
it("cannot settle another organization's purchase or write an orphan claim",async()=>{
 const own=await fixture(),other=await fixture();
 await expect(new PgTeamPaymentRepository(db,()=>applied).settle(other.org,own.proof)).rejects.toThrow("order_not_found");
 expect(await asOwner(async c=>(await c.query("SELECT count(*)::int AS n FROM billing_payment_claims WHERE provider='wechat' AND payment_ref=$1",[own.proof.paymentRef])).rows[0].n)).toBe(0);
});

it("retains trusted cash and its original owner after organization disable or deletion without granting rights",async()=>{
 for(const mode of ["disabled","missing"]){
  const f=await fixture();
  await asOwner(async c=>{
   if(mode==="disabled")await c.query("UPDATE organizations SET status='disabled',disabled_at=now(),retention_until=now()+interval '180 days' WHERE id=$1",[f.org]);
   else{
    await c.query("DELETE FROM org_commercial_licenses WHERE org_id=$1",[f.org]);
    await c.query("DELETE FROM organizations WHERE id=$1",[f.org]);
   }
  });
  const payments=new PgTeamPaymentRepository(db,()=>applied);
  expect(await payments.settle(f.org,f.proof)).toEqual({completed:true,manual:true});
  expect(await payments.settle(f.org,f.proof)).toEqual({completed:true,manual:true});
  await asOwner(async c=>{
   expect((await c.query("SELECT amount_minor,manual_review FROM billing_team_receipts WHERE purchase_ref=$1",[f.p.purchaseRef])).rows).toEqual([{amount_minor:"12345",manual_review:true}]);
   expect((await c.query("SELECT owner_id FROM billing_payment_claims WHERE provider='wechat' AND payment_ref=$1",[f.proof.paymentRef])).rows[0].owner_id).toBe(f.org);
   expect((await c.query("SELECT count(*)::int AS n FROM billing_team_terms WHERE org_id=$1",[f.org])).rows[0].n).toBe(0);
   expect((await c.query("SELECT count(*)::int AS n FROM credit_wallets WHERE owner_type='team' AND owner_id=$1",[f.org])).rows[0].n).toBe(0);
  });
 }
});
it("refuses a fresh checkout after disable while recovering an existing frozen intent",async()=>{
 const f=await fixture();
 await asOwner(c=>c.query("UPDATE organizations SET status='disabled',disabled_at=now(),retention_until=now()+interval '180 days' WHERE id=$1",[f.org]));
 const repo=new PgTeamCheckoutRepository(db,{authorize:async()=>f.org} as never,()=>true,()=>start);
 await expect(repo.reserve({userId:f.user,orgId:f.org},f.org,{quoteRef:f.p.quote.quoteRef,idempotencyKey:`new-${randomUUID()}`})).rejects.toThrow("forbidden");
 expect((await repo.reserve({userId:f.user,orgId:f.org},f.org,f.input)).purchaseRef).toBe(f.p.purchaseRef);
});

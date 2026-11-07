import {expect,it} from "vitest";
import {PgTeamAccountRepository} from "../../src/infrastructure/billing/pg-team-account-repository";
import {BILLING_ACCOUNTING_GENERATION as generation} from "../../src/domain/billing/billing-generation";
function repository(market:"cn"|"us"|null){
 const requested:unknown[]=[];
 const row={package_id:"configured-team",region:market??"cn",currency:market==="us"?"USD":"CNY",amount_fen:14900,total_credits:100000,owner_type:"team",product_kind:"subscription",billing_cycle:"month",included_seats:5,extra_seat_amount_fen:2500,extra_seat_monthly_credits:15000,sort_order:0};
 const db={withTenant:async(_org:string,fn:Function)=>fn({query:async(sql:string,params?:unknown[])=>{if(sql.includes("credit_packages")){requested.push(params?.[0]);return {rows:[row]};}return {rows:sql.includes("billing_pricing_epoch")?[{generation,active:true}]:[]};}})};
 return {repo:new PgTeamAccountRepository(db as never,{authorize:async()=>"org-a"} as never,()=>true,()=>market),requested};
}
it("reads actual USD deployment configuration and keeps unsupported Team sale closed",async()=>{
 const f=repository("us"),catalog=await f.repo.catalog({userId:"admin",orgId:"org-a"} as never,"org-a");
 expect(f.requested).toEqual(["us"]);expect(catalog).toMatchObject({market:"us",enabledProviders:[],products:[{currency:"USD",amountMinor:14900}]});
});
it("never invents a CN market when deployment market is unavailable",async()=>{
 const f=repository(null);await expect(f.repo.catalog({userId:"admin",orgId:"org-a"} as never,"org-a")).rejects.toThrow("dependency_unavailable");expect(f.requested).toEqual([]);
});
function entitlementRepository(planGeneration:string|null){
 const queries:string[]=[];
 const db={withTenant:async(_org:string,fn:Function)=>fn({query:async(sql:string)=>{
  queries.push(sql);
  return {rows:sql.includes("FROM organizations WHERE")?[{id:"org-a"}]:sql.includes("billing_pricing_epoch")?[{generation,active:true}]:sql.includes("FROM organization_plans")?[{plan:"enterprise",version:3,billing_generation:planGeneration}]:sql.includes("count(*)")?[{n:"1"}]:[]};
 }})};
 return {repo:new PgTeamAccountRepository(db as never,{authorize:async()=>"org-a"} as never),queries};
}
it.each([null,"retired-generation"])("does not revive old Enterprise metadata as current entitlement (%s)",async prior=>{
 const f=entitlementRepository(prior);
 await expect(f.repo.entitlement({userId:"admin",orgId:"org-a"} as never,"org-a")).rejects.toThrow("dependency_unavailable");
});
it("reads current-generation Enterprise entitlement from the actual repository",async()=>{
 const f=entitlementRepository(generation);
 expect(await f.repo.entitlement({userId:"admin",orgId:"org-a"} as never,"org-a")).toMatchObject({generation,licenseStatus:"enterprise",planVersion:3,teamPayment:null,wallet:{balance:0}});
});
it("shows no grant for an expired renewed term rather than joining the previous term's period",async()=>{
 const term={purchaseAnchor:"2026-03-01T10:00:00Z",paidPeriodStart:"2026-03-01T10:00:00Z",paidPeriodEnd:"2026-04-01T10:00:00Z",billingCycle:"month",purchasedSeats:5,monthlyCredits:100000};
 const oldPeriod={granted_hundredths:"10000000",remaining_hundredths:"0",period_start:new Date("2026-01-01T10:00:00Z"),period_end:new Date("2026-02-01T10:00:00Z")};
 const db={withTenant:async(_org:string,fn:Function)=>fn({query:async(sql:string,params?:unknown[])=>({rows:sql.includes("FROM organizations WHERE")?[{id:"org-a"}]:sql.includes("billing_pricing_epoch")?[{generation,active:true}]:sql.includes("FROM organization_plans")?[{plan:"ordinary",version:2,billing_generation:generation}]:sql.includes("FROM org_commercial_licenses")?[{purchased_seats:"5",pending_purchase_ref:null}]:sql.includes("count(*)")?[{n:"1"}]:sql.includes("ORDER BY (paid_term")?[{purchase_ref:"renewed-term",paid_term:term}]:sql.startsWith("SELECT p.granted_hundredths")&&params?.[1]!=="renewed-term"?[oldPeriod]:[]})})};
 const repo=new PgTeamAccountRepository(db as never,{authorize:async()=>"org-a"} as never);
 expect(await repo.entitlement({userId:"admin",orgId:"org-a"} as never,"org-a")).toMatchObject({licenseStatus:"expired",teamPayment:{term},creditGrant:{status:"none",grant:null}});
});

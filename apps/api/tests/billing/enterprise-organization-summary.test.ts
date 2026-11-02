import {expect,it} from "vitest";
import {platformOrganizations as C} from "@repo/contracts";
import type {DatabasePort,TenantSession} from "../../src/application/ports/database.port";
import {PgPlatformOrganizationRepository} from "../../src/infrastructure/system/pg-platform-organization-repository";
import {BILLING_ACCOUNTING_GENERATION as generation} from "../../src/domain/billing/billing-generation";
import {toOrgId} from "../../src/domain/org-id";
const orgId=toOrgId("summary-current-ordinary"),now=new Date("2026-11-02T00:00:00Z");
/** Unit decision inputs only; actual SQL/driver behavior is covered by the targeted PG lane. */
function repository(paid:boolean){
 const session:TenantSession={async query<R>(sql:string){
  let rows:unknown[]=[];
  if(sql.includes("AS safe"))rows=[{safe:true}];
  else if(sql.includes("FROM organizations"))rows=[{id:orgId,name:"Ordinary current organization",kind:"organization"}];
  else if(sql.includes("FROM org_memberships"))rows=[{count:"2"}];
  else if(sql.includes("FROM organization_plans"))rows=[{plan:"ordinary",version:4,updated_at:now,updated_by:"operator",billing_generation:generation}];
  else if(sql.includes("FROM billing_pricing_epoch"))rows=[{generation,active:true}];
  else if(sql.includes("FROM org_commercial_licenses"))rows=paid?[{generation,purchased_seats:"7",pending_seats:null,pending_purchase_ref:null}]:[];
  else if(sql.includes("FROM credit_wallets"))rows=[{wallet_id:"wallet",balance:"12.34",total_purchased:"8",total_granted:"4.34",updated_at:now}];
  else if(sql.includes("FROM credit_subscription_periods"))rows=[{hundredths:"0",welcome_hundredths:"0",expires_at:null}];
  else if(sql==="SELECT now() AS at")rows=[{at:now}];
  else if(!sql.includes("pg_advisory_xact_lock_shared")&&!sql.includes("organization_plan_changes")&&!sql.includes("INSERT INTO platform_organization_access_events"))throw Error(`unexpected unit query: ${sql}`);
  return {rows:rows as R[]};
 }};
 const db:DatabasePort={withTenant:async(_org,fn)=>fn(session),withoutTenant:async fn=>fn(session),close:async()=>{}};
 return new PgPlatformOrganizationRepository(db,db);
}
it("current ordinary with no license returns coherent actual wallet facts in detail and list",async()=>{
 const repo=repository(false);const detail=C.operations.getOrganization.out.parse(await repo.detail(orgId,"operator"));
 expect(detail.organization.plan).toMatchObject({plan:"ordinary",version:4,enforcement:"active",billingGeneration:generation});
 expect(detail.organization.billingSummary).toMatchObject({orgId,generation,planVersion:4,memberCount:2,licenseStatus:"none",teamPayment:null,creditGrant:{status:"none",grant:null},wallet:{balance:12.34,permanentBalance:12.34,totalPurchased:8,totalGranted:4.34}});
 const page=C.operations.listOrganizations.out.parse(await repo.list({search:String(orgId),limit:25},"operator"));expect(page.organizations).toEqual([detail.organization]);
});
it("current ordinary paid license without a payment adapter fails with the typed catalog error",async()=>{
 const repo=repository(true);await expect(repo.detail(orgId,"operator")).rejects.toMatchObject({reasonCode:"PLATFORM_CATALOG_UNAVAILABLE"});
 await expect(repo.list({search:String(orgId),limit:25},"operator")).rejects.toMatchObject({reasonCode:"PLATFORM_CATALOG_UNAVAILABLE"});
});

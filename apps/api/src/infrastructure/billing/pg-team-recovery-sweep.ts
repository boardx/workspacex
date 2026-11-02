import type {DatabasePort} from "../../application/ports/database.port";
import {toOrgId} from "../../domain/org-id";
import {BILLING_ACCOUNTING_GENERATION as generation} from "../../domain/billing/billing-generation";
import {requireActivePricingEpoch,pricingEpochMode} from "./personal-pricing-epoch";
import {BILLING_GLOBAL_SQL as GLOBAL,assertBillingGlobalStatement} from "./billing-global-boundary";
import {lockOrganizationCapacity} from "../org-capacity/pg-commercial-capacity";
import {grantDueTeamTerms} from "./team-credit-terms";
interface Reconciler{reconcile(org:string,ref:string):Promise<void>}
/** Bounded financial owner pointers only; all license/term/wallet work remains tenant-bound. */
export class PgTeamRecoverySweep{
 constructor(private readonly db:DatabasePort,private readonly reconciler:Reconciler){}
 async sweep(){
  let cursor:string|null=null,processed=0,failed=0;
  for(let page=0;page<5;page++){
   const orgs=await this.db.withoutTenant(async raw=>{
    const s={query:<R>(sql:string,params?:readonly unknown[])=>{assertBillingGlobalStatement(sql);return raw.query<R>(sql,params);}};
    if(await pricingEpochMode(s)!=="active")return [];return (await s.query<{org_id:string}>(GLOBAL.teamDueOrgs,[generation,cursor,20])).rows;
   });
   if(!orgs.length)break;
   for(const {org_id:orgId} of orgs){cursor=orgId;
    try{
     const refs=await this.db.withTenant(toOrgId(orgId),async s=>{
      await lockOrganizationCapacity(s,orgId);await requireActivePricingEpoch(s);await grantDueTeamTerms(s,orgId,new Date());
      return (await s.query<{purchase_ref:string}>("SELECT purchase_ref FROM billing_team_purchases WHERE org_id=$1 AND generation=$2 AND fulfilled_at IS NULL AND closed_at IS NULL AND NOT payment_review_required ORDER BY created_at,purchase_ref LIMIT 20",[orgId,generation])).rows;
     });
     for(const ref of refs){try{await this.reconciler.reconcile(orgId,ref.purchase_ref);}catch{failed++;}}
     processed++;
    }catch{failed++;}
   }
  }
  return {processed,failed};
 }
}

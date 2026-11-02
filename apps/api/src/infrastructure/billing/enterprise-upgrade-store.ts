import {assertNoPaidTeam} from "./enterprise-no-paid-team";
import {randomUUID} from "node:crypto";
import {EnterpriseUpgradeOperation,EnterpriseUpgradeRequest} from "@repo/contracts/billing-team";
import type {DatabasePort,TenantSession} from "../../application/ports/database.port";
import type {OrgId} from "../../domain/org-id";
import {BILLING_ACCOUNTING_GENERATION as generation} from "../../domain/billing/billing-generation";
import {EnterpriseError,type EnterpriseUpgradeStore,type RetainedTeamPayment} from "../../application/billing/enterprise-ports";
import {requireActivePricingEpoch} from "./personal-pricing-epoch";
type Row={actor_id:string;expected_version:number;generation:string;result:unknown};
export class PgEnterpriseUpgradeStore implements EnterpriseUpgradeStore {
 constructor(private readonly db:DatabasePort){}
 private async lock(s:TenantSession,orgId:OrgId){
  try{await requireActivePricingEpoch(s);}catch{throw new EnterpriseError("dependency_unavailable");}
  if(!(await s.query("SELECT id FROM organizations WHERE id=$1 AND kind='organization' FOR UPDATE",[orgId])).rows.length)throw new EnterpriseError("ORGANIZATION_NOT_FOUND");
 }
 private async row(s:TenantSession,orgId:OrgId,ref:string):Promise<Row>{
  const row=(await s.query<Row>("SELECT actor_id,expected_version,generation,result FROM enterprise_upgrade_operations WHERE org_id=$1 AND operation_ref=$2 FOR UPDATE",[orgId,ref])).rows[0];
  if(!row||row.generation!==generation)throw new EnterpriseError("order_not_found");return row;
 }
 async begin(orgId:OrgId,actorId:string,request:EnterpriseUpgradeRequest){
  const input=EnterpriseUpgradeRequest.parse(request);
  return this.db.withTenant(orgId,async s=>{
   await this.lock(s,orgId);
   const existing=(await s.query<Row>("SELECT actor_id,expected_version,generation,result FROM enterprise_upgrade_operations WHERE org_id=$1 AND idempotency_key=$2",[orgId,input.idempotencyKey])).rows[0];
   if(existing){
    if(existing.actor_id!==actorId||existing.expected_version!==input.expectedPlanVersion||existing.generation!==generation)throw new EnterpriseError("idempotency_conflict");
    return EnterpriseUpgradeOperation.parse(existing.result);
   }
   const unresolved=(await s.query<Row>("SELECT actor_id,expected_version,generation,result FROM enterprise_upgrade_operations WHERE org_id=$1 AND generation=$2 AND result->>'status' IN ('processing','needs_review') LIMIT 1",[orgId,generation])).rows[0];
   if(unresolved){
    if(unresolved.actor_id!==actorId||unresolved.expected_version!==input.expectedPlanVersion)throw new EnterpriseError("dependency_unavailable");
    return EnterpriseUpgradeOperation.parse(unresolved.result);
   }
   const plan=(await s.query<{version:number}>("SELECT version FROM organization_plans WHERE org_id=$1",[orgId])).rows[0];
   if((plan?.version??0)!==input.expectedPlanVersion)throw new EnterpriseError("PLAN_VERSION_CONFLICT");
   const time=(await s.query<{at:Date}>("SELECT now() AS at")).rows[0]!.at.toISOString(),operationRef=randomUUID();
   const result=EnterpriseUpgradeOperation.parse({orgId,generation,operationRef,expectedPlanVersion:input.expectedPlanVersion,createdAt:time,asOf:time,status:"processing",receipt:null,code:null,nextAction:"retry_original"});
   await s.query("INSERT INTO enterprise_upgrade_operations(org_id,operation_ref,actor_id,idempotency_key,expected_version,generation,result) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb)",[orgId,operationRef,actorId,input.idempotencyKey,input.expectedPlanVersion,generation,JSON.stringify(result)]);
   return result;
  });
 }
 read(orgId:OrgId,ref:string){return this.db.withTenant(orgId,async s=>{await this.lock(s,orgId);return EnterpriseUpgradeOperation.parse((await this.row(s,orgId,ref)).result);});}
 pending(orgId:OrgId,ref:string,code:"dependency_unavailable"|"PLAN_VERSION_CONFLICT"){
  return this.db.withTenant(orgId,async s=>{await this.lock(s,orgId);const row=await this.row(s,orgId,ref),prior=EnterpriseUpgradeOperation.parse(row.result);
   if(prior.status!=="processing")return prior;
   const asOf=(await s.query<{at:Date}>("SELECT now() AS at")).rows[0]!.at.toISOString();
   const result=EnterpriseUpgradeOperation.parse({...prior,asOf,status:code==="PLAN_VERSION_CONFLICT"?"needs_review":"processing",code,nextAction:code==="PLAN_VERSION_CONFLICT"?"contact_platform":"retry_original"});
   await s.query("UPDATE enterprise_upgrade_operations SET result=$3::jsonb WHERE org_id=$1 AND operation_ref=$2",[orgId,ref,JSON.stringify(result)]);return result;
  });
 }
 activate(orgId:OrgId,ref:string,payment:RetainedTeamPayment|null){
  return this.db.withTenant(orgId,async s=>{
   await this.lock(s,orgId);const row=await this.row(s,orgId,ref),prior=EnterpriseUpgradeOperation.parse(row.result);
   if(prior.status!=="processing")return prior;
   const plan=(await s.query<{plan:string;version:number}>("SELECT plan,version FROM organization_plans WHERE org_id=$1 FOR UPDATE",[orgId])).rows[0];
   if((plan?.version??0)!==prior.expectedPlanVersion)throw new EnterpriseError("PLAN_VERSION_CONFLICT");
   // Repeat the absence check under the activation lock: no purchase can race the earlier read.
   if(payment===null)await assertNoPaidTeam(s,orgId);
   const updated=(await s.query<{updated_at:Date}>(`INSERT INTO organization_plans(org_id,plan,version,updated_by,billing_generation)
    VALUES($1,'enterprise',$2,$3,$4) ON CONFLICT(org_id) DO UPDATE SET plan='enterprise',version=EXCLUDED.version,updated_by=EXCLUDED.updated_by,billing_generation=EXCLUDED.billing_generation,updated_at=now() RETURNING updated_at`,[orgId,prior.expectedPlanVersion+1,row.actor_id,generation])).rows[0]!;
   const at=updated.updated_at.toISOString(),auditRef=randomUUID();
   const result=EnterpriseUpgradeOperation.parse({...prior,status:"succeeded",asOf:at,code:null,nextAction:null,receipt:{auditRef,actorId:row.actor_id,appliedAt:at,plan:{plan:"enterprise",version:prior.expectedPlanVersion+1,updatedAt:at,updatedBy:row.actor_id,enforcement:"active",billingGeneration:generation},prepaidTeamPolicy:"continue_until_paid_end",retainedTeamPayment:payment}});
   await s.query("INSERT INTO organization_plan_changes(id,org_id,version,previous_plan,plan,actor_id,reason) VALUES($1,$2,$3,$4,'enterprise',$5,'enterprise_upgrade')",[auditRef,orgId,prior.expectedPlanVersion+1,plan?.plan??null,row.actor_id]);
   await s.query("UPDATE enterprise_upgrade_operations SET result=$3::jsonb WHERE org_id=$1 AND operation_ref=$2",[orgId,ref,JSON.stringify(result)]);
   return result;
  });
 }
}

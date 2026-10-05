import type {DatabasePort,TenantSession} from "../../application/ports/database.port";
import type {OrgId} from "../../domain/org-id";
import type {IdentityRepository} from "../../application/identity/ports";
import {OrgCoreModelError,type OrgCoreModelAvailability,type OrgCoreModelBinding,type OrgCoreModelRepository,type OrgCoreModelState} from "../../application/model/org-core-model-ports";
interface Row {version:number;model_id:string;model_provider:string;runtime_model_id:string;config_revision:string;private_connection_id:string;updated_by:string;reason:string;}
const project=(row:Row|undefined):OrgCoreModelState=>row?{version:row.version,selection:{modelId:row.model_id,modelProvider:row.model_provider,runtimeModelId:row.runtime_model_id,configRevision:row.config_revision,privateConnectionId:row.private_connection_id},updatedBy:row.updated_by,reason:row.reason}:{version:0,selection:null,updatedBy:null,reason:null};
export function coreModelScopedDb(s:TenantSession,orgId:OrgId):DatabasePort{
 return {withTenant:async(org,work)=>{if(org!==orgId)throw new Error("CORE_MODEL_TENANT_DENIED");return work(s);},withoutTenant:async()=>{throw new Error("CORE_MODEL_TENANT_REQUIRED");},close:async()=>{}};
}
export async function readOrgCoreModelIn(s:TenantSession,orgId:OrgId):Promise<OrgCoreModelState>{
 const organization=(await s.query<{kind:string}>("SELECT kind FROM organizations WHERE id=$1 FOR SHARE",[orgId])).rows[0];
 if(organization?.kind!=="organization")throw new OrgCoreModelError("ORGANIZATION_REQUIRED");
 const row=(await s.query<Row>("SELECT version,model_id,model_provider,runtime_model_id,config_revision,private_connection_id,updated_by,reason FROM organization_core_models WHERE org_id=$1",[orgId])).rows[0];
 return project(row);
}
export function sameCoreModelBinding(a:OrgCoreModelBinding,b:OrgCoreModelBinding):boolean{
 return a.modelId===b.modelId&&a.modelProvider===b.modelProvider&&a.runtimeModelId===b.runtimeModelId&&a.configRevision===b.configRevision&&a.privateConnectionId===b.privateConnectionId;
}
export class PgOrgCoreModelRepository implements OrgCoreModelRepository {
 constructor(private readonly db:DatabasePort,private readonly availability:OrgCoreModelAvailability,
  private readonly identities:(scoped:DatabasePort)=>IdentityRepository){}
 read(orgId:OrgId){return this.db.withTenant(orgId,s=>readOrgCoreModelIn(s,orgId));}
 set(orgId:OrgId,input:{expectedVersion:number;modelId:string;actorId:string;reason:string}){
  return this.db.withTenant(orgId,async s=>{
   // Same org policy lock order as pricing/admission: writers cannot change price during selection.
   await s.query("SELECT pg_advisory_xact_lock(hashtext($1))",[String(orgId)]);
   const scoped=coreModelScopedDb(s,orgId);
   if((await this.identities(scoped).findOrgMembership(input.actorId,orgId))?.orgRole!=="admin")throw new OrgCoreModelError("NOT_ORG_ADMIN");
   const current=await readOrgCoreModelIn(s,orgId);
   if(current.version!==input.expectedVersion)throw new OrgCoreModelError("VERSION_CHANGED");
   if(!Number.isSafeInteger(input.expectedVersion)||input.expectedVersion<0||input.expectedVersion>=2147483647
    ||!input.modelId.trim()||input.modelId.length>200||!input.reason.trim()||input.reason.length>1000)throw new OrgCoreModelError("CORE_MODEL_INPUT_INVALID");
   const binding=await this.availability.resolve(orgId,input.modelId,input.actorId,scoped);
   if(!binding||binding.modelId!==input.modelId||![binding.modelProvider,binding.runtimeModelId,binding.configRevision,binding.privateConnectionId].every(v=>typeof v==="string"&&v.length>0&&v.length<=200))throw new OrgCoreModelError("CORE_MODEL_UNAVAILABLE");
   const version=current.version+1;
   const params=[orgId,version,binding.modelId,binding.modelProvider,binding.runtimeModelId,binding.configRevision,binding.privateConnectionId,input.actorId,input.reason];
   await s.query(`INSERT INTO organization_core_models(org_id,version,model_id,model_provider,runtime_model_id,config_revision,private_connection_id,updated_by,reason)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(org_id) DO UPDATE SET version=EXCLUDED.version,model_id=EXCLUDED.model_id,model_provider=EXCLUDED.model_provider,runtime_model_id=EXCLUDED.runtime_model_id,config_revision=EXCLUDED.config_revision,private_connection_id=EXCLUDED.private_connection_id,updated_by=EXCLUDED.updated_by,reason=EXCLUDED.reason,updated_at=now()`,params);
   await s.query(`INSERT INTO organization_core_model_changes(org_id,version,model_id,model_provider,runtime_model_id,config_revision,private_connection_id,updated_by,reason)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,params);
   return {version,selection:binding,updatedBy:input.actorId,reason:input.reason};
  });
 }
}

/** Validate the accepted run binding; never substitute a later organization selection. */
export async function assertRunCoreModelSnapshot(db:DatabasePort,availability:OrgCoreModelAvailability|undefined,
 orgId:OrgId,rootRunId:string):Promise<void>{
 return db.withTenant(orgId,async s=>{
  const row=(await s.query<{model_id:string;model_provider:string;runtime_model_id:string;config_revision:string;private_connection_id:string;selected_by:string}>(
   "SELECT model_id,model_provider,runtime_model_id,config_revision,private_connection_id,selected_by FROM agent_run_core_model_snapshots WHERE org_id=$1 AND (run_id=$2 OR run_id=(SELECT parent_run_id FROM subtask_runs WHERE org_id=$1 AND id=$2))",[orgId,rootRunId])).rows[0];
  if(!row)return;
  if(!availability)throw new OrgCoreModelError("CORE_MODEL_UNAVAILABLE");
  const frozen:OrgCoreModelBinding={modelId:row.model_id,modelProvider:row.model_provider,runtimeModelId:row.runtime_model_id,configRevision:row.config_revision,privateConnectionId:row.private_connection_id};
  const current=await availability.resolve(orgId,frozen.modelId,row.selected_by,coreModelScopedDb(s,orgId));
  if(!current||!sameCoreModelBinding(frozen,current))throw new OrgCoreModelError("CORE_MODEL_UNAVAILABLE");
 });
}

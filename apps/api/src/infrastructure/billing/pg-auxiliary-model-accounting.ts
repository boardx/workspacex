import {PgCreditConsumption} from './pg-credit-consumption';
import {randomUUID,createHash} from 'node:crypto';
import {z} from 'zod';
import {AuxiliaryModelAdmission,AuxiliaryModelStart,AuxiliaryModelTerminal} from '@repo/contracts/auxiliary-model-accounting';
import type {DatabasePort} from '../../application/ports/database.port';
import type {OrgId} from '../../domain/org-id';
import {CreditConsumptionError} from '../../application/billing/credit-consumption';
import {creditUsageMeter} from './credit-usage-meter';
type Op={id:string;user_id:string;model_provider:string;model_id:string;active:boolean};
type Request={active:boolean;body_hash:string;output_cap:number;operation_id:string;user_id:string;model_id:string;model_provider:string;started_at:Date};
/** Only server-issued metadata operations identify the payer; callback input contains no actor. */
export class PgAuxiliaryModelAccounting {
 constructor(private readonly db:DatabasePort){}
 private denied(orgId:OrgId){return new CreditConsumptionError('credit_accounting_unavailable','team',orgId,'auxiliary_usage_ownership_denied');}
 async open(orgId:OrgId,userId:string,pinnedModelId:string){const id=randomUUID(),model=pinnedModelId==='deep-agent'?((process.env.KERNEL_DEEP_AGENT_MODEL_ID??'').trim()||'qwen-plus'):pinnedModelId,provider=(process.env.KERNEL_MODEL_PROVIDER??'').trim();if(!model||!provider)throw this.denied(orgId);await this.db.withTenant(orgId,s=>s.query('INSERT INTO auxiliary_model_operations(id,org_id,user_id,model_provider,model_id) VALUES($1,$2,$3,$4,$5)',[id,orgId,userId,provider,model]));return {orgId:String(orgId),operationId:id};}
 async failure(orgId:OrgId,id:string,code:'credit_required'|'credit_accounting_unavailable'){
  const row=await this.db.withTenant(orgId,async s=>(await s.query<{user_id:string}>('SELECT user_id FROM auxiliary_model_operations WHERE org_id=$1 AND id=$2',[orgId,id])).rows[0]);
  if(!row)throw this.denied(orgId);
  const payer=await new PgCreditConsumption(this.db).resolvePayer(orgId,row.user_id);
  return new CreditConsumptionError(code,payer.ownerType,payer.ownerId);
 }
 async close(orgId:OrgId,id:string){await this.db.withTenant(orgId,s=>s.query('UPDATE auxiliary_model_operations SET closed_at=COALESCE(closed_at,now()) WHERE org_id=$1 AND id=$2',[orgId,id]));}
 private async request(orgId:OrgId,operationId:string,requestId:string){return this.db.withTenant(orgId,async s=>{const row=(await s.query<Request>(`SELECT (o.closed_at IS NULL AND o.active_until>now()) AS active,r.operation_id,o.user_id,r.model_id,r.model_provider,r.started_at FROM auxiliary_model_requests r JOIN auxiliary_model_operations o ON o.org_id=r.org_id AND o.id=r.operation_id WHERE r.org_id=$1 AND r.operation_id=$2 AND r.request_id=$3`,[orgId,operationId,requestId])).rows[0];if(!row)throw this.denied(orgId);return row;});}
 async admit(orgId:OrgId,id:string,input:Omit<z.infer<typeof AuxiliaryModelAdmission>,'orgId'>){
  if(process.env.KERNEL_AI_PRODUCT_QUOTA_ENABLED==='1')throw new CreditConsumptionError('credit_accounting_unavailable','team',orgId,'AUXILIARY_PRODUCT_QUOTA_OWNERSHIP_UNSUPPORTED');
  let body:Record<string,unknown>;try{body=JSON.parse(input.serializedBody) as Record<string,unknown>;}catch{throw this.denied(orgId);}
  const caps=[body.max_tokens,body.max_completion_tokens].filter(x=>x!==undefined);
  if(body.model!==input.modelId||!caps.length||caps.some(x=>x!==input.outputTokenLimit)||input.logicalCallId!==JSON.stringify([id,'auxiliary',input.requestId,createHash('sha256').update(input.serializedBody).digest('hex')]))throw this.denied(orgId);
  const provider=(process.env.KERNEL_MODEL_PROVIDER??'').trim();if(!provider)throw this.denied(orgId);
  await this.db.withTenant(orgId,async s=>{
   const op=(await s.query<Op>('SELECT id,user_id,model_provider,model_id,(closed_at IS NULL AND active_until>now()) AS active FROM auxiliary_model_operations WHERE org_id=$1 AND id=$2 FOR UPDATE',[orgId,id])).rows[0];
   if(!op?.active||op.model_provider!==provider||op.model_id!==input.modelId)throw this.denied(orgId);
   const scoped:DatabasePort={withTenant:async(org,work)=>{if(org!==orgId)throw this.denied(orgId);return work(s);},withoutTenant:async()=>{throw this.denied(orgId);},close:async()=>{}};
   const multimodal=/"(?:image_url|input_audio)"\s*:/.test(input.serializedBody);
   await creditUsageMeter(scoped).startRequest(orgId,{requestId:input.requestId,userId:op.user_id,projectId:null,runId:null,executionAttemptId:null,callPurpose:'auxiliary',modelProvider:provider,modelId:input.modelId,startedAt:input.startedAt,maximumTokens:multimodal?null:Buffer.byteLength(input.serializedBody,'utf8')+input.outputTokenLimit});
   await s.query('INSERT INTO auxiliary_model_requests(request_id,org_id,operation_id,model_provider,model_id,started_at,body_hash,output_cap) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(request_id) DO NOTHING',[input.requestId,orgId,id,provider,input.modelId,input.startedAt,createHash('sha256').update(input.serializedBody).digest('hex'),input.outputTokenLimit]);
   const stored=(await s.query<Request>('SELECT operation_id,model_id,model_provider,started_at,body_hash,output_cap FROM auxiliary_model_requests WHERE org_id=$1 AND request_id=$2',[orgId,input.requestId])).rows[0];
   if(!stored||stored.body_hash!==createHash('sha256').update(input.serializedBody).digest('hex')||stored.output_cap!==input.outputTokenLimit||stored.operation_id!==id||stored.model_id!==input.modelId||stored.model_provider!==provider||stored.started_at.toISOString()!==new Date(input.startedAt).toISOString())throw this.denied(orgId);
  });
 }
 async start(orgId:OrgId,id:string,input:Omit<z.infer<typeof AuxiliaryModelStart>,'orgId'>){const row=await this.request(orgId,id,input.requestId);if(!row.active||row.model_id!==input.modelId||row.started_at.toISOString()!==new Date(input.startedAt).toISOString())throw this.denied(orgId);}
 async terminal(orgId:OrgId,id:string,input:Omit<z.infer<typeof AuxiliaryModelTerminal>,'orgId'>){const row=await this.request(orgId,id,input.requestId);if(Date.parse(input.endedAt)<row.started_at.getTime())throw this.denied(orgId);const u=input.usage;await creditUsageMeter(this.db).record(orgId,{eventId:input.requestId,userId:row.user_id,runId:null,callPurpose:'auxiliary',modelProvider:row.model_provider,modelId:row.model_id,requestStartedAt:row.started_at.toISOString(),requestEndedAt:input.endedAt,outcome:input.outcome,totalSource:u.total===undefined?'unknown':'reported',tokensTotal:u.total??0,promptTokens:u.prompt??null,completionTokens:u.completion??null,cacheInputTokens:u.cacheInput??null,reasoningOutputTokens:u.reasoningOutput??null});}
}

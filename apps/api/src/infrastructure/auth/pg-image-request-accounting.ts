import type {DatabasePort} from '../../application/ports/database.port';
import type {ImageRequestAccounting} from '../../application/agent-run/image-request-accounting';
import {resolveRuntimeModelOwner} from './pg-runtime-model-usage-repository';
import {PgTokenUsageRepository} from './pg-token-usage-repository';
import {OPENAI_IMAGE_PROVIDER_NAME} from '../agent-run/openai-image-provider';
/** Actual vendor request receipts, not the image tool/download/verification envelope. */
export class PgImageRequestAccounting implements ImageRequestAccounting {
 constructor(private readonly db:DatabasePort){}
 async start(context:Parameters<ImageRequestAccounting['start']>[0],input:Parameters<ImageRequestAccounting['start']>[1]){
  const owner=await this.db.withTenant(context.orgId,async s=>{
   const owner=await resolveRuntimeModelOwner(s,context.orgId,context.parentRunId,context.leaseEpoch,context.attemptId,'native-image');
   if(!owner)throw new Error('IMAGE_ACCOUNTING_OWNER_DENIED');
   const scoped:DatabasePort={withTenant:async(org,work)=>{if(org!==context.orgId)throw new Error('IMAGE_ACCOUNTING_TENANT_DENIED');return work(s);},withoutTenant:async()=>{throw new Error('IMAGE_ACCOUNTING_TENANT_REQUIRED');},close:async()=>{}};
   await new PgTokenUsageRepository(scoped).startRequest(context.orgId,{...input,userId:owner.user_id,runId:owner.root_run_id,executionAttemptId:context.attemptId,executionLeaseEpoch:context.leaseEpoch,subtaskId:owner.subtask_id,projectId:owner.project_id,threadId:owner.thread_id,agentId:owner.agent_id,modelProvider:OPENAI_IMAGE_PROVIDER_NAME,callPurpose:'native-image'});
   return owner;
  });
  return {terminal:async(receipt:Parameters<Awaited<ReturnType<ImageRequestAccounting['start']>>['terminal']>[0])=>{
   const u=receipt.usage;
   await new PgTokenUsageRepository(this.db).record(context.orgId,{eventId:input.requestId,userId:owner.user_id,runId:owner.root_run_id,subtaskId:owner.subtask_id,projectId:owner.project_id,threadId:owner.thread_id,agentId:owner.agent_id,executionAttemptId:context.attemptId,requestStartedAt:input.startedAt,requestEndedAt:receipt.endedAt,modelProvider:OPENAI_IMAGE_PROVIDER_NAME,modelId:input.modelId,callPurpose:'native-image',outcome:receipt.outcome,
    totalSource:u.total!==undefined?'reported':'unknown',tokensTotal:u.total??0,promptTokens:u.prompt??null,completionTokens:u.completion??null,cacheInputTokens:u.cacheInput??null,reasoningOutputTokens:u.reasoningOutput??null,
    // The requested/delivered image is not proof of the vendor's billed native quantity.
    nativeUsage:{unit:'image',quantity:null,source:'unknown'}});
  }};
 }
}

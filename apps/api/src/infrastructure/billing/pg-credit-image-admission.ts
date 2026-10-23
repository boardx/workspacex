import {creditUsageMeter} from "./credit-usage-meter";
import type {DatabasePort} from '../../application/ports/database.port';
import type {ImageAiAdmission} from '../agent-run/image-ai-admission';
import {resolveRuntimeModelOwner} from '../auth/pg-runtime-model-usage-repository';
/** Credit-only native admission is independent of optional product quota policies. */
export class PgCreditImageAdmission implements ImageAiAdmission {
 constructor(private readonly db:DatabasePort){}
 async start(context:Parameters<ImageAiAdmission['start']>[0],request:Parameters<ImageAiAdmission['start']>[1]){
  const startedAt=new Date().toISOString();
  const owner=await this.db.withTenant(context.orgId,async s=>{
   const owner=await resolveRuntimeModelOwner(s,context.orgId,context.parentRunId,context.leaseEpoch,context.attemptId,'native-image');
   if(!owner)throw new Error('IMAGE_ACCOUNTING_OWNER_DENIED');
   const scoped:DatabasePort={withTenant:async(org,work)=>{if(org!==context.orgId)throw new Error('IMAGE_ACCOUNTING_TENANT_DENIED');return work(s);},withoutTenant:async()=>{throw new Error('IMAGE_ACCOUNTING_TENANT_REQUIRED');},close:async()=>{}};
   await creditUsageMeter(scoped).startRequest(context.orgId,{requestId:request.requestId,userId:owner.user_id,runId:owner.root_run_id,
    executionAttemptId:context.attemptId,executionLeaseEpoch:context.leaseEpoch,subtaskId:owner.subtask_id,projectId:owner.project_id,
    threadId:owner.thread_id,agentId:owner.agent_id,callPurpose:'native-image',modelProvider:request.modelProvider,modelId:request.modelId,startedAt,
    nativeMaximum:{unit:'image',quantity:request.quantity},maximumTokens:request.maximumTokens,tokenBoundRequired:request.tokenBoundRequired});
   return owner;
  });
  return {terminal:async(input:Parameters<Awaited<ReturnType<ImageAiAdmission['start']>>['terminal']>[0])=>{
   await creditUsageMeter(this.db).record(context.orgId,{eventId:request.requestId,userId:owner.user_id,runId:owner.root_run_id,
    subtaskId:owner.subtask_id,executionAttemptId:context.attemptId,projectId:owner.project_id,threadId:owner.thread_id,agentId:owner.agent_id,
    callPurpose:'native-image',modelProvider:request.modelProvider,modelId:request.modelId,requestStartedAt:startedAt,requestEndedAt:input.endedAt,
    totalSource:input.usage?.total===undefined?'not-applicable':'reported',tokensTotal:input.usage?.total??0,promptTokens:input.usage?.prompt??null,completionTokens:input.usage?.completion??null,outcome:input.outcome,
    nativeUsage:{unit:'image',quantity:input.quantity,source:input.quantity===null?'unknown':'reported'}});
  }};
 }
}

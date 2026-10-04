import type {LocalRequestAccounting} from '../../application/identity/local-request-accounting';
import type {TokenUsageMeterPort} from '../../application/agent-run/ports';
import type {IdentityRepository} from '../../application/identity/ports';
import {requireLocalMembership} from '../../application/identity/invoke-local-model';
/** No synthetic Agent run is minted for an authenticated local-model trial. */
export class PgLocalRequestAccounting implements LocalRequestAccounting {
 constructor(private readonly identities:IdentityRepository,private readonly usage:TokenUsageMeterPort){}
 async start(context:Parameters<LocalRequestAccounting['start']>[0],input:Parameters<LocalRequestAccounting['start']>[1]){
  await requireLocalMembership(this.identities,context.userId,context.orgId);
  if(!this.usage.startRequest)throw new Error('LOCAL_ACCOUNTING_START_REQUIRED');
  await this.usage.startRequest(context.orgId,{...input,userId:context.userId,runId:null,projectId:null,executionAttemptId:null,modelProvider:'ollama-local',callPurpose:'local-trial'});
  return {terminal:async(receipt:Parameters<Awaited<ReturnType<LocalRequestAccounting['start']>>['terminal']>[0])=>{
   const u=receipt.usage;
   await this.usage.record(context.orgId,{eventId:input.requestId,userId:context.userId,runId:null,modelProvider:'ollama-local',modelId:input.modelId,callPurpose:'local-trial',requestStartedAt:input.startedAt,requestEndedAt:receipt.endedAt,outcome:receipt.outcome,totalSource:u.total===undefined?'unknown':'reported',tokensTotal:u.total??0,promptTokens:u.prompt??null,completionTokens:u.completion??null});
  }};
 }
}

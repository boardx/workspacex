import type {IdentityRepository} from '../../application/identity/ports';
import type {RecordingUnitOfWork} from '../../application/recording/session-lifecycle-ports';
import type {DatabasePort,TenantSession} from '../../application/ports/database.port';
import type {AsrRequestAccounting} from '../../application/recording/asr-request-accounting';
import {PgPersonalTranscriptionRepository} from '../recording/pg-personal-transcription-repository';
import {resolveRuntimeModelOwner} from './pg-runtime-model-usage-repository';
import {PgTokenUsageRepository} from './pg-token-usage-repository';
export class PgAsrRequestAccounting implements AsrRequestAccounting {
 constructor(private readonly db:DatabasePort,private readonly repositories?:(scoped:DatabasePort)=>{identities:IdentityRepository;recording:RecordingUnitOfWork}){}
 async start(context:Parameters<AsrRequestAccounting['start']>[0],input:Parameters<AsrRequestAccounting['start']>[1]){
  const owner=await this.db.withTenant(context.orgId,async s=>{
   const scoped=this.scoped(context.orgId,s);
   const owner=await this.readOwner(context,s);
   await new PgTokenUsageRepository(scoped).startRequest(context.orgId,{...input,userId:owner.user_id,runId:owner.root_run_id,projectId:owner.project_id,threadId:owner.thread_id,agentId:owner.agent_id,executionAttemptId:context.kind==='run'?context.attemptId:null,executionLeaseEpoch:context.kind==='run'?context.leaseEpoch:undefined,subtaskId:owner.subtask_id,callPurpose:'native-asr'});
   return owner;
  });
  return {terminal:async(receipt:Parameters<Awaited<ReturnType<AsrRequestAccounting['start']>>['terminal']>[0])=>{
   await new PgTokenUsageRepository(this.db).record(context.orgId,{eventId:input.requestId,userId:owner.user_id,runId:owner.root_run_id,subtaskId:owner.subtask_id,projectId:owner.project_id,threadId:owner.thread_id,agentId:owner.agent_id,modelProvider:input.modelProvider,modelId:input.modelId,callPurpose:'native-asr',requestStartedAt:input.startedAt,requestEndedAt:receipt.endedAt,executionAttemptId:context.kind==='run'?context.attemptId:undefined,outcome:receipt.outcome,totalSource:'unknown',tokensTotal:0,promptTokens:null,completionTokens:null,
    nativeUsage:{unit:'millisecond',quantity:receipt.queuedDurationMs,source:receipt.queuedDurationMs===null?'unknown':'estimated'}});
  }};
 }
 /** Resolve only metadata authority while the caller's owner locks remain held. */
 async readOwner(context:Parameters<AsrRequestAccounting['start']>[0],session:TenantSession){
  const validId=(value:unknown)=>typeof value==='string'&&value.length>0;
  if(!validId(context.orgId)||
   (context.kind==='run'? !validId(context.runId)||!validId(context.attemptId)||!Number.isSafeInteger(context.leaseEpoch)||context.leaseEpoch<=0:
    context.kind==='personal-capture'? !validId(context.ownerUserId)||!validId(context.transcriptionId)||!validId(context.captureId):
    context.kind==='recording'? !validId(context.userId)||!validId(context.sessionId):
    context.kind==='draft'? !validId(context.userId):true))throw new Error('ASR_ACCOUNTING_OWNER_DENIED');
  const scoped=this.scoped(context.orgId,session);
  const owner=context.kind==='run'?await resolveRuntimeModelOwner(session,context.orgId,context.runId,context.leaseEpoch,context.attemptId,'native-asr'):
   context.kind==='personal-capture'?await new PgPersonalTranscriptionRepository(scoped).hasActiveCapture(context)?{user_id:context.ownerUserId,root_run_id:null,subtask_id:null,project_id:null,thread_id:null,agent_id:null}:undefined:
   await this.authenticatedOwner(context,scoped);
  if(!owner?.user_id)throw new Error('ASR_ACCOUNTING_OWNER_DENIED');
  return owner;
 }
 private scoped(orgId:Parameters<AsrRequestAccounting['start']>[0]['orgId'],session:TenantSession):DatabasePort{
  return {withTenant:async(org,work)=>{if(org!==orgId)throw new Error('ASR_ACCOUNTING_TENANT_DENIED');return work(session);},withoutTenant:async()=>{throw new Error('ASR_ACCOUNTING_TENANT_REQUIRED');},close:async()=>{}};
 }
 private async authenticatedOwner(context:Extract<Parameters<AsrRequestAccounting['start']>[0],{kind:'draft'|'recording'}>,scoped:DatabasePort){
  const repositories=this.repositories?.(scoped);
  const identities=repositories?.identities,recording=repositories?.recording;
  if(!identities||!await identities.findOrgMembership(context.userId,context.orgId))return undefined;
  let projectId:string|null=null;
  if(context.kind==='recording'){
   if(!recording)return undefined;
   const allowed=await recording.withOrg(context.orgId,{userId:context.userId},async stores=>{
    const session=await stores.sessions.lockedLifecycleSession?.(context.sessionId);
    if(!session||session.endedAt!==null||!await identities!.findProjectMembership(context.userId,session.projectId,context.orgId))return undefined;
    return session.projectId;
   });
   if(!allowed)return undefined;projectId=allowed;
  }
  return {user_id:context.userId,root_run_id:null,subtask_id:null,project_id:projectId,thread_id:null,agent_id:null};
 }
}

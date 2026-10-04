import {withCommittedAiPolicyDecision} from "../../application/agent-run/committed-ai-policy-decision";
import {admitPricedInputOnlyCall,inputOnlyReceiptCost,type InputOnlyRuntimeAdmissionOptions} from '../../application/agent-run/admit-priced-input-only-call';
import {createHash} from "node:crypto";
import type {DatabasePort,TenantSession} from "../../application/ports/database.port";
import type {OrgId} from "../../domain/org-id";
import {RuntimeUsageOwnershipDenied,type RuntimeModelUsagePort} from "../../application/agent-run/runtime-model-usage";
import type {TokenUsageMeterPort} from "../../application/agent-run/ports";
import type {AiAdmissionPort,AiReservedPricePort} from "../../application/agent-run/ai-admission-ports";
import {priceAiTokens} from "../../domain/agent-run/ai-budget";
import {preparePricedModelCall,type AiPricedCallDependencies} from "../../application/agent-run/admit-priced-model-call";
import {PgAiAdmissionRepository} from "./pg-ai-admission-repository";
import {PgTokenUsageRepository} from "./pg-token-usage-repository";
export interface RuntimeAiAdmissionOptions {
 readonly inputOnly?:InputOnlyRuntimeAdmissionOptions;
 readonly dependencies:(orgId:OrgId,scopedDb?:DatabasePort)=>Pick<AiPricedCallDependencies,"model"|"currentCandidates"|"measure">;
 readonly primaryModelId:(modelId:string)=>Promise<string>;
 readonly facts:(orgId:OrgId,owner:RuntimeModelOwner,serializedInput:string,identity:{readonly runId:string;readonly attemptId:string;readonly leaseEpoch:number},scopedDb?:DatabasePort)=>Promise<{confidentiality:"confidential"|"non-confidential"|"unknown";requiredCapabilities:readonly string[]}>;
}
export class PgRuntimeModelUsageRepository implements RuntimeModelUsagePort {
 constructor(private readonly db:DatabasePort,private readonly usage:TokenUsageMeterPort,private readonly admission?:(AiAdmissionPort&AiReservedPricePort),private readonly runtimeAdmission?:RuntimeAiAdmissionOptions){}
  async admitRuntimeRequest(orgId:OrgId,runId:string,input:Parameters<NonNullable<RuntimeModelUsagePort["admitRuntimeRequest"]>>[2]):Promise<void>{
    if(!this.runtimeAdmission)throw new Error("RUNTIME_AI_ADMISSION_DISABLED");
    if("billingMode" in input)return this.admitInputOnlyRuntimeRequest(orgId,runId,input);
    const configured=this.runtimeAdmission;
    let body:Record<string,unknown>;
    try{body=JSON.parse(input.serializedBody);if(!body||typeof body!=="object"||Array.isArray(body))throw new Error();}catch{throw new Error("AI_DISPATCH_BODY_INVALID");}
    const caps=[body.max_tokens,body.max_completion_tokens].filter(value=>value!==undefined);
    if(!Number.isSafeInteger(input.outputTokenLimit)||input.outputTokenLimit<=0||input.outputTokenLimit>2147483647||body.model!==input.modelId||!caps.length||caps.some(value=>!Number.isSafeInteger(value)||value!==input.outputTokenLimit))throw new Error("AI_DISPATCH_BINDING_MISMATCH");
    const logicalCallId=JSON.stringify([runId,input.callPurpose,input.requestId,createHash("sha256").update(input.serializedBody).digest("hex")]);
    if(input.logicalCallId!==logicalCallId)throw new Error("AI_LOGICAL_CALL_IDENTITY_MISMATCH");
    await withCommittedAiPolicyDecision(this.db,orgId,async s=>{
      const owner=await resolveRuntimeModelOwner(s,orgId,runId,input.leaseEpoch,input.attemptId,input.callPurpose);
      if(!owner)throw new RuntimeUsageOwnershipDenied();
      // One existing transaction: owner row locks, policy/window lock, reserve and durable start.
      const scoped:DatabasePort={withTenant:async(tenant,work)=>{if(tenant!==orgId)throw new RuntimeUsageOwnershipDenied();return work(s);},
        withoutTenant:async()=>{throw new RuntimeUsageOwnershipDenied();},close:async()=>{}};
      const budget=new PgAiAdmissionRepository(scoped),meter=new PgTokenUsageRepository(scoped);
      const facts=await configured.facts(orgId,owner,input.serializedBody,{runId,attemptId:input.attemptId,leaseEpoch:input.leaseEpoch},scoped),deps=configured.dependencies(orgId,scoped);
      const prepared=await preparePricedModelCall({orgId,userId:owner.user_id,runId:owner.root_run_id,executionAttemptId:input.attemptId,executionLeaseEpoch:input.leaseEpoch,
        logicalCallId,attempt:0,projectId:owner.project_id,threadId:owner.thread_id,agentId:owner.agent_id,
        callPurpose:input.callPurpose,primaryModelId:await configured.primaryModelId(input.modelId),...facts},
        {...deps,policy:budget,admission:budget,usage:meter});
      if(prepared.modelId!==input.modelId||input.outputTokenLimit>prepared.outputTokenLimit!)throw new Error("AI_DISPATCH_BINDING_MISMATCH");
      await prepared.beforeProviderDispatch!({requestId:input.requestId,modelProvider:prepared.modelProvider,modelId:input.modelId,
        serializedBody:input.serializedBody,outputTokenLimit:input.outputTokenLimit});
      // Shared accounting authority retains child/epoch metadata for late private terminal receipt.
      await this.insertStart(s,orgId,{requestId:input.requestId,userId:owner.user_id,runId:owner.root_run_id,subtaskId:owner.subtask_id,
        executionAttemptId:input.attemptId,executionLeaseEpoch:input.leaseEpoch,projectId:owner.project_id,threadId:owner.thread_id,
        agentId:owner.agent_id,callPurpose:input.callPurpose,modelProvider:prepared.modelProvider,modelId:input.modelId,startedAt:input.startedAt});
    });
  }
  private async admitInputOnlyRuntimeRequest(orgId:OrgId,runId:string,input:Extract<Parameters<NonNullable<RuntimeModelUsagePort["admitRuntimeRequest"]>>[2],{billingMode:"input-only"}>):Promise<void>{
    const configured=this.runtimeAdmission?.inputOnly;if(!configured)throw new Error("AI_INPUT_ONLY_ADMISSION_UNCONFIGURED");
    const digest=createHash("sha256").update(input.serializedBody).digest("hex");
    const logicalCallId=JSON.stringify([runId,input.callPurpose,input.requestId,digest,input.requestPath]);
    if(input.logicalCallId!==logicalCallId)throw new Error("AI_LOGICAL_CALL_IDENTITY_MISMATCH");
    await withCommittedAiPolicyDecision(this.db,orgId,async s=>{
      const owner=await resolveRuntimeModelOwner(s,orgId,runId,input.leaseEpoch,input.attemptId,input.callPurpose);
      if(!owner)throw new RuntimeUsageOwnershipDenied();
      const scoped:DatabasePort={withTenant:async(tenant,work)=>{if(tenant!==orgId)throw new RuntimeUsageOwnershipDenied();return work(s);},withoutTenant:async()=>{throw new RuntimeUsageOwnershipDenied();},close:async()=>{}};
      const budget=new PgAiAdmissionRepository(scoped);
      const facts=await this.runtimeAdmission!.facts(orgId,owner,input.serializedBody,{runId,attemptId:input.attemptId,leaseEpoch:input.leaseEpoch},scoped);
      const decision=await admitPricedInputOnlyCall({orgId,userId:owner.user_id,agentId:owner.agent_id,logicalCallId,attempt:0,
       primaryModelId:await configured.primaryModelId(input.modelId),...facts},
       {...input,modelProvider:configured.provider},{...configured.dependencies(orgId,scoped),policy:budget,admission:budget});
      await this.insertStart(s,orgId,{requestId:input.requestId,userId:owner.user_id,runId:owner.root_run_id,subtaskId:owner.subtask_id,
       executionAttemptId:input.attemptId,executionLeaseEpoch:input.leaseEpoch,projectId:owner.project_id,threadId:owner.thread_id,
       agentId:owner.agent_id,callPurpose:input.callPurpose,modelProvider:decision.modelProvider,modelId:decision.runtimeModelId,startedAt:input.startedAt});
    });
  }
  async startRuntimeRequest(orgId:OrgId,runId:string,input:Parameters<RuntimeModelUsagePort["startRuntimeRequest"]>[2]):Promise<void>{
    if(this.runtimeAdmission)throw new Error("RUNTIME_AI_ADMISSION_REQUIRED");
    const provider=(process.env.KERNEL_MODEL_PROVIDER??"").trim();if(!provider)throw new Error("RUNTIME_USAGE_PROVIDER_UNCONFIGURED");
    await this.db.withTenant(orgId,async s=>{
      const existing=await s.query<{run_id:string;subtask_id:string|null;execution_attempt_id:string;execution_lease_epoch:string;model_id:string;call_purpose:string;started_at:Date}>(
        "SELECT run_id,subtask_id,execution_attempt_id,execution_lease_epoch,model_id,call_purpose,started_at FROM model_request_starts WHERE id=$1",[input.requestId]);
      const replay=existing.rows[0];
      if(replay){if((replay.subtask_id??replay.run_id)!==runId||replay.execution_attempt_id!==input.attemptId||Number(replay.execution_lease_epoch)!==input.leaseEpoch||replay.model_id!==input.modelId||replay.call_purpose!==input.callPurpose||replay.started_at.toISOString()!==new Date(input.startedAt).toISOString())throw new RuntimeUsageOwnershipDenied();return;}
      const owner=await resolveRuntimeModelOwner(s,orgId,runId,input.leaseEpoch,input.attemptId,input.callPurpose);
      if(!owner?.user_id)throw new RuntimeUsageOwnershipDenied();
      await this.insertStart(s,orgId,{requestId:input.requestId,userId:owner.user_id,runId:owner.root_run_id,subtaskId:owner.subtask_id,executionAttemptId:input.attemptId,
        projectId:owner.project_id,threadId:owner.thread_id,agentId:owner.agent_id,callPurpose:input.callPurpose,modelProvider:provider,
        modelId:input.modelId,startedAt:input.startedAt,executionLeaseEpoch:input.leaseEpoch});
    });
  }
  async terminalRuntimeRequest(orgId:OrgId,runId:string,input:Parameters<RuntimeModelUsagePort["terminalRuntimeRequest"]>[2]):Promise<void>{
    // Late terminal receipts remain acceptable after cancellation/lease expiry, but only for their durable start.
    const row=await this.db.withTenant(orgId,async s=>(await s.query<{user_id:string;run_id:string;subtask_id:string|null;execution_attempt_id:string;execution_lease_epoch:string;project_id:string|null;thread_id:string|null;agent_id:string|null;model_provider:string;model_id:string;call_purpose:string;started_at:Date}>(
      "SELECT user_id,run_id,subtask_id,execution_attempt_id,execution_lease_epoch,project_id,thread_id,agent_id,model_provider,model_id,call_purpose,started_at FROM model_request_starts WHERE id=$1",[input.requestId])).rows[0]);
    if(!row||(row.subtask_id??row.run_id)!==runId||row.execution_attempt_id!==input.attemptId||Number(row.execution_lease_epoch)!==input.leaseEpoch||Date.parse(input.endedAt)<row.started_at.getTime())throw new RuntimeUsageOwnershipDenied();
    const snapshot=await this.admission?.readReservedPrice(orgId,input.requestId);
    if(snapshot&&(snapshot.userId!==row.user_id||snapshot.modelProvider!==row.model_provider||snapshot.modelId!==row.model_id||("billingMode" in snapshot.price)&&row.call_purpose!=="retrieval-embedding"))throw new RuntimeUsageOwnershipDenied();
    const {total,prompt,completion,cacheInput,reasoningOutput}=input.usage;
    const complete=snapshot&&("outputMicrosPerMillion" in snapshot.price)&&total!==undefined&&prompt!==undefined&&completion!==undefined&&BigInt(prompt)+BigInt(completion)===BigInt(total)
     &&(cacheInput===undefined?snapshot.price.cachedInputMicrosPerMillion===snapshot.price.inputMicrosPerMillion:cacheInput<=prompt)
     &&(reasoningOutput===undefined||reasoningOutput<=completion);
    const cost=snapshot&&("billingMode" in snapshot.price)?inputOnlyReceiptCost({version:snapshot.priceVersion,currency:snapshot.currency,inputMicrosPerMillion:BigInt(snapshot.price.inputMicrosPerMillion),cachedInputMicrosPerMillion:BigInt(snapshot.price.cachedInputMicrosPerMillion)},input.usage):complete&&("outputMicrosPerMillion" in snapshot!.price)?priceAiTokens({version:snapshot.priceVersion,currency:snapshot.currency,inputMicrosPerMillion:BigInt(snapshot.price.inputMicrosPerMillion),outputMicrosPerMillion:BigInt(snapshot.price.outputMicrosPerMillion),cachedInputMicrosPerMillion:BigInt(snapshot.price.cachedInputMicrosPerMillion)},{input:BigInt(prompt!),output:BigInt(completion!),...(cacheInput===undefined?{}:{cachedInput:BigInt(cacheInput)})}):null;
    await this.usage.record(orgId,{eventId:input.requestId,userId:row.user_id,runId:row.run_id,subtaskId:row.subtask_id,executionAttemptId:row.execution_attempt_id,
      projectId:row.project_id,threadId:row.thread_id,agentId:row.agent_id,callPurpose:row.call_purpose as NonNullable<import("../../application/agent-run/ports").TokenUsageRecord["callPurpose"]>,modelProvider:row.model_provider,modelId:row.model_id,
      requestStartedAt:row.started_at.toISOString(),requestEndedAt:input.endedAt,totalSource:input.usage.total===undefined?"unknown":"reported",
      tokensTotal:input.usage.total??0,promptTokens:input.usage.prompt??null,completionTokens:input.usage.completion??null,
      cacheInputTokens:cacheInput!==undefined&&prompt!==undefined&&cacheInput<=prompt?cacheInput:null,reasoningOutputTokens:reasoningOutput!==undefined&&completion!==undefined&&reasoningOutput<=completion?reasoningOutput:null,
      ...(cost===null||!snapshot?{}:{costMicros:cost,currency:snapshot.currency,priceVersion:snapshot.priceVersion}),outcome:input.outcome});
    if(snapshot)await this.admission!.settle(orgId,input.requestId,{tokens:total===undefined?null:BigInt(total),costMicros:cost});
  }
 private async insertStart(s:TenantSession,orgId:OrgId,input:{requestId:string;userId:string;runId:string;executionAttemptId:string;projectId:string|null;threadId:string|null;agentId:string|null;callPurpose:string;modelProvider:string;modelId:string;startedAt:string;executionLeaseEpoch:number;subtaskId?:string|null}):Promise<void>{
  const inserted=await s.query(`INSERT INTO model_request_starts(id,org_id,user_id,run_id,execution_attempt_id,project_id,model_provider,model_id,started_at,thread_id,agent_id,call_purpose,execution_lease_epoch,subtask_id)
   VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) ON CONFLICT(id) DO NOTHING RETURNING id`,
   [input.requestId,orgId,input.userId,input.runId,input.executionAttemptId,input.projectId,input.modelProvider,input.modelId,input.startedAt,input.threadId,input.agentId,input.callPurpose,input.executionLeaseEpoch,input.subtaskId??null]);
  if(!inserted.rows.length){
   // A concurrent identical callback may have won after our first lookup. Verify the
   // immutable row in this tenant before acknowledging; a foreign collision stays hidden.
   const replay=await s.query(`SELECT id FROM model_request_starts WHERE id=$1 AND org_id=$2
    AND user_id=$3 AND run_id=$4 AND execution_attempt_id=$5 AND project_id IS NOT DISTINCT FROM $6
    AND model_provider=$7 AND model_id=$8 AND started_at=$9::timestamptz
    AND thread_id IS NOT DISTINCT FROM $10 AND agent_id IS NOT DISTINCT FROM $11
    AND call_purpose=$12 AND execution_lease_epoch=$13 AND subtask_id IS NOT DISTINCT FROM $14`,
    [input.requestId,orgId,input.userId,input.runId,input.executionAttemptId,input.projectId,input.modelProvider,input.modelId,
      input.startedAt,input.threadId,input.agentId,input.callPurpose,input.executionLeaseEpoch,input.subtaskId??null]);
   if(!replay.rows.length)throw new RuntimeUsageOwnershipDenied();
  }
 }
}

export interface RuntimeModelOwner {
 readonly user_id:string;readonly project_id:string;readonly thread_id:string;readonly agent_id:string;
 readonly root_run_id:string;readonly subtask_id:string|null;
}
/** Shared metadata-only authority for private accounting and admission. Caller content
 * cannot supply requester, project or parent ownership. Must run inside a tenant transaction.
 * Row locks fence root/child cancellation and lease changes until the caller persists intent.
 */
export async function resolveRuntimeModelOwner(s:TenantSession,orgId:OrgId,runId:string,
 leaseEpoch:number,attemptId:string,callPurpose:string):Promise<RuntimeModelOwner|undefined>{
      const root=await s.query<RuntimeModelOwner>(`SELECT m.author_id AS user_id,t.project_id,r.thread_id,r.agent_id,r.id AS root_run_id,NULL::text AS subtask_id
        FROM agent_runs r JOIN chat_threads t ON t.org_id=r.org_id AND t.id=r.thread_id
        JOIN chat_messages m ON m.org_id=r.org_id AND m.id=r.input_message_id
        WHERE r.org_id=$1 AND r.id=$2 AND r.status='running' AND r.cancel_requested_at IS NULL
          AND r.lease_epoch=$3 AND r.lease_expires_at>now()
          AND ($4=(SELECT r.id||':'||(s.seq-1)::text FROM agent_run_steps s WHERE s.org_id=r.org_id AND s.run_id=r.id AND s.kind='context_built' AND s.started_at>=r.started_at ORDER BY s.seq DESC LIMIT 1) OR ($5 IN ('history-summary','script-retry') AND $4=r.id||':lease:'||$3::text||':'||$5))
        FOR SHARE OF r`,[orgId,runId,leaseEpoch,attemptId,callPurpose]);
      const owner=root.rows[0]??(await s.query<typeof root.rows[number]>(`SELECT m.author_id AS user_id,t.project_id,p.thread_id,p.agent_id,p.id AS root_run_id,c.id AS subtask_id
        FROM subtask_runs c JOIN agent_runs p ON p.org_id=c.org_id AND p.id=c.parent_run_id
        JOIN chat_threads t ON t.org_id=p.org_id AND t.id=p.thread_id JOIN chat_messages m ON m.org_id=p.org_id AND m.id=p.input_message_id
        WHERE c.org_id=$1 AND c.id=$2 AND c.status='running' AND c.cancel_requested_at IS NULL AND p.cancel_requested_at IS NULL
          AND c.lease_epoch=$3 AND c.execution_attempt_id=$4 FOR SHARE OF p,c`,[orgId,runId,leaseEpoch,attemptId])).rows[0];
      if(!owner?.user_id)return undefined;
      return {user_id:owner.user_id,project_id:owner.project_id,thread_id:owner.thread_id,
        agent_id:owner.agent_id,root_run_id:owner.root_run_id,subtask_id:owner.subtask_id};
}

/** Private transaction-bound start identity; explicit projection, never a SQL row or content. */
export async function resolveArtifactRequestStart(s:TenantSession,orgId:OrgId,requestId:string){
 const result=await s.query<{user_id:string;project_id:string|null;artifact_operation_id:string;model_provider:string;model_id:string;started_at:Date}>(
  "SELECT user_id,project_id,artifact_operation_id,model_provider,model_id,started_at FROM model_request_starts WHERE org_id=$1 AND id=$2 AND run_id IS NULL AND call_purpose='retrieval-embedding' AND artifact_operation_id IS NOT NULL",[orgId,requestId]);
 const row=result.rows[0];return row?{user_id:row.user_id,project_id:row.project_id,artifact_operation_id:row.artifact_operation_id,model_provider:row.model_provider,model_id:row.model_id,started_at:row.started_at}:undefined;
}

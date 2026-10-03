import type {DatabasePort,TenantSession} from "../../application/ports/database.port";
import type {OrgId} from "../../domain/org-id";
import {RuntimeUsageOwnershipDenied,type RuntimeModelUsagePort} from "../../application/agent-run/runtime-model-usage";
import type {TokenUsageMeterPort} from "../../application/agent-run/ports";
export class PgRuntimeModelUsageRepository implements RuntimeModelUsagePort {
 constructor(private readonly db:DatabasePort,private readonly usage:TokenUsageMeterPort){}
  async startRuntimeRequest(orgId:OrgId,runId:string,input:Parameters<RuntimeModelUsagePort["startRuntimeRequest"]>[2]):Promise<void>{
    const provider=(process.env.KERNEL_MODEL_PROVIDER??"").trim();if(!provider)throw new Error("RUNTIME_USAGE_PROVIDER_UNCONFIGURED");
    await this.db.withTenant(orgId,async s=>{
      const existing=await s.query<{run_id:string;subtask_id:string|null;execution_attempt_id:string;execution_lease_epoch:string;model_id:string;call_purpose:string;started_at:Date}>(
        "SELECT run_id,subtask_id,execution_attempt_id,execution_lease_epoch,model_id,call_purpose,started_at FROM model_request_starts WHERE id=$1",[input.requestId]);
      const replay=existing.rows[0];
      if(replay){if((replay.subtask_id??replay.run_id)!==runId||replay.execution_attempt_id!==input.attemptId||Number(replay.execution_lease_epoch)!==input.leaseEpoch||replay.model_id!==input.modelId||replay.call_purpose!==input.callPurpose||replay.started_at.toISOString()!==new Date(input.startedAt).toISOString())throw new RuntimeUsageOwnershipDenied();return;}
      // Metadata columns only: model/browser arguments cannot choose user/project ownership.
      const root=await s.query<{user_id:string;project_id:string;thread_id:string;agent_id:string;root_run_id:string;subtask_id:string|null}>(`SELECT m.author_id AS user_id,t.project_id,r.thread_id,r.agent_id,r.id AS root_run_id,NULL::text AS subtask_id
        FROM agent_runs r JOIN chat_threads t ON t.org_id=r.org_id AND t.id=r.thread_id
        JOIN chat_messages m ON m.org_id=r.org_id AND m.id=r.input_message_id
        WHERE r.org_id=$1 AND r.id=$2 AND r.status='running' AND r.cancel_requested_at IS NULL
          AND r.lease_epoch=$3 AND r.lease_expires_at>now()
          AND ($4=(SELECT r.id||':'||(s.seq-1)::text FROM agent_run_steps s WHERE s.org_id=r.org_id AND s.run_id=r.id AND s.kind='context_built' AND s.started_at>=r.started_at ORDER BY s.seq DESC LIMIT 1) OR ($5 IN ('history-summary','script-retry') AND $4=r.id||':lease:'||$3::text||':'||$5))
        FOR SHARE OF r`,[orgId,runId,input.leaseEpoch,input.attemptId,input.callPurpose]);
      const owner=root.rows[0]??(await s.query<typeof root.rows[number]>(`SELECT m.author_id AS user_id,t.project_id,p.thread_id,p.agent_id,p.id AS root_run_id,c.id AS subtask_id
        FROM subtask_runs c JOIN agent_runs p ON p.org_id=c.org_id AND p.id=c.parent_run_id
        JOIN chat_threads t ON t.org_id=p.org_id AND t.id=p.thread_id JOIN chat_messages m ON m.org_id=p.org_id AND m.id=p.input_message_id
        WHERE c.org_id=$1 AND c.id=$2 AND c.status='running' AND c.cancel_requested_at IS NULL AND p.cancel_requested_at IS NULL
          AND c.lease_epoch=$3 AND c.execution_attempt_id=$4 FOR SHARE OF p,c`,[orgId,runId,input.leaseEpoch,input.attemptId])).rows[0];
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
    await this.usage.record(orgId,{eventId:input.requestId,userId:row.user_id,runId:row.run_id,subtaskId:row.subtask_id,executionAttemptId:row.execution_attempt_id,
      projectId:row.project_id,threadId:row.thread_id,agentId:row.agent_id,callPurpose:row.call_purpose as "primary"|"history-summary"|"script-retry",modelProvider:row.model_provider,modelId:row.model_id,
      requestStartedAt:row.started_at.toISOString(),requestEndedAt:input.endedAt,totalSource:input.usage.total===undefined?"unknown":"reported",
      tokensTotal:input.usage.total??0,promptTokens:input.usage.prompt??null,completionTokens:input.usage.completion??null,
      cacheInputTokens:input.usage.cacheInput??null,reasoningOutputTokens:input.usage.reasoningOutput??null,outcome:input.outcome});
  }
 private async insertStart(s:TenantSession,orgId:OrgId,input:{requestId:string;userId:string;runId:string;executionAttemptId:string;projectId:string|null;threadId:string|null;agentId:string|null;callPurpose:string;modelProvider:string;modelId:string;startedAt:string;executionLeaseEpoch:number;subtaskId?:string|null}):Promise<void>{
  const inserted=await s.query(`INSERT INTO model_request_starts(id,org_id,user_id,run_id,execution_attempt_id,project_id,model_provider,model_id,started_at,thread_id,agent_id,call_purpose,execution_lease_epoch,subtask_id)
   VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) ON CONFLICT(id) DO NOTHING RETURNING id`,
   [input.requestId,orgId,input.userId,input.runId,input.executionAttemptId,input.projectId,input.modelProvider,input.modelId,input.startedAt,input.threadId,input.agentId,input.callPurpose,input.executionLeaseEpoch,input.subtaskId??null]);
  if(!inserted.rows.length)throw new RuntimeUsageOwnershipDenied();
 }
}

import { recoverFinalMessageIdentity } from "../../application/agent-run/recover-final-message";
import { recoveryExplanation } from "../../application/agent-run/run-recovery";
import { DEFAULT_STALE_RUNNING_THRESHOLD_MS } from "../../application/agent-run/ports";
import type { DatabasePort } from "../../application/ports/database.port";
import type { OrgId } from "../../domain/org-id";
import type { AgentRunStore } from "../../application/agent-run/ports";
import type { RemoteRunReconciler } from "../../application/agent-run/run-recovery";
import { withRunLease } from "../../application/agent-run/run-lease";
interface RecoveryRow {id:string;thread_id:string;remote_run_id:string|null;lease_epoch:number;recovery_attempts:number;model_provider:string}
/** One bounded tenant-scoped batch. Lease expiry elects a reader of the existing
 * remote operation, never authorizes a fresh model/tool/sandbox submission. */
export class PgRunRecovery {
  constructor(private readonly db:DatabasePort,private readonly runs:AgentRunStore,private readonly remote:RemoteRunReconciler){}
  async tick(orgId:OrgId):Promise<number>{
    const candidates=await this.db.withTenant(orgId,async s=>(await s.query<RecoveryRow>(`
      UPDATE agent_runs r SET lease_epoch=lease_epoch+1,lease_expires_at=now()+($2::bigint * interval '1 millisecond'),
        recovery_attempts=recovery_attempts+1,recovery_diagnostic='正在核对远端执行状态'
      WHERE r.org_id=$1 AND r.id IN (SELECT id FROM agent_runs WHERE org_id=$1 AND status='running'
        AND coalesce(lease_expires_at,coalesce(heartbeat_at,started_at)+($2::bigint * interval '1 millisecond'))<now()
        ORDER BY started_at,id LIMIT 10 FOR UPDATE SKIP LOCKED)
      RETURNING id,thread_id,remote_run_id,lease_epoch,recovery_attempts,model_provider`,[orgId,DEFAULT_STALE_RUNNING_THRESHOLD_MS])).rows);
    for(const run of candidates){
      await withRunLease({orgId,runId:run.id,epoch:run.lease_epoch,verify:()=>this.runs.heartbeatRun?.(orgId,run.id)??Promise.resolve()},async()=>{
        const result=run.model_provider!=="deep-agent"?{kind:"uncertain" as const,diagnostic:"provider_recovery_unsupported"}:
          run.remote_run_id?await this.remote.reconcileExistingRun(run.thread_id,run.remote_run_id,run.id):{kind:"uncertain" as const,diagnostic:"remote_run_id_not_recorded"};
        if(result.kind==="success"){
          await recoverFinalMessageIdentity(this.runs,orgId,run.id,result.completion.finalMessageId);
          const finalStepSeq=await this.db.withTenant(orgId,async s=>Number((await s.query<{seq:number}>("SELECT COALESCE(MAX(seq),0) AS seq FROM agent_run_steps WHERE org_id=$1 AND run_id=$2",[orgId,run.id])).rows[0]?.seq??0));
          await this.runs.storeOutputAwaitingWriteback(orgId,run.id,{text:result.completion.text,finalStepSeq});
          await this.diagnostic(orgId,run.id,"远端执行已完成，正在恢复回复");
        }else if(result.kind==="paused"){
          await this.runs.pauseAtCheckpoint?.(orgId,run.id);
        }else if(result.kind==="cancelled"){
          await this.runs.cancelAtCheckpoint?.(orgId,run.id);
        }else if(result.kind==="approval"&&result.toolName!=="unknown"){
          await this.runs.markAwaitingToolPermission(orgId,run.id,result);
        }else if(result.kind==="failed"||(result.kind==="uncertain"&&run.recovery_attempts>=5)){
          await this.diagnostic(orgId,run.id,`恢复需人工核对：${recoveryExplanation(result.diagnostic)}`);
          await this.runs.failRun(orgId,run.id,"RUN_INTERRUPTED");
        }else{
          if(result.kind==="running")await this.db.withTenant(orgId,s=>s.query("UPDATE agent_runs SET recovery_attempts=0 WHERE org_id=$1 AND id=$2",[orgId,run.id]));
          await this.diagnostic(orgId,run.id,result.kind==="running"?"远端仍在执行，继续核对原任务":`正在恢复：${recoveryExplanation("diagnostic" in result?result.diagnostic:result.kind)}`);
        }
      });
    }
    return candidates.length;
  }
  private async diagnostic(orgId:OrgId,runId:string,text:string){
    await this.db.withTenant(orgId,s=>s.query("UPDATE agent_runs SET recovery_diagnostic=$3 WHERE org_id=$1 AND id=$2",[orgId,runId,text.slice(0,256)]));
  }
}

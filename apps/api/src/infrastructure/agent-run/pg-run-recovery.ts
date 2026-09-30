import { REQUEST_HANDOFF_TOOL_NAME } from "@repo/contracts/agent-role";
import { handoffEditedArgs, requestAgentHandoff } from "../../application/agent/agent-handoff";
import { PgAgentHandoffStore } from "../agent/pg-agent-handoff-store";
import type { NativeOutputStaging } from "../../application/agent-run/native-output-staging";
import { AGENT_WORKFLOW_START_TOOL_NAME, recoverAgentWorkflowStart, workflowStartEditedArgs } from "../../application/agent/request-agent-workflow-start";
import type { NativeSessionOwner } from "../../application/agent-run/native-session-owner";
import { recoverFinalMessageIdentity } from "../../application/agent-run/recover-final-message";
import { recoveryExplanation } from "../../application/agent-run/run-recovery";
import { DEFAULT_STALE_RUNNING_THRESHOLD_MS } from "../../application/agent-run/ports";
import type { DatabasePort } from "../../application/ports/database.port";
import type { OrgId } from "../../domain/org-id";
import type { AgentRunStore } from "../../application/agent-run/ports";
import type { ToolPermissionGrantStore } from "../../application/agent-run/tool-permission-grants";
import type { RemoteRunReconciler } from "../../application/agent-run/run-recovery";
import { PgWorkflowReceiptStore } from "../workflow/pg-workflow-receipt-store";
import { executedViaKernelRuntime } from "../../application/agent-run/capability-runtime-routing";
import { withRunLease } from "../../application/agent-run/run-lease";
interface RecoveryRow {id:string;thread_id:string;remote_run_id:string|null;remote_thread_id:string|null;lease_epoch:number;recovery_attempts:number;model_provider:string;runtime_profile:"legacy"|"native-v1"}
/** One bounded tenant-scoped batch. Lease expiry elects a reader of the existing
 * remote operation, never authorizes a fresh model/tool/sandbox submission. */
export class PgRunRecovery {
  /**
   * issue #3420 —— `grants` 是恢复流程**必须**问的那一句：远端读回「停在一个待批工具
   * 调用上」并不等于「这次调用还需要人表态」。用户可能在这条 run 上已经选过「本 run 内
   * 都允许」（`tool_permission_grants` 的 run 级记录），此前这里完全不看授权存储，
   * 一律 `markAwaitingToolPermission` ⇒ 同一个工具把人第二次叫醒（#3420 实测形态）。
   * 可选：不注入 ⇒ 逐字回到改动前的行为（一律问人，fail closed，不会放宽任何东西）。
   */
  constructor(private readonly db:DatabasePort,private readonly runs:AgentRunStore,private readonly remote:RemoteRunReconciler,private readonly nativeOutputs?:Pick<NativeOutputStaging,"listFiles">,private readonly nativeSessions?:NativeSessionOwner,private readonly grants?:ToolPermissionGrantStore,
    /** 数字人能力（决策 B）：经 deep-agent 运行时执行的 dashscope 等 run 同样按 deep-agent 恢复。缺省空集 ⇒ 与此前逐字相同。 */
    private readonly kernelServed:ReadonlySet<string>=new Set()){}
  async tick(orgId:OrgId):Promise<number>{
    const candidates=await this.db.withTenant(orgId,async s=>(await s.query<RecoveryRow>(`
      UPDATE agent_runs r SET lease_epoch=lease_epoch+1,lease_expires_at=now()+($2::bigint * interval '1 millisecond'),
        recovery_attempts=recovery_attempts+1,recovery_diagnostic='正在核对远端执行状态'
      WHERE r.org_id=$1 AND r.id IN (SELECT id FROM agent_runs WHERE org_id=$1 AND status='running'
        AND coalesce(lease_expires_at,coalesce(heartbeat_at,started_at)+($2::bigint * interval '1 millisecond'))<now()
        ORDER BY started_at,id LIMIT 10 FOR UPDATE SKIP LOCKED)
      RETURNING id,thread_id,remote_run_id,remote_thread_id,lease_epoch,recovery_attempts,model_provider,runtime_profile`,[orgId,DEFAULT_STALE_RUNNING_THRESHOLD_MS])).rows);
    for(const run of candidates){
      await withRunLease({orgId,runId:run.id,epoch:run.lease_epoch,verify:()=>this.runs.heartbeatRun?.(orgId,run.id)??Promise.resolve()},async()=>{
        // 判据与路由同源（`readRunWorkflowContext`：钉住版本的白名单 + 版本自身钉的 Skill 数，不看 run 的
        // skill_version_ids——那里并入了组织已启用 Skill）；只在可能相关时才读，普通 run 不多一次查询。
        const ctx=run.model_provider!=="deep-agent"&&this.kernelServed.has(run.model_provider)?await this.runs.readRunWorkflowContext?.(orgId,run.id):null;
        let result=!executedViaKernelRuntime({modelProvider:run.model_provider,kernelServedProviders:this.kernelServed,skillCount:ctx?.agentPinnedSkillCount??0,workflowAllowlistCount:ctx?.workflowAllowlist.length??0})?{kind:"uncertain" as const,diagnostic:"provider_recovery_unsupported"}:
          run.remote_run_id?await this.remote.reconcileExistingRun(run.thread_id,run.remote_run_id,run.id,run.remote_thread_id??undefined,run.runtime_profile):{kind:"uncertain" as const,diagnostic:"remote_run_id_not_recorded"};
        if (result.kind === "success" && run.runtime_profile === "native-v1" && !this.nativeOutputs) result = { kind: "uncertain", diagnostic: "native_output_delivery_unavailable" };
        let terminal = false;
        if(result.kind==="success"){
          await recoverFinalMessageIdentity(this.runs,orgId,run.id,result.completion.finalMessageId);
          const finalStepSeq=await this.db.withTenant(orgId,async s=>Number((await s.query<{seq:number}>("SELECT COALESCE(MAX(seq),0) AS seq FROM agent_run_steps WHERE org_id=$1 AND run_id=$2",[orgId,run.id])).rows[0]?.seq??0));
          const files = run.runtime_profile === "native-v1" ? await this.nativeOutputs!.listFiles(orgId,run.id) : undefined;
          await this.runs.storeOutputAwaitingWriteback(orgId,run.id,{text:result.completion.text,finalStepSeq,...(files ? {files} : {})});
          await this.diagnostic(orgId,run.id,"远端执行已完成，正在恢复回复");
          terminal = true;
        }else if(result.kind==="paused"){
          await this.runs.pauseAtCheckpoint?.(orgId,run.id);
        }else if(result.kind==="cancelled"){
          await this.runs.cancelAtCheckpoint?.(orgId,run.id);
          terminal = true;
        }else if(result.kind==="approval"&&result.toolName!=="unknown"){
          // #3420：已被本 run（或组织级）授权过的工具，不再叫醒用户——直接带着 approve
          // 重新入队，让它自己继续跑。判据取自授权存储本身，不是界面痕迹。
          // AG05：start_workflow 的结果只由服务端算出。恢复路径不叫醒人、也不 approve（approve 会执行模型原参数，
          // 连同模型自填的 outcome）：只读查 WF03 回执（同一 requestId）——已落定 ⇒ started + 该实例 / 同一拒绝；无回执 ⇒
          // 未发起；未落定 ⇒ 无法确认（不说未发起）。都以 edit（服务端重建参数，丢弃模型的 outcome）交回。
          if(result.toolName===AGENT_WORKFLOW_START_TOOL_NAME&&this.runs.requeueToolCallWithResult){
            const outcome=await recoverAgentWorkflowStart(new PgWorkflowReceiptStore(this.db),{orgId,runId:run.id,argsJson:result.argsSummary,toolCallId:result.toolCallId});
            if(await this.runs.requeueToolCallWithResult(orgId,run.id,result,workflowStartEditedArgs(result.argsSummary,outcome)))return;
          }
          // AG07：request_handoff 同理——重放网关判定（handoff 行按 run + 工具调用 id 幂等，只落一行），以 edit 交回。
          if(result.toolName===REQUEST_HANDOFF_TOOL_NAME&&this.runs.requeueToolCallWithResult){
            const outcome=await requestAgentHandoff({handoffs:new PgAgentHandoffStore(this.db)},{orgId,runId:run.id,argsJson:result.argsSummary,toolCallId:result.toolCallId});
            if(await this.runs.requeueToolCallWithResult(orgId,run.id,result,handoffEditedArgs(result.argsSummary,outcome)))return;
          }
          const authorized=result.toolName!==AGENT_WORKFLOW_START_TOOL_NAME&&result.toolName!==REQUEST_HANDOFF_TOOL_NAME&&(await this.grants?.hasGrant(orgId,run.id,result.toolName)??false);
          if(!(authorized&&await this.runs.requeueAuthorizedToolCall?.(orgId,run.id,result)))
            await this.runs.markAwaitingToolPermission(orgId,run.id,result);
        }else if(result.kind==="failed"||(result.kind==="uncertain"&&run.recovery_attempts>=5)){
          await this.diagnostic(orgId,run.id,`恢复需人工核对：${recoveryExplanation(result.diagnostic)}`);
          await this.runs.failRun(orgId,run.id,"RUN_INTERRUPTED");
          terminal = true;
        }else{
          if(result.kind==="running")await this.db.withTenant(orgId,s=>s.query("UPDATE agent_runs SET recovery_attempts=0 WHERE org_id=$1 AND id=$2",[orgId,run.id]));
          await this.diagnostic(orgId,run.id,result.kind==="running"?"远端仍在执行，继续核对原任务":`正在恢复：${recoveryExplanation("diagnostic" in result?result.diagnostic:result.kind)}`);
        }
        if (run.runtime_profile === "native-v1" && terminal) {
          try {
            if (!this.nativeSessions) throw new Error("native_session_cleanup_unavailable");
            await this.nativeSessions.releaseForRun(orgId,run.id);
          }
          catch { await this.diagnostic(orgId,run.id,"执行已结束，沙箱释放尚待确认"); }
        }
      });
    }
    return candidates.length;
  }
  private async diagnostic(orgId:OrgId,runId:string,text:string){
    await this.db.withTenant(orgId,s=>s.query("UPDATE agent_runs SET recovery_diagnostic=$3 WHERE org_id=$1 AND id=$2",[orgId,runId,text.slice(0,256)]));
  }
}

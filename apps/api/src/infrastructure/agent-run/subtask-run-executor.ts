import { randomUUID } from "node:crypto";
import type {SubtaskContextResolver} from '../../application/agent-run/standard-subtask-tools';
import {NATIVE_SUBTASK_CONTEXT_PREFIX} from '@repo/contracts/standard-subtask-tools';
import { setTimeout as delay } from 'node:timers/promises';
import type { DatabasePort } from "../../application/ports/database.port";
import type { LoggerPort } from "../../application/ports/logger.port";
import { SUBTASK_STALE_RUNNING_THRESHOLD_MS, SubtaskCancellationPendingError } from "../../application/agent-run/subtask-run-queue";
import type { AgentRunStore,ModelCallPort } from "../../application/agent-run/ports";
import { executeQueuedSubtaskRuns, type SubtaskRunStore, type SubtaskRun, type SubtaskExecutionState } from "../../application/agent-run/subtask-run-queue";
import type { EngineRunController } from '../../application/plan-control/engine-run-controller-port';
import { deriveRemoteThreadId } from './deep-agent-model-provider';
import type { OrgId } from "../../domain/org-id";
import type {NativeOutputStaging} from '../../application/agent-run/native-output-staging';

/** Same tenant kick lifecycle. Recovery only interrupts persisted remote identities;
 * it never recreates a model run or claims that HTTP abort stopped vendor compute. */
export class SubtaskRunExecutor {
  private readonly active=new Map<string,AbortController>();
  constructor(private readonly store: SubtaskRunStore, private readonly db: DatabasePort,
    private readonly model: ModelCallPort, private readonly logger: LoggerPort,
    private readonly autostart: boolean,
    private readonly executionTimeouts: ReadonlyMap<string, number> = new Map(),
    private readonly engine?:EngineRunController,
    private readonly contexts?:SubtaskContextResolver,
    private readonly outputs?:Pick<NativeOutputStaging,'listFiles'>,
    private readonly pins?:Pick<AgentRunStore,'readPinnedSkills'>) {}

  private async stopRemote(orgId:OrgId,state:SubtaskExecutionState):Promise<void>{
    if(!state.remoteRunId||state.remoteThreadId!==deriveRemoteThreadId(state.run.id)||!this.engine){
      await this.store.recordCancellation(orgId,state.run.id,'unknown');return;
    }
    try{
      // Independent control request, never carrying the signal used to stop polling.
      await this.engine.cancelRun(state.run.id,state.remoteRunId);
      await this.store.recordCancellation(orgId,state.run.id,'confirmed',state.remoteRunId);
    }catch{await this.store.recordCancellation(orgId,state.run.id,'unknown');}
  }
  private async recoverCancellation(orgId:OrgId){
    for(const state of await this.store.listCancellationRecovery(orgId,20)){
      await this.stopRemote(orgId,state);
      this.active.get(state.run.id)?.abort();
    }
  }
  async tick(orgId: OrgId): Promise<number> {
    await this.recoverCancellation(orgId);
    let executed = 0;
    for (let count = 0; count < 10; count += 1) {
      const claimed = await executeQueuedSubtaskRuns({ store: this.store,
        log: (message, detail) => this.logger.error(message, { ...detail, traceId: randomUUID(), err: detail.detail ?? message }),
        execute:run=>this.execute(orgId,run),
      }, { orgId, limit: 1 });
      executed += claimed;
      if (claimed === 0) break;
    }
    return executed;
  }
  private async execute(orgId:OrgId,run:SubtaskRun):Promise<string|{text:string;files:readonly import('../../application/agent-run/ports').RunOutputFile[]}>{
    const parent = await this.db.withTenant(orgId, async (s) => {
      const r = await s.query<{ instructions: string }>(
        `SELECT v.instructions FROM agent_runs r
         JOIN agent_versions v ON v.id=$3 AND v.org_id=r.org_id AND v.agent_id=r.agent_id
         WHERE r.org_id=$1 AND r.id=$2 AND v.published_at IS NOT NULL`, [orgId,run.parentRunId,run.snapshot.agentVersionId]);
      return r.rows[0];
    });
    if (!parent) throw new Error("subtask_parent_snapshot_unavailable");
    const timeout = this.executionTimeouts.get(run.snapshot.modelProvider);
    if (timeout === undefined || !Number.isFinite(timeout) || timeout <= 0
      || timeout + 60_000 >= SUBTASK_STALE_RUNNING_THRESHOLD_MS) {
      throw new Error("subtask_provider_timeout_or_execution_mode_unsupported");
    }
    const before=await this.store.readExecution(orgId,run.id);
    if(!before||before.run.status!=='running')throw new SubtaskCancellationPendingError();
    if(before.run.cancellation){
      await this.store.recordCancellation(orgId,run.id,'confirmed',null);
      throw new SubtaskCancellationPendingError();
    }
    const local=new AbortController(),done=new AbortController();
    this.active.set(run.id,local);
    const deadline=setTimeout(()=>local.abort(),timeout);
    let cancellation:Promise<void>|undefined;
    const stop=(state:SubtaskExecutionState)=>{
      if(!cancellation)cancellation=(async()=>{
        await this.stopRemote(orgId,state);
        local.abort();
      })();
      return cancellation;
    };
    const watch=(async()=>{
      try{
        while(true){
          await delay(250,undefined,{signal:done.signal});
          const state=await this.store.readExecution(orgId,run.id);
          if(!state){local.abort();return;}
          if(state.run.cancellation){
            // A remote create may still be in-flight. Its callback persists and
            // interrupts the handle even if local cancellation already became unknown.
            await stop(state);return;
          }
          if(state.run.status!=='running'){local.abort();return;}
        }
      }catch{if(!done.signal.aborted)local.abort();}
    })();
    try{
      if(run.context?.startsWith(NATIVE_SUBTASK_CONTEXT_PREFIX)&&!this.contexts)throw new Error('subtask_context_resolver_unavailable');
      const executionContext=this.contexts?await this.contexts.prepare(orgId,run):run.context;
      const skills=this.pins?await this.pins.readPinnedSkills(orgId,run.snapshot.skillVersionIds):[];
      if(skills.length!==run.snapshot.skillVersionIds.length||skills.some((skill,index)=>skill.versionId!==run.snapshot.skillVersionIds[index]))throw new Error('subtask_skill_snapshot_unavailable_or_changed');
      if(local.signal.aborted)throw new SubtaskCancellationPendingError();
      const completion=await this.model.complete({modelProvider:run.snapshot.modelProvider,
        modelId:run.snapshot.modelId,system:parent.instructions,
        user:executionContext?`${run.description}\n\nContext:\n${executionContext}`:run.description,
        history:[],skills,orgId:String(orgId),executionMode:"text-only",signal:local.signal,
        ...(run.snapshot.modelProvider==='deep-agent'?{threadId:run.id,onRemoteRunStarted:async(remoteRunId:string,remoteThreadId?:string)=>{
          if(remoteThreadId!==deriveRemoteThreadId(run.id))throw new Error('subtask_remote_identity_mismatch');
          await this.store.bindRemoteRun(orgId,run.id,remoteRunId,remoteThreadId);
          const state=await this.store.readExecution(orgId,run.id);
          if(state?.run.cancellation){await this.stopRemote(orgId,state);local.abort();}
        }}:{}),
      });
      await cancellation;
      const current=await this.store.readExecution(orgId,run.id);
      if(current?.run.cancellation){
        await this.store.recordCancellation(orgId,run.id,'confirmed',current.remoteRunId);
        throw new SubtaskCancellationPendingError();
      }
      if(current?.run.status!=='running')throw new SubtaskCancellationPendingError();
      // complete() below rechecks parent/child cancellation under the write lock.
      if(run.outputFiles){
        if(!this.outputs)throw new Error('subtask_artifact_staging_unavailable');
        return {text:completion.text,files:await this.outputs.listFiles(orgId,run.id)};
      }
      return completion.text;
    }catch(error){
      await cancellation;
      const current=await this.store.readExecution(orgId,run.id);
      if(current?.run.cancellation){
        if(current.run.cancellation.state!=='confirmed')await this.store.recordCancellation(orgId,run.id,'unknown');
        throw new SubtaskCancellationPendingError();
      }
      throw error;
    }finally{
      clearTimeout(deadline);done.abort();await watch;this.active.delete(run.id);
    }
  }
  kick(orgId: OrgId): void {
    if (!this.autostart) return;
    void this.tick(orgId).catch((error: unknown) => {
      this.logger.error("subtask queue tick failed", { traceId: randomUUID(), orgId,
        err: error instanceof Error ? error.message : "claim_failed" });
    });
  }
}

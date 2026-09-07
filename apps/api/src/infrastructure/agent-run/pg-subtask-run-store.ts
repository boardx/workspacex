import { parentCancelRequestId, type ParentCancellation, type ChildCancellationResult } from "../../application/agent-run/parent-run-control";
import { createHash,randomUUID } from "node:crypto";
import type { DatabasePort } from "../../application/ports/database.port";
import type { OrgId } from "../../domain/org-id";
import { SUBTASK_STALE_RUNNING_THRESHOLD_MS } from "../../application/agent-run/subtask-run-queue";
import { SubtaskParentCancelledError, SubtaskIdempotencyConflictError } from "../../application/agent-run/subtask-run-queue";
import type { EnqueueSubtaskRunInput, SubtaskRun, SubtaskRunStore, CancelSubtaskOutcome, SubtaskExecutionState } from "../../application/agent-run/subtask-run-queue";
import type {RunOutputFile} from '../../application/agent-run/ports';

type Row = { output_policy:unknown;agent_version_id:string;skill_version_ids:unknown;model_provider:string;model_id:string;artifact_refs:unknown;output_manifest:unknown;cancel_requested_at: Date | null; cancellation_state: "pending" | "confirmed" | "unknown" | null; remote_run_id: string | null; remote_thread_id: string | null; id: string; parent_run_id: string; description: string; context: string | null;
  status: SubtaskRun["status"]; result: string | null; error: string | null; created_at: Date; updated_at: Date };
const decode = (r: Row): SubtaskRun => ({ ...(r.cancel_requested_at && r.cancellation_state ? {cancellation:{requestedAt:r.cancel_requested_at.toISOString(),state:r.cancellation_state}} : {}), id: r.id, parentRunId: r.parent_run_id,
  description: r.description, context: r.context,...(r.output_policy?{outputFiles:r.output_policy as SubtaskRun['outputFiles']}:{}),
  snapshot:{agentVersionId:r.agent_version_id,skillVersionIds:r.skill_version_ids as string[],modelProvider:r.model_provider,modelId:r.model_id},
  artifactRefs:r.artifact_refs as SubtaskRun['artifactRefs'],status: r.status, result: r.result,
  error: r.error, createdAt: r.created_at.toISOString(), updatedAt: r.updated_at.toISOString() });

/** Durable queue with separate cancellation facts. Stale executions fail; they are never automatically replayed
 * without fencing. Existing user retry creates a new id. Recovery runs on the next tenant kick. */
export class PgSubtaskRunStore implements SubtaskRunStore {
  constructor(private readonly db: DatabasePort,
    private readonly staleMs = SUBTASK_STALE_RUNNING_THRESHOLD_MS) {}

  enqueue(orgId: OrgId, input: EnqueueSubtaskRunInput): Promise<SubtaskRun> {
    return this.db.withTenant(orgId, async (s) => {
      const parent = await s.query<{ cancel_requested_at: Date | null;agent_version_id:string;skill_version_ids:unknown;model_provider:string;model_id:string }>(
        "SELECT cancel_requested_at,agent_version_id,skill_version_ids,model_provider,model_id FROM agent_runs WHERE org_id=$1 AND id=$2 FOR UPDATE", [orgId,input.parentRunId]);
      if (!parent.rows[0]) throw new Error("subtask_parent_unavailable");
      if (parent.rows[0].cancel_requested_at !== null) throw new SubtaskParentCancelledError();
      const snapshot={agentVersionId:parent.rows[0].agent_version_id,skillVersionIds:parent.rows[0].skill_version_ids as string[],modelProvider:parent.rows[0].model_provider,modelId:parent.rows[0].model_id};
      if(input.snapshot&&JSON.stringify(input.snapshot)!==JSON.stringify(snapshot))throw new SubtaskIdempotencyConflictError("subtask_snapshot_changed");
      const r = await s.query<Row>(`INSERT INTO subtask_runs(id,org_id,parent_run_id,description,context,idempotency_key,output_policy,agent_version_id,skill_version_ids,model_provider,model_id)
        VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9::jsonb,$10,$11) ON CONFLICT DO NOTHING RETURNING *`,
        [randomUUID(), orgId, input.parentRunId, input.description, input.context ?? null,input.idempotencyKey ?? null,input.outputFiles?JSON.stringify(input.outputFiles):null,snapshot.agentVersionId,JSON.stringify(snapshot.skillVersionIds),snapshot.modelProvider,snapshot.modelId]);
      if (r.rows[0]) return decode(r.rows[0]);
      const existing = await s.query<Row>("SELECT * FROM subtask_runs WHERE org_id=$1 AND parent_run_id=$2 AND idempotency_key=$3",
        [orgId,input.parentRunId,input.idempotencyKey]);
      const row = existing.rows[0];
      if (!row || row.description !== input.description || row.context !== (input.context ?? null)
        || JSON.stringify(row.output_policy)!==JSON.stringify(input.outputFiles??null)) {
        throw new SubtaskIdempotencyConflictError("subtask_idempotency_conflict");
      }
      return decode(row);
    });
  }

  cancel(orgId: OrgId, parentRunId: string, id: string): Promise<CancelSubtaskOutcome> {
    return this.db.withTenant(orgId, async (s) => {
      await s.query("SELECT cancel_requested_at FROM agent_runs WHERE org_id=$1 AND id=$2 FOR UPDATE",[orgId,parentRunId]);
      const locked = await s.query<Row>("SELECT * FROM subtask_runs WHERE org_id=$1 AND parent_run_id=$2 AND id=$3 FOR UPDATE", [orgId,parentRunId,id]);
      const row = locked.rows[0];
      if (!row) return { kind: "not_found" };
      if (row.status === "running") {
        const changed=await s.query<Row>("UPDATE subtask_runs SET cancel_requested_at=COALESCE(cancel_requested_at,now()),cancellation_state=COALESCE(cancellation_state,'pending'),updated_at=now() WHERE org_id=$1 AND parent_run_id=$2 AND id=$3 RETURNING *",[orgId,parentRunId,id]);
        return {kind:"cancel_requested",subtaskRun:decode(changed.rows[0]!)};
      }
      if (row.status === "failed" && row.cancellation_state === "unknown") return {kind:"cancel_requested",subtaskRun:decode(row)};
      if (row.status === "completed" || row.status === "failed") return { kind: "terminal_conflict" };
      if (row.status === "cancelled") return { kind: "cancelled", subtaskRun: { ...decode(row), status: "cancelled" } };
      const changed = await s.query<Row>("UPDATE subtask_runs SET status='cancelled',cancel_requested_at=COALESCE(cancel_requested_at,now()),cancellation_state='confirmed',updated_at=now() WHERE org_id=$1 AND parent_run_id=$2 AND id=$3 AND status='pending' RETURNING *", [orgId,parentRunId,id]);
      return { kind: "cancelled", subtaskRun: { ...decode(changed.rows[0]!), status: "cancelled" } };
    });
  }

  async claimQueued(orgId: OrgId, limit: number): Promise<readonly SubtaskRun[]> {
    const stale=await this.db.withTenant(orgId,async s=>s.query<{id:string}>("SELECT id FROM subtask_runs WHERE org_id=$1 AND status='running' AND updated_at < now() - ($2 * interval '1 millisecond') ORDER BY parent_run_id,id LIMIT 20",[orgId,this.staleMs]));
    for(const row of stale.rows){
      await this.db.withTenant(orgId,async s=>{
        await this.readExecution(orgId,row.id);
        await s.query(`UPDATE subtask_runs SET status='failed',
          error=CASE WHEN cancel_requested_at IS NULL THEN 'subtask_execution_lost_after_restart_or_timeout' ELSE 'subtask_cancel_unknown' END,
          cancellation_state=CASE WHEN cancel_requested_at IS NULL THEN NULL ELSE 'unknown' END,updated_at=now()
          WHERE org_id=$1 AND id=$2 AND status='running' AND updated_at < now() - ($3 * interval '1 millisecond')`,[orgId,row.id,this.staleMs]);
      });
    }
    return this.db.withTenant(orgId,async s=>{
      const maximum = Number.isFinite(limit) ? Math.max(0,Math.floor(limit)) : 0;
      const parents = await s.query<{ id: string; cancel_requested_at: Date | null }>(
        `SELECT id,cancel_requested_at FROM agent_runs WHERE org_id=$1 AND id IN
          (SELECT parent_run_id FROM subtask_runs WHERE org_id=$1 AND status='pending')
         ORDER BY id LIMIT $2 FOR UPDATE SKIP LOCKED`, [orgId,maximum]);
      const claimed: SubtaskRun[] = [];
      for (const parent of parents.rows) {
        if (parent.cancel_requested_at !== null) {
          await s.query("UPDATE subtask_runs SET status='cancelled',updated_at=now() WHERE org_id=$1 AND parent_run_id=$2 AND status='pending'", [orgId,parent.id]);
          continue;
        }
        const r = await s.query<Row>(`UPDATE subtask_runs SET status='running',updated_at=now()
          WHERE org_id=$1 AND id IN (SELECT id FROM subtask_runs WHERE org_id=$1 AND parent_run_id=$2 AND status='pending'
          ORDER BY created_at,id LIMIT $3 FOR UPDATE SKIP LOCKED) RETURNING *`, [orgId,parent.id,maximum-claimed.length]);
        claimed.push(...r.rows.map(decode));
        if (claimed.length >= maximum) break;
      }
      return claimed.sort((a,b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
    });
  }

  cancelChildren(input: ParentCancellation): Promise<ChildCancellationResult> {
    return this.cancellation(input,true);
  }
  readCancellation(input: ParentCancellation): Promise<ChildCancellationResult> {
    return this.cancellation(input,false);
  }
  private cancellation(input: ParentCancellation, mutate: boolean): Promise<ChildCancellationResult> {
    const orgId = input.orgId;
    return this.db.withTenant(orgId, async s => {
      const parent = mutate
        ? await s.query<{ cancel_requested_at: Date | null }>("SELECT cancel_requested_at FROM agent_runs WHERE org_id=$1 AND id=$2 FOR UPDATE",[orgId,input.parentRunId])
        : await s.query<{ cancel_requested_at: Date | null }>("SELECT cancel_requested_at FROM agent_runs WHERE org_id=$1 AND id=$2",[orgId,input.parentRunId]);
      const stamp=parent.rows[0]?.cancel_requested_at;
      if (!stamp || parentCancelRequestId(orgId,input.parentRunId,stamp)!==input.requestId) return {kind:"unavailable"};
      if (mutate) await s.query(`UPDATE subtask_runs SET cancel_requested_at=COALESCE(cancel_requested_at,$3),
        cancellation_state=CASE WHEN status='pending' THEN 'confirmed' ELSE COALESCE(cancellation_state,'pending') END,
        status=CASE WHEN status='pending' THEN 'cancelled' ELSE status END,updated_at=now()
        WHERE org_id=$1 AND parent_run_id=$2 AND status IN ('pending','running')`,[orgId,input.parentRunId,stamp]);
      const unknown=await s.query("SELECT id FROM subtask_runs WHERE org_id=$1 AND parent_run_id=$2 AND cancellation_state='unknown'",[orgId,input.parentRunId]);
      if(unknown.rows.length)return {kind:"unavailable"};
      const active=await s.query<{id:string;status:string}>("SELECT id,status FROM subtask_runs WHERE org_id=$1 AND parent_run_id=$2 AND status IN ('pending','running') ORDER BY id",[orgId,input.parentRunId]);
      return active.rows.length ? {kind:"pending",runningChildIds:active.rows.filter(row=>row.status==='running').map(row=>row.id)} : {kind:"confirmed"};
    });
  }

  complete(orgId: OrgId, id: string, result: string): Promise<void> {
    return this.finish(orgId, id, "completed", result, null);
  }
  async completeWithArtifacts(orgId:OrgId,id:string,result:string,files:readonly RunOutputFile[]):Promise<void>{
    await this.db.withTenant(orgId,async s=>{
      const initial=(await s.query<Row>('SELECT * FROM subtask_runs WHERE org_id=$1 AND id=$2',[orgId,id])).rows[0];
      if(!initial)return;
      const parent=(await s.query<{thread_id:string;cancel_requested_at:Date|null}>('SELECT thread_id,cancel_requested_at FROM agent_runs WHERE org_id=$1 AND id=$2 FOR UPDATE',[orgId,initial.parent_run_id])).rows[0];
      const row=(await s.query<Row>('SELECT * FROM subtask_runs WHERE org_id=$1 AND id=$2 FOR UPDATE',[orgId,id])).rows[0];
      if(!parent||!row||row.status!=='running')return;
      if(parent.cancel_requested_at||row.cancel_requested_at){
        await s.query(`UPDATE subtask_runs SET status='cancelled',result=NULL,error=NULL,artifact_refs='[]'::jsonb,
          cancel_requested_at=COALESCE(cancel_requested_at,$3,now()),cancellation_state='confirmed',updated_at=now() WHERE org_id=$1 AND id=$2`,[orgId,id,parent.cancel_requested_at]);return;
      }
      const policy=row.output_policy as {mediaTypes:string[];maxFiles:number;maxTotalBytes:number}|null;
      if(!policy)throw new Error('subtask_file_output_not_authorized');
      const total=files.reduce((sum,file)=>sum+file.sizeBytes,0);
      if(files.length>policy.maxFiles||total>policy.maxTotalBytes||files.some(file=>!policy.mediaTypes.includes(file.mime)))throw new Error('subtask_file_output_limit');
      const step=(await s.query<{id:string}>('SELECT id FROM agent_run_steps WHERE org_id=$1 AND run_id=$2 ORDER BY seq DESC LIMIT 1',[orgId,row.parent_run_id])).rows[0];
      if(!step)throw new Error('subtask_artifact_parent_step_unavailable');
      const refs:{artifactId:string;versionId:string}[]=[],manifest:{artifactId:string;versionId:string;objectKey:string;sha256:string;mime:string;sizeBytes:number}[]=[];
      for(const file of files){
        const sha256=file.objectKey.split('/')[2];if(!sha256||!/^[a-f0-9]{64}$/.test(sha256))throw new Error('subtask_artifact_hash_unavailable');
        const artifactId='subtask-artifact-'+createHash('sha256').update(`${id}\0${file.name}`).digest('hex');
        const versionId=`${artifactId}-v1`,extension=file.name.split('.').at(-1)?.toLowerCase();
        const kind=extension&&['pdf','docx','png'].includes(extension)?extension:'other';
        await s.query('INSERT INTO agent_artifacts(id,org_id,thread_id,name,kind) VALUES($1,$2,$3,$4,$5)',[artifactId,orgId,parent.thread_id,file.name,kind]);
        await s.query(`INSERT INTO agent_artifact_versions(id,org_id,artifact_id,version,produced_by_run_id,produced_by_step_id,change_note,storage_key,size_bytes)
          VALUES($1,$2,$3,1,$4,$5,$6,$7,$8)`,[versionId,orgId,artifactId,row.parent_run_id,step.id,`Durable subtask ${id}`,file.objectKey,file.sizeBytes]);
        refs.push({artifactId,versionId});
        manifest.push({artifactId,versionId,objectKey:file.objectKey,sha256,mime:file.mime,sizeBytes:file.sizeBytes});
      }
      await s.query("UPDATE subtask_runs SET status='completed',result=$3,error=NULL,artifact_refs=$4::jsonb,output_manifest=$5::jsonb,updated_at=now() WHERE org_id=$1 AND id=$2 AND status='running'",[orgId,id,result,JSON.stringify(refs),JSON.stringify(manifest)]);
    });
  }
  fail(orgId: OrgId, id: string, error: string): Promise<void> {
    return this.finish(orgId, id, "failed", null, error);
  }
  private async finish(orgId: OrgId, id: string, status: string, result: string | null, error: string | null): Promise<void> {
    await this.db.withTenant(orgId, async s => {
      const execution=await this.readExecution(orgId,id);
      if(execution?.run.cancellation){
        await s.query(`UPDATE subtask_runs SET status=$3,result=NULL,error=$4,cancellation_state=$5,updated_at=now()
          WHERE org_id=$1 AND id=$2 AND status='running'`,[orgId,id,status==='completed'?'cancelled':'failed',status==='completed'?null:'subtask_cancel_unknown',status==='completed'?'confirmed':'unknown']);
        return;
      }
      await s.query(`UPDATE subtask_runs SET status=$3,result=$4,error=$5,updated_at=now()
        WHERE org_id=$1 AND id=$2 AND status='running'`, [orgId,id,status,result,error]);
    });
  }
  /** Parent lock is acquired before any child mutation; nested calls reuse DATABASE_PORT. */
  readExecution(orgId: OrgId,id: string): Promise<SubtaskExecutionState|null>{
    return this.db.withTenant(orgId,async s=>{
      let row=(await s.query<Row>("SELECT * FROM subtask_runs WHERE org_id=$1 AND id=$2",[orgId,id])).rows[0];
      if(!row)return null;
      const parent=await s.query<{cancel_requested_at:Date|null}>("SELECT cancel_requested_at FROM agent_runs WHERE org_id=$1 AND id=$2 FOR UPDATE",[orgId,row.parent_run_id]);
      if(!parent.rows[0])return null;
      row=(await s.query<Row>("SELECT * FROM subtask_runs WHERE org_id=$1 AND id=$2 FOR UPDATE",[orgId,id])).rows[0];
      if(!row)return null;
      if(parent.rows[0].cancel_requested_at && !row.cancel_requested_at && ['pending','running'].includes(row.status)){
        row=(await s.query<Row>(`UPDATE subtask_runs SET cancel_requested_at=$3,
          cancellation_state=CASE WHEN status='pending' THEN 'confirmed' ELSE 'pending' END,
          status=CASE WHEN status='pending' THEN 'cancelled' ELSE status END
          WHERE org_id=$1 AND id=$2 RETURNING *`,[orgId,id,parent.rows[0].cancel_requested_at])).rows[0]!;
      }
      return {run:decode(row),remoteRunId:row.remote_run_id,remoteThreadId:row.remote_thread_id};
    });
  }
  bindRemoteRun(orgId:OrgId,id:string,remoteRunId:string,remoteThreadId:string):Promise<void>{
    return this.db.withTenant(orgId,async s=>{
      await this.readExecution(orgId,id);
      const result=await s.query(`UPDATE subtask_runs SET remote_run_id=$3,remote_thread_id=$4
        WHERE org_id=$1 AND id=$2 AND (status='running' OR cancellation_state='unknown')
        AND (remote_run_id IS NULL OR (remote_run_id=$3 AND remote_thread_id=$4)) RETURNING id`,[orgId,id,remoteRunId,remoteThreadId]);
      if(!result.rows.length)throw new Error('subtask_remote_binding_conflict');
    });
  }
  recordCancellation(orgId:OrgId,id:string,state:'confirmed'|'unknown',remoteRunId?:string|null):Promise<void>{
    return this.db.withTenant(orgId,async s=>{
      const current=await this.readExecution(orgId,id);
      if(!current?.run.cancellation)return;
      if(state==='confirmed'&&(remoteRunId===undefined||current.remoteRunId!==remoteRunId))throw new Error('subtask_cancel_identity_unverified');
      await s.query(`UPDATE subtask_runs SET cancellation_state=$3,
        status=CASE WHEN status='running' THEN $4 ELSE status END,result=NULL,
        error=CASE WHEN status='running' THEN $5 WHEN $3='confirmed' AND cancellation_state='unknown' THEN 'subtask_cancelled_after_reconciliation' ELSE error END,updated_at=now()
        WHERE org_id=$1 AND id=$2 AND (status='running' OR cancellation_state='unknown')`,
        [orgId,id,state,state==='confirmed'?'cancelled':'failed',state==='confirmed'?null:'subtask_cancel_unknown']);
    });
  }
  async listCancellationRecovery(orgId:OrgId,limit:number):Promise<readonly SubtaskExecutionState[]>{
    const rows=await this.db.withTenant(orgId,async s=>
      s.query<{id:string}>("SELECT id FROM subtask_runs WHERE org_id=$1 AND (status='running' OR cancellation_state='unknown') ORDER BY parent_run_id,id LIMIT $2",[orgId,Math.max(0,Math.min(20,limit))]));
    const found:SubtaskExecutionState[]=[];
    // Each parent/child snapshot is its own short transaction; do not accumulate
    // row locks while visiting unrelated parent runs.
    for(const row of rows.rows){const current=await this.readExecution(orgId,row.id);if(current?.run.cancellation)found.push(current);}
    return found;
  }
  get(orgId: OrgId, id: string): Promise<SubtaskRun | null> {
    return this.db.withTenant(orgId, async (s) => {
      const r = await s.query<Row>("SELECT * FROM subtask_runs WHERE org_id=$1 AND id=$2", [orgId,id]);
      return r.rows[0] ? decode(r.rows[0]) : null;
    });
  }
  listByParentRun(orgId: OrgId, parentRunId: string): Promise<readonly SubtaskRun[]> {
    return this.db.withTenant(orgId, async (s) => {
      const r = await s.query<Row>("SELECT * FROM subtask_runs WHERE org_id=$1 AND parent_run_id=$2 ORDER BY created_at,id", [orgId,parentRunId]);
      return r.rows.map(decode);
    });
  }
}

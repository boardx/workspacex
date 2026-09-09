/**
 * `SubtaskRunStore` 的内存测试实现。WX-T042 生产绑定已切到 PgSubtaskRunStore，
 * 此类保留便于应用层测试；重启/多进程持久化只由 Postgres adapter 提供。
 */
import { SubtaskIdempotencyConflictError, foldSubtaskToolCall } from "../../application/agent-run/subtask-run-queue";
import type { SubtaskToolCallObservation } from "../../application/agent-run/subtask-run-queue";
import { randomUUID } from "node:crypto";
import type { OrgId } from "../../domain/org-id";
import type {
  EnqueueSubtaskRunInput, SubtaskRun, SubtaskRunStore, CancelSubtaskOutcome, SubtaskExecutionState,
} from "../../application/agent-run/subtask-run-queue";
import type {RunOutputFile} from '../../application/agent-run/ports';

interface Row extends SubtaskRun {
  readonly orgId: string;
}

export class InMemorySubtaskRunStore implements SubtaskRunStore {
  private readonly rows = new Map<string, Row>();
  private readonly remotes=new Map<string,{remoteRunId:string;remoteThreadId:string}>();
  private readonly idempotency = new Map<string, string>();

  constructor(private readonly idFactory: () => string = () => randomUUID()) {}

  async enqueue(orgId: OrgId, input: EnqueueSubtaskRunInput): Promise<SubtaskRun> {
    const key = input.idempotencyKey === undefined ? undefined : JSON.stringify([orgId,input.parentRunId,input.idempotencyKey]);
    const existing = key === undefined ? undefined : this.rows.get(this.idempotency.get(key) ?? "");
    if (existing) {
      if (existing.description !== input.description || existing.context !== (input.context ?? null)
        || JSON.stringify(existing.outputFiles??null)!==JSON.stringify(input.outputFiles??null)) {
        throw new SubtaskIdempotencyConflictError("subtask_idempotency_conflict");
      }
      return stripOrg(existing);
    }
    const now = new Date().toISOString();
    const row: Row = {
      id: this.idFactory(),
      orgId: String(orgId),
      parentRunId: input.parentRunId,
      description: input.description,
      context: input.context ?? null,
      ...(input.outputFiles?{outputFiles:input.outputFiles}:{}),
      snapshot:input.snapshot??{agentVersionId:"in-memory",skillVersionIds:[],modelProvider:"in-memory",modelId:"in-memory"},
      artifactRefs:[],
      toolCalls: [],
      status: "pending",
      result: null,
      error: null,
      createdAt: now,
      updatedAt: now,
    };
    this.rows.set(row.id, row);
    if (key !== undefined) this.idempotency.set(key,row.id);
    return stripOrg(row);
  }

  async cancel(orgId: OrgId, parentRunId: string, id: string): Promise<CancelSubtaskOutcome> {
    const row = this.rows.get(id);
    if (!row || row.orgId !== String(orgId) || row.parentRunId !== parentRunId) return { kind: "not_found" };
    if (row.status === "running" || row.cancellation?.state==='unknown') {
      const requested:Row={...row,cancellation:row.cancellation??{requestedAt:new Date().toISOString(),state:'pending'}};
      this.rows.set(id,requested);return {kind:'cancel_requested',subtaskRun:stripOrg(requested)};
    }
    if (row.status === "completed" || row.status === "failed") return { kind: "terminal_conflict" };
    const cancelled = { ...row, cancellation: {requestedAt:row.cancellation?.requestedAt??new Date().toISOString(),state:'confirmed' as const}, status: "cancelled" as const,
      updatedAt: row.status === "cancelled" ? row.updatedAt : new Date().toISOString() };
    this.rows.set(id, cancelled);
    return { kind: "cancelled", subtaskRun: { ...stripOrg(cancelled), status: "cancelled" } };
  }

  async claimQueued(orgId: OrgId, limit: number): Promise<readonly SubtaskRun[]> {
    const claimed: Row[] = [];
    for (const row of this.rows.values()) {
      if (claimed.length >= limit) break;
      if (row.orgId !== String(orgId) || row.status !== "pending") continue;
      const running: Row = { ...row, status: "running", updatedAt: new Date().toISOString() };
      this.rows.set(row.id, running);
      claimed.push(running);
    }
    return claimed.map(stripOrg);
  }

  async recordToolCall(orgId: OrgId, id: string, observation: SubtaskToolCallObservation): Promise<void> {
    const row = this.rows.get(id);
    if (!row || row.orgId !== String(orgId)) return;
    this.rows.set(id, { ...row, toolCalls: foldSubtaskToolCall(row.toolCalls ?? [], observation) });
  }

  async complete(orgId: OrgId, id: string, result: string): Promise<void> {
    this.transition(orgId, id, { status: "completed", result, error: null });
  }
  async completeWithArtifacts(orgId:OrgId,id:string,result:string,files:readonly RunOutputFile[]){
    const row=this.rows.get(id);if(!row||row.orgId!==String(orgId)||row.status!=='running')return;
    if(!row.outputFiles||files.length>row.outputFiles.maxFiles||files.reduce((n,f)=>n+f.sizeBytes,0)>row.outputFiles.maxTotalBytes||files.some(f=>!row.outputFiles!.mediaTypes.includes(f.mime as never)))throw new Error('subtask_file_output_limit');
    if(row.cancellation){this.transition(orgId,id,{status:'completed',result,error:null});return;}
    this.rows.set(id,{...row,status:'completed',result,error:null,artifactRefs:files.map((_,index)=>({artifactId:`subtask-artifact-${id}-${index}`,versionId:`subtask-artifact-${id}-${index}-v1`})),updatedAt:new Date().toISOString()});
  }

  async fail(orgId: OrgId, id: string, error: string): Promise<void> {
    this.transition(orgId, id, { status: "failed", result: null, error });
  }

  async readExecution(orgId:OrgId,id:string):Promise<SubtaskExecutionState|null>{
    const run=await this.get(orgId,id);return run?{run,...(this.remotes.get(id)??{remoteRunId:null,remoteThreadId:null}),executionAttemptId:`${id}:1`,leaseEpoch:1}:null;
  }
  async bindRemoteRun(orgId:OrgId,id:string,remoteRunId:string,remoteThreadId:string){
    const run=await this.get(orgId,id),prior=this.remotes.get(id);
    if(!run||(run.status!=='running'&&run.cancellation?.state!=='unknown')||(prior&&(prior.remoteRunId!==remoteRunId||prior.remoteThreadId!==remoteThreadId)))throw new Error('subtask_remote_binding_conflict');
    this.remotes.set(id,{remoteRunId,remoteThreadId});
  }
  async recordCancellation(orgId:OrgId,id:string,state:'confirmed'|'unknown',remoteRunId?:string|null){
    const row=this.rows.get(id);if(!row||row.orgId!==String(orgId)||!row.cancellation)return;
    if(state==='confirmed'&&(remoteRunId===undefined||(this.remotes.get(id)?.remoteRunId??null)!==remoteRunId))throw new Error('subtask_cancel_identity_unverified');
    if(row.status!=='running'&&row.cancellation.state!=='unknown')return;
    // 确认取消 ⇒ 终态就是 `cancelled`，不论进来时是 `running` 还是停在 `failed`+unknown 的
    // 待对账态。这一跳只对"已记录取消请求"的行生效（上面两个 guard），取消之前就真失败的
    // 子任务没有 cancellation 记录，永远走不到这里，保持它自己的 `failed` 与错因。
    this.rows.set(id,{...row,cancellation:{...row.cancellation,state},result:null,
      status:state==='confirmed'?'cancelled':'failed',
      error:state==='confirmed'?null:'subtask_cancel_unknown'});
  }
  async listCancellationRecovery(orgId:OrgId,limit:number):Promise<readonly SubtaskExecutionState[]>{
    const rows=[...this.rows.values()].filter(r=>r.orgId===String(orgId)&&r.cancellation&&(r.status==='running'||r.cancellation.state==='unknown')).slice(0,Math.min(20,limit));
    return Promise.all(rows.map(async row=>(await this.readExecution(orgId,row.id))!));
  }
  async get(orgId: OrgId, id: string): Promise<SubtaskRun | null> {
    const row = this.rows.get(id);
    if (!row || row.orgId !== String(orgId)) return null;
    return stripOrg(row);
  }

  async listByParentRun(orgId: OrgId, parentRunId: string): Promise<readonly SubtaskRun[]> {
    const rows = [...this.rows.values()]
      .filter((row) => row.orgId === String(orgId) && row.parentRunId === parentRunId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    return rows.map(stripOrg);
  }

  private transition(
    orgId: OrgId, id: string,
    patch: Pick<Row, "status" | "result" | "error">,
  ): void {
    const row = this.rows.get(id);
    if (!row || row.orgId !== String(orgId) || row.status !== "running") return;
    if(row.cancellation){
      patch=patch.status==='completed'?{status:'cancelled',result:null,error:null}:{status:'failed',result:null,error:'subtask_cancel_unknown'};
      this.rows.set(id,{...row,...patch,cancellation:{...row.cancellation,state:patch.status==='cancelled'?'confirmed':'unknown'}});return;
    }
    this.rows.set(id, { ...row, ...patch, updatedAt: new Date().toISOString() });
  }
}

function stripOrg(row: Row): SubtaskRun {
  const { orgId: _orgId, ...rest } = row;
  return rest;
}

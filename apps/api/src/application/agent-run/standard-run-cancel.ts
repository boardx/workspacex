import {RunCancelOutput} from '@repo/contracts/standard-run-cancel';import type {OrgId} from '../../domain/org-id';import {cancelAgentRun} from './cancel-run';import type {ResolveVisibilityDeps} from '../chat/resolve-visibility';import type {AgentRunStore,ModelCallPort} from './ports';import type {ParentRunControl} from './parent-run-control';
export const STANDARD_RUN_CANCEL=Symbol('StandardRunCancel');
type CancelDeps=ResolveVisibilityDeps&{runs:AgentRunStore;model?:ModelCallPort;liveQueue:boolean};
export class StandardRunCancelService{
 constructor(private readonly deps:CancelDeps,private readonly children:ParentRunControl|undefined,private readonly cancel:typeof cancelAgentRun=cancelAgentRun){}
 async invoke(actor:{orgId:OrgId;userId:string},input:{runId:string;reason?:string;idempotencyKey:string}){
  // The full toolArgs reach the existing authority before this call. This adapter does not
  // separately persist reason/key or claim a new audit receipt. Cancellation is idempotent
  // per target run through its existing durable cancellation fact, not a global key ledger.
  void input.reason;void input.idempotencyKey;
  const result=await this.cancel(this.deps,{...actor,runId:input.runId});
  const childCancellation=await this.children?.propagateCancellation(actor.orgId,input.runId)??{kind:'unavailable' as const};
  return RunCancelOutput.parse({cancellationRequested:true,...(result.status==='cancelled'?{finalStatus:'cancelled' as const}:{}),childCancellation});
 }
}

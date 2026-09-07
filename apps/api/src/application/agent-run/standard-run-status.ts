import {RunStatusOutput,type RunArtifactRef} from '@repo/contracts/standard-run-status';
import type {OrgId} from '../../domain/org-id';
import {readAgentRun,type ReadAgentRunDeps} from './read-run';

export const STANDARD_RUN_STATUS=Symbol('StandardRunStatus');
export interface RunArtifactRefsReader{listProducedByRun(actor:{orgId:OrgId;userId:string},runId:string):Promise<readonly RunArtifactRef[]>;}
export class StandardRunStatusService{
 constructor(private readonly deps:ReadAgentRunDeps,private readonly artifacts:RunArtifactRefsReader,private readonly now:()=>Date=()=>new Date(),private readonly read:typeof readAgentRun=readAgentRun){}
 async invoke(actor:{orgId:OrgId;userId:string},runId:string){
  const run=await this.read(this.deps,{...actor,runId});
  const artifactRefs=await this.artifacts.listProducedByRun(actor,runId);
  return RunStatusOutput.parse({status:run.status,steps:run.steps,waitingRequest:run.pendingApproval?{permissionRequestId:run.pendingApproval.permissionRequestId,toolName:run.pendingApproval.toolName,argsSummary:run.pendingApproval.argsSummary}:null,artifactRefs,observedAt:this.now().toISOString()});
 }
}

import {NativeFileDelegationCheckInput} from '@repo/contracts/native-file-delegation';
import {canonicalNativeInputs} from '@repo/contracts/native-session-binding';
import type {z} from 'zod';
import type {DatabasePort} from '../../application/ports/database.port';
import type {NativeFileDelegation} from '../../application/agent-run/native-file-delegation';
import type {NativeRunInputs} from '../../application/agent-run/native-run-inputs';
import type {ToolExecutionAuthority} from '../../application/agent-run/tool-execution-authority';
import {toOrgId} from '../../domain/org-id';
/** Reuse current-run attachment visibility and byte verification. No new source
 * lookup, model-chosen namespace or storage-ref read path is introduced. */
export class NativeFileDelegationProof implements NativeFileDelegation {
 constructor(private readonly db:DatabasePort,private readonly authority:Pick<ToolExecutionAuthority,'check'>,private readonly inputs:NativeRunInputs){}
 async check(runId:string,raw:z.infer<typeof NativeFileDelegationCheckInput>):Promise<{allowed:true}>{
  const input=NativeFileDelegationCheckInput.parse(raw);
  if(input.toolArgs.file_path!==input.file.path)throw new Error('delegation_path_mismatch');
  const context={...input,orgId:toOrgId(input.orgId),parentRunId:runId};
  return this.db.withTenant(context.orgId,async()=>{
   const decision=await this.authority.check(context);
   if(!decision.allowed)throw new Error('delegation_authority_denied');
   const current=await this.inputs.read(context);
   const match=current.manifest.find(file=>file.path===input.file.path);
   if(!match||canonicalNativeInputs([match])!==canonicalNativeInputs([input.file]))throw new Error('delegation_input_revoked_or_changed');
   return {allowed:true};
  });
 }
}

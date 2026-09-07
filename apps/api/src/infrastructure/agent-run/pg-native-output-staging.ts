import {createHash,randomUUID} from 'node:crypto';
import {NativeArtifactPublishInput,NativeArtifactStaged,NATIVE_ARTIFACT_TOOL} from '@repo/contracts/native-artifact-publish';
import {sandboxSession as S,standardCapabilities as SC} from '@repo/contracts';
import type {DatabasePort} from '../../application/ports/database.port';
import type {ObjectStore} from '../../application/artifact/ports';
import type {NativeSessionOwner,NativeResolved} from '../../application/agent-run/native-session-owner';
import type {ToolExecutionAuthority} from '../../application/agent-run/tool-execution-authority';
import {type NativeOutputStaging,type PublishContext,type PublishInput,validateNativeArtifactBytes} from '../../application/agent-run/native-output-staging';
import {collectNativeOutputs,type BoundSessionFiles} from '../../application/agent-run/collect-native-outputs';
import {toolArgumentsDigest} from '../../application/agent-run/tool-arguments-digest';
import type {OrgId} from '../../domain/org-id';
import type {RunOutputFile} from '../../application/agent-run/ports';
type Row={id:string;args_digest:string;sha256:string;file:RunOutputFile};
/** Staging metadata only. Artifact versions remain in the existing writeback repository. */
export class PgNativeOutputStaging implements NativeOutputStaging {
 constructor(private db:DatabasePort,private owner:NativeSessionOwner,private objects:ObjectStore,
  private authority:Pick<ToolExecutionAuthority,'check'>,private files:(resolved:NativeResolved)=>BoundSessionFiles){}
 async stage(context:PublishContext,raw:PublishInput){
  const input=NativeArtifactPublishInput.parse(raw),argsDigest=toolArgumentsDigest(input);
  return this.db.withTenant(context.orgId,async s=>{
   // authority uses this same tenant transaction and locks the run through collection/commit.
   const decision=await this.authority.check({...context,toolName:NATIVE_ARTIFACT_TOOL,toolArgs:input});
   if(!decision.allowed)throw new Error('native_output_authority_denied');
   const bound=await this.owner.resolve(context.bindingId,context);
   const file=S.schemas.file.parse(await this.files(bound).read(input.workspacePath));
   if(file.path!==input.workspacePath)throw new Error('native_output_path_mismatch');
   SC.CanonicalBase64.parse(file.contentBase64);
   const size=SC.decodedBase64Size(file.contentBase64);
   if(size!==file.sizeBytes||size>S.limits.maxFileBytes)throw new Error('native_output_size');
   const bytes=Buffer.from(file.contentBase64,'base64');
   await validateNativeArtifactBytes(input,bytes);
   const sha256=createHash('sha256').update(bytes).digest('hex');
   const existing=(await s.query<Row>('SELECT id,args_digest,sha256,file FROM native_output_staging WHERE org_id=$1 AND run_id=$2 AND idempotency_key=$3',[context.orgId,context.parentRunId,input.idempotencyKey])).rows[0];
   if(existing){
    if(existing.args_digest!==argsDigest||existing.sha256!==sha256)throw new Error('native_output_idempotency_conflict');
    return NativeArtifactStaged.parse({publishId:existing.id,status:'staged',sha256,sizeBytes:size});
   }
   const count=await s.query<{count:string;bytes:string}>('SELECT count(*)::text AS count,COALESCE(sum((file->>\'sizeBytes\')::bigint),0)::text AS bytes FROM native_output_staging WHERE org_id=$1 AND run_id=$2',[context.orgId,context.parentRunId]);
   if(Number(count.rows[0]!.count)>=S.limits.maxFiles||Number(count.rows[0]!.bytes)+size>S.limits.maxRequestBytes)throw new Error('native_output_limit');
   const duplicate=await s.query('SELECT id FROM native_output_staging WHERE org_id=$1 AND run_id=$2 AND file->>\'name\'=$3',[context.orgId,context.parentRunId,input.title]);
   if(duplicate.rows.length)throw new Error('native_output_duplicate_name');
   const collected=await collectNativeOutputs({objects:this.objects,sessionFiles:{read:async()=>file}},{runId:context.parentRunId,paths:[input.workspacePath],verifiedMime:input.mediaType});
   const output={...collected[0]!,name:input.title};const id=randomUUID();
   await s.query('INSERT INTO native_output_staging(id,org_id,run_id,idempotency_key,args_digest,sha256,file) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb)',[id,context.orgId,context.parentRunId,input.idempotencyKey,argsDigest,sha256,JSON.stringify(output)]);
   return NativeArtifactStaged.parse({publishId:id,status:'staged',sha256,sizeBytes:size});
  });
 }
 async listFiles(orgId:OrgId,runId:string){return this.db.withTenant(orgId,async s=>(await s.query<{file:RunOutputFile}>('SELECT file FROM native_output_staging WHERE org_id=$1 AND run_id=$2 ORDER BY created_at,id',[orgId,runId])).rows.map(r=>r.file));}
}

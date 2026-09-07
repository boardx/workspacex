import type {DatabasePort} from '../../application/ports/database.port';
import type {ObjectStore} from '../../application/artifact/ports';
import type {AgentArtifactDeliverySource} from '../../application/files/agent-artifact-delivery-source';
import {FilesDeliveryError} from '../../application/files/deliver-artifact';
import {getArtifact,type ArtifactReadDeps} from '../../application/artifacts-steering/read-artifact';
import {resolveVisibility} from '../../application/chat/resolve-visibility';
import {guard,discloseDecided,isDisclosed} from '../../application/security/permission-filter';
import {limits} from '@repo/contracts/sandbox-session';
/** Existing getArtifact is the source-version visibility authority. Staging supplies immutable byte identity. */
export class PgAgentArtifactDeliverySource implements AgentArtifactDeliverySource {
 constructor(private readonly db:DatabasePort,private readonly deps:ArtifactReadDeps,private readonly objects:ObjectStore){}
 readBytes(key:string){return this.objects.get(key);}
 async resolve(input:Parameters<AgentArtifactDeliverySource['resolve']>[0]){
  return this.db.withTenant(input.orgId,async session=>{
   const row=(await session.query<{artifact_id:string;version:number}>(
    'SELECT artifact_id,version FROM agent_artifact_versions WHERE org_id=$1 AND id=$2',[input.orgId,input.versionId])).rows[0];
   if(!row)return null;
   const missing=()=>new FilesDeliveryError('ARTIFACT_NOT_FOUND');
   if(input.artifactId!==undefined&&input.artifactId!==row.artifact_id)throw missing();
   let artifact;
   try { artifact=await getArtifact(this.deps,{...input,artifactId:row.artifact_id}); } catch { throw missing(); }
   const version=artifact.versions.find(v=>v.version===row.version);
   if(!version)throw missing();
   const locator=await this.deps.artifacts.findLocator(input.orgId,row.artifact_id);
   if(!locator)throw missing();
   const access=await resolveVisibility(this.deps,{...input,...locator});
   if(access.kind!=='allow')throw missing();
   const metadata=version.attachmentId?(await session.query<{sha256:string;mime:string;size_bytes:string;object_key:string}>(
    `SELECT st.sha256,att.mime,av.size_bytes,att.storage_ref AS object_key
     FROM agent_artifact_versions av JOIN chat_message_attachments att ON att.org_id=av.org_id AND att.id=av.attachment_id
     JOIN native_output_staging st ON st.org_id=av.org_id AND st.run_id=av.produced_by_run_id AND st.file->>'objectKey'=av.storage_key
     WHERE av.org_id=$1 AND av.id=$2 AND av.artifact_id=$3 AND av.version=$4
       AND att.thread_id=$5 AND att.storage_ref=av.storage_key AND att.bytes=av.size_bytes
       AND (st.file->>'sizeBytes')::bigint=av.size_bytes AND st.file->>'mime'=att.mime`,
    [input.orgId,input.versionId,row.artifact_id,row.version,locator.threadId])).rows[0]
    :(await session.query<{sha256:string;mime:string;size_bytes:string;object_key:string}>(`SELECT item->>'sha256' AS sha256,item->>'mime' AS mime,
      item->>'sizeBytes' AS size_bytes,item->>'objectKey' AS object_key FROM subtask_runs c
      JOIN agent_runs r ON r.org_id=c.org_id AND r.id=c.parent_run_id
      JOIN agent_artifacts a ON a.org_id=c.org_id AND a.thread_id=r.thread_id AND a.id=$3
      CROSS JOIN LATERAL jsonb_array_elements(c.output_manifest) item
      WHERE c.org_id=$1 AND c.status='completed' AND item->>'versionId'=$2 AND item->>'artifactId'=$3`,[input.orgId,input.versionId,row.artifact_id])).rows[0];
   if(!metadata||!Number.isSafeInteger(Number(metadata.size_bytes))||Number(metadata.size_bytes)>limits.maxFileBytes||!/^([a-f0-9]{64})$/.test(metadata.sha256))throw missing();
   const disclosed=discloseDecided(guard({kind:'artifact',id:row.artifact_id},{versionId:input.versionId,artifactId:row.artifact_id,projectId:locator.projectId,objectKey:metadata.object_key,mime:metadata.mime,sizeBytes:Number(metadata.size_bytes),contentHash:metadata.sha256,ingestionStatus:'STORED' as const}),access.base);
   if(!isDisclosed(disclosed))throw missing();
   return {version:disclosed.payload,decision:access.base};
  });
 }
}

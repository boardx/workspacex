import {guard,discloseDecided,isDisclosed} from '../../application/security/permission-filter';
import {resolveVisibility} from '../../application/chat/resolve-visibility';
import type {DatabasePort} from '../../application/ports/database.port';
import type {OrgId} from '../../domain/org-id';
import type {RunArtifactRefsReader} from '../../application/agent-run/standard-run-status';
import {getArtifact,type ArtifactReadDeps} from '../../application/artifacts-steering/read-artifact';
export class PgRunArtifactRefsReader implements RunArtifactRefsReader {
 constructor(private readonly db:DatabasePort,private readonly deps:ArtifactReadDeps,private readonly read:typeof getArtifact=getArtifact){}
 async listProducedByRun(actor:{orgId:OrgId;userId:string},runId:string){
  const candidates=await this.db.withTenant(actor.orgId,async session=>(await session.query<{artifact_id:string;id:string;version:number}>(
   `SELECT artifact_id,id,version FROM agent_artifact_versions WHERE org_id=$1 AND produced_by_run_id=$2 ORDER BY created_at,artifact_id,version`,[actor.orgId,runId])).rows);
  const allowed=new Map<string,Set<number>>();
  for(const id of new Set(candidates.map(row=>row.artifact_id))){
   try { const artifact=await this.read(this.deps,{...actor,artifactId:id});allowed.set(id,new Set(artifact.versions.map(version=>version.version))); }
   catch { allowed.set(id,new Set()); }
  }
  const result=[];
  for(const row of candidates.filter(row=>allowed.get(row.artifact_id)?.has(row.version))){
   const locator=await this.deps.artifacts.findLocator(actor.orgId,row.artifact_id);
   if(!locator)continue;
   const current=await resolveVisibility(this.deps,{...actor,...locator});
   if(current.kind!=='allow')continue;
   const visible=discloseDecided(guard({kind:'artifact',id:row.artifact_id},{artifactId:row.artifact_id,versionId:row.id}),current.base);
   if(isDisclosed(visible))result.push(visible.payload);
  }
  return result;
 }
}

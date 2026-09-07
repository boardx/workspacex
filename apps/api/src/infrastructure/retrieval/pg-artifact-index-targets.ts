import type {DatabasePort} from '../../application/ports/database.port';
import type {OrgId} from '../../domain/org-id';
import type {ArtifactIndexTargets} from '../../application/retrieval/request-artifact-index';
import {guard} from '../../application/security/permission-filter';
export class PgArtifactIndexTargets implements ArtifactIndexTargets {
 constructor(private db:DatabasePort){}
 async find(orgId:OrgId,versionId:string){
  const row=await this.db.withTenant(orgId,async s=>(await s.query<{artifact_id:string;project_id:string|null;ingestion_status:string;confidential:boolean}>('SELECT a.id AS artifact_id,a.project_id,a.ingestion_status,a.confidential FROM artifact_versions v JOIN artifacts a ON a.org_id=v.org_id AND a.id=v.artifact_id WHERE v.org_id=$1 AND v.id=$2',[orgId,versionId])).rows[0]);
  return row?{projectId:row.project_id,target:guard({kind:'artifact',id:row.artifact_id},{artifactId:row.artifact_id,status:row.ingestion_status,confidential:row.confidential})}:null;
 }
}

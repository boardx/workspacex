import type { DatabasePort, TenantSession } from "../../application/ports/database.port";
import type { AidtRawFilesRepository, RawActor, RawContent, RawRun, RawTransaction } from "../../application/aidt-files/ports";
import type { Principal } from "../../domain/principal";
import type { OrgId } from "../../domain/org-id";
import { artifact } from "@repo/contracts";
import { guard } from "../../application/security/permission-filter";
import { PgIdentityRepository } from "../identity/pg-identity-repository";
import { PgArtifactRepository } from "../artifact/pg-artifact-repository";
import { PgQuarantineRepository } from "../files/pg-quarantine-repository";
import { PgProvenanceRepository } from "../provenance/pg-provenance-repository";

function bound(session:TenantSession,orgId:OrgId):DatabasePort {return {
  async withTenant<T>(requested:OrgId,fn:(s:TenantSession)=>Promise<T>) {if(requested!==orgId) throw new Error("tenant mismatch");return fn(session);},
  async withoutTenant<T>():Promise<T> {throw new Error("global raw-file reads forbidden");},async close() {},
};}
type ContentRow={id:string;project_id:string;artifact_id:string;artifact_version_id:string;filename:string;mime:string;sha256:string;size_bytes:string|number;object_storage_key:string;content_hash:string;created_by:string;created_at:Date|string};
export class PgAidtRawFilesRepository implements AidtRawFilesRepository {
  constructor(private readonly db:DatabasePort) {}
  projectForRun(actor:Principal,runId:string) {
    return this.db.withTenant(actor.orgId,async s=>{
      // Locator only, never disclosed. The following project transaction checks current
      // membership and the artifact ACL before any receipt/status/content leaves storage.
      const r=await s.query<{project_id:string}>("SELECT project_id FROM aidt_raw_upload_runs WHERE org_id=$1 AND id=$2",[actor.orgId,runId]);
      return r.rows[0]?.project_id??null;
    });
  }
  inProject<T>(actor:RawActor,fn:(tx:RawTransaction)=>Promise<T>) {
    return this.db.withTenant(actor.orgId,async s=>{
      const p=await s.query<{status:string;org_status:string;kind:string;aidt:boolean}>(`SELECT p.status,o.status AS org_status,p.kind,
        EXISTS(SELECT 1 FROM project_tags t WHERE t.org_id=p.org_id AND t.project_id=p.id AND t.tag='workspacex:aidt') AS aidt
        FROM projects p JOIN organizations o ON o.id=p.org_id WHERE p.org_id=$1 AND p.id=$2
        FOR NO KEY UPDATE OF p FOR SHARE OF o`,[actor.orgId,actor.projectId]);
      await s.query("SELECT user_id FROM general_project_members WHERE org_id=$1 AND project_id=$2 AND user_id=$3 FOR SHARE",[actor.orgId,actor.projectId,actor.userId]);
      await s.query("SELECT user_id FROM org_memberships WHERE org_id=$1 AND user_id=$2 FOR SHARE",[actor.orgId,actor.userId]);
      // Prevent scope/team changes during ACL read and content write. No ownership or role
      // is inferred here; the application uses the existing identity decision engine.
      await s.query("SELECT id FROM acl_bindings WHERE org_id=$1 AND object_kind='project' AND object_id=$2 FOR SHARE",[actor.orgId,actor.projectId]);
      const db=bound(s,actor.orgId),project=p.rows[0];
      return fn({identity:new PgIdentityRepository(db),artifacts:new PgArtifactRepository(db),quarantine:new PgQuarantineRepository(db),provenance:new PgProvenanceRepository(db),
        project:project?{aidt:project.kind==="general"&&project.aidt,status:project.status,orgStatus:project.org_status}:null,
        async findReusableVersion(contentHash,pipelineVersion,parserVersion,visibility,confidential,agenda) {
          const r=await s.query<{artifact_id:string;version_id:string;version_number:number}>(`SELECT a.id AS artifact_id,v.id AS version_id,v.version_number
            FROM artifacts a JOIN artifact_versions v ON v.org_id=a.org_id AND v.artifact_id=a.id
            JOIN wsx_visible_artifacts(a.project_id,(SELECT team_id FROM org_memberships WHERE org_id=$1 AND user_id=$9)) vis ON vis.artifact_id=a.id
            WHERE a.org_id=$1 AND a.project_id=$2 AND v.content_hash=$3 AND v.pipeline_version=$4 AND v.parser_version=$5
              AND vis.scope=$6 AND a.confidential=$7 AND a.agenda_segment_id IS NOT DISTINCT FROM $8 AND a.source='upload'
            ORDER BY v.pinned_at ASC,v.id ASC LIMIT 1 FOR UPDATE OF a`,[actor.orgId,actor.projectId,contentHash,pipelineVersion,parserVersion,visibility,confidential,agenda,actor.userId]);
          const row=r.rows[0];if(!row) return null;
          await s.query("SELECT id FROM acl_bindings WHERE org_id=$1 AND object_kind='artifact' AND object_id=$2 FOR SHARE",[actor.orgId,row.artifact_id]);
          return {artifactId:row.artifact_id,versionId:row.version_id,versionNumber:row.version_number};
        },
        async bindVisibility(id,scope,team) {
          await s.query(`INSERT INTO acl_bindings(org_id,subject_kind,subject_id,object_kind,object_id,scope,owner_team_id) VALUES($1,'user',$2,'artifact',$3,$4,$5)`,[actor.orgId,actor.userId,id,scope,scope==="team-only"?team:null]);
        },
        async insertRun(run:RawRun) {
          await s.query(`INSERT INTO aidt_raw_upload_runs(id,org_id,project_id,artifact_id,artifact_version_id,filename,mime,sha256,size_bytes,created_by)
            VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,[run.id,actor.orgId,actor.projectId,run.artifactId,run.versionId,run.filename,run.mime,run.sha256,run.sizeBytes,actor.userId]);
        },
        async content(id) {
          const r=await s.query<ContentRow>(`SELECT r.id,r.project_id,r.artifact_id,r.artifact_version_id,r.filename,r.mime,r.sha256,r.size_bytes,r.created_by,r.created_at,v.object_storage_key,v.content_hash
            FROM aidt_raw_upload_runs r JOIN artifacts a ON a.org_id=r.org_id AND a.id=r.artifact_id AND a.project_id=r.project_id
            JOIN artifact_versions v ON v.org_id=r.org_id AND v.id=r.artifact_version_id AND v.artifact_id=r.artifact_id
            JOIN wsx_visible_artifacts(a.project_id,(SELECT team_id FROM org_memberships WHERE org_id=$1 AND user_id=$4)) vis ON vis.artifact_id=a.id
            WHERE r.org_id=$1 AND r.project_id=$2 AND r.id=$3 FOR SHARE OF a`,[actor.orgId,actor.projectId,id,actor.userId]);
          const row=r.rows[0];if(!row) return null;
          await s.query("SELECT id FROM acl_bindings WHERE org_id=$1 AND object_kind='artifact' AND object_id=$2 FOR SHARE",[actor.orgId,row.artifact_id]);
          const h=await s.query<{status:string}>("SELECT status FROM ingestion_history WHERE org_id=$1 AND artifact_version_id=$2 ORDER BY occurred_at,id",[actor.orgId,row.artifact_version_id]);
          const f=await s.query("SELECT id FROM ingestion_outbox WHERE org_id=$1 AND artifact_version_id=$2 AND status='failed'",[actor.orgId,row.artifact_version_id]);
          const history=(["STORED",...h.rows.map(x=>x.status)]).map(status=>artifact.IngestionStatus.parse(status));
          const value:RawContent={id:row.id,projectId:row.project_id,artifactId:row.artifact_id,versionId:row.artifact_version_id,filename:row.filename,mime:row.mime,sha256:row.sha256,sizeBytes:Number(row.size_bytes),objectKey:row.object_storage_key,versionHash:row.content_hash,history,failed:f.rows.length>0,submittedBy:row.created_by,submittedAt:new Date(row.created_at).toISOString()};
          return guard({kind:"artifact",id:row.artifact_id},value);
        },
      });
    });
  }
}

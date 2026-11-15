/** Shared drafts use their own append-only history. Project row lock serializes CAS + receipt.
 * All content leaves storage Guarded and is disclosed only by the application authorization.
 */
import { SharedStage, type SharedStageValue } from "@repo/contracts/aidt-stages";
import type { DatabasePort, TenantSession } from "../../application/ports/database.port";
import type { AidtStageRepository, StageActor, StageTransaction } from "../../application/aidt-stages/ports";
import { guard } from "../../application/security/permission-filter";
import { PgIdentityRepository } from "../identity/pg-identity-repository";
import type { OrgId } from "../../domain/org-id";
function boundDatabase(session:TenantSession,orgId:OrgId):DatabasePort { return {
  async withTenant<T>(requested:OrgId,fn:(s:TenantSession)=>Promise<T>):Promise<T> {if(requested!==orgId) throw new Error("tenant mismatch");return fn(session);},
  async withoutTenant<T>():Promise<T> {throw new Error("global stage reads forbidden");},async close() {},
}; }
type Row={project_id:string;stage_id:number;revision:number;content:unknown;source_stage_revisions:unknown;updated_by:string;updated_at:Date|string;request_key:string};
function stage(row:Row):SharedStageValue {return SharedStage.parse({projectId:row.project_id,stageId:row.stage_id,revision:row.revision,content:row.content,sourceStageRevisions:row.source_stage_revisions,updatedBy:row.updated_by,updatedAt:new Date(row.updated_at).toISOString()});}
export class PgAidtStageRepository implements AidtStageRepository {
  constructor(private readonly db:DatabasePort) {}
  inProject<T>(actor:StageActor,fn:(tx:StageTransaction)=>Promise<T>):Promise<T> {
    return this.db.withTenant(actor.orgId,async s=>{
      // Same lock as tag replacement/archiving. Organization status cannot change during write.
      const p=await s.query<{status:string;org_status:string;kind:string;aidt:boolean}>(`SELECT p.status, o.status AS org_status, p.kind,
        EXISTS(SELECT 1 FROM project_tags t WHERE t.org_id=p.org_id AND t.project_id=p.id AND t.tag='workspacex:aidt') AS aidt
        FROM projects p JOIN organizations o ON o.id=p.org_id
        WHERE p.org_id=$1 AND p.id=$2 FOR NO KEY UPDATE OF p FOR SHARE OF o`,[actor.orgId,actor.projectId]);
      const project=p.rows[0];
      // Hold the actual membership row through commit; a concurrent removal either precedes
      // this transaction's recheck or waits until its already-authorized write finishes.
      // This is only a lock; IdentityRepository remains the sole role interpretation.
      await s.query(`SELECT user_id FROM general_project_members WHERE org_id=$1 AND project_id=$2 AND user_id=$3 FOR SHARE`,[actor.orgId,actor.projectId,actor.userId]);
      const ref={kind:"project" as const,id:actor.projectId};
      return fn({identity:new PgIdentityRepository(boundDatabase(s,actor.orgId)),
        project:project?{status:project.status,orgStatus:project.org_status,aidt:project.kind==="general"&&project.aidt}:null,
        async current(stageId) {const r=await s.query<Row>(`SELECT * FROM aidt_stage_revisions WHERE org_id=$1 AND project_id=$2 AND stage_id=$3 ORDER BY revision DESC LIMIT 1`,[actor.orgId,actor.projectId,stageId]);return guard(ref,r.rows[0]?stage(r.rows[0]):null);},
        async history(stageId,beforeRevision,limit) {const r=await s.query<Row>(`SELECT * FROM aidt_stage_revisions WHERE org_id=$1 AND project_id=$2 AND stage_id=$3 AND ($4::integer IS NULL OR revision<$4) ORDER BY revision DESC LIMIT $5`,[actor.orgId,actor.projectId,stageId,beforeRevision??null,limit]);return guard(ref,r.rows.map(stage));},
        async receipt(operationId) {const r=await s.query<Row>(`SELECT * FROM aidt_stage_revisions WHERE org_id=$1 AND project_id=$2 AND updated_by=$3 AND operation_id=$4`,[actor.orgId,actor.projectId,actor.userId,operationId]);return guard(ref,r.rows[0]?{stage:stage(r.rows[0]),requestKey:r.rows[0].request_key}:null);},
        async hasRevision(stageId,revision) {const r=await s.query(`SELECT 1 FROM aidt_stage_revisions WHERE org_id=$1 AND project_id=$2 AND stage_id=$3 AND revision=$4`,[actor.orgId,actor.projectId,stageId,revision]);return r.rows.length>0;},
        async hasImageAttachment(ref) {const r=await s.query(`SELECT a.id FROM chat_message_attachments a
          JOIN chat_threads t ON t.org_id=a.org_id AND t.id=a.thread_id
          JOIN chat_messages m ON m.org_id=a.org_id AND m.id=a.message_id AND m.thread_id=t.id
          WHERE a.org_id=$1 AND t.project_id=$2 AND a.id=$3 AND a.thread_id=$4
          AND t.visibility_scope='plenary' AND t.ownership_layer='project' AND NOT t.agent_private AND t.group_id IS NULL
          AND a.message_id IS NOT NULL AND a.cancelled_at IS NULL AND a.filename=$5 AND a.mime IN ('image/png','image/jpeg','image/webp')
          FOR SHARE OF a,t,m`,[actor.orgId,actor.projectId,ref.attachmentId,ref.threadId,ref.name]);return r.rows.length>0;},
        async append(input,requestKey) {const r=await s.query<Row>(`INSERT INTO aidt_stage_revisions(org_id,project_id,stage_id,revision,content,source_stage_revisions,updated_by,operation_id,request_key)
          VALUES($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7,$8,$9) RETURNING *`,[actor.orgId,actor.projectId,input.stageId,input.expectedRevision+1,JSON.stringify(input.content),JSON.stringify(input.sourceStageRevisions),actor.userId,input.operationId,requestKey]);return guard(ref,stage(r.rows[0]!));},
      });
    });
  }
}

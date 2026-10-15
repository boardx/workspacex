import { toOrgId } from '../../domain/org-id';
import { guard } from '../../application/security/permission-filter';
import { randomUUID } from 'node:crypto';
import { InterviewCustomExpert, CreateInterviewCustomExpert } from '@repo/contracts/interview-expert-library';
import type { z } from 'zod';
import type { DatabasePort } from '../../application/ports/database.port';
import { ExpertLibraryAccessError, ExpertLibraryConflictError, type ExpertLibraryActor, type InterviewCustomExpertLibrary } from '../../application/interview/custom-expert-library';
type Row={org_id:string;actor_id:string;expert_id:string;fields:unknown;created_at:Date};
const entry=(row:Row)=>InterviewCustomExpert.parse({expertId:row.expert_id,origin:'custom',fields:row.fields,createdAt:row.created_at.toISOString()});
export class PgCustomExpertLibrary implements InterviewCustomExpertLibrary {
 constructor(private readonly db:DatabasePort){}
 list(actor:ExpertLibraryActor){return this.db.withTenant(actor.orgId,async s=>{
  const rows=await s.query<Row>(`SELECT org_id,actor_id,expert_id,fields,created_at FROM interview_custom_expert_profiles WHERE org_id=$1 AND actor_id=$2 AND EXISTS(SELECT 1 FROM org_memberships WHERE org_id=$1 AND user_id=$2) ORDER BY created_at,expert_id`,[actor.orgId,actor.actorId]);
  return rows.rows.map(row=>({orgId:toOrgId(row.org_id),actorId:row.actor_id,item:guard({kind:'interview_expert_profile',id:row.expert_id},entry(row))}));
 });}
 create(actor:ExpertLibraryActor,input:z.infer<typeof CreateInterviewCustomExpert>){return this.db.withTenant(actor.orgId,async s=>{
  const membership=await s.query(`SELECT user_id FROM org_memberships WHERE org_id=$1 AND user_id=$2 FOR SHARE`,[actor.orgId,actor.actorId]);
  if(!membership.rows.length)throw new ExpertLibraryAccessError();
  const row=await s.query<Row>(`INSERT INTO interview_custom_expert_profiles(org_id,actor_id,expert_id,request_id,fields) VALUES($1,$2,$3,$4,$5::jsonb) ON CONFLICT(org_id,actor_id,request_id) DO NOTHING RETURNING org_id,actor_id,expert_id,fields,created_at`,[actor.orgId,actor.actorId,`custom-expert-${randomUUID()}`,input.requestId,JSON.stringify(input.fields)]);
  const existing=row.rows[0] ?? (await s.query<Row>('SELECT org_id,actor_id,expert_id,fields,created_at FROM interview_custom_expert_profiles WHERE org_id=$1 AND actor_id=$2 AND request_id=$3',[actor.orgId,actor.actorId,input.requestId])).rows[0]!;
  if(JSON.stringify(entry(existing).fields)!==JSON.stringify(input.fields))throw new ExpertLibraryConflictError();
  return {orgId:toOrgId(existing.org_id),actorId:existing.actor_id,item:guard({kind:'interview_expert_profile',id:existing.expert_id},entry(existing))};
 });}
}

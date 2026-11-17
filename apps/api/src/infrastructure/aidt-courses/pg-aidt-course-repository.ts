/** AIDT course metadata and constrained group references; never changes Project membership. */
import { randomUUID } from "node:crypto";
import { Course, CourseGroup, type CourseValue } from "@repo/contracts/aidt-courses";
import type { DatabasePort, TenantSession } from "../../application/ports/database.port";
import type { AidtCourseRepository, CourseActor, CourseTransaction } from "../../application/aidt-courses/ports";
import { guard } from "../../application/security/permission-filter";
import { PgIdentityRepository } from "../identity/pg-identity-repository";
import { deriveReadOnlyReason } from "../../domain/project/readonly-reason";
import type { OrgId } from "../../domain/org-id";
type CourseRow={id:string;name:string;created_at:Date|string};
const view=(row:CourseRow):CourseValue=>Course.parse({id:row.id,name:row.name,createdAt:new Date(row.created_at).toISOString()});
function bound(s:TenantSession,orgId:OrgId):DatabasePort{return {
 async withTenant<T>(requested:OrgId,fn:(tx:TenantSession)=>Promise<T>){if(requested!==orgId)throw new Error("course tenant mismatch");return fn(s);},
 async withoutTenant<T>():Promise<T>{throw new Error("Global course reads forbidden");},async close(){},
};}
export class PgAidtCourseRepository implements AidtCourseRepository {
 constructor(private readonly db:DatabasePort){}
 inOrg<T>(actor:CourseActor,fn:(tx:CourseTransaction)=>Promise<T>):Promise<T>{return this.db.withTenant(actor.orgId,async s=>{
  const org=await s.query<{status:string}>(`SELECT status FROM organizations WHERE id=$1 FOR SHARE`,[actor.orgId]);
  // A concurrent role removal/change cannot race an already-authorized metadata write.
  await s.query(`SELECT user_id FROM org_memberships WHERE org_id=$1 AND user_id=$2 FOR SHARE`,[actor.orgId,actor.userId]);
  return fn({identity:new PgIdentityRepository(bound(s,actor.orgId)),orgStatus:org.rows[0]?.status??null,
   async list(manager,page){const rows=await s.query<CourseRow>(`SELECT c.id,c.name,c.created_at FROM aidt_courses c
    WHERE c.org_id=$1 AND ($4::text IS NULL OR c.id>$4)
    AND ($3::boolean OR EXISTS(SELECT 1 FROM aidt_course_groups g JOIN general_project_members m ON m.org_id=g.org_id AND m.project_id=g.project_id WHERE g.org_id=c.org_id AND g.course_id=c.id AND m.user_id=$2))
    ORDER BY c.id LIMIT $5`,[actor.orgId,actor.userId,manager,page.cursor??null,page.limit]);return rows.rows.map(view);},
   async find(id){const rows=await s.query<CourseRow>(`SELECT id,name,created_at FROM aidt_courses WHERE org_id=$1 AND id=$2`,[actor.orgId,id]);return rows.rows[0]?view(rows.rows[0]):null;},
   async isMember(id){const rows=await s.query(`SELECT m.user_id FROM aidt_course_groups g JOIN general_project_members m ON m.org_id=g.org_id AND m.project_id=g.project_id WHERE g.org_id=$1 AND g.course_id=$2 AND m.user_id=$3 LIMIT 1 FOR SHARE OF m`,[actor.orgId,id,actor.userId]);return rows.rows.length>0;},
   async create(name,operationId){const inserted=await s.query<CourseRow>(`INSERT INTO aidt_courses(id,org_id,name,created_by,create_operation_id) VALUES($1,$2,$3,$4,$5)
    ON CONFLICT(org_id,created_by,create_operation_id) DO NOTHING RETURNING id,name,created_at`,[`crs-${randomUUID()}`,actor.orgId,name,actor.userId,operationId]);
    if(inserted.rows[0])return {course:view(inserted.rows[0]),created:true};
    const previous=await s.query<CourseRow>(`SELECT id,name,created_at FROM aidt_courses WHERE org_id=$1 AND created_by=$2 AND create_operation_id=$3`,[actor.orgId,actor.userId,operationId]);
    if(!previous.rows[0])throw new Error("Course create receipt missing");return {course:view(previous.rows[0]),created:false};},
   async groups(courseId,page){const rows=await s.query<{id:string;name:string;status:string;tags:string[]}>(`SELECT p.id,p.name,p.status,
    ARRAY(SELECT t.tag FROM project_tags t WHERE t.org_id=p.org_id AND t.project_id=p.id ORDER BY t.tag) AS tags
    FROM aidt_course_groups g JOIN projects p ON p.org_id=g.org_id AND p.id=g.project_id
    JOIN general_project_members m ON m.org_id=p.org_id AND m.project_id=p.id AND m.user_id=$3
    WHERE g.org_id=$1 AND g.course_id=$2 AND p.kind='general' AND EXISTS(SELECT 1 FROM project_tags t WHERE t.org_id=p.org_id AND t.project_id=p.id AND t.tag='workspacex:aidt') AND ($4::text IS NULL OR p.id>$4) ORDER BY p.id LIMIT $5 FOR SHARE OF m,p`,[actor.orgId,courseId,actor.userId,page.cursor??null,page.limit]);
    return Promise.all(rows.rows.map(async row=>{
     const members=await s.query<{user_id:string;display_name:string|null}>(`SELECT m.user_id,c.display_name FROM general_project_members m LEFT JOIN credentials c ON c.user_id=m.user_id WHERE m.org_id=$1 AND m.project_id=$2 ORDER BY m.user_id FOR SHARE OF m`,[actor.orgId,row.id]);
     return {id:row.id,value:guard({kind:"project",id:row.id},CourseGroup.parse({project:{id:row.id,name:row.name,kind:"general",status:row.status,tags:row.tags,
      readOnlyReason:deriveReadOnlyReason({projectStatus:row.status==="archived"?"archived":"active",orgStatus:org.rows[0]?.status==="disabled"?"disabled":"active"})},members:members.rows.map(m=>({userId:m.user_id,displayName:m.display_name??m.user_id}))}))};
    }));},
   async lockGroup(id){const rows=await s.query<{kind:string;status:string;aidt:boolean}>(`SELECT p.kind,p.status,EXISTS(SELECT 1 FROM project_tags t WHERE t.org_id=p.org_id AND t.project_id=p.id AND t.tag='workspacex:aidt') AS aidt FROM projects p WHERE p.org_id=$1 AND p.id=$2 FOR NO KEY UPDATE OF p`,[actor.orgId,id]);
    await s.query(`SELECT user_id FROM general_project_members WHERE org_id=$1 AND project_id=$2 AND user_id=$3 FOR SHARE`,[actor.orgId,id,actor.userId]);
    const row=rows.rows[0];return row&&row.kind==="general"?{active:row.status==="active",aidt:row.aidt}:null;},
   async link(courseId,projectId){const inserted=await s.query<{course_id:string}>(`INSERT INTO aidt_course_groups(org_id,course_id,project_id,linked_by) VALUES($1,$2,$3,$4) ON CONFLICT(org_id,project_id) DO NOTHING RETURNING course_id`,[actor.orgId,courseId,projectId,actor.userId]);
    if(inserted.rows[0])return {courseId:inserted.rows[0].course_id,replayed:false};
    const previous=await s.query<{course_id:string}>(`SELECT course_id FROM aidt_course_groups WHERE org_id=$1 AND project_id=$2`,[actor.orgId,projectId]);
    if(!previous.rows[0])throw new Error("Course group link receipt missing");return {courseId:previous.rows[0].course_id,replayed:true};},
  });
 });}
}

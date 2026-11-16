import { randomUUID } from "node:crypto";
import { operations, type CoursePage, type CourseGroupValue } from "@repo/contracts/aidt-courses";
import { authorize } from "../identity/authorize";
import { discloseDecided, isDisclosed } from "../security/permission-filter";
import type { AidtCourseRepository, CourseActor, CourseTransaction } from "./ports";
export class AidtCourseError extends Error {constructor(public readonly reasonCode:string){super(reasonCode);}}
function failure(code:string):never{throw new AidtCourseError(code);}
export class AidtCoursesService {
 constructor(private readonly repo:AidtCourseRepository,private readonly enabled:()=>boolean=()=>false){}
 private async access<T>(actor:CourseActor,fn:(tx:CourseTransaction,manager:boolean)=>Promise<T>):Promise<T>{
  if(!this.enabled())failure("AIDT_COURSE_NOT_FOUND");
  try{return await this.repo.inOrg(actor,async tx=>{
   const membership=await tx.identity.findOrgMembership(actor.userId,actor.orgId);
   if(!membership||!tx.orgStatus)failure("AIDT_COURSE_NOT_FOUND");
   return fn(tx,membership.orgRole==="lead"||membership.orgRole==="admin");
  });}catch(error){if(error instanceof AidtCourseError)throw error;return failure("AIDT_COURSE_UNAVAILABLE");}
 }
 list(actor:CourseActor,page:CoursePage){const parsed=operations.list.in.safeParse(page);if(!parsed.success)failure("AIDT_COURSE_INVALID");return this.access(actor,async(tx,manager)=>{
  const rows=await tx.list(manager,{...parsed.data,limit:parsed.data.limit+1}),items=rows.slice(0,parsed.data.limit);return {items,nextCursor:rows.length>items.length?items.at(-1)!.id:null};
 });}
 create(actor:CourseActor,input:unknown){const parsed=operations.create.in.safeParse(input);if(!parsed.success)failure("AIDT_COURSE_INVALID");return this.access(actor,async(tx,manager)=>{
  if(!manager||tx.orgStatus!=="active")failure("AIDT_COURSE_FORBIDDEN");
  const result=await tx.create(parsed.data.name,parsed.data.operationId);
  if(result.course.name!==parsed.data.name)failure("AIDT_COURSE_OPERATION_CONFLICT");
  return {course:result.course,replayed:!result.created};
 });}
 groups(actor:CourseActor,courseId:string,page:CoursePage){const parsed=operations.groups.in.safeParse({...page,courseId});if(!parsed.success)failure("AIDT_COURSE_INVALID");return this.access(actor,async(tx,manager)=>{
  const course=await tx.find(courseId);if(!course||!manager&&!await tx.isMember(courseId))failure("AIDT_COURSE_NOT_FOUND");
  const rows=await tx.groups(courseId,{...page,limit:parsed.data.limit+1}),items:CourseGroupValue[]=[];
  for(const row of rows.slice(0,parsed.data.limit)){
   // A course-level manager never receives a Project observer fallback as group membership.
   const standing=await tx.identity.findNonWorkshopStanding(actor.userId,row.id,actor.orgId);
   if(!standing?.memberRole)failure("AIDT_COURSE_NOT_FOUND");
   const decision=await authorize({repo:tx.identity,ids:{next:()=>randomUUID()}},{...actor,projectId:row.id,object:{kind:"project",id:row.id},action:"read.published"});
   const value=discloseDecided(row.value,decision);if(!decision.allowed||!isDisclosed(value))failure("AIDT_COURSE_NOT_FOUND");items.push(value.payload);
  }
  return {course,items,nextCursor:rows.length>parsed.data.limit?rows[parsed.data.limit-1]!.id:null};
 });}
 link(actor:CourseActor,courseId:string,projectId:string){if(!operations.link.in.safeParse({courseId,projectId}).success)failure("AIDT_COURSE_INVALID");return this.access(actor,async(tx,manager)=>{
  if(!manager||tx.orgStatus!=="active")failure("AIDT_COURSE_FORBIDDEN");
  if(!await tx.find(courseId))failure("AIDT_COURSE_NOT_FOUND");
  const project=await tx.lockGroup(projectId),standing=await tx.identity.findNonWorkshopStanding(actor.userId,projectId,actor.orgId);
  if(!project||standing?.memberRole!=="owner")failure("AIDT_COURSE_NOT_FOUND");
  if(!project.active||!project.aidt)failure("AIDT_COURSE_FORBIDDEN");
  const linked=await tx.link(courseId,projectId);if(linked.courseId!==courseId)failure("AIDT_COURSE_GROUP_CONFLICT");
  return {courseId,projectId,replayed:linked.replayed};
 });}
}
export const AIDT_COURSES_SERVICE=Symbol("AidtCoursesService");

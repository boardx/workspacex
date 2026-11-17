/** Memory ports exercise decisions; not PostgreSQL or native browser acceptance. */
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { AidtCoursesService } from "../../src/application/aidt-courses/service";
import type { AidtCourseRepository, CourseActor, CourseTransaction } from "../../src/application/aidt-courses/ports";
import type { IdentityRepository } from "../../src/application/identity/ports";
import { guard } from "../../src/application/security/permission-filter";
import { toOrgId } from "../../src/domain/org-id";
import { Course, operations, type CourseValue } from "@repo/contracts/aidt-courses";
const orgId=toOrgId("org-a"), manager:CourseActor={orgId,userId:"admin"}, student:CourseActor={orgId,userId:"student-a"};
const input=()=>({name:"设计思维课",operationId:randomUUID()});
function fixture(){
 const courses=new Map<string,CourseValue>(), receipts=new Map<string,string>(), links=new Map<string,string>();
 const members=new Map([["group-a",new Map([["admin","owner"],["student-a","collaborator"]])],["group-b",new Map([["teacher","owner"],["student-b","collaborator"]])]]);
 let state={orgStatus:"active",orgMember:true,active:true,aidt:true,fail:false};let next=0;
 const repo:AidtCourseRepository={async inOrg<T>(actor:CourseActor,fn:(tx:CourseTransaction)=>Promise<T>):Promise<T>{
  if(state.fail)throw new Error("unavailable");const same=actor.orgId===orgId;
  const actual=(id:string)=>same&&members.get(id)?.has(actor.userId)===true;
  const identity={findOrgMembership:async()=>same&&state.orgMember?{orgRole:actor.userId==="admin"||actor.userId==="teacher"?"admin":"consultant",teamId:null}:null,
   findProjectMembership:async()=>null,findNonWorkshopStanding:async(_user:string,id:string)=>({containerKind:"general",memberRole:same?members.get(id)?.get(actor.userId)??null:null}),findBindings:async()=>new Map()} as unknown as IdentityRepository;
  return fn({identity,orgStatus:same?state.orgStatus:null,
   list:async(isManager,page)=>[...courses.values()].filter(c=>same&&(isManager||[...links].some(([g,id])=>id===c.id&&actual(g)))&&(!page.cursor||c.id>page.cursor)).sort((a,b)=>a.id.localeCompare(b.id)).slice(0,page.limit),
   find:async id=>same?courses.get(id)??null:null,
   isMember:async id=>[...links].some(([g,c])=>c===id&&actual(g)),
   create:async(name,operation)=>{const key=`${actor.userId}/${operation}`,previous=receipts.get(key);if(previous)return {course:courses.get(previous)!,created:false};const course={id:`course-${++next}`,name,createdAt:new Date().toISOString()};courses.set(course.id,course);receipts.set(key,course.id);return {course,created:true};},
   groups:async(id,page)=>[...links].filter(([g,c])=>c===id&&actual(g)&&(!page.cursor||g>page.cursor)).sort().slice(0,page.limit).map(([g])=>({id:g,value:guard({kind:"project",id:g},{project:{id:g,name:g,kind:"general",status:state.active?"active":"archived",readOnlyReason:state.active?null:"archived",tags:["workspacex:aidt"]},members:[...members.get(g)!.keys()].map(userId=>({userId,displayName:userId}))})})),
   lockGroup:async id=>same&&members.has(id)?{active:state.active,aidt:state.aidt}:null,
   link:async(id,g)=>{const previous=links.get(g);if(previous)return {courseId:previous,replayed:true};links.set(g,id);return {courseId:id,replayed:false};},
  });
 }};
 return {service:new AidtCoursesService(repo,()=>true),repo,courses,links,members,setState:(v:Partial<typeof state>)=>{state={...state,...v};}};
}
describe("user-approved AIDT course registry decisions",()=>{
 it("is disabled before touching storage by default",async()=>{const f=fixture();f.setState({fail:true});await expect(new AidtCoursesService(f.repo).list(manager,{limit:20})).rejects.toMatchObject({reasonCode:"AIDT_COURSE_NOT_FOUND"});});
 it("creates once and replays only same actor, operation and request",async()=>{const f=fixture(),v=input();const out=await f.service.create(manager,v);expect(out.replayed).toBe(false);expect(await f.service.create(manager,v)).toEqual({...out,replayed:true});await expect(f.service.create(manager,{...v,name:"不同课"})).rejects.toMatchObject({reasonCode:"AIDT_COURSE_OPERATION_CONFLICT"});expect(f.courses.size).toBe(1);expect((await f.service.create({...manager,userId:"teacher"},v)).course.id).not.toBe(out.course.id);});
 it("does not let course managers grant themselves group membership",async()=>{const f=fixture(),{course}=await f.service.create(manager,input());await expect(f.service.link(manager,course.id,"group-b")).rejects.toMatchObject({reasonCode:"AIDT_COURSE_NOT_FOUND"});expect(f.links.size).toBe(0);expect(f.members.get("group-b")!.has("admin")).toBe(false);});
 it("requires both manager and current group owner for links",async()=>{const f=fixture(),{course}=await f.service.create(manager,input());await expect(f.service.link(student,course.id,"group-a")).rejects.toMatchObject({reasonCode:"AIDT_COURSE_FORBIDDEN"});f.members.get("group-a")!.set("admin","collaborator");await expect(f.service.link(manager,course.id,"group-a")).rejects.toMatchObject({reasonCode:"AIDT_COURSE_NOT_FOUND"});});
 it("links one group to only one course, replay never moves it",async()=>{const f=fixture(),first=(await f.service.create(manager,input())).course,second=(await f.service.create(manager,input())).course;expect((await f.service.link(manager,first.id,"group-a")).replayed).toBe(false);expect((await f.service.link(manager,first.id,"group-a")).replayed).toBe(true);await expect(f.service.link(manager,second.id,"group-a")).rejects.toMatchObject({reasonCode:"AIDT_COURSE_GROUP_CONFLICT"});expect(f.links.get("group-a")).toBe(first.id);});
 it("re-enters only current member groups; two groups and courses isolate",async()=>{const f=fixture(),a=(await f.service.create(manager,input())).course,b=(await f.service.create(manager,input())).course;await f.service.link(manager,a.id,"group-a");await f.service.link({...manager,userId:"teacher"},b.id,"group-b");expect((await f.service.list(student,{limit:20})).items.map(c=>c.id)).toEqual([a.id]);expect((await f.service.groups(student,a.id,{limit:20})).items[0]!.members.map(m=>m.userId)).toContain("student-a");await expect(f.service.groups(student,b.id,{limit:20})).rejects.toMatchObject({reasonCode:"AIDT_COURSE_NOT_FOUND"});expect((await f.service.groups(manager,b.id,{limit:20})).items).toEqual([]);});
 it("revocation applies again to replay, metadata and group directory",async()=>{const f=fixture(),{course}=await f.service.create(manager,input());await f.service.link(manager,course.id,"group-a");f.members.get("group-a")!.delete("student-a");expect((await f.service.list(student,{limit:20})).items).toEqual([]);await expect(f.service.groups(student,course.id,{limit:20})).rejects.toMatchObject({reasonCode:"AIDT_COURSE_NOT_FOUND"});f.members.get("group-a")!.delete("admin");await expect(f.service.link(manager,course.id,"group-a")).rejects.toMatchObject({reasonCode:"AIDT_COURSE_NOT_FOUND"});});
 it.each([{active:false},{aidt:false},{orgStatus:"disabled"}])("rejects immutable/lifecycle group binding %o",async state=>{const f=fixture(),{course}=await f.service.create(manager,input());f.setState(state);await expect(f.service.link(manager,course.id,"group-a")).rejects.toMatchObject({reasonCode:"AIDT_COURSE_FORBIDDEN"});expect(f.links.size).toBe(0);});
 it("keeps already-linked archived groups visible and read only",async()=>{const f=fixture(),{course}=await f.service.create(manager,input());await f.service.link(manager,course.id,"group-a");f.setState({active:false});expect((await f.service.groups(student,course.id,{limit:20})).items[0]!.project.readOnlyReason).toBe("archived");});
 it("denies other tenants and revoked org members before data",async()=>{const f=fixture();await f.service.create(manager,input());await expect(f.service.list({...manager,orgId:toOrgId("org-b")},{limit:20})).rejects.toMatchObject({reasonCode:"AIDT_COURSE_NOT_FOUND"});f.setState({orgMember:false});await expect(f.service.list(manager,{limit:20})).rejects.toMatchObject({reasonCode:"AIDT_COURSE_NOT_FOUND"});});
 it("cursor pagination has no overlap and no hidden group count",async()=>{const f=fixture();for(let n=0;n<3;n++)await f.service.create(manager,input());const first=await f.service.list(manager,{limit:2}),last=await f.service.list(manager,{limit:2,cursor:first.nextCursor!});expect(first.items).toHaveLength(2);expect(last.items).toHaveLength(1);expect(last.nextCursor).toBeNull();expect(new Set([...first.items,...last.items].map(c=>c.id)).size).toBe(3);expect(first.items[0]).not.toHaveProperty("groupCount");});
 it("rejects malformed inputs and reports outages explicitly",async()=>{const f=fixture();expect(()=>f.service.create(manager,{...input(),studentIds:["outsider"]})).toThrow("AIDT_COURSE_INVALID");expect(()=>f.service.list(manager,{limit:51})).toThrow("AIDT_COURSE_INVALID");f.setState({fail:true});await expect(f.service.list(manager,{limit:20})).rejects.toMatchObject({reasonCode:"AIDT_COURSE_UNAVAILABLE"});});
 it("contract has no enrollment, invitation or permission-writing operation",()=>{expect(Object.keys(operations)).toEqual(["list","create","groups","link"]);expect(Course.safeParse({id:"x",name:" ",createdAt:new Date().toISOString()}).success).toBe(false);});
});

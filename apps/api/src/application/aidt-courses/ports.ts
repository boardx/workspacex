import type { CourseValue, CourseGroupValue, CoursePage } from "@repo/contracts/aidt-courses";
import type { OrgId } from "../../domain/org-id";
import type { IdentityRepository } from "../identity/ports";
import type { Guarded } from "../security/permission-filter";
export type CourseActor={orgId:OrgId;userId:string};
export interface CourseTransaction {
 identity:IdentityRepository;
 orgStatus:string|null;
 list(manager:boolean,page:CoursePage):Promise<CourseValue[]>;
 find(courseId:string):Promise<CourseValue|null>;
 isMember(courseId:string):Promise<boolean>;
 create(name:string,operationId:string):Promise<{course:CourseValue;created:boolean}>;
 groups(courseId:string,page:CoursePage):Promise<readonly {id:string;value:Guarded<CourseGroupValue>}[]>;
 lockGroup(projectId:string):Promise<{active:boolean;aidt:boolean}|null>;
 link(courseId:string,projectId:string):Promise<{courseId:string;replayed:boolean}>;
}
export interface AidtCourseRepository { inOrg<T>(actor:CourseActor,fn:(tx:CourseTransaction)=>Promise<T>):Promise<T> }

import { Body, Controller, Get, Post, Put, Inject, Param, Query, HttpException } from "@nestjs/common";
import { operations as C } from "@repo/contracts/aidt-courses";
import { AIDT_COURSES_SERVICE, AidtCoursesService, AidtCourseError } from "../../application/aidt-courses/service";
import { assertPrincipal,type Principal } from "../../domain/principal";
import { CurrentPrincipal } from "../current-principal.decorator";
function parse<T>(schema:{safeParse(v:unknown):{success:true;data:T}|{success:false}},input:unknown):T{const value=schema.safeParse(input);if(!value.success)throw new HttpException({reasonCode:"AIDT_COURSE_INVALID"},400);return value.data;}
async function respond<T>(fn:()=>Promise<T>){try{return await fn();}catch(error){const code=error instanceof AidtCourseError?error.reasonCode:"AIDT_COURSE_UNAVAILABLE";throw new HttpException({reasonCode:code},code.endsWith("NOT_FOUND")?404:code.endsWith("FORBIDDEN")?403:code.endsWith("CONFLICT")?409:code.endsWith("INVALID")?400:503);}}
const page=(cursor?:string,limit?:string)=>({cursor,limit:limit===undefined?undefined:Number(limit)});
@Controller()
export class AidtCoursesController {
 constructor(@Inject(AIDT_COURSES_SERVICE) private readonly service:AidtCoursesService){}
 @Get(C.list.path) list(@CurrentPrincipal() actor:Principal,@Query("cursor") cursor?:string,@Query("limit") limit?:string){assertPrincipal(actor);const input=parse(C.list.in,page(cursor,limit));return respond(async()=>C.list.out.parse(await this.service.list(actor,input)));}
 @Post(C.create.path) create(@CurrentPrincipal() actor:Principal,@Body() raw:unknown){assertPrincipal(actor);const input=parse(C.create.in,raw);return respond(async()=>C.create.out.parse(await this.service.create(actor,input)));}
 @Get(C.groups.path) groups(@CurrentPrincipal() actor:Principal,@Param("courseId") courseId:string,@Query("cursor") cursor?:string,@Query("limit") limit?:string){assertPrincipal(actor);const input=parse(C.groups.in,{...page(cursor,limit),courseId});return respond(async()=>C.groups.out.parse(await this.service.groups(actor,courseId,input)));}
 @Put(C.link.path) link(@CurrentPrincipal() actor:Principal,@Param("courseId") courseId:string,@Param("projectId") projectId:string,@Body() raw:unknown){assertPrincipal(actor);if(raw!==undefined&&(raw===null||typeof raw!=="object"||Array.isArray(raw)||Object.keys(raw).length!==0))throw new HttpException({reasonCode:"AIDT_COURSE_INVALID"},400);parse(C.link.in,{courseId,projectId});return respond(async()=>C.link.out.parse(await this.service.link(actor,courseId,projectId)));}
}

import "reflect-metadata";
import { HttpException } from "@nestjs/common";
import { expect, it, vi } from "vitest";
import { AidtCoursesController } from "../../src/interface/controllers/aidt-courses.controller";
import { AidtCourseError, type AidtCoursesService } from "../../src/application/aidt-courses/service";
import { toOrgId } from "../../src/domain/org-id";
const actor={orgId:toOrgId("org"),userId:"admin"};
function fixture(){const service={list:vi.fn(),create:vi.fn(),groups:vi.fn(),link:vi.fn()};return {service,controller:new AidtCoursesController(service as unknown as AidtCoursesService)};}
it.each([["AIDT_COURSE_NOT_FOUND",404],["AIDT_COURSE_FORBIDDEN",403],["AIDT_COURSE_GROUP_CONFLICT",409],["AIDT_COURSE_OPERATION_CONFLICT",409],["AIDT_COURSE_INVALID",400],["AIDT_COURSE_UNAVAILABLE",503]] as const)("maps %s without leaking errors",async(code,status)=>{const f=fixture();f.service.list.mockRejectedValue(new AidtCourseError(code));try{await f.controller.list(actor);throw new Error("expected failure");}catch(error){expect(error).toBeInstanceOf(HttpException);expect((error as HttpException).getStatus()).toBe(status);expect((error as HttpException).getResponse()).toEqual({reasonCode:code});}});
it("does not disclose dependency exceptions",async()=>{const f=fixture();f.service.list.mockRejectedValue(new Error("private connection string"));await expect(f.controller.list(actor)).rejects.toMatchObject({response:{reasonCode:"AIDT_COURSE_UNAVAILABLE"}});});
it.each([null,[],"x",{userId:"other"},{grant:true}])("requires a strictly empty link body %j",raw=>{const f=fixture();expect(()=>f.controller.link(actor,"c","p",raw)).toThrow(HttpException);expect(f.service.link).not.toHaveBeenCalled();});
it("accepts an empty or omitted body without adding any enrollment fields",async()=>{const f=fixture();f.service.link.mockResolvedValue({courseId:"c",projectId:"p",replayed:false});expect(await f.controller.link(actor,"c","p",{})).toEqual({courseId:"c",projectId:"p",replayed:false});expect(await f.controller.link(actor,"c","p",undefined)).toEqual({courseId:"c",projectId:"p",replayed:false});});
it("validates pagination and course body before service",()=>{const f=fixture();expect(()=>f.controller.list(actor,undefined,"51")).toThrow(HttpException);expect(()=>f.controller.create(actor,{name:"课",operationId:"invalid"})).toThrow(HttpException);expect(f.service.list).not.toHaveBeenCalled();expect(f.service.create).not.toHaveBeenCalled();});

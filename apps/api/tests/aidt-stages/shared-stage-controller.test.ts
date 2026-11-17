import "reflect-metadata";
import { describe, expect, it } from "vitest";
import { HttpException } from "@nestjs/common";
import { AidtStagesController } from "../../src/interface/controllers/aidt-stages.controller";
import { AidtStagesService } from "../../src/application/aidt-stages/service";
import { AidtStageError } from "../../src/domain/aidt-stages/errors";
import { toOrgId } from "../../src/domain/org-id";
const principal={userId:"student",orgId:toOrgId("org-a")};
function controller(error:unknown) {return new AidtStagesController({get:async()=>{throw error;},save:async()=>{throw error;}} as unknown as AidtStagesService);}
describe("AIDT stage protocol boundary",()=>{
  it.each([ ["AIDT_STAGE_NOT_FOUND",404],["AIDT_STAGE_READONLY",403],["AIDT_STAGE_REVISION_CONFLICT",409],["AIDT_STAGE_OPERATION_CONFLICT",409],["AIDT_STAGE_INVALID",422],["AIDT_STAGE_TOO_LARGE",413],["AIDT_STAGE_UNAVAILABLE",503] ] as const)("maps %s to %i",async(code,status)=>{try{await controller(new AidtStageError(code)).get(principal,"p","1");throw new Error("must reject");}catch(e){expect(e).toBeInstanceOf(HttpException);expect((e as HttpException).getStatus()).toBe(status);expect((e as HttpException).getResponse()).toEqual({reasonCode:code});}});
  it("does not expose dependency failure details",async()=>{await expect(controller(new Error("password=secret")).get(principal,"p","1")).rejects.toMatchObject({response:{reasonCode:"AIDT_STAGE_UNAVAILABLE"}});});
  it("rejects stage outside 1..6 before calling storage",()=>{expect(()=>controller(null).get(principal,"p","7")).toThrow(HttpException);});
  it("unknown confirmation metadata cannot enter shared working draft",()=>{expect(()=>controller(null).save(principal,"p","1",{confirmed:true})).toThrow(HttpException);});
});

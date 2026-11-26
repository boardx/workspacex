import { Body, Controller, Get, Post, Put, Inject, Optional, Param, Query, HttpException } from "@nestjs/common";
import { AIDT_TIMER_PATH, AidtTimerRequest, AidtTimerLocation, operations as C, isStageRequestTooLarge } from "@repo/contracts/aidt-stages";
import { aidtEntityThreadId } from "../../application/aidt-stages/entity-thread";
import { AIDT_RUN_CONTEXT_EXECUTION, type AidtRunContextExecutionPort } from "../../application/aidt-run-context/ports";
import { AIDT_STAGES_SERVICE, AidtStagesService } from "../../application/aidt-stages/service";
import { AidtStageError } from "../../domain/aidt-stages/errors";
import { assertPrincipal, type Principal } from "../../domain/principal";
import { CurrentPrincipal } from "../current-principal.decorator";
function status(code:string):number {if(code==="AIDT_STAGE_TOO_LARGE")return 413;if(code==="AIDT_STAGE_NOT_FOUND")return 404;if(code==="AIDT_STAGE_READONLY")return 403;if(code.endsWith("CONFLICT"))return 409;if(code==="AIDT_STAGE_INVALID")return 422;return 503;}
async function respond<T>(fn:()=>Promise<T>):Promise<T> {try{return await fn();}catch(e){if(e instanceof AidtStageError)throw new HttpException({reasonCode:e.reasonCode,...(e.current!==undefined?{current:e.current}:{})},status(e.reasonCode));throw new HttpException({reasonCode:"AIDT_STAGE_UNAVAILABLE"},503);}}
function parse<T>(schema:{safeParse(v:unknown):{success:true;data:T}|{success:false}},v:unknown):T {if(isStageRequestTooLarge(v))throw new HttpException({reasonCode:"AIDT_STAGE_TOO_LARGE"},413);const p=schema.safeParse(v);if(!p.success)throw new HttpException({reasonCode:"AIDT_STAGE_INVALID"},422);return p.data;}
@Controller()
export class AidtStagesController {
  constructor(@Inject(AIDT_STAGES_SERVICE) private readonly service:AidtStagesService,
    @Optional() @Inject(AIDT_RUN_CONTEXT_EXECUTION) private readonly projection?:AidtRunContextExecutionPort) {}
  @Get(AIDT_TIMER_PATH)
  readCardTimer(@CurrentPrincipal() principal: Principal, @Param() params: Record<string, string>) {
    assertPrincipal(principal);
    const input = parse(AidtTimerLocation, { ...params, stageId: Number(params.stageId) });
    return respond(() => this.service.cardTimer({ ...principal, projectId: input.projectId }, input.stageId, input.entityId));
  }
  @Post(AIDT_TIMER_PATH)
  updateCardTimer(@CurrentPrincipal() principal: Principal, @Param() params: Record<string, string>, @Body() body: unknown) {
    assertPrincipal(principal);
    const input = parse(AidtTimerLocation, { ...params, stageId: Number(params.stageId) });
    const command = parse(AidtTimerRequest, body);
    return respond(() => this.service.cardTimer({ ...principal, projectId: input.projectId }, input.stageId, input.entityId, command));
  }
  @Post(C.reconcileEntity.path)
  reconcile(@CurrentPrincipal() principal:Principal,@Param("projectId") projectId:string,@Param("stageId") rawStage:string,@Param("entityId") entityId:string) {
    assertPrincipal(principal);
    const input=parse(C.reconcileEntity.in,{projectId,stageId:Number(rawStage),entityId});
    const actor={...principal,projectId};
    return respond(async()=>{
      if (!this.projection?.reconcileEntity) throw new AidtStageError("AIDT_STAGE_UNAVAILABLE");
      const threadId=aidtEntityThreadId(actor,input.stageId,entityId,"stage");
      return {updated:await this.projection.reconcileEntity({...actor,threadId},input.stageId,entityId)};
    });
  }
  @Put(C.entityThread.path)
  entityThread(@CurrentPrincipal() principal: Principal, @Param("projectId") projectId: string,
    @Param("stageId") stageId: string, @Param("entityId") entityId: string, @Body() body: unknown) {
    assertPrincipal(principal);
    const purpose = typeof body === "object" && body !== null && "purpose" in body ? body.purpose : undefined;
    const input = parse(C.entityThread.in, { projectId, stageId: Number(stageId), entityId, purpose });
    return respond(() => this.service.entityThread({ ...principal, projectId }, input));
  }
  @Get(C.revision.path)
  revision(@CurrentPrincipal() principal: Principal, @Param("projectId") projectId: string,
    @Param("stageId") stageId: string, @Param("revision") revision: string) {
    assertPrincipal(principal);
    const input = parse(C.revision.in, { projectId, stageId: Number(stageId), revision: Number(revision) });
    return respond(() => this.service.getRevision({ ...principal, projectId }, input.stageId, input.revision));
  }
  @Get(C.list.path) list(@CurrentPrincipal() p:Principal,@Param("projectId") projectId:string) {assertPrincipal(p);parse(C.list.in,{projectId});return respond(()=>this.service.list({...p,projectId}));}
  @Get(C.history.path) history(@CurrentPrincipal() p:Principal,@Param("projectId") projectId:string,@Param("stageId") rawStage:string,@Query("beforeRevision") before?:string,@Query("limit") limit?:string) {assertPrincipal(p);const v=parse(C.history.in,{projectId,stageId:Number(rawStage),beforeRevision:before===undefined?undefined:Number(before),limit:limit===undefined?undefined:Number(limit)});return respond(()=>this.service.history({...p,projectId},v.stageId,v.beforeRevision,v.limit));}
  @Get(C.get.path) get(@CurrentPrincipal() p:Principal,@Param("projectId") projectId:string,@Param("stageId") rawStage:string) {assertPrincipal(p);const v=parse(C.get.in,{projectId,stageId:Number(rawStage)});return respond(()=>this.service.get({...p,projectId},v.stageId));}
  @Put(C.save.path) save(@CurrentPrincipal() p:Principal,@Param("projectId") projectId:string,@Param("stageId") rawStage:string,@Body() raw:unknown) {assertPrincipal(p);const v=parse(C.save.in,{...(typeof raw==="object"&&raw!==null?raw:{}),projectId,stageId:Number(rawStage)});return respond(()=>this.service.save({...p,projectId},v));}
}

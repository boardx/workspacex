import {timingSafeEqual} from "node:crypto";
import {Body,Controller,Headers,HttpCode,Inject,Param,Post,UnauthorizedException,BadRequestException,ForbiddenException} from "@nestjs/common";
import {RuntimeModelRequestStart,RuntimeModelRequestTerminal} from "@repo/contracts/runtime-model-usage";
import {RUNTIME_MODEL_USAGE,RuntimeUsageOwnershipDenied} from "../../application/agent-run/runtime-model-usage";
import type {RuntimeModelUsagePort} from "../../application/agent-run/runtime-model-usage";
import {toOrgId} from "../../domain/org-id";
import {Public} from "../public.decorator";
@Controller()
export class RuntimeModelUsageController {
 constructor(@Inject(RUNTIME_MODEL_USAGE) private readonly usage:RuntimeModelUsagePort){}
 private authenticate(key:string|undefined){
  const expected=Buffer.from((process.env.DEEP_AGENT_SERVICE_INTERNAL_KEY??"").trim()),actual=Buffer.from(key??"");
  if(!expected.length||expected.length!==actual.length||!timingSafeEqual(expected,actual))throw new UnauthorizedException();
 }
 @Public() @Post("/internal/agent-runs/:runId/model-requests/start") @HttpCode(200)
 async start(@Headers("x-deep-agent-internal-key") key:string|undefined,@Param("runId") runId:string,@Body() body:unknown){
  this.authenticate(key);const parsed=RuntimeModelRequestStart.safeParse(body);if(!parsed.success)throw new BadRequestException("invalid_usage_receipt");
  const {orgId,...input}=parsed.data;
  try{await this.usage.startRuntimeRequest(toOrgId(orgId),runId,input);}catch(error){if(error instanceof RuntimeUsageOwnershipDenied)throw new ForbiddenException("usage_ownership_denied");throw error;}
  return {accepted:true};
 }
 @Public() @Post("/internal/agent-runs/:runId/model-requests/terminal") @HttpCode(200)
 async terminal(@Headers("x-deep-agent-internal-key") key:string|undefined,@Param("runId") runId:string,@Body() body:unknown){
  this.authenticate(key);const parsed=RuntimeModelRequestTerminal.safeParse(body);if(!parsed.success)throw new BadRequestException("invalid_usage_receipt");
  const {orgId,...input}=parsed.data;
  try{await this.usage.terminalRuntimeRequest(toOrgId(orgId),runId,input);}catch(error){if(error instanceof RuntimeUsageOwnershipDenied)throw new ForbiddenException("usage_ownership_denied");throw error;}
  return {accepted:true};
 }
}

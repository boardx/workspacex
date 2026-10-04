import { Controller,Get,Inject,Param,Query,ForbiddenException } from "@nestjs/common";
import type { z } from "zod";
import { aiUsage as C } from "@repo/contracts";
import { AI_USAGE_REPOSITORY,AiUsageScopeError,scopeAiUsage,type AiUsageRepository } from "../../application/auth/ai-usage-ports";
import { IDENTITY_REPOSITORY,type IdentityRepository } from "../../application/identity/ports";
import { assertPrincipal,type Principal } from "../../domain/principal";
import { toOrgId } from "../../domain/org-id";
import { CurrentPrincipal } from "../current-principal.decorator";
import { ZodBodyPipe } from "../pipes/zod-body.pipe";
@Controller()
export class AiUsageController {
 constructor(@Inject(AI_USAGE_REPOSITORY) private readonly usage:AiUsageRepository,@Inject(IDENTITY_REPOSITORY) private readonly identity:IdentityRepository){}
 private async scoped(principal:Principal,orgId:string,input:z.infer<typeof C.Query>){
  assertPrincipal(principal);
  try{return await scopeAiUsage(this.identity,principal,toOrgId(orgId),C.Query.parse(input));}
  catch(e){if(e instanceof AiUsageScopeError) throw new ForbiddenException({reasonCode:e.reasonCode});throw e;}
 }
 @Get(C.operations.summary.path)
 async summary(@Param("orgId") orgId:string,@Query(new ZodBodyPipe(C.Query)) input:z.infer<typeof C.Query>,@CurrentPrincipal() principal:Principal){
  const scoped=await this.scoped(principal,orgId,input);return this.usage.summary(toOrgId(orgId),scoped);
 }
 @Get(C.operations.calls.path)
 async calls(@Param("orgId") orgId:string,@Query(new ZodBodyPipe(C.Query)) input:z.infer<typeof C.Query>,@CurrentPrincipal() principal:Principal){
  const scoped=await this.scoped(principal,orgId,input);return this.usage.calls(toOrgId(orgId),scoped);
 }
}

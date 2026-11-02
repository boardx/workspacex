import {EnterpriseHttpException,ENTERPRISE_CACHE_CONTROL} from "./enterprise-http-exception";
import {Body,Controller,Get,Header,Inject,Param,Post,UseGuards} from "@nestjs/common";
import {operations as C,EnterpriseCreditGrantRequest,EnterpriseCreditGrantResult,EnterpriseUpgradeRequest,EnterpriseUpgradeOperation} from "@repo/contracts/billing-team";
import {ENTERPRISE_MANAGEMENT,EnterpriseError,type EnterpriseManagement} from "../../application/billing/enterprise-ports";
import {PlatformOperatorGuard} from "../guards/platform-operator.guard";
import {CurrentPrincipal} from "../current-principal.decorator";
import {assertPrincipal,type Principal} from "../../domain/principal";
import {toOrgId} from "../../domain/org-id";
import {ZodBodyPipe} from "../pipes/zod-body.pipe";
@UseGuards(PlatformOperatorGuard)
@Controller()
export class EnterpriseManagementController {
 constructor(@Inject(ENTERPRISE_MANAGEMENT)private readonly management:EnterpriseManagement){}
 private async execute<T>(fn:()=>Promise<T>){try{return await fn();}catch(error){
  if(error instanceof EnterpriseError)throw new EnterpriseHttpException(error.code,error.code==="dependency_unavailable"?503:error.code==="ORGANIZATION_NOT_FOUND"||error.code==="order_not_found"?404:409);
  throw error;
 }}
 @Header("Cache-Control",ENTERPRISE_CACHE_CONTROL)
 @Post(C.grantEnterpriseCredits.path)
 grant(@Param("orgId")orgId:string,@Body(new ZodBodyPipe(EnterpriseCreditGrantRequest))input:EnterpriseCreditGrantRequest,@CurrentPrincipal()principal:Principal){
  assertPrincipal(principal);return this.execute(async()=>EnterpriseCreditGrantResult.parse(await this.management.grant(toOrgId(orgId),principal.userId,input)));
 }
 @Header("Cache-Control",ENTERPRISE_CACHE_CONTROL)
 @Post(C.createEnterpriseUpgrade.path)
 upgrade(@Param("orgId")orgId:string,@Body(new ZodBodyPipe(EnterpriseUpgradeRequest))input:EnterpriseUpgradeRequest,@CurrentPrincipal()principal:Principal){
  assertPrincipal(principal);return this.execute(async()=>EnterpriseUpgradeOperation.parse(await this.management.upgrade(toOrgId(orgId),principal.userId,input)));
 }
 @Header("Cache-Control",ENTERPRISE_CACHE_CONTROL)
 @Get(C.getEnterpriseUpgradeOperation.path)
 operation(@Param("orgId")orgId:string,@Param("operationRef")ref:string,@CurrentPrincipal()principal:Principal){
  assertPrincipal(principal);const input=C.getEnterpriseUpgradeOperation.in.parse({orgId,operationRef:ref});return this.execute(async()=>EnterpriseUpgradeOperation.parse(await this.management.operation(toOrgId(input.orgId),input.operationRef)));
 }
}

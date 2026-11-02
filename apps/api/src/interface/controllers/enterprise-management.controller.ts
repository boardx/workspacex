import {EnterpriseHttpException} from "./enterprise-http-exception";
import {Body,Controller,Get,Inject,Param,Post,UseGuards} from "@nestjs/common";
import {EnterpriseCreditGrantRequest,EnterpriseCreditGrantResult,EnterpriseUpgradeRequest,EnterpriseUpgradeOperation} from "@repo/contracts/billing-team";
import {ENTERPRISE_MANAGEMENT,EnterpriseError,type EnterpriseManagement} from "../../application/billing/enterprise-ports";
import {PlatformOperatorGuard} from "../guards/platform-operator.guard";
import {CurrentPrincipal} from "../current-principal.decorator";
import {assertPrincipal,type Principal} from "../../domain/principal";
import {toOrgId} from "../../domain/org-id";
import {ZodBodyPipe} from "../pipes/zod-body.pipe";
@UseGuards(PlatformOperatorGuard)
@Controller("platform/organizations/:orgId/billing")
export class EnterpriseManagementController {
 constructor(@Inject(ENTERPRISE_MANAGEMENT)private readonly management:EnterpriseManagement){}
 private async execute<T>(fn:()=>Promise<T>){try{return await fn();}catch(error){
  if(error instanceof EnterpriseError)throw new EnterpriseHttpException(error.code,error.code==="dependency_unavailable"?503:error.code==="ORGANIZATION_NOT_FOUND"||error.code==="order_not_found"?404:409);
  throw error;
 }}
 @Post("credit-grants")
 grant(@Param("orgId")orgId:string,@Body(new ZodBodyPipe(EnterpriseCreditGrantRequest))input:EnterpriseCreditGrantRequest,@CurrentPrincipal()principal:Principal){
  assertPrincipal(principal);return this.execute(async()=>EnterpriseCreditGrantResult.parse(await this.management.grant(toOrgId(orgId),principal.userId,input)));
 }
 @Post("enterprise-upgrades")
 upgrade(@Param("orgId")orgId:string,@Body(new ZodBodyPipe(EnterpriseUpgradeRequest))input:EnterpriseUpgradeRequest,@CurrentPrincipal()principal:Principal){
  assertPrincipal(principal);return this.execute(async()=>EnterpriseUpgradeOperation.parse(await this.management.upgrade(toOrgId(orgId),principal.userId,input)));
 }
 @Get("operations/:operationRef")
 operation(@Param("orgId")orgId:string,@Param("operationRef")ref:string,@CurrentPrincipal()principal:Principal){
  assertPrincipal(principal);return this.execute(async()=>EnterpriseUpgradeOperation.parse(await this.management.operation(toOrgId(orgId),ref)));
 }
}

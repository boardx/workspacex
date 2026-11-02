import {TeamBillingError} from "../../application/billing/team-billing-error";
import {Body,Controller,Get,Post,Param,Header,Inject} from "@nestjs/common";
import {operations} from "@repo/contracts/billing-team";
import type {Principal} from "../../domain/principal";
import {CurrentPrincipal} from "../current-principal.decorator";
import {ZodBodyPipe} from "../pipes/zod-body.pipe";
import {TeamBillingHttpException} from "./team-billing-http-exception";
import {TeamAccountService} from "../../application/billing/team-account-service";
@Controller()
export class TeamBillingController{
 constructor(@Inject(TeamAccountService)private readonly service:TeamAccountService){}
 @Get(operations.getTeamCatalog.path) @Header("Cache-Control","private, no-store")
 catalog(@CurrentPrincipal()p:Principal,@Param("orgId")org:string){return this.call(()=>this.service.catalog(p,org));}
 @Get(operations.getTeamEntitlement.path) @Header("Cache-Control","private, no-store")
 entitlement(@CurrentPrincipal()p:Principal,@Param("orgId")org:string){return this.call(()=>this.service.entitlement(p,org));}
 @Post(operations.createTeamQuote.path) @Header("Cache-Control","private, no-store")
 quote(@CurrentPrincipal()p:Principal,@Param("orgId")org:string,@Body(new ZodBodyPipe(operations.createTeamQuote.in))input:unknown){return this.call(()=>this.service.quote(p,org,input));}
 @Post(operations.createTeamCheckout.path) @Header("Cache-Control","private, no-store")
 checkout(@CurrentPrincipal()p:Principal,@Param("orgId")org:string,@Body(new ZodBodyPipe(operations.createTeamCheckout.in))input:unknown){return this.call(()=>this.service.checkout(p,org,input));}
 @Get(operations.getTeamPurchase.path) @Header("Cache-Control","private, no-store")
 purchase(@CurrentPrincipal()p:Principal,@Param("orgId")org:string,@Param("purchaseRef")ref:string){return this.call(()=>this.service.purchase(p,org,ref));}
 private async call<T>(fn:()=>Promise<T>){try{return await fn();}catch(e){
  if(!(e instanceof TeamBillingError))throw e;
  const code=e.code;
  throw new TeamBillingHttpException(code,code==="forbidden"?403:code==="order_not_found"?404:code==="dependency_unavailable"||code==="payment_provider_not_configured"?503:409);
 }}
}

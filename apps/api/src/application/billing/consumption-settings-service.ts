import type {z} from "zod";
import {CreditConsumptionSettings} from "@repo/contracts/billing-consumption";
import {assertPrincipal,type Principal} from "../../domain/principal";
import type {OrgId} from "../../domain/org-id";
export type ConsumptionSettings=z.infer<typeof CreditConsumptionSettings>;
export interface ConsumptionSettingsRepository {
 read(orgId:OrgId):Promise<ConsumptionSettings>;
 update(orgId:OrgId,userId:string,input:ConsumptionSettings):Promise<ConsumptionSettings>;
}
export class ConsumptionSettingsForbidden extends Error {}
export class ConsumptionSettingsService {
 constructor(private readonly store:ConsumptionSettingsRepository,private readonly isOperator:(userId:string)=>Promise<boolean>){}
 async read(principal:Principal,platform=false){
  assertPrincipal(principal);
  if(platform&&!await this.isOperator(principal.userId))throw new ConsumptionSettingsForbidden();
  return CreditConsumptionSettings.parse(await this.store.read(principal.orgId));
 }
 async update(principal:Principal,input:ConsumptionSettings){
  assertPrincipal(principal);
  if(!await this.isOperator(principal.userId))throw new ConsumptionSettingsForbidden();
  return CreditConsumptionSettings.parse(await this.store.update(principal.orgId,principal.userId,CreditConsumptionSettings.parse(input)));
 }
}

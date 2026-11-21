import type {z} from "zod";
import {CreditConsumptionSettings,CreditConsumptionSettingsPatch,PlatformCreditConsumptionSettings} from "@repo/contracts/billing-consumption";
import {assertPrincipal,type Principal} from "../../domain/principal";
import type {OrgId} from "../../domain/org-id";
export type ConsumptionSettings=z.infer<typeof CreditConsumptionSettings>;
export type PlatformConsumptionSettings=z.infer<typeof PlatformCreditConsumptionSettings>;
export type ConsumptionSettingsPatch=z.infer<typeof CreditConsumptionSettingsPatch>;
export interface ConsumptionSettingsRepository {
 read(orgId:OrgId):Promise<PlatformConsumptionSettings>;
 update(orgId:OrgId,userId:string,input:ConsumptionSettingsPatch):Promise<PlatformConsumptionSettings>;
}
export class ConsumptionSettingsForbidden extends Error {}
export class ConsumptionSettingsService {
 constructor(private readonly store:ConsumptionSettingsRepository,private readonly isOperator:(userId:string)=>Promise<boolean>){}
 async read(principal:Principal,platform=false){
  assertPrincipal(principal);
  if(platform&&!await this.isOperator(principal.userId))throw new ConsumptionSettingsForbidden();
  const value = await this.store.read(principal.orgId);
  return platform ? PlatformCreditConsumptionSettings.parse(value) : CreditConsumptionSettings.parse({ creditPreflightEnabled: value.creditPreflightEnabled, admissionPolicy: value.admissionPolicy });
 }
 async update(principal:Principal,input:ConsumptionSettingsPatch){
  assertPrincipal(principal);
  if(!await this.isOperator(principal.userId))throw new ConsumptionSettingsForbidden();
  return PlatformCreditConsumptionSettings.parse(await this.store.update(principal.orgId,principal.userId,CreditConsumptionSettingsPatch.parse(input)));
 }
}

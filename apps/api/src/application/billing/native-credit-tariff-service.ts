import type {z} from "zod";
import {NativeCreditTariff} from "@repo/contracts/billing-consumption";
import {assertPrincipal,type Principal} from "../../domain/principal";
import {ConsumptionSettingsForbidden} from "./consumption-settings-service";
export type NativeTariff=z.infer<typeof NativeCreditTariff>;
export interface NativeCreditTariffRepository {
 list(orgId:string):Promise<NativeTariff[]>;
 upsert(actorId:string,input:NativeTariff):Promise<NativeTariff>;
}
export class NativeCreditTariffService {
 constructor(private readonly store:NativeCreditTariffRepository,private readonly isOperator:(userId:string)=>Promise<boolean>){}
 async list(principal:Principal,orgId:string){assertPrincipal(principal);if(!await this.isOperator(principal.userId))throw new ConsumptionSettingsForbidden();return {items:await this.store.list(orgId)};}
 async upsert(principal:Principal,input:NativeTariff){assertPrincipal(principal);if(!await this.isOperator(principal.userId))throw new ConsumptionSettingsForbidden();return this.store.upsert(principal.userId,NativeCreditTariff.parse(input));}
}

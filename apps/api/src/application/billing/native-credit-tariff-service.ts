import type {PricingCatalog} from "@repo/contracts/billing-pricing";
import {imageFixedCnyPrice} from "../../domain/agent-run/image-activation-pricing";
import type {z} from "zod";
import {NativeCreditTariff} from "@repo/contracts/billing-consumption";
import {assertPrincipal,type Principal} from "../../domain/principal";
import {ConsumptionSettingsForbidden} from "./consumption-settings-service";
export type NativeTariff=z.infer<typeof NativeCreditTariff>;
export interface NativeCreditTariffRepository {
 readCnyCatalog?(orgId:string):Promise<PricingCatalog>;
 list(orgId:string):Promise<NativeTariff[]>;
 upsert(actorId:string,input:NativeTariff):Promise<NativeTariff>;
}
export class ImagePricingBasisUnavailable extends Error {
 constructor(readonly code:'image_cny_quote_unconfigured'|'image_cny_quote_ambiguous'='image_cny_quote_unconfigured'){super(code);}
}
export class NativeCreditTariffService {
 constructor(private readonly store:NativeCreditTariffRepository,private readonly isOperator:(userId:string)=>Promise<boolean>){}
 async imagePricingBasis(principal:Principal,orgId:string){
  assertPrincipal(principal);if(!await this.isOperator(principal.userId))throw new ConsumptionSettingsForbidden();
  try{
   if(!this.store.readCnyCatalog)throw new ImagePricingBasisUnavailable();
   const catalog=await this.store.readCnyCatalog(orgId);imageFixedCnyPrice(1n,catalog);return catalog;
  }catch(error){throw new ImagePricingBasisUnavailable(error instanceof Error&&error.message==='IMAGE_MINIMUM_CNY_CREDIT_QUOTE_AMBIGUOUS'?'image_cny_quote_ambiguous':'image_cny_quote_unconfigured');}
 }
 async list(principal:Principal,orgId:string){assertPrincipal(principal);if(!await this.isOperator(principal.userId))throw new ConsumptionSettingsForbidden();return {items:await this.store.list(orgId)};}
 async upsert(principal:Principal,input:NativeTariff){assertPrincipal(principal);if(!await this.isOperator(principal.userId))throw new ConsumptionSettingsForbidden();return this.store.upsert(principal.userId,NativeCreditTariff.parse(input));}
}

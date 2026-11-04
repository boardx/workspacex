import {Body,Controller,ForbiddenException,Get,Inject,Put,Query,ServiceUnavailableException,Header} from "@nestjs/common";
import {nativeTariffOperations as C} from "@repo/contracts/billing-consumption";
import type {z} from "zod";
import {NativeCreditTariffService,ImagePricingBasisUnavailable} from "../../application/billing/native-credit-tariff-service";
import {ConsumptionSettingsForbidden} from "../../application/billing/consumption-settings-service";
import type {Principal} from "../../domain/principal";
import {CurrentPrincipal} from "../current-principal.decorator";
import {ZodBodyPipe} from "../pipes/zod-body.pipe";
@Controller()
export class NativeCreditTariffController {
 constructor(@Inject(NativeCreditTariffService) private readonly service:NativeCreditTariffService){}
 private async mapped<T>(call:()=>Promise<T>){try{return await call();}catch(error){if(error instanceof ImagePricingBasisUnavailable)throw new ServiceUnavailableException(error.code);if(error instanceof ConsumptionSettingsForbidden)throw new ForbiddenException();throw error;}}
 @Header("Cache-Control","private, no-store")
 @Get(C.getImagePricingBasis.path)
 imagePricingBasis(@CurrentPrincipal() p:Principal,@Query(new ZodBodyPipe(C.getImagePricingBasis.in)) q:z.infer<typeof C.getImagePricingBasis.in>){return this.mapped(()=>this.service.imagePricingBasis(p,q.orgId));}
 @Get(C.listNativeTariffs.path)
 list(@CurrentPrincipal() p:Principal,@Query(new ZodBodyPipe(C.listNativeTariffs.in)) q:z.infer<typeof C.listNativeTariffs.in>){return this.mapped(()=>this.service.list(p,q.orgId));}
 @Put(C.upsertNativeTariff.path)
 upsert(@CurrentPrincipal() p:Principal,@Body(new ZodBodyPipe(C.upsertNativeTariff.in)) body:z.infer<typeof C.upsertNativeTariff.in>){return this.mapped(()=>this.service.upsert(p,body));}
}

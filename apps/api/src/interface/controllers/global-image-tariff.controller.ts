import {Body,Controller,ForbiddenException,ConflictException,Get,Inject,Put,ServiceUnavailableException,Header} from '@nestjs/common';
import {globalImageTariffOperations as C} from '@repo/contracts/billing-consumption';
import type {z} from 'zod';
import {GlobalImageTariffService,GlobalImageTariffConflict,GlobalImageTariffWriterUnavailable} from '../../application/billing/global-image-tariff-service';
import {ImagePricingBasisUnavailable} from '../../application/billing/native-credit-tariff-service';
import {ConsumptionSettingsForbidden} from '../../application/billing/consumption-settings-service';
import type {Principal} from '../../domain/principal';
import {CurrentPrincipal} from '../current-principal.decorator';
import {ZodBodyPipe} from '../pipes/zod-body.pipe';
@Controller()
export class GlobalImageTariffController {
 constructor(@Inject(GlobalImageTariffService) private readonly service:GlobalImageTariffService){}
 private async mapped<T>(call:()=>Promise<T>){try{return await call();}catch(error){
  if(error instanceof ConsumptionSettingsForbidden)throw new ForbiddenException();
  if(error instanceof GlobalImageTariffConflict)throw new ConflictException('global_image_tariff_conflict');
  if(error instanceof GlobalImageTariffWriterUnavailable)throw new ServiceUnavailableException('global_image_tariff_writer_unavailable');
  if(error instanceof ImagePricingBasisUnavailable)throw new ServiceUnavailableException(error.code);
  throw error;
 }}
 @Header('Cache-Control','private, no-store')
 @Get(C.list.path)
 list(@CurrentPrincipal() p:Principal){return this.mapped(()=>this.service.list(p));}
 @Put(C.activate.path)
 activate(@CurrentPrincipal() p:Principal,@Body(new ZodBodyPipe(C.activate.in)) body:z.infer<typeof C.activate.in>){return this.mapped(()=>this.service.activate(p,body));}
}

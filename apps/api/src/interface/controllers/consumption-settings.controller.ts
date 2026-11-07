import {Body,Controller,ForbiddenException,Get,Inject,Patch} from "@nestjs/common";
import {operations} from "@repo/contracts/billing-consumption";
import type {z} from "zod";
import {ConsumptionSettingsForbidden,ConsumptionSettingsService} from "../../application/billing/consumption-settings-service";
import type {Principal} from "../../domain/principal";
import {CurrentPrincipal} from "../current-principal.decorator";
import {ZodBodyPipe} from "../pipes/zod-body.pipe";
@Controller()
export class ConsumptionSettingsController {
 constructor(@Inject(ConsumptionSettingsService) private readonly service:ConsumptionSettingsService){}
 private async mapped<T>(call:()=>Promise<T>){try{return await call();}catch(error){if(error instanceof ConsumptionSettingsForbidden)throw new ForbiddenException();throw error;}}
 @Get(operations.getSettings.path)
 read(@CurrentPrincipal() principal:Principal){return this.mapped(()=>this.service.read(principal));}
 @Get(operations.getPlatformSettings.path)
 platformRead(@CurrentPrincipal() principal:Principal){return this.mapped(()=>this.service.read(principal,true));}
 @Patch(operations.updatePlatformSettings.path)
 update(@CurrentPrincipal() principal:Principal,@Body(new ZodBodyPipe(operations.updatePlatformSettings.in)) input:z.infer<typeof operations.updatePlatformSettings.in>){return this.mapped(()=>this.service.update(principal,input));}
}

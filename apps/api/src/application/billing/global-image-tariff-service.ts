import type {z} from 'zod';
import {ActivateGlobalImageTariffs,GlobalImageTariffSchedule} from '@repo/contracts/billing-consumption';
import {assertPrincipal,type Principal} from '../../domain/principal';
import {ConsumptionSettingsForbidden} from './consumption-settings-service';
export class GlobalImageTariffConflict extends Error {}
export class GlobalImageTariffWriterUnavailable extends Error {}
export interface GlobalImageTariffRepository {
 close?():Promise<void>;
 list():Promise<z.infer<typeof GlobalImageTariffSchedule>>;
 activate(actorId:string,input:z.infer<typeof ActivateGlobalImageTariffs>):Promise<z.infer<typeof GlobalImageTariffSchedule>>;
}
export class GlobalImageTariffService {
 constructor(private readonly store:GlobalImageTariffRepository,private readonly isOperator:(userId:string)=>Promise<boolean>){}
 async onModuleDestroy(){await this.store.close?.();}
 private async authorize(p:Principal){assertPrincipal(p);if(!await this.isOperator(p.userId))throw new ConsumptionSettingsForbidden();}
 async list(p:Principal){await this.authorize(p);return GlobalImageTariffSchedule.parse(await this.store.list());}
 async activate(p:Principal,input:z.infer<typeof ActivateGlobalImageTariffs>){await this.authorize(p);return GlobalImageTariffSchedule.parse(await this.store.activate(p.userId,ActivateGlobalImageTariffs.parse(input)));}
}

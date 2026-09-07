import type {OnModuleInit, OnModuleDestroy} from '@nestjs/common';
import type {StandardSchedule} from '../../application/agent-run/standard-schedule';
import type {PgBossScheduler} from './pg-boss-scheduler';
import type {PgStandardSchedule} from './pg-standard-schedule';
/** Nest owns the official worker lifecycle. Schema installation is a separate deploy step. */
export class StandardScheduleRuntime implements StandardSchedule, OnModuleInit, OnModuleDestroy {
 constructor(private readonly provider:Pick<PgBossScheduler,'start'|'stop'>,
  private readonly service:Pick<PgStandardSchedule,'invoke'|'deliver'>){}
 async onModuleInit(){
  try{await this.provider.start(job=>this.service.deliver(job));}
  catch{await this.provider.stop().catch(()=>undefined);throw new Error('schedule_provider_start_failed');}
 }
 async onModuleDestroy(){await this.provider.stop();}
 invoke(...args:Parameters<StandardSchedule['invoke']>){return this.service.invoke(...args);}
}

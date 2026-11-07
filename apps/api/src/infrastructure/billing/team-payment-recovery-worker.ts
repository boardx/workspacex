import {randomUUID} from "node:crypto";
import type {OnModuleInit,OnModuleDestroy} from "@nestjs/common";
import type {LoggerPort} from "../../application/ports/logger.port";
export interface TeamRecoverySweep{sweep():Promise<{processed:number;failed:number}>}
/** One bounded sweep per process; shutdown stops new work and drains the current transaction. */
export class TeamPaymentRecoveryWorker implements OnModuleInit,OnModuleDestroy{
 private timer:ReturnType<typeof setTimeout>|undefined;private running:Promise<void>|undefined;private started=false;private stopped=false;
 constructor(private readonly store:TeamRecoverySweep,private readonly logger:LoggerPort){}
 onModuleInit(){if(this.started)return;this.started=true;this.schedule(0);}
 private schedule(ms:number){if(this.stopped)return;this.timer=setTimeout(()=>{this.timer=undefined;void this.runOnce().then(()=>this.schedule(60000));},ms);this.timer.unref();}
 runOnce():Promise<void>{
  if(this.stopped)return Promise.resolve();if(this.running)return this.running;
  const task=this.sweep();this.running=task;void task.then(()=>{if(this.running===task)this.running=undefined;});return task;
 }
 private async sweep(){const traceId=`team-payment-recovery:${randomUUID()}`;try{const r=await this.store.sweep();if(r.processed||r.failed)this.logger.info("billing_team_recovery",{traceId,...r});}catch{this.logger.error("billing_team_recovery_failed",{traceId,err:{stage:"bounded_sweep"}});}}
 async onModuleDestroy(){this.stopped=true;if(this.timer)clearTimeout(this.timer);this.timer=undefined;await this.running;}
}

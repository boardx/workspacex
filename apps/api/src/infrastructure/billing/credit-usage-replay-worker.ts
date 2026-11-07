import type {OnModuleInit,OnModuleDestroy} from "@nestjs/common";
import type {DatabasePort} from "../../application/ports/database.port";
import type {LoggerPort} from "../../application/ports/logger.port";
import {creditUsageMeter} from "./credit-usage-meter";
/** Never invokes a model. It only persists previously fsynced authoritative receipts. */
export class CreditUsageReplayWorker implements OnModuleInit,OnModuleDestroy {
 private timer:ReturnType<typeof setInterval>|undefined;
 constructor(private readonly db:DatabasePort,private readonly log:LoggerPort){}
 onModuleInit(){this.timer=setInterval(()=>void this.replay(),5000);this.timer.unref();void this.replay();}
 onModuleDestroy(){if(this.timer)clearInterval(this.timer);}
 private async replay(){try{const result=await creditUsageMeter(this.db).replayPending();if(result.pending)this.log.info('credit_receipts_pending',{traceId:'credit-receipt-replay',pending:result.pending});}catch(err){this.log.error('credit_receipt_replay_unavailable',{traceId:'credit-receipt-replay',err});}}
}

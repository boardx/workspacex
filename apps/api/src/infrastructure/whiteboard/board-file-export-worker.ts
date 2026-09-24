import { Inject, Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { WHITEBOARD_FILE_EXPORT_SERVICE } from '../../application/whiteboard/file-export-ports';
import { DefaultWhiteboardFileExportService } from '../../application/whiteboard/file-export-service';

const POLL_MS=500;

/** Bounded process executor over globally admitted, leased PostgreSQL claims. */
@Injectable()
export class BoardFileExportWorker implements OnModuleInit,OnModuleDestroy {
  private readonly workerId=`board-export-${process.pid}-${randomUUID()}`;
  private timer:ReturnType<typeof setInterval>|null=null;
  private active=0;
  constructor(@Inject(WHITEBOARD_FILE_EXPORT_SERVICE)private readonly service:DefaultWhiteboardFileExportService){}
  onModuleInit():void{this.timer=setInterval(()=>void this.tick(),POLL_MS);this.timer.unref();void this.tick();}
  onModuleDestroy():void{if(this.timer)clearInterval(this.timer);}
  async runOnce():Promise<boolean>{const worked=await this.service.runNext(this.workerId);const cleaned=await this.service.cleanupNext(this.workerId);return worked||cleaned;}
  private tick():void{while(this.active<2){this.active++;void this.runOnce().catch(()=>false).then(worked=>{this.active--;if(worked)this.tick();});}}
}

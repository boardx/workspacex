import type { OnModuleDestroy,OnModuleInit } from '@nestjs/common';
import type { ObjectStore } from '../../application/artifact/ports';
import type { PhysicalPurgePort } from '../../application/files/physical-delete-ports';
import type { DatabasePort } from '../../application/ports/database.port';
import { PgWhiteboardImportRepository } from './pg-import-repository';
import { maintainWhiteboardObjectPurge } from './object-gc-maintenance';

export const WHITEBOARD_GC_RUNTIME=Symbol('WhiteboardGcRuntime');
type ExactPurge=PhysicalPurgePort&Required<Pick<PhysicalPurgePort,'purgeExact'>>;
/** Production lifecycle wiring; enabled explicitly and scoped to configured tenant ids. */
export class WhiteboardGcRuntime implements OnModuleInit,OnModuleDestroy{
  private timer:ReturnType<typeof setInterval>|null=null;private running=false;
  constructor(private readonly db:DatabasePort,private readonly objects:Pick<ObjectStore,'head'>,private readonly purge:ExactPurge,private readonly env:NodeJS.ProcessEnv=process.env,private readonly every:typeof setInterval=setInterval){}
  tenants(){return [...new Set((this.env.WHITEBOARD_GC_TENANTS??'').split(',').map(v=>v.trim()).filter(Boolean))];}
  async tick(){if(this.running)return;this.running=true;try{for(const orgId of this.tenants()){await new PgWhiteboardImportRepository(this.db).releaseExpiredAssets({orgId:orgId as never,userId:'system'},new Date());await maintainWhiteboardObjectPurge(this.db,this.objects,this.purge,orgId);}}finally{this.running=false;}}
  async onModuleInit(){if(this.env.WHITEBOARD_GC_SCHEDULER!=='1')return;const delay=Number(this.env.WHITEBOARD_GC_INTERVAL_MS??300_000);if(!Number.isSafeInteger(delay)||delay<60_000)throw new Error('WHITEBOARD_GC_INVALID_INTERVAL');await this.tick();this.timer=this.every(()=>void this.tick(),delay);this.timer.unref?.();}
  onModuleDestroy(){if(this.timer)clearInterval(this.timer);this.timer=null;}
}

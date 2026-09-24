import {AsyncLocalStorage} from 'node:async_hooks';
import {randomUUID} from 'node:crypto';
import type {OnModuleDestroy,OnModuleInit} from '@nestjs/common';
import {PgBoss,type Job} from 'pg-boss';
import type {DatabasePort,TenantSession} from '../../application/ports/database.port';
import type {LoggerPort} from '../../application/ports/logger.port';
import type {WhiteboardReceiptMaintenance} from '../../application/whiteboard/ports';
import type {OrgId} from '../../domain/org-id';
import {toOrgId} from '../../domain/org-id';
import {SCHEDULE_SCHEMA} from '../agent-run/pg-boss-scheduler';
import {cleanupAccessReceipts} from './pg-whiteboard-repository';

export const WHITEBOARD_RECEIPT_MAINTENANCE_QUEUE='workspacex-whiteboard-receipt-maintenance';
export const WHITEBOARD_RECEIPT_MAINTENANCE_CRON='17 3 * * *';
type MaintenanceWake={orgId:string};
type BossPort=Pick<PgBoss,'on'|'start'|'stop'|'work'|'schedule'>;

/** Persistent, tenant-scoped retention worker. The schedule data names one org and the
 * handler always re-enters that org through DatabasePort.withTenant; it never scans tenants. */
export class PgWhiteboardReceiptMaintenance implements WhiteboardReceiptMaintenance,OnModuleInit,OnModuleDestroy{
  private readonly transaction=new AsyncLocalStorage<TenantSession>();
  private readonly boss:BossPort;
  private started=false;
  constructor(private readonly db:DatabasePort,private readonly logger:LoggerPort,boss?:BossPort){
    this.boss=boss??new PgBoss({schema:SCHEDULE_SCHEMA,migrate:false,createSchema:false,reindex:false,
      db:{executeSql:async(sql,values)=>{
        const active=this.transaction.getStore();
        return active?active.query(sql,values):db.withoutTenant(session=>session.query(sql,values));
      }}});
    this.boss.on('error',error=>this.logger.error('whiteboard_receipt_maintenance_provider_error',{
      traceId:randomUUID(),err:error,
    }));
  }
  async onModuleInit():Promise<void>{
    try{
      await this.boss.start();
      await this.boss.work<MaintenanceWake>(WHITEBOARD_RECEIPT_MAINTENANCE_QUEUE,
        {batchSize:1,pollingIntervalSeconds:5},async jobs=>{
          for(const job of jobs)await this.deliver(job);
        });
      this.started=true;
    }catch(error){
      this.logger.error('whiteboard_receipt_maintenance_start_failed',{traceId:randomUUID(),err:error});
      await this.boss.stop({graceful:true,timeout:10000}).catch(()=>undefined);
      throw new Error('whiteboard_receipt_maintenance_start_failed');
    }
  }
  async onModuleDestroy():Promise<void>{
    this.started=false;
    await this.boss.stop({graceful:true,timeout:10000});
  }
  async ensureScheduled(session:TenantSession,orgId:OrgId):Promise<void>{
    if(!this.started)throw new Error('WHITEBOARD_RECEIPT_MAINTENANCE_UNAVAILABLE');
    await this.transaction.run(session,()=>this.boss.schedule(
      WHITEBOARD_RECEIPT_MAINTENANCE_QUEUE,WHITEBOARD_RECEIPT_MAINTENANCE_CRON,{orgId},{
        key:`org/${orgId}`,tz:'UTC',retryLimit:20,retryDelay:60,retryBackoff:true,deleteAfterSeconds:604800,
      }));
  }
  private async deliver(job:Job<MaintenanceWake>):Promise<void>{
    const traceId=job.id||randomUUID();
    try{
      const orgId=toOrgId(job.data.orgId);
      const deleted=await this.db.withTenant(orgId,session=>cleanupAccessReceipts(session,orgId));
      this.logger.info('whiteboard_receipt_maintenance_completed',{traceId,orgId,deleted});
    }catch(error){
      this.logger.error('whiteboard_receipt_maintenance_failed',{traceId,err:error});
      // pg-boss records the failure and applies the queue retry policy.
      throw error;
    }
  }
}

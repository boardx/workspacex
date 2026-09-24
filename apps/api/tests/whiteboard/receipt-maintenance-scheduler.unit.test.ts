import 'reflect-metadata';
import {describe,expect,it,vi} from 'vitest';
import type {Job} from 'pg-boss';
import type {DatabasePort,QueryResult,TenantSession} from '../../src/application/ports/database.port';
import type {LoggerPort} from '../../src/application/ports/logger.port';
import {toOrgId} from '../../src/domain/org-id';
import {WHITEBOARD_RECEIPT_MAINTENANCE,WHITEBOARD_REPOSITORY} from '../../src/application/whiteboard/ports';
import {KernelModule} from '../../src/kernel.module';
import {
  PgWhiteboardReceiptMaintenance,
  WHITEBOARD_RECEIPT_MAINTENANCE_CRON,
  WHITEBOARD_RECEIPT_MAINTENANCE_QUEUE,
} from '../../src/infrastructure/whiteboard/pg-whiteboard-receipt-maintenance';

type Wake={orgId:string};
type Schedule={queue:string;cron:string;data:Wake;options:{key:string;retryLimit:number;retryBackoff:boolean}};
class FakeBoss{
  handler:((jobs:Job<Wake>[])=>Promise<void>)|null=null;
  readonly errors:Array<(error:unknown)=>void>=[];
  constructor(readonly schedules=new Map<string,Schedule>(),private readonly failStart=false){}
  on(event:string,handler:(error:unknown)=>void){if(event==='error')this.errors.push(handler);return this;}
  async start(){if(this.failStart)throw new Error('private scheduler detail');}
  async stop(){}
  async work(_queue:string,_options:unknown,handler:(jobs:Job<Wake>[])=>Promise<void>){this.handler=handler;return 'worker';}
  async schedule(queue:string,cron:string,data:Wake,options:Schedule['options']){
    this.schedules.set(`${queue}:${options.key}`,{queue,cron,data,options});return 'schedule';
  }
  dispatch(data:Wake,id='maintenance-job'){
    if(!this.handler)throw new Error('worker unavailable');
    return this.handler([{id,data} as Job<Wake>]);
  }
}
function fixture(options:{cleanupError?:Error}={}){
  const queries:string[]=[];
  const session:TenantSession={query:async<R>(sql:string)=>{
    queries.push(sql);
    if(options.cleanupError)throw options.cleanupError;
    return {rows:[]} as QueryResult<R>;
  }};
  const tenantOrgs:string[]=[];
  const db:DatabasePort={
    withTenant:async(org,work)=>{tenantOrgs.push(org);return work(session);},
    withoutTenant:async work=>work(session),close:async()=>{},
  };
  const info=vi.fn(),error=vi.fn();
  const logger:LoggerPort={info,error};
  return {db,session,queries,tenantOrgs,logger,info,error};
}

describe('whiteboard access-receipt maintenance scheduler',()=>{
  it('is wired into repository composition and is enabled by the production runtime flag',()=>{
    const providers=Reflect.getMetadata('providers',KernelModule) as Array<{
      provide?:symbol;useFactory?:(...args:never[])=>unknown;inject?:unknown[];
    }>;
    const maintenance=providers.find(provider=>provider.provide===WHITEBOARD_RECEIPT_MAINTENANCE)!;
    const repository=providers.find(provider=>provider.provide===WHITEBOARD_REPOSITORY)!;
    expect(repository.inject).toContain(WHITEBOARD_RECEIPT_MAINTENANCE);
    const prior=process.env.KERNEL_WHITEBOARD_RECEIPT_MAINTENANCE;
    try{
      delete process.env.KERNEL_WHITEBOARD_RECEIPT_MAINTENANCE;
      expect(maintenance.useFactory!()).toBeNull();
      process.env.KERNEL_WHITEBOARD_RECEIPT_MAINTENANCE='1';
      const state=fixture();
      expect(maintenance.useFactory!(state.db as never,state.logger as never))
        .toBeInstanceOf(PgWhiteboardReceiptMaintenance);
    }finally{
      if(prior===undefined)delete process.env.KERNEL_WHITEBOARD_RECEIPT_MAINTENANCE;
      else process.env.KERNEL_WHITEBOARD_RECEIPT_MAINTENANCE=prior;
    }
  });

  it('registers one persistent org schedule, then resumes it after worker restart',async()=>{
    const shared=new Map<string,Schedule>(),firstBoss=new FakeBoss(shared),first=fixture();
    const runtime=new PgWhiteboardReceiptMaintenance(first.db,first.logger,firstBoss as never);
    await runtime.onModuleInit();
    const orgId=toOrgId('tenant-a');
    await runtime.ensureScheduled(first.session,orgId);
    await runtime.ensureScheduled(first.session,orgId);
    expect([...shared.values()]).toEqual([expect.objectContaining({
      queue:WHITEBOARD_RECEIPT_MAINTENANCE_QUEUE,cron:WHITEBOARD_RECEIPT_MAINTENANCE_CRON,
      data:{orgId},options:expect.objectContaining({key:`org:${orgId}`,retryLimit:20,retryBackoff:true}),
    })]);
    await runtime.onModuleDestroy();

    const restartedBoss=new FakeBoss(shared),restarted=fixture();
    const afterRestart=new PgWhiteboardReceiptMaintenance(restarted.db,restarted.logger,restartedBoss as never);
    await afterRestart.onModuleInit();
    await restartedBoss.dispatch([...shared.values()][0]!.data);
    expect(restarted.tenantOrgs).toEqual([orgId]);
    expect(restarted.queries).toHaveLength(2);
    expect(restarted.info).toHaveBeenCalledWith('whiteboard_receipt_maintenance_completed',
      expect.objectContaining({traceId:'maintenance-job',orgId,deleted:0}));
    await afterRestart.onModuleDestroy();
  });

  it('rethrows cleanup failure for pg-boss retry and records a structured error',async()=>{
    const boss=new FakeBoss(),state=fixture({cleanupError:new Error('database unavailable')});
    const runtime=new PgWhiteboardReceiptMaintenance(state.db,state.logger,boss as never);
    await runtime.onModuleInit();
    await expect(boss.dispatch({orgId:'tenant-a'},'failed-job')).rejects.toThrow('database unavailable');
    expect(state.error).toHaveBeenCalledWith('whiteboard_receipt_maintenance_failed',{
      traceId:'failed-job',err:expect.any(Error),
    });
    await runtime.onModuleDestroy();
  });

  it('fails startup with a sanitized error and observable detail',async()=>{
    const boss=new FakeBoss(new Map(),true),state=fixture();
    const runtime=new PgWhiteboardReceiptMaintenance(state.db,state.logger,boss as never);
    await expect(runtime.onModuleInit()).rejects.toThrow('whiteboard_receipt_maintenance_start_failed');
    expect(state.error).toHaveBeenCalledWith('whiteboard_receipt_maintenance_start_failed',
      expect.objectContaining({traceId:expect.any(String),err:expect.any(Error)}));
  });
});

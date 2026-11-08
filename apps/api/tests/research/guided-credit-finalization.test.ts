import { expect, it, vi } from 'vitest';
import { research as C } from '@repo/contracts';
import { GuidedRuntimeService, initialRuntime } from '../../src/application/research/guided-runtime-service';
import { CreditConsumptionError } from '../../src/application/billing/credit-consumption';
import { PersistedResearchRuntimeSchema } from '../../src/application/research/guided-runtime-persistence';
import { toOrgId } from '../../src/domain/org-id';
import { ResearchRuntimeError, type GuidedRuntimeStore, type ResearchRuntime } from '../../src/application/research/guided-runtime-ports';
import { runtimeProgress } from '../../src/interface/controllers/guided-research-progress';
import { runtimeDelta, fieldFingerprint } from '../../src/interface/controllers/guided-research-delta';
function fixture(error: unknown = new CreditConsumptionError('credit_required','user','owner')) {
  const session = C.GuidedResearchSession.parse({ sessionId:'credit-research', title:'Probe', brief:{topic:'Grid',goal:'Entry',region:'EU',focus:'Policy',timeRange:'2026'}, stage:'brief',resumeStage:'brief',status:'active',progress:0,sourceCount:0,reportId:null,createdAt:'now',updatedAt:'now' });
  let stored = initialRuntime(session), done = false;
  const writes: {state:ResearchRuntime;final:boolean}[] = [];
  const store: GuidedRuntimeStore = {
    read:async()=>structuredClone(stored),
    claim:async()=>{if(done)return{state:structuredClone(stored),replay:true}; stored.busy=true;stored.leaseUntil=new Date(Date.now()+600000).toISOString();return{state:structuredClone(stored),replay:false};},
    write:async(_actor,_request,state,final)=>{stored=PersistedResearchRuntimeSchema.parse(structuredClone(state));writes.push({state:structuredClone(stored),final});done=final;},
  };
  const model = { complete:vi.fn(async()=>{throw error;}) };
  const service=new GuidedRuntimeService(store,model,{search:vi.fn(),read:vi.fn()} as never,{provider:'test',id:'test'});
  const actor={orgId:toOrgId('org'),userId:'owner',sessionId:session.sessionId};
  const command={sessionId:session.sessionId,node:'brief' as const,action:'prepare_plan' as const,requestId:'credit-once',expectedVersion:0};
  return {session,store,model,service,actor,command,writes,error,stored:()=>stored};
}
it.each(['credit_required','credit_accounting_unavailable'] as const)('finalizes a real %s before returning the same refusal; refresh/replay never redispatches', async code=>{
  const f=fixture(new CreditConsumptionError(code,'user','owner'));
  const events:unknown[]=[];
  await expect(f.service.execute(f.actor,f.session,f.command,e=>events.push(e))).rejects.toBe(f.error);
  expect(f.stored()).toMatchObject({busy:false,leaseUntil:null,errorCode:code.toUpperCase(),progress:null});
  expect(f.writes.filter(w=>w.final)).toHaveLength(1);
  expect(f.writes.at(-1)?.final).toBe(true);
  expect(f.model.complete).toHaveBeenCalledTimes(1);
  expect(events.at(-1)).toMatchObject({type:'result',state:{busy:false,leaseUntil:null,errorCode:code.toUpperCase()}});
  const refreshed=await f.service.get(f.actor,f.session);
  expect(refreshed.creditFailure).toEqual(code==='credit_required'?{code,ownerType:'user',ownerId:'owner',rechargePath:'/billing?purchase=1'}:null);
  expect(await f.service.execute(f.actor,f.session,f.command)).toEqual(refreshed);
  expect(f.model.complete).toHaveBeenCalledTimes(1);
  expect(f.writes.filter(w=>w.final)).toHaveLength(1);
});
it.each(['RESEARCH_GRAPH_VERSION_CONFLICT','database write failed'])('does not hide final persistence failure %s behind the original Credit refusal', async reason=>{
 const f=fixture(); const write=f.store.write;
 const failure=new ResearchRuntimeError(reason);
 f.store.write=async(...args)=>{if(args[3])throw failure; return write(...args);};
 await expect(f.service.execute(f.actor,f.session,f.command)).rejects.toBe(failure);
 expect(f.stored().busy).toBe(true);
 expect(f.writes.filter(w=>w.final)).toHaveLength(0);
 expect(f.model.complete).toHaveBeenCalledTimes(1);
});
it('preserves ordinary failure behavior and does not mistake untyped error payloads for Credit',async()=>{
 const f=fixture(Object.assign(new Error('credit_required'),{code:'credit_required',ownerType:'user',ownerId:'owner'}));
 expect(await f.service.execute(f.actor,f.session,f.command)).toMatchObject({busy:false,leaseUntil:null,errorCode:'RESEARCH_WORKFLOW_UNAVAILABLE',creditFailure:null});
 expect(f.writes.filter(w=>w.final)).toHaveLength(1);
});
it.each([
 {ownerType:'user' as const,ownerId:'owner',reason:undefined,expected:'CREDIT_REQUIRED'},
 {ownerType:'team' as const,ownerId:'org',reason:undefined,expected:'CREDIT_REQUIRED'},
 {ownerType:'team' as const,ownerId:'org',reason:'member_monthly_limit' as const,expected:'CREDIT_REQUIRED'},
 {ownerType:'user' as const,ownerId:'foreign',reason:undefined,expected:'CREDIT_ACCOUNTING_UNAVAILABLE'},
 {ownerType:'team' as const,ownerId:'foreign',reason:undefined,expected:'CREDIT_ACCOUNTING_UNAVAILABLE'},
])('retains only canonical owned payer guidance: $ownerType/$ownerId/$reason',async ({ownerType,ownerId,reason,expected})=>{
 const f=fixture(new CreditConsumptionError('credit_required',ownerType,ownerId,'private failure',reason));
 await expect(f.service.execute(f.actor,f.session,f.command)).rejects.toBe(f.error);
 const view=await f.service.get(f.actor,f.session);
 expect(view.errorCode).toBe(expected);
 if(expected==='CREDIT_ACCOUNTING_UNAVAILABLE')expect(view.creditFailure).toBeNull();
 else expect(view.creditFailure).toMatchObject({code:'credit_required',ownerType,ownerId,...(reason?{reason}:{})});
 expect(JSON.stringify(view)).not.toContain('private failure');
});
it('filters another viewer from GET, progress, delta, replay and steering without erasing durable guidance',async()=>{
 const f=fixture();await expect(f.service.execute(f.actor,f.session,f.command)).rejects.toBe(f.error);
 const own=await f.service.get(f.actor,f.session);
 const other={...f.actor,userId:'collaborator'};
 const view=await f.service.get(other,f.session);
 expect(view.creditFailure).toBeNull(); expect(view.errorCode).toBe('CREDIT_REQUIRED');
 expect(runtimeProgress(view).creditFailure).toBeNull();
 const known=Object.fromEntries(C.GuidedResearchRuntimeKnownFields.keySchema.options.map(key=>[key,fieldFingerprint(own[key])]));
 expect(runtimeDelta(view,known).changes.creditFailure).toBeNull();
 const events:unknown[]=[];
 await f.service.execute(other,f.session,f.command,e=>events.push(e));
 f.store.steer=async()=>structuredClone(f.stored());
 await f.service.execute(other,f.session,{...f.command,action:'pause'},e=>events.push(e));
 expect(events).toHaveLength(3);
 for(const event of events){expect((event as {state:ResearchRuntime}).state.creditFailure).toBeNull(); expect(JSON.stringify(event)).not.toContain('"ownerId":"owner"');}
 expect(f.stored().creditFailure?.ownerId).toBe('owner');
 expect(f.model.complete).toHaveBeenCalledTimes(1);
});
it('removes stale payer guidance when the next attempt starts and keeps an outage free of recharge actions',async()=>{
 const f=fixture();await expect(f.service.execute(f.actor,f.session,f.command)).rejects.toBe(f.error);
 const old=f.stored(); f.store.claim=async()=>({state:{...structuredClone(old),busy:true,errorCode:null},replay:false});
 const outage=new CreditConsumptionError('credit_accounting_unavailable','user','owner');
 f.model.complete.mockRejectedValue(outage);
 await expect(f.service.execute(f.actor,f.session,{...f.command,requestId:'manual-retry'})).rejects.toBe(outage);
 expect(f.writes.at(-2)?.state.creditFailure).toBeNull();
 expect(await f.service.get(f.actor,f.session)).toMatchObject({errorCode:'CREDIT_ACCOUNTING_UNAVAILABLE',creditFailure:null,busy:false});
 expect(f.model.complete).toHaveBeenCalledTimes(2);
});
it.each([false,true])('controller projections keep personal scope private, including knownFields=%s',async withKnown=>{
 const {GuidedResearchController}=await import('../../src/interface/controllers/guided-research.controller');
 const f=fixture();await expect(f.service.execute(f.actor,f.session,f.command)).rejects.toBe(f.error);
 const controller=new GuidedResearchController({} as never,{} as never,{} as never,{} as never,{} as never,f.service);
 vi.spyOn(controller as never,'current' as never).mockResolvedValue(f.session as never);
 const own=await f.service.get(f.actor,f.session);
 const knownFields=withKnown?Object.fromEntries(C.GuidedResearchRuntimeKnownFields.keySchema.options.map(key=>[key,fieldFingerprint(own[key])])):undefined;
 const principal={orgId:f.actor.orgId,userId:'collaborator'};
 const get=await controller.getRuntime(principal,f.session.sessionId);
 const progress=await controller.getRuntimeProgress(principal,f.session.sessionId,knownFields?{knownFields:JSON.stringify(knownFields)}:{});
 const result=await controller.executeRuntime(principal,f.session.sessionId,{...f.command,...(knownFields?{knownFields}:{})},{} as never);
 const frames:string[]=[];
 const response={setHeader:vi.fn(),flushHeaders:vi.fn(),on:vi.fn(),off:vi.fn(),end:vi.fn(),write:(frame:string)=>frames.push(frame),writableLength:0,destroyed:false};
 await controller.streamRuntime(principal,f.session.sessionId,{...f.command,...(knownFields?{knownFields}:{})},response as never,{headers:{}} as never);
 expect(get?.creditFailure).toBeNull();
 expect(JSON.stringify([get,progress,result,frames])).not.toContain('"ownerId":"owner"');
 expect(JSON.stringify([get,progress,result,frames])).not.toContain('/billing?purchase=1');
 expect(f.stored().creditFailure?.ownerId).toBe('owner');
 expect(f.model.complete).toHaveBeenCalledTimes(1);
});
it.each(['text/event-stream','application/x-ndjson'])('Credit terminal stream uses one durable typed failure with Accept=%s',async accept=>{
 const {GuidedResearchController}=await import('../../src/interface/controllers/guided-research.controller');
 const f=fixture();
 const controller=new GuidedResearchController({} as never,{} as never,{} as never,{} as never,{} as never,f.service);
 vi.spyOn(controller as never,'current' as never).mockResolvedValue(f.session as never);
 const frames:string[]=[];
 const response={setHeader:vi.fn(),flushHeaders:vi.fn(),on:vi.fn(),off:vi.fn(),end:vi.fn(),write:(frame:string)=>frames.push(frame),writableLength:0,destroyed:false};
 await controller.streamRuntime(f.actor,f.session.sessionId,f.command,response as never,{headers:{accept}} as never);
 const events=frames.join('').split('\n').filter(line=>line.trim()).map(line=>JSON.parse(line.replace(/^data: /,'')));
 const terminal=events.filter(e=>['result','failed','error'].includes(e.type));
 expect(terminal).toHaveLength(1);
 expect(JSON.stringify(terminal)).toContain('CREDIT_REQUIRED');
 expect(JSON.stringify(events)).not.toContain('RESEARCH_WORKFLOW_UNAVAILABLE');
 expect(f.stored()).toMatchObject({busy:false,leaseUntil:null,errorCode:'CREDIT_REQUIRED'});
 expect(f.model.complete).toHaveBeenCalledTimes(1);
});
it('source-screening Credit refusal stops the pipeline instead of entering recoverable search retries',async()=>{
 const f=fixture();const stored=f.stored();
 stored.currentNode='research';stored.availableNodes=['brief','directions','outline','research'];
 stored.outline=[{id:'section',title:'Policy',questions:['Which policy?'],enabled:true,order:0}];
 stored.tasks=[{id:'task',sectionId:'section',query:'Grid policy',status:'pending',attempts:0,errorCode:null}];
 const search={search:vi.fn(async()=>[{title:'Policy',url:'https://example.org/policy',content:'Grid policy requires permits.'}]),read:vi.fn(async()=>({text:'Grid policy requires permits.',contentKind:'text' as const,truncated:false}))};
 const service=new GuidedRuntimeService(f.store,f.model,search,{provider:'test',id:'test'});
 await expect(service.execute(f.actor,f.session,{...f.command,node:'research',action:'start'})).rejects.toBe(f.error);
 expect(f.stored()).toMatchObject({busy:false,leaseUntil:null,errorCode:'CREDIT_REQUIRED'});
 expect(f.model.complete).toHaveBeenCalledTimes(1);
 expect(search.search).toHaveBeenCalledTimes(1);
 expect(f.stored().tasks[0]?.status).toBe('failed');
});

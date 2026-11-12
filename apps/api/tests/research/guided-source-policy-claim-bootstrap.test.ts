import {expect,it,vi} from 'vitest';
import {research as C} from '@repo/contracts';
import {GuidedRuntimeService,initialRuntime} from '../../src/application/research/guided-runtime-service';
import {PgGuidedRuntimeStore} from '../../src/infrastructure/research/pg-guided-runtime-store';
import {GuidedResearchController} from '../../src/interface/controllers/guided-research.controller';
const raw={node:'brief',action:'refine_source_policy',requestId:'bootstrap-policy',expectedVersion:0,expectedRevision:0,idempotencyKey:'bootstrap-policy',sourcePolicy:{mode:'open',domains:[],internalSourceIds:[],revision:1}};
function legacy(fresh=false, requests: Record<string,{hash:string;done:boolean}>={}){
 const session=C.GuidedResearchSession.parse({sessionId:'legacy',title:'Existing research',brief:{topic:'Grid',goal:'Existing goal',region:'EU',focus:'Policy',timeRange:'2026'},stage:'directions',resumeStage:'directions',status:'active',progress:20,sourceCount:0,reportId:null,createdAt:'now',updatedAt:'now',directions:{candidateVersion:1,confirmedVersion:null,versions:[{version:1,createdAt:'now',confirmedAt:null,items:[{id:'d1',title:'Existing direction',description:'Already generated',enabled:true,order:0}]}]}});
 if(fresh) session.directions={candidateVersion:null,confirmedVersion:null,versions:[]};
 let saved=initialRuntime(session);
 const writes:string[]=[];
 const query=vi.fn(async(sql:string,params:readonly unknown[]=[])=>{
  if(sql.startsWith('SELECT g.id'))return {rows:[{id:'legacy'}]};
  if(sql.startsWith('SELECT state,'))return {rows:[{state:structuredClone(saved),requests,active_request_id:null}]};
  if(sql.startsWith('SELECT state FROM'))return {rows:[{state:structuredClone(saved)}]};
  if(sql.startsWith('INSERT INTO guided_research_runtime'))return {rows:[]};
  if(sql.startsWith('UPDATE guided_research_runtime')){writes.push(sql);saved=JSON.parse(String(params[2]));return {rows:[{session_id:'legacy',state:structuredClone(saved)}]};}
  if(sql.startsWith('UPDATE guided_research_sessions'))return {rows:[]};
  throw new Error('Unexpected SQL');
 });
 const store=new PgGuidedRuntimeStore({withTenant:async(_org:unknown,work:(tx:{query:typeof query})=>Promise<unknown>)=>work({query})} as never);
 const model={complete:vi.fn()};
 const service=new GuidedRuntimeService(store,model,{search:vi.fn()},{provider:'test',id:'test'});
 const controller=new GuidedResearchController({} as never,{} as never,{} as never,{} as never,{} as never,service);
 vi.spyOn(controller as never,'current' as never).mockResolvedValue(session as never);
 return {session,initial:structuredClone(saved),controller,store,writes,latest:()=>saved};
}
it('strict initial-brief bootstrap must reject a real legacy directions runtime whose version is still zero',async()=>{
 const f=legacy();
 expect(f.initial).toMatchObject({version:0,currentNode:'directions',availableNodes:['brief','directions']});
 expect(f.initial.legacyCheckpoint).not.toBeNull();
 await expect(f.controller.executeRuntime({userId:'owner',orgId:'org' as never},'legacy',JSON.parse(JSON.stringify(raw)),{} as never)).rejects.toThrow();
 expect(f.writes).toEqual([]);
});

it('fresh session stage=directions without any generated versions still allows the initial online policy',async()=>{
 const f=legacy(true);
 expect(f.session.stage).toBe('directions');
 expect(f.initial).toMatchObject({version:0,currentNode:'brief',availableNodes:['brief'],legacyCheckpoint:null});
 const policy=raw.sourcePolicy;
 const response=await f.controller.executeRuntime({userId:'owner',orgId:'org' as never},'legacy',JSON.parse(JSON.stringify({...raw,sourcePolicy:policy})),{} as never);
 expect(response).toMatchObject({currentNode:'brief',sourcePolicy:policy,errorCode:null});
 expect(f.latest().sourcePolicy).toEqual(policy);
 expect(f.writes.length).toBeGreaterThan(0);
});
it('matching successful request replays before the new initial-state restriction',async()=>{
 const f=legacy(false,{'bootstrap-policy':{hash:'same-hash',done:true}});
 f.latest().version=5;
 const result=await f.store.claim({userId:'owner',orgId:'org' as never,sessionId:'legacy'},C.GuidedResearchRuntimeCommand.parse({...raw,sessionId:'legacy'}),'same-hash');
 expect(result.replay).toBe(true); expect(result.state.currentNode).toBe('directions'); expect(f.writes).toEqual([]);
});
it('mismatched request replay still fails idempotency before any initial-state check',async()=>{
 const f=legacy(false,{'bootstrap-policy':{hash:'original-hash',done:true}});
 await expect(f.store.claim({userId:'owner',orgId:'org' as never,sessionId:'legacy'},C.GuidedResearchRuntimeCommand.parse({...raw,sessionId:'legacy'}),'changed-hash')).rejects.toThrow('RESEARCH_IDEMPOTENCY_REPLAY_MISMATCH');
 expect(f.writes).toEqual([]);
});

it.each(['checkpoint','available-node'] as const)('rejects a nominal brief with later-stage %s authority',async kind=>{
 const f=legacy(kind==='available-node');
 f.latest().currentNode='brief';
 f.latest().availableNodes=kind==='available-node'?['brief','directions']:['brief'];
 await expect(f.controller.executeRuntime({userId:'owner',orgId:'org' as never},'legacy',JSON.parse(JSON.stringify(raw)),{} as never)).rejects.toThrow();
 expect(f.writes).toEqual([]);
});
it('matching active request replays before the initial-stage restriction',async()=>{
 const f=legacy(false,{'bootstrap-policy':{hash:'same-hash',done:false}});
 f.latest().busy=true;f.latest().leaseUntil=new Date(Date.now()+600000).toISOString();
 const result=await f.store.claim({userId:'owner',orgId:'org' as never,sessionId:'legacy'},C.GuidedResearchRuntimeCommand.parse({...raw,sessionId:'legacy'}),'same-hash');
 expect(result.replay).toBe(true);expect(f.writes).toEqual([]);
});

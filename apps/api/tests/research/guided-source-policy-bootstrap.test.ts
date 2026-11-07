import { expect, it, vi } from 'vitest';
import { research as C } from '@repo/contracts';
import { GuidedResearchController } from '../../src/interface/controllers/guided-research.controller';
import { GuidedRuntimeService, initialRuntime } from '../../src/application/research/guided-runtime-service';
import { PersistedResearchRuntimeSchema } from '../../src/application/research/guided-runtime-persistence';
const raw = {node:'brief',action:'refine_source_policy',requestId:'source-policy-s-0-materials',expectedVersion:0,expectedRevision:0,idempotencyKey:'source-policy-s-0-materials',sourcePolicy:{mode:'materials',domains:[],internalSourceIds:[],revision:1}};
function fixture() {
 const session = C.GuidedResearchSession.parse({sessionId:'s',title:'Research',brief:{topic:'Grid',goal:'Entry',region:'EU',focus:'Policy',timeRange:'2026'},stage:'brief',resumeStage:'brief',status:'active',progress:0,sourceCount:0,reportId:null,createdAt:'now',updatedAt:'now'});
 let saved = initialRuntime(session);
 const claim = vi.fn(async () => { saved.busy=true; return {state:structuredClone(saved),replay:false}; });
 const model = {complete:vi.fn()}; const search = vi.fn();
 const service = new GuidedRuntimeService({read:async()=>structuredClone(saved),claim,write:async(_a,_r,next)=>{saved=PersistedResearchRuntimeSchema.parse(structuredClone(next));}},model,{search},{provider:'test',id:'test'});
 const execute = vi.spyOn(service, 'execute');
 const controller = new GuidedResearchController({} as never,{} as never,{} as never,{} as never,{} as never,service);
 vi.spyOn(controller as never,'current' as never).mockResolvedValue(session as never);
 const principal = {userId:'owner',orgId:'org' as never};
 return {controller,principal,claim,model,search,execute,latest:()=>saved};
}
it('controller accepts JSON source policy bootstrap and real runtime persists it without model/search', async()=>{
 const f=fixture();
 const response=await f.controller.executeRuntime(f.principal,'s',JSON.parse(JSON.stringify(raw)),{} as never);
 expect(response).toMatchObject({sourcePolicy:raw.sourcePolicy,errorCode:null,planRevision:1});
 expect(f.latest().sourcePolicy).toEqual(raw.sourcePolicy);
 expect(f.latest().currentNode).toBe('brief');expect(f.latest().brief.topic).toBe('Grid');
 expect(f.model.complete).not.toHaveBeenCalled();expect(f.search).not.toHaveBeenCalled();
});
it.each([{node:'report'},{expectedVersion:1},{expectedRevision:1},{message:'override'}])('controller rejects invalid bootstrap before claim: %j',async patch=>{
 const f=fixture();
 await expect(f.controller.executeRuntime(f.principal,'s',{...raw,...patch},{} as never)).rejects.toThrow('Bad Request');
 expect(f.claim).not.toHaveBeenCalled();
});
it('schema bootstrap does not bypass runtime internal-source authorization',async()=>{
 const f=fixture();
 await expect(f.controller.executeRuntime(f.principal,'s',{...raw,sourcePolicy:{...raw.sourcePolicy,internalSourceIds:['private-artifact']}},{} as never)).rejects.toThrow();
 expect(f.execute).toHaveBeenCalledOnce();
 expect(f.claim).not.toHaveBeenCalled();expect(f.model.complete).not.toHaveBeenCalled();
 expect(f.latest().sourcePolicy).not.toEqual({...raw.sourcePolicy,internalSourceIds:['private-artifact']});
});

it('controller preserves compact transport for the initial source-policy request',async()=>{
 const f=fixture();
 const response=await f.controller.executeRuntime(f.principal,'s',JSON.parse(JSON.stringify({...raw,knownFields:{},compactSources:true})),{} as never);
 expect(C.GuidedResearchRuntimePatch.parse(response).changes.sourcePolicy).toEqual(raw.sourcePolicy);
 expect(f.latest().planRevision).toBe(1);
});
it.each([
 {version:1,code:'RESEARCH_GRAPH_VERSION_CONFLICT'},
 {planRevision:1,code:'RESEARCH_REVISION_CONFLICT'},
 {availableNodes:['research'],code:'RESEARCH_NODE_LOCKED'},
])('existing PG store rejects bootstrap against incompatible persisted state: $code',async patch=>{
 const {PgGuidedRuntimeStore}=await import('../../src/infrastructure/research/pg-guided-runtime-store');
 const f=fixture(); const {code,...changed}=patch; const state={...f.latest(),...changed};
 const query=vi.fn(async(sql:string)=>{
  if(sql.startsWith('SELECT g.id'))return {rows:[{id:'s'}]};
  if(sql.startsWith('SELECT state,'))return {rows:[{state,requests:{},active_request_id:null}]};
  throw new Error('unexpected mutation');
 });
 const store=new PgGuidedRuntimeStore({withTenant:async(_org:unknown,work:(tx:unknown)=>unknown)=>work({query})} as never);
 await expect(store.claim({...f.principal,sessionId:'s'},C.GuidedResearchRuntimeCommand.parse({...raw,sessionId:'s'}),'hash')).rejects.toThrow(code);
 expect(query.mock.calls.every(([sql])=>sql.startsWith('SELECT'))).toBe(true);
});

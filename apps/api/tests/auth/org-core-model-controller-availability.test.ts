import {it,expect,vi} from "vitest";
import {toOrgId} from "../../src/domain/org-id";
import type {TenantSession,DatabasePort} from "../../src/application/ports/database.port";
import type {ModelCallPort} from "../../src/application/agent-run/ports";
import type {ModelBoundRegistration} from "../../src/application/agent-run/verified-model-bound-registry";
import type {AiQuotaRuntimeConfiguration} from "../../src/infrastructure/agent-run/ai-runtime-wiring";
import {OrgCoreModelController} from "../../src/interface/controllers/org-core-model.controller";
import {VerifiedOrgCoreModelAvailability} from "../../src/infrastructure/model/org-core-model-availability";
import {OrgCoreModelError} from "../../src/application/model/org-core-model-ports";
const orgId=toOrgId("actual-org"),principal={orgId,userId:"admin"};
const registration=():ModelBoundRegistration=>({binding:{modelId:"formal",modelProvider:"private-route",runtimeModelId:"runtime",capabilityTags:["tools"],contextWindow:1000,maxOutputTokens:100,outputCapSupported:true,billedOutputBoundVerified:true,accountingComplete:true},privateConnectionId:"internal-account-group",billingUnit:"token",implementation:"verified-fixture",version:"1",artifactSha256:"a".repeat(64),source:"verified-tokenizer",verifyDeploymentBinding:async()=>true,measureSerializedBody:async()=>2});
const price={modelId:"formal",modelProvider:"private-route",runtimeModelId:"runtime",inputMicrosPerMillion:"10",outputMicrosPerMillion:"20",cachedInputMicrosPerMillion:"5",maxInputTokens:100,maxOutputTokens:50};
const configuration={window:{start:"2026-10-01T00:00:00Z",end:"2026-11-01T00:00:00Z",timezone:"Etc/UTC"},ordinaryTokensPerUser:"100",costMicrosPerUser:"1000",currency:"CNY",prices:[price],fallbackModelIds:[],maxAttempts:1};
function fixture(options:{registration?:ModelBoundRegistration;configuration?:unknown;role?:string;status?:string;kind?:string;shape?:string;enabledDeployment?:boolean;requiredCapabilities?:readonly string[];poolCapabilities?:readonly string[]}={}){
 const queries:string[]=[],calls:unknown[]=[],entry=options.registration??registration();
 const query:TenantSession['query']=async(sql,params)=>{
  queries.push(sql);calls.push(params);
  if(sql.includes('FROM org_memberships'))return {rows:[{org_role:options.role??'admin',user_id:principal.userId,org_id:orgId}]} as never;
  if(sql.includes('SELECT kind FROM organizations'))return {rows:[{kind:options.kind??'organization'}]} as never;
  if(sql.includes('FROM organization_ai_policies'))return {rows:[{configuration:options.configuration??configuration,price_version:'audited-v1'}]} as never;
  if(sql.includes('FROM models'))return {rows:[{id:'formal',kind:'closed-api',shape:options.shape??'single',vendor:'configured-vendor',display_name:'Actual Model',capability_tags:options.poolCapabilities??['tools'],context_window:1000,unit_price:'0.1',compliance_attrs:[],status:options.status??'已启用',credential_configured:true}]} as never;
  if(sql.includes('FROM model_composite_members'))return {rows:[]};
  throw new Error('unexpected-query:'+sql);
 };
 const db:DatabasePort={withTenant:async(scope,work)=>{expect(scope).toBe(orgId);return work({query});},withoutTenant:async()=>{throw new Error('tenant-required');},close:async()=>{}};
 const model:ModelCallPort={complete:vi.fn(async()=>({text:'not-called'})),supportsDispatchAdmission:()=>true,supportsRequestAccounting:()=>true};
 const runtime:AiQuotaRuntimeConfiguration={privateRuntimeProvider:'private-route',coreModelRequiredCapabilities:options.requiredCapabilities??['tools'],modelBounds:[entry],selection:async()=>{}};
 const reader=new VerifiedOrgCoreModelAvailability(db,options.enabledDeployment===false?null:runtime,model);
 return {reader,queries,calls,db,model};
}
it('available candidate requires trusted deployment and audited tariff, exposes no private binding and writes no budget',async()=>{
 const f=fixture(),rows=await f.reader.list(orgId,principal.userId);expect(rows).toEqual([expect.objectContaining({modelId:'formal',available:true,modelProvider:'private-route',runtimeModelId:'runtime',reason:null})]);
 expect(JSON.stringify(rows)).not.toContain('internal-account-group');expect(rows[0]?.configRevision).toMatch(/^[a-f0-9]{64}$/);
 expect((await f.reader.resolve(orgId,'formal',principal.userId))?.privateConnectionId).toBe('internal-account-group');expect(f.model.complete).not.toHaveBeenCalled();
 expect(f.queries.some(sql=>/INSERT|UPDATE|DELETE|ai_budget_windows|ai_reservations/.test(sql))).toBe(false);
});
it.each(['no-deployment','revoked','wrong-provider','wrong-runtime','native','input-only','unsafe-output','unaccounted','no-private-group','caps','disabled','composite'] as const)('failed %s verification stays unavailable and cannot resolve',async mode=>{
 const entry=registration();
 const modified={...entry,...(mode==='revoked'?{verifyDeploymentBinding:async()=>false}:mode==='wrong-provider'?{binding:{...entry.binding,modelProvider:'different-provider'}}:mode==='native'?{billingUnit:'native' as const}:mode==='unsafe-output'?{binding:{...entry.binding,billedOutputBoundVerified:false}}:mode==='unaccounted'?{binding:{...entry.binding,accountingComplete:false}}:mode==='no-private-group'?{privateConnectionId:undefined}:{})};
 const prices=mode==='input-only'?[{billingMode:'input-only',modelId:'formal',modelProvider:'private-route',runtimeModelId:'runtime',inputMicrosPerMillion:'10',cachedInputMicrosPerMillion:'5',maxInputTokens:100}]:[{...price,...(mode==='wrong-runtime'?{runtimeModelId:'different-runtime'}:mode==='caps'?{maxInputTokens:1000}:{})}];
 const f=fixture({registration:modified,configuration:{...configuration,prices},enabledDeployment:mode!=='no-deployment',status:mode==='disabled'?'待测试':undefined,shape:mode==='composite'?'composite':undefined});
 const rows=await f.reader.list(orgId,principal.userId);expect(rows[0]?.available).toBe(false);expect(rows[0]?.reason).toBeTruthy();expect(await f.reader.resolve(orgId,'formal',principal.userId)).toBeNull();expect(f.model.complete).not.toHaveBeenCalled();
 if(mode==='no-deployment'||mode==='wrong-provider')expect(rows[0]).toMatchObject({modelProvider:null,runtimeModelId:null,configRevision:null});
});
it('ordinary member cannot list, but can revalidate their saved binding without an admin write privilege',async()=>{
 const f=fixture({role:'member'});await expect(f.reader.list(orgId,principal.userId)).rejects.toThrow('NOT_ORG_ADMIN');expect(await f.reader.resolve(orgId,'formal',principal.userId)).not.toBeNull();
});
it('non-formal organization and absent membership cannot grant a core binding',async()=>{
 const f=fixture({kind:'personal-local'});await expect(f.reader.list(orgId,principal.userId)).rejects.toThrow('ORGANIZATION_REQUIRED');
 const absent=new VerifiedOrgCoreModelAvailability({withTenant:async(_org,work)=>work({query:async()=>({rows:[]})}),withoutTenant:async()=>({} as never),close:async()=>{}},null,fixture().model);
 expect(await absent.resolve(orgId,'formal',principal.userId)).toBeNull();
});
it('public controller projects internal binding away and uses the principal organization for read/write/candidates',async()=>{
 const binding={modelId:'formal',modelProvider:'private-route',runtimeModelId:'runtime',configRevision:'v1',privateConnectionId:'private-never-public'},state={version:1,selection:binding,updatedBy:'admin',reason:'approved'};
 const identity={findOrgMembership:vi.fn(async()=>({orgRole:'admin'}))},repo={read:vi.fn(async()=>state),set:vi.fn(async()=>state)},candidateReader={list:vi.fn(async()=>[{modelId:'formal',displayName:'Actual Model',modelProvider:'private-route',runtimeModelId:'runtime',configRevision:'v1',available:true,reason:null}])};
 const controller=new OrgCoreModelController(identity as never,repo,candidateReader);
 const output=await controller.get(principal);expect(output.selection).not.toHaveProperty('privateConnectionId');expect(repo.read).toHaveBeenCalledWith(orgId);
 await controller.listCandidates(principal);expect(candidateReader.list).toHaveBeenCalledWith(orgId,'admin');
 await controller.set(principal,{expectedVersion:1,modelId:'formal',reason:'approved'});expect(repo.set).toHaveBeenCalledWith(orgId,{expectedVersion:1,modelId:'formal',reason:'approved',actorId:'admin'});
 await expect(controller.set(principal,{expectedVersion:1,modelId:'formal',reason:'approved',orgId:'foreign',privateConnectionId:'forged'} as never)).rejects.toMatchObject({status:400});expect(repo.set).toHaveBeenCalledOnce();
 identity.findOrgMembership.mockResolvedValue({orgRole:'member'});await expect(controller.get(principal)).rejects.toMatchObject({status:403});await expect(controller.listCandidates(principal)).rejects.toMatchObject({status:403});await expect(controller.set(principal,{} as never)).rejects.toMatchObject({status:403});expect(repo.read).toHaveBeenCalledOnce();expect(repo.set).toHaveBeenCalledOnce();
});
it('controller translates optimistic version conflict without persisting a substitute model',async()=>{
 const repo={read:vi.fn(),set:vi.fn(async()=>{throw new OrgCoreModelError('VERSION_CHANGED');})},identity={findOrgMembership:async()=>({orgRole:'admin'})};
 const controller=new OrgCoreModelController(identity as never,repo,{list:async()=>[]});await expect(controller.set(principal,{expectedVersion:1,modelId:'formal',reason:'approved'})).rejects.toMatchObject({status:409});expect(repo.set).toHaveBeenCalledOnce();
});

it.each(["missing-purpose","pool-missing","binding-missing"] as const)("core purpose %s cannot borrow chat price to grant eligibility",async mode=>{const entry=registration();const f=fixture({requiredCapabilities:mode==="missing-purpose"?[]:["tools"],poolCapabilities:mode==="pool-missing"?["embedding"]:["tools"],registration:mode==="binding-missing"?{...entry,binding:{...entry.binding,capabilityTags:["embedding"]}}:entry});expect((await f.reader.list(orgId,principal.userId))[0]).toMatchObject({available:false,reason:"CORE_MODEL_CAPABILITY_UNVERIFIED"});expect(await f.reader.resolve(orgId,"formal",principal.userId)).toBeNull();});

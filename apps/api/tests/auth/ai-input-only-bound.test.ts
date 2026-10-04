import {it,expect,vi} from 'vitest';
import {createHash} from 'node:crypto';
import {Configuration,ModelPrice} from '@repo/contracts/ai-policy';
import {prepareInputOnlyAiAttempt,priceInputOnlyTokens,type VerifiedInputOnlyBinding} from '../../src/domain/agent-run/ai-input-only-attempt';
import {decideAiAdmission} from '../../src/domain/agent-run/ai-budget';
import {VerifiedInputOnlyBoundRegistry,type InputOnlyModelBoundRegistration} from '../../src/application/agent-run/verified-input-only-bound-registry';
const policy={billingMode:'input-only' as const,modelId:'formal',modelProvider:'route',runtimeModelId:'physical',inputMicrosPerMillion:'1000000',cachedInputMicrosPerMillion:'2000000',maxInputTokens:20};
const binding:VerifiedInputOnlyBinding={billingMode:'input-only',modelId:'formal',modelProvider:'route',runtimeModelId:'physical',contextWindow:100,capabilityTags:['embedding'],noBilledOutputVerified:true,accountingComplete:true};
const registration=():InputOnlyModelBoundRegistration=>({binding:{...binding,capabilityTags:[...binding.capabilityTags]},requestPath:'/v1/embeddings',implementation:'fixture-only',version:'1',artifactSha256:'a'.repeat(64),source:'verified-upper-bound',verifyDeploymentBinding:async()=>true,measureSerializedBody:async()=>12});
const request={modelProvider:'route',modelId:'physical',requestPath:'/v1/embeddings',serializedBody:JSON.stringify({model:'physical',input:['one','two'],dimensions:2})};
const digest=createHash('sha256').update(request.serializedBody).digest('hex');
function input(){return {configuration:Configuration.parse({window:{start:'2026-10-01T00:00:00Z',end:'2026-11-01T00:00:00Z',timezone:'Etc/UTC'},ordinaryTokensPerUser:'12',costMicrosPerUser:'24',currency:'CNY',prices:[policy],fallbackModelIds:[],maxAttempts:1}),priceVersion:'immutable',primaryModelId:'formal',attempt:0,confidentiality:'non-confidential' as const,requiredCapabilities:['embedding'],pool:[{modelId:'formal',kind:'closed-api' as const,shape:'single' as const,status:'已启用' as const,complianceAttrs:[],members:[],contextWindow:100,capabilityTags:['embedding']}],bindings:[binding],measuredInput:{billingMode:'input-only' as const,modelProvider:'route',runtimeModelId:'physical',tokens:12,implementation:'fixture-only',version:'1',source:'verified-upper-bound' as const,serializedBodySha256:digest},serializedBodySha256:digest};}
it('preserves old chat parse result and rejects output fields in explicit input-only price',()=>{
 const {billingMode:_,...base}=policy,chat={...base,outputMicrosPerMillion:'1',maxOutputTokens:5};expect(ModelPrice.parse(chat)).toEqual(chat);expect(ModelPrice.parse(policy)).toEqual(policy);
 for(const extra of [{maxOutputTokens:0},{maxOutputTokens:1},{outputMicrosPerMillion:'0'},{outputTokenLimit:1}])expect(ModelPrice.safeParse({...policy,...extra}).success).toBe(false);
});
it('measures exact batch including token arrays instead of estimating by array length',async()=>{
 const measure=vi.fn(async()=>12),registry=new VerifiedInputOnlyBoundRegistry([{...registration(),measureSerializedBody:measure}]);
 expect(await registry.formalModelId('route','physical')).toBe('formal');expect(await registry.measure(request)).toMatchObject({tokens:12,billingMode:'input-only',serializedBodySha256:digest});expect(measure).toHaveBeenCalledWith(request.serializedBody);
 const serializedBody=JSON.stringify({model:'physical',input:[[1,2],[3,4,5]]});expect(await registry.measure({...request,serializedBody})).toMatchObject({tokens:12});expect(measure).toHaveBeenLastCalledWith(serializedBody);
});
it('rejects wrong paths/models, chat shapes and malformed batch before measuring',async()=>{
 const measure=vi.fn(async()=>12),registry=new VerifiedInputOnlyBoundRegistry([{...registration(),measureSerializedBody:measure}]);
 for(const body of [{model:'physical',input:[]},{model:'physical',input:['','ok']},{model:'physical',input:[[1,-1]]},{model:'physical',input:['one',1]},{model:'wrong',input:'ok'},{model:'physical',input:'ok',max_tokens:1},{model:'physical',input:'ok',messages:[]},{model:'physical',input:'ok',tools:[]}])expect(await registry.measure({...request,serializedBody:JSON.stringify(body)})).toBeNull();
 expect(await registry.measure({...request,requestPath:'/v1/chat/completions'})).toBeNull();expect(measure).not.toHaveBeenCalled();
});
it('refuses absent/revoked billing proof and invalid measured bounds',async()=>{
 expect(await new VerifiedInputOnlyBoundRegistry([]).measure(request)).toBeNull();
 for(const entry of [{...registration(),verifyDeploymentBinding:async()=>false},{...registration(),binding:{...binding,noBilledOutputVerified:false}},{...registration(),binding:{...binding,accountingComplete:false}}])expect(await new VerifiedInputOnlyBoundRegistry([entry]).measure(request)).toBeNull();
 for(const count of [-1,1.1,Infinity,null])expect(await new VerifiedInputOnlyBoundRegistry([{...registration(),measureSerializedBody:async()=>count}]).measure(request)).toBeNull();
 expect(()=>new VerifiedInputOnlyBoundRegistry([registration(),registration()])).toThrow();expect(()=>new VerifiedInputOnlyBoundRegistry([{...registration(),artifactSha256:'guess'}])).toThrow();
});
it('freezes registration capability data and revalidates deployment on every use',async()=>{
 let valid=true;const entry=registration(),registry=new VerifiedInputOnlyBoundRegistry([{...entry,verifyDeploymentBinding:async()=>valid}]);
 (entry.binding.capabilityTags as string[]).push('unverified');const pool={listForOrg:async()=>[]};expect((await registry.currentCandidates(pool as never,'org')).bindings[0]?.capabilityTags).toEqual(['embedding']);
 expect(await registry.measure(request)).not.toBeNull();valid=false;expect(await registry.measure(request)).toBeNull();await expect(registry.formalModelId('route','physical')).rejects.toThrow();
});
it('holds only maximum input Tokens and highest cache price against ordinary per-user budget',()=>{
 const result=prepareInputOnlyAiAttempt(input());expect(result).toMatchObject({decision:'allowed',maximumTokens:12n,maximumCostMicros:24n});expect(result).not.toHaveProperty('maxOutputTokens');if(result.decision!=='allowed')throw new Error('fixture denied');
 const state={plan:'ordinary' as const,tokenLimit:12n,costLimitMicros:24n,usedTokens:0n,heldTokens:0n,usedCostMicros:0n,heldCostMicros:0n};expect(decideAiAdmission(state,result.maximumTokens,result.maximumCostMicros)).toBe('allowed');expect(decideAiAdmission({...state,heldTokens:1n},result.maximumTokens,result.maximumCostMicros)).toBe('TOKEN_LIMIT_REACHED');
});
it('rejects unknown confidentiality, authorization/capability drift, hashes, wrong mode and bounds',()=>{
 const base=input();expect(prepareInputOnlyAiAttempt({...base,confidentiality:'unknown'}).decision).toBe('AI_CONFIDENTIALITY_UNKNOWN');expect(prepareInputOnlyAiAttempt({...base,confidentiality:'confidential'}).decision).toBe('AI_MODEL_UNAVAILABLE');
 expect(prepareInputOnlyAiAttempt({...base,requiredCapabilities:['missing']}).decision).toBe('AI_MODEL_CAPABILITY_UNVERIFIED');expect(prepareInputOnlyAiAttempt({...base,pool:[{...base.pool[0]!,capabilityTags:[]}]}).decision).toBe('AI_MODEL_CAPABILITY_UNVERIFIED');
 expect(prepareInputOnlyAiAttempt({...base,bindings:[{...binding,noBilledOutputVerified:false}]}).decision).toBe('AI_MODEL_CAPABILITY_UNVERIFIED');expect(prepareInputOnlyAiAttempt({...base,serializedBodySha256:'b'.repeat(64)}).decision).toBe('AI_INPUT_BOUND_UNVERIFIED');
 expect(prepareInputOnlyAiAttempt({...base,measuredInput:{...base.measuredInput,tokens:21}}).decision).toBe('AI_INPUT_LIMIT_REACHED');expect(prepareInputOnlyAiAttempt({...base,attempt:1}).decision).toBe('AI_ATTEMPTS_EXHAUSTED');
 const {billingMode:_,...price}=policy;expect(prepareInputOnlyAiAttempt({...base,configuration:{...base.configuration,prices:[{...price,maxOutputTokens:1,outputMicrosPerMillion:'0'}]}}).decision).toBe('AI_MODEL_UNAVAILABLE');
});
it('integer price preserves unknown cache differential and checks subset validity',()=>{
 const price={version:'v',currency:'CNY',inputMicrosPerMillion:1n,cachedInputMicrosPerMillion:2n};expect(priceInputOnlyTokens(price,{input:1n})).toBeNull();expect(priceInputOnlyTokens(price,{input:1n,cachedInput:0n})).toBe(1n);
 expect(priceInputOnlyTokens({...price,inputMicrosPerMillion:1000000n,cachedInputMicrosPerMillion:2000000n},{input:12n,cachedInput:4n})).toBe(16n);expect(()=>priceInputOnlyTokens(price,{input:1n,cachedInput:2n})).toThrow();
});
it('requires each ordered fallback to have its own verified binding and current pool eligibility',()=>{
 const base=input(),second={...policy,modelId:'fallback',runtimeModelId:'second'};
 const next={...base,attempt:1,configuration:{...base.configuration,prices:[policy,second],fallbackModelIds:['fallback'],maxAttempts:2},pool:[...base.pool,{...base.pool[0]!,modelId:'fallback'}],bindings:[binding,{...binding,modelId:'fallback',runtimeModelId:'second'}],measuredInput:{...base.measuredInput,runtimeModelId:'second'}};
 expect(prepareInputOnlyAiAttempt(next)).toMatchObject({decision:'allowed',modelId:'fallback',runtimeModelId:'second'});
 expect(prepareInputOnlyAiAttempt({...next,bindings:[binding]}).decision).toBe('AI_MODEL_CAPABILITY_UNVERIFIED');
 expect(prepareInputOnlyAiAttempt({...next,pool:[base.pool[0]!,{...base.pool[0]!,modelId:'fallback',status:'已停用' as never}]}).decision).toBe('AI_MODEL_UNAVAILABLE');
});
it('rejects unrepresentable hold and missing/mismatched measurement provenance',()=>{
 const base=input();expect(prepareInputOnlyAiAttempt({...base,measuredInput:null}).decision).toBe('AI_INPUT_BOUND_UNVERIFIED');
 expect(prepareInputOnlyAiAttempt({...base,measuredInput:{...base.measuredInput,modelProvider:'foreign'}}).decision).toBe('AI_INPUT_BOUND_UNVERIFIED');
 const huge={...base,configuration:{...base.configuration,prices:[{...policy,maxInputTokens:2147483647,inputMicrosPerMillion:'9223372036854775807'}]},pool:[{...base.pool[0]!,contextWindow:2147483647}],bindings:[{...binding,contextWindow:2147483647}],measuredInput:{...base.measuredInput,tokens:2147483647}};
 expect(prepareInputOnlyAiAttempt(huge).decision).toBe('AI_MAXIMUM_COST_UNREPRESENTABLE');
});

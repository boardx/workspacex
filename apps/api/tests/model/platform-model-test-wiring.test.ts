import {it,expect,vi} from "vitest";
import {createHash} from "node:crypto";
import {PlatformTestSpeechClient} from "../../src/infrastructure/model/platform-test-speech-client";
import {Configuration} from "@repo/contracts/ai-policy";
import {PlatformModelTestRequest, type PlatformModelTestRequest as Request} from "@repo/contracts/platform-model-test";
import {agentRuntime} from "@repo/contracts";
import {createPlatformModelTestWiring,type PlatformModelTestRegistration} from "../../src/infrastructure/model/platform-test-wiring";
import type {PlatformModelTestOperation} from "../../src/application/model/platform-model-test-ports";
import type {PgPlatformModelTestRepository} from "../../src/infrastructure/model/pg-platform-model-test-repository";
import type {DatabasePort} from "../../src/application/ports/database.port";
import type {AiReservationInput,AiBudgetPolicyPort} from "../../src/application/agent-run/ai-admission-ports";
const actor={orgId:"org-a",operatorUserId:"operator"};
const request=PlatformModelTestRequest.parse({orgId:"org-a",testId:"52f5c4f0-51a6-451b-ae38-e19a823f70ca",modelId:"formal",capability:"text",declaredNonConfidential:true,input:{prompt:"hello"},bounds:{maxOutputTokens:2,maximumCostMicros:"100000",timeoutMs:1000}});
const configuration=Configuration.parse({window:{timezone:"UTC",start:"2026-10-01T00:00:00.000Z",end:"2026-11-01T00:00:00.000Z"},ordinaryTokensPerUser:"100",costMicrosPerUser:"100000",currency:"CNY",prices:[{modelId:"formal",modelProvider:"trusted",runtimeModelId:"runtime",inputMicrosPerMillion:"1000000",outputMicrosPerMillion:"2000000",cachedInputMicrosPerMillion:"3000000",maxInputTokens:10,maxOutputTokens:4}],fallbackModelIds:[],maxAttempts:1});
const row=agentRuntime.ModelPoolRow.parse({modelId:"formal",status:"已启用",kind:"closed-api",shape:"single",vendor:"fixture",displayName:"Model",capabilityTags:[],contextWindow:100,unitPrice:0,complianceAttrs:[],members:[],credentialConfigured:true});
function fixture(){
 let operation:PlatformModelTestOperation|undefined;const records:unknown[]=[];let reservation:AiReservationInput|undefined;
 const repo={authorizeActor:vi.fn(async()=>{}),readUsageProjection:vi.fn(async()=>null),claim:async(_actor:unknown,input:Request)=>{if(operation)return {operation,claimed:false};operation={testId:input.testId,request:input,operatorUserId:"operator",state:"queued",settlementState:"held",result:null,failureReason:null};return {operation,claimed:true};},read:async()=>operation!,beginDispatch:async()=>{operation={...operation!,state:"dispatching"};return true;},terminal:async(_a:unknown,_id:string,terminal:object)=>{operation={...operation!,...terminal};},cancel:async()=>operation!} as unknown as PgPlatformModelTestRepository;
 const db={} as DatabasePort;const policy:AiBudgetPolicyPort={resolveBudgetPolicy:async()=>({decision:"configured" as const,plan:"ordinary" as const,configuration,priceVersion:"old-version"})};
 const vendor=vi.fn();const registration:PlatformModelTestRegistration={modelId:"formal",modelProvider:"trusted",runtimeModelId:"runtime",capability:"text",verifyDeploymentBinding:async()=>true,measureSerializedBody:async body=>({modelProvider:"trusted",runtimeModelId:"runtime",tokens:3,implementation:"fixture",version:"v1",source:"verified-upper-bound",serializedBodySha256:createHash("sha256").update(body).digest("hex")}),client:{prepare:input=>Object.freeze({physicalReceiptId:input.testId,serializedBody:JSON.stringify({model:"runtime",max_tokens:2,messages:[{role:"user",content:"hello"}]}),runtimeModelId:"runtime",capability:"text",bounds:{maximumCostMicros:input.bounds.maximumCostMicros,timeoutMs:1000,maxOutputTokens:2}}),invoke:async(prepared,hooks)=>{await hooks.beforeDispatch({...prepared,startedAt:new Date().toISOString()});vendor();await hooks.terminal({physicalReceiptId:prepared.physicalReceiptId,startedAt:new Date().toISOString(),endedAt:new Date().toISOString(),outcome:"succeeded",usage:{tokensTotal:4,inputTokens:3,outputTokens:1,cacheInputTokens:0,nativeUnit:null,nativeQuantity:null}});return {kind:"text",text:"result"};}}};
 const deps={db,repo,readPlan:async():Promise<"ordinary"|"enterprise"|null>=>"ordinary",readConfiguration:async()=>configuration,usage:{record:async(_org:unknown,event:unknown)=>{records.push(event);}},pool:{listForOrg:async()=>[{row,credentialConfigured:true}]},policyFactory:()=>policy,accountingFactory:(resolver:import("../../src/infrastructure/model/platform-test-accounting").PlatformTestReservationResolver)=>({reserve:async(op:PlatformModelTestOperation)=>{reservation=(await resolver.resolve(op,db)).reservation;},releaseUndispatched:async()=>{},settle:async()=>{},assertDispatch:async()=>{if(!reservation)throw Error("notreserved");}})};
 return {registration,deps,vendor,records,reservation:()=>reservation,policy};
}
it("trusted exact-body measurement reserves cache worst-case and records immutable actual usage",async()=>{
 const f=fixture();const {service}=createPlatformModelTestWiring({registrations:[f.registration]},f.deps);expect((await service.execute(actor,request)).state).toBe("succeeded");expect(f.reservation()!.maximumCostMicros).toBe(13n);expect(f.reservation()!.maximumTokens).toBe(5n);expect(f.records[0]).toMatchObject({runId:null,userId:"operator",modelProvider:"trusted",modelId:"runtime",tokensTotal:4,costMicros:5n,priceVersion:"old-version"});expect(f.vendor).toHaveBeenCalledTimes(1);
});
it("null config never dispatches and returns explicit unavailable candidates",async()=>{
 const f=fixture(),w=createPlatformModelTestWiring(null,f.deps);expect((await w.service.execute(actor,request)).failureReason).toBe("adapter-unavailable");expect((await w.reader.candidates(actor)).every(candidate=>!candidate.available)).toBe(true);expect(f.vendor).not.toHaveBeenCalled();
});
it("incorrect body fingerprint cannot reserve or dispatch",async()=>{
 const f=fixture();f.registration.measureSerializedBody=async()=>({modelProvider:"trusted",runtimeModelId:"runtime",tokens:3,implementation:"fixture",version:"v1",source:"verified-upper-bound",serializedBodySha256:"wrong"});expect((await createPlatformModelTestWiring({registrations:[f.registration]},f.deps).service.execute(actor,request)).failureReason).toBe("admission-refused");expect(f.vendor).not.toHaveBeenCalled();
});
it("unverified binding never grants available status",async()=>{
 const f=fixture();f.registration.verifyDeploymentBinding=async()=>false;const w=createPlatformModelTestWiring({registrations:[f.registration]},f.deps);expect((await w.reader.candidates(actor)).every(candidate=>!candidate.available)).toBe(true);expect((await w.service.execute(actor,request)).failureReason).toBe("adapter-unavailable");expect(f.vendor).not.toHaveBeenCalled();
});
it("maximum actual tariff bound cannot exceed caller ceiling",async()=>{
 const f=fixture();await createPlatformModelTestWiring({registrations:[f.registration]},f.deps).service.execute(actor,PlatformModelTestRequest.parse({...request,bounds:{...request.bounds,maximumCostMicros:"1"}}));expect(f.vendor).not.toHaveBeenCalled();
});
it("speech stays unavailable when no matching native character tariff exists",async()=>{
 const f=fixture();const speech={...f.registration,capability:"text-to-speech" as const};const w=createPlatformModelTestWiring({registrations:[speech]},f.deps);expect((await w.reader.candidates(actor)).filter(c=>c.capability==="text-to-speech").every(c=>!c.available)).toBe(true);
});
it("unknown usage dimensions never become free price or reported zero",async()=>{
 const f=fixture();f.registration.client.invoke=async(prepared,hooks)=>{await hooks.beforeDispatch({...prepared,startedAt:new Date().toISOString()});await hooks.terminal({physicalReceiptId:prepared.physicalReceiptId,startedAt:new Date().toISOString(),endedAt:new Date().toISOString(),outcome:"succeeded",usage:{tokensTotal:null,inputTokens:null,outputTokens:null,nativeUnit:null,nativeQuantity:null}});return {kind:"text",text:"result"};};
 await createPlatformModelTestWiring({registrations:[f.registration]},f.deps).service.execute(actor,request);expect(f.records[0]).toMatchObject({totalSource:"unknown",promptTokens:null,completionTokens:null});expect(f.records[0]).not.toHaveProperty("costMicros");expect(f.records[0]).not.toHaveProperty("currency");expect(f.records[0]).not.toHaveProperty("priceVersion");
});
it("terminal uses frozen admitted tariff even if current configuration changes",async()=>{
 const f=fixture(),original=f.registration.client.invoke;
 f.registration.client.invoke=async(...args)=>{f.policy.resolveBudgetPolicy=async()=>({decision:"configured",plan:"ordinary",configuration:{...configuration,prices:configuration.prices.map(p=>({...p,inputMicrosPerMillion:"999999999"}))},priceVersion:"new-version"});return original(...args);};
 await createPlatformModelTestWiring({registrations:[f.registration]},f.deps).service.execute(actor,request);expect(f.records[0]).toMatchObject({priceVersion:"old-version",costMicros:5n});
});
it("an altered prepared body is rejected by the immediate dispatch hook",async()=>{
 const f=fixture();f.registration.client.invoke=async(prepared,hooks)=>{await hooks.beforeDispatch({...prepared,serializedBody:"{}",startedAt:new Date().toISOString()});f.vendor();return {kind:"text",text:"invalid"};};
 const result=await createPlatformModelTestWiring({registrations:[f.registration]},f.deps).service.execute(actor,request);expect(result.state).toBe("unknown");expect(f.vendor).not.toHaveBeenCalled();
});

it("candidate GET reads audited config without resolving or creating budget windows",async()=>{
 const f=fixture();f.policy.resolveBudgetPolicy=vi.fn(async()=>{throw Error("GET must not write policy windows");});
 const candidates=await createPlatformModelTestWiring({registrations:[f.registration]},f.deps).reader.candidates(actor);
 expect(candidates.find(candidate=>candidate.capability==="text")?.available).toBe(true);expect(f.policy.resolveBudgetPolicy).not.toHaveBeenCalled();
});
it("image reserves only the audited native image dimension and records reported image cost",async()=>{
 const f=fixture();const image=PlatformModelTestRequest.parse({...request,capability:"image-generation",bounds:{maximumCostMicros:"100000",maximumQuantity:"2",timeoutMs:1000}});
 f.policy.resolveBudgetPolicy=async()=>({decision:"configured",plan:"ordinary",priceVersion:"image-price",configuration:{...configuration,nativePrices:[{modelId:"formal",modelProvider:"trusted",runtimeModelId:"runtime",unit:"image",quantum:"1",microsPerQuantum:"7",maxQuantity:"4"}]}});
 const registration:PlatformModelTestRegistration={...f.registration,capability:"image-generation",client:{prepare:input=>({physicalReceiptId:input.testId,serializedBody:JSON.stringify({model:"runtime",n:2}),runtimeModelId:"runtime",capability:"image-generation",bounds:{maximumCostMicros:input.bounds.maximumCostMicros,timeoutMs:1000,maximumQuantity:"2"}}),invoke:async(prepared,hooks)=>{await hooks.beforeDispatch({...prepared,startedAt:new Date().toISOString()});await hooks.terminal({physicalReceiptId:prepared.physicalReceiptId,startedAt:new Date().toISOString(),endedAt:new Date().toISOString(),outcome:"succeeded",usage:{tokensTotal:null,inputTokens:null,outputTokens:null,nativeUnit:"image",nativeQuantity:1n}});return {kind:"image",assets:[{url:"https://fixture.test/image.png",mimeType:"image/png"}]};}}};
 await createPlatformModelTestWiring({registrations:[registration]},f.deps).service.execute(actor,image);
 expect(f.reservation()).toMatchObject({maximumTokens:0n,maximumCostMicros:14n,nativePolicy:{unit:"image",maximumQuantity:2n}});expect(f.records[0]).toMatchObject({runId:null,totalSource:"not-applicable",costMicros:7n,nativeUsage:{unit:"image",quantity:1n,source:"reported"}});
});

it("unauthorized candidate actor causes zero pool or configuration reads",async()=>{
 const f=fixture();f.deps.repo.authorizeActor=async()=>{throw Error("forbidden");};
 f.deps.readPlan=vi.fn(async()=>"ordinary" as const);f.deps.pool.listForOrg=vi.fn(async()=>[{row,credentialConfigured:true}]);f.deps.readConfiguration=vi.fn(async()=>configuration);
 await expect(createPlatformModelTestWiring({registrations:[f.registration]},f.deps).reader.candidates(actor)).rejects.toThrow("forbidden");
 expect(f.deps.pool.listForOrg).not.toHaveBeenCalled();expect(f.deps.readConfiguration).not.toHaveBeenCalled();expect(f.deps.readPlan).not.toHaveBeenCalled();
});
it("TTS reserves audited characters only; reported character usage has no fake Tokens",async()=>{
 const f=fixture();const speech=PlatformModelTestRequest.parse({...request,capability:"text-to-speech",input:{text:"hi",voice:"fixed"},bounds:{maximumCostMicros:"100000",maximumQuantity:"3",timeoutMs:1000}});
 f.policy.resolveBudgetPolicy=async()=>({decision:"configured",plan:"ordinary",priceVersion:"speech-price",configuration:{...configuration,nativePrices:[{modelId:"formal",modelProvider:"trusted",runtimeModelId:"runtime",unit:"character",quantum:"1",microsPerQuantum:"7",maxQuantity:"4"}]}});
 const registration:PlatformModelTestRegistration={...f.registration,capability:"text-to-speech",client:{prepare:input=>({physicalReceiptId:input.testId,serializedBody:JSON.stringify({model:"runtime",text:"hi"}),runtimeModelId:"runtime",capability:"text-to-speech",bounds:{maximumCostMicros:input.bounds.maximumCostMicros,timeoutMs:1000,maximumQuantity:"3"}}),invoke:async(prepared,hooks)=>{await hooks.beforeDispatch({...prepared,startedAt:new Date().toISOString()});await hooks.terminal({physicalReceiptId:prepared.physicalReceiptId,startedAt:new Date().toISOString(),endedAt:new Date().toISOString(),outcome:"succeeded",usage:{tokensTotal:null,inputTokens:null,outputTokens:null,nativeUnit:"character",nativeQuantity:2n}});return {kind:"audio",asset:{url:"https://fixture.test/audio.wav",mimeType:"audio/wav"},durationMs:null};}}};
 await createPlatformModelTestWiring({registrations:[registration]},f.deps).service.execute(actor,speech);
 expect(f.reservation()).toMatchObject({maximumTokens:0n,maximumCostMicros:21n,nativePolicy:{unit:"character",maximumQuantity:3n}});expect(f.records[0]).toMatchObject({totalSource:"not-applicable",callPurpose:"primary",costMicros:14n,nativeUsage:{unit:"character",quantity:2n,source:"reported"}});
});
function asrFixture(reported:bigint|null=1000n){
 const f=fixture();f.deps.readPlan=async()=>"enterprise";const input=PlatformModelTestRequest.parse({...request,capability:"speech-to-text",input:{audioBase64:"AAAA",sampleRateHz:16000,channels:1,format:"pcm16"},bounds:{maximumCostMicros:"100000",maximumQuantity:"2000",timeoutMs:1000}});
 f.policy.resolveBudgetPolicy=async()=>({decision:"configured",plan:"enterprise",priceVersion:"asr-price",configuration:{...configuration,nativePrices:[{modelId:"formal",modelProvider:"trusted",runtimeModelId:"qwen3-asr-flash",unit:"millisecond",quantum:"1000",microsPerQuantum:"7",maxQuantity:"60000"}]}});
 const registration:PlatformModelTestRegistration={...f.registration,runtimeModelId:"qwen3-asr-flash",capability:"speech-to-text",client:{prepare:req=>({physicalReceiptId:req.testId,serializedBody:JSON.stringify({model:"qwen3-asr-flash",audio:"inline-fixed-PCM"}),runtimeModelId:"qwen3-asr-flash",capability:"speech-to-text",bounds:{maximumCostMicros:req.bounds.maximumCostMicros,timeoutMs:1000,maximumQuantity:"2000"}}),invoke:async(prepared,hooks)=>{await hooks.beforeDispatch({...prepared,startedAt:new Date().toISOString()});f.vendor();await hooks.terminal({physicalReceiptId:prepared.physicalReceiptId,startedAt:new Date().toISOString(),endedAt:new Date().toISOString(),outcome:"succeeded",usage:{tokensTotal:null,inputTokens:null,outputTokens:5,nativeUnit:"millisecond",nativeQuantity:reported}});return {kind:"text",text:"transcription"};}}};
 return {...f,input,registration};
}
it("ASR reserves audited milliseconds and only reported native quantity sets its actual cost",async()=>{
 const f=asrFixture();await createPlatformModelTestWiring({registrations:[f.registration]},f.deps).service.execute(actor,f.input);
 expect(f.reservation()).toMatchObject({maximumTokens:0n,maximumCostMicros:14n,nativePolicy:{unit:"millisecond",maximumQuantity:2000n}});
 expect(f.records[0]).toMatchObject({totalSource:"not-applicable",promptTokens:null,completionTokens:5,callPurpose:"native-asr",costMicros:7n,nativeUsage:{unit:"millisecond",quantity:1000n,source:"reported"}});
});
it("ASR missing native usage retains unknown cost and no fake reported Token total",async()=>{
 const f=asrFixture(null);await createPlatformModelTestWiring({registrations:[f.registration]},f.deps).service.execute(actor,f.input);
 expect(f.records[0]).toMatchObject({totalSource:"not-applicable",nativeUsage:{unit:"millisecond",quantity:null,source:"unknown"}});expect(f.records[0]).not.toHaveProperty("costMicros");expect(f.records[0]).not.toHaveProperty("currency");expect(f.records[0]).not.toHaveProperty("priceVersion");
});
it("ASR operator without formal membership cannot create or meter a call",async()=>{
 const f=asrFixture();f.deps.repo.claim=async()=>{throw Error("TEST_FORBIDDEN");};await expect(createPlatformModelTestWiring({registrations:[f.registration]},f.deps).service.execute(actor,f.input)).rejects.toThrow("TEST_FORBIDDEN");expect(f.vendor).not.toHaveBeenCalled();expect(f.records).toEqual([]);
});
it("ASR native upper bound exceeding audited quantity cannot dispatch",async()=>{
 const f=asrFixture();f.policy.resolveBudgetPolicy=async()=>({decision:"configured",plan:"enterprise",priceVersion:"asr-price",configuration:{...configuration,nativePrices:[{modelId:"formal",modelProvider:"trusted",runtimeModelId:"qwen3-asr-flash",unit:"millisecond",quantum:"1000",microsPerQuantum:"7",maxQuantity:"1000"}]}});
 expect((await createPlatformModelTestWiring({registrations:[f.registration]},f.deps).service.execute(actor,f.input)).failureReason).toBe("admission-refused");expect(f.vendor).not.toHaveBeenCalled();
});

it("legally shaped TTS request with unregistered voice ends failed instead of queued; replay has zero HTTP",async()=>{
 const f=fixture();const input=PlatformModelTestRequest.parse({...request,capability:"text-to-speech",input:{text:"hello",voice:"unregistered-voice"},bounds:{maximumCostMicros:"100000",maximumQuantity:"10",timeoutMs:1000}});
 const client=new PlatformTestSpeechClient({endpoint:"https://fixture.test/tts",apiKey:"fixture-secret",runtimeModelId:"qwen3-tts-flash",protocol:"qwen-tts-character",allowedVoices:["fixed-voice"],maximumCharacters:600n,maximumUtf8Bytes:100000,timeoutMs:1000});
 const registration:PlatformModelTestRegistration={...f.registration,runtimeModelId:"qwen3-tts-flash",capability:"text-to-speech",client:{prepare:req=>{if(req.capability!=="text-to-speech")throw Error("wrong capability");return client.prepare(req);},invoke:(...args)=>client.invoke(...args)}};
 const w=createPlatformModelTestWiring({registrations:[registration]},f.deps);expect((await w.service.execute(actor,input)).failureReason).toBe("adapter-unavailable");expect((await w.service.execute(actor,input)).state).toBe("failed");expect(f.vendor).not.toHaveBeenCalled();expect(f.records).toEqual([]);expect(f.reservation()).toBeUndefined();
});

it("ordinary ASR has explicit unavailable reason and zero reservation or vendor effects",async()=>{
 const f=asrFixture();f.deps.readPlan=async()=>"ordinary";
 const w=createPlatformModelTestWiring({registrations:[f.registration]},f.deps);
 expect((await w.reader.candidates(actor)).find(c=>c.capability==="speech-to-text")).toMatchObject({available:false,reason:"native-asr-token-bound-unverified"});
 expect((await w.service.execute(actor,f.input)).failureReason).toBe("admission-refused");expect(f.reservation()).toBeUndefined();expect(f.vendor).not.toHaveBeenCalled();
});
it("unconfigured ASR organization cannot dispatch",async()=>{
 const f=asrFixture();f.deps.readPlan=async()=>null;
 expect((await createPlatformModelTestWiring({registrations:[f.registration]},f.deps).service.execute(actor,f.input)).failureReason).toBe("admission-refused");expect(f.vendor).not.toHaveBeenCalled();
});

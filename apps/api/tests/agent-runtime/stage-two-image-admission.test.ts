import {afterEach,describe,it,expect,vi} from "vitest";
import {createServer} from "node:http";
import type {AddressInfo} from "node:net";
import {createHash} from "node:crypto";
import {prepareImageAiAdmission,type VerifiedImageAdmission} from "../../src/infrastructure/agent-run/image-ai-admission";
import {BailianImageProvider} from "../../src/infrastructure/agent-run/bailian-image-provider";
import {OpenAiImageProvider} from "../../src/infrastructure/agent-run/openai-image-provider";
import type {ImageContext} from "../../src/application/agent-run/standard-image-tools";
import type {OrgId} from "../../src/domain/org-id";
const context:ImageContext={orgId:"org-a" as OrgId,parentRunId:"run-a",attemptId:"attempt-a",leaseEpoch:1,bindingId:"binding",toolCallId:"call"};
function fixture(overrides:Partial<VerifiedImageAdmission>={},decision="allowed",replay=false){
 const order:string[]=[],reserve=vi.fn(async(..._args:Parameters<import("../../src/application/agent-run/ai-admission-ports").AiAdmissionPort["reserve"]>)=>{order.push("reserve");return {decision:decision as "allowed",replay};}),settle=vi.fn(async(..._args:Parameters<import("../../src/application/agent-run/ai-admission-ports").AiAdmissionPort["settle"]>)=>{});
 const startRequest=vi.fn(async(..._args:Parameters<NonNullable<import("../../src/application/agent-run/ports").TokenUsageMeterPort["startRequest"]>>)=>{order.push("start");}),record=vi.fn(async(..._args:Parameters<import("../../src/application/agent-run/ports").TokenUsageMeterPort["record"]>)=>{});
 const admission=prepareImageAiAdmission({admission:{reserve,settle},usage:{startRequest,record},resolve:async(c,r)=>({
  orgId:c.orgId,userId:"user-a",runId:c.parentRunId,sourceRunId:c.parentRunId,subtaskId:null,executionAttemptId:c.attemptId,executionLeaseEpoch:c.leaseEpoch,
  projectId:null,threadId:null,agentId:null,formalModelId:"formal-image",logicalCallId:c.toolCallId,
  windowStart:"2026-10-01T00:00:00Z",windowEnd:"2026-11-01T00:00:00Z",modelProvider:r.modelProvider,modelId:r.modelId,
  serializedBodySha256:createHash("sha256").update(r.serializedBody).digest("hex"),maximumQuantity:1n,
  price:{unit:"image",quantum:1n,microsPerQuantum:500n,currency:"CNY",version:"audited-price-1"},tokenBilling:"not-applicable",bindingVerified:true,...overrides})});
 return {admission,reserve,settle,startRequest,record,order};
}
const bailianConfig={apiKey:"test-no-vendor-key",modelId:"wanx2.1-t2i-plus",baseUrl:"https://mock.invalid",pollIntervalMs:1,timeoutMs:1000};
const openaiConfig={apiKey:"test-no-vendor-key",modelId:"verified-native-model",baseUrl:"https://mock.invalid",timeoutMs:1000,organization:null,project:null};
afterEach(()=>{vi.unstubAllGlobals();vi.restoreAllMocks();});
describe("stage two native image transport admission",()=>{
 it("child image call retains root ledger attribution and explicit subtask",async()=>{
  const f=fixture({runId:"authoritative-root",sourceRunId:context.parentRunId,subtaskId:context.parentRunId});
  const receipt=await f.admission.start(context,{requestId:"child-physical",modelProvider:"vendor",modelId:"runtime",serializedBody:"{}",quantity:1n});
  expect(f.startRequest.mock.calls[0]?.[1]).toMatchObject({runId:"authoritative-root",subtaskId:context.parentRunId});
  await receipt.terminal({endedAt:new Date(Date.now()+1000).toISOString(),outcome:"succeeded",quantity:1n});
  expect(f.record.mock.calls[0]?.[1]).toMatchObject({runId:"authoritative-root",subtaskId:context.parentRunId});
 });
 it.each([{runId:"wrong-root"},{subtaskId:"foreign-child"},{runId:"other-root",subtaskId:"other-child"}])("refuses inconsistent root/child attribution before reservation %s",async override=>{
  const f=fixture(override);
  await expect(f.admission.start(context,{requestId:"inconsistent",modelProvider:"vendor",modelId:"runtime",serializedBody:"{}",quantity:1n})).rejects.toThrow("AI_IMAGE_BOUND_UNVERIFIED");
  expect(f.reserve).not.toHaveBeenCalled();
 });
 it("foreign source run cannot reserve an image",async()=>{
  const f=fixture({sourceRunId:"foreign-source"});
  await expect(f.admission.start(context,{requestId:"foreign",modelProvider:"vendor",modelId:"runtime",serializedBody:"{}",quantity:1n})).rejects.toThrow("AI_IMAGE_BOUND_UNVERIFIED");
  expect(f.reserve).not.toHaveBeenCalled();expect(f.startRequest).not.toHaveBeenCalled();
 });
 it("reserves and durably starts before async submit, polls once, records supplier image count without Tokens",async()=>{
  const f=fixture(),fetcher=vi.fn(async(_url:unknown,opts?:RequestInit)=>{f.order.push(opts?.method==="POST"?"submit":"poll");return Response.json(opts?.method==="POST"?{output:{task_id:"task_1"}}:{output:{task_status:"SUCCEEDED",results:[{url:"https://image.invalid/result.png"}]},usage:{image_count:1}});});
  vi.stubGlobal("fetch",fetcher);
  const result=await new BailianImageProvider(bailianConfig,f.admission,true).generateImage("cat",undefined,context);
  expect(result.delivery).toBe("url");expect(f.order).toEqual(["reserve","start","submit","poll"]);
  expect(f.reserve.mock.calls[0]?.[1]).toMatchObject({maximumTokens:0n,maximumCostMicros:500n,userId:"user-a",priceVersion:"audited-price-1"});
  expect(f.record.mock.calls[0]?.[1]).toMatchObject({tokensTotal:0,totalSource:"not-applicable",nativeUsage:{unit:"image",quantity:1n,source:"reported"},costMicros:500n,outcome:"succeeded"});
  expect(f.settle.mock.calls[0]?.[2]).toEqual({tokens:0n,costMicros:500n});expect(fetcher).toHaveBeenCalledTimes(2);
 });
 it.each(["COST_LIMIT_REACHED","TOKEN_LIMIT_REACHED"])("refuses %s before any supplier HTTP",async decision=>{
  const f=fixture({},decision),fetcher=vi.fn();vi.stubGlobal("fetch",fetcher);
  await expect(new BailianImageProvider(bailianConfig,f.admission,true).generateImage("cat",undefined,context)).rejects.toThrow();
  expect(fetcher).not.toHaveBeenCalled();expect(f.startRequest).not.toHaveBeenCalled();
 });
 it.each([{orgId:"foreign" as OrgId},{executionLeaseEpoch:2},{serializedBodySha256:"forged"},{tokenBilling:"token" as never},{bindingVerified:false as never},{maximumQuantity:0n}])("rejects unverified identity or tariff before HTTP",async override=>{
  const f=fixture(override),fetcher=vi.fn();vi.stubGlobal("fetch",fetcher);
  await expect(new BailianImageProvider(bailianConfig,f.admission,true).generateImage("cat",undefined,context)).rejects.toThrow();
  expect(fetcher).not.toHaveBeenCalled();expect(f.reserve).not.toHaveBeenCalled();
 });
 it("rejects reservation replay without another supplier request",async()=>{
  const f=fixture({},"allowed",true),fetcher=vi.fn();vi.stubGlobal("fetch",fetcher);
  await expect(new BailianImageProvider(bailianConfig,f.admission,true).generateImage("cat",undefined,context)).rejects.toThrow();
  expect(fetcher).not.toHaveBeenCalled();expect(f.startRequest).not.toHaveBeenCalled();
 });
 it("keeps missing supplier usage unknown and holds the full monetary reservation",async()=>{
  const f=fixture();vi.stubGlobal("fetch",vi.fn(async(_url:unknown,opts?:RequestInit)=>Response.json(opts?.method==="POST"?{output:{task_id:"task_1"}}:{output:{task_status:"SUCCEEDED",results:[{url:"https://image.invalid/result.png"}]}})));
  await new BailianImageProvider(bailianConfig,f.admission,true).generateImage("cat",undefined,context);
  expect(f.record.mock.calls[0]?.[1]).toMatchObject({nativeUsage:{unit:"image",quantity:null,source:"unknown"}});
  expect(f.record.mock.calls[0]?.[1]).not.toHaveProperty("costMicros");expect(f.settle.mock.calls[0]?.[2]).toEqual({tokens:0n,costMicros:null});
 });
 it("cancel after submission never retries or invents zero supplier cost",async()=>{
  const f=fixture(),abort=new AbortController(),fetcher=vi.fn(async()=>{abort.abort();return Response.json({output:{task_id:"task_1"}});});vi.stubGlobal("fetch",fetcher);
  await expect(new BailianImageProvider(bailianConfig,f.admission,true).generateImage("cat",abort.signal,context)).rejects.toThrow();
  expect(fetcher).toHaveBeenCalledTimes(1);expect(f.record.mock.calls[0]?.[1]).toMatchObject({outcome:"failed",nativeUsage:{quantity:null}});expect(f.settle.mock.calls[0]?.[2]).toEqual({tokens:0n,costMicros:null});
 });
 it("terminal failure blocks another dispatch in this instance",async()=>{
  const f=fixture();f.record.mockRejectedValue(new Error("ledger offline"));const fetcher=vi.fn(async(_url:unknown,opts?:RequestInit)=>Response.json(opts?.method==="POST"?{output:{task_id:"task_1"}}:{output:{task_status:"SUCCEEDED",results:[{url:"https://image.invalid/result.png"}]},usage:{image_count:1}}));vi.stubGlobal("fetch",fetcher);
  const provider=new BailianImageProvider(bailianConfig,f.admission,true);await provider.generateImage("cat",undefined,context);
  await expect(provider.generateImage("cat",undefined,context)).rejects.toThrow();expect(fetcher).toHaveBeenCalledTimes(2);expect(f.settle).not.toHaveBeenCalled();
 });
 it("OpenAI optional native-only adapter is called before the synchronous HTTP boundary",async()=>{
  const f=fixture(),fetcher=vi.fn(async()=>{f.order.push("http");return Response.json({created:1,data:[{b64_json:Buffer.from("fixture-image").toString("base64")}],usage:{image_count:1}});});vi.stubGlobal("fetch",fetcher);
  await new OpenAiImageProvider(openaiConfig,undefined,true,f.admission).generateImage("cat",undefined,context);
  expect(f.order).toEqual(["reserve","start","http"]);expect(f.record.mock.calls[0]?.[1]).toMatchObject({nativeUsage:{unit:"image",quantity:1n},totalSource:"not-applicable"});
 });
 it("quota-enabled providers without trusted native configuration refuse before HTTP",async()=>{
  const fetcher=vi.fn();vi.stubGlobal("fetch",fetcher);
  await expect(new OpenAiImageProvider(openaiConfig,undefined,true).generateImage("cat",undefined,context)).rejects.toThrow();
  await expect(new BailianImageProvider(bailianConfig,undefined,true).generateImage("cat",undefined,context)).rejects.toThrow();expect(fetcher).not.toHaveBeenCalled();
 });
 it("real loopback submit and poll pass through native reserve/start before HTTP",async()=>{
  const f=fixture(),requests:string[]=[],server=createServer((req,res)=>{
   requests.push(req.method!);f.order.push(req.method==="POST"?"submit":"poll");
   res.setHeader("content-type","application/json");res.end(JSON.stringify(req.method==="POST"?{output:{task_id:"loopback_task"}}:{output:{task_status:"SUCCEEDED",results:[{url:"https://image.invalid/loopback.png"}]},usage:{image_count:1}}));
  });
  await new Promise<void>((resolve,reject)=>{server.once("error",reject);server.listen(0,"127.0.0.1",resolve);});
  try {
   await new BailianImageProvider({...bailianConfig,baseUrl:`http://127.0.0.1:${(server.address() as AddressInfo).port}`},f.admission,true).generateImage("cat",undefined,context);
   expect(f.order).toEqual(["reserve","start","submit","poll"]);expect(requests).toEqual(["POST","GET"]);
   expect(f.record.mock.calls[0]?.[1].nativeUsage).toEqual({unit:"image",quantity:1n,source:"reported"});
  } finally {server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}
 });
 it("known quantity above bound is metered and settled before marking the binding violation",async()=>{
  const f=fixture(),receipt=await f.admission.start(context,{requestId:"request-1",modelProvider:"bailian-image",modelId:"model",serializedBody:"body",quantity:1n});
  await expect(receipt.terminal({endedAt:new Date().toISOString(),outcome:"succeeded",quantity:2n})).rejects.toThrow("AI_IMAGE_PROVIDER_BOUND_VIOLATED");
  expect(f.record.mock.calls[0]?.[1]).toMatchObject({nativeUsage:{quantity:2n,source:"reported"},costMicros:1000n});expect(f.settle.mock.calls[0]?.[2]).toEqual({tokens:0n,costMicros:1000n});
 });
 it("terminal write retry only replays accounting and never starts or dispatches again",async()=>{
  const f=fixture(),receipt=await f.admission.start(context,{requestId:"request-1",modelProvider:"bailian-image",modelId:"model",serializedBody:"body",quantity:1n});
  const terminal={endedAt:new Date().toISOString(),outcome:"succeeded" as const,quantity:1n};f.settle.mockRejectedValueOnce(new Error("temporary ledger outage"));
  await expect(receipt.terminal(terminal)).rejects.toThrow("temporary ledger outage");await receipt.terminal(terminal);
  expect(f.reserve).toHaveBeenCalledTimes(1);expect(f.startRequest).toHaveBeenCalledTimes(1);expect(f.record).toHaveBeenCalledTimes(2);expect(f.settle).toHaveBeenCalledTimes(2);
  await expect(receipt.terminal({...terminal,quantity:0n})).rejects.toThrow("AI_IMAGE_TERMINAL_REPLAY_MISMATCH");
 });
 it("rejects a terminal timestamp preceding the durable start",async()=>{
  const f=fixture(),receipt=await f.admission.start(context,{requestId:"request-1",modelProvider:"bailian-image",modelId:"model",serializedBody:"body",quantity:1n});
  await expect(receipt.terminal({endedAt:"2000-01-01T00:00:00Z",outcome:"failed",quantity:null})).rejects.toThrow("AI_IMAGE_TERMINAL_TIME_INVALID");expect(f.record).not.toHaveBeenCalled();
 });

 it("OpenAI mixed Token tariff is refused before synchronous dispatch",async()=>{
  const f=fixture({tokenBilling:"token-and-image" as never}),fetcher=vi.fn();vi.stubGlobal("fetch",fetcher);
  await expect(new OpenAiImageProvider(openaiConfig,undefined,true,f.admission).generateImage("cat",undefined,context)).rejects.toThrow();expect(fetcher).not.toHaveBeenCalled();
 });
 it("supplier bound violation records actual count and blocks the next async submit",async()=>{
  const f=fixture(),fetcher=vi.fn(async(_url:unknown,opts?:RequestInit)=>Response.json(opts?.method==="POST"?{output:{task_id:"task_1"}}:{output:{task_status:"SUCCEEDED",results:[{url:"https://image.invalid/result.png"}]},usage:{image_count:2}}));vi.stubGlobal("fetch",fetcher);
  const provider=new BailianImageProvider(bailianConfig,f.admission,true);await provider.generateImage("cat",undefined,context);
  expect(f.record.mock.calls[0]?.[1]).toMatchObject({nativeUsage:{quantity:2n},costMicros:1000n});
  await expect(provider.generateImage("cat",undefined,context)).rejects.toThrow();expect(fetcher).toHaveBeenCalledTimes(2);
 });
 it("pre-cancelled request makes no hold or supplier call",async()=>{
  const f=fixture(),fetcher=vi.fn(),abort=new AbortController();abort.abort();vi.stubGlobal("fetch",fetcher);
  await expect(new BailianImageProvider(bailianConfig,f.admission,true).generateImage("cat",abort.signal,context)).rejects.toThrow();expect(f.reserve).not.toHaveBeenCalled();expect(fetcher).not.toHaveBeenCalled();
 });
 it("legacy agent complete without trusted ImageContext refuses when quota is enabled",async()=>{
  const f=fixture(),fetcher=vi.fn();vi.stubGlobal("fetch",fetcher);
  await expect(new BailianImageProvider(bailianConfig,f.admission,true).complete({modelProvider:"bailian-image",user:"cat"} as never)).rejects.toThrow();expect(fetcher).not.toHaveBeenCalled();expect(f.reserve).not.toHaveBeenCalled();
 });

 it("failed durable start prevents either async submission or settlement",async()=>{
  const f=fixture(),fetcher=vi.fn();f.startRequest.mockRejectedValueOnce(new Error("durable start unavailable"));vi.stubGlobal("fetch",fetcher);
  await expect(new BailianImageProvider(bailianConfig,f.admission,true).generateImage("cat",undefined,context)).rejects.toThrow();expect(fetcher).not.toHaveBeenCalled();expect(f.record).not.toHaveBeenCalled();expect(f.settle).not.toHaveBeenCalled();
 });
 it("missing audited native price refuses before reserve and HTTP",async()=>{
  const f=fixture(),admission=prepareImageAiAdmission({admission:{reserve:f.reserve,settle:f.settle},usage:{startRequest:f.startRequest,record:f.record},resolve:async()=>null}),fetcher=vi.fn();vi.stubGlobal("fetch",fetcher);
  await expect(new BailianImageProvider(bailianConfig,admission,true).generateImage("cat",undefined,context)).rejects.toThrow();expect(f.reserve).not.toHaveBeenCalled();expect(fetcher).not.toHaveBeenCalled();
 });
 it("OpenAI missing native usage retains the conservative image cost hold",async()=>{
  const f=fixture();vi.stubGlobal("fetch",vi.fn(async()=>Response.json({created:1,data:[{b64_json:Buffer.from("fixture-image").toString("base64")}]})));
  await new OpenAiImageProvider(openaiConfig,undefined,true,f.admission).generateImage("cat",undefined,context);
  expect(f.record.mock.calls[0]?.[1]).toMatchObject({nativeUsage:{quantity:null,source:"unknown"}});expect(f.settle.mock.calls[0]?.[2]).toEqual({tokens:0n,costMicros:null});
 });
 it("OpenAI body cancellation leaves one durable start and unknown cost without retry",async()=>{
  const f=fixture(),abort=new AbortController(),fetcher=vi.fn(async()=>{
   const stream=new ReadableStream({start(){queueMicrotask(()=>abort.abort());}});
   return new Response(stream,{headers:{"content-type":"application/json"}});
  });vi.stubGlobal("fetch",fetcher);
  await expect(new OpenAiImageProvider(openaiConfig,undefined,true,f.admission).generateImage("cat",abort.signal,context)).rejects.toThrow();
  expect(f.startRequest).toHaveBeenCalledTimes(1);expect(fetcher).toHaveBeenCalledTimes(1);expect(f.settle.mock.calls[0]?.[2]).toEqual({tokens:0n,costMicros:null});
 });

});

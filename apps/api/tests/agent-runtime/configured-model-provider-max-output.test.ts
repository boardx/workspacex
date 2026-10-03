import {pricedRunModel} from "../../src/application/agent-run/priced-run-model";
import {withRunLease} from "../../src/application/agent-run/run-lease";
import {meterModelCompletion} from "../../src/application/agent-run/meter-model-completion";
import {executeQueuedRuns} from "../../src/application/agent-run/execute-run";
import type {AgentRunStore,ClaimedAgentRun} from "../../src/application/agent-run/ports";
import {createHash} from "node:crypto";
import {preparePricedModelCall} from "../../src/application/agent-run/admit-priced-model-call";
import {toOrgId} from "../../src/domain/org-id";
/**
 * 迭代 12（design-delta `paged-generation-and-doc-export` §1.3）—— V43。
 *
 * 在这次改动之前，本仓**一处也没有**设置过输出上限：用的是 provider 默认值，
 * 于是"天花板在哪"既没设定也没观测，撞上了才知道（表现是输出被截断、JSON 解析失败、
 * 而上层只能反推）。这里加的是一个运维开关 `KERNEL_MODEL_MAX_OUTPUT_TOKENS`。
 *
 * 两条都必要：
 *   ① 设了 ⇒ 请求体带 `max_tokens`；
 *   ② **不设 ⇒ 请求体一个字都不多**——如果这里填一个我们自己编的默认值，
 *      所有既有部署的行为都会在无人察觉的情况下改变。②只测"能设"是测不出来的。
 *
 * 同时钉住 `finish_reason: "length"` 一路带回端口的 `truncated`——它是
 * `MODEL_OUTPUT_TRUNCATED` 这个闭集成员的唯一真实来源。
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { ConfiguredModelProvider, readModelProviderConfig } from "../../src/infrastructure/agent-run/configured-model-provider";

const PROVIDER = "iter12-loopback";
let server: Server;
let base = "";
let lastBody: Record<string, unknown> | null = null;
let finishReason = "stop";
let responseStatus = 200;

beforeAll(async () => {
  server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      lastBody = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      res.writeHead(responseStatus, { "content-type": "application/json" });
      res.end(JSON.stringify({ choices: [{ message: { content: "hi" }, finish_reason: finishReason }] }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterEach(() => { lastBody = null; finishReason = "stop"; responseStatus = 200; });
afterAll(async () => { await new Promise<void>((resolve) => server.close(() => resolve())); });

const provider = (maxOutputTokens?: number) =>
  new ConfiguredModelProvider({
    provider: PROVIDER, baseUrl: base, apiKey: "sk-iter12", timeoutMs: 5_000, streamEnabled: false,
    visionModelIds: new Set<string>(), thinkingDisableModelIds: new Set<string>(), bailianExtensionsEnabled: false,
    ...(maxOutputTokens === undefined ? {} : { maxOutputTokens }),
  });

describe("V43 KERNEL_MODEL_MAX_OUTPUT_TOKENS", () => {
  it("① 设了 ⇒ 请求体带 max_tokens", async () => {
    await provider(2048).complete({ modelProvider: PROVIDER, modelId: "m", system: "s", user: "u" });
    expect(lastBody?.max_tokens).toBe(2048);
  });

  it("② 不设 ⇒ 请求体**不含** max_tokens（既有部署的行为逐字不变）", async () => {
    await provider().complete({ modelProvider: PROVIDER, modelId: "m", system: "s", user: "u" });
    // ⭐ 反证锚点：在实现里给它填一个硬编码默认值，这条立刻红。
    expect(lastBody).not.toHaveProperty("max_tokens");
  });

  it("环境变量读法：非法/零/负数一律当作没设，不是当作 0", () => {
    const read = (v: string | undefined) =>
      readModelProviderConfig({ KERNEL_MODEL_PROVIDER: "p", KERNEL_MODEL_BASE_URL: base, KERNEL_MODEL_API_KEY: "k", ...(v === undefined ? {} : { KERNEL_MODEL_MAX_OUTPUT_TOKENS: v }) } as NodeJS.ProcessEnv);
    expect(read("4096").maxOutputTokens).toBe(4096);
    expect(read(undefined).maxOutputTokens).toBeUndefined();
    for (const bad of ["", "0", "-1", "abc"]) expect(read(bad).maxOutputTokens).toBeUndefined();
  });

  it("finish_reason: length ⇒ 端口的 truncated 为 true；stop ⇒ 缺席（不是 false）", async () => {
    finishReason = "length";
    const cut = await provider().complete({ modelProvider: PROVIDER, modelId: "m", system: "s", user: "u" });
    expect(cut.truncated).toBe(true);
    finishReason = "stop";
    const ok = await provider().complete({ modelProvider: PROVIDER, modelId: "m", system: "s", user: "u" });
    // 缺席 = "provider 没报告"，与"报告了没截断"是两件事；调用方按 `=== true` 判。
    expect(ok).not.toHaveProperty("truncated");
  });
});

describe("trusted per-request dispatch admission",()=>{
 it("uses the smaller explicit/deployment ceiling in the exact admitted body",async()=>{
  let requestId="";
  await provider(100).complete({modelProvider:PROVIDER,modelId:"m",system:"s",user:"u",outputTokenLimit:200,
   beforeProviderDispatch:async request=>{expect(lastBody).toBeNull();expect(request.outputTokenLimit).toBe(100);expect(JSON.parse(request.serializedBody).max_tokens).toBe(100);requestId=request.requestId;},
   onProviderRequest:async event=>{expect(event.requestId).toBe(requestId);}});
  expect(lastBody?.max_tokens).toBe(100);
  lastBody=null;await provider().complete({modelProvider:PROVIDER,modelId:"m",system:"s",user:"u",outputTokenLimit:50});expect((lastBody as Record<string,unknown>|null)?.max_tokens).toBe(50);
 });
 it("rejects invalid caps and admission denial without HTTP or retryable transport wrapping",async()=>{
  for(const outputTokenLimit of [0,-1,1.5,Infinity,2147483648]){
   await expect(provider().complete({modelProvider:PROVIDER,modelId:"m",system:"s",user:"u",outputTokenLimit})).rejects.toThrow("INVALID_AI_OUTPUT_LIMIT");expect(lastBody).toBeNull();
  }
  const denied=new Error("AI_QUOTA_DENIED");
  await expect(provider().complete({modelProvider:PROVIDER,modelId:"m",system:"s",user:"u",beforeProviderDispatch:async()=>{throw denied;}})).rejects.toBe(denied);
  expect(lastBody).toBeNull();
 });
});

describe("priced admission through actual HTTP adapter",()=>{
 it("actual auxiliary summary/script paths enter the same coordinator and discard legacy outer observers",async()=>{
  const {subject,deps}=setup();const run={runId:subject.runId,requesterUserId:subject.userId,projectId:null,threadId:"thread",agentId:"agent",modelProvider:PROVIDER,modelId:"formal",permissionRequestId:undefined} as unknown as ClaimedAgentRun;
  const verify=vi.fn(async()=>{}),selection=vi.fn(async()=>{});
  const model=pricedRunModel(deps.model,subject.orgId,run,{primaryModelId:async()=>"formal",facts:async()=>({confidentiality:"non-confidential",requiredCapabilities:[]}),dependencies:()=>deps,selection});
  await withRunLease({orgId:subject.orgId,runId:run.runId,epoch:1,verify},async()=>{
   for(const purpose of ["history-summary","script-retry"] as const){
    await meterModelCompletion({usage:deps.usage,log:()=>{}},subject.orgId,run,purpose,(onProviderRequest,context)=>model.complete({...context,onProviderRequest,modelProvider:PROVIDER,modelId:"formal",system:"s",user:"u"}),model);
   }
  });
  expect(deps.admission.reserve).toHaveBeenCalledTimes(2);expect(deps.usage.startRequest).toHaveBeenCalledTimes(2);expect(deps.usage.record).toHaveBeenCalledTimes(2);
  expect(deps.usage.record.mock.calls.map(call=>(call as unknown as [unknown,{callPurpose:string}])[1].callPurpose)).toEqual(["history-summary","script-retry"]);
  expect(selection).toHaveBeenCalledTimes(2);expect(verify.mock.calls.length).toBeGreaterThanOrEqual(6);
 });
 it("claimed executor primary dispatch uses trusted subject, coordinator and one sole ledger receipt",async()=>{
  const {subject,deps}=setup();
  const run:ClaimedAgentRun={runId:subject.runId,threadId:"thread",projectId:null,inputMessageId:"message",inputText:"test normal answer",requesterUserId:subject.userId,inputAttachments:[],agentId:"agent",agentVersionId:"version",instructions:"answer",skillVersionIds:[],modelProvider:PROVIDER,modelId:"formal",pendingDecision:null,leaseEpoch:1,runtimeProfile:"legacy"};
  const output=vi.fn(async()=>{}),failed=vi.fn(async()=>{});
  const runs={claimQueued:async()=>[{kind:"executable",run}],heartbeatRun:async()=>{},readPinnedSkills:async()=>[],readModelDeltas:async()=>[],readThreadHistory:async()=>[],readThreadContextState:async()=>null,appendStep:async()=>{},appendModelDelta:async()=>{},appendExecutionEvent:async()=>{},storeOutputAwaitingWriteback:output,failRun:failed} as unknown as AgentRunStore;
  const selection=vi.fn(async()=>{}),logs:unknown[]=[];
  await executeQueuedRuns({runs,model:deps.model,usage:deps.usage,clock:{now:()=>new Date().toISOString(),newStepId:()=>"step"},log:(...args)=>logs.push(args),nativeRuntimeEnabled:false,
   aiAdmission:{primaryModelId:async()=>"formal",facts:async()=>({confidentiality:"non-confidential",requiredCapabilities:[]}),dependencies:()=>deps,selection}}, {orgId:subject.orgId});
  expect(failed,JSON.stringify(logs)).not.toHaveBeenCalled();expect(output).toHaveBeenCalledOnce();expect(lastBody?.model).toBe("m");
  expect(deps.admission.reserve).toHaveBeenCalledOnce();expect(deps.usage.record).toHaveBeenCalledOnce();expect(selection).toHaveBeenCalledOnce();
  expect(deps.usage.record.mock.calls[0]).toEqual([subject.orgId,expect.objectContaining({userId:subject.userId,runId:subject.runId,callPurpose:"primary",modelId:"m"})]);
 });
 const setup=()=>{
  const configuration={window:{start:"2026-10-01T00:00:00Z",end:"2026-11-01T00:00:00Z",timezone:"Etc/UTC"},ordinaryTokensPerUser:"1000",costMicrosPerUser:"1000",currency:"CNY",
   prices:[{modelId:"formal",modelProvider:PROVIDER,runtimeModelId:"m",inputMicrosPerMillion:"1000000",outputMicrosPerMillion:"2000000",cachedInputMicrosPerMillion:"500000",maxInputTokens:10,maxOutputTokens:20}],fallbackModelIds:[],maxAttempts:1};
  const policy={resolveBudgetPolicy:vi.fn().mockResolvedValue({decision:"configured",plan:"ordinary",configuration,priceVersion:"immutable-v1"})};
  const admission={reserve:vi.fn().mockResolvedValue({decision:"allowed",replay:false}),settle:vi.fn().mockResolvedValue(undefined)};
  const usage={startRequest:vi.fn().mockResolvedValue(undefined),record:vi.fn().mockResolvedValue(undefined)};
  const currentCandidates=vi.fn().mockResolvedValue({pool:[{modelId:"formal",kind:"closed-api",shape:"single",status:"已启用",complianceAttrs:[],members:[],contextWindow:100,capabilityTags:[]}],bindings:[{modelId:"formal",modelProvider:PROVIDER,runtimeModelId:"m",capabilityTags:[],contextWindow:100,maxOutputTokens:20,outputCapSupported:true,billedOutputBoundVerified:true,accountingComplete:true}]});
  const measure=vi.fn(async(request:{serializedBody:string})=>{expect(JSON.parse(request.serializedBody).messages).toHaveLength(2);return {modelProvider:PROVIDER,runtimeModelId:"m",tokens:2,implementation:"fixture-only-verified-bound",version:"1",serializedBodySha256:createHash("sha256").update(request.serializedBody).digest("hex"),source:"verified-upper-bound" as const};});
  const subject={orgId:toOrgId("org-5261"),userId:"member",runId:"run",executionAttemptId:"attempt",projectId:null,threadId:null,agentId:null,callPurpose:"primary" as const,primaryModelId:"formal",logicalCallId:"trusted-logical-call",attempt:0,confidentiality:"non-confidential" as const,requiredCapabilities:[]};
  return {subject,deps:{model:provider(),policy,admission,usage,currentCandidates,measure}};
 };
 it("reserves before transport and writes one unknown-cost receipt retaining its hold",async()=>{
  const {subject,deps}=setup();deps.admission.reserve.mockImplementation(async()=>{expect(lastBody).toBeNull();return {decision:"allowed",replay:false};});
  const bound=await preparePricedModelCall(subject,deps);const result=await provider().complete({...bound,system:"s",user:"u"});expect(result.text).toBe("hi");
  expect(deps.admission.reserve).toHaveBeenCalledOnce();expect(deps.admission.reserve.mock.calls[0]).toEqual([subject.orgId,expect.objectContaining({maximumTokens:22n,maximumCostMicros:42n,modelId:"m",priceVersion:"immutable-v1"})]);
  expect(deps.usage.record).toHaveBeenCalledOnce();expect(deps.usage.record.mock.calls[0]).toEqual([subject.orgId,expect.objectContaining({totalSource:"unknown",userId:"member",runId:"run"})]);
  expect(deps.admission.settle).toHaveBeenCalledWith(subject.orgId,expect.any(String),{tokens:null,costMicros:null});
 });
 it("quota denial and reservation replay dispatch zero requests",async()=>{
  for(const response of [{decision:"TOKEN_LIMIT_REACHED",replay:false},{decision:"allowed",replay:true}]){
   const {subject,deps}=setup();deps.admission.reserve.mockResolvedValue(response);
   const bound=await preparePricedModelCall(subject,deps);await expect(provider().complete({...bound,system:"s",user:"u"})).rejects.toThrow(response.replay?"AI_REQUEST_REPLAY_NO_DISPATCH":"TOKEN_LIMIT_REACHED");
   expect(lastBody).toBeNull();expect(deps.usage.startRequest).not.toHaveBeenCalled();expect(deps.usage.record).not.toHaveBeenCalled();
  }
 });
 it("ledger failure preserves paid response and never releases hold or repeats HTTP",async()=>{
  const {subject,deps}=setup();deps.usage.record.mockRejectedValue(new Error("ledger down"));
  const bound=await preparePricedModelCall(subject,deps);expect((await provider().complete({...bound,system:"s",user:"u"})).text).toBe("hi");
  expect(deps.usage.startRequest).toHaveBeenCalledOnce();expect(deps.usage.record).toHaveBeenCalledOnce();expect(deps.admission.settle).not.toHaveBeenCalled();
 });
});

// Known terminal pricing is exercised directly with immutable subject/price snapshot;
// this does not claim provider-side tokenization or a deployed runtime composition.
describe("priced terminal receipt snapshot",()=>{
 it("uses reported cache subset exactly once, then settles only after the sole ledger write",async()=>{
  const orgId=toOrgId("org-price");const order:string[]=[];
  const configuration={window:{start:"2026-10-01T00:00:00Z",end:"2026-11-01T00:00:00Z",timezone:"Etc/UTC"},ordinaryTokensPerUser:"1000",costMicrosPerUser:"1000",currency:"CNY",prices:[{modelId:"formal",modelProvider:PROVIDER,runtimeModelId:"m",inputMicrosPerMillion:"1000000",outputMicrosPerMillion:"2000000",cachedInputMicrosPerMillion:"500000",maxInputTokens:10,maxOutputTokens:20}],fallbackModelIds:[],maxAttempts:1};
  const record=vi.fn(async(..._args:unknown[])=>{order.push("ledger");});const settle=vi.fn(async()=>{order.push("settle");});
  const binding={modelId:"formal",modelProvider:PROVIDER,runtimeModelId:"m",capabilityTags:[],contextWindow:100,maxOutputTokens:20,outputCapSupported:true,billedOutputBoundVerified:true,accountingComplete:true};
  const bound=await preparePricedModelCall({orgId,userId:"u",runId:"r",executionAttemptId:"a",projectId:null,threadId:null,agentId:null,callPurpose:"script-retry",primaryModelId:"formal",logicalCallId:"trusted-logical-call",attempt:0,confidentiality:"non-confidential",requiredCapabilities:[]},{model:provider(),policy:{resolveBudgetPolicy:async()=>({decision:"configured",plan:"ordinary",configuration,priceVersion:"old-v1"})},admission:{reserve:async()=>({decision:"allowed",replay:false}),settle},usage:{startRequest:async()=>{},record},currentCandidates:async()=>({pool:[{modelId:"formal",kind:"closed-api",shape:"single",status:"已启用",complianceAttrs:[],members:[],contextWindow:100,capabilityTags:[]}],bindings:[binding]}),measure:async(request)=>({modelProvider:PROVIDER,runtimeModelId:"m",tokens:2,implementation:"fixture",version:"1",serializedBodySha256:createHash("sha256").update(request.serializedBody).digest("hex"),source:"provider-count"})});
  await bound.beforeProviderDispatch!({requestId:"receipt",modelProvider:PROVIDER,modelId:"m",serializedBody:"fixture transient body",outputTokenLimit:20});
  const startedAt="2026-10-04T00:00:00Z";await bound.onProviderRequest!({phase:"started",requestId:"receipt",startedAt});
  await bound.onProviderRequest!({phase:"terminal",requestId:"receipt",startedAt,endedAt:"2026-10-04T00:00:01Z",outcome:"failed",usage:{total:5,prompt:2,completion:3,cacheInput:1,reasoningOutput:2}});
  expect(record.mock.calls[0]).toEqual([orgId,expect.objectContaining({eventId:"receipt",costMicros:8n,currency:"CNY",priceVersion:"old-v1",tokensTotal:5,callPurpose:"script-retry",outcome:"failed"})]);
  expect(settle).toHaveBeenCalledWith(orgId,"receipt",{tokens:5n,costMicros:8n});expect(order).toEqual(["ledger","settle"]);
 });
});

describe("trusted HTTP fallback classification",()=>{
 it("only explicit 429/503 are retry dispositions; auth and ordinary errors are not",async()=>{
  for(const [status,retryDisposition] of [[429,"rate-limited"],[503,"temporarily-unavailable"],[401,undefined],[400,undefined],[500,undefined]] as const){
   responseStatus=status;await expect(provider().complete({modelProvider:PROVIDER,modelId:"m",system:"s",user:"u"})).rejects.toMatchObject({code:"MODEL_CALL_FAILED",retryDisposition});
  }
 });
});

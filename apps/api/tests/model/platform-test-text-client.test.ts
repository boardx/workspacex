import {randomUUID} from "node:crypto";
import {afterEach,it,expect,vi} from "vitest";
import type {PlatformModelTestRequest} from "@repo/contracts/platform-model-test";
import {PlatformTestTextClient,type PlatformTestTextConfig} from "../../src/infrastructure/model/platform-test-text-client";
import type {PlatformTestClientHooks} from "../../src/infrastructure/model/platform-test-vector-client";
const config:PlatformTestTextConfig={endpoint:"https://trusted.invalid/v1/chat/completions",apiKey:"server-fixture-secret",runtimeModelId:"trusted-runtime",timeoutMs:1000,outputCapKey:"max_tokens",maximumOutputTokens:32,temperature:0,systemPrompt:"Trusted system"};
const request=():Extract<PlatformModelTestRequest,{capability:"text"}>=>({testId:randomUUID(),orgId:"trusted-org",modelId:"formal-model",declaredNonConfidential:true,capability:"text",input:{prompt:"hello"},bounds:{maximumCostMicros:"100",timeoutMs:1000,maxOutputTokens:8}});
const hooks=()=>({beforeDispatch:vi.fn(async(_call:Parameters<PlatformTestClientHooks["beforeDispatch"]>[0])=>{}),terminal:vi.fn(async(_event:Parameters<PlatformTestClientHooks["terminal"]>[0])=>{})});
afterEach(()=>{vi.unstubAllGlobals();vi.restoreAllMocks();});
it.each(["max_tokens","max_completion_tokens"] as const)("verified %s cap and prepared messages are sent unchanged after admission",async outputCapKey=>{
 const client=new PlatformTestTextClient({...config,outputCapKey}),prepared=client.prepare(request()),callbacks=hooks(),order:string[]=[];callbacks.beforeDispatch.mockImplementation(async()=>{order.push("admit");});
 const fetcher=vi.fn(async(_url:unknown,options?:RequestInit)=>{order.push("HTTP");expect(options?.body).toBe(prepared.serializedBody);expect(options?.headers).toMatchObject({authorization:"Bearer server-fixture-secret"});return Response.json({choices:[{message:{content:"answer"}}],usage:{total_tokens:9,prompt_tokens:6,completion_tokens:3,prompt_tokens_details:{cached_tokens:2},completion_tokens_details:{reasoning_tokens:1}}});});vi.stubGlobal("fetch",fetcher);
 const body=JSON.parse(prepared.serializedBody);expect(body[outputCapKey]).toBe(8);expect(body[outputCapKey==="max_tokens"?"max_completion_tokens":"max_tokens"]).toBeUndefined();expect(body.messages).toEqual([{role:"system",content:"Trusted system"},{role:"user",content:"hello"}]);
 expect(await client.invoke(prepared,callbacks)).toEqual({kind:"text",text:"answer"});expect(order).toEqual(["admit","HTTP"]);expect(callbacks.terminal.mock.calls[0]?.[0].usage).toMatchObject({tokensTotal:9,inputTokens:6,outputTokens:3,cacheInputTokens:2,reasoningOutputTokens:1});
 await expect(client.invoke(prepared,callbacks)).rejects.toThrow("PLATFORM_TEST_REPLAY_NO_DISPATCH");expect(fetcher).toHaveBeenCalledTimes(1);
});
it("missing usage remains unknown even when text is present",async()=>{
 const client=new PlatformTestTextClient(config),callbacks=hooks();vi.stubGlobal("fetch",vi.fn(async()=>Response.json({choices:[{message:{content:"answer"}}]})));
 await client.invoke(client.prepare(request()),callbacks);expect(callbacks.terminal.mock.calls[0]?.[0].usage).toMatchObject({tokensTotal:null,inputTokens:null,outputTokens:null});
});
it("unverified or larger output caps refuse before any HTTP",()=>{
 const client=new PlatformTestTextClient(config),input=request();input.bounds.maxOutputTokens=33;expect(()=>client.prepare(input)).toThrow("PLATFORM_TEST_REQUEST_INVALID");expect(()=>new PlatformTestTextClient({...config,outputCapKey:"guessed-cap" as never})).toThrow("PLATFORM_TEST_ADAPTER_UNAVAILABLE");
});
it("admission refusal prevents HTTP and terminal callback",async()=>{
 const client=new PlatformTestTextClient(config),callbacks=hooks(),fetcher=vi.fn();callbacks.beforeDispatch.mockRejectedValue(new Error("quota denied"));vi.stubGlobal("fetch",fetcher);
 await expect(client.invoke(client.prepare(request()),callbacks)).rejects.toThrow("quota denied");expect(fetcher).not.toHaveBeenCalled();expect(callbacks.terminal).not.toHaveBeenCalled();
});
it("provider failures preserve reported usage while sanitizing raw vendor errors",async()=>{
 const client=new PlatformTestTextClient(config),callbacks=hooks(),fetcher=vi.fn(async()=>Response.json({error:{message:"raw fixture-secret"},usage:{total_tokens:4,prompt_tokens:4}},{status:400}));vi.stubGlobal("fetch",fetcher);
 await expect(client.invoke(client.prepare(request()),callbacks)).rejects.toThrow("PLATFORM_TEST_PROVIDER_UNCONFIRMED");expect(callbacks.terminal.mock.calls[0]?.[0]).toMatchObject({outcome:"failed",usage:{tokensTotal:4,inputTokens:4,outputTokens:null}});expect(fetcher).toHaveBeenCalledTimes(1);
});
it("response cancellation records unknown usage and never retries",async()=>{
 const client=new PlatformTestTextClient(config),callbacks=hooks(),abort=new AbortController(),fetcher=vi.fn(async()=>new Response(new ReadableStream({start(){queueMicrotask(()=>abort.abort());}})));vi.stubGlobal("fetch",fetcher);
 await expect(client.invoke(client.prepare(request()),callbacks,abort.signal)).rejects.toThrow("PLATFORM_TEST_PROVIDER_UNCONFIRMED");expect(fetcher).toHaveBeenCalledTimes(1);expect(callbacks.terminal.mock.calls[0]?.[0]).toMatchObject({outcome:"failed",usage:{tokensTotal:null}});
});
it("oversized output fails but retains supplier-reported usage",async()=>{
 const client=new PlatformTestTextClient(config),callbacks=hooks();vi.stubGlobal("fetch",vi.fn(async()=>Response.json({choices:[{message:{content:"x".repeat(65537)}}],usage:{total_tokens:9}})));
 await expect(client.invoke(client.prepare(request()),callbacks)).rejects.toThrow("PLATFORM_TEST_PROVIDER_UNCONFIRMED");expect(callbacks.terminal.mock.calls[0]?.[0]).toMatchObject({outcome:"failed",usage:{tokensTotal:9}});
});

import {randomUUID} from "node:crypto";
import {afterEach,it,expect,vi} from "vitest";
import {preparePlatformTestCall,PlatformTestVectorClient,type PlatformTestVectorConfig,type PlatformTestClientHooks} from "../../src/infrastructure/model/platform-test-vector-client";
import type {PlatformModelTestRequest} from "@repo/contracts/platform-model-test";
const config=(protocol:PlatformTestVectorConfig["protocol"]):PlatformTestVectorConfig=>({protocol,endpoint:"https://trusted.invalid/vector",apiKey:"server-only-fixture-secret",runtimeModelId:"trusted-runtime",timeoutMs:1000});
function request(capability:"embedding"|"rerank"):Extract<PlatformModelTestRequest,{capability:"embedding"|"rerank"}>{
 const base={testId:randomUUID(),orgId:"trusted-org",modelId:"formal-model",declaredNonConfidential:true as const,bounds:{maximumCostMicros:"100",timeoutMs:1000}};
 return capability==="embedding"?{...base,capability,input:{texts:["first","second"]}}:{...base,capability,input:{query:"query",documents:["first","second"]}};
}
const hooks=()=>({beforeDispatch:vi.fn(async(_call:Parameters<PlatformTestClientHooks["beforeDispatch"]>[0])=>{}),terminal:vi.fn(async(_event:Parameters<PlatformTestClientHooks["terminal"]>[0])=>{})});
afterEach(()=>{vi.unstubAllGlobals();vi.restoreAllMocks();});
it.each(["openai-embedding","dashscope-embedding"] as const)("%s prepares immutable bytes and sends the exact admitted request",async protocol=>{
 const client=new PlatformTestVectorClient(config(protocol)),input=request("embedding"),prepared=client.prepare(input),callbacks=hooks(),order:string[]=[];
 const fetcher=vi.fn(async(_url:unknown,options?:RequestInit)=>{order.push("HTTP");expect(options?.body).toBe(prepared.serializedBody);expect(_url).toBe("https://trusted.invalid/vector");return Response.json(protocol==="openai-embedding"?{data:[{index:1,embedding:[3,4]},{index:0,embedding:[1,2]}],usage:{total_tokens:7,prompt_tokens:7}}:{output:{embeddings:[{text_index:1,embedding:[3,4]},{text_index:0,embedding:[1,2]}]},usage:{total_tokens:7}});});
 callbacks.beforeDispatch.mockImplementation(async call=>{order.push("admit");expect(call.serializedBody).toBe(prepared.serializedBody);expect(call.physicalReceiptId).toBe(input.testId);});vi.stubGlobal("fetch",fetcher);
 expect(Object.isFrozen(prepared)).toBe(true);expect(Object.isFrozen(prepared.bounds)).toBe(true);
 input.input="texts" in input.input?{texts:["MUTATED"]}:input.input;
 const result=await client.invoke(prepared,callbacks);expect(result).toEqual({kind:"embedding",vectorCount:2,dimensions:2,preview:[1,2]});expect(order).toEqual(["admit","HTTP"]);
 expect(callbacks.terminal.mock.calls[0]?.[0]).toMatchObject({outcome:"succeeded",usage:{tokensTotal:7,inputTokens:protocol==="openai-embedding"?7:null,outputTokens:null}});expect(fetcher).toHaveBeenCalledTimes(1);
 await expect(client.invoke(prepared,callbacks)).rejects.toThrow("PLATFORM_TEST_REPLAY_NO_DISPATCH");expect(fetcher).toHaveBeenCalledTimes(1);
});
it.each(["dashscope-rerank","qwen3-rerank"] as const)("%s uses its explicit protocol and supplier-only totals",async protocol=>{
 const client=new PlatformTestVectorClient(config(protocol)),prepared=client.prepare(request("rerank")),callbacks=hooks();
 const body=JSON.parse(prepared.serializedBody);expect(protocol==="qwen3-rerank"?body.query:body.input.query).toBe("query");
 vi.stubGlobal("fetch",vi.fn(async()=>Response.json(protocol==="qwen3-rerank"?{results:[{index:1,relevance_score:0.8}],usage:{total_tokens:9}}:{output:{results:[{index:1,relevance_score:0.8}]},usage:{total_tokens:9}})));
 expect(await client.invoke(prepared,callbacks)).toEqual({kind:"rerank",results:[{index:1,score:0.8}]});expect(callbacks.terminal.mock.calls[0]?.[0].usage).toMatchObject({tokensTotal:9,inputTokens:null,outputTokens:null});
});
it("awaits the required predispatch hook before the paid request",async()=>{
 const client=new PlatformTestVectorClient(config("openai-embedding")),callbacks=hooks(),prepared=client.prepare(request("embedding"));let release!:()=>void;
 callbacks.beforeDispatch.mockImplementation(()=>new Promise<void>(resolve=>{release=resolve;}));const fetcher=vi.fn(async()=>Response.json({data:[{index:0,embedding:[1]},{index:1,embedding:[2]}]}));vi.stubGlobal("fetch",fetcher);
 const pending=client.invoke(prepared,callbacks);await Promise.resolve();expect(fetcher).not.toHaveBeenCalled();release();await pending;expect(fetcher).toHaveBeenCalledTimes(1);
 expect(callbacks.terminal.mock.calls[0]?.[0].usage).toMatchObject({tokensTotal:null,inputTokens:null,outputTokens:null});
});
it("refuses absent or rejected admission hooks without HTTP",async()=>{
 const client=new PlatformTestVectorClient(config("openai-embedding")),fetcher=vi.fn(),callbacks=hooks();vi.stubGlobal("fetch",fetcher);
 await expect(client.invoke(client.prepare(request("embedding")),undefined as never)).rejects.toThrow("PLATFORM_TEST_ACCOUNTING_UNAVAILABLE");
 callbacks.beforeDispatch.mockRejectedValue(new Error("BUDGET_REFUSED"));await expect(client.invoke(client.prepare(request("embedding")),callbacks)).rejects.toThrow("BUDGET_REFUSED");expect(fetcher).not.toHaveBeenCalled();expect(callbacks.terminal).not.toHaveBeenCalled();
});
it.each([{data:[{index:0,embedding:[1]},{index:0,embedding:[2]}]},{data:[{index:0,embedding:[1]},{index:1,embedding:[2,3]}]}])("malformed vectors fail while preserving reported billable usage",async result=>{
 const client=new PlatformTestVectorClient(config("openai-embedding")),callbacks=hooks();vi.stubGlobal("fetch",vi.fn(async()=>Response.json({...result,usage:{total_tokens:7}})));
 await expect(client.invoke(client.prepare(request("embedding")),callbacks)).rejects.toThrow("PLATFORM_TEST_PROVIDER_UNCONFIRMED");expect(callbacks.terminal.mock.calls[0]?.[0]).toMatchObject({outcome:"failed",usage:{tokensTotal:7}});
});
it("invalid rerank document indexes never become results",async()=>{
 const client=new PlatformTestVectorClient(config("dashscope-rerank")),callbacks=hooks();vi.stubGlobal("fetch",vi.fn(async()=>Response.json({output:{results:[{index:4,relevance_score:0.5}]}})));
 await expect(client.invoke(client.prepare(request("rerank")),callbacks)).rejects.toThrow("PLATFORM_TEST_PROVIDER_UNCONFIRMED");
});
it("transport failure is sanitized, unknown and never retried",async()=>{
 const client=new PlatformTestVectorClient(config("openai-embedding")),callbacks=hooks(),fetcher=vi.fn(async()=>{throw new Error("raw server-only-fixture-secret");});vi.stubGlobal("fetch",fetcher);
 await expect(client.invoke(client.prepare(request("embedding")),callbacks)).rejects.toThrow("PLATFORM_TEST_PROVIDER_UNCONFIRMED");expect(fetcher).toHaveBeenCalledTimes(1);expect(callbacks.terminal.mock.calls[0]?.[0]).toMatchObject({outcome:"failed",usage:{tokensTotal:null}});
});
it("terminal persistence failure surfaces and cannot authorize another paid request",async()=>{
 const client=new PlatformTestVectorClient(config("openai-embedding")),callbacks=hooks(),prepared=client.prepare(request("embedding")),fetcher=vi.fn(async()=>Response.json({data:[{index:0,embedding:[1]},{index:1,embedding:[2]}]}));vi.stubGlobal("fetch",fetcher);callbacks.terminal.mockRejectedValue(new Error("durable-terminal-unavailable"));
 await expect(client.invoke(prepared,callbacks)).rejects.toThrow("durable-terminal-unavailable");await expect(client.invoke(prepared,callbacks)).rejects.toThrow("PLATFORM_TEST_REPLAY_NO_DISPATCH");expect(fetcher).toHaveBeenCalledTimes(1);
});
it("pre-cancelled calls make no admission or HTTP",async()=>{
 const client=new PlatformTestVectorClient(config("openai-embedding")),callbacks=hooks(),abort=new AbortController(),fetcher=vi.fn();abort.abort();vi.stubGlobal("fetch",fetcher);
 await expect(client.invoke(client.prepare(request("embedding")),callbacks,abort.signal)).rejects.toThrow();expect(callbacks.beforeDispatch).not.toHaveBeenCalled();expect(fetcher).not.toHaveBeenCalled();
});
it("unsupported capability binding is explicit and does not dispatch",()=>{
 const client=new PlatformTestVectorClient(config("openai-embedding"));expect(()=>client.prepare(request("rerank"))).toThrow("PLATFORM_TEST_ADAPTER_UNAVAILABLE");expect(()=>new PlatformTestVectorClient({...config("openai-embedding"),endpoint:"http://public.invalid"})).toThrow("PLATFORM_TEST_BINDING_UNAVAILABLE");
});

it("speech recognition preparation accepts bounded audio bytes and rejects above the fixed 4 MiB limit",()=>{
 const input={...request("embedding"),capability:"speech-to-text"} as unknown as PlatformModelTestRequest;
 const limit=4*1024*1024,overhead=Buffer.byteLength(JSON.stringify({audio:""}));
 const exact={audio:"a".repeat(limit-overhead)};
 expect(Buffer.byteLength(preparePlatformTestCall(input,"trusted-runtime",exact,1000).serializedBody)).toBe(limit);
 expect(()=>preparePlatformTestCall(input,"trusted-runtime",{audio:exact.audio+"a"},1000)).toThrow("PLATFORM_TEST_REQUEST_TOO_LARGE");
});
it.each(["text","image-generation","embedding","rerank","text-to-speech"] as const)("%s retains the fixed 100000 byte limit despite a caller override",capability=>{
 const input={...request("embedding"),capability,bounds:{...request("embedding").bounds,maxBodyBytes:4*1024*1024}} as unknown as PlatformModelTestRequest;
 const overhead=Buffer.byteLength(JSON.stringify({text:""})),exact={text:"a".repeat(100_000-overhead)};
 expect(Buffer.byteLength(preparePlatformTestCall(input,"trusted-runtime",exact,1000).serializedBody)).toBe(100_000);
 expect(()=>preparePlatformTestCall(input,"trusted-runtime",{text:exact.text+"a"},1000)).toThrow("PLATFORM_TEST_REQUEST_TOO_LARGE");
});
it("preparation limits UTF-8 bytes rather than character count",()=>{
 expect(()=>preparePlatformTestCall(request("embedding"),"trusted-runtime",{text:"界".repeat(40_000)},1000)).toThrow("PLATFORM_TEST_REQUEST_TOO_LARGE");
});

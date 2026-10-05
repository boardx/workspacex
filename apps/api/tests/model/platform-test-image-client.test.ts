import {randomUUID} from "node:crypto";
import {afterEach,it,expect,vi} from "vitest";
import {PlatformTestImageClient,type PlatformTestImageConfig} from "../../src/infrastructure/model/platform-test-image-client";
import type {PlatformTestClientHooks} from "../../src/infrastructure/model/platform-test-vector-client";
import type {PlatformModelTestRequest} from "@repo/contracts/platform-model-test";
const config:PlatformTestImageConfig={endpoint:"https://trusted.invalid/api/v1/services/aigc/text2image/image-synthesis",apiKey:"fixture-secret",runtimeModelId:"trusted-image",protocol:"wanx-async",maximumQuantity:2n,timeoutMs:1000,pollIntervalMs:1,maxPolls:4};
const request=():Extract<PlatformModelTestRequest,{capability:"image-generation"}>=>({testId:randomUUID(),orgId:"trusted-org",modelId:"formal-model",declaredNonConfidential:true,capability:"image-generation",input:{prompt:"a cat"},bounds:{maximumCostMicros:"100",timeoutMs:1000,maximumQuantity:"1"}});
const hooks=()=>({beforeDispatch:vi.fn(async(_call:Parameters<PlatformTestClientHooks["beforeDispatch"]>[0])=>{}),terminal:vi.fn(async(_event:Parameters<PlatformTestClientHooks["terminal"]>[0])=>{})});
afterEach(()=>{vi.unstubAllGlobals();vi.restoreAllMocks();});
it("sends exactly prepared bytes once, then only polls the same trusted origin",async()=>{
 const client=new PlatformTestImageClient(config),prepared=client.prepare(request()),callbacks=hooks(),order:string[]=[],urls:string[]=[];let polls=0;
 callbacks.beforeDispatch.mockImplementation(async call=>{order.push("admit");expect(call.serializedBody).toBe(prepared.serializedBody);});
 const fetcher=vi.fn(async(url:unknown,options?:RequestInit)=>{urls.push(String(url));if(options?.method==="POST"){order.push("submit");expect(options.body).toBe(prepared.serializedBody);return Response.json({output:{task_id:"trusted_task"}});}order.push("poll");return Response.json(++polls===1?{output:{task_status:"RUNNING"}}:{output:{task_status:"SUCCEEDED",results:[{url:"https://image.invalid/cat.png"}]},usage:{image_count:1}});});vi.stubGlobal("fetch",fetcher);
 expect(await client.invoke(prepared,callbacks)).toEqual({kind:"image",assets:[{url:"https://image.invalid/cat.png",mimeType:"image/png"}]});expect(order).toEqual(["admit","submit","poll","poll"]);expect(urls.slice(1)).toEqual(["https://trusted.invalid/api/v1/tasks/trusted_task","https://trusted.invalid/api/v1/tasks/trusted_task"]);
 expect(callbacks.terminal.mock.calls[0]?.[0]).toMatchObject({outcome:"succeeded",usage:{tokensTotal:null,nativeUnit:"image",nativeQuantity:1n}});
 await expect(client.invoke(prepared,callbacks)).rejects.toThrow("PLATFORM_TEST_REPLAY_NO_DISPATCH");expect(fetcher).toHaveBeenCalledTimes(3);
});
it("missing supplier quantity is unknown rather than inferred from asset count",async()=>{
 const client=new PlatformTestImageClient(config),callbacks=hooks();vi.stubGlobal("fetch",vi.fn(async(_url:unknown,options?:RequestInit)=>Response.json(options?.method==="POST"?{output:{task_id:"task"}}:{output:{task_status:"SUCCEEDED",results:[{url:"https://image.invalid/cat.png"}]}})));
 await client.invoke(client.prepare(request()),callbacks);expect(callbacks.terminal.mock.calls[0]?.[0].usage).toMatchObject({nativeUnit:"image",nativeQuantity:null,tokensTotal:null});
});
it("reported quantity above the authorized maximum remains metered and fails the result",async()=>{
 const client=new PlatformTestImageClient(config),callbacks=hooks();vi.stubGlobal("fetch",vi.fn(async(_url:unknown,options?:RequestInit)=>Response.json(options?.method==="POST"?{output:{task_id:"task"}}:{output:{task_status:"SUCCEEDED",results:[{url:"https://image.invalid/cat.png"}]},usage:{image_count:2}})));
 await expect(client.invoke(client.prepare(request()),callbacks)).rejects.toThrow("PLATFORM_TEST_PROVIDER_UNCONFIRMED");expect(callbacks.terminal.mock.calls[0]?.[0]).toMatchObject({outcome:"failed",usage:{nativeQuantity:2n}});
});
it("rejected admission makes zero submissions or task polls",async()=>{
 const client=new PlatformTestImageClient(config),callbacks=hooks(),fetcher=vi.fn();callbacks.beforeDispatch.mockRejectedValue(new Error("quota denied"));vi.stubGlobal("fetch",fetcher);
 await expect(client.invoke(client.prepare(request()),callbacks)).rejects.toThrow("quota denied");expect(fetcher).not.toHaveBeenCalled();expect(callbacks.terminal).not.toHaveBeenCalled();
});
it("cancel after submission neither polls nor submits a replacement task",async()=>{
 const client=new PlatformTestImageClient(config),callbacks=hooks(),abort=new AbortController(),fetcher=vi.fn(async()=>{abort.abort();return Response.json({output:{task_id:"task"}});});vi.stubGlobal("fetch",fetcher);
 await expect(client.invoke(client.prepare(request()),callbacks,abort.signal)).rejects.toThrow("PLATFORM_TEST_PROVIDER_UNCONFIRMED");expect(fetcher).toHaveBeenCalledTimes(1);expect(callbacks.terminal.mock.calls[0]?.[0]).toMatchObject({outcome:"failed",usage:{nativeQuantity:null}});
});
it("lost submission acknowledgement is not retried or treated as zero billing",async()=>{
 const client=new PlatformTestImageClient(config),callbacks=hooks(),fetcher=vi.fn(async()=>{throw new Error("transport lost fixture-secret");});vi.stubGlobal("fetch",fetcher);
 await expect(client.invoke(client.prepare(request()),callbacks)).rejects.toThrow("PLATFORM_TEST_PROVIDER_UNCONFIRMED");expect(fetcher).toHaveBeenCalledTimes(1);expect(callbacks.terminal.mock.calls[0]?.[0].usage.nativeQuantity).toBeNull();
});
it("finite poll exhaustion stops without another paid task",async()=>{
 const client=new PlatformTestImageClient({...config,maxPolls:2}),callbacks=hooks(),fetcher=vi.fn(async(_url:unknown,options?:RequestInit)=>Response.json(options?.method==="POST"?{output:{task_id:"task"}}:{output:{task_status:"RUNNING"}}));vi.stubGlobal("fetch",fetcher);
 await expect(client.invoke(client.prepare(request()),callbacks)).rejects.toThrow("PLATFORM_TEST_PROVIDER_UNCONFIRMED");expect(fetcher).toHaveBeenCalledTimes(3);expect(callbacks.terminal.mock.calls[0]?.[0].usage.nativeQuantity).toBeNull();
});
it("the verified deployment quantity cannot be exceeded during prepare",()=>{
 const client=new PlatformTestImageClient(config),input=request();input.bounds.maximumQuantity="3";expect(()=>client.prepare(input)).toThrow("PLATFORM_TEST_REQUEST_INVALID");
});
it("supplier-controlled task IDs cannot change the poll endpoint",async()=>{
 const client=new PlatformTestImageClient(config),callbacks=hooks(),fetcher=vi.fn(async()=>Response.json({output:{task_id:"../another/host"}}));vi.stubGlobal("fetch",fetcher);
 await expect(client.invoke(client.prepare(request()),callbacks)).rejects.toThrow("PLATFORM_TEST_PROVIDER_UNCONFIRMED");expect(fetcher).toHaveBeenCalledTimes(1);
});

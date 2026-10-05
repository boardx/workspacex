import {describe,it,expect,vi} from "vitest";
import {PlatformModelTestService} from "../../src/application/model/platform-model-test";
import type {PlatformModelTestDependencies,PlatformModelTestOperation} from "../../src/application/model/platform-model-test-ports";
import {PlatformModelTestRequest,PlatformModelTestResult} from "@repo/contracts/platform-model-test";
const actor={operatorUserId:"operator",orgId:"org-a"};
const input=PlatformModelTestRequest.parse({testId:"52f5c4f0-51a6-451b-ae38-e19a823f70ca",orgId:"org-a",modelId:"trusted-model",capability:"text",declaredNonConfidential:true,input:{prompt:"fixture"},bounds:{maxOutputTokens:2,maximumCostMicros:"1000000",timeoutMs:1000}});
const result=PlatformModelTestResult.parse({kind:"text",text:"safe result"});
function fixture(){
 let stored:PlatformModelTestOperation|undefined;
 const order:string[]=[];
 const repository:PlatformModelTestDependencies["repository"]={
  async claim(who,request){
   if(who.operatorUserId!==actor.operatorUserId)throw Error("forbidden");
   if(stored){if(JSON.stringify(request)!==JSON.stringify(stored.request))throw Error("conflict");return {operation:stored,claimed:false};}
   stored={testId:input.testId,operatorUserId:who.operatorUserId,request,state:"queued",settlementState:"pending",result:null,failureReason:null};order.push("claim");return {operation:stored,claimed:true};
  },
  async read(){return stored!;},
  async beginDispatch(){if(stored!.state!=="queued")return false;stored={...stored!,state:"dispatching"};order.push("dispatch");return true;},
  async terminal(_who,_id,terminal){stored={...stored!,...terminal};order.push("terminal");},
  async cancel(){stored={...stored!,state:["queued","cancelled"].includes(stored!.state)?"cancelled":"unknown",settlementState:"held"};return stored;},
 };
 const invoke=vi.fn(async()=>{order.push("vendor");return result;});
 const settle=vi.fn(async(_operation:PlatformModelTestOperation)=>{order.push("settle");});
 const reserve=vi.fn(async()=>{order.push("reserve");});
 const releaseUndispatched=vi.fn(async()=>{});
 const deps:PlatformModelTestDependencies={repository,adapters:{resolve:async()=>({enabled:true,adapter:{invoke}})},accounting:{reserve,settle,releaseUndispatched}};
 return {service:new PlatformModelTestService(deps),deps,invoke,settle,reserve,releaseUndispatched,order};
}
describe("platform model test dispatch ownership",()=>{
 it("reserves before vendor, persists terminal before settlement, replay has no paid effect",async()=>{
  const f=fixture();expect((await f.service.execute(actor,input)).state).toBe("succeeded");await f.service.execute(actor,input);
  expect(f.order).toEqual(["claim","reserve","dispatch","vendor","terminal","settle","settle"]);expect(f.invoke).toHaveBeenCalledTimes(1);
 });
 it("concurrent equal UUID has only one dispatch winner",async()=>{
  const f=fixture();await Promise.all([f.service.execute(actor,input),f.service.execute(actor,input)]);expect(f.invoke).toHaveBeenCalledTimes(1);expect(f.reserve).toHaveBeenCalledTimes(1);
 });
 it("same UUID changed body conflicts without dispatch",async()=>{
  const f=fixture();await f.service.execute(actor,input);await expect(f.service.execute(actor,{...input,modelId:"different"})).rejects.toThrow("conflict");expect(f.invoke).toHaveBeenCalledTimes(1);
 });
 it("non operator cannot claim",async()=>{const f=fixture();await expect(f.service.execute({operatorUserId:"member",orgId:"org-a"},input)).rejects.toThrow("forbidden");expect(f.invoke).not.toHaveBeenCalled();});
 it("unregistered adapter refuses before reserve and vendor",async()=>{
  const f=fixture();f.deps.adapters.resolve=async()=>({enabled:false,reason:"bounds-unverified"});expect((await f.service.execute(actor,input)).failureReason).toBe("adapter-unavailable");expect(f.reserve).not.toHaveBeenCalled();expect(f.invoke).not.toHaveBeenCalled();
 });
 it("quota denial has zero vendor effect",async()=>{const f=fixture();f.reserve.mockRejectedValueOnce(Error("secret provider message"));expect((await f.service.execute(actor,input)).failureReason).toBe("admission-refused");expect(f.invoke).not.toHaveBeenCalled();});
 it("cancel before invocation causes no reservation",async()=>{const f=fixture();const c=new AbortController();c.abort();expect((await f.service.execute(actor,input,c.signal)).state).toBe("cancelled");expect(f.reserve).not.toHaveBeenCalled();expect(f.invoke).not.toHaveBeenCalled();});
 it("cancel during reserve wins CAS and releases only undispatched hold",async()=>{
  const f=fixture();f.reserve.mockImplementationOnce(async()=>{await f.service.cancel(actor,input.testId);});expect((await f.service.execute(actor,input)).state).toBe("cancelled");expect(f.invoke).not.toHaveBeenCalled();expect(f.releaseUndispatched).toHaveBeenCalledTimes(1);
 });
 it("cancel after dispatch is unknown and does not release",async()=>{
  const f=fixture();const c=new AbortController();f.invoke.mockImplementationOnce(async()=>{c.abort();return result;});expect((await f.service.execute(actor,input,c.signal)).state).toBe("unknown");expect(f.releaseUndispatched).not.toHaveBeenCalled();
 });
 it("provider error has safe reason and retains hold",async()=>{const f=fixture();f.invoke.mockRejectedValueOnce(Error("Bearer secret"));const r=await f.service.execute(actor,input);expect(r.state).toBe("unknown");expect(r.failureReason).toBe("provider-unconfirmed");expect(f.releaseUndispatched).not.toHaveBeenCalled();});
 it("settlement ACK loss preserves result; replay never recalls vendor",async()=>{
  const f=fixture();f.settle.mockRejectedValueOnce(Error("ACK lost"));expect((await f.service.execute(actor,input)).result).toBe(result);await f.service.execute(actor,input);expect(f.invoke).toHaveBeenCalledTimes(1);expect(f.settle).toHaveBeenCalledTimes(2);
 });
 it("terminal durable write failure does not settle or free hold or retry vendor",async()=>{
  const f=fixture();f.deps.repository.terminal=async()=>{throw Error("disk unavailable");};await expect(f.service.execute(actor,input)).rejects.toThrow("disk unavailable");await f.service.execute(actor,input);expect(f.invoke).toHaveBeenCalledTimes(1);expect(f.settle).not.toHaveBeenCalled();expect(f.releaseUndispatched).not.toHaveBeenCalled();
 });
});


it("strict public request rejects billed user override, input URLs and credentials",()=>{
 for(const extra of [{billedUserId:"other"},{apiKey:"secret"},{baseUrl:"https://override"}])expect(PlatformModelTestRequest.safeParse({...input,...extra}).success).toBe(false);
 expect(PlatformModelTestRequest.safeParse({...input,input:{...input.input,url:"https://untrusted"}}).success).toBe(false);
});
it("service rejects foreign organization before claim",async()=>{
 const f=fixture();await expect(f.service.execute({...actor,orgId:"org-b"},input)).rejects.toThrow("TEST_FORBIDDEN");expect(f.order).toEqual([]);
});
it("actual AbortController signal reaches dispatched adapter and cancellation keeps unknown",async()=>{
 const f=fixture();const controller=new AbortController();
 f.deps.adapters.resolve=async()=>({enabled:true,adapter:{invoke:async(_operation,signal)=>{
  expect(signal).toBeInstanceOf(AbortSignal);
  return new Promise((_resolve,reject)=>{signal!.addEventListener("abort",()=>reject(Error("cancelled")),{once:true});controller.abort();});
 }}});
 expect((await f.service.execute(actor,input,controller.signal)).state).toBe("unknown");expect(f.releaseUndispatched).not.toHaveBeenCalled();
});
it("lost settlement acknowledgement replays same immutable terminal and eventually settles",async()=>{
 const f=fixture();const receipts:PlatformModelTestOperation[]=[];let lose=true;
 f.settle.mockImplementation(async(operation)=>{receipts.push(operation);if(lose){lose=false;throw Error("acknowledgement lost");}});
 await f.service.execute(actor,input);await f.service.execute(actor,input);
 expect(receipts).toHaveLength(2);expect(receipts[1]).toEqual(receipts[0]);expect(receipts[1]!.state).toBe("succeeded");expect(f.invoke).toHaveBeenCalledTimes(1);
});

it("service cancel propagates actual abort to the in-flight adapter",async()=>{
 const f=fixture();let entered!:()=>void;const ready=new Promise<void>(resolve=>{entered=resolve;});let aborted=false;
 f.deps.adapters.resolve=async()=>({enabled:true,adapter:{invoke:async(_operation,signal)=>new Promise((_resolve,reject)=>{
  signal!.addEventListener("abort",()=>{aborted=true;reject(Error("aborted"));},{once:true});entered();
 })}});
 const pending=f.service.execute(actor,input);await ready;await f.service.cancel(actor,input.testId);
 expect((await pending).state).toBe("unknown");expect(aborted).toBe(true);expect(f.releaseUndispatched).not.toHaveBeenCalled();
});

it("adapter preparation failure closes claim and replay cannot dispatch",async()=>{
 const f=fixture();f.deps.adapters.resolve=async()=>{throw Error("provider secret voice denied");};
 const first=await f.service.execute(actor,input);expect(first.state).toBe("failed");expect(first.failureReason).toBe("adapter-unavailable");
 expect((await f.service.execute(actor,input)).state).toBe("failed");expect(f.reserve).not.toHaveBeenCalled();expect(f.invoke).not.toHaveBeenCalled();expect(f.releaseUndispatched).not.toHaveBeenCalled();
});

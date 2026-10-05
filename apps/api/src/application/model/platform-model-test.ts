import type { PlatformModelTestRequest } from "@repo/contracts/platform-model-test";
import {PlatformModelTestError} from "./platform-model-test-ports";
import type { PlatformModelTestActor,PlatformModelTestDependencies,PlatformModelTestOperation } from "./platform-model-test-ports";

/** Durable claim is the only dispatch authority. A read/replay never retries vendor work. */
export class PlatformModelTestService {
 private readonly active=new Map<string,AbortController>();
 constructor(private readonly deps:PlatformModelTestDependencies){}
 private key(actor:PlatformModelTestActor,testId:string){return JSON.stringify([actor.orgId,actor.operatorUserId,testId]);}
 async execute(actor:PlatformModelTestActor,input:PlatformModelTestRequest,signal?:AbortSignal):Promise<PlatformModelTestOperation>{
  if(actor.orgId!==input.orgId)throw new PlatformModelTestError("TEST_FORBIDDEN");
  const {repository,adapters,accounting}=this.deps;
  const claim=await repository.claim(actor,input);
  if(!claim.claimed){
   if(["succeeded","failed","unknown"].includes(claim.operation.state)&&claim.operation.settlementState!=="settled"){
    try{await accounting.settle(claim.operation);}catch{/* Same receipt, never redispatch. */}
    return repository.read(actor,claim.operation.testId);
   }
   return claim.operation;
  }
  const controller=new AbortController();
  const abort=()=>controller.abort();
  if(signal?.aborted)controller.abort();
  else signal?.addEventListener("abort",abort,{once:true});
  const key=this.key(actor,claim.operation.testId);
  this.active.set(key,controller);
  try{return await this.dispatchClaimed(actor,claim.operation,controller.signal);}
  finally{this.active.delete(key);signal?.removeEventListener("abort",abort);}
 }
 private async dispatchClaimed(actor:PlatformModelTestActor,operation:PlatformModelTestOperation,signal:AbortSignal):Promise<PlatformModelTestOperation>{
  const {repository,adapters,accounting}=this.deps;
  if(signal?.aborted)return repository.cancel(actor,operation.testId);
  let selected:Awaited<ReturnType<typeof adapters.resolve>>;
  try{selected=await adapters.resolve(operation);}catch{
   // Preparation can reject a valid public request against stricter deployment bounds.
   // Finish the claimed operation; never strand it queued or leak the provider error.
   await repository.terminal(actor,operation.testId,{state:"failed",result:null,failureReason:"adapter-unavailable"});
   return repository.read(actor,operation.testId);
  }
  if(!selected.enabled){
   await repository.terminal(actor,operation.testId,{state:"failed",result:null,failureReason:"adapter-unavailable"});
   return repository.read(actor,operation.testId);
  }
  try{await accounting.reserve(operation);}catch{
   await repository.terminal(actor,operation.testId,{state:"failed",result:null,failureReason:"admission-refused"});
   return repository.read(actor,operation.testId);
  }
  // Cancel may win during expensive verification/reservation. Dispatch is a separate CAS.
  if(signal?.aborted)await repository.cancel(actor,operation.testId);
  if(!await repository.beginDispatch(actor,operation.testId)){
   await accounting.releaseUndispatched(operation);
   return repository.read(actor,operation.testId);
  }
  let terminal:Parameters<typeof repository.terminal>[2];
  try{
   const result=await selected.adapter.invoke(operation,signal);
   terminal=signal?.aborted?{state:"unknown",result:null,failureReason:"dispatch-cancelled"}:{state:"succeeded",result,failureReason:null};
  }catch{
   // Raw provider exceptions, credentials and stack traces never become public results.
   terminal={state:"unknown",result:null,failureReason:signal?.aborted?"dispatch-cancelled":"provider-unconfirmed"};
  }
  // If durability fails, propagate without clearing the reservation or recalling vendor.
  await repository.terminal(actor,operation.testId,terminal);
  const stored=await repository.read(actor,operation.testId);
  try{await accounting.settle(stored);}catch{
   // Durable terminal is the recovery source; ACK loss cannot authorize another dispatch.
  }
  return repository.read(actor,operation.testId);
 }
 get(actor:PlatformModelTestActor,testId:string){return this.deps.repository.read(actor,testId);}
 async cancel(actor:PlatformModelTestActor,testId:string){
  // Authorize and durably close first; denied cross-tenant cancellation cannot abort a live call.
  const operation=await this.deps.repository.cancel(actor,testId);
  if(operation.state==="cancelled"||operation.state==="unknown")this.active.get(this.key(actor,testId))?.abort();
  return operation;
 }
}

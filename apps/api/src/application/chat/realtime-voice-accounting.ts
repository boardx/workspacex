import {createHash,randomUUID} from "node:crypto";
import type {TokenUsageMeterPort,TokenUsageRecord} from "../agent-run/ports";
import type {Principal} from "../../domain/principal";
import {CreditConsumptionError} from "../billing/credit-consumption";
import type {RealtimeVoiceSession} from "./realtime-voice-session";
const MAX_RESPONSES=10000;
type Usage={total:number;input:number|null;output:number|null};
type Counters=Usage&{failed:boolean};
const counter=(v:unknown):number|null=>typeof v==="number"&&Number.isSafeInteger(v)&&v>=0?v:null;
/** One upstream WebSocket is one admitted physical request. Provider response.done
 * counters are per response, so accumulate distinct completed response IDs into that request.
 * Wire reference: https://help.aliyun.com/en/model-studio/realtime#search-usage
 * Neither browser transcript nor audio duration is used to invent token counts.
 */
export class RealtimeVoiceAccounting{
 readonly requestId=`realtime:${randomUUID()}`;
 private startedAt=new Date().toISOString();private admitted=false;private dispatched=false;private failed=false;
 private readonly known=new Map<string,Counters>();private readonly unknown=new Set<string>();private readonly active=new Set<string>();
 private totals:Usage={total:0,input:0,output:0};private serial:Promise<void>=Promise.resolve();private finishing:Promise<void>|null=null;
 private confirmed:Usage|null=null;
 private session:RealtimeVoiceSession|null=null;private admitting:Promise<void>|null=null;
 constructor(private readonly meter:TokenUsageMeterPort,private readonly principal:Principal,private readonly model:string){}
 private error(){return new CreditConsumptionError("credit_accounting_unavailable","user",this.principal.userId,"realtime_usage_unconfirmed");}
 start(session:RealtimeVoiceSession|null):Promise<void>{
  if(this.admitting)return this.admitting;
  this.session=session;
  this.admitting=(async()=>{
   if(!this.meter.startRequest)throw this.error();
   await this.meter.startRequest(this.principal.orgId,{requestId:this.requestId,userId:this.principal.userId,runId:null,executionAttemptId:null,projectId:null,
    modelProvider:"qwen-realtime",modelId:this.model,threadId:session?.threadId??null,agentId:session?.role.agentId??null,callPurpose:"auxiliary",startedAt:this.startedAt});this.admitted=true;
  })();return this.admitting;
 }
 markDispatched(){this.dispatched=true;}
 receive(event:Record<string,unknown>):Promise<void>{
  if(!["response.created","response.done"].includes(String(event.type)))return Promise.resolve();
  this.serial=this.serial.then(async()=>{
   const response=event.response as Record<string,unknown>|undefined;
   if(!response||typeof response.id!=="string"||!response.id||response.id.length>255){throw this.error();}
   const id=response.id;if(this.known.size+this.unknown.size+this.active.size>=MAX_RESPONSES){throw this.error();}if(event.type==="response.created"){this.active.add(id);return;}this.active.delete(id);
   const usage=response.usage as Record<string,unknown>|null|undefined,total=counter(usage?.total_tokens);
   if(total===null){this.unknown.add(id);this.failed ||= response.status!=="completed";return;}
   const input=counter(usage?.input_tokens),output=counter(usage?.output_tokens);
   if(input!==null&&output!==null&&input+output!==total){throw this.error();}
   const counters={total,input,output,failed:response.status!=="completed"};
   const prior=this.known.get(id);
   if(prior){if(JSON.stringify(prior)!==JSON.stringify(counters)){throw this.error();}return;}
   if(this.known.size+this.unknown.size>=MAX_RESPONSES){throw this.error();}
   this.known.set(id,counters);this.unknown.delete(id);this.failed ||= counters.failed;
   if(counters.failed)return;
   this.totals={total:this.totals.total+total,input:this.totals.input===null||input===null?null:this.totals.input+input,
    output:this.totals.output===null||output===null?null:this.totals.output+output};
   if(!Number.isSafeInteger(this.totals.total)){throw this.error();}
   this.confirmed=this.totals;
   await this.meter.record(this.principal.orgId,this.receipt(`response:${createHash("sha256").update(id).digest("hex")}`,false,this.totals,"succeeded"));
   await this.meter.assertCreditContinuation?.(this.principal.orgId,this.principal.userId,this.requestId);
  });return this.serial;
 }
 private receipt(id:string,final:boolean,confirmed:Usage|null,outcome:TokenUsageRecord["outcome"]):TokenUsageRecord{
  return {eventId:this.requestId,userId:this.principal.userId,runId:null,projectId:null,threadId:this.session?.threadId??null,agentId:this.session?.role.agentId??null,
   modelProvider:"qwen-realtime",modelId:this.model,callPurpose:"auxiliary",tokensTotal:confirmed?.total??0,
   promptTokens:confirmed?.input??null,completionTokens:confirmed?.output??null,totalSource:confirmed?"reported":"unknown",outcome,
   requestStartedAt:this.startedAt,...(final?{requestEndedAt:new Date().toISOString()}:{}),billingReceipt:{id,final}};
 }
 finish(aborted=false):Promise<void>{
  if(this.finishing)return this.finishing;
  this.finishing=(this.admitting??Promise.resolve()).catch(()=>undefined).then(()=>this.serial.catch(()=>undefined)).then(async()=>{
   if(!this.admitted)return;
   // A transport failure or cancellation can only end unfinished work. Completed
   // responses have their own trusted counters and survive the session outcome.
   const confirmed=this.confirmed??(!this.dispatched?this.totals:null);
   const outcome=this.confirmed?"succeeded":aborted||this.failed?"failed":"succeeded";
   await this.meter.record(this.principal.orgId,this.receipt("session-final",true,confirmed,outcome));
  });return this.finishing;
 }
}

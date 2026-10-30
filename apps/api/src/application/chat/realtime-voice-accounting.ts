import {createHash,randomUUID} from "node:crypto";
import type {TokenUsageMeterPort,TokenUsageRecord} from "../agent-run/ports";
import type {Principal} from "../../domain/principal";
import {CreditConsumptionError} from "../billing/credit-consumption";
import type {RealtimeVoiceSession} from "./realtime-voice-session";
const MAX_RESPONSES=10000;
type Counters={total:number;input:number|null;output:number|null;failed:boolean};
const counter=(v:unknown):number|null=>typeof v==="number"&&Number.isSafeInteger(v)&&v>=0?v:null;
/** One upstream WebSocket is one admitted physical request. Provider response.done
 * counters are per response, so accumulate distinct response IDs into that request.
 * Wire reference: https://help.aliyun.com/en/model-studio/realtime#search-usage
 * Neither browser transcript nor audio duration is used to invent token counts.
 */
export class RealtimeVoiceAccounting{
 readonly requestId=`realtime:${randomUUID()}`;
 private startedAt=new Date().toISOString();private admitted=false;private dispatched=false;private uncertain=false;private failed=false;
 private readonly known=new Map<string,Counters>();private readonly unknown=new Set<string>();private readonly active=new Set<string>();
 private totals:Counters={total:0,input:0,output:0,failed:false};private serial:Promise<void>=Promise.resolve();private finishing:Promise<void>|null=null;
 private session:RealtimeVoiceSession|null=null;
 constructor(private readonly meter:TokenUsageMeterPort,private readonly principal:Principal,private readonly model:string){}
 private error(){return new CreditConsumptionError("credit_accounting_unavailable","user",this.principal.userId,"realtime_usage_unconfirmed");}
 async start(session:RealtimeVoiceSession|null){
  if(!this.meter.startRequest)throw this.error();this.session=session;
  await this.meter.startRequest(this.principal.orgId,{requestId:this.requestId,userId:this.principal.userId,runId:null,executionAttemptId:null,projectId:null,
   modelProvider:"qwen-realtime",modelId:this.model,threadId:session?.threadId??null,agentId:session?.role.agentId??null,callPurpose:"auxiliary",startedAt:this.startedAt});this.admitted=true;
 }
 markDispatched(){this.dispatched=true;}
 receive(event:Record<string,unknown>):Promise<void>{
  if(!["response.created","response.done"].includes(String(event.type)))return Promise.resolve();
  this.serial=this.serial.then(async()=>{
   const response=event.response as Record<string,unknown>|undefined;
   if(!response||typeof response.id!=="string"||!response.id||response.id.length>255){this.uncertain=true;throw this.error();}
   const id=response.id;if(this.known.size+this.unknown.size+this.active.size>=MAX_RESPONSES){this.uncertain=true;throw this.error();}if(event.type==="response.created"){this.active.add(id);return;}this.active.delete(id);
   const usage=response.usage as Record<string,unknown>|null|undefined,total=counter(usage?.total_tokens);
   if(total===null){this.unknown.add(id);this.failed=true;return;}
   const input=counter(usage?.input_tokens),output=counter(usage?.output_tokens);
   if(input!==null&&output!==null&&input+output!==total){this.uncertain=true;throw this.error();}
   const counters={total,input,output,failed:response.status!=="completed"};
   const prior=this.known.get(id);
   if(prior){if(JSON.stringify(prior)!==JSON.stringify(counters)){this.uncertain=true;throw this.error();}return;}
   if(this.known.size+this.unknown.size>=MAX_RESPONSES){this.uncertain=true;throw this.error();}
   this.known.set(id,counters);this.unknown.delete(id);this.failed ||= counters.failed;
   this.totals={total:this.totals.total+total,input:this.totals.input===null||input===null?null:this.totals.input+input,
    output:this.totals.output===null||output===null?null:this.totals.output+output,failed:this.failed};
   if(!Number.isSafeInteger(this.totals.total)){this.uncertain=true;throw this.error();}
   await this.meter.record(this.principal.orgId,this.receipt(`response:${createHash("sha256").update(id).digest("hex")}`,false,true));
  });return this.serial;
 }
 private receipt(id:string,final:boolean,confirmed:boolean):TokenUsageRecord{
  return {eventId:this.requestId,userId:this.principal.userId,runId:null,projectId:null,threadId:this.session?.threadId??null,agentId:this.session?.role.agentId??null,
   modelProvider:"qwen-realtime",modelId:this.model,callPurpose:"auxiliary",tokensTotal:confirmed?this.totals.total:0,
   promptTokens:confirmed?this.totals.input:null,completionTokens:confirmed?this.totals.output:null,totalSource:confirmed?"reported":"unknown",outcome:this.failed?"failed":"succeeded",
   requestStartedAt:this.startedAt,...(final?{requestEndedAt:new Date().toISOString()}:{}),billingReceipt:{id,final}};
 }
 finish(aborted=false):Promise<void>{
  if(this.finishing)return this.finishing;
  this.finishing=this.serial.catch(()=>{this.uncertain=true;}).then(async()=>{
   if(!this.admitted)return;this.failed ||= aborted;
   const confirmed=!this.dispatched||(!this.uncertain&&this.unknown.size===0&&this.active.size===0&&this.known.size>0);
   await this.meter.record(this.principal.orgId,this.receipt("session-final",true,confirmed));
  });return this.finishing;
 }
}

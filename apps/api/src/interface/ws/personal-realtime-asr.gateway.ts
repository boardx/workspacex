import { createHash } from "node:crypto";
import type { Server } from "node:http";
import type { Duplex } from "node:stream";
import { personalRealtimeTranscription as C } from "@repo/contracts";
import { WebSocketServer, type WebSocket } from "ws";
import type { IdGenerator } from "../../application/recording/ports";
import type { PersonalTranscriptionRepository } from "../../application/recording/personal-transcription-ports";
import { persistThenPublishFinal, type AsrUsageMeter,
  type RealtimeAsrTicketStore } from "../../application/recording/personal-realtime-asr";
import type { AsrProviderPort, AsrSession } from "../../application/recording/asr-ports";
import { toOrgId } from "../../domain/org-id";

const PATH=/^\/recording\/realtime-asr\/sessions\/([^/?]+)\/captures\/([^/?]+)\/stream(?:\?|$)/;
type Frame=typeof C.RealtimeAsrServerEvent._type;
export interface PersonalRealtimeAsrGatewayDeps { tickets:RealtimeAsrTicketStore; repository:PersonalTranscriptionRepository;
  provider:AsrProviderPort; usage:AsrUsageMeter; ids:IdGenerator; }
function refuse(socket:Duplex,status:number){socket.write(`HTTP/1.1 ${status} Refused\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);socket.destroy();}

export function attachPersonalRealtimeAsrGateway(server:Server,deps:PersonalRealtimeAsrGatewayDeps):WebSocketServer{
  const wss=new WebSocketServer({noServer:true});
  server.on("upgrade",(request,socket,head)=>{const url=new URL(request.url??"/","http://localhost");const match=PATH.exec(url.pathname);
    if(!match)return; void(async()=>{const transcriptionId=decodeURIComponent(match[1]!),captureId=decodeURIComponent(match[2]!);
      const ticket=url.searchParams.get(C.streamOperation.ticketQueryParameter); if(!ticket)return refuse(socket,401);
      const [encodedOrg]=ticket.split("."); let orgId; try{orgId=toOrgId(Buffer.from(encodedOrg??"","base64url").toString("utf8"));}
      catch{return refuse(socket,401);}
      const consumed=await deps.tickets.consume({ticketHash:createHash("sha256").update(ticket).digest("hex"),orgId,transcriptionId,captureId});
      if(!consumed.ok)return refuse(socket,consumed.reason==="TICKET_EXPIRED"?410:401);
      wss.handleUpgrade(request,socket,head,ws=>serve(ws,deps,consumed));
    })().catch(()=>refuse(socket,500));
  }); return wss;
}
function serve(ws:WebSocket,deps:PersonalRealtimeAsrGatewayDeps,auth:{orgId:ReturnType<typeof toOrgId>;ownerUserId:string;transcriptionId:string;captureId:string}){
  const send=(f:Frame)=>{if(ws.readyState===ws.OPEN)ws.send(JSON.stringify(C.RealtimeAsrServerEvent.parse(f)));};
  let upstream:AsrSession|null=null,ordinal=0,writeChain=Promise.resolve();
  let starting=false; const pendingAudio:Uint8Array[]=[]; let pendingBytes=0;
  const startedAt=Date.now(),providerSessionId=deps.ids.next("asr-provider-session");
  let receivedPcmBytes=0,lastFinalEndMs=0,stopping=false,terminal=false,usageRecorded=false;
  let failure:Promise<void>|null=null;
  const fail=(reason:typeof C.RealtimeAsrStreamError._type):Promise<void>=>{
    if(failure)return failure;
    if(terminal)return Promise.resolve();
    terminal=true;stopping=true;upstream?.abort();upstream=null;pendingAudio.splice(0);pendingBytes=0;
    failure=(async()=>{try{await deps.repository.finishCapture({...auth,durationMs:Date.now()-startedAt,failed:true});}
      catch(error){process.stderr.write(`[personal-asr] capture cleanup failed: ${safeErrorDetail(error)}\n`);}
      finally{send({type:"error",captureId:auth.captureId,reason});ws.close();}})();
    return failure;
  };
  ws.on("message",(raw,isBinary)=>{if(isBinary){try{const audio=new Uint8Array(raw as Buffer);
      if(upstream&&!stopping){upstream.pushAudio(audio);receivedPcmBytes+=audio.byteLength;}
      else if(starting){if(pendingBytes+audio.byteLength>960_000){void fail("AUDIO_BACKPRESSURE");return;}
        pendingBytes+=audio.byteLength;pendingAudio.push(audio);receivedPcmBytes+=audio.byteLength;}
      else void fail("PROTOCOL_ERROR");}catch{void fail("PROTOCOL_ERROR");}return;}
    const parsed=C.RealtimeAsrClientEvent.safeParse(safeJson(String(raw)));if(!parsed.success){void fail("PROTOCOL_ERROR");return;}
    if(parsed.data.type==="start"){
      if(upstream||starting){void fail("PROTOCOL_ERROR");return;} starting=true;
      void deps.provider.open({
        onPartial:r=>{if(!terminal)send({type:"interim",captureId:auth.captureId,text:r.text});},
        onFinal:r=>{if(terminal)return;const current=++ordinal,endMs=Math.round(pcm16MonoDurationSeconds(receivedPcmBytes)*1000),startMs=lastFinalEndMs;
          lastFinalEndMs=endMs;writeChain=writeChain.then(()=>persistThenPublishFinal(async()=>{
          const segmentId=deps.ids.next("personal-segment");await deps.repository.appendFinal({...auth,segmentId,ordinal:current,text:r.text,startMs,endMs});
          return{segmentId,ordinal:current};},stored=>send({type:"final",captureId:auth.captureId,...stored,text:r.text,startMs,endMs})))
          .catch(()=>fail("FINISH_TIMEOUT")).then(()=>undefined);},
        onError:(reason,detail)=>void fail(asPersonalErrorReason(reason,detail,stopping)),
        onClosed:()=>undefined,
      },{sampleRate:16_000,channels:1,encoding:"pcm16le"}).then(s=>{starting=false;
          if(terminal){s.abort();return;}upstream=s;
          send({type:"ready",captureId:auth.captureId});
          for(const audio of pendingAudio.splice(0))s.pushAudio(audio);pendingBytes=0;
        }).catch(()=>void fail("ASR_PROVIDER_UNAVAILABLE"));return;
    }
    if(!upstream||stopping||terminal){void fail("PROTOCOL_ERROR");return;} stopping=true;send({type:"stopping",captureId:auth.captureId});
    void upstream.finish().then(async()=>{await writeChain;const durationSeconds=pcm16MonoDurationSeconds(receivedPcmBytes);
      if(terminal)return;
      if(!usageRecorded){usageRecorded=true;await deps.usage.record({providerTaskId:providerSessionUsageId(auth.captureId,providerSessionId),
      orgId:auth.orgId,ownerUserId:auth.ownerUserId,captureId:auth.captureId,
      model:process.env.KERNEL_ASR_MODEL??"realtime-asr",durationSeconds:billedPcm16MonoDurationSeconds(receivedPcmBytes)});}
      await deps.repository.finishCapture({...auth,durationMs:durationSeconds*1000});
      if(terminal)return;terminal=true;send({type:"completed",captureId:auth.captureId});ws.close();
    }).catch(()=>void fail("FINISH_TIMEOUT"));
  });
  ws.on("close",()=>{if(!terminal)void fail("ASR_PROVIDER_UNAVAILABLE");});
}
function safeJson(value:string):unknown{try{return JSON.parse(value);}catch{return null;}}
function safeErrorDetail(error:unknown):string{return error instanceof Error?error.name:"unknown";}
function asPersonalErrorReason(reason:string,detail:string,stopping:boolean):typeof C.RealtimeAsrStreamError._type{
  if(stopping&&reason==="ASR_PROVIDER_UNAVAILABLE"&&detail==="upstream did not settle the final segment in time")return "FINISH_TIMEOUT";
  const parsed=C.RealtimeAsrStreamError.safeParse(reason);
  return parsed.success?parsed.data:"ASR_PROVIDER_UNAVAILABLE";
}

const PCM16_MONO_16KHZ_BYTES_PER_SECOND=32_000;
export function pcm16MonoDurationSeconds(bytes:number):number{return bytes/PCM16_MONO_16KHZ_BYTES_PER_SECOND;}
export function billedPcm16MonoDurationSeconds(bytes:number):number{return Math.ceil(pcm16MonoDurationSeconds(bytes));}
export function providerSessionUsageId(captureId:string,providerSessionId:string):string{
  return `personal:${captureId}:${providerSessionId}`;
}

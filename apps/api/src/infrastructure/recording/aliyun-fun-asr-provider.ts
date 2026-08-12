import { randomUUID } from "node:crypto";
import WebSocket from "ws";
import type { PersonalRealtimeAsrProvider } from "../../application/recording/personal-realtime-asr";
import { FunAsrProtocolSession, type FunAsrHandlers } from "./aliyun-realtime-transcription-session";

export interface AliyunFunAsrConfig { apiKey:string; workspaceId?:string; region:string; model:string; endpoint:string; }
export function readAliyunFunAsrConfig(env:NodeJS.ProcessEnv=process.env):AliyunFunAsrConfig|null {
  if(!env.DASHSCOPE_API_KEY) return null;
  const region=env.ALIYUN_ASR_REGION ?? "cn-beijing";
  const workspaceId=env.ALIYUN_ASR_WORKSPACE_ID;
  const publicEndpoint=region === "ap-southeast-1"
    ? "wss://dashscope-intl.aliyuncs.com/api-ws/v1/inference"
    : "wss://dashscope.aliyuncs.com/api-ws/v1/inference";
  return {apiKey:env.DASHSCOPE_API_KEY,workspaceId,region,
    model:env.ALIYUN_ASR_MODEL ?? "fun-asr-realtime",
    endpoint:env.ALIYUN_ASR_ENDPOINT ?? (workspaceId
      ? `wss://${workspaceId}.${region}.maas.aliyuncs.com/api-ws/v1/inference`
      : publicEndpoint)};
}
export class AliyunFunAsrProvider implements PersonalRealtimeAsrProvider {
  constructor(private readonly config:AliyunFunAsrConfig|null=readAliyunFunAsrConfig()){}
  isConfigured(){return this.config!==null;}
  async open(handlers:FunAsrHandlers):Promise<FunAsrProtocolSession>{
    if(!this.config) throw new Error("ASR_NOT_CONFIGURED");
    const config=this.config; const taskId=randomUUID();
    return new Promise((resolve,reject)=>{
      const socket=new WebSocket(config.endpoint,{headers:{Authorization:`Bearer ${config.apiKey}`,
        ...(config.workspaceId ? {"X-DashScope-WorkSpace":config.workspaceId} : {})}});
      let settled=false,callerClosed=false;
      socket.once("open",()=>{settled=true; const session=new FunAsrProtocolSession({taskId,model:config.model,
        send:v=>socket.send(v),close:()=>{callerClosed=true;socket.close();}},handlers);
        socket.on("message",(raw,isBinary)=>{if(isBinary)return; try{session.accept(JSON.parse(String(raw)));}
          catch{handlers.onError("invalid Fun-ASR provider frame");}});
        session.start(); resolve(session);
        socket.once("close",()=>{if(!callerClosed)handlers.onError("Fun-ASR connection closed unexpectedly");});
      });
      socket.once("error",e=>{if(!settled)reject(e); else handlers.onError("Fun-ASR connection failed");});
    });
  }
}

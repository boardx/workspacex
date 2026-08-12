import {createServer,type Server} from "node:http";
import type {AddressInfo} from "node:net";
import {afterEach,describe,expect,it} from "vitest";
import {WebSocketServer} from "ws";
import {AliyunFunAsrProvider} from "../../src/infrastructure/recording/aliyun-fun-asr-provider";
let server:Server|undefined,wss:WebSocketServer|undefined;
afterEach(()=>new Promise<void>(resolve=>{wss?.close();server?.close(()=>resolve());if(!server)resolve();}));
describe("Aliyun Fun-ASR provider",()=>{
  it("uses bearer/workspace headers and sends official run-task frame",async()=>{
    server=createServer();wss=new WebSocketServer({server});let authorization="",workspace="";const frames:string[]=[];
    wss.on("connection",(ws,req)=>{authorization=String(req.headers.authorization);workspace=String(req.headers["x-dashscope-workspace"]);
      ws.on("message",(raw,isBinary)=>{if(!isBinary)frames.push(String(raw));});});
    const port=await new Promise<number>(resolve=>server!.listen(0,"127.0.0.1",()=>resolve((server!.address() as AddressInfo).port)));
    const provider=new AliyunFunAsrProvider({apiKey:"key",workspaceId:"workspace",region:"cn-beijing",model:"fun-asr-realtime",endpoint:`ws://127.0.0.1:${port}`});
    const session=await provider.open({onInterim:()=>undefined,onFinal:()=>undefined,onError:()=>undefined});
    await new Promise(resolve=>setTimeout(resolve,20));
    expect(authorization).toBe("Bearer key");expect(workspace).toBe("workspace");
    expect(JSON.parse(frames[0]!).payload).toMatchObject({task_group:"audio",task:"asr",function:"recognition",model:"fun-asr-realtime",parameters:{format:"pcm",sample_rate:16000}});
    session.abort();
  });
});

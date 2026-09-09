import { afterEach, it, expect, vi } from "vitest";
import { SkillActivityFact } from "@repo/contracts/skill-activity";
import { DeepAgentModelProvider } from "../../src/infrastructure/agent-run/deep-agent-model-provider";
const fact = { contractVersion:1 as const, factId:"fact1", skillId:"skill", skillStableName:"slides", skillVersion:"version1", packageDigest:"a".repeat(64),stage:"body_read" as const,readPath:"/skills/slides/SKILL.md" };
afterEach(()=>vi.unstubAllGlobals());
it("constrains stages and rejects untrusted execution identity",()=>{
  expect(SkillActivityFact.safeParse(fact).success).toBe(true);
  expect(SkillActivityFact.safeParse({...fact,stage:"execution_succeeded"}).success).toBe(false);
  expect(SkillActivityFact.safeParse({...fact,orgId:"spoof"}).success).toBe(false);
  expect(SkillActivityFact.safeParse({...fact,stage:"metadata_discovered"}).success).toBe(false);
});
for (const resume of [false,true]) it(`awaits real custom skill facts and requests custom stream (resume=${resume})`,async()=>{
  const bodies: unknown[]=[];
  vi.stubGlobal("fetch",vi.fn(async(url:string,init?:RequestInit)=>{
    if(url.endsWith("/stream"))return new Response(`event: custom\ndata: ${JSON.stringify({type:"skill_activity",version:1,fact})}\n\n`,{headers:{"content-type":"text/event-stream"}});
    if(init?.method==="POST" && url.endsWith("/runs")){bodies.push(JSON.parse(String(init.body)));return Response.json({run_id:"remote"});}
    if(url.endsWith("/state"))return Response.json({values:{messages:[{type:"ai",id:"final",content:"done"}]}});
    if(url.endsWith("/runs/remote"))return Response.json({status:"success"});
    return Response.json({thread_id:"thread",status:"idle"});
  }));
  const callback=vi.fn(async()=>{});
  const provider=new DeepAgentModelProvider({baseUrl:"http://kernel.invalid",streamEnabled:false,timeoutMs:1000,pollIntervalMs:1});
  await provider.completeWithProgress({modelProvider:"deep-agent",modelId:"test",system:"",user:"hi",threadId:"thread",...(resume?{resume:{decision:"approve" as const}}:{}),onSkillActivity:callback},async()=>{});
  expect(callback).toHaveBeenCalledWith(fact);
  await expect(new DeepAgentModelProvider({baseUrl:"http://kernel.invalid",streamEnabled:true,timeoutMs:1000,pollIntervalMs:1}).completeWithProgress({modelProvider:"deep-agent",modelId:"test",system:"",user:"hi"},async()=>{},async()=>{}))
    .rejects.toThrow("skill_activity_writer_unavailable");
  expect(bodies[0]).toMatchObject({stream_mode:["messages-tuple","updates","custom"]});
  await expect(provider.completeWithProgress({modelProvider:"deep-agent",modelId:"test",system:"",user:"hi",onSkillActivity:async()=>{throw new Error("writer_failed");}},async()=>{})).rejects.toThrow("writer_failed");
});

for (const mode of ["unavailable", "wrong-content-type", "incomplete", "broken"] as const) it(`fails required fact delivery without resubmission: ${mode}`, async () => {
  let starts = 0;
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    if (url.endsWith("/stream")) {
      if (mode === "unavailable") return new Response("", {status:503});
      if (mode === "wrong-content-type") return Response.json({ok:true});
      if (mode === "broken") return new Response(new ReadableStream({start(controller) { controller.error(new Error("broken")); }}), {headers:{"content-type":"text/event-stream"}});
      return new Response('event: custom\ndata: {"type":"skill_activity"', {headers:{"content-type":"text/event-stream"}});
    }
    if (init?.method === "POST" && url.endsWith("/runs")) { starts++; return Response.json({run_id:"remote"}); }
    if (url.endsWith("/state")) return Response.json({values:{messages:[{type:"ai",content:"must not be delivered"}]}});
    return Response.json({thread_id:"thread",status:"success"});
  }));
  const provider = new DeepAgentModelProvider({baseUrl:"http://kernel.invalid",streamEnabled:false,timeoutMs:1000,pollIntervalMs:1});
  await expect(provider.complete({modelProvider:"deep-agent",modelId:"test",system:"",user:"hi",onSkillActivity:async()=>{}})).rejects.toMatchObject(mode === "incomplete"
    ? {message:"skill_activity_stream_incomplete"}
    : {code:"MODEL_CALL_FAILED",detail:"skill_activity_delivery_unavailable"});
  expect(starts).toBe(1);
});

for (const mode of ["headers-hang", "body-never-closes"] as const) it(`bounds required Skill stream by the existing deadline: ${mode}`, async () => {
  let starts=0;
  vi.stubGlobal("fetch",vi.fn(async(url:string,init?:RequestInit)=>{
    if(url.endsWith("/stream")) {
      const signal=init?.signal;
      expect(signal).toBeInstanceOf(AbortSignal);
      if(mode==="headers-hang") return new Promise<Response>((_resolve,reject)=>{
        const abort=()=>reject(new DOMException("aborted","AbortError"));
        if(signal!.aborted) abort(); else signal!.addEventListener("abort",abort,{once:true});
      });
      return new Response(new ReadableStream({start(controller){
        const abort=()=>controller.error(new DOMException("aborted","AbortError"));
        if(signal!.aborted) abort(); else signal!.addEventListener("abort",abort,{once:true});
      }}),{headers:{"content-type":"text/event-stream"}});
    }
    if(init?.method==="POST" && url.endsWith("/runs")){starts++;return Response.json({run_id:"remote"});}
    return Response.json({thread_id:"thread",status:"success"});
  }));
  const provider=new DeepAgentModelProvider({baseUrl:"http://kernel.invalid",timeoutMs:40,pollIntervalMs:1});
  const begun=Date.now();
  await expect(provider.complete({modelProvider:"deep-agent",modelId:"test",system:"",user:"hi",onSkillActivity:async()=>{}}))
    .rejects.toMatchObject({code:"MODEL_CALL_FAILED",detail:"skill_activity_delivery_unavailable"});
  expect(Date.now()-begun).toBeLessThan(1000);
  expect(starts).toBe(1);
});

/**
 * 反证（#3292 复核 §4 (d)）：代理 / LB 在一个**干净的帧边界**上掐断 SSE，图还在继续
 * 产生 skill 事实。字节层面它与「join 流正常关闭」完全一样（都是干净 EOF + 状态非终态），
 * 而轮询路径**一条 skill 事实都不投递**（`emitNewToolEvents` 只提取 tool 事件）。
 * 若落回时只轮询，结果就是 run 报 success、事实册子缺 `fact2`、没有任何人知道。
 */
it("re-opens the stream instead of silently polling when a clean EOF leaves the run non-terminal", async () => {
  const fact2 = { ...fact, factId: "fact2", stage: "body_read" as const };
  let streamOpens = 0, starts = 0, statusReads = 0;
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    if (url.endsWith("/stream")) {
      streamOpens++;
      const payload = streamOpens === 1 ? fact : streamOpens === 2 ? fact2 : null;
      // 干净的帧边界上结束：没有半帧残留，`tryStreamRun` 返回 true。
      return new Response(payload === null ? "" : `event: custom\ndata: ${JSON.stringify({type:"skill_activity",version:1,fact:payload})}\n\n`,
        {headers:{"content-type":"text/event-stream"}});
    }
    if (init?.method === "POST" && url.endsWith("/runs")) { starts++; return Response.json({run_id:"remote"}); }
    if (url.endsWith("/state")) return Response.json({values:{messages:[{type:"ai",id:"final",content:"done"}]}});
    if (url.endsWith("/runs/remote")) { statusReads++; return Response.json({status: statusReads === 1 ? "pending" : "success"}); }
    return Response.json({thread_id:"thread",status:"idle"});
  }));
  const seen: string[] = [];
  const provider = new DeepAgentModelProvider({baseUrl:"http://kernel.invalid",streamEnabled:false,timeoutMs:2000,pollIntervalMs:1});
  await provider.completeWithProgress({modelProvider:"deep-agent",modelId:"test",system:"",user:"hi",threadId:"thread",
    onSkillActivity:async(f)=>{seen.push(f.factId);}}, async()=>{});
  // 掐断之后那条事实必须仍然到账——不许 run 报成功而册子缺页。
  expect(seen).toEqual(["fact1","fact2"]);
  expect(streamOpens).toBe(2);
  expect(starts).toBe(1); // 重开流，不是重投 run
});

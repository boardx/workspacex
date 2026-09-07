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
    if(url.endsWith("/stream"))return new Response(`event: custom\ndata: ${JSON.stringify({type:"skill_activity",version:1,fact})}\n\n`);
    if(init?.method==="POST" && url.endsWith("/runs")){bodies.push(JSON.parse(String(init.body)));return Response.json({run_id:"remote"});}
    if(url.endsWith("/state"))return Response.json({values:{messages:[{type:"ai",id:"final",content:"done"}]}});
    if(url.endsWith("/runs/remote"))return Response.json({status:"success"});
    return Response.json({thread_id:"thread",status:"idle"});
  }));
  const callback=vi.fn(async()=>{});
  const provider=new DeepAgentModelProvider({baseUrl:"http://kernel.invalid",streamEnabled:true,timeoutMs:1000,pollIntervalMs:1});
  await provider.completeWithProgress({modelProvider:"deep-agent",modelId:"test",system:"",user:"hi",threadId:"thread",...(resume?{resume:{decision:"approve" as const}}:{}),onSkillActivity:callback},async()=>{});
  expect(callback).toHaveBeenCalledWith(fact);
  expect(bodies[0]).toMatchObject({stream_mode:["messages-tuple","updates","custom"]});
  await expect(provider.completeWithProgress({modelProvider:"deep-agent",modelId:"test",system:"",user:"hi",onSkillActivity:async()=>{throw new Error("writer_failed");}},async()=>{})).rejects.toThrow("writer_failed");
});

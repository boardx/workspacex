import { EventType } from "@ag-ui/core";
import { createExecutionJournalRelay } from "../../src/interface/controllers/execution-journal-relay";
import { expect, it, vi } from "vitest";
import { ConfiguredModelProvider } from "../../src/infrastructure/agent-run/configured-model-provider";
for (const fragments of [["one"], ["The ","answer ","streams ","now."]]) it(`binds ${fragments.length} fragments to the actual single completion`,async()=>{
  const provider=new ConfiguredModelProvider({provider:"test",baseUrl:"http://unused.invalid",apiKey:"test",streamEnabled:true,timeoutMs:1000,visionModelIds:new Set(),thinkingDisableModelIds:new Set(),bailianExtensionsEnabled:false});
  const frames=fragments.map(content=>`data: ${JSON.stringify({choices:[{delta:{content}}]})}\n\n`).join("")+"data: [DONE]\n\n";
  // Replace transport only; exercise the actual production SSE parser without a server.
  vi.spyOn(provider as unknown as {postCompletions:()=>Promise<Response>},"postCompletions").mockResolvedValue(new Response(frames));
  const received:{delta:string;id?:string}[]=[];
  const result=await provider.completeStream!({modelProvider:"test",modelId:"model",system:"",user:"hi"},async(delta,metadata)=>{received.push({delta,id:metadata?.messageId});});
  expect(result.finalMessageId).toBeTruthy();
  expect(received).toEqual(fragments.map(delta=>({delta,id:result.finalMessageId})));
  expect(result.text).toBe(fragments.join(""));
  const wire: {type:EventType}[]=[];
  const relay=createExecutionJournalRelay(event=>wire.push(event));
  const base={runId:"run",attemptId:"attempt",emittedAt:new Date().toISOString()};
  received.forEach((item,seq)=>relay.accept({...base,seq,kind:"text_delta",messageId:`attempt:${item.id}`,delta:item.delta}));
  relay.accept({...base,seq:received.length,kind:"final_message",messageId:`attempt:${result.finalMessageId}`});
  relay.finish("persisted",result.text);
  expect(wire.filter(event=>event.type===EventType.TEXT_MESSAGE_CONTENT)).toHaveLength(fragments.length);

});

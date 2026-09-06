import {describe,expect,it} from "vitest";
import {legacyExecutionEvents} from "../../src/application/agent-run/legacy-execution-events";
describe("legacy public replay",()=>{
 it("preserves recorded order and failure without fabricating starts or timestamps",()=>{
  const at="2026-09-01T00:00:00.000Z";
  const events=legacyExecutionEvents("r",[{seq:3,kind:"tool_call",status:"failed",startedAt:at,endedAt:at,toolCallId:"old",toolName:"call_skill",args:null,result:'{"password":"secret","error":"failed"}'}],[{seq:1,text:"public historical output",createdAt:at}],{status:"failed",endedAt:at});
  expect(events.map(event=>event.kind)).toEqual(["text_delta","tool_end","status"]);
  expect(events.every(event=>event.source==="legacy" && event.emittedAt===at)).toBe(true);
  expect(events[1]).toMatchObject({ok:false,result:{password:"[REDACTED]",error:"failed"}});
  expect(legacyExecutionEvents("r",[],[])).toEqual([]);
 });
});

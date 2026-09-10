import { describe, expect, it } from "vitest";
import { EventType } from "@ag-ui/core";
import { createExecutionJournalRelay } from "../../src/interface/controllers/execution-journal-relay";
import type { ExecutionEvent } from "@repo/contracts/execution-journal";

describe("workbench AG-UI relay", () => {
  it("streams text immediately, closes commentary at tool start, and reports a result only at actual completion", () => {
    const wire: { type: EventType; messageId?: string; toolCallId?: string; delta?: string }[] = [];
    const relay = createExecutionJournalRelay((event) => wire.push(event));
    const base = { runId: "run", emittedAt: "2026-09-07T00:00:00Z", attemptId: "attempt" };
    relay.accept({ ...base, seq: 0, kind: "text_delta", messageId: "progress", delta: "Checking" });
    expect(wire.at(-1)).toMatchObject({ type: EventType.TEXT_MESSAGE_CONTENT, delta: "Checking" });
    relay.accept({ ...base, seq: 1, kind: "tool_start", toolCallId: "tool", toolName: "call_skill", args: { name: "research" } });
    expect(wire.some((event) => event.type === EventType.TOOL_CALL_RESULT)).toBe(false);
    expect(wire.filter((event) => event.type !== EventType.CUSTOM).map((event) => event.type)).toEqual([
      EventType.TEXT_MESSAGE_START, EventType.TEXT_MESSAGE_CONTENT, EventType.TEXT_MESSAGE_END,
      EventType.STEP_STARTED, EventType.TOOL_CALL_START, EventType.TOOL_CALL_ARGS, EventType.TOOL_CALL_END,
    ]);
    relay.accept({ ...base, seq: 2, kind: "tool_end", toolCallId: "tool", toolName: "call_skill", ok: false, result: "Failed" });
    const final: ExecutionEvent = { ...base, seq: 3, kind: "text_delta", messageId: "final", delta: "The result" };
    relay.accept(final);
    expect(wire.at(-1)).toMatchObject({ type: EventType.TEXT_MESSAGE_CONTENT, messageId: "final", delta: "The result" });
    const beforeReplay = wire.length;
    relay.accept(final);
    expect(wire).toHaveLength(beforeReplay);
    expect(relay.accept({ ...base, seq: 4, kind: "final_message", messageId: "final" })).toEqual({ messageId: "final", sawText: true });
    relay.close(); relay.close();
    expect(wire.filter((event) => event.type === EventType.TEXT_MESSAGE_END && event.messageId === "final")).toHaveLength(1);
  });
});

it('preserves non-streamed planning and tool brackets without fabricating early completion',()=>{
 const wire: {type:EventType;delta?:string}[]=[];const relay=createExecutionJournalRelay(e=>wire.push(e));
 relay.accept({runId:'r',seq:0,emittedAt:'now',kind:'tool_start',toolCallId:'c',toolName:'read_file',args:{},planningNote:'I will read the file.'});
 expect(wire.filter(e=>e.type!==EventType.CUSTOM).map(e=>e.type)).toEqual([EventType.STEP_STARTED,EventType.TEXT_MESSAGE_START,EventType.TEXT_MESSAGE_CONTENT,EventType.TEXT_MESSAGE_END,EventType.TOOL_CALL_START,EventType.TOOL_CALL_ARGS,EventType.TOOL_CALL_END]);
 expect(wire.some(e=>e.type===EventType.STEP_FINISHED)).toBe(false);
 relay.accept({runId:'r',seq:1,emittedAt:'now',kind:'tool_end',toolCallId:'c',toolName:'read_file',ok:true,result:'ok'});
 expect(wire.at(-1)?.type).toBe(EventType.STEP_FINISHED);
});
it('final identity avoids duplicate text, while an unconfirmed identity still falls back honestly',()=>{
 for(const confirmed of [true,false]){
  const wire:{type:EventType;delta?:string}[]=[];const relay=createExecutionJournalRelay(e=>wire.push(e));
  relay.accept({runId:'r',seq:0,emittedAt:'now',kind:'text_delta',messageId:'attempt:assistant',delta:'answer'});
  if(confirmed)relay.accept({runId:'r',seq:1,emittedAt:'now',kind:'final_message',messageId:'attempt:assistant'});
  relay.finish('stored','answer');
  expect(wire.filter(e=>e.type===EventType.TEXT_MESSAGE_CONTENT)).toHaveLength(confirmed?1:2);
 }
});
/*
 * issue #3397（#3394 回退后的看守用例）—— 多气泡轮次**必须**照旧走撤回重发。
 *
 * #3394 曾让「多条气泡拼起来等于落库那行」也被接受、映射指向最后一条。实测三条真回归
 * （chat-read：7 failed / 113 passed，基线 3 / 117）。原因是协议事实：`chat_message_id`
 * 只有一个 `streamingMessageId`，**一个映射只能认领一条气泡**——没被认领的前几条会留在
 * 页面上，同一句话出现两次。放宽的正解是协议扩展，见 #3397；在那之前本用例把等号钉住。
 */
it('多气泡轮次照旧撤回重发——一个映射只能认领一条气泡（#3397 之前不得放宽）',()=>{
 const wire:{type:EventType;name?:string;delta?:string}[]=[];const relay=createExecutionJournalRelay(e=>wire.push(e as never));
 relay.accept({runId:'r',seq:0,emittedAt:'now',kind:'text_delta',messageId:'a1',delta:'第一段'});
 relay.accept({runId:'r',seq:1,emittedAt:'now',kind:'tool_start',toolCallId:'c',toolName:'get_time',args:{}});
 relay.accept({runId:'r',seq:2,emittedAt:'now',kind:'tool_end',toolCallId:'c',toolName:'get_time',ok:true,result:'x'});
 relay.accept({runId:'r',seq:3,emittedAt:'now',kind:'text_delta',messageId:'a2',delta:'第二段'});
 const carrier=relay.finish('stored','第一段\n\n第二段');
 expect(wire.filter(e=>e.type===EventType.CUSTOM&&e.name==='assistant_message_replaced')).toHaveLength(1);
 expect(wire.filter(e=>e.type===EventType.TEXT_MESSAGE_CONTENT).at(-1)?.delta).toBe('第一段\n\n第二段');
 expect(carrier).toBe('a1');
});
it('落库那行与已流出的字对不上时，替换兜底照旧生效',()=>{
 const wire:{type:EventType;name?:string;delta?:string}[]=[];const relay=createExecutionJournalRelay(e=>wire.push(e as never));
 relay.accept({runId:'r',seq:0,emittedAt:'now',kind:'text_delta',messageId:'attempt:assistant',delta:'预告'});
 const carrier=relay.finish('stored','另一份终稿');
 expect(wire.filter(e=>e.type===EventType.CUSTOM&&e.name==='assistant_message_replaced')).toHaveLength(1);
 expect(wire.filter(e=>e.type===EventType.TEXT_MESSAGE_CONTENT).at(-1)?.delta).toBe('另一份终稿');
 expect(carrier).toBe('attempt:assistant');
});
it.each([true, false])("plan snapshots follow their actual result regardless of step read timing (step first=%s)", stepFirst => {
  const wire: { type: EventType }[] = [];
  const relay = createExecutionJournalRelay(event => wire.push(event));
  const step = { toolName: "write_todos", status: "succeeded", toolArgsSummary: JSON.stringify({ todos: [{ content: "real plan", status: "pending" }] }) };
  const end: ExecutionEvent = { runId: "run", emittedAt: "2026-09-07T00:00:00Z", seq: 0, kind: "tool_end", toolCallId: "call", toolName: "write_todos", ok: true, result: "done" };
  if (stepFirst) relay.acceptPlanStep(step); else relay.accept(end);
  expect(wire.some(event => event.type === EventType.STATE_SNAPSHOT)).toBe(false);
  if (stepFirst) relay.accept(end); else relay.acceptPlanStep(step);
  expect(wire.slice(-2).map(event => event.type)).toEqual([EventType.TOOL_CALL_RESULT, EventType.STATE_SNAPSHOT]);
  relay.accept(end);
  expect(wire.filter(event => event.type === EventType.STATE_SNAPSHOT)).toHaveLength(1);
});
it("failed and malformed plan occurrences consume ordering slots without manufacturing snapshots", () => {
  const wire: { type: EventType }[] = []; const relay = createExecutionJournalRelay(event => wire.push(event));
  for (const [seq, status, summary] of [[0, "failed", '{"todos":[]}'], [1, "succeeded", '{broken']] as const) {
    relay.acceptPlanStep({toolName:"write_todos",status,toolArgsSummary:summary});
    relay.accept({runId:"run",emittedAt:"2026-09-07T00:00:00Z",seq,kind:"tool_end",toolCallId:`call-${seq}`,toolName:"write_todos",ok:status==="succeeded",result:null});
  }
  expect(wire.filter(event => event.type === EventType.STATE_SNAPSHOT)).toHaveLength(0);
  relay.acceptPlanStep({ toolName: "write_todos", status: "succeeded", toolArgsSummary: JSON.stringify({ todos: [{ content: "plan C", status: "pending" }] }) });
  relay.accept({ runId: "run", emittedAt: "2026-09-07T00:00:00Z", seq: 2, kind: "tool_end", toolCallId: "call-C", toolName: "write_todos", ok: true, result: null });
  expect(wire.filter(event => event.type === EventType.STATE_SNAPSHOT)).toEqual([
    { type: EventType.STATE_SNAPSHOT, snapshot: { todos: [{ content: "plan C", status: "pending" }] } },
  ]);
});

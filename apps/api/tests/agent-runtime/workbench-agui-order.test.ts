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
/*
 * issue #3389 —— 身份判据从「账本给了 `final_message` 吗」改成「wire 上已经流出去的字
 * 是不是就是落库那行」。`final_message` 缺席（`tool_start` 把它清掉、或上游根本不给）
 * 时**不再**重发一遍：那正是用户看到「正文出来又消失」的来源。
 *
 * 本用例此前逐字断言的是那条假阴性（`confirmed?1:2`），现在断言的是收敛后的不变量：
 * 字对得上 ⇒ 一条都不多发；字对不上 ⇒ 照旧走替换兜底（#3069 的承诺不动）。
 */
it('已流出的正文逐字等于落库那行时不重发——不论账本给没给 final_message',()=>{
 for(const confirmed of [true,false]){
  const wire:{type:EventType;delta?:string}[]=[];const relay=createExecutionJournalRelay(e=>wire.push(e));
  relay.accept({runId:'r',seq:0,emittedAt:'now',kind:'text_delta',messageId:'attempt:assistant',delta:'answer'});
  if(confirmed)relay.accept({runId:'r',seq:1,emittedAt:'now',kind:'final_message',messageId:'attempt:assistant'});
  const carrier=relay.finish('stored','answer');
  expect(wire.filter(e=>e.type===EventType.TEXT_MESSAGE_CONTENT)).toHaveLength(1);
  expect(wire.some(e=>e.type===EventType.CUSTOM&&(e as {name?:string}).name==='assistant_message_replaced')).toBe(false);
  // #3069：映射指向那条流式气泡，绝不是落库主键的自映射。
  expect(carrier).toBe('attempt:assistant');
 }
});
/*
 * issue #3389 —— 多气泡轮次（#3243 的分步产出：先流一段正文、调工具、再流一段）**必须
 * 照旧走替换兜底**。
 *
 * 本用例曾经短暂地断言过相反的事（「拼得出等号就不重发，映射指向最后一条」），在
 * chat-read 车道上被实测反证：不撤回意味着 wire 上留下 N 条气泡，而 `chat_message_id`
 * 只能映射其中一条，前端权威读于是只换掉最后那条、前面那些原样留着——一轮里同一段话
 * 出现两次。三条同 SHA 基线上绿的 spec 当场转红。判据是「一条映射只能认领一条气泡」
 * 这个协议事实，不是措辞。
 */
it('多气泡轮次照旧撤回重发——一条映射只能认领一条气泡',()=>{
 const wire:{type:EventType;name?:string;delta?:string}[]=[];const relay=createExecutionJournalRelay(e=>wire.push(e as never));
 relay.accept({runId:'r',seq:0,emittedAt:'now',kind:'text_delta',messageId:'a1',delta:'第一段'});
 relay.accept({runId:'r',seq:1,emittedAt:'now',kind:'tool_start',toolCallId:'c',toolName:'get_time',args:{}});
 relay.accept({runId:'r',seq:2,emittedAt:'now',kind:'tool_end',toolCallId:'c',toolName:'get_time',ok:true,result:'x'});
 relay.accept({runId:'r',seq:3,emittedAt:'now',kind:'text_delta',messageId:'a2',delta:'第二段'});
 const carrier=relay.finish('stored','第一段\n\n第二段');
 // 撤回覆盖**全部**已流出的气泡，替换后 wire 上只剩一条承载整段落库正文的气泡。
 const replaced=wire.filter(e=>e.type===EventType.CUSTOM&&e.name==='assistant_message_replaced');
 expect(replaced).toHaveLength(1);
 expect((replaced[0] as unknown as {value:{replacedMessageIds:string[]}}).value.replacedMessageIds).toEqual(['a1','a2']);
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

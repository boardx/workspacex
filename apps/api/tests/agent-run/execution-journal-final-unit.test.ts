/**
 * ⚠ issue #3069 —— 兜底路径由「另起一条以落库主键为 id 的气泡」改为**在已流出的那条
 * 气泡上替换**（撤回旧正文 → 用同一个 id 重发落库正文）。本文件两条兜底用例因此改了
 * 断言的 id，**没有放宽任何不变量**：
 *
 *   · 「落库正文必须完整地出现在 wire 上」——照旧逐字断言最后那帧 CONTENT；
 *   · 「兜底不得静默吞掉修复」——多断言了一帧撤回事件必须先于它到达。
 *
 * 变的只是承载它的气泡 id：从落库主键换回流式 id。理由见 relay 的 `finish()` 注释与
 * `@repo/contracts/agui-state-events` 的 `AGUI_ASSISTANT_MESSAGE_REPLACED_EVENT_NAME`
 * ——旧形态会让一轮里出现两条互相矛盾的 assistant 正文，并把 `chat_message_id` 退化成
 * 自映射（落地按钮因此拿不到真实主键）。
 */
import { expect, it } from "vitest";
import { EventType } from "@ag-ui/core";
import { AGUI_ASSISTANT_MESSAGE_REPLACED_EVENT_NAME } from "@repo/contracts/agui-state-events";
import { createExecutionJournalRelay } from "../../src/interface/controllers/execution-journal-relay";
const base = { runId: "run", emittedAt: "2026-09-07T00:00:00Z" };
it("sends authoritative persisted final after an upstream without final message identity", () => {
  const events: any[] = [];
  const relay = createExecutionJournalRelay(event => events.push(event));
  relay.accept({ ...base, seq: 1, kind: "text_delta", messageId: "attempt:assistant", delta: "旧的过程正文" });
  expect(relay.finish("persisted", "已按原参数执行")).toBe("attempt:assistant");
  expect(events.filter(event => event.type === EventType.TEXT_MESSAGE_CONTENT).at(-1)).toMatchObject({messageId: "attempt:assistant", delta: "已按原参数执行"});
  expect(events.some(event => event.type === EventType.CUSTOM && event.name === AGUI_ASSISTANT_MESSAGE_REPLACED_EVENT_NAME)).toBe(true);
});
it("suppresses duplicate final only when identified final bytes streamed completely", () => {
  const events: any[] = [];
  const relay = createExecutionJournalRelay(event => events.push(event));
  relay.accept({ ...base, seq: 1, kind: "text_delta", messageId: "attempt:final", delta: "完整回复" });
  relay.accept({ ...base, seq: 2, kind: "final_message", messageId: "attempt:final" });
  expect(relay.finish("persisted", "完整回复")).toBe("attempt:final");
  expect(events.filter(event => event.type === EventType.TEXT_MESSAGE_CONTENT)).toHaveLength(1);
});
it("repairs a truncated final stream even with a genuine final identity", () => {
  const events: any[] = [];
  const relay = createExecutionJournalRelay(event => events.push(event));
  relay.accept({ ...base, seq: 1, kind: "text_delta", messageId: "attempt:final", delta: "完整" });
  relay.accept({ ...base, seq: 2, kind: "final_message", messageId: "attempt:final" });
  expect(relay.finish("persisted", "完整回复")).toBe("attempt:final");
  expect(events.at(-2)).toMatchObject({messageId: "attempt:final", delta: "完整回复"});
  expect(events.some(event => event.type === EventType.CUSTOM && event.name === AGUI_ASSISTANT_MESSAGE_REPLACED_EVENT_NAME)).toBe(true);
});

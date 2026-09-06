import { expect, it } from "vitest";
import { EventType } from "@ag-ui/core";
import { createExecutionJournalRelay } from "../../src/interface/controllers/execution-journal-relay";
const base = { runId: "run", emittedAt: "2026-09-07T00:00:00Z" };
it("sends authoritative persisted final after an upstream without final message identity", () => {
  const events: any[] = [];
  const relay = createExecutionJournalRelay(event => events.push(event));
  relay.accept({ ...base, seq: 1, kind: "text_delta", messageId: "attempt:assistant", delta: "旧的过程正文" });
  expect(relay.finish("persisted", "已按原参数执行")).toBe("persisted");
  expect(events.filter(event => event.type === EventType.TEXT_MESSAGE_CONTENT).at(-1)).toMatchObject({messageId: "persisted", delta: "已按原参数执行"});
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
  expect(relay.finish("persisted", "完整回复")).toBe("persisted");
  expect(events.at(-2)).toMatchObject({messageId: "persisted", delta: "完整回复"});
});

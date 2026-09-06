import { expect, it } from "vitest";
import { restoreFinalMessages } from "@/lib/chat-workbench/restore-final-messages";
it("replaces a partial streamed reply after recovery without duplicating the final or removing another turn", () => {
  const restored = [{ id: "persisted", role: "assistant" as const, content: "完整回复", authorId: "agent", agentRunId: "run", rateable: true }];
  const events = [{ runId: "run", seq: 3, kind: "final_message" as const, messageId: "attempt:remote-message", emittedAt: "2026-09-07T00:00:00Z" }];
  const result = restoreFinalMessages([{ id: "other", role: "assistant", content: "另一轮" }, { id: "attempt:remote-message", role: "assistant", content: "完整" }], events, restored);
  expect(result.map((message) => message.id)).toEqual(["other", "persisted"]);
  expect(restoreFinalMessages(result, events, restored)).toEqual(result);
});
it("replaces known stale stream aliases with persisted authoritative content without losing another run", () => {
  const restored = [{ id: "persisted", role: "assistant" as const, content: "已按原参数执行", authorId: "agent", agentRunId: "run", rateable: true }];
  const current = [{id: "prior", role: "assistant", content: "以前一轮"}, {id: "attempt:assistant", role: "assistant", content: "MOUNTPROOF"}, {id: "persisted", role: "assistant", content: "残句"}];
  const resolve = (id: string) => id === "attempt:assistant" ? "persisted" : null;
  const result = restoreFinalMessages(current, [], restored, resolve);
  expect(result.map(message => message.id)).toEqual(["prior", "persisted"]);
  expect(result.at(-1)?.content).toBe("已按原参数执行");
  expect(restoreFinalMessages(result, [], restored, resolve)).toEqual(result);
});

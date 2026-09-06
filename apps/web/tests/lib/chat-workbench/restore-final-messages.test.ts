import { expect, it } from "vitest";
import { restoreFinalMessages } from "@/lib/chat-workbench/restore-final-messages";
it("replaces a partial streamed reply after recovery without duplicating the final or removing another turn", () => {
  const restored = [{ id: "persisted", role: "assistant" as const, content: "完整回复", authorId: "agent", agentRunId: "run", rateable: true }];
  const events = [{ runId: "run", seq: 3, kind: "final_message" as const, messageId: "attempt:remote-message", emittedAt: "2026-09-07T00:00:00Z" }];
  const result = restoreFinalMessages([{ id: "other", role: "assistant", content: "另一轮" }, { id: "attempt:remote-message", role: "assistant", content: "完整" }], events, restored);
  expect(result.map((message) => message.id)).toEqual(["other", "persisted"]);
  expect(restoreFinalMessages(result, events, restored)).toEqual(result);
});

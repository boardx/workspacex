import { expect, it } from "vitest";
import { restoreFinalMessages } from "@/lib/chat-workbench/restore-final-messages";
it("replaces a partial streamed reply after recovery without duplicating the final or removing another turn", () => {
  const restored = [{ id: "persisted", role: "assistant" as const, content: "完整回复", authorId: "agent", agentRunId: "run", rateable: true, clientMessageId: null }];
  const events = [{ runId: "run", seq: 3, kind: "final_message" as const, messageId: "attempt:remote-message", emittedAt: "2026-09-07T00:00:00Z" }];
  const result = restoreFinalMessages([{ id: "other", role: "assistant", content: "另一轮" }, { id: "attempt:remote-message", role: "assistant", content: "完整" }], events, restored);
  expect(result.map((message) => message.id)).toEqual(["other", "persisted"]);
  expect(restoreFinalMessages(result, events, restored)).toEqual(result);
});
it("replaces known stale stream aliases with persisted authoritative content without losing another run", () => {
  const restored = [{ id: "persisted", role: "assistant" as const, content: "已按原参数执行", authorId: "agent", agentRunId: "run", rateable: true, clientMessageId: null }];
  const current: Parameters<typeof restoreFinalMessages>[0] = [{id: "prior", role: "assistant", content: "以前一轮"}, {id: "attempt:assistant", role: "assistant", content: "MOUNTPROOF"}, {id: "persisted", role: "assistant", content: "残句"}];
  const resolve = (id: string) => id === "attempt:assistant" ? "persisted" : null;
  const result = restoreFinalMessages(current, [], restored, resolve);
  expect(result.map(message => message.id)).toEqual(["prior", "persisted"]);
  expect(result.at(-1)?.content).toBe("已按原参数执行");
  expect(restoreFinalMessages(result, [], restored, resolve)).toEqual(result);
});

/*
 * issue #3399 ① —— 按**发送时刻**排序，不是按"什么时候落库"排。
 *
 * 人类实测（devapp）：研究正文已经流完，用户随后插话「总结成一个 pdf」，结果这句话
 * 被渲染在研究正文**上方**——用户去消息流底部找自己刚发的话，找不到。
 *
 * 机制就在这个函数里：它把认领到的落库消息**一律追加到队尾**，于是 run 收尾那一刻，
 * 本轮的助手正文从它原本的位置被摘下来、重新挂到所有后发消息的后面。任何在 run
 * 期间追加进来的消息（插话气泡是最常见的一种）都会因此被"顶"到正文上方。
 *
 * 断言落在顺序上而不是"消息存在"上：现状已经满足"两条消息都在"，那种断言无法被证伪。
 */
it("keeps the restored reply where it was streamed, below nothing that arrived after it", () => {
  const restored = [{ id: "persisted", role: "assistant" as const, content: "研究正文", authorId: "agent", agentRunId: "run", rateable: true, clientMessageId: null }];
  const events = [{ runId: "run", seq: 9, kind: "final_message" as const, messageId: "attempt:reply", emittedAt: "2026-09-11T00:00:00Z" }];
  // 发送时刻顺序：提问(T1) → 助手正文(T2，流式) → 插话(T3，用户在正文之后发的)
  const current: Parameters<typeof restoreFinalMessages>[0] = [
    { id: "ask", role: "user", content: "研究一下" },
    { id: "attempt:reply", role: "assistant", content: "研究正文（流式残句）" },
    { id: "interjection:1", role: "user", content: "总结成一个 pdf" },
  ];
  const result = restoreFinalMessages(current, events, restored);
  expect(result.map((message) => message.id)).toEqual(["ask", "persisted", "interjection:1"]);
  // 幂等：再收敛一次不许再挪位置。
  expect(restoreFinalMessages(result, events, restored)).toEqual(result);
});

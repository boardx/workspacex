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
  const current: Parameters<typeof restoreFinalMessages>[0] = [{id: "prior", role: "assistant", content: "以前一轮"}, {id: "attempt:assistant", role: "assistant", content: "MOUNTPROOF"}, {id: "persisted", role: "assistant", content: "残句"}];
  const resolve = (id: string) => id === "attempt:assistant" ? "persisted" : null;
  const result = restoreFinalMessages(current, [], restored, resolve);
  expect(result.map(message => message.id)).toEqual(["prior", "persisted"]);
  expect(result.at(-1)?.content).toBe("已按原参数执行");
  expect(restoreFinalMessages(result, [], restored, resolve)).toEqual(result);
});

/**
 * issue #3389 —— 权威读与在途正文**逐字相同**时，这里必须无事可做。
 *
 * 无条件替换换掉的只有 React 身份（旧节点卸载、新节点挂载），`chat-ai-markdown` 因此
 * 有一帧是空的。chat-read 车道上的真实采样序列 `[0,24,64,104,152,190,0,190]` 末尾那
 * 两个数相等——正文没变，只是消失了一下又回来。
 *
 * ⚠ 反证纪律：把 `restore-final-messages.ts` 里的 `settled` 那段删掉、退回无条件
 * 「摘掉 + 追加」，下面第一条 `it` 当场红在「气泡对象与 id 应原样不动」上。
 */
it("#3389 落库字节与气泡上已显示的逐字相同 ⇒ 原对象、原位置、原 id 全部不动（不卸载重挂）", () => {
  const restored = [{ id: "persisted", role: "assistant" as const, content: "同一句话", authorId: "agent", agentRunId: "run", rateable: true }];
  const streamed: Parameters<typeof restoreFinalMessages>[0][number] = { id: "attempt:m1", role: "assistant", content: "同一句话" };
  const prior: Parameters<typeof restoreFinalMessages>[0][number] = { id: "prior", role: "assistant", content: "上一轮" };
  const resolve = (id: string) => (id === "attempt:m1" ? "persisted" : null);
  const result = restoreFinalMessages([prior, streamed], [], restored, resolve);
  // 同一个对象引用（不只是同 id）——React 因此连 key 都没变，不会卸载重挂。
  expect(result).toEqual([prior, streamed]);
  expect(result[1]).toBe(streamed);
  expect(result.map((m) => m.id)).toEqual(["prior", "attempt:m1"]);
  // 幂等：再跑一次仍然什么都不动。
  expect(restoreFinalMessages(result, [], restored, resolve)).toEqual(result);
});

it("#3389 字节真的分叉时照旧原样替换——判的是字节是否相等，不是「有在途文本就跳过权威读」", () => {
  const restored = [{ id: "persisted", role: "assistant" as const, content: "落库的完整版", authorId: "agent", agentRunId: "run", rateable: true }];
  const resolve = (id: string) => (id === "attempt:m1" ? "persisted" : null);
  const result = restoreFinalMessages([{ id: "attempt:m1", role: "assistant", content: "被掐断的半截" }], [], restored, resolve);
  expect(result.map((m) => m.id)).toEqual(["persisted"]);
  expect(result[0]?.content).toBe("落库的完整版");
});

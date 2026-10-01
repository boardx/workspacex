/**
 * issue #4344 ⑤ —— 2026-09-27 devapp：用户问「为什么你没有记忆下来我的目标？」，回复里同一句话出现了两次。
 *
 * 一轮的正文 = 本轮全部顶层 AI 正文拼起来（#3243：分步产出的画布一段都不能丢）。模型在工具调用**之前**先说了一句
 * 预告，工具回来后又把**同一句话原样重说一遍**再往下接——两段不是逐字相同（后一段更长），旧规则只去逐字重复，
 * 于是预告在正文里出现两次。新规则：后一段以前面某一段开头 ⇒ 前面那段就是被重说的预告，只留后一段。
 * 拼法只定义在 `composeAguiAssistantBodies`（relay、web 恢复、模型写回同一份），这里从写回入口验。
 */
import { describe, expect, it } from "vitest";
import { joinTurnAssistantBodies, readTurnReply } from "../../src/infrastructure/agent-run/deep-agent-model-provider";

const PREAMBLE = "我来帮你把这个目标记下来。";
const AFTER_TOOL = `${PREAMBLE}已在这条回答下方放了一张确认卡，你点「记住」之后才会记到长期记忆。`;

describe("joinTurnAssistantBodies：工具前的预告在工具后被重说，只出现一次", () => {
  it("devapp 的形状：预告 → 工具调用 → 工具结果 → 以同一句开头的正文", () => {
    const messages = [
      { type: "ai", content: PREAMBLE, id: "a1", tool_calls: [{ id: "c1", name: "wx_remember", args: { statement: "用户的目标是今年跑完半马" } }] },
      { type: "tool", content: "{\"outcome\":\"card_opened\"}", id: "t1", tool_call_id: "c1" },
      { type: "ai", content: AFTER_TOOL, id: "a2" },
    ];
    const text = joinTurnAssistantBodies(messages as never);
    expect(text).toBe(AFTER_TOOL);
    expect(text.split(PREAMBLE)).toHaveLength(2);
  });

  it("走写回的真实入口（按本轮锚点切）结果一样", () => {
    const messages = [
      { type: "human", content: "为什么你没有记忆下来我的目标？", id: "wsx-turn:run-4344:user" },
      { type: "ai", content: PREAMBLE, id: "a1" },
      { type: "tool", content: "{}", id: "t1", tool_call_id: "c1" },
      { type: "ai", content: AFTER_TOOL, id: "a2" },
    ];
    expect(readTurnReply(messages as never, "run-4344")).toBe(AFTER_TOOL);
  });

  it("#3243 的意图不变：不同的分步正文全部保留、顺序不变", () => {
    const messages = [
      { type: "ai", content: "第 1 个画布", id: "a" },
      { type: "tool", content: "{}", id: "t" },
      { type: "ai", content: "第 2 个画布", id: "b" },
      { type: "ai", content: "两个画布都已交付。", id: "c" },
    ];
    expect(joinTurnAssistantBodies(messages as never)).toBe("第 1 个画布\n\n第 2 个画布\n\n两个画布都已交付。");
  });
});

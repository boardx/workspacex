/**
 * UIUX r1 屏 4 P0-2 —— 线程标题不许泄漏回环/工具控制标记（侧栏曾出现
 * 「UIUX 这个需求请产品经理接手 [request_handoff:D003]」「UIUX [start_workflow:W0…]」）。
 */
import { describe, expect, it } from "vitest";
import { chat } from "@repo/contracts";
import { clampModelGeneratedTitle, deriveThreadTitle } from "../../src/domain/chat/thread-title";
import { buildTitleEvidence } from "../../src/domain/chat/thread-title-algorithm";

describe("线程标题剥控制标记", () => {
  it("截图那一条：去掉 [request_handoff:D003]", () => {
    expect(deriveThreadTitle("UIUX 这个需求请产品经理接手 [request_handoff:D003]")).toBe("UIUX 这个需求请产品经理接手");
  });

  it("多个标记（含 evidence）都剥掉，不留多余空白", () => {
    expect(deriveThreadTitle("[start_workflow:W029] UIUX [evidence:v-1] 评审")).toBe("UIUX 评审");
  });

  it("只有标记时没有可用输入 ⇒ null（不起一个空标题）", () => {
    expect(deriveThreadTitle("[start_workflow:W029]")).toBeNull();
  });

  it("模型产出的标题同样剥掉；截断残留的未闭合标记也剥掉", () => {
    expect(clampModelGeneratedTitle("UIUX [start_workflow:W0")).toBe("UIUX");
  });

  it("正常方括号内容不误伤", () => {
    expect(chat.stripControlMarkers("[草稿] 周报 [Q3]")).toBe("[草稿] 周报 [Q3]");
  });

  it("会话摘要里的消息也先剥标记", () => {
    const evidence = buildTitleEvidence([{ role: "human", body: "整理竞品分析报告 [start_workflow:W029]" }], 2);
    expect(evidence).toBe("用户：整理竞品分析报告");
  });
});

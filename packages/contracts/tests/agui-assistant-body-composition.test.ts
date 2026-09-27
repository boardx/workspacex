import { describe, expect, it } from "vitest";
import { composeAguiAssistantBodies } from "../src/agui-state-events";

describe("composeAguiAssistantBodies（一轮若干段助手正文 → 一段）", () => {
  it("issue #4344：工具前的预告在工具后被原样重说再往下接 ⇒ 只出现一次", () => {
    const pre = "我来帮你把这个目标记下来。";
    const post = "我来帮你把这个目标记下来。已在回答下方放了一张确认卡，点「记住」后才会记到长期记忆。";
    expect(composeAguiAssistantBodies([pre, post])).toBe(post);
    // 空白差异不算不同（逐段 trim）
    expect(composeAguiAssistantBodies([`  ${pre}\n`, `\n${post}`])).toBe(post);
  });

  it("#3243 的意图不变：分步产出的不同段全部保留、顺序不变，逐字重复的段只留一条", () => {
    expect(composeAguiAssistantBodies(["第 1 个画布", "第 2 个画布", "两个画布都已交付。"])).toBe("第 1 个画布\n\n第 2 个画布\n\n两个画布都已交付。");
    expect(composeAguiAssistantBodies(["好的。", "", "  ", "好的。", "结果如下。"])).toBe("好的。\n\n结果如下。");
  });

  it("被顶替的预告之后若还有别的段，后一段落在它自己的位置（不插回预告原来的位置）", () => {
    expect(composeAguiAssistantBodies(["先查一下。", "中间一段。", "先查一下。查到了：X。"])).toBe("中间一段。\n\n先查一下。查到了：X。");
  });

  it("只认「整段是后一段的开头」：后一段只是包含前一段、或前一段只是后一段的开头几个字以外的形状，都不合并", () => {
    expect(composeAguiAssistantBodies(["结果是 X。", "补充：结果是 X。"])).toBe("结果是 X。\n\n补充：结果是 X。");
    expect(composeAguiAssistantBodies(["完整的回答。还有下文。", "完整的回答。"])).toBe("完整的回答。还有下文。\n\n完整的回答。");
  });
});

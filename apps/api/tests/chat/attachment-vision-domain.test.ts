/**
 * #1560 · P1 —— 视觉抽取的纯领域件单测：提问协议、回复解析、产物 markdown 合成。
 * 重点是**诚实性反证**：模型没按结构回复时不许臆造转录段；空段落要如实写「未给出」而不是消失。
 */
import { describe, expect, it } from "vitest";
import {
  VISION_PROMPT, VISION_TRANSCRIPT_MARKER, VISION_DESCRIPTION_MARKER,
  composeVisionMarkdown, parseVisionReply,
} from "../../src/domain/chat/attachment-vision";

describe("parseVisionReply", () => {
  it("按结构回复 → 切成转录 + 描述两段", () => {
    const raw = `${VISION_TRANSCRIPT_MARKER}\n季度复盘 2026 Q3\n营收 1200 万\n${VISION_DESCRIPTION_MARKER}\n一张会议幻灯片截图，深色背景。`;
    expect(parseVisionReply(raw)).toEqual({
      transcript: "季度复盘 2026 Q3\n营收 1200 万",
      description: "一张会议幻灯片截图，深色背景。",
    });
  });

  it("未按结构回复 → transcript 为 null（不臆造），全文归描述", () => {
    const r = parseVisionReply("这是一张猫的照片。");
    expect(r.transcript).toBeNull();
    expect(r.description).toBe("这是一张猫的照片。");
  });

  it("标记顺序颠倒 → 同样不猜结构", () => {
    const raw = `${VISION_DESCRIPTION_MARKER} 描述在前\n${VISION_TRANSCRIPT_MARKER} 转录在后`;
    expect(parseVisionReply(raw).transcript).toBeNull();
  });

  it("提问指令与解析用的是同一对标记（同一事实不写两处）", () => {
    expect(VISION_PROMPT).toContain(VISION_TRANSCRIPT_MARKER);
    expect(VISION_PROMPT).toContain(VISION_DESCRIPTION_MARKER);
  });
});

describe("composeVisionMarkdown", () => {
  it("产物逐字写明模型名与「这是模型的描述、不是确定性抽取」", () => {
    const md = composeVisionMarkdown({
      modelId: "qwen-vl-max",
      reply: { transcript: "开始体验", description: "一张 App 首页截图" },
    });
    expect(md).toContain("qwen-vl-max");
    expect(md).toContain("不是确定性文本抽取");
    expect(md).toContain("## 图中文字转录");
    expect(md).toContain("开始体验");
    expect(md).toContain("## 视觉内容描述");
    expect(md).toContain("一张 App 首页截图");
  });

  it("模型未按结构回复 → 转录段如实说明，绝不编一段转录出来", () => {
    const md = composeVisionMarkdown({
      modelId: "qwen-vl-max",
      reply: { transcript: null, description: "一张猫的照片" },
    });
    expect(md).toContain("模型未按约定结构回复");
    expect(md).toContain("一张猫的照片");
  });

  it("空段落如实写「（模型未给出）」，不静默省略", () => {
    const md = composeVisionMarkdown({ modelId: "m", reply: { transcript: "   ", description: "" } });
    expect(md.match(/（模型未给出）/g)).toHaveLength(2);
  });
});

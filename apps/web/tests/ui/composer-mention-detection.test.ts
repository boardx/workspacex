/**
 * issue #2046（CK-P2）—— CopilotKit v2 composer mention 检测的正反例。
 * 规则单一事实源：`lib/composer-mention-detection.ts` 文件头。
 */
import { describe, expect, it } from "vitest";
import { detectComposerMention } from "@/lib/composer-mention-detection";

describe("detectComposerMention", () => {
  it("行首的 / 触发 skill mention，query 是 / 到光标之间的文字", () => {
    expect(detectComposerMention("/假设", 3)).toEqual({ kind: "skill", start: 0, query: "假设" });
  });

  it("空白之后的 / 触发 skill mention", () => {
    expect(detectComposerMention("先看 /检索", 4)).toEqual({ kind: "skill", start: 3, query: "" });
    expect(detectComposerMention("先看 /检索", 6)).toEqual({ kind: "skill", start: 3, query: "检索" });
  });

  it("反例：路径/URL 中的斜杠（前一字符非空白）不触发", () => {
    expect(detectComposerMention("看看 src/components 里", 15)).toBeNull();
    expect(detectComposerMention("https://example.com", 19)).toBeNull();
  });

  it("反例：触发符与光标之间出现空白即结束这次 mention", () => {
    expect(detectComposerMention("/foo 然后", 7)).toBeNull();
    expect(detectComposerMention("@报告 然后", 6)).toBeNull();
  });

  it("@ 触发附件 mention（无行首/空白约束，与旧 composer 行为一致）", () => {
    expect(detectComposerMention("@报告", 3)).toEqual({ kind: "attachment", start: 0, query: "报告" });
    expect(detectComposerMention("引用@纪要", 5)).toEqual({ kind: "attachment", start: 2, query: "纪要" });
  });

  it("两个触发符并存时，取更靠近光标的那个", () => {
    expect(detectComposerMention("@a /b", 5)).toEqual({ kind: "skill", start: 3, query: "b" });
    // `/` 在前但已被空白终结，`@` 更近且活跃。
    expect(detectComposerMention("/x @y", 5)).toEqual({ kind: "attachment", start: 3, query: "y" });
  });

  it("光标为 null（无焦点/无选区信息）时不产生 mention", () => {
    expect(detectComposerMention("/foo", null)).toBeNull();
  });
});

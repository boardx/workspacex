/**
 * VZ-fabric ④（main agent 决定）——保存边界解转义的 round-trip 反证。
 * 钉住「`< 18 个月?` 存→读 === 原文」，即 fabric-markdown 序列化引入的 HTML 实体在落盘前被解回。
 */
import { describe, expect, it } from "vitest";
import { decodeMermaidEntities } from "@/lib/chat/decode-mermaid-entities";

describe("decodeMermaidEntities（保存边界）", () => {
  it("复原被 canvasToMarkdown 转义的 `<`（design-note 记录的具体瑕疵）", () => {
    // 画布往返把 D1{"< 18 个月?"} 序列化成 &lt;；保存前解回，落盘的是合法 mermaid。
    const serialized = 'flowchart TD\n  D1{"&lt; 18 个月?"} --> A';
    expect(decodeMermaidEntities(serialized)).toBe('flowchart TD\n  D1{"< 18 个月?"} --> A');
  });

  it("五个具名实体全解：< > \" ' &", () => {
    expect(decodeMermaidEntities("&lt;&gt;&quot;&#39;&apos;&amp;")).toBe("<>\"''&");
  });

  it("&amp; 最后解 —— 不把 &amp;lt; 双重解码成 <", () => {
    // 字面上想表达 `&lt;`（即 &amp;lt;）必须停在 `&lt;`，不能被解成 `<`。
    expect(decodeMermaidEntities("&amp;lt;")).toBe("&lt;");
  });

  it("无实体的源原样返回（对已正确的 mermaid 无副作用）", () => {
    const clean = "sequenceDiagram\n  Alice->>Bob: hi";
    expect(decodeMermaidEntities(clean)).toBe(clean);
  });
});

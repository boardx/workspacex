import { describe, expect, it } from "vitest";
import { canvas as C } from "@repo/contracts";
import {
  applyMermaidWhitelist,
  detectDiagramType,
} from "../../src/domain/canvas/mermaid-whitelist";

/**
 * F101 — mermaid 白名单「只关渲染、不关书写」（I-8）。
 *
 * ## 这份测试在防什么
 *
 * 「白名单关闭的类型仍可书写但不渲染」这句话看起来像一句装饰性描述，实际是三条各自可能
 * 单独被破坏的断言：
 *   ① `ignoredSyntaxCount` 必须等于「被挡下的块数」，不是「文档里 mermaid 块总数」——
 *      一个只统计总数、不真的按白名单过滤的实现会让这条断言看起来对，直到关掉某个类型。
 *   ② 被挡的块**点名到具体哪几条**（type + 行号），不是只给一个数字——
 *      任务说明里明确写了「不只是数量」，一个只返回 count 的实现会通过①但通不过②。
 *   ③ 源码 Markdown **原样保留**——把"不渲染"错实现成"删除代码块"是最容易犯的反直觉实现，
 *      domain.md I-8 明确要求"逐字节保留"。
 *
 * 反证：`applyMermaidWhitelist` 的返回类型里没有任何"修改后的 markdown"字段——
 * 这不是靠测试断言出来的，是靠这个函数的签名本身没有能力做那件事（见模块顶部注释）。
 */

const FLOWCHART = "```mermaid\nflowchart TD\n  A --> B\n```";
const SEQUENCE = "```mermaid\nsequenceDiagram\n  Alice->>Bob: hi\n```";
const PIE = "```mermaid\npie title x\n  \"a\" : 1\n```";
const NOT_MERMAID = "```persona\nname: someone\n```";

describe("F101 · mermaid 白名单「有 N 条语法被忽略」", () => {
  describe("detectDiagramType —— 12 类封闭枚举的识别", () => {
    it.each(C.MermaidDiagramType.options)("能识别契约里声明的类型 %s", (type) => {
      const sample: Record<string, string> = {
        flowchart: "flowchart TD\nA-->B",
        sequenceDiagram: "sequenceDiagram\nAlice->>Bob: hi",
        classDiagram: "classDiagram\nAnimal <|-- Duck",
        stateDiagram: "stateDiagram-v2\n[*] --> Still",
        erDiagram: "erDiagram\nCAR ||--o{ NAMED-DRIVER : allows",
        journey: "journey\ntitle My day",
        gantt: "gantt\ntitle A Gantt Diagram",
        pie: 'pie title Pets\n"Dogs" : 10',
        quadrantChart: "quadrantChart\ntitle Reach vs influence",
        mindmap: "mindmap\n  root((mindmap))",
        timeline: "timeline\ntitle History",
        gitGraph: "gitGraph\ncommit",
      };
      expect(detectDiagramType(sample[type]!)).toBe(type);
    });

    it("识别不出的首行返回 null，而不是猜一个类型", () => {
      expect(detectDiagramType("not a real mermaid diagram\nfoo bar")).toBeNull();
    });

    it("空白/仅空行返回 null", () => {
      expect(detectDiagramType("\n   \n")).toBeNull();
    });

    it("忽略前导空行，取第一条非空行判定类型", () => {
      expect(detectDiagramType("\n\n  \nflowchart LR\nA-->B")).toBe("flowchart");
    });
  });

  describe("applyMermaidWhitelist —— ignoredSyntaxCount 与被点名的 ignoredBlocks", () => {
    it("关闭 sequenceDiagram：渲染结果不含该图对象、ignoredSyntaxCount == 1（domain.md I-8 场景原文）", () => {
      const markdown = [FLOWCHART, SEQUENCE].join("\n\n");
      const result = applyMermaidWhitelist(markdown, ["flowchart"]);

      expect(result.ignoredSyntaxCount).toBe(1);
      expect(result.ignoredBlocks).toHaveLength(1);
      expect(result.ignoredBlocks[0]!.type).toBe("sequenceDiagram");
      expect(result.renderableTypes).toEqual(["flowchart"]);
    });

    it("重开白名单（sequenceDiagram 也 enabled）后同一文档正常渲染，ignoredSyntaxCount 归零", () => {
      const markdown = [FLOWCHART, SEQUENCE].join("\n\n");
      const result = applyMermaidWhitelist(markdown, ["flowchart", "sequenceDiagram"]);

      expect(result.ignoredSyntaxCount).toBe(0);
      expect(result.ignoredBlocks).toEqual([]);
      expect([...result.renderableTypes].sort()).toEqual(["flowchart", "sequenceDiagram"].sort());
    });

    it("N 条被忽略时逐条点名——不是只报数量", () => {
      const markdown = [FLOWCHART, SEQUENCE, PIE].join("\n\n");
      const result = applyMermaidWhitelist(markdown, []); // 全关

      expect(result.ignoredSyntaxCount).toBe(3);
      const types = result.ignoredBlocks.map((b) => b.type).sort();
      expect(types).toEqual(["flowchart", "pie", "sequenceDiagram"]);
      // 每一条都带可定位的行号范围，不是裸的类型名
      for (const block of result.ignoredBlocks) {
        expect(block.rawLineRange.from).toBeGreaterThan(0);
        expect(block.rawLineRange.to).toBeGreaterThanOrEqual(block.rawLineRange.from);
      }
    });

    it("非 mermaid 围栏（persona/canvas/usecase）不计入 ignoredSyntaxCount——它们从不在白名单管辖范围内", () => {
      const markdown = [NOT_MERMAID, SEQUENCE].join("\n\n");
      const result = applyMermaidWhitelist(markdown, []); // 全关

      expect(result.ignoredSyntaxCount).toBe(1); // 只有 sequenceDiagram 那一条
      expect(result.ignoredBlocks.map((b) => b.type)).toEqual(["sequenceDiagram"]);
    });

    it("空文档：ignoredSyntaxCount 为 0（非平凡：确认这不是因为函数总返回 0）", () => {
      const empty = applyMermaidWhitelist("", ["flowchart"]);
      expect(empty.ignoredSyntaxCount).toBe(0);
      // 反证：给同一个空白输入换一个「全关」的白名单，结果仍应是 0——
      // 证明「0」来自"没有块"而不是"whitelist 参数被忽略了"。
      const emptyAllOff = applyMermaidWhitelist("", []);
      expect(emptyAllOff.ignoredSyntaxCount).toBe(0);
      // 而非空文档 + 全关 whitelist 必须能产出非零，证明上面两个 0 不是函数恒返回 0。
      const nonEmptyAllOff = applyMermaidWhitelist(FLOWCHART, []);
      expect(nonEmptyAllOff.ignoredSyntaxCount).toBe(1);
    });
  });

  describe("I-8：源码 Markdown 逐字节保留——「只关渲染、不关书写」", () => {
    it("applyMermaidWhitelist 不修改也不返回任何形式的「新 markdown」", () => {
      const markdown = [FLOWCHART, SEQUENCE].join("\n\n");
      const before = markdown;
      const result = applyMermaidWhitelist(markdown, []);
      // 调用后原始字符串对象不可能被"修改"（JS 字符串本就不可变），这里额外确认
      // 传入的引用值逐字节未变，且返回值里没有任何字段类型是"整篇 markdown"。
      expect(markdown).toBe(before);
      expect(Object.keys(result).sort()).toEqual(
        ["ignoredBlocks", "ignoredSyntaxCount", "renderableTypes"].sort(),
      );
    });

    it("被忽略类型的代码块内容在 ignoredBlocks 的行号范围内于原文中原样可读到", () => {
      const markdown = [FLOWCHART, SEQUENCE].join("\n\n");
      const result = applyMermaidWhitelist(markdown, ["flowchart"]);
      const [ignored] = result.ignoredBlocks;
      const lines = markdown.split("\n");
      const slice = lines.slice(ignored!.rawLineRange.from - 1, ignored!.rawLineRange.to).join("\n");
      expect(slice).toContain("sequenceDiagram");
      expect(slice).toContain("Alice->>Bob: hi");
    });
  });
});

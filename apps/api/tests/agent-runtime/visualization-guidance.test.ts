/**
 * VZ-02 —— 可视化指引进 system prompt（纯函数，零契约变更）。
 * 反证的是 devapp 实测（2026-08-12）：模型在 mermaid 节点标签里塞裸 `|` 和 `<br/>`，前端严格
 * 模式解析失败、落诚实错误盒。VZ-02 把「产出可解析 mermaid」写进模型看到的 system prompt，从
 * 源头减少那类失败。这里钉住指引真的进了每个 agent 的 system、且写明了那两条关键规则。
 */
import { describe, expect, it } from "vitest";
import { buildSystemPrompt, VISUALIZATION_GUIDANCE } from "../../src/application/agent-run/execute-run";

describe("VZ-02 buildSystemPrompt 追加可视化指引", () => {
  it("每个 agent 的 system 都带上可视化指引，且原指令仍在最前", () => {
    const sys = buildSystemPrompt("你是通用助手", []);
    expect(sys.startsWith("你是通用助手")).toBe(true);
    expect(sys).toContain(VISUALIZATION_GUIDANCE);
  });

  it("顺序：指令 → skills → 可视化指引（指引在最后，不抢 skill 位）", () => {
    const sys = buildSystemPrompt("INSTR", [{ versionId: "v1", content: "SKILL-A" }]);
    expect(sys.indexOf("INSTR")).toBeLessThan(sys.indexOf("SKILL-A"));
    expect(sys.indexOf("SKILL-A")).toBeLessThan(sys.indexOf("## 可视化"));
  });

  it("指引列出 12 类白名单图类型（与前端校验同一份枚举，prompt 侧可读列出）", () => {
    for (const t of ["flowchart", "sequenceDiagram", "classDiagram", "stateDiagram", "erDiagram",
      "journey", "gantt", "pie", "quadrantChart", "mindmap", "timeline", "gitGraph"]) {
      expect(VISUALIZATION_GUIDANCE).toContain(t);
    }
  });

  it("指引写明两条防解析失败的关键规则：特殊字符标签加引号、不要 <br/>", () => {
    // 裸 | 会被当边标签分隔符 → 要求加双引号
    expect(VISUALIZATION_GUIDANCE).toContain("双引号");
    expect(VISUALIZATION_GUIDANCE).toContain("|");
    // 不要 HTML <br/>
    expect(VISUALIZATION_GUIDANCE).toContain("<br/>");
  });
});

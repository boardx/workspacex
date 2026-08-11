import { describe, it, expect } from "vitest";
import { findUnresolvedPlaceholders, checkRenderedFiles } from "./placeholder-gate";
import type { RenderedFile } from "./renderer-model";

describe("findUnresolvedPlaceholders — machine 类（{{...}}）", () => {
  it("报出 scaffold 真实使用的 UPPER_SNAKE 占位符", () => {
    const findings = findUnresolvedPlaceholders("# Phase {{PHASE_ID}}\n目标：{{PHASE_GOAL}}");
    expect(findings).toEqual([
      { line: 1, placeholder: "{{PHASE_ID}}", kind: "machine" },
      { line: 2, placeholder: "{{PHASE_GOAL}}", kind: "machine" },
    ]);
  });

  it("同一行多个占位符逐个报", () => {
    const findings = findUnresolvedPlaceholders("{{A}} 和 {{B}}");
    expect(findings.map((f) => f.placeholder)).toEqual(["{{A}}", "{{B}}"]);
  });

  it("空内容 / 无占位符内容不报", () => {
    expect(findUnresolvedPlaceholders("")).toEqual([]);
    expect(findUnresolvedPlaceholders("正常的一段文字，带 {单花括号} 也不报")).toEqual([]);
  });
});

describe("findUnresolvedPlaceholders — human 类（<CJK> / <…>）", () => {
  it("报出模板真实使用的中文提示占位符", () => {
    const findings = findUnresolvedPlaceholders("- <谁在用这个功能——按角色列>\n- <步骤1>");
    expect(findings).toHaveLength(2);
    expect(findings[0]).toEqual({ line: 1, placeholder: "<谁在用这个功能——按角色列>", kind: "human" });
  });

  it("报出省略号占位符 <…>", () => {
    expect(findUnresolvedPlaceholders("列表：<…>")).toHaveLength(1);
  });

  it("不报 HTML 标签 / TS 泛型 / 纯 ASCII 尖括号（如实标注的不覆盖面）", () => {
    const content = [
      "<div class=\"x\"></div>",
      "Tool<Input, Output>",
      "cat file > out.txt 与 a < b 比较",
      "git checkout <branch>",
    ].join("\n");
    expect(findUnresolvedPlaceholders(content)).toEqual([]);
  });
});

describe("findUnresolvedPlaceholders — ignore 标记", () => {
  it("行内含 placeholder-gate:ignore 时整行跳过", () => {
    const content = "教学示例：{{PHASE_ID}} 是机器占位符 <!-- placeholder-gate:ignore -->\n但这行的 {{LEAK}} 要报";
    const findings = findUnresolvedPlaceholders(content);
    expect(findings).toEqual([{ line: 2, placeholder: "{{LEAK}}", kind: "machine" }]);
  });
});

describe("checkRenderedFiles", () => {
  const makeFile = (path: string, content: string): RenderedFile => ({
    path,
    content,
    meta: { sourceInstanceId: "X-1", sourceTemplateId: "TPL-EVT-001", sourceRevision: "abc1234" },
  });

  it("干净产出 → 无 issues", () => {
    expect(checkRenderedFiles([makeFile("generated/a.md", "# 正常内容")])).toEqual([]);
  });

  it("反证：渲染产出漏了替换 → 逐文件逐处上报，路径可定位", () => {
    const issues = checkRenderedFiles([
      makeFile("generated/a.md", "ok"),
      makeFile("generated/b.md", "遗留 {{SPRINT_GOAL}}\n和 <束>"),
    ]);
    expect(issues).toHaveLength(2);
    expect(issues[0]?.path).toBe("generated/b.md");
    expect(issues[0]?.finding.kind).toBe("machine");
    expect(issues[1]?.finding).toEqual({ line: 2, placeholder: "<束>", kind: "human" });
  });
});

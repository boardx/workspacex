import { describe, expect, it } from "vitest";
import { normalizeAgentInterruptArgs } from "../../src/domain/agent-run/agent-interrupt-args";

describe("normalizeAgentInterruptArgs（issue #2842）", () => {
  it("confirm_task_intent.assumptions 是 JSON 字符串 → 解回数组（2026-09-06 qwen3.8-max 真实形状）", () => {
    const out = normalizeAgentInterruptArgs("confirm_task_intent", {
      requestId: "r-1", understanding: "u", assumptions: '["报告主题为年度总结", "格式为 docx"]',
    }) as { assumptions: unknown };
    expect(out.assumptions).toEqual(["报告主题为年度总结", "格式为 docx"]);
  });

  it("assumptions 是多行文本 → 按行拆，去掉序号/项目符", () => {
    const out = normalizeAgentInterruptArgs("confirm_task_intent", {
      assumptions: "1. 主题是年度总结\n2. 输出 docx\n\n- 中文",
    }) as { assumptions: unknown };
    expect(out.assumptions).toEqual(["主题是年度总结", "输出 docx", "中文"]);
  });

  it("fields / options 同样处理；已是数组的原样返回（同一引用）", () => {
    const fields = normalizeAgentInterruptArgs("fill_run_params", { fields: '[{"name":"a"}]' }) as { fields: unknown };
    expect(fields.fields).toEqual([{ name: "a" }]);
    const options = normalizeAgentInterruptArgs("choose_execution_option", { options: '[{"optionId":"x"}]' }) as { options: unknown };
    expect(options.options).toEqual([{ optionId: "x" }]);
    const ok = { assumptions: ["a", "b"] };
    expect(normalizeAgentInterruptArgs("confirm_task_intent", ok)).toBe(ok);
  });

  it("不是这三个工具、或 args 不是对象、或字符串不是数组 JSON → 原样返回", () => {
    const skill = { skill_stable_name: "pptx-create", task: "[not json" };
    expect(normalizeAgentInterruptArgs("call_skill", skill)).toBe(skill);
    expect(normalizeAgentInterruptArgs("confirm_task_intent", "raw")).toBe("raw");
    const obj = { assumptions: '{"a":1}' };
    expect(normalizeAgentInterruptArgs("confirm_task_intent", obj)).toEqual({ assumptions: ['{"a":1}'] });
  });
});

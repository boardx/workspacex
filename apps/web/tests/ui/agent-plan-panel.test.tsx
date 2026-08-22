/**
 * DA-06（#1749，rubric D1）规划条的反证套件。
 *
 * derivePlanTodos 的每条「返回 null」路径都有对应用例——解析失败必须不渲染，
 * 用占位顶替会把「解析不了」伪装成「没有计划」（组件头注的纪律）。
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AgentPlanPanel, derivePlanTodos } from "@/components/chat/agent-plan-panel";

type AnyStep = Parameters<typeof derivePlanTodos>[0][number];

function step(over: Partial<AnyStep>): AnyStep {
  return {
    kind: "tool_call", status: "succeeded",
    startedAt: "2026-08-22T00:00:00Z", endedAt: "2026-08-22T00:00:01Z",
    toolName: "write_todos", toolArgsSummary: null, toolResultSummary: null,
    planningNote: null, failureCode: null, inputDigest: null, outputDigest: null,
    ...over,
  } as AnyStep;
}

const TODOS = { todos: [
  { content: "查清现状", status: "completed" },
  { content: "写实现", status: "in_progress" },
  { content: "跑验证", status: "pending" },
] };

describe("derivePlanTodos", () => {
  it("取最后一次 write_todos 作为当前计划快照（引擎每次更新都是全量调用）", () => {
    const old = { todos: [{ content: "旧计划", status: "pending" }] };
    const got = derivePlanTodos([
      step({ toolArgsSummary: JSON.stringify(old) }),
      step({ toolName: "call_skill", toolArgsSummary: "{}" }),
      step({ toolArgsSummary: JSON.stringify(TODOS) }),
    ]);
    expect(got?.map((t) => t.content)).toEqual(["查清现状", "写实现", "跑验证"]);
  });

  it.each([
    ["截断的非法 JSON（老 run，500 字符时代的痕迹）", '{"todos":[{"content":"很长…'],
    ["不是对象", '"just a string"'],
    ["todos 不是数组", '{"todos":{}}'],
    ["空数组", '{"todos":[]}'],
    ["条目缺 content", '{"todos":[{"status":"pending"}]}'],
    ["status 非法", '{"todos":[{"content":"x","status":"done"}]}'],
  ])("解析失败不渲染：%s", (_name, raw) => {
    expect(derivePlanTodos([step({ toolArgsSummary: raw })])).toBeNull();
  });

  it("没有 write_todos 调用 → null（模型直接作答的 run 不该出现空规划条）", () => {
    expect(derivePlanTodos([step({ toolName: "call_skill", toolArgsSummary: "{}" })])).toBeNull();
  });
});

describe("AgentPlanPanel", () => {
  it("渲染进度计数与逐项状态；completed 划线", () => {
    render(<AgentPlanPanel steps={[step({ toolArgsSummary: JSON.stringify(TODOS) })]} />);
    const panel = screen.getByTestId("agent-plan-panel");
    expect(panel.getAttribute("data-plan-total")).toBe("3");
    expect(panel.getAttribute("data-plan-done")).toBe("1");
    expect(screen.getByTestId("agent-plan-item-0").getAttribute("data-plan-status")).toBe("completed");
    expect(screen.getByTestId("agent-plan-item-1").getAttribute("data-plan-status")).toBe("in_progress");
    expect(panel.textContent).toContain("计划 1/3");
  });

  it("解析失败渲染为空（不是空壳卡片）", () => {
    const { container } = render(<AgentPlanPanel steps={[step({ toolArgsSummary: "{broken" })]} />);
    expect(container.innerHTML).toBe("");
  });
});

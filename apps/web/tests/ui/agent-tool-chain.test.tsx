import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import {
  AgentToolChain,
  deriveThinkingSeconds,
  toolChainSummaryText,
} from "@/components/chat/agent-tool-chain";
import { toolChainSteps } from "@/lib/mock/agent-tool-chain";
import type { AgentRunView } from "@/lib/agent-run";

type Step = AgentRunView["steps"][number];

/**
 * TOOLCHAIN-01（人类 2026-08-13 裁决方案 A：默认收起 + 一行摘要）活体折叠式工具调用链。
 * 这里钉住三件事，任一被后人改回旧行为都会红：
 *  1. 摘要文案的分支（有/无耗时、有/无工具）；
 *  2. **默认收起** —— step 细节在点开前不在 DOM（P7「默认可见」被反转的机械证据）；
 *  3. 失败在**收起态**就以红徽标显性（默认收起不违背「出错看得见」）。
 */

// 造一个 `startedAt`/`endedAt` 无法解析的 step，验证耗时缺失时摘要退化。
function undatedToolStep(): Step {
  return {
    kind: "tool_call",
    status: "succeeded",
    startedAt: "not-a-date",
    endedAt: "not-a-date",
    inputDigest: null,
    outputDigest: null,
    failureCode: null,
    toolName: "list_org_skills",
    toolArgsSummary: "{}",
    toolResultSummary: "ok",
    planningNote: null,
  };
}

describe("toolChainSummaryText / deriveThinkingSeconds", () => {
  it("有耗时 + 有工具：思考了 X 秒 · 调用了 N 个工具", () => {
    const steps = toolChainSteps("collapsed"); // 三工具成功链，时间可解析
    expect(deriveThinkingSeconds(steps)).not.toBeNull();
    expect(toolChainSummaryText(steps)).toMatch(/^思考了 [\d.]+ 秒 · 调用了 3 个工具$/);
  });

  it("耗时无法解析：退化为不带秒的摘要，绝不编一个耗时", () => {
    const steps = [undatedToolStep()];
    expect(deriveThinkingSeconds(steps)).toBeNull();
    expect(toolChainSummaryText(steps)).toBe("调用了 1 个工具");
  });

  it("有 step 但零工具调用：说「模型直接作答」，不说「调用了 0 个工具」", () => {
    const steps = toolChainSteps("no-tools");
    expect(steps.length).toBeGreaterThan(0);
    expect(steps.every((s) => s.kind !== "tool_call")).toBe(true);
    expect(toolChainSummaryText(steps)).toContain("模型直接作答");
  });
});

describe("AgentToolChain 渲染", () => {
  it("零 step：整体不渲染（是没发生，不是黑盒）", () => {
    const { container } = render(<AgentToolChain steps={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("默认收起：摘要在场，但逐条 step 细节点开前不在 DOM", () => {
    render(<AgentToolChain steps={toolChainSteps("collapsed")} />);
    expect(screen.getByTestId("agent-tool-chain-summary")).toHaveTextContent("调用了 3 个工具");
    // 收起态：细节区与 step 行都不在 DOM —— 这正是方案 A 反转 P7「默认可见」的证据。
    expect(screen.queryByTestId("agent-tool-chain-detail")).toBeNull();
    expect(screen.queryByTestId("agent-tool-chain-step-0")).toBeNull();

    fireEvent.click(screen.getByTestId("agent-tool-chain-toggle"));
    expect(screen.getByTestId("agent-tool-chain-step-0")).toHaveAttribute("data-tool-name", "list_org_skills");
  });

  it("失败在收起态就显性：红徽标可见，无需点开", () => {
    render(<AgentToolChain steps={toolChainSteps("failure")} />);
    // 未点开就断言：失败徽标已在场，step 细节仍收起。
    expect(screen.queryByTestId("agent-tool-chain-detail")).toBeNull();
    expect(screen.getByTestId("agent-tool-chain-fail-badge")).toHaveTextContent("失败");
    expect(screen.queryByTestId("agent-tool-chain-ok")).toBeNull();
  });

  it("全绿收起态：显示成功图标而非失败徽标", () => {
    render(<AgentToolChain steps={toolChainSteps("collapsed")} />);
    expect(screen.getByTestId("agent-tool-chain-ok")).toBeInTheDocument();
    expect(screen.queryByTestId("agent-tool-chain-fail-badge")).toBeNull();
  });
});

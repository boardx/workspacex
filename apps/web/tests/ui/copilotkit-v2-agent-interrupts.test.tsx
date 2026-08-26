/**
 * issue #2179 —— 钉住 F212/F213 建成的三张 HITL 中断卡真的接进了
 * `copilotkit-v2-panel.tsx` 的实时聊天渲染树：`CopilotKitV2AgentInterrupts` 对
 * `AGENT_INTERRUPTS_TOOL_NAMES`（`packages/contracts/src/agent-interrupts.ts`）三个
 * 工具名各注册一次 `useHumanInTheLoop`，`render` 回调渲染出对应真实卡片组件
 * （不是占位/裸 JSON），且卡片的动作按钮真的把 `respond(...)` 接上——按
 * `copilotkit-agui.controller.ts` `parseHitlDecision` 的既有通用协议
 * （字面量 `"approved"`/`"denied"`，或原始对象 = edit 的 `editedArgs`）。
 *
 * `useHumanInTheLoop` 被 mock 成一个纯登记函数（不需要真 CopilotKit provider——
 * 这个 hook 本身只是"渲染 null、副作用是登记一行进 provider 的全局表"，见
 * `copilotkit-v2-agent-interrupts.tsx` 头注），这样可以直接拿到三个工具各自的
 * `render` 函数，用构造好的 `{status, args, respond}` 直接调用断言，不必搭一整套
 * 真实 agent run 状态机。
 */
import * as React from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

interface RegisteredTool {
  name: string;
  render: (props: {
    name: string;
    description: string;
    toolCallId: string;
    args: unknown;
    status: "inProgress" | "executing" | "complete";
    result: string | undefined;
    respond: ((result: unknown) => Promise<void>) | undefined;
  }) => React.ReactElement | null;
}

const registered: Record<string, RegisteredTool> = {};

vi.mock("@copilotkit/react-core/v2", () => ({
  useHumanInTheLoop: (tool: RegisteredTool) => {
    registered[tool.name] = tool;
  },
}));

import { CopilotKitV2AgentInterrupts } from "@/components/chat/copilotkit-v2-agent-interrupts";
import { AGENT_INTERRUPTS_TOOL_NAMES } from "@repo/contracts/agent-interrupts";

function respondSpy() {
  return vi.fn(async () => {});
}

describe("CopilotKitV2AgentInterrupts —— 三个工具名的 useHumanInTheLoop 接线", () => {
  it("挂载时对三个新工具名各注册一次 useHumanInTheLoop", () => {
    for (const k of Object.keys(registered)) delete registered[k];
    render(<CopilotKitV2AgentInterrupts />);

    expect(Object.keys(registered).sort()).toEqual(
      [
        AGENT_INTERRUPTS_TOOL_NAMES.confirmTaskIntent,
        AGENT_INTERRUPTS_TOOL_NAMES.fillRunParams,
        AGENT_INTERRUPTS_TOOL_NAMES.chooseExecutionOption,
      ].sort(),
    );
  });

  describe("confirm_task_intent → ConfirmIntentCard", () => {
    it("executing 态渲染真实卡片，「继续」调用 respond(\"approved\")", () => {
      render(<CopilotKitV2AgentInterrupts />);
      const respond = respondSpy();
      const el = registered[AGENT_INTERRUPTS_TOOL_NAMES.confirmTaskIntent]!.render({
        name: AGENT_INTERRUPTS_TOOL_NAMES.confirmTaskIntent,
        description: "",
        toolCallId: "tc-1",
        args: {
          requestId: "req-1",
          understanding: "生成 7 月增长月报",
          assumptions: ["假设一", "假设二"],
        },
        status: "executing",
        result: undefined,
        respond,
      });
      render(el);

      expect(screen.getByTestId("agent-interrupt-confirm-intent-card")).toBeInTheDocument();
      expect(screen.getByTestId("agent-interrupt-confirm-intent-understanding")).toHaveTextContent(
        "生成 7 月增长月报",
      );
      fireEvent.click(screen.getByTestId("agent-interrupt-confirm-intent-continue"));
      expect(respond).toHaveBeenCalledWith("approved");
    });

    it("改假设并提交 → respond({ assumptions }) 原始对象（走通用 edit 协议）", () => {
      render(<CopilotKitV2AgentInterrupts />);
      const respond = respondSpy();
      const el = registered[AGENT_INTERRUPTS_TOOL_NAMES.confirmTaskIntent]!.render({
        name: AGENT_INTERRUPTS_TOOL_NAMES.confirmTaskIntent,
        description: "",
        toolCallId: "tc-2",
        args: { requestId: "req-2", understanding: "U", assumptions: ["a1", "a2"] },
        status: "executing",
        result: undefined,
        respond,
      });
      render(el);

      fireEvent.click(screen.getByTestId("agent-interrupt-confirm-intent-edit-toggle"));
      fireEvent.change(screen.getByTestId("agent-interrupt-confirm-intent-assumption-input-0"), {
        target: { value: "改过的假设一" },
      });
      fireEvent.click(screen.getByTestId("agent-interrupt-confirm-intent-edit-submit"));
      expect(respond).toHaveBeenCalledWith({ assumptions: ["改过的假设一", "a2"] });
    });

    it("inProgress 态不渲染交互卡片（respond 恒不可用）", () => {
      render(<CopilotKitV2AgentInterrupts />);
      const el = registered[AGENT_INTERRUPTS_TOOL_NAMES.confirmTaskIntent]!.render({
        name: AGENT_INTERRUPTS_TOOL_NAMES.confirmTaskIntent,
        description: "",
        toolCallId: "tc-3",
        args: {},
        status: "inProgress",
        result: undefined,
        respond: undefined,
      });
      render(el);
      expect(screen.queryByTestId("agent-interrupt-confirm-intent-continue")).toBeNull();
    });
  });

  describe("fill_run_params → FillParamsCard", () => {
    const FIELDS = [
      {
        name: "compare_baseline",
        label: "对比基准",
        aiGuess: "同比（YoY）",
        rationale: "近 6 份月报都用同比口径。",
        required: true,
        currentValue: "同比（YoY）",
      },
      {
        name: "include_forecast",
        label: "是否包含下月预测段落",
        aiGuess: false,
        rationale: "上一期未包含。",
        required: false,
        currentValue: false,
      },
    ];

    it("未改动直接提交 → respond(\"approved\")", () => {
      render(<CopilotKitV2AgentInterrupts />);
      const respond = respondSpy();
      const el = registered[AGENT_INTERRUPTS_TOOL_NAMES.fillRunParams]!.render({
        name: AGENT_INTERRUPTS_TOOL_NAMES.fillRunParams,
        description: "",
        toolCallId: "tc-4",
        args: { requestId: "req-4", fields: FIELDS },
        status: "executing",
        result: undefined,
        respond,
      });
      render(el);

      expect(screen.getByTestId("agent-interrupt-fill-params-card")).toBeInTheDocument();
      fireEvent.click(screen.getByTestId("agent-interrupt-fill-params-submit"));
      expect(respond).toHaveBeenCalledWith("approved");
    });

    it("改动一个字段再提交 → respond({ fields, appliedTo }) 原始对象", () => {
      render(<CopilotKitV2AgentInterrupts />);
      const respond = respondSpy();
      const el = registered[AGENT_INTERRUPTS_TOOL_NAMES.fillRunParams]!.render({
        name: AGENT_INTERRUPTS_TOOL_NAMES.fillRunParams,
        description: "",
        toolCallId: "tc-5",
        args: { requestId: "req-5", fields: FIELDS },
        status: "executing",
        result: undefined,
        respond,
      });
      render(el);

      fireEvent.change(screen.getByTestId("agent-interrupt-fill-params-input-compare_baseline"), {
        target: { value: "环比（MoM）" },
      });
      fireEvent.click(screen.getByTestId("agent-interrupt-fill-params-submit"));
      expect(respond).toHaveBeenCalledWith({
        fields: [
          { name: "compare_baseline", value: "环比（MoM）" },
          { name: "include_forecast", value: false },
        ],
        appliedTo: "full-rerun",
      });
    });
  });

  describe("choose_execution_option → ChooseOptionCard", () => {
    const OPTIONS = [
      { optionId: "opt-a", title: "快赢", effort: "低", timeToValue: "即时", expectedReturn: "+1.5pt" },
      { optionId: "opt-b", title: "实验", effort: "中", timeToValue: "≈4 天", expectedReturn: "验证结论" },
    ];

    it("点选一张卡 → respond({ selectedOptionId }) 原始对象（选中即 resume）", () => {
      render(<CopilotKitV2AgentInterrupts />);
      const respond = respondSpy();
      const el = registered[AGENT_INTERRUPTS_TOOL_NAMES.chooseExecutionOption]!.render({
        name: AGENT_INTERRUPTS_TOOL_NAMES.chooseExecutionOption,
        description: "",
        toolCallId: "tc-6",
        args: { requestId: "req-6", options: OPTIONS },
        status: "executing",
        result: undefined,
        respond,
      });
      render(el);

      fireEvent.click(screen.getByTestId("agent-interrupt-choose-option-option-opt-b"));
      expect(respond).toHaveBeenCalledWith({ selectedOptionId: "opt-b" });
    });

    it("「都不要」→ respond(\"denied\")", () => {
      render(<CopilotKitV2AgentInterrupts />);
      const respond = respondSpy();
      const el = registered[AGENT_INTERRUPTS_TOOL_NAMES.chooseExecutionOption]!.render({
        name: AGENT_INTERRUPTS_TOOL_NAMES.chooseExecutionOption,
        description: "",
        toolCallId: "tc-7",
        args: { requestId: "req-7", options: OPTIONS },
        status: "executing",
        result: undefined,
        respond,
      });
      render(el);

      fireEvent.click(screen.getByTestId("agent-interrupt-choose-option-decline"));
      expect(respond).toHaveBeenCalledWith("denied");
    });
  });
});

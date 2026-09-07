import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
const registered = vi.hoisted(() => ({} as Record<string, { render: (...args: unknown[]) => unknown }>));
vi.mock("@copilotkit/react-core/v2", () => ({ useHumanInTheLoop: (tool: { name: string; render: (...args: unknown[]) => unknown }) => { registered[tool.name] = tool; } }));
import { CopilotKitV2AgentInterrupts } from "@/components/chat/copilotkit-v2-agent-interrupts";
import { RestoredInterruptForm } from "@/components/chat/workbench/restored-interrupt-form";
import { AGENT_INTERRUPTS_TOOL_NAMES } from "@repo/contracts/agent-interrupts";
describe("durable interrupt presentation", () => {
  it("registers all framework tools without treating executing as a permission request", () => {
    render(<CopilotKitV2AgentInterrupts />);
    expect(Object.keys(registered).sort()).toEqual(Object.values(AGENT_INTERRUPTS_TOOL_NAMES).sort());
    for (const tool of Object.values(registered)) expect(tool.render({ status: "executing", args: {} })).toBeNull();
  });
  it("edits assumptions through the persisted form decision", () => {
    const decide = vi.fn().mockResolvedValue(undefined);
    render(<RestoredInterruptForm interrupt={{ toolName: "confirm_task_intent", args: { requestId: "r", understanding: "U", assumptions: ["a1"] } }} pending={false} decide={decide} />);
    fireEvent.click(screen.getByTestId("agent-interrupt-confirm-intent-edit-toggle"));
    fireEvent.change(screen.getByTestId("agent-interrupt-confirm-intent-assumption-input-0"), { target: { value: "changed" } });
    fireEvent.click(screen.getByTestId("agent-interrupt-confirm-intent-edit-submit"));
    expect(decide).toHaveBeenCalledWith("edit", { assumptions: ["changed"] });
  });
  const fields = [{ name: "baseline", label: "对比基准", aiGuess: "同比", rationale: "上期口径", required: true, currentValue: "同比" }];
  it("confirms unmodified parameters", () => {
    const decide = vi.fn().mockResolvedValue(undefined);
    render(<RestoredInterruptForm interrupt={{ toolName: "fill_run_params", args: { requestId: "r", fields } }} pending={false} decide={decide} />);
    fireEvent.click(screen.getByTestId("agent-interrupt-fill-params-submit"));
    expect(decide).toHaveBeenCalledWith("approve");
  });
  it("submits edited field values and exposes only supported checkpoint resume", () => {
    const decide = vi.fn().mockResolvedValue(undefined);
    render(<RestoredInterruptForm interrupt={{ toolName: "fill_run_params", args: { requestId: "r", fields } }} pending={false} decide={decide} />);
    fireEvent.change(screen.getByTestId("agent-interrupt-fill-params-input-baseline"), { target: { value: "环比" } });
    expect(screen.queryByTestId("agent-interrupt-fill-params-applied-ledger-only")).toBeNull();
    fireEvent.click(screen.getByTestId("agent-interrupt-fill-params-submit"));
    expect(decide).toHaveBeenCalledWith("edit", { fields: [{ name: "baseline", value: "环比" }] });
  });
  it("can reject both proposed options", () => {
    const decide = vi.fn().mockResolvedValue(undefined);
    render(<RestoredInterruptForm interrupt={{ toolName: "choose_execution_option", args: { requestId: "r", options: ["a", "b"].map((optionId) => ({ optionId, title: optionId, effort: "低", timeToValue: "1天", expectedReturn: "报告" })) } }} pending={false} decide={decide} />);
    fireEvent.click(screen.getByTestId("agent-interrupt-choose-option-decline"));
    expect(decide).toHaveBeenCalledWith("reject");
  });
});

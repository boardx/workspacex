import * as React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { GuidedResearchLive } from "@/components/research-studio/guided-research-live";
import { getResearchRuntime, executeResearchRuntime } from "@/lib/guided-research-api";
import { runtimeFixture } from "../guided-runtime-fixture";
vi.mock("@/lib/guided-research-api", () => ({ getResearchRuntime: vi.fn(), executeResearchRuntime: vi.fn() }));
beforeEach(() => vi.resetAllMocks());
describe("human confirmation in the durable model-backed workflow", () => {
  it("keeps generated directions out of the topic step and advances with the saved server draft", async () => {
    vi.mocked(getResearchRuntime).mockResolvedValue(runtimeFixture("directions"));
    vi.mocked(executeResearchRuntime).mockResolvedValue({ ...runtimeFixture("outline"), version: 5 });
    render(<GuidedResearchLive sessionId="grs-live" onBack={vi.fn()} />);
    await screen.findByTestId("research-plan-recovery");
    expect(screen.queryByText("研究方向（可选调整）")).not.toBeInTheDocument();
    expect(screen.queryByDisplayValue("政策方向")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "生成研究计划" }));
    await waitFor(() => expect(vi.mocked(executeResearchRuntime).mock.calls.map(([input]) => input)).toContainEqual(expect.objectContaining({ node: "directions", action: "prepare_plan", expectedVersion: 4, draft: { node: "directions", value: [expect.objectContaining({ title: "政策方向" })] } })));
    expect(await screen.findByRole("list", { name: "研究计划" })).toHaveTextContent("政策章节");
  });
  it("blocks combined plan preparation when the confirmed research content is empty", async () => {
    const state = runtimeFixture("brief");
    state.brief = {...state.brief,goal:""};
    vi.mocked(getResearchRuntime).mockResolvedValue(state);
    render(<GuidedResearchLive sessionId="grs-live" onBack={vi.fn()} />);
    await screen.findByRole("textbox", { name: "研究需求" });
    expect(screen.getByRole("button", { name: "确认并继续" })).toBeDisabled();
    expect(executeResearchRuntime).not.toHaveBeenCalled();
  });
  it("rejects an empty outline and confirms a complete edited outline", async () => {
    vi.mocked(getResearchRuntime).mockResolvedValue(runtimeFixture("outline"));
    vi.mocked(executeResearchRuntime)
      .mockResolvedValueOnce({ ...runtimeFixture("outline"), outline: [{ ...runtimeFixture("outline").outline[0]!, title: "人工编辑章节" }], version: 5 })
      .mockResolvedValueOnce({ ...runtimeFixture("research"), outline: [{ ...runtimeFixture("outline").outline[0]!, title: "人工编辑章节" }], version: 6 });
    render(<GuidedResearchLive sessionId="grs-live" onBack={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: /编辑计划 1/ }));
    const field = screen.getByRole("textbox", { name: "计划 1" });
    fireEvent.change(field, { target: { value: "" } });
    expect(screen.getByRole("button", { name: "保存计划" })).toBeDisabled();
    fireEvent.change(field, { target: { value: "人工编辑章节" } });
    expect(screen.getByRole("button", { name: "生成报告" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "保存计划" }));
    fireEvent.click(screen.getByRole("button", { name: "确认保存" }));
    await waitFor(() => expect(vi.mocked(executeResearchRuntime).mock.calls.map(([input]) => input)).toContainEqual(expect.objectContaining({ node: "outline", action: "save", draft: { node: "outline", value: [expect.objectContaining({ title: "人工编辑章节" })] } })));
    await waitFor(() => expect(screen.getByRole("button", { name: "生成报告" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "生成报告" }));
    await waitFor(() => expect(vi.mocked(executeResearchRuntime).mock.calls.map(([input]) => input)).toContainEqual(expect.objectContaining({ node: "outline", action: "generate_report", draft: { node: "outline", value: [expect.objectContaining({ title: "人工编辑章节" })] } })));
    expect(await screen.findByRole("button", { name: "生成报告" })).toBeInTheDocument();
  });
});

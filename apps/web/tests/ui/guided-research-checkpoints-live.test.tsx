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
    await screen.findByRole("textbox", { name: "研究主题" });
    expect(screen.queryByText("研究方向（可选调整）")).not.toBeInTheDocument();
    expect(screen.queryByDisplayValue("政策方向")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "下一步：研究计划" }));
    await waitFor(() => expect(executeResearchRuntime).toHaveBeenCalledWith(expect.objectContaining({ node: "directions", action: "confirm", expectedVersion: 4, draft: { node: "directions", value: [expect.objectContaining({ title: "政策方向" })] } })));
    expect(await screen.findByTestId("guided-research-markdown-preview")).toHaveTextContent("1、政策章节");
  });
  it("still blocks confirmation when the saved direction draft is invalid", async () => {
    const state = runtimeFixture("directions");
    state.directions = state.directions.map((item) => ({ ...item, enabled: false }));
    vi.mocked(getResearchRuntime).mockResolvedValue(state);
    render(<GuidedResearchLive sessionId="grs-live" onBack={vi.fn()} />);
    await screen.findByRole("textbox", { name: "研究主题" });
    expect(screen.getByRole("button", { name: "下一步：研究计划" })).toBeDisabled();
  });
  it("rejects an empty outline and confirms a complete edited outline", async () => {
    vi.mocked(getResearchRuntime).mockResolvedValue(runtimeFixture("outline"));
    vi.mocked(executeResearchRuntime)
      .mockResolvedValueOnce({ ...runtimeFixture("outline"), outline: [{ ...runtimeFixture("outline").outline[0]!, title: "人工编辑章节" }], version: 5 })
      .mockResolvedValueOnce({ ...runtimeFixture("research"), outline: [{ ...runtimeFixture("outline").outline[0]!, title: "人工编辑章节" }], version: 6 });
    render(<GuidedResearchLive sessionId="grs-live" onBack={vi.fn()} />);
    const preview = await screen.findByTestId("guided-research-markdown-preview");
    fireEvent.doubleClick(preview);
    const markdown = await screen.findByTestId("guided-research-markdown-editor");
    fireEvent.change(markdown, { target: { value: String((markdown as HTMLTextAreaElement).value).replace("政策章节", "人工编辑章节") } });
    expect(screen.getByRole("button", { name: "开始研究" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "保存 Markdown" }));
    fireEvent.click(screen.getByRole("button", { name: "确认保存" }));
    await waitFor(() => expect(executeResearchRuntime).toHaveBeenCalledWith(expect.objectContaining({ node: "outline", action: "save", draft: { node: "outline", value: [expect.objectContaining({ title: "人工编辑章节" })] } })));
    await waitFor(() => expect(screen.getByRole("button", { name: "开始研究" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "开始研究" }));
    await waitFor(() => expect(executeResearchRuntime).toHaveBeenCalledWith(expect.objectContaining({ node: "outline", action: "confirm", draft: { node: "outline", value: [expect.objectContaining({ title: "人工编辑章节" })] } })));
    expect(await screen.findByRole("button", { name: /搜索资料|继续搜索|更新资料/ })).toBeInTheDocument();
  });
});

import * as React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { GuidedResearchLive } from "@/components/research-studio/guided-research-live";
import { getResearchRuntime, executeResearchRuntime } from "@/lib/guided-research-api";
import { runtimeFixture } from "../guided-runtime-fixture";
vi.mock("@/lib/guided-research-api", () => ({ getResearchRuntime: vi.fn(), executeResearchRuntime: vi.fn() }));
beforeEach(() => vi.resetAllMocks());
describe("human confirmation in the durable model-backed workflow", () => {
  it("saves edited directions with the server version and advances only after success", async () => {
    vi.mocked(getResearchRuntime).mockResolvedValue(runtimeFixture("directions"));
    vi.mocked(executeResearchRuntime).mockResolvedValue({ ...runtimeFixture("outline"), version: 5 });
    render(<GuidedResearchLive sessionId="grs-live" onBack={vi.fn()} />);
    fireEvent.change(await screen.findByDisplayValue("政策方向"), { target: { value: "人工编辑方向" } });
    fireEvent.click(screen.getByRole("button", { name: "下一步：研究计划" }));
    await waitFor(() => expect(executeResearchRuntime).toHaveBeenCalledWith(expect.objectContaining({ node: "directions", action: "confirm", expectedVersion: 4, draft: { node: "directions", value: [expect.objectContaining({ title: "人工编辑方向" })] } })));
    expect((await screen.findByTestId("guided-research-markdown-editor") as HTMLTextAreaElement).value).toContain("政策章节");
  });
  it("disables confirmation when every direction is disabled", async () => {
    vi.mocked(getResearchRuntime).mockResolvedValue(runtimeFixture("directions"));
    render(<GuidedResearchLive sessionId="grs-live" onBack={vi.fn()} />);
    fireEvent.click(await screen.findByRole("checkbox", { name: "纳入研究" }));
    expect(screen.getByRole("button", { name: "下一步：研究计划" })).toBeDisabled();
  });
  it("rejects an empty outline and confirms a complete edited outline", async () => {
    vi.mocked(getResearchRuntime).mockResolvedValue(runtimeFixture("outline"));
    vi.mocked(executeResearchRuntime)
      .mockResolvedValueOnce({ ...runtimeFixture("outline"), outline: [{ ...runtimeFixture("outline").outline[0]!, title: "人工编辑章节" }], version: 5 })
      .mockResolvedValueOnce({ ...runtimeFixture("research"), outline: [{ ...runtimeFixture("outline").outline[0]!, title: "人工编辑章节" }], version: 6 });
    render(<GuidedResearchLive sessionId="grs-live" onBack={vi.fn()} />);
    const markdown = await screen.findByTestId("guided-research-markdown-editor");
    fireEvent.change(markdown, { target: { value: String((markdown as HTMLTextAreaElement).value).replace("政策章节", "人工编辑章节") } });
    fireEvent.click(screen.getByRole("button", { name: "保存 Markdown" }));
    await waitFor(() => expect(executeResearchRuntime).toHaveBeenCalledWith(expect.objectContaining({ node: "outline", action: "save", draft: { node: "outline", value: [expect.objectContaining({ title: "人工编辑章节" })] } })));
    fireEvent.click(screen.getByRole("button", { name: "开始研究" }));
    await waitFor(() => expect(executeResearchRuntime).toHaveBeenCalledWith(expect.objectContaining({ node: "outline", action: "confirm", draft: { node: "outline", value: [expect.objectContaining({ title: "人工编辑章节" })] } })));
    expect(await screen.findByRole("button", { name: /搜索资料|继续搜索|更新资料/ })).toBeInTheDocument();
  });
});

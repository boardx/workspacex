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
    fireEvent.click(screen.getByRole("button", { name: "确认并继续" }));
    await waitFor(() => expect(executeResearchRuntime).toHaveBeenCalledWith(expect.objectContaining({ node: "directions", action: "confirm", expectedVersion: 4, draft: { node: "directions", value: [expect.objectContaining({ title: "人工编辑方向" })] } })));
    expect(await screen.findByDisplayValue("政策章节")).toBeInTheDocument();
  });
  it("disables confirmation when every direction is disabled", async () => {
    vi.mocked(getResearchRuntime).mockResolvedValue(runtimeFixture("directions"));
    render(<GuidedResearchLive sessionId="grs-live" onBack={vi.fn()} />);
    fireEvent.click(await screen.findByRole("checkbox"));
    expect(screen.getByRole("button", { name: "确认并继续" })).toBeDisabled();
  });
  it("rejects an empty outline and confirms a complete edited outline", async () => {
    vi.mocked(getResearchRuntime).mockResolvedValue(runtimeFixture("outline"));
    vi.mocked(executeResearchRuntime).mockResolvedValue({ ...runtimeFixture("research"), version: 5 });
    render(<GuidedResearchLive sessionId="grs-live" onBack={vi.fn()} />);
    const title = await screen.findByLabelText("章节标题");
    fireEvent.change(title, { target: { value: "" } });
    expect(screen.getByRole("button", { name: "确认并继续" })).toBeDisabled();
    fireEvent.change(title, { target: { value: "人工编辑章节" } });
    fireEvent.click(screen.getByRole("button", { name: "确认并继续" }));
    await waitFor(() => expect(executeResearchRuntime).toHaveBeenCalledWith(expect.objectContaining({ node: "outline", action: "confirm", draft: { node: "outline", value: [expect.objectContaining({ title: "人工编辑章节" })] } })));
    expect(await screen.findByRole("button", { name: "开始真实检索" })).toBeInTheDocument();
  });
});

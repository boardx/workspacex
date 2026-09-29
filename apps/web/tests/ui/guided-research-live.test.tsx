import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ApiError } from "@/lib/api-client";
import { GuidedResearchLive } from "@/components/research-studio/guided-research-live";
import { executeResearchRuntime, getResearchRuntime, type GuidedResearchRuntime } from "@/lib/guided-research-api";
vi.mock("@/lib/guided-research-api", () => ({ getResearchRuntime: vi.fn(), executeResearchRuntime: vi.fn() }));
const initial: GuidedResearchRuntime = {
  sessionId: "session-live", version: 7, revision: 1, currentNode: "brief", availableNodes: ["brief"],
  brief: { topic: "Storage", goal: "Entry strategy", timeRange: "2026", region: "Europe", focus: "Grid" },
  directions: [], outline: [], tasks: [], sources: [], report: null, completed: false, busy: false, leaseUntil: null,
  errorCode: null, generatedNodes: [], messages: [], proposal: null, modelCalls: [],
};
beforeEach(() => { vi.resetAllMocks(); vi.mocked(getResearchRuntime).mockResolvedValue(structuredClone(initial)); });
afterEach(() => vi.useRealTimers());
describe("live research workspace", () => {
  it("restores server drafts and lets confirmation perform required generation", async () => {
    render(<GuidedResearchLive sessionId="session-live" onBack={vi.fn()} />);
    expect(await screen.findByDisplayValue("Storage")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "确认并继续" })).toBeEnabled();
    expect(screen.queryByText("演示来源")).not.toBeInTheDocument();
  });
  it("includes current editor changes when confirming the brief", async () => {
    vi.mocked(executeResearchRuntime).mockResolvedValue({ ...initial, version: 8 });
    render(<GuidedResearchLive sessionId="session-live" onBack={vi.fn()} />);
    fireEvent.change(await screen.findByRole("textbox", { name: "研究需求" }), { target: { value: "Updated scope" } });
    fireEvent.click(screen.getByRole("button", { name: "确认并继续" }));
    await waitFor(() => expect(executeResearchRuntime).toHaveBeenCalledWith(expect.objectContaining({ action: "confirm", draft: { node: "brief", value: { ...initial.brief, goal: "Updated scope" } } })));
  });
  it("keeps the import page focused on the brief without secondary Markdown controls", async () => {
    render(<GuidedResearchLive sessionId="session-live" onBack={vi.fn()} />);
    await screen.findByRole("textbox", { name: "研究需求" });
    expect(screen.queryByText("完善研究信息与 Markdown")).not.toBeInTheDocument();
    expect(screen.queryByText("输入方式支持：")).not.toBeInTheDocument();
    expect(screen.queryByText("草稿与重新生成")).not.toBeInTheDocument();
    expect(screen.queryByText(/重新确认此步骤会使后续研究结果失效/)).not.toBeInTheDocument();
  });
  it("serializes slow polls and stops after receiving the terminal snapshot", async () => {
    const busy = { ...initial, busy: true, leaseUntil: "2099-01-01T00:00:00.000Z" };
    let finishPoll!: (value: GuidedResearchRuntime) => void;
    vi.mocked(getResearchRuntime).mockResolvedValueOnce(busy)
      .mockImplementationOnce(() => new Promise((resolve) => { finishPoll = resolve; }))
      .mockResolvedValue({ ...busy, busy: false, brief: { ...initial.brief, topic: "Newer progress" } });
    vi.useFakeTimers();
    await act(async () => { render(<GuidedResearchLive sessionId="session-live" onBack={vi.fn()} />); });
    expect(screen.getByTestId("research-step-loading")).toBeInTheDocument();
    await act(async () => { await vi.advanceTimersByTimeAsync(6000); });
    expect(getResearchRuntime).toHaveBeenCalledTimes(2);
    await act(async () => { finishPoll(busy); });
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    expect(screen.getByDisplayValue("Newer progress")).toBeInTheDocument();
    expect(screen.queryByTestId("research-step-loading")).not.toBeInTheDocument();
    await act(async () => { await vi.advanceTimersByTimeAsync(6000); });
    expect(getResearchRuntime).toHaveBeenCalledTimes(3);
  });
  it("keeps a newer collaborator snapshot when an older command response arrives late", async () => {
    let finish!: (value: GuidedResearchRuntime) => void;
    vi.mocked(executeResearchRuntime).mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    const newer = { ...initial, version: 9, brief: { ...initial.brief, topic: "Collaborator update" } };
    vi.mocked(getResearchRuntime).mockResolvedValueOnce(initial).mockResolvedValue(newer);
    vi.useFakeTimers();
    await act(async () => { render(<GuidedResearchLive sessionId="session-live" onBack={vi.fn()} />); });
    fireEvent.click(screen.getByRole("button", { name: "确认并继续" }));
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    expect(screen.queryByTestId("research-step-loading")).not.toBeInTheDocument();
    expect(screen.getByDisplayValue("Collaborator update")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "确认并继续" })).toBeEnabled();
    await act(async () => { finish({ ...initial, version: 8, brief: { ...initial.brief, topic: "Older command" } }); });
    expect(screen.getByDisplayValue("Collaborator update")).toBeInTheDocument();
    expect(screen.queryByDisplayValue("Older command")).not.toBeInTheDocument();
  });
  it("sends session and version bound chat and applies the persisted proposal by id", async () => {
    const proposal = { id: "proposal-1", version: 8, draft: { node: "brief" as const, value: { ...initial.brief, topic: "Revised storage" } } };
    vi.mocked(executeResearchRuntime).mockResolvedValueOnce({ ...initial, version: 8, messages: [{ id: "m1", role: "assistant", node: "brief", text: "Proposed update", createdAt: "2026-09-05" }], proposal })
      .mockResolvedValueOnce({ ...initial, version: 9, brief: proposal.draft.value, generatedNodes: ["brief"] });
    render(<GuidedResearchLive sessionId="session-live" onBack={vi.fn()} />);
    await screen.findByDisplayValue("Storage");
    fireEvent.click(screen.getByRole("button", { name: "AI 助手" }));
    fireEvent.change(screen.getByLabelText("研究对话"), { target: { value: "Focus on storage" } });
    fireEvent.click(screen.getByRole("button", { name: "发送研究消息" }));
    await screen.findByText("Proposed update");
    expect(executeResearchRuntime).toHaveBeenCalledWith(expect.objectContaining({ sessionId: "session-live", expectedVersion: 7, node: "brief", action: "message", message: "Focus on storage" }));
    expect(screen.getByDisplayValue("Revised storage")).toBeInTheDocument();
    expect(screen.getByTestId("research-conversation-draft")).toHaveTextContent("尚未应用");
    fireEvent.click(screen.getByRole("button", { name: "应用建议" }));
    await screen.findByDisplayValue("Revised storage");
    expect(executeResearchRuntime).toHaveBeenLastCalledWith(expect.objectContaining({ action: "apply", proposalId: "proposal-1", expectedVersion: 8 }));
  });
  it("shows search URLs and retries failed tasks without source management controls", async () => {
    const research: GuidedResearchRuntime = { ...initial, currentNode: "research", availableNodes: ["brief", "directions", "outline", "research"], generatedNodes: ["brief", "directions", "outline", "research"],
      tasks: [{ id: "t1", sectionId: "s1", query: "Grid policy", status: "failed", attempts: 1, errorCode: "RESEARCH_SEARCH_UNAVAILABLE" }],
      sources: [{ id: "src1", taskId: "t1", title: "Official source", url: "https://example.org/policy", content: "A retrieved source", retrievedAt: "2026-09-05", decision: "pending" }] };
    vi.mocked(getResearchRuntime).mockResolvedValue(research);
    vi.mocked(executeResearchRuntime).mockResolvedValue({ ...research, version: 8, sources: [{ ...research.sources[0]!, decision: "excluded" }] });
    render(<GuidedResearchLive sessionId="session-live" onBack={vi.fn()} />);
    expect(await screen.findByTestId("research-source-description-src1")).toHaveAttribute("href", "https://example.org/policy");
    expect(screen.getByTestId("research-source-description-src1")).toHaveTextContent("A retrieved source");
    expect(screen.getByRole("button", { name: "继续重试" })).toBeEnabled();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "删除来源 Official source" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "继续重试" }));
    await waitFor(() => expect(executeResearchRuntime).toHaveBeenCalledWith(expect.objectContaining({ action: "retry", node: "research", expectedVersion: 7 })));
  });
  it("offers a durable resume action for a previously paused research session", async () => {
    const paused: GuidedResearchRuntime = { ...initial, currentNode: "research", availableNodes: ["brief", "directions", "outline", "research"],
      controlStatus: "paused", planRevision: 3,
      tasks: [{ id: "t1", sectionId: "s1", query: "Grid policy", status: "pending", attempts: 0, errorCode: null }] };
    vi.mocked(getResearchRuntime).mockResolvedValue(paused);
    vi.mocked(executeResearchRuntime).mockResolvedValue({ ...paused, version: 8, controlStatus: "running" });
    render(<GuidedResearchLive sessionId="session-live" onBack={vi.fn()} />);
    const resume = await screen.findByRole("button", { name: "继续研究" });
    expect(screen.queryByRole("button", { name: "搜索资料" })).not.toBeInTheDocument();
    fireEvent.click(resume);
    await waitFor(() => expect(executeResearchRuntime).toHaveBeenCalledWith(expect.objectContaining({
      action: "resume", node: "research", expectedVersion: 7, expectedRevision: 3, idempotencyKey: expect.any(String),
    })));
    expect(await screen.findByRole("button", { name: "搜索资料" })).toBeEnabled();
  });
});

describe("research request recovery", () => {
  it("retries initial loading without leaving the session", async () => {
    vi.mocked(getResearchRuntime).mockRejectedValueOnce(new Error("offline"));
    render(<GuidedResearchLive sessionId="session-live" onBack={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: "重试加载" }));
    expect(await screen.findByDisplayValue("Storage")).toBeInTheDocument();
    expect(getResearchRuntime).toHaveBeenCalledTimes(2);
  });
  it("preserves the editor on conflict and lets the user resume against the latest version", async () => {
    const latest = { ...initial, version: 9, brief: { ...initial.brief, topic: "Collaborator topic" } };
    vi.mocked(getResearchRuntime).mockResolvedValueOnce(initial).mockResolvedValue(latest);
    vi.mocked(executeResearchRuntime).mockRejectedValueOnce(new ApiError(409, "RESEARCH_GRAPH_VERSION_CONFLICT", {}))
      .mockResolvedValueOnce({ ...latest, version: 10 });
    render(<GuidedResearchLive sessionId="session-live" onBack={vi.fn()} />);
    fireEvent.change(await screen.findByRole("textbox", { name: "研究需求" }), { target: { value: "My unsaved topic" } });
    fireEvent.click(screen.getByRole("button", { name: "确认并继续" }));
    const resume = await screen.findByRole("button", { name: "继续编辑保留的草稿" });
    await waitFor(() => expect(resume).toBeEnabled());
    expect(screen.getByRole("textbox", { name: "研究需求" })).toHaveValue("My unsaved topic");
    expect(screen.getByRole("button", { name: "确认并继续" })).toBeDisabled();
    expect(executeResearchRuntime).toHaveBeenCalledTimes(1);
    fireEvent.click(resume);
    fireEvent.click(screen.getByRole("button", { name: "确认并继续" }));
    await waitFor(() => expect(executeResearchRuntime).toHaveBeenLastCalledWith(expect.objectContaining({ expectedVersion: 9, draft: { node: "brief", value: { ...initial.brief, goal: "My unsaved topic" } } })));
  });
  it("requires a successful recovery read before submitting again, and can adopt the server draft", async () => {
    vi.mocked(getResearchRuntime).mockResolvedValueOnce(initial).mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValue({ ...initial, version: 9, brief: { ...initial.brief, topic: "Server topic" } });
    vi.mocked(executeResearchRuntime).mockRejectedValue(new Error("offline"));
    render(<GuidedResearchLive sessionId="session-live" onBack={vi.fn()} />);
    fireEvent.change(await screen.findByRole("textbox", { name: "研究需求" }), { target: { value: "Local topic" } });
    fireEvent.click(screen.getByRole("button", { name: "确认并继续" }));
    await screen.findByTestId("research-recovery");
    await waitFor(() => expect(screen.getByRole("button", { name: "重新读取进度" })).toBeEnabled());
    expect(screen.getByRole("button", { name: "使用最新进度" })).toBeDisabled();
    expect(screen.getByRole("textbox", { name: "研究需求" })).toHaveValue("Local topic");
    fireEvent.click(screen.getByRole("button", { name: "重新读取进度" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "使用最新进度" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "使用最新进度" }));
    expect(screen.getByDisplayValue("Server topic")).toBeInTheDocument();
    expect(screen.queryByTestId("research-recovery")).not.toBeInTheDocument();
    expect(executeResearchRuntime).toHaveBeenCalledTimes(1);
  });
  it("does not leak a failed request or retained draft into a different session", async () => {
    let reject!: (reason: unknown) => void;
    vi.mocked(executeResearchRuntime).mockImplementation(() => new Promise((_, fail) => { reject = fail; }));
    const view = render(<GuidedResearchLive sessionId="session-live" onBack={vi.fn()} />);
    fireEvent.change(await screen.findByRole("textbox", { name: "研究需求" }), { target: { value: "Old private draft" } });
    fireEvent.click(screen.getByRole("button", { name: "确认并继续" }));
    vi.mocked(getResearchRuntime).mockResolvedValue({ ...initial, sessionId: "other-session", brief: { ...initial.brief, topic: "Other research" } });
    view.rerender(<GuidedResearchLive sessionId="other-session" onBack={vi.fn()} />);
    await screen.findByDisplayValue("Other research");
    await act(async () => { reject(new Error("late failure")); });
    expect(screen.queryByTestId("research-recovery")).not.toBeInTheDocument();
    expect(screen.queryByDisplayValue("Old private draft")).not.toBeInTheDocument();
  });
});

it("keeps recovered edits when an abandoned execution lease has expired", async () => {
  const expired = { ...initial, version: 9, busy: true, leaseUntil: "2020-01-01T00:00:00.000Z" };
  vi.mocked(getResearchRuntime).mockResolvedValueOnce(initial).mockResolvedValue(expired);
  vi.mocked(executeResearchRuntime).mockRejectedValue(new ApiError(409, "RESEARCH_GRAPH_VERSION_CONFLICT", {}));
  vi.useFakeTimers();
  await act(async () => { render(<GuidedResearchLive sessionId="session-live" onBack={vi.fn()} />); });
  fireEvent.change(screen.getByRole("textbox", { name: "研究需求" }), { target: { value: "Keep this draft" } });
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "确认并继续" })); });
  fireEvent.click(screen.getByRole("button", { name: "继续编辑保留的草稿" }));
  await act(async () => { await vi.advanceTimersByTimeAsync(4000); });
  expect(screen.getByRole("textbox", { name: "研究需求" })).toHaveValue("Keep this draft");
  expect(getResearchRuntime).toHaveBeenCalledTimes(2);
});

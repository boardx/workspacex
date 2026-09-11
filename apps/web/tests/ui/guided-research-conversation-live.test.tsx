import * as React from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { GuidedResearchLive } from "@/components/research-studio/guided-research-live";
import { executeResearchRuntime, getResearchRuntime } from "@/lib/guided-research-api";
import { runtimeFixture } from "../guided-runtime-fixture";
vi.mock("@/lib/guided-research-api", () => ({ getResearchRuntime: vi.fn(), executeResearchRuntime: vi.fn() }));
const base = runtimeFixture("brief");
const proposal = { id: "pending", version: base.version, action: "save" as const, draft: { node: "brief" as const, value: { ...base.brief, topic: "德国储能市场", goal: "比较进入机会" } } };
afterEach(() => vi.useRealTimers());
beforeEach(() => { vi.resetAllMocks(); vi.mocked(getResearchRuntime).mockResolvedValue({ ...base, proposal }); });
it("restores the conversation draft on the right and uses it for the next message without applying", async () => {
  vi.mocked(executeResearchRuntime).mockResolvedValue({ ...base, version: 5, proposal: { ...proposal, version: 5 } });
  render(<GuidedResearchLive sessionId={base.sessionId} onBack={vi.fn()} />);
  await screen.findByDisplayValue("德国储能市场");
  expect(executeResearchRuntime).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText("研究对话"), { target: { value: "再增加法国" } });
  fireEvent.keyDown(screen.getByLabelText("研究对话"), { key: "Enter" });
  await waitFor(() => expect(executeResearchRuntime).toHaveBeenCalledWith(expect.objectContaining({ action: "message", message: "再增加法国", draft: proposal.draft, expectedVersion: 4 })));
});
it("does not apply an old suggestion after the right-hand draft was edited", async () => {
  render(<GuidedResearchLive sessionId={base.sessionId} onBack={vi.fn()} />);
  fireEvent.change(await screen.findByDisplayValue("德国储能市场"), { target: { value: "法国储能市场" } });
  expect(screen.getByRole("button", { name: "应用建议" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "保存草稿" })).toBeDisabled();
  expect(executeResearchRuntime).not.toHaveBeenCalled();
});
it.each(["stale", "busy", "error"])("does not present %s proposals as current drafts", async (condition) => {
  vi.mocked(getResearchRuntime).mockResolvedValue({ ...base, proposal: { ...proposal, version: condition === "stale" ? 3 : 4 }, busy: condition === "busy", leaseUntil: condition === "busy" ? "2099-01-01T00:00:00Z" : null, errorCode: condition === "error" ? "RESEARCH_WORKFLOW_UNAVAILABLE" : null });
  render(<GuidedResearchLive sessionId={base.sessionId} onBack={vi.fn()} />);
  await screen.findByTestId("research-skill-assistant");
  expect(screen.queryByDisplayValue("德国储能市场")).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "应用建议" })).not.toBeInTheDocument();
});
it("preserves the preview draft when a follow-up model request fails", async () => {
  vi.mocked(executeResearchRuntime).mockResolvedValue({ ...base, version: 5, proposal: null, errorCode: "RESEARCH_WORKFLOW_UNAVAILABLE" });
  render(<GuidedResearchLive sessionId={base.sessionId} onBack={vi.fn()} />);
  await screen.findByDisplayValue("德国储能市场");
  fireEvent.change(screen.getByLabelText("研究对话"), { target: { value: "增加法国" } });
  fireEvent.click(screen.getByRole("button", { name: "发送研究消息" }));
  await screen.findByTestId("research-recovery");
  expect(screen.getByDisplayValue("德国储能市场")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "继续编辑保留的草稿" }));
  expect(screen.getByDisplayValue("德国储能市场")).toBeInTheDocument();
  expect(executeResearchRuntime).toHaveBeenCalledTimes(1);
});
it("supports prompt selection, multiline input and Chinese composition without accidental sends", async () => {
  render(<GuidedResearchLive sessionId={base.sessionId} onBack={vi.fn()} />);
  await screen.findByDisplayValue("德国储能市场");
  fireEvent.click(screen.getByRole("button", { name: "确认当前主题，生成研究方向" }));
  const input = screen.getByLabelText("研究对话");
  expect(input).toHaveValue("确认当前主题，生成研究方向");
  fireEvent.keyDown(input, { key: "Enter", shiftKey: true });
  fireEvent.compositionStart(input);
  fireEvent.keyDown(input, { key: "Enter" });
  fireEvent.compositionEnd(input);
  fireEvent.keyDown(input, { key: "Enter", keyCode: 229 });
  expect(executeResearchRuntime).not.toHaveBeenCalled();
});
it("previews source exclusions without deleting persisted sources", async () => {
  const state = runtimeFixture("research");
  vi.mocked(getResearchRuntime).mockResolvedValue({ ...state, proposal: { id: "sources", version: 4, action: "save", draft: { node: "research", value: [{ id: "source1", decision: "excluded" }] } } });
  render(<GuidedResearchLive sessionId={state.sessionId} onBack={vi.fn()} />);
  await screen.findByTestId("research-conversation-draft");
  expect(screen.queryByRole("link", { name: "Official policy" })).not.toBeInTheDocument();
  expect(executeResearchRuntime).not.toHaveBeenCalled();
});
it("previews report content and requires applying it before completing research", async () => {
  const state = runtimeFixture("report");
  const report = { ...state.report!, summary: "对话修订后的摘要" };
  vi.mocked(getResearchRuntime).mockResolvedValue({ ...state, proposal: { id: "report", version: 4, action: "save", draft: { node: "report", value: report } } });
  vi.mocked(executeResearchRuntime).mockResolvedValue({ ...state, version: 5, report, completed: true });
  render(<GuidedResearchLive sessionId={state.sessionId} onBack={vi.fn()} />);
  await screen.findByTestId("research-report");
  expect(screen.getByTestId("research-report")).toHaveTextContent("对话修订后的摘要");
  expect(screen.getByRole("button", { name: "完成研究" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "应用建议" }));
  await waitFor(() => expect(executeResearchRuntime).toHaveBeenCalledWith(expect.objectContaining({ action: "apply", proposalId: "report" })));
});

it("retains the submitted conversation draft when polling discovers failure before the POST returns", async () => {
  vi.mocked(getResearchRuntime).mockResolvedValueOnce({ ...base, proposal }).mockResolvedValue({ ...base, version: 5, proposal: null, errorCode: "RESEARCH_WORKFLOW_UNAVAILABLE" });
  vi.mocked(executeResearchRuntime).mockImplementation(() => new Promise(() => {}));
  vi.useFakeTimers();
  await act(async () => { render(<GuidedResearchLive sessionId={base.sessionId} onBack={vi.fn()} />); });
  fireEvent.change(screen.getByLabelText("研究对话"), { target: { value: "继续完善" } });
  fireEvent.click(screen.getByRole("button", { name: "发送研究消息" }));
  await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
  expect(screen.getByTestId("research-recovery")).toBeInTheDocument();
  expect(screen.getByDisplayValue("德国储能市场")).toBeInTheDocument();
  expect(executeResearchRuntime).toHaveBeenCalledTimes(1);
});

it("requires adopting the first generated proposal before right-hand confirmation", async () => {
  vi.mocked(getResearchRuntime).mockResolvedValue({ ...base, generatedNodes: [], proposal });
  render(<GuidedResearchLive sessionId={base.sessionId} onBack={vi.fn()} />);
  await screen.findByDisplayValue("德国储能市场");
  expect(screen.getByRole("button", { name: "确认并继续" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "应用建议" })).toBeEnabled();
  expect(screen.getByRole("button", { name: "保存草稿" })).toBeDisabled();
});

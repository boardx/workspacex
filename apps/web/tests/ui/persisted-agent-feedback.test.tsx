import { beforeEach, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
const { getRun, request, open } = vi.hoisted(() => ({ getRun: vi.fn(), request: vi.fn(), open: vi.fn() }));
vi.mock("@/lib/agent-run", () => ({ getAgentRun: getRun }));
vi.mock("@/lib/api-client", () => ({ apiRequest: request, getStoredSessionToken: () => "bearer" }));
vi.mock("@/components/feedback/feedback-provider", () => ({ useOptionalFeedback: () => ({ openFeedback: open }) }));
import { PersistedAgentFeedback } from "@/components/chat/workbench/persisted-agent-feedback";
import { MessageRunContext } from "@/lib/chat-workbench/trace-context";
const row = (agentId: string, name: string) => ({ agentId, name, initials: "A", role: "assistant", roleLabel: "助手", visibility: "全组织可用", publishState: "运行中", modelId: null, skillCount: 0, monthlyCallCount: null });
beforeEach(() => { vi.clearAllMocks(); getRun.mockResolvedValue({ agentId: "historical", resultMessageId: "persisted" }); request.mockResolvedValue([row("selected", "当前选择"), row("historical", "真正作者")]); });
function content(messageId: string | null, runId = "run-1") { return <MessageRunContext.Provider value={runId}><PersistedAgentFeedback messageId={messageId} /></MessageRunContext.Provider>; }
it("持久回复反馈指向真实run作者及名称，而非当前选择", async () => {
  render(content("persisted"));
  fireEvent.click(await screen.findByTestId("chat-agent-feedback"));
  expect(open).toHaveBeenCalledWith({ target: { kind: "agent", agentId: "historical" }, targetLabel: "真正作者" });
});
it("未持久消息不显示也不请求作者", () => { render(content(null)); expect(screen.queryByTestId("chat-agent-feedback")).toBeNull(); expect(getRun).not.toHaveBeenCalled(); });
it("run结果身份不匹配不冒认归属", async () => { render(content("other-message")); await waitFor(() => expect(getRun).toHaveBeenCalled()); expect(request).not.toHaveBeenCalled(); expect(screen.queryByTestId("chat-agent-feedback")).toBeNull(); });
it("切换消息后旧作者迟到响应不能显示在新消息", async () => {
  let done!: (value: unknown) => void;
  getRun.mockReturnValueOnce(new Promise((resolve) => { done = resolve; }));
  const view = render(content("persisted"));
  view.rerender(content(null, "run-2"));
  await act(async () => done({ agentId: "historical", resultMessageId: "persisted" }));
  expect(screen.queryByTestId("chat-agent-feedback")).toBeNull(); expect(request).not.toHaveBeenCalled();
});

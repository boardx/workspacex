import * as React from "react";
import { beforeEach, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ResearchNewRoute } from "@/components/research-studio/research-new-route";
import { ResearchStageRoute } from "@/components/research-studio/research-stage-route";
import { createGuidedResearchSession, getResearchRuntime, runGuidedResearchSkillTurn } from "@/lib/guided-research-api";
import { research } from "@repo/contracts";

const { push } = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
vi.mock("@/components/research-studio/guided-research-live", () => ({ GuidedResearchLive: ({ sessionId, visualStage, initialNode, onBack }: { sessionId: string; visualStage: string; initialNode: string; onBack: () => void }) => <div data-testid="production-live" data-session={sessionId} data-stage={visualStage} data-node={initialNode}><button onClick={onBack}>返回列表</button></div> }));
vi.mock("@/lib/guided-research-api", () => ({ createGuidedResearchSession: vi.fn(), getResearchRuntime: vi.fn(), executeResearchRuntime: vi.fn(), confirmResearchBrief: vi.fn(), executeGuidedResearchNodeCommand: vi.fn(), getGuidedResearchSession: vi.fn(), runGuidedResearchSkillTurn: vi.fn() }));

beforeEach(() => { vi.resetAllMocks(); sessionStorage.clear(); localStorage.clear(); });

it("routes every stage to the real runtime and returns to the Workspace list", () => {
  const { unmount } = render(<ResearchStageRoute sessionId="real-session" stage="chapters" />);
  expect(screen.getByTestId("production-live")).toHaveAttribute("data-node", "report");
  expect(screen.getByTestId("production-live")).toHaveAttribute("data-stage", "chapters");
  fireEvent.click(screen.getByRole("button", { name: "返回列表" }));
  expect(push).toHaveBeenCalledWith("/research");
  unmount();
});

it("starts intake empty instead of loading a demonstration brief", () => {
  render(<ResearchNewRoute />);
  expect(screen.getByRole("textbox", { name: "研究目标" })).toHaveValue("");
  expect(screen.getByRole("textbox", { name: "研究主题" })).toHaveValue("");
  expect(screen.getByTestId("research-confirm-brief")).toBeDisabled();
  fireEvent.click(screen.getByTestId("research-flow-back"));
  expect(push).toHaveBeenCalledWith("/research");
});

it("keeps a typed intake when returning to the list is cancelled", () => {
  render(<ResearchNewRoute />);
  fireEvent.change(screen.getByRole("textbox", { name: "研究目标" }), { target: { value: "尚未提交的需求" } });
  fireEvent.click(screen.getByTestId("research-flow-back"));
  expect(push).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "继续编辑" }));
  expect(screen.getByRole("textbox", { name: "研究目标" })).toHaveValue("尚未提交的需求");
  fireEvent.click(screen.getByTestId("research-flow-back"));
  fireEvent.click(screen.getByRole("button", { name: "放弃修改并离开" }));
  expect(push).toHaveBeenCalledWith("/research");
});

it("preserves the creation key on failure and resumes the actual server node", async () => {
  vi.mocked(createGuidedResearchSession).mockRejectedValueOnce(new Error("connection lost")).mockResolvedValueOnce({ sessionId: "created-session" } as never);
  vi.mocked(getResearchRuntime).mockResolvedValue({ version: 3, currentNode: "directions" } as never);
  render(<ResearchNewRoute />);
  fireEvent.change(screen.getByRole("textbox", { name: "研究主题" }), { target: { value: "User topic" } });
  fireEvent.change(screen.getByRole("textbox", { name: "研究目标" }), { target: { value: "User objective" } });
  fireEvent.click(screen.getByTestId("research-confirm-brief"));
  await screen.findByRole("alert");
  fireEvent.click(screen.getByTestId("research-confirm-brief"));
  await waitFor(() => expect(push).toHaveBeenCalledWith("/research/created-session/topic"));
  const [first, second] = vi.mocked(createGuidedResearchSession).mock.calls;
  expect(second?.[0].idempotencyKey).toBe(first?.[0].idempotencyKey);
  expect(second?.[0]).toMatchObject({ title: "User topic", brief: { topic: "User topic", goal: "User objective" } });
});

it("only applies a real assistant proposal after explicit user adoption", async () => {
  const brief = { topic: "Suggested topic", goal: "Suggested objective", timeRange: "2026", region: "Europe", focus: "Policy" };
  vi.mocked(runGuidedResearchSkillTurn).mockResolvedValue({ assistantMessage: "Please review", proposal: { node: "brief", value: brief } } as never);
  render(<ResearchNewRoute />);
  fireEvent.click(screen.getByRole("button", { name: "AI 助手" }));
  fireEvent.change(screen.getByRole("textbox", { name: "和研究助手讨论" }), { target: { value: "Help refine this question" } });
  fireEvent.click(screen.getByRole("button", { name: "发送" }));
  await screen.findByRole("button", { name: "应用建议" });
  expect(() => research.operations.runGuidedResearchSkillTurn.in.parse(vi.mocked(runGuidedResearchSkillTurn).mock.calls[0]?.[0])).not.toThrow();
  expect(screen.getByRole("textbox", { name: "研究目标" })).toHaveValue("");
  fireEvent.click(screen.getByRole("button", { name: "AI 助手" }));
  fireEvent.click(screen.getByRole("button", { name: "AI 助手" }));
  expect(screen.getByRole("textbox", { name: "和研究助手讨论" })).toHaveValue("Help refine this question");
  fireEvent.click(screen.getByRole("button", { name: "应用建议" }));
  expect(screen.getByRole("textbox", { name: "研究目标" })).toHaveValue("Suggested objective");
});

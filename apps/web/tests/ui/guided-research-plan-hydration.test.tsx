import { beforeEach, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { research as C } from "@repo/contracts";
import { GuidedResearchLive } from "@/components/research-studio/guided-research-live";
import { executeResearchRuntime, getResearchRuntime, ResearchRuntimeHydrationError } from "@/lib/guided-research-api";

vi.mock("@/lib/guided-research-api", async original => ({ ...await original<typeof import("@/lib/guided-research-api")>(), executeResearchRuntime: vi.fn(), getResearchRuntime: vi.fn() }));
const initial = C.GuidedResearchRuntime.parse({ sessionId: "s", version: 7, revision: 2, currentNode: "outline", availableNodes: ["brief", "directions", "outline"],
  brief: { topic: "Public research", goal: "Confirm plan", timeRange: "", region: "", focus: "" }, directions: [], outline: [{ id: "o", title: "Original plan", questions: ["Question?"], enabled: true, order: 0 }],
  tasks: [], sources: [], report: null, completed: false, busy: false, leaseUntil: null, errorCode: null, generatedNodes: ["outline"], proposal: null, messages: [], modelCalls: [] });
beforeEach(() => vi.resetAllMocks());
it("keeps the acknowledged plan visible after hydration and recovery reads fail, without replaying a command", async () => {
  const acknowledged = { ...initial, version: 8, revision: 3, currentNode: "research" as const,
    outline: [{ ...initial.outline[0]!, title: "Saved plan" }], availableNodes: [...initial.availableNodes, "research" as const] };
  vi.mocked(getResearchRuntime).mockResolvedValueOnce(initial).mockRejectedValue(new Error("GET unavailable"));
  vi.mocked(executeResearchRuntime).mockRejectedValueOnce(new ResearchRuntimeHydrationError(acknowledged, new Error("GET unavailable")));
  render(<GuidedResearchLive sessionId="s" onBack={vi.fn()} />);
  fireEvent.click(await screen.findByRole("button", { name: "生成报告" }));
  await screen.findByTestId("research-recovery");
  await waitFor(() => expect(screen.getByTestId("guided-research-plan-panel")).toHaveTextContent("Saved plan"));
  expect(screen.getByText("已保存当前进度，暂时无法获取完整内容，请同步后继续。")).toBeInTheDocument();
  expect(executeResearchRuntime).toHaveBeenCalledTimes(1);
});

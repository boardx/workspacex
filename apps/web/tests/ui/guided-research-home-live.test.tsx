import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { GuidedResearchFlow } from "@/components/research-studio/guided-research-flow";

const { listGuidedResearchSessions, createGuidedResearchSession } = vi.hoisted(() => ({
  listGuidedResearchSessions: vi.fn(),
  createGuidedResearchSession: vi.fn(),
}));

vi.mock("@/lib/guided-research-api", () => ({
  listGuidedResearchSessions,
  createGuidedResearchSession,
}));

describe("F168 guided research home live data", () => {
  it("renders server history and resumes from the server-authored stage", async () => {
    listGuidedResearchSessions.mockResolvedValueOnce({
      items: [
        {
          sessionId: "grs-running", title: "德国工商储电价机制", brief: {
            topic: "德国工商储电价机制", goal: "判断市场机会", timeRange: "2025", region: "德国", focus: "电价",
          }, stage: "researching", resumeStage: "researching", status: "active", progress: 64, sourceCount: 19, reportId: null,
          createdAt: "2026-08-11T09:00:00.000Z", updatedAt: "2026-08-12T09:00:00.000Z",
        },
        {
          sessionId: "grs-done", title: "欧洲并网审批流程", brief: {
            topic: "欧洲并网审批流程", goal: "形成报告", timeRange: "2025", region: "欧洲", focus: "审批",
          }, stage: "report", resumeStage: "report", status: "completed", progress: 100, sourceCount: 33, reportId: "report-1",
          createdAt: "2026-08-10T09:00:00.000Z", updatedAt: "2026-08-12T08:00:00.000Z",
        },
      ],
    });
    const onStepChange = vi.fn();
    render(<GuidedResearchFlow step="home" onStepChange={onStepChange} />);

    await waitFor(() => expect(screen.getByTestId("research-history-grs-running")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("research-continue-grs-running"));
    expect(onStepChange).toHaveBeenCalledWith("search", "grs-running");
    fireEvent.click(screen.getByTestId("research-view-grs-done"));
    expect(onStepChange).toHaveBeenCalledWith("report", "grs-done");
  });

  it("creates a persisted session before entering directions", async () => {
    createGuidedResearchSession.mockResolvedValueOnce({ sessionId: "grs-new", stage: "directions" });
    const onStepChange = vi.fn();
    render(<GuidedResearchFlow step="brief" onStepChange={onStepChange} />);

    fireEvent.change(screen.getByTestId("research-brief-topic"), { target: { value: "新的研究主题" } });
    fireEvent.click(screen.getByTestId("research-confirm-brief"));

    await waitFor(() => expect(createGuidedResearchSession).toHaveBeenCalledTimes(1));
    expect(createGuidedResearchSession).toHaveBeenCalledWith(expect.objectContaining({
      idempotencyKey: expect.any(String),
      brief: expect.objectContaining({ topic: "新的研究主题" }),
    }));
    await waitFor(() => expect(onStepChange).toHaveBeenCalledWith("directions", "grs-new"));
  });
});

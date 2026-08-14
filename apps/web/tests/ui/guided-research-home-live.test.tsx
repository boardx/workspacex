import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { GuidedResearchFlow } from "@/components/research-studio/guided-research-flow";

const { listGuidedResearchSessions, createGuidedResearchSession, getGuidedResearchSession } = vi.hoisted(() => ({
  listGuidedResearchSessions: vi.fn(),
  createGuidedResearchSession: vi.fn(),
  getGuidedResearchSession: vi.fn(),
}));

vi.mock("@/lib/guided-research-api", () => ({
  listGuidedResearchSessions,
  createGuidedResearchSession,
  getGuidedResearchSession,
}));

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  listGuidedResearchSessions.mockReset();
  createGuidedResearchSession.mockReset();
  getGuidedResearchSession.mockReset();
  listGuidedResearchSessions.mockResolvedValue({ items: [] });
});

describe("F168 guided research home live data", () => {
  it("asks for a name and optional tags before entering the research brief", () => {
    const onStepChange = vi.fn();
    render(<GuidedResearchFlow step="home" onStepChange={onStepChange} />);

    fireEvent.click(screen.getByTestId("research-create"));
    expect(screen.getByTestId("research-create-dialog")).toBeInTheDocument();
    expect(screen.getByTestId("research-create-submit")).toBeDisabled();

    fireEvent.change(screen.getByTestId("research-create-name"), { target: { value: "欧洲储能进入研究" } });
    fireEvent.change(screen.getByTestId("research-create-tags"), { target: { value: "欧洲" } });
    fireEvent.keyDown(screen.getByTestId("research-create-tags"), { key: "Enter" });
    fireEvent.click(screen.getByTestId("research-create-submit"));

    expect(onStepChange).toHaveBeenCalledWith("brief", undefined);
  });

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
    window.sessionStorage.setItem("wsx.guidedResearch.createDraft", JSON.stringify({
      title: "欧洲储能进入研究", tags: ["欧洲", "储能"],
    }));
    render(<GuidedResearchFlow step="brief" onStepChange={onStepChange} />);

    fireEvent.change(screen.getByTestId("research-brief-topic"), { target: { value: "新的研究主题" } });
    fireEvent.click(screen.getByTestId("research-confirm-brief"));

    await waitFor(() => expect(createGuidedResearchSession).toHaveBeenCalledTimes(1));
    expect(createGuidedResearchSession).toHaveBeenCalledWith(expect.objectContaining({
      title: "欧洲储能进入研究",
      tags: ["欧洲", "储能"],
      idempotencyKey: expect.any(String),
      brief: expect.objectContaining({ topic: "新的研究主题" }),
    }));
    await waitFor(() => expect(onStepChange).toHaveBeenCalledWith("directions", "grs-new"));
  });

  it("uses the session URL to restore the server-authored stage", async () => {
    getGuidedResearchSession.mockResolvedValueOnce({
      sessionId: "grs-recover", title: "恢复中的研究", brief: {
        topic: "恢复中的研究", goal: "继续检索", timeRange: "2026", region: "欧洲", focus: "政策",
      }, stage: "researching", resumeStage: "researching", status: "active", progress: 68, sourceCount: 27,
      reportId: null, createdAt: "2026-08-10T09:00:00.000Z", updatedAt: "2026-08-12T09:00:00.000Z",
    });

    render(<GuidedResearchFlow step="directions" sessionId="grs-recover" />);

    await waitFor(() => expect(getGuidedResearchSession).toHaveBeenCalledWith("grs-recover"));
    expect(await screen.findByTestId("research-flow-search")).toBeInTheDocument();
  });

  it("reuses the create idempotency key after remount and clears it only after success", async () => {
    createGuidedResearchSession
      .mockRejectedValueOnce(new Error("response lost"))
      .mockResolvedValueOnce({ sessionId: "grs-replayed", stage: "directions" });
    const first = render(<GuidedResearchFlow step="brief" onStepChange={vi.fn()} />);
    fireEvent.click(screen.getByTestId("research-confirm-brief"));
    await waitFor(() => expect(createGuidedResearchSession).toHaveBeenCalledTimes(1));
    const firstKey = createGuidedResearchSession.mock.calls[0]![0].idempotencyKey;
    expect(Object.values(window.localStorage).some((value) => value.includes(firstKey))).toBe(true);

    first.unmount();
    const onStepChange = vi.fn();
    render(<GuidedResearchFlow step="brief" onStepChange={onStepChange} />);
    fireEvent.click(screen.getByTestId("research-confirm-brief"));

    await waitFor(() => expect(createGuidedResearchSession).toHaveBeenCalledTimes(2));
    expect(createGuidedResearchSession.mock.calls[1]![0].idempotencyKey).toBe(firstKey);
    await waitFor(() => expect(onStepChange).toHaveBeenCalledWith("directions", "grs-replayed"));
    expect(Object.values(window.localStorage).some((value) => value.includes(firstKey))).toBe(false);
  });

  it("does not reuse an idempotency key after the brief changes into a different create intent", async () => {
    createGuidedResearchSession
      .mockRejectedValueOnce(new Error("response lost"))
      .mockResolvedValueOnce({ sessionId: "grs-other", stage: "directions" });
    const first = render(<GuidedResearchFlow step="brief" onStepChange={vi.fn()} />);
    fireEvent.click(screen.getByTestId("research-confirm-brief"));
    await waitFor(() => expect(createGuidedResearchSession).toHaveBeenCalledTimes(1));
    const firstKey = createGuidedResearchSession.mock.calls[0]![0].idempotencyKey;
    first.unmount();

    render(<GuidedResearchFlow step="brief" onStepChange={vi.fn()} />);
    fireEvent.change(screen.getByTestId("research-brief-topic"), { target: { value: "另一个研究主题" } });
    fireEvent.click(screen.getByTestId("research-confirm-brief"));
    await waitFor(() => expect(createGuidedResearchSession).toHaveBeenCalledTimes(2));
    expect(createGuidedResearchSession.mock.calls[1]![0].idempotencyKey).not.toBe(firstKey);
  });

  it("garbage-collects stale pending create keys", async () => {
    window.localStorage.setItem("wsx.guidedResearch.createIdempotencyKey.old-tab.old-intent", JSON.stringify({
      key: "guided-stale", createdAt: Date.now() - 25 * 60 * 60 * 1000,
    }));
    createGuidedResearchSession.mockRejectedValueOnce(new Error("offline"));
    render(<GuidedResearchFlow step="brief" onStepChange={vi.fn()} />);
    fireEvent.click(screen.getByTestId("research-confirm-brief"));
    await waitFor(() => expect(createGuidedResearchSession).toHaveBeenCalledTimes(1));
    expect(window.localStorage.getItem("wsx.guidedResearch.createIdempotencyKey.old-tab.old-intent")).toBeNull();
  });
});

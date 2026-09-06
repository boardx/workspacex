import { runtimeFixture } from "../guided-runtime-fixture";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { GuidedResearchFlow } from "@/components/research-studio/guided-research-flow";

const { executeResearchRuntime, getResearchRuntime, listGuidedResearchSessions, createGuidedResearchSession, getGuidedResearchSession, finishGuidedResearchCollection, completeGuidedResearchSession } = vi.hoisted(() => ({
  executeResearchRuntime: vi.fn(),
  getResearchRuntime: vi.fn(),
  listGuidedResearchSessions: vi.fn(),
  createGuidedResearchSession: vi.fn(),
  getGuidedResearchSession: vi.fn(),
  finishGuidedResearchCollection: vi.fn(),
  completeGuidedResearchSession: vi.fn(),
}));

vi.mock("@/lib/guided-research-api", () => ({
  executeResearchRuntime,
  getResearchRuntime,  listGuidedResearchSessions,
  createGuidedResearchSession,
  getGuidedResearchSession,
  finishGuidedResearchCollection,
  completeGuidedResearchSession,
}));

function createdSession(sessionId: string) {
  return {
    sessionId,
    title: "欧洲储能进入研究",
    tags: ["欧洲", "储能"],
    brief: {
      topic: "新的研究主题",
      goal: "判断市场机会",
      timeRange: "2025",
      region: "欧洲",
      focus: "储能",
    },
    briefVersion: 1,
    briefConfirmedAt: "2026-08-13T00:00:00.000Z",
    directions: { candidateVersion: null, confirmedVersion: null, versions: [] },
    outline: { candidateVersion: null, confirmedVersion: null, versions: [] },
    stage: "directions",
    resumeStage: "directions",
    status: "active",
    progress: 20,
    sourceCount: 0,
    reportId: null,
    createdAt: "2026-08-13T00:00:00.000Z",
    updatedAt: "2026-08-13T00:00:00.000Z",
  };
}

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  listGuidedResearchSessions.mockReset();
  createGuidedResearchSession.mockReset();
  getGuidedResearchSession.mockReset();
  getResearchRuntime.mockReset();
  executeResearchRuntime.mockReset();
  getResearchRuntime.mockImplementation(async (sessionId: string) => ({ ...runtimeFixture("brief", sessionId), version: 0 }));
  executeResearchRuntime.mockImplementation(async ({ sessionId }: { sessionId: string }) => runtimeFixture("directions", sessionId));
  finishGuidedResearchCollection.mockReset();
  completeGuidedResearchSession.mockReset();
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

  it("uses the shared Studio list-page width and card density", async () => {
    listGuidedResearchSessions.mockResolvedValueOnce({
      items: [{
        sessionId: "grs-style", title: "欧洲储能进入研究", tags: ["欧洲"], brief: {
          topic: "欧洲储能进入研究", goal: "判断市场机会", timeRange: "2025", region: "欧洲", focus: "储能",
        }, stage: "directions", resumeStage: "directions", status: "active", progress: 20, sourceCount: 3, reportId: null,
        createdAt: "2026-08-10T09:00:00.000Z", updatedAt: "2026-08-12T08:00:00.000Z",
      }],
    });
    render(<GuidedResearchFlow step="home" onStepChange={vi.fn()} />);

    const page = screen.getByTestId("research-home-page");
    expect(page).toHaveClass("max-w-screen-2xl", "px-5", "py-6");
    expect(await screen.findByTestId("research-history-grs-style")).toHaveClass("min-h-64", "hover:-translate-y-0.5");
  });

  it("keeps an active report-stage session resumable until its persisted status is completed", async () => {
    listGuidedResearchSessions.mockResolvedValueOnce({
      items: [{
        sessionId: "grs-report-active", title: "仍待完成的报告", brief: {
          topic: "仍待完成的报告", goal: "确认结论", timeRange: "2025", region: "欧洲", focus: "政策",
        }, stage: "report", resumeStage: "report", status: "active", progress: 95, sourceCount: 12, reportId: null,
        createdAt: "2026-08-10T09:00:00.000Z", updatedAt: "2026-08-12T08:00:00.000Z",
      }],
    });
    const onStepChange = vi.fn();
    render(<GuidedResearchFlow step="home" onStepChange={onStepChange} />);

    await screen.findByTestId("research-history-grs-report-active");
    expect(screen.getByText("待继续")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("research-continue-grs-report-active"));
    expect(onStepChange).toHaveBeenCalledWith("report", "grs-report-active");
  });

  it("creates a persisted session before entering directions", async () => {
    createGuidedResearchSession.mockResolvedValueOnce(createdSession("grs-new"));
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

  it("confirms the initial brief once and keeps the next step loading until the model response", async () => {
    createGuidedResearchSession.mockResolvedValueOnce(createdSession("grs-entry"));
    let resolve!: (value: ReturnType<typeof runtimeFixture>) => void;
    executeResearchRuntime.mockReturnValue(new Promise((done) => { resolve = done; }));
    const navigate = vi.fn();
    render(<GuidedResearchFlow step="brief" onStepChange={navigate} />);
    fireEvent.change(screen.getByTestId("research-brief-goal"), { target: { value: "核对具体政策" } });
    fireEvent.click(screen.getByTestId("research-confirm-brief"));
    expect(screen.getByTestId("research-step-loading")).toHaveTextContent("正在生成研究方向");
    expect(screen.getByRole("button", { name: "2. 研究方向" })).toHaveAttribute("aria-current", "step");
    await waitFor(() => expect(executeResearchRuntime).toHaveBeenCalledTimes(1));
    expect(executeResearchRuntime).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: "grs-entry", node: "brief", action: "confirm", expectedVersion: 0,
      draft: { node: "brief", value: expect.objectContaining({ goal: "核对具体政策" }) },
    }));
    expect(navigate).not.toHaveBeenCalled();
    resolve(runtimeFixture("directions", "grs-entry"));
    await waitFor(() => expect(navigate).toHaveBeenCalledWith("directions", "grs-entry"));
  });

  it("opens the progressed session from an idempotent create replay without another confirmation", async () => {
    createGuidedResearchSession.mockResolvedValueOnce(createdSession("grs-existing"));
    getResearchRuntime.mockResolvedValueOnce(runtimeFixture("research", "grs-existing"));
    const navigate = vi.fn();
    render(<GuidedResearchFlow step="brief" onStepChange={navigate} />);
    fireEvent.click(screen.getByTestId("research-confirm-brief"));
    await waitFor(() => expect(navigate).toHaveBeenCalledWith("search", "grs-existing"));
    expect(executeResearchRuntime).not.toHaveBeenCalled();
  });

  it("recovers a lost model response by reading the created session without replay", async () => {
    createGuidedResearchSession.mockResolvedValueOnce(createdSession("grs-lost"));
    getResearchRuntime.mockResolvedValueOnce({ ...runtimeFixture("brief", "grs-lost"), version: 0 })
      .mockResolvedValueOnce({ ...runtimeFixture("directions", "grs-lost"), errorCode: "RESEARCH_MODEL_UNAVAILABLE" });
    executeResearchRuntime.mockRejectedValueOnce(new Error("response lost"));
    const navigate = vi.fn();
    render(<GuidedResearchFlow step="brief" onStepChange={navigate} />);
    fireEvent.click(screen.getByTestId("research-confirm-brief"));
    await waitFor(() => expect(navigate).toHaveBeenCalledWith("directions", "grs-lost"));
    expect(createGuidedResearchSession).toHaveBeenCalledTimes(1);
    expect(executeResearchRuntime).toHaveBeenCalledTimes(1);
    expect(getResearchRuntime).toHaveBeenCalledTimes(2);
  });

  it("keeps the created session reachable if both runtime reads fail", async () => {
    createGuidedResearchSession.mockResolvedValueOnce(createdSession("grs-offline"));
    getResearchRuntime.mockRejectedValue(new Error("offline"));
    const navigate = vi.fn();
    render(<GuidedResearchFlow step="brief" onStepChange={navigate} />);
    fireEvent.click(screen.getByTestId("research-confirm-brief"));
    await waitFor(() => expect(navigate).toHaveBeenCalledWith("brief", "grs-offline"));
    expect(createGuidedResearchSession).toHaveBeenCalledTimes(1);
    expect(executeResearchRuntime).not.toHaveBeenCalled();
  });

  it.each(["create", "confirm"] as const)("ignores a delayed %s after leaving the entry screen", async (phase) => {
    let resolve!: (value: unknown) => void;
    const pending = new Promise((done) => { resolve = done; });
    if (phase === "create") createGuidedResearchSession.mockReturnValueOnce(pending);
    else {
      createGuidedResearchSession.mockResolvedValueOnce(createdSession("grs-abandoned"));
      executeResearchRuntime.mockReturnValueOnce(pending);
    }
    render(<GuidedResearchFlow step="brief" />);
    fireEvent.click(screen.getByTestId("research-confirm-brief"));
    if (phase === "confirm") await waitFor(() => expect(executeResearchRuntime).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByTestId("research-flow-back"));
    expect(await screen.findByTestId("research-flow-home")).toBeInTheDocument();
    await act(async () => { resolve(phase === "create" ? createdSession("grs-abandoned") : runtimeFixture("directions", "grs-abandoned")); });
    await waitFor(() => expect(screen.getByTestId("research-flow-home")).toBeInTheDocument());
    expect(executeResearchRuntime).toHaveBeenCalledTimes(phase === "create" ? 0 : 1);
    expect(Object.keys(window.localStorage).some((key) => key.startsWith("wsx.guidedResearch.createIdempotencyKey."))).toBe(true);
  });

  it("uses the session URL to restore the server-authored stage", async () => {
    getGuidedResearchSession.mockResolvedValueOnce({
      sessionId: "grs-recover", title: "恢复中的研究", brief: {
        topic: "恢复中的研究", goal: "继续检索", timeRange: "2026", region: "欧洲", focus: "政策",
      }, stage: "researching", resumeStage: "researching", status: "active", progress: 68, sourceCount: 27,
      reportId: null, createdAt: "2026-08-10T09:00:00.000Z", updatedAt: "2026-08-12T09:00:00.000Z",
    });

    getResearchRuntime.mockResolvedValueOnce(runtimeFixture("research", "grs-recover"));
    render(<GuidedResearchFlow step="search" sessionId="grs-recover" />);

    await waitFor(() => expect(getResearchRuntime).toHaveBeenCalledWith("grs-recover"));
    expect(await screen.findByTestId("research-flow-search")).toBeInTheDocument();
  });

  it("reuses the create idempotency key after remount and clears it only after success", async () => {
    createGuidedResearchSession
      .mockRejectedValueOnce(new Error("response lost"))
      .mockResolvedValueOnce(createdSession("grs-replayed"));
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
      .mockResolvedValueOnce(createdSession("grs-other"));
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

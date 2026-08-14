import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { GuidedResearchFlow } from "@/components/research-studio/guided-research-flow";
import { GUIDED_RESEARCH_BRIEF, GUIDED_RESEARCH_HISTORY } from "@/lib/mock/guided-research";

const {
  listGuidedResearchSessions, createGuidedResearchSession, getGuidedResearchSession,
  generateResearchDirections, confirmResearchDirections, generateResearchOutline, confirmResearchOutline,
  finishGuidedResearchCollection, completeGuidedResearchSession,
} = vi.hoisted(() => ({
  listGuidedResearchSessions: vi.fn(),
  createGuidedResearchSession: vi.fn(),
  getGuidedResearchSession: vi.fn(),
  generateResearchDirections: vi.fn(),
  confirmResearchDirections: vi.fn(),
  generateResearchOutline: vi.fn(),
  confirmResearchOutline: vi.fn(),
  finishGuidedResearchCollection: vi.fn(),
  completeGuidedResearchSession: vi.fn(),
}));

vi.mock("@/lib/guided-research-api", () => ({
  listGuidedResearchSessions,
  createGuidedResearchSession,
  getGuidedResearchSession,
  generateResearchDirections,
  confirmResearchDirections,
  generateResearchOutline,
  confirmResearchOutline,
  finishGuidedResearchCollection,
  completeGuidedResearchSession,
}));

const checkpointSession = {
  sessionId: "grs-edit", title: GUIDED_RESEARCH_BRIEF.topic, brief: GUIDED_RESEARCH_BRIEF,
  briefVersion: 1, briefConfirmedAt: "2026-08-13T00:00:00.000Z",
  directions: { candidateVersion: 1, confirmedVersion: null, versions: [{
    version: 1, createdAt: "2026-08-13T00:01:00.000Z", confirmedAt: null,
    items: [{ id: "d1", title: "市场规模", description: "测算市场规模", enabled: true, order: 0 }],
  }] },
  outline: { candidateVersion: null, confirmedVersion: null, versions: [] },
  stage: "directions", resumeStage: "directions", status: "active", progress: 20,
  sourceCount: 0, reportId: null, createdAt: "2026-08-13T00:00:00.000Z", updatedAt: "2026-08-13T00:00:00.000Z",
} as const;

function sessionAt(resumeStage: "directions" | "outline" | "researching" | "report") {
  return {
    ...checkpointSession,
    stage: resumeStage === "researching" ? "researching" : resumeStage,
    resumeStage,
    directions: {
      candidateVersion: 1,
      confirmedVersion: null,
      versions: [{
        version: 1, createdAt: "2026-08-13T00:01:00.000Z", confirmedAt: null,
        items: [{ id: "d1", title: "候选方向", description: "候选描述", enabled: true, order: 0 }],
      }],
    },
    outline: resumeStage === "outline" ? {
      candidateVersion: 1,
      confirmedVersion: null,
      versions: [{
        version: 1, createdAt: "2026-08-13T00:02:00.000Z", confirmedAt: null,
        items: [{ id: "o1", title: "候选章节", questions: ["候选问题"], enabled: true, order: 0 }],
      }],
    } : checkpointSession.outline,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  listGuidedResearchSessions.mockReset();
  createGuidedResearchSession.mockReset();
  getGuidedResearchSession.mockReset();
  generateResearchDirections.mockReset();
  confirmResearchDirections.mockReset();
  generateResearchOutline.mockReset();
  confirmResearchOutline.mockReset();
  finishGuidedResearchCollection.mockReset();
  completeGuidedResearchSession.mockReset();
  window.localStorage.clear();
  listGuidedResearchSessions.mockResolvedValue({
    items: GUIDED_RESEARCH_HISTORY.map((item) => ({
      sessionId: item.id,
      title: item.title,
      brief: { ...GUIDED_RESEARCH_BRIEF, topic: item.title, goal: item.description },
      stage: item.status === "completed" ? "report" : item.resumeAt === "search" ? "researching" : item.resumeAt,
      resumeStage: item.status === "completed" ? "report" : item.resumeAt === "search" ? "researching" : item.resumeAt,
      status: item.status === "completed" ? "completed" : "active",
      progress: item.progress,
      sourceCount: item.sources,
      reportId: item.status === "completed" ? `report-${item.id}` : null,
      createdAt: "2026-08-10T09:00:00.000Z",
      updatedAt: "2026-08-12T09:00:00.000Z",
    })),
  });
  createGuidedResearchSession.mockResolvedValue({ sessionId: "grs-new", stage: "directions" });
  finishGuidedResearchCollection.mockResolvedValue({ ...sessionAt("report"), sessionId: "grs-1" });
  completeGuidedResearchSession.mockResolvedValue({ ...sessionAt("report"), sessionId: "grs-1", status: "completed" });
});

describe("Issue #1073 · guided deep research UI-first flow", () => {
  it("home distinguishes resumable and completed research", async () => {
    const onStepChange = vi.fn();
    render(<GuidedResearchFlow step="home" onStepChange={onStepChange} />);

    expect(screen.getByTestId("research-history")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId("research-continue-r-energy")).toBeInTheDocument());
    expect(screen.getByTestId("research-history-r-grid")).toHaveTextContent("已完成");
    expect(screen.getByTestId("research-view-r-grid")).toHaveTextContent("查看报告");
    fireEvent.click(screen.getByTestId("research-continue-r-energy"));
    expect(onStepChange).toHaveBeenCalledWith("search", "r-energy");

    fireEvent.click(screen.getByTestId("research-view-r-grid"));
    expect(onStepChange).toHaveBeenCalledWith("report", "r-grid");
  });

  it("topic confirmation keeps the user's brief editable", async () => {
    const onStepChange = vi.fn();
    window.localStorage.setItem("wsx.guidedResearch.skill.v1.pending-brief", JSON.stringify({
      version: 1, messages: [], pendingSuggestion: null,
      undoSnapshot: { step: "brief", value: GUIDED_RESEARCH_BRIEF },
    }));
    render(<GuidedResearchFlow step="brief" onStepChange={onStepChange} />);

    const topic = screen.getByTestId("research-brief-topic") as HTMLInputElement;
    fireEvent.change(topic, { target: { value: "欧洲储能市场进入策略" } });
    expect(topic.value).toBe("欧洲储能市场进入策略");
    fireEvent.click(screen.getByTestId("research-confirm-brief"));
    await waitFor(() => expect(onStepChange).toHaveBeenCalledWith("directions", "grs-new"));
    expect(window.localStorage.getItem("wsx.guidedResearch.skill.v1.pending-brief")).toBeNull();
  });

  it("AI directions and outline remain editable before search", async () => {
    const outlinedSession = {
      ...checkpointSession, stage: "outline", resumeStage: "outline",
      outline: { candidateVersion: 1, confirmedVersion: null, versions: [{
        version: 1, createdAt: "2026-08-13T00:02:00.000Z", confirmedAt: null,
        items: [{ id: "o1", title: "执行摘要", questions: ["关键判断是什么？"], enabled: true, order: 0 }],
      }] },
    };
    getGuidedResearchSession
      .mockResolvedValueOnce(checkpointSession)
      .mockResolvedValueOnce(outlinedSession);
    generateResearchOutline.mockResolvedValue(outlinedSession);
    const { rerender } = render(<GuidedResearchFlow step="directions" sessionId="grs-edit" />);
    const direction = await screen.findByTestId("research-direction-title-d1") as HTMLInputElement;
    fireEvent.change(direction, { target: { value: "市场规模与增长质量" } });
    expect(direction.value).toBe("市场规模与增长质量");
    fireEvent.click(screen.getByTestId("research-add-direction"));
    expect(screen.getByTestId("research-direction-title-d2")).toBeInTheDocument();

    rerender(<GuidedResearchFlow step="outline" sessionId="grs-edit" />);
    const outline = await screen.findByTestId("research-outline-title-o1") as HTMLInputElement;
    fireEvent.change(outline, { target: { value: "执行摘要与关键判断" } });
    expect(outline.value).toBe("执行摘要与关键判断");
    expect(screen.getByTestId("research-start-search")).toBeEnabled();
  });

  it("clamps a requested future checkpoint to the session maximum", async () => {
    getGuidedResearchSession.mockResolvedValue(sessionAt("outline"));
    render(<GuidedResearchFlow step="report" sessionId="grs-edit" />);

    expect(await screen.findByTestId("research-flow-outline")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /研究报告/ })).toBeDisabled();
  });

  it("waits for server-stage restoration before exposing a requested future checkpoint", async () => {
    const pendingSession = deferred<ReturnType<typeof sessionAt>>();
    getGuidedResearchSession.mockReturnValueOnce(pendingSession.promise);
    render(<GuidedResearchFlow step="report" sessionId="grs-edit" />);

    expect(screen.getByTestId("research-session-restore-loading")).toBeInTheDocument();
    expect(screen.queryByTestId("research-report")).not.toBeInTheDocument();
    expect(screen.queryByTestId("research-flow-progress")).not.toBeInTheDocument();

    pendingSession.resolve(sessionAt("outline"));
    expect(await screen.findByTestId("research-flow-outline")).toBeInTheDocument();
    expect(screen.queryByTestId("research-report")).not.toBeInTheDocument();
  });

  it("does not retain a requested future checkpoint when restoration fails", async () => {
    getGuidedResearchSession.mockRejectedValueOnce(new Error("session unavailable"));
    render(<GuidedResearchFlow step="report" sessionId="grs-edit" />);

    expect(await screen.findByTestId("research-session-restore-error")).toBeInTheDocument();
    expect(screen.queryByTestId("research-report")).not.toBeInTheDocument();
    expect(screen.queryByTestId("research-search-summary")).not.toBeInTheDocument();
    expect(screen.queryByTestId("research-flow-progress")).not.toBeInTheDocument();
  });

  it("hides an earlier session while a replacement session restores or fails", async () => {
    const replacement = deferred<ReturnType<typeof sessionAt>>();
    getGuidedResearchSession
      .mockResolvedValueOnce({ ...sessionAt("directions"), sessionId: "grs-a" })
      .mockReturnValueOnce(replacement.promise);
    const { rerender } = render(<GuidedResearchFlow step="directions" sessionId="grs-a" />);

    await screen.findByTestId("research-direction-title-d1");
    rerender(<GuidedResearchFlow step="report" sessionId="grs-b" />);

    expect(screen.getByTestId("research-session-restore-loading")).toBeInTheDocument();
    expect(screen.queryByTestId("research-flow-directions")).not.toBeInTheDocument();
    expect(screen.queryByTestId("research-report")).not.toBeInTheDocument();
    expect(screen.queryByTestId("research-flow-progress")).not.toBeInTheDocument();

    replacement.reject(new Error("replacement unavailable"));
    expect(await screen.findByTestId("research-session-restore-error")).toBeInTheDocument();
    expect(screen.queryByTestId("research-flow-directions")).not.toBeInTheDocument();
    expect(screen.queryByTestId("research-report")).not.toBeInTheDocument();
    expect(screen.queryByTestId("research-flow-progress")).not.toBeInTheDocument();
  });

  it("clamps an earlier requested checkpoint to the persisted current stage", async () => {
    getGuidedResearchSession.mockResolvedValue(sessionAt("outline"));
    render(<GuidedResearchFlow step="directions" sessionId="grs-edit" />);

    await waitFor(() => expect(getGuidedResearchSession).toHaveBeenCalledWith("grs-edit"));
    expect(screen.getByTestId("research-flow-outline")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "研究方向" })).toBeDisabled();
    expect(screen.queryByTestId("research-flow-directions")).not.toBeInTheDocument();
  });

  it.each(["directions", "outline", "search", "report"] as const)(
    "does not render the %s fixture without a restored session",
    (step) => {
      render(<GuidedResearchFlow step={step} />);

      expect(screen.getByTestId("research-flow-home")).toBeInTheDocument();
      expect(screen.queryByTestId("research-report")).not.toBeInTheDocument();
      expect(screen.queryByTestId("research-search-summary")).not.toBeInTheDocument();
    },
  );

  it("applies a direction Skill suggestion to the live editor", async () => {
    getGuidedResearchSession.mockResolvedValue(sessionAt("directions"));
    render(<GuidedResearchFlow step="directions" sessionId="grs-edit" />);

    await screen.findByTestId("research-direction-title-d1");
    fireEvent.click(screen.getByRole("button", { name: "补充研究方向" }));
    fireEvent.click(screen.getByRole("button", { name: "应用建议" }));
    expect(screen.getAllByTestId(/^research-direction-title-/)).toHaveLength(2);
  });

  it("completes the persisted demo search and report journey", async () => {
    const onStepChange = vi.fn();
    getGuidedResearchSession
      .mockResolvedValueOnce({ ...sessionAt("researching"), sessionId: "grs-1" })
      .mockResolvedValueOnce({ ...sessionAt("report"), sessionId: "grs-1" });
    const { rerender } = render(<GuidedResearchFlow step="search" sessionId="grs-1" onStepChange={onStepChange} />);

    await screen.findByTestId("research-search-summary");
    for (const task of screen.getAllByRole("button", { name: /完成演示检索/ })) fireEvent.click(task);
    fireEvent.click(within(screen.getByTestId("research-source-s1")).getByRole("button", { name: "保留" }));
    fireEvent.click(within(screen.getByTestId("research-source-s2")).getByRole("button", { name: "排除" }));
    fireEvent.click(within(screen.getByTestId("research-source-s3")).getByRole("button", { name: "排除" }));
    expect(screen.getByRole("button", { name: "生成演示研究报告" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "生成演示研究报告" }));

    await waitFor(() => expect(finishGuidedResearchCollection).toHaveBeenCalledWith("grs-1", {
      sourceCount: 1,
    }));
    expect(onStepChange).toHaveBeenCalledWith("report", "grs-1");

    rerender(<GuidedResearchFlow step="report" sessionId="grs-1" onStepChange={onStepChange} />);
    await screen.findByTestId("research-report");
    expect(screen.getByTestId("research-citation-s1")).toBeInTheDocument();
    expect(screen.queryByTestId("research-citation-s2")).not.toBeInTheDocument();
    expect(screen.queryByTestId("research-citation-s3")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "完成研究" }));

    await waitFor(() => expect(completeGuidedResearchSession).toHaveBeenCalledWith("grs-1"));
    expect(await screen.findByRole("heading", { name: "研究已完成" })).toBeInTheDocument();
  });

  it("retains search on lifecycle failure and offers retry without navigation", async () => {
    const onStepChange = vi.fn();
    getGuidedResearchSession.mockResolvedValue({ ...sessionAt("researching"), sessionId: "grs-1" });
    finishGuidedResearchCollection.mockRejectedValue(new Error("offline"));
    render(<GuidedResearchFlow step="search" sessionId="grs-1" onStepChange={onStepChange} />);

    await screen.findByTestId("research-search-summary");
    for (const task of screen.getAllByRole("button", { name: /完成演示检索/ })) fireEvent.click(task);
    fireEvent.click(screen.getByRole("button", { name: "生成演示研究报告" }));

    expect(await screen.findByText("生成演示研究报告失败，请重试。")) .toBeInTheDocument();
    expect(screen.getByTestId("research-flow-search")).toBeInTheDocument();
    expect(onStepChange).not.toHaveBeenCalled();
  });

  it("retains report on completion failure and offers retry without navigation", async () => {
    const onStepChange = vi.fn();
    getGuidedResearchSession.mockResolvedValue({ ...sessionAt("report"), sessionId: "grs-1" });
    completeGuidedResearchSession.mockRejectedValue(new Error("offline"));
    render(<GuidedResearchFlow step="report" sessionId="grs-1" onStepChange={onStepChange} />);

    await screen.findByTestId("research-report");
    fireEvent.click(screen.getByRole("button", { name: "完成研究" }));

    expect(await screen.findByText("完成研究失败，请重试。")) .toBeInTheDocument();
    expect(screen.getByTestId("research-report")).toBeInTheDocument();
    expect(onStepChange).not.toHaveBeenCalled();
  });

  it("leaves a persisted report for the sessionless research home", async () => {
    const onStepChange = vi.fn();
    getGuidedResearchSession.mockResolvedValue({ ...sessionAt("report"), sessionId: "grs-1" });
    render(<GuidedResearchFlow step="report" sessionId="grs-1" onStepChange={onStepChange} />);

    await screen.findByTestId("research-report");
    fireEvent.click(screen.getByRole("button", { name: "返回研究首页" }));

    expect(onStepChange).toHaveBeenCalledWith("home", undefined);
  });

  it("shows zero report citations when every source was excluded", async () => {
    window.localStorage.setItem("wsx.guidedResearch.demo.v1.grs-1", JSON.stringify({
      version: 1,
      sessionId: "grs-1",
      completedTaskIds: ["t1", "t2", "t3", "t4"],
      sourceDecisions: { s1: "excluded", s2: "excluded", s3: "excluded" },
      reportSummary: "",
    }));
    getGuidedResearchSession.mockResolvedValue({ ...sessionAt("report"), sessionId: "grs-1", sourceCount: 0 });

    render(<GuidedResearchFlow step="report" sessionId="grs-1" />);

    await screen.findByTestId("research-report");
    expect(screen.getByText("0 个已记录来源")).toBeInTheDocument();
    expect(screen.queryAllByTestId(/^research-citation-/)).toHaveLength(0);
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { GuidedResearchFlow } from "@/components/research-studio/guided-research-flow";
import { GUIDED_RESEARCH_BRIEF, GUIDED_RESEARCH_HISTORY } from "@/lib/mock/guided-research";

const {
  listGuidedResearchSessions, createGuidedResearchSession, getGuidedResearchSession,
  generateResearchDirections, confirmResearchDirections, generateResearchOutline, confirmResearchOutline,
} = vi.hoisted(() => ({
  listGuidedResearchSessions: vi.fn(),
  createGuidedResearchSession: vi.fn(),
  getGuidedResearchSession: vi.fn(),
  generateResearchDirections: vi.fn(),
  confirmResearchDirections: vi.fn(),
  generateResearchOutline: vi.fn(),
  confirmResearchOutline: vi.fn(),
}));

vi.mock("@/lib/guided-research-api", () => ({
  listGuidedResearchSessions,
  createGuidedResearchSession,
  getGuidedResearchSession,
  generateResearchDirections,
  confirmResearchDirections,
  generateResearchOutline,
  confirmResearchOutline,
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

beforeEach(() => {
  listGuidedResearchSessions.mockReset();
  createGuidedResearchSession.mockReset();
  getGuidedResearchSession.mockReset();
  generateResearchDirections.mockReset();
  confirmResearchDirections.mockReset();
  generateResearchOutline.mockReset();
  confirmResearchOutline.mockReset();
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
});

describe("Issue #1073 · guided deep research UI-first flow", () => {
  it("home distinguishes resumable and completed research", async () => {
    const onStepChange = vi.fn();
    render(<GuidedResearchFlow step="home" onStepChange={onStepChange} />);

    expect(screen.getByTestId("research-history")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId("research-continue-r-energy")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("research-continue-r-energy"));
    expect(onStepChange).toHaveBeenCalledWith("search", "r-energy");

    fireEvent.click(screen.getByTestId("research-view-r-grid"));
    expect(onStepChange).toHaveBeenCalledWith("report", "r-grid");
  });

  it("topic confirmation keeps the user's brief editable", async () => {
    const onStepChange = vi.fn();
    render(<GuidedResearchFlow step="brief" onStepChange={onStepChange} />);

    const topic = screen.getByTestId("research-brief-topic") as HTMLInputElement;
    fireEvent.change(topic, { target: { value: "欧洲储能市场进入策略" } });
    expect(topic.value).toBe("欧洲储能市场进入策略");
    fireEvent.click(screen.getByTestId("research-confirm-brief"));
    await waitFor(() => expect(onStepChange).toHaveBeenCalledWith("directions", "grs-new"));
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

  it("keeps an earlier requested checkpoint available after loading a later session", async () => {
    getGuidedResearchSession.mockResolvedValue(sessionAt("outline"));
    render(<GuidedResearchFlow step="directions" sessionId="grs-edit" />);

    await waitFor(() => expect(getGuidedResearchSession).toHaveBeenCalledWith("grs-edit"));
    expect(screen.getByTestId("research-flow-directions")).toBeInTheDocument();
  });

  it("applies a direction Skill suggestion to the live editor", async () => {
    getGuidedResearchSession.mockResolvedValue(sessionAt("directions"));
    render(<GuidedResearchFlow step="directions" sessionId="grs-edit" />);

    await screen.findByTestId("research-direction-title-d1");
    fireEvent.click(screen.getByRole("button", { name: "补充研究方向" }));
    fireEvent.click(screen.getByRole("button", { name: "应用建议" }));
    expect(screen.getAllByTestId(/^research-direction-title-/)).toHaveLength(2);
  });

  it("search and report expose evidence-bearing states", () => {
    const { rerender } = render(<GuidedResearchFlow step="search" />);
    expect(screen.getByTestId("research-search-progress")).toHaveAttribute("data-progress", "68");
    expect(screen.getByTestId("research-current-query")).toHaveTextContent("Germany utility-scale battery storage market 2025");
    expect(screen.getAllByTestId(/^research-source-/)).toHaveLength(3);

    rerender(<GuidedResearchFlow step="report" />);
    expect(screen.getByTestId("research-report")).toHaveTextContent("欧洲储能市场进入策略研究报告");
    expect(screen.getAllByTestId(/^research-citation-/).length).toBeGreaterThanOrEqual(3);
  });
});

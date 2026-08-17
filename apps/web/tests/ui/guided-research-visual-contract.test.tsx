import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { ResearchStudioApp } from "@/components/research-studio/research-studio-app";
import { GuidedResearchFlow } from "@/components/research-studio/guided-research-flow";
import { mockIdentity } from "@/lib/identity";
import ResearchPage from "@/app/research/page";
import type { ReactElement } from "react";
import { GUIDED_RESEARCH_BRIEF, type GuidedResearchStep } from "@/lib/mock/guided-research";

const api = vi.hoisted(() => ({
  listGuidedResearchSessions: vi.fn(), createGuidedResearchSession: vi.fn(), getGuidedResearchSession: vi.fn(),
  getGuidedResearchWorkflow: vi.fn(), executeGuidedResearchNodeCommand: vi.fn(),
  confirmResearchBrief: vi.fn(),
  generateResearchDirections: vi.fn(), confirmResearchDirections: vi.fn(), generateResearchOutline: vi.fn(), confirmResearchOutline: vi.fn(),
  finishGuidedResearchCollection: vi.fn(), completeGuidedResearchSession: vi.fn(),
}));

vi.mock("@/lib/guided-research-api", () => api);
vi.mock("next/navigation", () => ({ usePathname: () => "/research", useRouter: () => ({ replace: vi.fn() }) }));

const identity = mockIdentity("org-yuanyang", null);

function sessionAt(step: Exclude<GuidedResearchStep, "home" | "brief">) {
  const resumeStage = step === "search" ? "researching" : step;
  const direction = { id: "d1", title: "市场规模", description: "测算市场规模", enabled: true, order: 0 };
  const outline = { id: "o1", title: "执行摘要", questions: ["关键判断是什么？"], enabled: true, order: 0 };
  return {
    sessionId: "grs-visual", title: GUIDED_RESEARCH_BRIEF.topic, tags: [], brief: GUIDED_RESEARCH_BRIEF,
    briefVersion: 1, briefConfirmedAt: "2026-08-13T00:00:00.000Z",
    directions: {
      candidateVersion: 1, confirmedVersion: step === "directions" ? null : 1,
      versions: [{ version: 1, items: [direction], createdAt: "2026-08-13T00:01:00.000Z", confirmedAt: step === "directions" ? null : "2026-08-13T00:02:00.000Z" }],
    },
    outline: step === "directions" ? { candidateVersion: null, confirmedVersion: null, versions: [] } : {
      candidateVersion: 1, confirmedVersion: step === "outline" ? null : 1,
      versions: [{ version: 1, items: [outline], createdAt: "2026-08-13T00:03:00.000Z", confirmedAt: step === "outline" ? null : "2026-08-13T00:04:00.000Z" }],
    },
    stage: resumeStage, resumeStage, status: "active", progress: step === "report" ? 90 : 60,
    sourceCount: 0, reportId: step === "report" ? "report-visual" : null,
    createdAt: "2026-08-13T00:00:00.000Z", updatedAt: "2026-08-13T00:04:00.000Z",
  };
}

const visualSources = [
  {
    id: "s1",
    domain: "ec.europa.eu",
    title: "Energy storage recommendations and market design",
    url: "https://ec.europa.eu/energy-storage",
    kind: "官方政策",
    confidence: "高",
    summary: "欧盟政策来源。",
  },
] as const;

function workflowAt(node: "research" | "report") {
  const meta = {
    status: "ready",
    version: 1,
    confirmedVersion: null,
    contentVersionId: null,
    modelId: "qwen3.7-plus",
    modelInvocationId: "model-call-visual",
    modelOutputSchemaVersion: node === "research" ? "guided-research-collection:v1" : "guided-research-report:v1",
    confirmedAt: null,
    updatedAt: "2026-08-13T00:00:00.000Z",
    errorCode: null,
  };
  return {
    sessionId: "grs-visual",
    graphVersion: 8,
    revision: 1,
    currentNode: node,
    availableNodes: ["brief", "directions", "outline", "research", "report"],
    nodeSummaries: { brief: meta, directions: meta, outline: meta, research: meta, report: meta },
    activeNodeState: node === "research" ? {
      currentQuery: "Germany utility-scale battery storage market 2025",
      tasks: [{ id: "t1", sectionId: "o1", label: "市场规模与商业模式", query: "Germany storage market", status: "completed", sourceIds: ["s1"] }],
      sources: visualSources,
      acceptedSourceIds: ["s1"],
      excludedSourceIds: [],
    } : {
      title: "欧洲储能市场进入策略研究报告",
      revisionInstruction: "",
      summary: "模型生成摘要。",
      sections: [{ id: "r1", title: "市场规模与增长动能", body: "模型生成正文。", citationSourceIds: ["s1"], order: 0 }],
      citations: visualSources,
    },
    nodeStateVersions: { [node]: 1 },
    skill: { threadId: "skill-grs-visual", activeNode: node, summaryId: null, recentMessageIds: [], activeProposalId: null, proposalStatus: "none" },
    interrupt: { node, allowedActions: ["confirm", "generate", "complete"] },
  };
}

beforeEach(() => {
  Object.values(api).forEach((mock) => mock.mockReset());
  api.listGuidedResearchSessions.mockResolvedValue({ items: [] });
  api.getGuidedResearchWorkflow.mockImplementation((sessionId: string) => {
    if (sessionId === "grs-visual") return Promise.resolve(workflowAt("research"));
    return Promise.resolve(null);
  });
});

describe("F180 signed guided-research visual contract", () => {
  it("uses the real session shell for guided research while legacy Studio keeps preview identity", () => {
    const guided = ResearchPage({ searchParams: {} }) as ReactElement<{ identity?: unknown; flow?: string }>;
    expect(guided.props.flow).toBe("home");
    expect(guided.props.identity).toBeUndefined();

    const legacy = ResearchPage({ searchParams: { screen: "list" } }) as ReactElement<{ identity?: unknown; flow?: string }>;
    expect(legacy.props.flow).toBeUndefined();
    expect(legacy.props.identity).toBeDefined();
  });

  it("removes the secondary menu from guided research while retaining it for legacy Studio", async () => {
    render(
      <ResearchStudioApp
        identity={identity}
        uiState="default"
        screen="list"
        view="owner"
        flow="home"
        qs={{}}
      />,
    );

    expect(screen.queryByTestId("shell-left-panel")).not.toBeInTheDocument();
    for (const label of ["研究 Studio 列表", "研究计划详情", "新建深度研究", "研究主题详情", "现场深度研究"]) {
      expect(screen.queryByText(label)).not.toBeInTheDocument();
    }
    await waitFor(() => expect(screen.getByTestId("research-history-empty")).toBeInTheDocument());

    render(
      <ResearchStudioApp
        identity={identity}
        uiState="default"
        screen="list"
        view="owner"
        qs={{}}
      />,
    );
    expect(screen.getAllByTestId("shell-left-panel")).toHaveLength(1);
    expect(screen.getByTestId("rs-nav-list")).toHaveAttribute("data-active", "true");
  });

  it("renders the signed progress strip and desktop flow shell", async () => {
    api.getGuidedResearchSession.mockResolvedValue(sessionAt("search"));
    render(<GuidedResearchFlow step="search" sessionId="grs-visual" />);

    const progress = await screen.findByTestId("research-flow-progress");
    expect(progress).toHaveClass("rounded-lg", "border");
    const flow = screen.getByTestId("research-flow-search");
    expect(flow).toHaveAttribute("data-layout", "signed-desktop");
    expect(flow).toHaveClass("max-w-none");
    expect(flow).not.toHaveClass("max-w-6xl");

    const progressShell = screen.getByTestId("research-progress-shell");
    expect(progressShell).toHaveAttribute("data-layout", "right-aligned-progress");
    expect(progressShell).toHaveClass("lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]");
    expect(progressShell.lastElementChild).toBe(progress);
  });

  it("keeps a one-third contextual Skill workspace with one main editor on guided steps", async () => {
    for (const step of ["brief", "directions", "outline", "search"] as const) {
      if (step !== "brief") api.getGuidedResearchSession.mockResolvedValueOnce(sessionAt(step));
      const view = render(
        <ResearchStudioApp
          identity={identity}
          uiState="default"
          screen="list"
          view="owner"
          flow={step}
          guidedSessionId={step === "brief" ? undefined : "grs-visual"}
          qs={{}}
        />,
      );
      const assistant = await screen.findByTestId("research-skill-assistant");
      const workspace = assistant.closest("[data-layout]");

      expect(workspace).toHaveAttribute("data-layout", "skill-workspace-thirds");
      expect(workspace).toHaveClass("lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]");
      expect(screen.getByTestId("research-step-main")).toBeInTheDocument();
      expect(screen.queryByTestId("shell-left-panel")).not.toBeInTheDocument();
      for (const label of ["研究 Studio 列表", "研究计划详情", "新建深度研究", "研究主题详情", "现场深度研究"]) {
        expect(screen.queryByText(label)).not.toBeInTheDocument();
      }
      view.unmount();
    }
  });

  it("keeps the research Skill assistant beside the final report", async () => {
    api.getGuidedResearchSession.mockResolvedValueOnce(sessionAt("report"));
    render(<GuidedResearchFlow step="report" sessionId="grs-visual" />);

    await screen.findByTestId("research-flow-report");
    const assistant = screen.getByTestId("research-skill-assistant");
    expect(assistant.closest("[data-layout]")).toHaveAttribute("data-layout", "skill-workspace-thirds");
    expect(screen.getByTestId("research-report")).toBeInTheDocument();
  });

  it("keeps future checkpoints disabled and removes demo-only output labels", async () => {
    api.getGuidedResearchSession.mockResolvedValueOnce(sessionAt("directions"));
    const directions = render(<GuidedResearchFlow step="directions" sessionId="grs-visual" />);
    await screen.findByTestId("research-flow-directions");
    for (const futureStep of ["报告大纲", "资料研究", "研究报告"]) {
      expect(screen.getByRole("button", { name: futureStep })).toBeDisabled();
    }
    directions.unmount();

    api.getGuidedResearchSession.mockResolvedValueOnce(sessionAt("search"));
    api.getGuidedResearchWorkflow.mockResolvedValueOnce(workflowAt("research"));
    const search = render(<GuidedResearchFlow step="search" sessionId="grs-visual" />);
    await screen.findByTestId("research-flow-search");
    expect(search.container).not.toHaveTextContent("演示检索结果");
    expect(search.container).toHaveTextContent("来源");
    search.unmount();

    api.getGuidedResearchSession.mockResolvedValueOnce(sessionAt("report"));
    api.getGuidedResearchWorkflow.mockResolvedValueOnce(workflowAt("report"));
    const report = render(<GuidedResearchFlow step="report" sessionId="grs-visual" />);
    await screen.findByTestId("research-flow-report");
    expect(report.container).not.toHaveTextContent("演示报告");
    expect(report.container).toHaveTextContent("模型生成摘要。");
  });

  it("keeps the signed search and report information hierarchy", async () => {
    api.getGuidedResearchSession.mockResolvedValueOnce(sessionAt("search"));
    api.getGuidedResearchWorkflow.mockResolvedValueOnce(workflowAt("research"));
    const search = render(<GuidedResearchFlow step="search" sessionId="grs-visual" />);
    await screen.findByTestId("research-flow-search");
    expect(screen.getByRole("heading", { name: "正在检索与交叉验证" })).toBeInTheDocument();
    expect(screen.getByTestId("research-search-summary")).toContainElement(screen.getByTestId("research-current-query"));

    search.unmount();
    api.getGuidedResearchSession.mockResolvedValueOnce(sessionAt("report"));
    api.getGuidedResearchWorkflow.mockResolvedValueOnce(workflowAt("report"));
    render(<GuidedResearchFlow step="report" sessionId="grs-visual" />);
    await screen.findByTestId("research-flow-report");
    const report = screen.getByTestId("research-report");
    expect(report).toHaveAttribute("data-layout", "full-width-report");
    expect(screen.getByRole("heading", { name: "目录" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "欧洲储能市场进入策略研究报告" })).toBeInTheDocument();
  });
});

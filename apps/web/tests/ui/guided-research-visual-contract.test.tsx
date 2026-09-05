import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { ResearchStudioApp } from "@/components/research-studio/research-studio-app";
import { GuidedResearchFlow } from "@/components/research-studio/guided-research-flow";
import { mockIdentity } from "@/lib/identity";
import ResearchPage from "@/app/research/page";
import { runtimeFixture } from "../guided-runtime-fixture";
import type { ReactElement } from "react";
import { type GuidedResearchStep } from "@/lib/mock/guided-research";

const api = vi.hoisted(() => ({
  getResearchRuntime: vi.fn(), executeResearchRuntime: vi.fn(),
  listGuidedResearchSessions: vi.fn(), createGuidedResearchSession: vi.fn(), getGuidedResearchSession: vi.fn(),
  generateResearchDirections: vi.fn(), confirmResearchDirections: vi.fn(), generateResearchOutline: vi.fn(), confirmResearchOutline: vi.fn(),
}));

vi.mock("@/lib/guided-research-api", () => api);
// #728：TopBar 新增读 useSearchParams 解析 /chat?projectId=…（本屏是 /research，不需要
// 真的解析，但 TopBar 无条件调用这个 hook，缺席会在挂载阶段直接抛错）。
vi.mock("next/navigation", () => ({
  usePathname: () => "/research", useRouter: () => ({ replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

const identity = mockIdentity("org-yuanyang", null);

function sessionAt(step: Exclude<GuidedResearchStep, "home" | "brief">) {
  return runtimeFixture(step === "search" ? "research" : step, "grs-visual");
}

beforeEach(() => {
  Object.values(api).forEach((mock) => mock.mockReset());
  api.listGuidedResearchSessions.mockResolvedValue({ items: [] });
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
    api.getResearchRuntime.mockResolvedValue(sessionAt("search"));
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
      if (step !== "brief") api.getResearchRuntime.mockResolvedValueOnce(sessionAt(step));
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
    api.getResearchRuntime.mockResolvedValueOnce(sessionAt("report"));
    render(<GuidedResearchFlow step="report" sessionId="grs-visual" />);

    await screen.findByTestId("research-flow-report");
    const assistant = screen.getByTestId("research-skill-assistant");
    expect(assistant.closest("[data-layout]")).toHaveAttribute("data-layout", "skill-workspace-thirds");
    expect(screen.getByTestId("research-report")).toBeInTheDocument();
  });

  it("keeps future checkpoints disabled and renders only persisted evidence", async () => {
    api.getResearchRuntime.mockResolvedValueOnce(sessionAt("directions"));
    const directions = render(<GuidedResearchFlow step="directions" sessionId="grs-visual" />);
    await screen.findByTestId("research-flow-directions");
    for (const futureStep of ["报告大纲", "资料研究", "研究报告"]) {
      expect(screen.getByRole("button", { name: new RegExp(futureStep) })).toBeDisabled();
    }
    directions.unmount();

    api.getResearchRuntime.mockResolvedValueOnce(sessionAt("search"));
    const search = render(<GuidedResearchFlow step="search" sessionId="grs-visual" />);
    await screen.findByTestId("research-flow-search");
    expect(search.container).not.toHaveTextContent("演示检索结果");
    expect(screen.getByRole("link", { name: "Official policy" })).toHaveAttribute("href", "https://example.org/policy");
    search.unmount();

    api.getResearchRuntime.mockResolvedValueOnce(sessionAt("report"));
    const report = render(<GuidedResearchFlow step="report" sessionId="grs-visual" />);
    await screen.findByTestId("research-flow-report");
    expect(report.container).not.toHaveTextContent("演示报告");
    expect(screen.getByTestId("research-report")).toHaveTextContent("有来源支持的结论");
  });

  it("keeps the signed search and report information hierarchy", async () => {
    api.getResearchRuntime.mockResolvedValueOnce(sessionAt("search"));
    const search = render(<GuidedResearchFlow step="search" sessionId="grs-visual" />);
    await screen.findByTestId("research-flow-search");
    expect(screen.getByRole("heading", { name: "研究检索进度" })).toBeInTheDocument();
    expect(screen.getByTestId("research-search-summary")).toContainElement(screen.getByTestId("research-current-query"));

    search.unmount();
    api.getResearchRuntime.mockResolvedValueOnce(sessionAt("report"));
    render(<GuidedResearchFlow step="report" sessionId="grs-visual" />);
    await screen.findByTestId("research-flow-report");
    const report = screen.getByTestId("research-report");
    expect(report).toHaveAttribute("data-layout", "full-width-report");
    expect(screen.getByRole("heading", { name: "目录" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "政策研究报告" })).toBeInTheDocument();
  });
});

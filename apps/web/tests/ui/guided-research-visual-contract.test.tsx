import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { ResearchStudioApp } from "@/components/research-studio/research-studio-app";
import { GuidedResearchFlow } from "@/components/research-studio/guided-research-flow";
import { mockIdentity } from "@/lib/identity";
import ResearchPage from "@/app/research/page";
import type { ReactElement } from "react";

const api = vi.hoisted(() => ({
  listGuidedResearchSessions: vi.fn(), createGuidedResearchSession: vi.fn(), getGuidedResearchSession: vi.fn(),
  generateResearchDirections: vi.fn(), confirmResearchDirections: vi.fn(), generateResearchOutline: vi.fn(), confirmResearchOutline: vi.fn(),
}));

vi.mock("@/lib/guided-research-api", () => api);
vi.mock("next/navigation", () => ({ usePathname: () => "/research", useRouter: () => ({ replace: vi.fn() }) }));

const identity = mockIdentity("org-yuanyang", null);

beforeEach(() => {
  Object.values(api).forEach((mock) => mock.mockReset());
  api.listGuidedResearchSessions.mockResolvedValue({ items: [] });
});

describe("F174 signed guided-research visual contract", () => {
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

  it("renders the signed progress strip and desktop flow shell", () => {
    render(<GuidedResearchFlow step="search" />);

    const progress = screen.getByTestId("research-flow-progress");
    expect(progress).toHaveClass("rounded-lg", "border");
    expect(screen.getByTestId("research-flow-search")).toHaveAttribute("data-layout", "signed-desktop");
  });

  it("keeps a contextual Skill workspace with one main editor on every non-home step", () => {
    for (const step of ["brief", "directions", "outline", "search", "report"] as const) {
      const view = render(
        <ResearchStudioApp
          identity={identity}
          uiState="default"
          screen="list"
          view="owner"
          flow={step}
          qs={{}}
        />,
      );
      const assistant = screen.getByTestId("research-skill-assistant");
      const workspace = assistant.closest("[data-layout]");

      expect(workspace).toHaveAttribute("data-layout", "skill-workspace");
      expect(screen.getByTestId("research-step-main")).toBeInTheDocument();
      expect(screen.queryByTestId("shell-left-panel")).not.toBeInTheDocument();
      for (const label of ["研究 Studio 列表", "研究计划详情", "新建深度研究", "研究主题详情", "现场深度研究"]) {
        expect(screen.queryByText(label)).not.toBeInTheDocument();
      }
      view.unmount();
    }
  });

  it("keeps future checkpoints disabled and labels every demo output", () => {
    const directions = render(<GuidedResearchFlow step="directions" />);
    for (const futureStep of ["报告大纲", "资料研究", "研究报告"]) {
      expect(screen.getByRole("button", { name: futureStep })).toBeDisabled();
    }
    directions.unmount();

    const search = render(<GuidedResearchFlow step="search" />);
    expect(search.container).toHaveTextContent("演示检索结果，不代表真实 Web Search");
    search.unmount();

    const report = render(<GuidedResearchFlow step="report" />);
    expect(report.container).toHaveTextContent("演示报告，不作为真实研究结论");
  });

  it("keeps the signed search and report information hierarchy", () => {
    const { rerender } = render(<GuidedResearchFlow step="search" />);
    expect(screen.getByRole("heading", { name: "正在检索与交叉验证" })).toBeInTheDocument();
    expect(screen.getByTestId("research-search-summary")).toContainElement(screen.getByTestId("research-current-query"));

    rerender(<GuidedResearchFlow step="report" />);
    const report = screen.getByTestId("research-report");
    expect(report).toHaveAttribute("data-layout", "toc-report-citations");
    expect(screen.getByRole("heading", { name: "目录" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "欧洲储能市场进入策略研究报告" })).toBeInTheDocument();
  });
});

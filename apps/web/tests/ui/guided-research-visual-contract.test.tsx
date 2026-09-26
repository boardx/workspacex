import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { ResearchStudioApp } from "@/components/research-studio/research-studio-app";
import { GuidedResearchFlow } from "@/components/research-studio/guided-research-flow";
import { mockIdentity } from "@/lib/identity";
import ResearchPage from "@/app/research/page";
import { runtimeFixture } from "../guided-runtime-fixture";
import type { ReactElement } from "react";
import { type GuidedResearchStep } from "@/lib/mock/guided-research";
import { GuidedResearchEffortBudgetPreview } from "@/components/research-studio/guided-research-effort-budget-preview";

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
  it("derives restored budget progress from the selected tier limits", () => {
    render(<GuidedResearchEffortBudgetPreview state="default" />);

    fireEvent.click(screen.getByTestId("research-effort-deep"));
    fireEvent.click(screen.getByTestId("research-budget-save"));

    const bars = within(screen.getByTestId("research-budget-summary")).getAllByRole("progressbar");
    expect(bars.map((bar) => Number(bar.getAttribute("aria-valuenow")))).toEqual([
      (8 * 60 + 16) / (2 * 60 * 60) * 100,
      7 / 180 * 100,
      3 / 120 * 100,
    ]);
  });

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

  it("renders one signed six-step progress strip and desktop flow shell", async () => {
    api.getResearchRuntime.mockResolvedValue(sessionAt("search"));
    render(<GuidedResearchFlow step="search" sessionId="grs-visual" />);

    const progress = await screen.findByTestId("research-flow-progress");
    expect(progress).toHaveClass("rounded-xl", "border");
    expect(progress).toHaveAttribute("data-reference-variant", "blue-stepper");
    const flow = screen.getByTestId("research-flow-search");
    expect(flow).toHaveAttribute("data-layout", "signed-desktop");
    expect(flow).toHaveClass("max-w-none");
    expect(flow).not.toHaveClass("max-w-6xl");

    expect(progress).toHaveAttribute("aria-label", "研究步骤");
    expect(screen.queryByTestId("research-progress-shell")).not.toBeInTheDocument();
    expect(within(progress).getAllByRole("button")).toHaveLength(6);
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
      await screen.findByTestId("research-skill-assistant");
      expect(screen.getByTestId("research-step-main")).toBeInTheDocument();
      expect(screen.queryByTestId("shell-left-panel")).not.toBeInTheDocument();
      for (const label of ["研究 Studio 列表", "研究计划详情", "新建深度研究", "研究主题详情", "现场深度研究"]) {
        expect(screen.queryByText(label)).not.toBeInTheDocument();
      }
      view.unmount();
    }
  });

  it("keeps the assistant available in the report reading layout", async () => {
    api.getResearchRuntime.mockResolvedValueOnce(sessionAt("report"));
    render(<GuidedResearchFlow step="report" sessionId="grs-visual" />);

    await screen.findByTestId("research-flow-report");
    const assistant = screen.getByTestId("research-skill-assistant");
    expect(assistant.closest("[data-layout]")).toHaveAttribute("data-layout", "report-reading");
    expect(screen.getByTestId("research-report")).toBeInTheDocument();
  });

  it("keeps future checkpoints disabled and renders only persisted evidence", async () => {
    api.getResearchRuntime.mockResolvedValueOnce(sessionAt("directions"));
    const directions = render(<GuidedResearchFlow step="directions" sessionId="grs-visual" />);
    await screen.findByTestId("research-flow-directions");
    for (const futureStep of ["研究计划", "资料研究", "研究报告"]) {
      expect(within(screen.getByRole("navigation", { name: "研究步骤" })).getByRole("button", { name: new RegExp(futureStep) })).toBeDisabled();
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
    expect(screen.queryByRole("heading", { name: "研究检索进度" })).not.toBeInTheDocument();
    expect(screen.getByTestId("research-sources")).toBeVisible();
    expect(screen.getByTestId("guided-research-source-workspace")).toBeVisible();

    search.unmount();
    api.getResearchRuntime.mockResolvedValueOnce(sessionAt("report"));
    render(<GuidedResearchFlow step="report" sessionId="grs-visual" />);
    await screen.findByTestId("research-flow-report");
    const report = screen.getByTestId("research-report");
    expect(report).toHaveAttribute("data-layout", "full-width-report");
    expect(screen.getByRole("heading", { name: "目录" })).toBeInTheDocument();
    expect(screen.getAllByRole("heading", { name: "政策研究报告" }).length).toBeGreaterThan(0);
  });
});

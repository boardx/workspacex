/**
 * #4584 —— 研究项目 / 用户洞察的负责人、协作者打开项目工作台（服务端 `authorize()` 项目层读两档身份后，
 * `getProjectOverview` 对他们返回 200）。
 *
 * 钉住：
 *   1. 非工作坊容器：工作台正常渲染（不是「需要邀请」面板），主标签只有 概览 / 研究洞察 / 成果沉淀 / 设置——
 *      工作坊专属的 筹备 / 现场协作 / 待办 不给入口；工作坊仍是七个。
 *   2. URL 上手敲工作坊专属 tab（`?tab=live`）⇒ 落回概览，不渲染主持台、不去拉议程环节。
 *   3. 研究洞察 → 「来源」子导航可见、渲染证据列表。
 *   4. 设置 tab：协作者面板（不是工作坊的成员 / 邀请面板）；AI 权限面板给编辑控件（服务端 `settings.manage` 判）。
 *
 * 只 mock 网络边界（`@/lib/live-*` 适配器）与外壳，不 mock 被测逻辑（tab 解析在 `lib/project-workbench.ts`）。
 */
import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { SESSION_TOKEN_STORAGE_KEY } from "@/lib/api-client";
import { resolveTabForKind, tabDefsForKind, WORKSHOP_ONLY_TABS } from "@/lib/project-workbench";

const getProjectOverview = vi.fn();
const listAgendaSegments = vi.fn(async () => []);
const listProjectEvidence = vi.fn();
const listNonWorkshopMembers = vi.fn();

vi.mock("next/navigation", () => ({ usePathname: () => "/projects/p-rp", useRouter: () => ({ push: vi.fn(), replace: vi.fn() }), useSearchParams: () => new URLSearchParams() }));
vi.mock("@/components/shell/app-shell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/session/session-provider", () => ({
  useSession: () => ({ session: { currentOrgId: "org-1", userId: "u-owner" } }),
  useOptionalSession: () => ({ status: "authenticated", session: { currentOrgId: "org-1", userId: "u-owner" }, identity: null }),
}));
vi.mock("@/lib/live-projects", async (orig) => ({
  ...(await orig<typeof import("@/lib/live-projects")>()),
  getProjectOverview: (...a: unknown[]) => getProjectOverview(...a),
  findProject: vi.fn(),
  listAgendaSegments: () => listAgendaSegments(),
}));
vi.mock("@/lib/live-project-prep", async (orig) => ({
  ...(await orig<typeof import("@/lib/live-project-prep")>()),
  getProjectTopic: vi.fn(async () => null),
  getProjectGrouping: vi.fn(async () => null),
}));
vi.mock("@/lib/live-collab-viewer-role", () => ({ getViewerOptions: vi.fn(async () => null) }));
vi.mock("@/lib/live-checkin", () => ({ getCheckinBoard: vi.fn(async () => null) }));
vi.mock("@/lib/live-provenance", () => ({ queryProvenance: vi.fn(async () => ({ events: [] })) }));
vi.mock("@/lib/live-project-evidence", async (orig) => ({
  ...(await orig<typeof import("@/lib/live-project-evidence")>()),
  listProjectEvidence: (...a: unknown[]) => listProjectEvidence(...a),
}));
vi.mock("@/lib/live-project-collaborators", async (orig) => ({
  ...(await orig<typeof import("@/lib/live-project-collaborators")>()),
  listNonWorkshopMembers: (...a: unknown[]) => listNonWorkshopMembers(...a),
  addNonWorkshopMember: vi.fn(),
  removeNonWorkshopMember: vi.fn(),
}));
vi.mock("@/lib/live-org-admin", async (orig) => ({
  ...(await orig<typeof import("@/lib/live-org-admin")>()),
  listOrgMembers: vi.fn(async () => ({ members: [] })),
}));
vi.mock("@/lib/live-project-ai-settings", async (orig) => ({
  ...(await orig<typeof import("@/lib/live-project-ai-settings")>()),
  getProjectAiSettings: vi.fn().mockResolvedValue({ projectId: "p-rp", allowedSources: ["chat", "transcript", "survey", "interview", "research"], updatedAt: null, updatedBy: null }),
  updateProjectAiSettings: vi.fn(),
}));

import { ProjectWorkbench } from "@/components/project/project-workbench";

const overviewOf = (kind: "workshop" | "research_project" | "user_insight") => ({
  projectId: "p-rp", name: "德国工商业储能调研", kind, status: "active",
  currentAgendaSegment: null, roleCounts: null, backflow: [], blueprint: null,
});

function renderWorkbench(tab: "overview" | "research" | "live" | "settings", sub: string | null = null) {
  return render(<ProjectWorkbench uiState="default" tab={tab} view="facilitator" sub={sub} qs={{}} projectId="p-rp" />);
}

describe("lib：按容器种类解析主标签", () => {
  it("非工作坊去掉筹备 / 现场协作 / 待办；工作坊与未知种类是全集；不可见的 tab 落回概览", () => {
    expect(WORKSHOP_ONLY_TABS).toEqual(["prep", "live", "todo"]);
    expect(tabDefsForKind("research_project").map((t) => t.key)).toEqual(["overview", "research", "results", "settings"]);
    expect(tabDefsForKind("user_insight").map((t) => t.key)).toEqual(["overview", "research", "results", "settings"]);
    expect(tabDefsForKind("workshop")).toHaveLength(7);
    expect(tabDefsForKind(null)).toHaveLength(7);
    expect(resolveTabForKind("live", "research_project")).toBe("overview");
    expect(resolveTabForKind("settings", "user_insight")).toBe("settings");
    expect(resolveTabForKind("live", "workshop")).toBe("live");
  });
});

describe("#4584 非工作坊容器的工作台", () => {
  beforeEach(() => {
    window.localStorage.setItem(SESSION_TOKEN_STORAGE_KEY, "tok-1");
    getProjectOverview.mockReset();
    listAgendaSegments.mockClear();
    listProjectEvidence.mockReset();
    listNonWorkshopMembers.mockReset();
    listNonWorkshopMembers.mockResolvedValue({ members: [{ userId: "u-owner", displayName: "林可", role: "owner" }] });
  });
  afterEach(() => {
    window.localStorage.clear();
  });

  it("研究项目：渲染工作台而非「需要邀请」，主标签不含工作坊专属三屏", async () => {
    getProjectOverview.mockResolvedValue(overviewOf("research_project"));
    renderWorkbench("overview");
    await waitFor(() => expect(screen.getByTestId("project-header-meta")).toHaveTextContent("研究项目"));
    expect(screen.queryByTestId("project-access-denied")).toBeNull();
    for (const t of ["overview", "research", "results", "settings"]) expect(screen.getByTestId(`project-tab-${t}`)).toBeInTheDocument();
    for (const t of ["prep", "live", "todo"]) expect(screen.queryByTestId(`project-tab-${t}`)).toBeNull();
  });

  it("工作坊：七个主标签照旧", async () => {
    getProjectOverview.mockResolvedValue(overviewOf("workshop"));
    renderWorkbench("overview");
    await waitFor(() => expect(screen.getByTestId("project-header-meta")).toHaveTextContent("工作坊"));
    for (const t of ["overview", "research", "prep", "live", "results", "todo", "settings"]) {
      expect(screen.getByTestId(`project-tab-${t}`)).toBeInTheDocument();
    }
  });

  it("?tab=live 打开用户洞察 ⇒ 落回概览，不渲染主持台", async () => {
    getProjectOverview.mockResolvedValue(overviewOf("user_insight"));
    renderWorkbench("live");
    await waitFor(() => expect(screen.getByTestId("project-overview")).toBeInTheDocument());
    expect(screen.queryByTestId("project-live")).toBeNull();
    expect(screen.getByTestId("project-tab-overview")).toHaveAttribute("aria-current", "page");
  });

  it("研究洞察 → 来源：子导航可见，证据列表来自真实 listProjectEvidence", async () => {
    getProjectOverview.mockResolvedValue(overviewOf("research_project"));
    listProjectEvidence.mockResolvedValue({
      items: [{
        id: "ev1", projectId: "p-rp", sourceKind: "interview_segment", resourceId: "itv-1", sourceRef: "seg-1",
        excerpt: "我们每周都要手工对账", locator: {}, speakerLabel: "受访者 A", resourceTitle: "访谈一",
        revoked: false, createdAt: "2026-09-28T00:00:00.000Z",
      }],
      nextCursor: null,
      countsBySource: { chat_message: 0, attachment: 0, survey_response: 0, interview_segment: 1, transcript_segment: 0, research_source: 0 },
    });
    renderWorkbench("research", "sources");
    await waitFor(() => expect(screen.getByTestId("project-sub-nav")).toBeInTheDocument());
    expect(screen.getByTestId("project-subnav-sources")).toHaveAttribute("aria-current", "true");
    await waitFor(() => expect(screen.getByTestId("project-evidence-list")).toHaveTextContent("我们每周都要手工对账"));
  });

  it("设置：协作者面板（不是工作坊成员 / 邀请面板），AI 权限面板带编辑控件", async () => {
    getProjectOverview.mockResolvedValue(overviewOf("research_project"));
    renderWorkbench("settings");
    await waitFor(() => expect(screen.getByTestId("project-collaborators-panel")).toBeInTheDocument());
    expect(screen.queryByTestId("project-members-panel")).toBeNull();
    expect(screen.queryByTestId("project-invite-panel")).toBeNull();
    await waitFor(() => expect(screen.getByTestId("project-ai-settings-save")).toBeInTheDocument());
  });
});

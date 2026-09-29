/**
 * #4615（PROP-PROJECT-WORKSPACE-001 §3.4）—— 通用项目（`kind: "general"`）的工作台。
 * （前身：#4584 研究项目 / 用户洞察的工作台；两类已并入 `general`。）
 *
 * 钉住：
 *   1. 每种容器一份显式 tab 清单：通用项目 = 概览 / 内容 / 大脑 / 成果 / 设置；工作坊仍是七个。
 *   2. URL 上手敲工作坊专属 tab（`?tab=live`）⇒ 落回概览；`?tab=research&sub=…`（各 Studio 返回链接 /
 *      证据引用）⇒ 通用项目的「内容」对应筛选 /「大脑」。
 *   3. 概览：项目名、成员、各类内容数量、最近更新、项目大脑摘要（全部来自已有接口），不渲染工作坊卡片。
 *   4. 内容：统一列表合并对话与资源；类型筛选切到对应的既有列表组件；白板「新建」就地创建并挂到项目。
 *   5. 大脑：项目大脑面板 + 证据列表（testid 同原研究洞察）。
 *   6. 设置：协作者面板（不是工作坊的成员 / 邀请面板）；AI 权限面板带编辑控件与「白板」开关。
 *
 * 只 mock 网络边界（`@/lib/live-*` / `knowledge-graph-api` 适配器）与外壳，不 mock 被测逻辑。
 */
import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { SESSION_TOKEN_STORAGE_KEY } from "@/lib/api-client";
import { resolveTabForKind, tabDefsForKind, TAB_DEFS_BY_KIND } from "@/lib/project-workbench";

const getProjectOverview = vi.fn();
const listAgendaSegments = vi.fn(async () => []);
const listProjectEvidence = vi.fn();
const listNonWorkshopMembers = vi.fn();
const listThreads = vi.fn();
const listProjectResources = vi.fn();
const linkProjectResource = vi.fn();
const createBoard = vi.fn();
const createDesignProject = vi.fn();
const listDesignProjects = vi.fn();
const fetchProjectKnowledge = vi.fn();
const fetchProjectReasoning = vi.fn();
const pushMock = vi.fn();

vi.mock("next/navigation", () => ({ usePathname: () => "/projects/p-rp", useRouter: () => ({ push: pushMock, replace: vi.fn() }), useSearchParams: () => new URLSearchParams() }));
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
  getProjectAiSettings: vi.fn().mockResolvedValue({ projectId: "p-rp", allowedSources: ["chat", "whiteboard", "transcript", "survey", "interview", "research"], updatedAt: null, updatedBy: null }),
  updateProjectAiSettings: vi.fn(),
}));
vi.mock("@/lib/live-chat", async (orig) => ({
  ...(await orig<typeof import("@/lib/live-chat")>()),
  listThreads: (...a: unknown[]) => listThreads(...a),
}));
vi.mock("@/lib/live-project-resources", async (orig) => ({
  ...(await orig<typeof import("@/lib/live-project-resources")>()),
  listProjectResources: (...a: unknown[]) => listProjectResources(...a),
  linkProjectResource: (...a: unknown[]) => linkProjectResource(...a),
}));
vi.mock("@/lib/live-whiteboard", async (orig) => ({
  ...(await orig<typeof import("@/lib/live-whiteboard")>()),
  createBoard: (...a: unknown[]) => createBoard(...a),
}));
vi.mock("@/lib/live-design-workbench", async (orig) => ({
  ...(await orig<typeof import("@/lib/live-design-workbench")>()),
  createProject: (...a: unknown[]) => createDesignProject(...a),
  listMyProjects: (...a: unknown[]) => listDesignProjects(...a),
}));
vi.mock("@/lib/knowledge-graph-api", async (orig) => ({
  ...(await orig<typeof import("@/lib/knowledge-graph-api")>()),
  fetchProjectKnowledge: (...a: unknown[]) => fetchProjectKnowledge(...a),
  fetchProjectReasoning: (...a: unknown[]) => fetchProjectReasoning(...a),
}));

import { ProjectWorkbench } from "@/components/project/project-workbench";

const overviewOf = (kind: "workshop" | "general") => ({
  projectId: "p-rp", name: "德国工商业储能调研", kind, status: "active",
  currentAgendaSegment: null, roleCounts: null, backflow: [], blueprint: null,
});

function renderWorkbench(tab: "overview" | "content" | "brain" | "research" | "live" | "settings", sub: string | null = null) {
  return render(<ProjectWorkbench uiState="default" tab={tab} view="facilitator" sub={sub} qs={{}} projectId="p-rp" />);
}

describe("lib：每种容器一份显式 tab 清单", () => {
  it("通用项目 = 概览 / 内容 / 大脑 / 成果 / 设置；工作坊与未知种类是七个；别名与回落", () => {
    expect(tabDefsForKind("general").map((t) => t.label)).toEqual(["概览", "内容", "大脑", "成果", "设置"]);
    expect(tabDefsForKind("general").map((t) => t.key)).toEqual(["overview", "content", "brain", "results", "settings"]);
    expect(tabDefsForKind("workshop")).toBe(TAB_DEFS_BY_KIND.workshop);
    expect(tabDefsForKind("workshop").map((t) => t.key)).toEqual(["overview", "research", "prep", "live", "results", "todo", "settings"]);
    expect(tabDefsForKind(null)).toHaveLength(7);
    expect(resolveTabForKind("live", "general")).toBe("overview");
    expect(resolveTabForKind("settings", "general")).toBe("settings");
    expect(resolveTabForKind("research", "general", "survey")).toBe("content");
    expect(resolveTabForKind("research", "general", "sources")).toBe("brain");
    expect(resolveTabForKind("live", "workshop")).toBe("live");
    expect(resolveTabForKind("content", "workshop")).toBe("research");
    expect(resolveTabForKind("brain", null)).toBe("research");
  });
});

const THREADS = {
  groups: [{ label: "今天", cards: [{
    id: "th1", title: "定价讨论", subtitle: "", badges: [], status: null, artifactCount: 0,
    lastActivityAt: "2026-09-28T09:00:00.000Z", visibilityScope: "plenary", pinned: false,
  }] }],
};
const res = (kind: string, id: string, title: string, updatedAt: string) => ({
  kind, id, title, ownerUserId: "u-owner", status: null, updatedAt, linkedAt: updatedAt,
});
const RESOURCES = {
  items: [
    res("whiteboard", "wb1", "用户旅程白板", "2026-09-28T10:00:00.000Z"),
    res("survey", "sv1", "价格敏感度问卷", "2026-09-27T10:00:00.000Z"),
    res("design", "ds1", "结算页原型", "2026-09-26T10:00:00.000Z"),
  ],
  counts: { survey: 1, guided_research: 0, personal_transcription: 0, interview: 0, whiteboard: 1, design: 1 },
};
const SCOPE = { level: "project", orgId: "org-1", ownerUserId: null, projectId: "p-rp" };
const claim = (id: string, kind: string, triState = "confirmed") => ({
  id, scope: SCOPE, kind, statement: `结论 ${id}`, subjectObjectId: null, triState, status: "accepted",
  supportingCount: 0, contradictingCount: 0, createdBy: "human", reviewedBy: null,
  createdAt: "2026-09-28T00:00:00.000Z", updatedAt: "2026-09-28T00:00:00.000Z",
});

describe("#4615 通用项目的工作台", () => {
  beforeEach(() => {
    window.localStorage.setItem(SESSION_TOKEN_STORAGE_KEY, "tok-1");
    getProjectOverview.mockReset();
    listAgendaSegments.mockClear();
    listProjectEvidence.mockReset();
    listProjectEvidence.mockResolvedValue({
      items: [], nextCursor: null,
      countsBySource: { chat_message: 0, attachment: 0, survey_response: 0, interview_segment: 0, transcript_segment: 0, research_source: 0, whiteboard_note: 0 },
    });
    listNonWorkshopMembers.mockReset();
    listNonWorkshopMembers.mockResolvedValue({ members: [{ userId: "u-owner", displayName: "林可", role: "owner" }] });
    listThreads.mockReset();
    listThreads.mockResolvedValue(THREADS);
    listProjectResources.mockReset();
    listProjectResources.mockResolvedValue(RESOURCES);
    linkProjectResource.mockReset();
    createBoard.mockReset();
    pushMock.mockReset();
    fetchProjectKnowledge.mockReset();
    fetchProjectKnowledge.mockResolvedValue({
      scope: SCOPE, revision: 1, objects: [], edges: [],
      claims: [claim("c1", "fact"), claim("c2", "hypothesis", "pending"), claim("c3", "decision")],
    });
    fetchProjectReasoning.mockReset();
    fetchProjectReasoning.mockResolvedValue({ conflicts: [], gaps: [], chains: [], computedAt: "2026-09-28T00:00:00.000Z" });
  });
  afterEach(() => {
    window.localStorage.clear();
  });

  it("主标签：概览 / 内容 / 大脑 / 成果 / 设置，不含工作坊专属屏；类型标签「项目」", async () => {
    getProjectOverview.mockResolvedValue(overviewOf("general"));
    renderWorkbench("overview");
    await waitFor(() => expect(screen.getByTestId("project-header-meta")).toHaveTextContent("项目"));
    expect(screen.queryByTestId("project-access-denied")).toBeNull();
    for (const t of ["overview", "content", "brain", "results", "settings"]) expect(screen.getByTestId(`project-tab-${t}`)).toBeInTheDocument();
    expect(screen.getByTestId("project-tab-content")).toHaveTextContent("内容");
    expect(screen.getByTestId("project-tab-content")).toHaveAttribute("href", expect.stringContaining("tab=content"));
    for (const t of ["research", "prep", "live", "todo"]) expect(screen.queryByTestId(`project-tab-${t}`)).toBeNull();
  });

  it("工作坊：七个主标签照旧，不渲染通用概览", async () => {
    getProjectOverview.mockResolvedValue(overviewOf("workshop"));
    renderWorkbench("overview");
    await waitFor(() => expect(screen.getByTestId("project-header-meta")).toHaveTextContent("工作坊"));
    for (const t of ["overview", "research", "prep", "live", "results", "todo", "settings"]) {
      expect(screen.getByTestId(`project-tab-${t}`)).toBeInTheDocument();
    }
    expect(screen.queryByTestId("project-tab-content")).toBeNull();
    expect(screen.queryByTestId("project-general-overview")).toBeNull();
  });

  it("概览：成员 / 各类数量 / 最近更新 / 大脑摘要，全部来自接口；不渲染工作坊概览", async () => {
    getProjectOverview.mockResolvedValue(overviewOf("general"));
    renderWorkbench("overview");
    await waitFor(() => expect(screen.getByTestId("project-general-overview")).toBeInTheDocument());
    expect(screen.queryByTestId("project-overview")).toBeNull();
    await waitFor(() => expect(screen.getByTestId("project-general-overview-member-u-owner")).toHaveTextContent("林可"));
    await waitFor(() => expect(screen.getByTestId("project-general-overview-count-whiteboard")).toHaveTextContent("1"));
    expect(screen.getByTestId("project-general-overview-count-conv")).toHaveTextContent("1");
    expect(screen.getByTestId("project-general-overview-count-itv")).toHaveTextContent("0");
    expect(screen.getByTestId("project-general-overview-count-whiteboard")).toHaveAttribute("href", expect.stringContaining("tab=content"));
    const recent = screen.getByTestId("project-general-overview-recent");
    // 按更新时间倒序：白板（10:00）> 对话（09:00）> 问卷（前一天）
    expect(recent.querySelectorAll("li")[0]).toHaveTextContent("用户旅程白板");
    expect(recent.querySelectorAll("li")[1]).toHaveTextContent("定价讨论");
    await waitFor(() => expect(screen.getByTestId("project-general-overview-brain-claims")).toHaveTextContent("3"));
    expect(screen.getByTestId("project-general-overview-brain-unverified")).toHaveTextContent("1");
    expect(screen.getByTestId("project-general-overview-brain-conflicts")).toHaveTextContent("0");
  });

  it("?tab=live ⇒ 落回概览，不渲染主持台", async () => {
    getProjectOverview.mockResolvedValue(overviewOf("general"));
    renderWorkbench("live");
    await waitFor(() => expect(screen.getByTestId("project-general-overview")).toBeInTheDocument());
    expect(screen.queryByTestId("project-live")).toBeNull();
    expect(screen.getByTestId("project-tab-overview")).toHaveAttribute("aria-current", "page");
  });

  it("内容：「全部」合并对话与资源，链到各自的页面；筛选白板切到资源列表", async () => {
    getProjectOverview.mockResolvedValue(overviewOf("general"));
    renderWorkbench("content");
    await waitFor(() => expect(screen.getByTestId("project-content-list")).toBeInTheDocument());
    expect(screen.getByTestId("project-tab-content")).toHaveAttribute("aria-current", "page");
    expect(screen.getByTestId("project-content-item-conv-th1")).toHaveAttribute("href", "/chat/th1?projectId=p-rp");
    expect(screen.getByTestId("project-content-item-whiteboard-wb1")).toHaveAttribute("href", "/studio/board/wb1?projectId=p-rp");
    expect(screen.getByTestId("project-content-item-design-ds1")).toHaveAttribute("href", "/studio/design-workbench/ds1?projectId=p-rp");
    expect(screen.getByTestId("project-content-files")).toHaveAttribute("href", "/projects/p-rp/files");
    expect(screen.getByTestId("project-content-filter-whiteboard")).toHaveTextContent("1");
    fireEvent.click(screen.getByTestId("project-content-filter-whiteboard"));
    await waitFor(() => expect(screen.getByTestId("project-resources")).toHaveAttribute("data-kind", "whiteboard"));
    expect(await screen.findByTestId("project-resource-wb1")).toBeInTheDocument();
    expect(screen.queryByTestId("project-resource-sv1")).toBeNull();
  });

  it("内容：Studio 返回链接 ?tab=research&sub=survey 落到「内容 · 问卷」", async () => {
    getProjectOverview.mockResolvedValue(overviewOf("general"));
    renderWorkbench("research", "survey");
    await waitFor(() => expect(screen.getByTestId("project-content")).toHaveAttribute("data-filter", "survey"));
    expect(screen.getByTestId("project-tab-content")).toHaveAttribute("aria-current", "page");
    expect(await screen.findByTestId("project-resource-sv1")).toBeInTheDocument();
  });

  it("内容 · 白板：「在本项目中新建白板」就地创建 → 挂到本项目 → 进入白板", async () => {
    getProjectOverview.mockResolvedValue(overviewOf("general"));
    createBoard.mockResolvedValue({ id: "wb-new" });
    linkProjectResource.mockResolvedValue({ linked: true });
    renderWorkbench("content", "whiteboard");
    fireEvent.click(await screen.findByTestId("project-resources-new"));
    await waitFor(() => expect(pushMock).toHaveBeenCalledWith("/studio/board/wb-new?projectId=p-rp"));
    expect(createBoard).toHaveBeenCalledWith(expect.objectContaining({ name: "未命名白板" }));
    expect(linkProjectResource).toHaveBeenCalledWith({ projectId: "p-rp", kind: "whiteboard", resourceId: "wb-new" });
  });

  it("内容：「新建 ▾ · 设计」就地建设计稿并挂到本项目；「关联已有 ▾ · 设计」切到设计并展开候选", async () => {
    getProjectOverview.mockResolvedValue(overviewOf("general"));
    createDesignProject.mockResolvedValue({ project: { id: "ds-new" } });
    listDesignProjects.mockResolvedValue({ items: [{ id: "ds1", name: "结算页原型", updatedAt: "2026-09-26T10:00:00.000Z" }, { id: "ds2", name: "首页改版", updatedAt: "2026-09-25T10:00:00.000Z" }] });
    linkProjectResource.mockResolvedValue({ alreadyLinked: false });
    renderWorkbench("content");
    await screen.findByTestId("project-content-list");

    fireEvent.pointerDown(screen.getByTestId("project-content-link-menu"), { button: 0, ctrlKey: false });
    fireEvent.click(await screen.findByTestId("project-content-link-design"));
    await waitFor(() => expect(screen.getByTestId("project-content")).toHaveAttribute("data-filter", "design"));
    expect(await screen.findByTestId("project-resources-link-ds2")).toBeInTheDocument();
    expect(screen.queryByTestId("project-resources-link-ds1")).toBeNull();

    fireEvent.pointerDown(screen.getByTestId("project-content-new-menu"), { button: 0, ctrlKey: false });
    fireEvent.click(await screen.findByTestId("project-content-new-design"));
    await waitFor(() => expect(pushMock).toHaveBeenCalledWith("/studio/design-workbench/ds-new?projectId=p-rp"));
    expect(createDesignProject).toHaveBeenCalledWith({ name: "未命名设计", template: "ui" });
    expect(linkProjectResource).toHaveBeenCalledWith({ projectId: "p-rp", kind: "design", resourceId: "ds-new" });
  });

  it("大脑：项目大脑面板 + 证据列表；证据引用链接 ?tab=research&sub=sources 落到这里", async () => {
    getProjectOverview.mockResolvedValue(overviewOf("general"));
    renderWorkbench("research", "sources");
    await waitFor(() => expect(screen.getByTestId("project-brain-tab")).toBeInTheDocument());
    expect(screen.getByTestId("project-tab-brain")).toHaveAttribute("aria-current", "page");
    expect(screen.queryByTestId("project-sub-nav")).toBeNull();
    await waitFor(() => expect(screen.getByTestId("project-brain-groups")).toBeInTheDocument());
    await waitFor(() => expect(listProjectEvidence).toHaveBeenCalled());
  });

  it("设置：协作者面板（不是工作坊成员 / 邀请面板），AI 权限面板带编辑控件与白板开关", async () => {
    getProjectOverview.mockResolvedValue(overviewOf("general"));
    renderWorkbench("settings");
    await waitFor(() => expect(screen.getByTestId("project-collaborators-panel")).toBeInTheDocument());
    expect(screen.queryByTestId("project-members-panel")).toBeNull();
    expect(screen.queryByTestId("project-invite-panel")).toBeNull();
    await waitFor(() => expect(screen.getByTestId("project-ai-settings-save")).toBeInTheDocument());
    expect(screen.getByTestId("project-ai-source-whiteboard")).toBeInTheDocument();
  });
});

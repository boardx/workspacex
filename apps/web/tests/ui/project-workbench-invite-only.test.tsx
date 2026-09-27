/**
 * 项目中枢 R1 —— 项目是受邀才能进的容器（工作台整条拉取链路）。
 *
 * 钉住两件事：
 *   1. 页头不再依赖 `?org=`：只靠 `getProjectOverview`（服务端按 principal 取 org）就能
 *      显示真实项目名 / 类型 / 状态。此前没有 `?org=` 页头拿不到任何真实数据。
 *   2. 非成员打开项目：`getProjectOverview` 返回 403 `NO_PROJECT_ROLE`（或组织管理员未提升
 *      的 `ADMIN_NOT_SUPERUSER`）时，工作台主体整体换成「需要邀请」面板，不渲染任何 tab
 *      内容与子导航；真故障（`DEPENDENCY_UNAVAILABLE`）**不**走这条分支。
 *
 * 只 mock 网络边界（`@/lib/live-projects` 等适配器）与外壳，不 mock 被测逻辑。
 */
import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { ApiError, SESSION_TOKEN_STORAGE_KEY } from "@/lib/api-client";

const getProjectOverview = vi.fn();
const findProject = vi.fn();
const listAgendaSegments = vi.fn(async () => []);

vi.mock("@/components/shell/app-shell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/session/session-provider", () => ({
  useSession: () => ({ session: { currentOrgId: "org-1", userId: "u-1" } }),
  useOptionalSession: () => ({ session: { currentOrgId: "org-1", userId: "u-1" }, identity: null }),
}));
vi.mock("@/lib/live-projects", async (orig) => ({
  ...(await orig<typeof import("@/lib/live-projects")>()),
  getProjectOverview: (...a: unknown[]) => getProjectOverview(...a),
  findProject: (...a: unknown[]) => findProject(...a),
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

import { ProjectWorkbench } from "@/components/project/project-workbench";

const OVERVIEW = {
  projectId: "p-1", name: "远洋储能欧洲进入", kind: "workshop", status: "active",
  currentAgendaSegment: null, roleCounts: null, backflow: [], blueprint: null,
};

function renderWorkbench(tab: "overview" | "research" = "overview") {
  return render(
    <ProjectWorkbench uiState="default" tab={tab} view="facilitator" sub={null} qs={{}} projectId="p-1" />,
  );
}

describe("R1 项目工作台：受邀才能进的容器", () => {
  beforeEach(() => {
    window.localStorage.setItem(SESSION_TOKEN_STORAGE_KEY, "tok-1");
    getProjectOverview.mockReset();
    findProject.mockReset();
  });
  afterEach(() => {
    window.localStorage.clear();
  });

  it("没有 ?org= 也能靠 getProjectOverview 显示真实项目名 / 类型 / 状态", async () => {
    getProjectOverview.mockResolvedValue(OVERVIEW);
    renderWorkbench();
    await waitFor(() => expect(screen.getByTestId("project-title")).toHaveTextContent("远洋储能欧洲进入"));
    expect(screen.getByTestId("project-header-meta")).toHaveTextContent("工作坊");
    expect(screen.getByTestId("project-header-meta")).toHaveTextContent("进行中");
    expect(findProject).not.toHaveBeenCalled();
    expect(screen.queryByTestId("project-access-denied")).toBeNull();
    expect(screen.getByTestId("project-main")).toBeInTheDocument();
  });

  it("非工作坊 tab 也会拉 overview（页头在所有 tab 都要真实）", async () => {
    getProjectOverview.mockResolvedValue(OVERVIEW);
    renderWorkbench("research");
    await waitFor(() => expect(screen.getByTestId("project-title")).toHaveTextContent("远洋储能欧洲进入"));
    expect(getProjectOverview).toHaveBeenCalledWith("p-1");
  });

  it("非成员（NO_PROJECT_ROLE）：主体换成「需要邀请」面板，不渲染 tab 内容与子导航", async () => {
    getProjectOverview.mockRejectedValue(new ApiError(403, "NO_PROJECT_ROLE", {}));
    renderWorkbench("research");
    const denied = await screen.findByTestId("project-access-denied");
    expect(denied).toHaveAttribute("data-reason", "NO_PROJECT_ROLE");
    expect(denied).toHaveTextContent("受邀才能进入");
    expect(screen.getByTestId("project-title")).toHaveTextContent("需要邀请才能进入的项目");
    expect(screen.queryByTestId("project-research")).toBeNull();
    expect(screen.queryByTestId("project-sub-nav")).toBeNull();
    expect(screen.getByTestId("project-access-denied-back")).toHaveAttribute("href", "/projects");
  });

  it("组织管理员未提升（ADMIN_NOT_SUPERUSER）：同样是访问范围，说明是组织层限制", async () => {
    getProjectOverview.mockRejectedValue(new ApiError(403, "ADMIN_NOT_SUPERUSER", {}));
    renderWorkbench();
    const denied = await screen.findByTestId("project-access-denied");
    expect(denied).toHaveAttribute("data-reason", "ADMIN_NOT_SUPERUSER");
    expect(denied).toHaveTextContent("组织层限制");
  });

  it("反证：真故障（DEPENDENCY_UNAVAILABLE）不走「需要邀请」分支，tab 内容照常渲染并显示可重试错误", async () => {
    getProjectOverview.mockRejectedValue(new ApiError(503, "DEPENDENCY_UNAVAILABLE", {}));
    renderWorkbench();
    await waitFor(() => expect(screen.getByTestId("project-overview-live-overview-error")).toBeInTheDocument());
    expect(screen.queryByTestId("project-access-denied")).toBeNull();
  });
});

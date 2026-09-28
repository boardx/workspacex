/**
 * 项目中枢 B3-T5（#4499）—— 设置 tab「协作者」面板：非工作坊容器（研究项目 / 用户洞察）的两档名单。
 * 钉住：`projectKind !== "workshop"` 时渲染协作者面板而不是项目成员 / 邀请面板（工作坊仍走旧面板）/
 * 真实名单渲染、标签「负责人 / 协作者」/ 负责人能指派·改档·移出且每次写后重拉 / 协作者视角只读 /
 * 名单为空时给指派控件（lead/admin 加第一位）/ 403 与 400（工作坊）如实显示。只 mock 网络边界与会话。
 */
import * as React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { ApiError } from "@/lib/api-client";

const listNonWorkshopMembers = vi.fn();
const addNonWorkshopMember = vi.fn();
const removeNonWorkshopMember = vi.fn();
const listProjectMembers = vi.fn();
const listOrgMembers = vi.fn();
let sessionUserId = "u-owner";

vi.mock("@/components/session/session-provider", () => ({
  useOptionalSession: () => ({ status: "authenticated", session: { userId: sessionUserId, currentOrgId: "org-1" } }),
  useSession: () => ({ session: { userId: sessionUserId, currentOrgId: "org-1" } }),
}));
vi.mock("@/lib/live-project-collaborators", async (orig) => ({
  ...(await orig<typeof import("@/lib/live-project-collaborators")>()),
  listNonWorkshopMembers: (...a: unknown[]) => listNonWorkshopMembers(...a),
  addNonWorkshopMember: (...a: unknown[]) => addNonWorkshopMember(...a),
  removeNonWorkshopMember: (...a: unknown[]) => removeNonWorkshopMember(...a),
}));
vi.mock("@/lib/live-project-members", async (orig) => ({
  ...(await orig<typeof import("@/lib/live-project-members")>()),
  listProjectMembers: (...a: unknown[]) => listProjectMembers(...a),
  addProjectMember: vi.fn(), changeProjectRole: vi.fn(), removeProjectMember: vi.fn(),
}));
vi.mock("@/lib/live-org-admin", async (orig) => ({
  ...(await orig<typeof import("@/lib/live-org-admin")>()),
  listOrgMembers: (...a: unknown[]) => listOrgMembers(...a),
}));
vi.mock("@/lib/live-project-invite", async (orig) => ({
  ...(await orig<typeof import("@/lib/live-project-invite")>()),
  issueProjectInviteLink: vi.fn(), revokeProjectInviteLinks: vi.fn(),
}));
vi.mock("@/lib/live-project-ai-settings", async (orig) => ({
  ...(await orig<typeof import("@/lib/live-project-ai-settings")>()),
  getProjectAiSettings: vi.fn().mockResolvedValue({ projectId: "p1", allowedSources: ["chat", "transcript", "survey", "interview", "research"], updatedAt: null, updatedBy: null }),
  updateProjectAiSettings: vi.fn(),
}));

import { TabSettings } from "@/components/project/tab-settings";

const MEMBERS = [
  { userId: "u-owner", displayName: "林可", role: "owner" },
  { userId: "u-collab", displayName: "高琳", role: "collaborator" },
];
const ORG = { members: [
  { userId: "u-owner", displayName: "林可", email: "a@x", orgRole: "lead", teamId: null, joinedAt: "2026-01-01", status: "active" },
  { userId: "u-collab", displayName: "高琳", email: "b@x", orgRole: "consultant", teamId: null, joinedAt: "2026-01-01", status: "active" },
  { userId: "u-wu", displayName: "吴桐", email: "c@x", orgRole: "consultant", teamId: null, joinedAt: "2026-01-01", status: "active" },
] };

describe("B3-T5 协作者面板", () => {
  beforeEach(() => {
    sessionUserId = "u-owner";
    listNonWorkshopMembers.mockReset(); addNonWorkshopMember.mockReset(); removeNonWorkshopMember.mockReset();
    listProjectMembers.mockReset(); listOrgMembers.mockReset();
    listNonWorkshopMembers.mockResolvedValue({ members: MEMBERS });
    listProjectMembers.mockResolvedValue({ members: [] });
    listOrgMembers.mockResolvedValue(ORG);
  });

  it("research_project：渲染协作者面板（不渲染项目成员 / 邀请面板），标签「负责人 / 协作者」，候选人只含还不在名单里的人", async () => {
    render(<TabSettings view="facilitator" projectId="p1" projectKind="research_project" />);
    const list = await screen.findByTestId("project-collaborators-list");
    expect(within(list).getByTestId("project-collaborator-u-owner")).toHaveTextContent("林可");
    expect(within(list).getByTestId("project-collaborator-u-collab")).toHaveTextContent("高琳");
    // 负责人视角：档位是下拉控件，当前值显示中文标签。
    expect(screen.getByTestId("project-collaborator-role-u-owner")).toHaveTextContent("负责人");
    expect(screen.getByTestId("project-collaborator-role-u-collab")).toHaveTextContent("协作者");
    expect(screen.queryByTestId("project-members-panel")).toBeNull();
    expect(screen.queryByTestId("project-invite-panel")).toBeNull();
    expect(listProjectMembers).not.toHaveBeenCalled();
    await waitFor(() => expect(listOrgMembers).toHaveBeenCalledWith("org-1"));
    expect(screen.getByTestId("project-collaborators-add")).toBeInTheDocument();
  });

  it("workshop（或未知种类）仍走项目成员面板，不调 collaborators", async () => {
    render(<TabSettings view="facilitator" projectId="p1" projectKind="workshop" />);
    await screen.findByTestId("project-members-panel");
    expect(screen.queryByTestId("project-collaborators-panel")).toBeNull();
    expect(listNonWorkshopMembers).not.toHaveBeenCalled();
  });

  it("移出：调 removeNonWorkshopMember 后重新拉名单（不在本地删）", async () => {
    removeNonWorkshopMember.mockResolvedValue({ projectId: "p1", userId: "u-collab", removed: true, provenanceEventId: "ev" });
    render(<TabSettings view="facilitator" projectId="p1" projectKind="user_insight" />);
    await screen.findByTestId("project-collaborator-u-collab");
    listNonWorkshopMembers.mockResolvedValue({ members: [MEMBERS[0]] });
    fireEvent.click(screen.getByTestId("project-collaborator-remove-u-collab"));
    await waitFor(() => expect(screen.queryByTestId("project-collaborator-u-collab")).toBeNull());
    expect(removeNonWorkshopMember).toHaveBeenCalledWith("p1", "u-collab");
    expect(listNonWorkshopMembers).toHaveBeenCalledTimes(2);
  });

  it("指派：选人 + 档位后调 addNonWorkshopMember（走新契约，不是 addProjectMember），成功后重拉", async () => {
    addNonWorkshopMember.mockResolvedValue({ projectId: "p1", userId: "u-wu", role: "collaborator", provenanceEventId: "ev" });
    render(<TabSettings view="facilitator" projectId="p1" projectKind="research_project" />);
    await screen.findByTestId("project-collaborators-add");
    await waitFor(() => expect(listOrgMembers).toHaveBeenCalled());
    // Radix DropdownMenu 用 pointerdown 开菜单（同 guided-research-conversation-live.test.tsx 的开法）。
    fireEvent.pointerDown(screen.getByTestId("project-collaborators-add-user"), { button: 0, ctrlKey: false });
    fireEvent.click(await screen.findByText("吴桐"));
    fireEvent.click(screen.getByTestId("project-collaborators-add-submit"));
    await waitFor(() => expect(addNonWorkshopMember).toHaveBeenCalledWith({ projectId: "p1", userId: "u-wu", role: "collaborator" }));
    await waitFor(() => expect(listNonWorkshopMembers).toHaveBeenCalledTimes(2));
  });

  it("协作者视角：只读——档位是徽标，没有移出 / 指派控件，不拉组织名单", async () => {
    sessionUserId = "u-collab";
    render(<TabSettings view="facilitator" projectId="p1" projectKind="research_project" />);
    const row = await screen.findByTestId("project-collaborator-u-owner");
    expect(row).toHaveTextContent("负责人");
    expect(screen.queryByTestId("project-collaborator-remove-u-owner")).toBeNull();
    expect(screen.queryByTestId("project-collaborators-add")).toBeNull();
    expect(listOrgMembers).not.toHaveBeenCalled();
  });

  it("名单为空：显示空态并给指派控件（组织负责人 / 管理员加第一位）", async () => {
    sessionUserId = "u-lead";
    listNonWorkshopMembers.mockResolvedValue({ members: [] });
    render(<TabSettings view="facilitator" projectId="p1" projectKind="research_project" />);
    expect(await screen.findByTestId("project-collaborators-empty")).toHaveTextContent("第一位负责人");
    expect(screen.getByTestId("project-collaborators-add")).toBeInTheDocument();
  });

  it("观察者：整个面板不出现", () => {
    render(<TabSettings view="observer" projectId="p1" projectKind="research_project" />);
    expect(screen.queryByTestId("project-collaborators-panel")).toBeNull();
    expect(listNonWorkshopMembers).not.toHaveBeenCalled();
  });

  it("读名单 403 NO_PROJECT_ROLE 如实显示；写操作 403 PROJECT_ROLE_INSUFFICIENT 如实显示且名单不变", async () => {
    listNonWorkshopMembers.mockRejectedValueOnce(new ApiError(403, "NO_PROJECT_ROLE", {}));
    render(<TabSettings view="facilitator" projectId="p1" projectKind="research_project" />);
    expect(await screen.findByTestId("project-collaborators-error")).toHaveTextContent("不在这个容器的名单上");
  });

  it("写操作 403 PROJECT_ROLE_INSUFFICIENT 如实显示，名单不变；400（工作坊）说明换面板", async () => {
    removeNonWorkshopMember.mockRejectedValueOnce(new ApiError(403, "PROJECT_ROLE_INSUFFICIENT", {}));
    render(<TabSettings view="facilitator" projectId="p1" projectKind="research_project" />);
    await screen.findByTestId("project-collaborator-u-collab");
    fireEvent.click(screen.getByTestId("project-collaborator-remove-u-collab"));
    expect(await screen.findByTestId("project-collaborators-action-error")).toHaveTextContent("只有负责人");
    expect(screen.getByTestId("project-collaborator-u-collab")).toBeInTheDocument();

    removeNonWorkshopMember.mockRejectedValueOnce(new ApiError(400, null, {}));
    fireEvent.click(screen.getByTestId("project-collaborator-remove-u-collab"));
    await waitFor(() => expect(screen.getByTestId("project-collaborators-action-error")).toHaveTextContent("不支持协作者名单"));
  });
});

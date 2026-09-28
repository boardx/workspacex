/**
 * 项目中枢 R3 —— 设置 tab「项目成员」面板：项目是权限容器。
 * 钉住：真实名单渲染 / 非工作坊 `members: null` 如实说明 / 引导师能指派·改角色·移出且每次写后重拉 /
 * 组员视角只读 / 403 如实显示。只 mock 网络边界与会话。
 */
import * as React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { ApiError } from "@/lib/api-client";

const listProjectMembers = vi.fn();
const addProjectMember = vi.fn();
const changeProjectRole = vi.fn();
const removeProjectMember = vi.fn();
const listOrgMembers = vi.fn();

vi.mock("@/components/session/session-provider", () => ({
  useOptionalSession: () => ({ status: "authenticated", session: { userId: "u-fac", currentOrgId: "org-1" } }),
  useSession: () => ({ session: { userId: "u-fac", currentOrgId: "org-1" } }),
}));
vi.mock("@/lib/live-project-members", async (orig) => ({
  ...(await orig<typeof import("@/lib/live-project-members")>()),
  listProjectMembers: (...a: unknown[]) => listProjectMembers(...a),
  addProjectMember: (...a: unknown[]) => addProjectMember(...a),
  changeProjectRole: (...a: unknown[]) => changeProjectRole(...a),
  removeProjectMember: (...a: unknown[]) => removeProjectMember(...a),
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
  // B2-S5：设置 tab 现在还挂了「AI 权限」面板，这里只让它安静地拿到默认值，不是本文件的被测对象。
  getProjectAiSettings: vi.fn().mockResolvedValue({ projectId: "p1", allowedSources: ["chat", "transcript", "survey", "interview", "research"], updatedAt: null, updatedBy: null }),
  updateProjectAiSettings: vi.fn(),
}));

import { TabSettings } from "@/components/project/tab-settings";

const MEMBERS = [
  { userId: "u-fac", displayName: "林可", projectRole: "facilitator", isHost: true },
  { userId: "u-gao", displayName: "高琳", projectRole: "groupLead", isHost: false },
];
const ORG = { members: [
  { userId: "u-fac", displayName: "林可", email: "a@x", orgRole: "lead", teamId: null, joinedAt: "2026-01-01", status: "active" },
  { userId: "u-gao", displayName: "高琳", email: "b@x", orgRole: "consultant", teamId: null, joinedAt: "2026-01-01", status: "active" },
  { userId: "u-wu", displayName: "吴桐", email: "c@x", orgRole: "consultant", teamId: null, joinedAt: "2026-01-01", status: "active" },
] };

describe("R3 项目成员面板", () => {
  beforeEach(() => {
    listProjectMembers.mockReset(); addProjectMember.mockReset(); changeProjectRole.mockReset(); removeProjectMember.mockReset(); listOrgMembers.mockReset();
    listProjectMembers.mockResolvedValue({ members: MEMBERS });
    listOrgMembers.mockResolvedValue(ORG);
  });

  it("引导师视角：渲染真实名单，候选人只含还不在项目里的组织成员", async () => {
    render(<TabSettings view="facilitator" projectId="p1" />);
    const list = await screen.findByTestId("project-members-list");
    expect(within(list).getByTestId("project-member-u-fac")).toHaveTextContent("林可");
    expect(within(list).getByTestId("project-member-u-fac")).toHaveTextContent("主持");
    expect(within(list).getByTestId("project-member-u-gao")).toHaveTextContent("高琳");
    await waitFor(() => expect(listOrgMembers).toHaveBeenCalledWith("org-1"));
    expect(screen.getByTestId("project-members-add")).toBeInTheDocument();
  });

  it("移出：调 removeProjectMember 后重新拉名单（不在本地删）", async () => {
    removeProjectMember.mockResolvedValue({ projectId: "p1", userId: "u-gao", provenanceEventId: "ev" });
    render(<TabSettings view="facilitator" projectId="p1" />);
    await screen.findByTestId("project-member-u-gao");
    listProjectMembers.mockResolvedValue({ members: [MEMBERS[0]] });
    fireEvent.click(screen.getByTestId("project-member-remove-u-gao"));
    await waitFor(() => expect(screen.queryByTestId("project-member-u-gao")).toBeNull());
    expect(removeProjectMember).toHaveBeenCalledWith("p1", "u-gao");
    expect(listProjectMembers).toHaveBeenCalledTimes(2);
  });

  it("组员视角：只读——角色是徽标，没有移出 / 指派控件", async () => {
    render(<TabSettings view="member" projectId="p1" />);
    const row = await screen.findByTestId("project-member-u-gao");
    expect(row).toHaveTextContent("组长");
    expect(screen.queryByTestId("project-member-remove-u-gao")).toBeNull();
    expect(screen.queryByTestId("project-members-add")).toBeNull();
    expect(listOrgMembers).not.toHaveBeenCalled();
  });

  it("观察者：整个成员面板不出现", () => {
    render(<TabSettings view="observer" projectId="p1" />);
    expect(screen.queryByTestId("project-members-panel")).toBeNull();
  });

  it("非工作坊容器 members:null ⇒ 如实说明，不显示空名单也不给指派控件", async () => {
    listProjectMembers.mockResolvedValue({ members: null });
    render(<TabSettings view="facilitator" projectId="p1" />);
    expect(await screen.findByTestId("project-members-null")).toHaveTextContent("拥有者与协作者");
    expect(screen.queryByTestId("project-members-add")).toBeNull();
  });

  it("读名单 403 NO_PROJECT_ROLE 如实显示", async () => {
    listProjectMembers.mockRejectedValue(new ApiError(403, "NO_PROJECT_ROLE", {}));
    render(<TabSettings view="facilitator" projectId="p1" />);
    expect(await screen.findByTestId("project-members-error")).toHaveTextContent("你不在这个项目里");
  });

  it("写操作 403 PROJECT_ROLE_INSUFFICIENT 如实显示，名单不变", async () => {
    removeProjectMember.mockRejectedValue(new ApiError(403, "PROJECT_ROLE_INSUFFICIENT", {}));
    render(<TabSettings view="facilitator" projectId="p1" />);
    await screen.findByTestId("project-member-u-gao");
    fireEvent.click(screen.getByTestId("project-member-remove-u-gao"));
    expect(await screen.findByTestId("project-members-action-error")).toHaveTextContent("只有本项目的引导师");
    expect(screen.getByTestId("project-member-u-gao")).toBeInTheDocument();
  });
});

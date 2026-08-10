import * as React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ApiError } from "@/lib/api-client";

/**
 * #638 迭代 5 第二轮复核缺陷 A 的机械门（PR #896）——「任何表单提交都清 banner」。
 *
 * 假绿（绿色成功条与红色错误同屏）在邀请表单修过一次后，又在团队表单原样复发：
 * 建团队成功（绿「已创建」，4 秒窗口）→ 窗口内提交同名 → `TEAM_NAME_CONFLICT` 走
 * `setFieldError` 分支，父级 banner 没人清，红色字段错误与绿条同屏。
 *
 * 收敛后 banner 的单一事实源在 `components/org-admin/action-banner.tsx`
 * （`useActionBanner` + `ActionBanner`），但「提交动作开始时调用 `onReset()`」仍是
 * 每个表单自己的义务——所以这里对**每一个**接入 banner 的表单做同一条反证：
 * 成功 → 自动收起窗口内提交一个会走字段错误分支的输入 → 绿条必须已消失。
 * 新表单接入 banner 时，必须在这里加同样一条。
 */

const {
  listTeams, listOrgMembers, listOrgInvites, inviteOrgMember,
  resendOrgInvite, revokeOrgInvite, reviewAdminInvite, createTeam, deleteTeam, renameTeam,
  updateOrganization, uploadOrgAvatar,
} = vi.hoisted(() => ({
  listTeams: vi.fn(),
  listOrgMembers: vi.fn(),
  listOrgInvites: vi.fn(),
  inviteOrgMember: vi.fn(),
  resendOrgInvite: vi.fn(),
  revokeOrgInvite: vi.fn(),
  reviewAdminInvite: vi.fn(),
  createTeam: vi.fn(),
  deleteTeam: vi.fn(),
  renameTeam: vi.fn(),
  updateOrganization: vi.fn(),
  uploadOrgAvatar: vi.fn(),
}));

vi.mock("@/lib/live-org-admin", () => ({
  listTeams, listOrgMembers, listOrgInvites, inviteOrgMember,
  resendOrgInvite, revokeOrgInvite, reviewAdminInvite, createTeam, deleteTeam, renameTeam,
  updateOrganization, uploadOrgAvatar,
}));

vi.mock("@/components/session/session-provider", () => ({
  useSession: () => ({
    status: "authenticated",
    session: {
      sessionToken: "provider-bearer",
      currentOrgId: "org-1",
      userId: "user-admin",
      orgIds: ["org-1"],
      expiresAt: "2099-01-01T00:00:00.000Z",
    },
    identity: { orgRole: "admin" },
    error: null,
  }),
}));

vi.mock("@/components/shell/app-shell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

import { OrgAdminScreen } from "@/components/org-admin/org-admin-screen";

const TEAM = { teamId: "t1", name: "咨询一部", memberCount: 0 };

beforeEach(() => {
  vi.clearAllMocks();
  listTeams.mockResolvedValue({ teams: [TEAM] });
  listOrgInvites.mockResolvedValue({ invites: [] });
});

describe("建团队表单（默认首屏）：成功绿条不得与后续字段错误同屏", () => {
  it("建团队成功 → 4 秒窗口内提交同名（TEAM_NAME_CONFLICT）→ 绿「已创建」必须已消失", async () => {
    createTeam.mockResolvedValueOnce({ teamId: "t2" });
    render(<OrgAdminScreen />);
    await screen.findByTestId("org-admin-create-team-form");

    fireEvent.change(screen.getByTestId("org-admin-create-team-input"), { target: { value: "新团队" } });
    fireEvent.click(screen.getByTestId("org-admin-create-team"));
    const banner = await screen.findByTestId("org-admin-team-banner");
    expect(banner).toHaveTextContent("已创建");

    // 窗口内提交同名：走 setFieldError 分支，不经过父级 onFailed——历史上正是这条分支假绿。
    createTeam.mockRejectedValueOnce(new ApiError(409, "TEAM_NAME_CONFLICT", {}));
    fireEvent.change(screen.getByTestId("org-admin-create-team-input"), { target: { value: "咨询一部" } });
    fireEvent.click(screen.getByTestId("org-admin-create-team"));

    const err = await screen.findByTestId("err-team-name");
    expect(err).toHaveTextContent("已存在");
    expect(screen.queryByTestId("org-admin-team-banner")).toBeNull();
  });
});

describe("改名表单（TeamRow rename 分支）：同一条反证", () => {
  it("改名成功 → 窗口内再次改名撞 TEAM_NAME_CONFLICT → 绿「已改名」必须已消失", async () => {
    renameTeam.mockResolvedValueOnce({});
    render(<OrgAdminScreen />);
    await screen.findByTestId(`org-admin-team-${TEAM.teamId}`);

    // 第一次改名：成功，绿「已改名」。
    fireEvent.click(screen.getByTestId(`org-admin-team-${TEAM.teamId}-rename`));
    fireEvent.change(screen.getByTestId(`org-admin-team-${TEAM.teamId}-rename-input`), { target: { value: "咨询二部" } });
    fireEvent.click(screen.getByTestId(`org-admin-team-${TEAM.teamId}-rename-confirm`));
    const banner = await screen.findByTestId("org-admin-team-banner");
    expect(banner).toHaveTextContent("已改名");

    // 窗口内第二次改名：撞同名，走 setFieldError 分支。
    renameTeam.mockRejectedValueOnce(new ApiError(409, "TEAM_NAME_CONFLICT", {}));
    fireEvent.click(screen.getByTestId(`org-admin-team-${TEAM.teamId}-rename`));
    fireEvent.change(screen.getByTestId(`org-admin-team-${TEAM.teamId}-rename-input`), { target: { value: "已占用" } });
    fireEvent.click(screen.getByTestId(`org-admin-team-${TEAM.teamId}-rename-confirm`));

    const err = await screen.findByTestId("err-team-name");
    expect(err).toHaveTextContent("已存在");
    expect(screen.queryByTestId("org-admin-team-banner")).toBeNull();
  });
});

describe("邀请表单（邀请标签页）：同一条反证（首修处，防回退）", () => {
  it("邀请成功 → 窗口内提交已是成员的邮箱 → 绿条必须已消失", async () => {
    inviteOrgMember.mockResolvedValueOnce({ status: "pending", quotaReserved: 1 });
    render(<OrgAdminScreen />);
    const trigger = screen.getByTestId("org-admin-tab-invites");
    fireEvent.mouseDown(trigger, { button: 0 });
    fireEvent.click(trigger);
    await screen.findByTestId("org-admin-invite-form");

    fireEvent.change(screen.getByTestId("org-admin-invite-email"), { target: { value: "first@example.com" } });
    fireEvent.click(screen.getByTestId("org-admin-invite-submit"));
    await screen.findByTestId("org-admin-invite-banner");

    inviteOrgMember.mockRejectedValueOnce(new ApiError(409, "INVITE_ALREADY_MEMBER", {}));
    fireEvent.change(screen.getByTestId("org-admin-invite-email"), { target: { value: "member@example.com" } });
    fireEvent.click(screen.getByTestId("org-admin-invite-submit"));

    await screen.findByTestId("err-invite-email");
    await waitFor(() => expect(screen.queryByTestId("org-admin-invite-banner")).toBeNull());
  });
});

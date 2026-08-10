import * as React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ApiError } from "@/lib/api-client";

/**
 * #638 迭代 5 复核修复（PR #896 扣分项）—— 邀请表单的三条反证，每条钉一个真实翻过车的缺陷：
 *
 * ① **假绿**（评分卡第 5 条判 0）：成功一次后 8 秒 banner 窗口内提交一个已是成员的邮箱，
 *    绿色「邀请已创建」残留与红色「已是组织成员」**同屏**——管理员会据绿条误以为邀请发出去了。
 *    修法：`InviteMemberForm` 的 `onReset` 在每次提交动作开始时清 banner。
 * ② **浏览器原生英文气泡**（第 4 条判 0）：`type="email"` 的 constraint validation 先拦截，
 *    自己写的中文校验是死代码。修法：`<form noValidate>`，让中文错误落进 `err-invite-email`。
 * ③ **角色/团队不复位**：成功后只清邮箱，连续邀请会把上一位的「管理员」带给下一位。
 *
 * 附带钉一条顺手修复：「待复核」是中性在途态，徽标不得用 danger（红）。
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

const EMPTY_INVITES = { invites: [] };

async function renderInvitesTab() {
  render(<OrgAdminScreen />);
  // Radix TabsTrigger 在 mousedown 上做激活，jsdom 里单发 click 不够。
  const trigger = screen.getByTestId("org-admin-tab-invites");
  fireEvent.mouseDown(trigger, { button: 0 });
  fireEvent.click(trigger);
  await waitFor(() => expect(screen.getByTestId("org-admin-invite-form")).toBeInTheDocument());
  return screen.getByTestId("org-admin-invite-form") as HTMLFormElement;
}

function typeEmail(value: string) {
  fireEvent.change(screen.getByTestId("org-admin-invite-email"), { target: { value } });
}

function submit() {
  fireEvent.click(screen.getByTestId("org-admin-invite-submit"));
}

beforeEach(() => {
  vi.clearAllMocks();
  listTeams.mockResolvedValue({ teams: [{ teamId: "t1", name: "咨询一部", memberCount: 0 }] });
  listOrgInvites.mockResolvedValue(EMPTY_INVITES);
});

describe("反证① 假绿：失败时上一次的绿色成功 banner 必须已消失", () => {
  it("成功一次 → banner 窗口内提交已是成员的邮箱：只显示红色字段错误，绿色条不残留", async () => {
    inviteOrgMember.mockResolvedValueOnce({ status: "pending", quotaReserved: 1 });
    await renderInvitesTab();

    typeEmail("first@example.com");
    submit();
    // 绿色成功条出现（8 秒自动消失窗口开始）。
    const banner = await screen.findByTestId("org-admin-invite-banner");
    expect(banner).toHaveTextContent("邀请已创建");

    // 窗口内立刻再提交一个已是成员的邮箱——走 setFieldError 的那个分支（约 735 行）。
    inviteOrgMember.mockRejectedValueOnce(new ApiError(409, "INVITE_ALREADY_MEMBER", {}));
    typeEmail("member@example.com");
    submit();

    await screen.findByTestId("err-invite-email");
    expect(screen.getByTestId("err-invite-email")).toHaveTextContent("该邮箱已是组织成员");
    // 核心断言：绿色成功条已不在——不允许「绿色成功 + 红色错误」同屏。
    expect(screen.queryByTestId("org-admin-invite-banner")).toBeNull();
  });

  it("成功一次 → 提交无效邮箱（本地校验拦截）：绿色条同样被清掉", async () => {
    inviteOrgMember.mockResolvedValueOnce({ status: "pending", quotaReserved: 1 });
    await renderInvitesTab();

    typeEmail("first@example.com");
    submit();
    await screen.findByTestId("org-admin-invite-banner");

    typeEmail("not-an-email");
    submit();

    await screen.findByTestId("err-invite-email");
    expect(screen.queryByTestId("org-admin-invite-banner")).toBeNull();
  });
});

describe("反证② noValidate：中文校验真正执行，不再被浏览器原生气泡拦截", () => {
  it("表单声明了 noValidate（原生 constraint validation 关闭的直接证据）", async () => {
    const form = await renderInvitesTab();
    expect(form.noValidate).toBe(true);
  });

  it("提交无效邮箱 → 中文错误落进 err-invite-email（role=alert），且没有走网络", async () => {
    await renderInvitesTab();
    typeEmail("not-an-email");
    submit();

    const err = await screen.findByTestId("err-invite-email");
    expect(err).toHaveTextContent("「not-an-email」不是合法邮箱");
    expect(err).toHaveAttribute("role", "alert");
    expect(inviteOrgMember).not.toHaveBeenCalled();
  });
});

describe("反证②′ 邮箱校验与契约同源（第二轮复核缺陷 B：`a@` 曾能建出真实邀请）", () => {
  // 上轮手写校验只有 `includes("@")`，比被 noValidate 关掉的原生校验还弱：`a@` 落库
  // `org_invites`、占用配额。修法：复用 authContract.EmailAddress（z.string().email()），
  // 不在前端手写第二份正则。zod 的判定拒绝无点域名，所以 `a@b` 也被拦——如实钉住。
  it.each(["a@", "@b", "a@b", "not-an-email"])(
    "提交「%s」→ 中文字段错误，inviteOrgMember 零调用",
    async (bad) => {
      await renderInvitesTab();
      typeEmail(bad);
      submit();

      const err = await screen.findByTestId("err-invite-email");
      expect(err).toHaveTextContent(`「${bad}」不是合法邮箱`);
      expect(inviteOrgMember).not.toHaveBeenCalled();
    },
  );

  it("合法邮箱 name@example.com 正常通过并发出请求", async () => {
    inviteOrgMember.mockResolvedValueOnce({ status: "pending", quotaReserved: 1 });
    await renderInvitesTab();
    typeEmail("name@example.com");
    submit();

    await screen.findByTestId("org-admin-invite-banner");
    expect(inviteOrgMember).toHaveBeenCalledWith(
      expect.objectContaining({ email: "name@example.com" }),
    );
    expect(screen.queryByTestId("err-invite-email")).toBeNull();
  });
});

describe("反证③ 成功后整表复位：邮箱、角色、团队都回到默认值", () => {
  it("选了管理员 + 指定团队并成功提交后，角色回「顾问」、团队回「不分团队」、邮箱清空", async () => {
    inviteOrgMember.mockResolvedValueOnce({ status: "awaiting-review", quotaReserved: 1 });
    await renderInvitesTab();
    // 等团队列表回来（回来前团队下拉 disabled）。
    await waitFor(() => expect(screen.getByTestId("org-admin-invite-team")).toBeEnabled());

    // 改角色 → 管理员
    fireEvent.click(screen.getByTestId("org-admin-invite-role"));
    fireEvent.click(screen.getByTestId("org-admin-invite-role-option-admin"));
    expect(screen.getByTestId("org-admin-invite-role")).toHaveTextContent("管理员");
    // 改团队 → 咨询一部
    fireEvent.click(screen.getByTestId("org-admin-invite-team"));
    fireEvent.click(screen.getByTestId("org-admin-invite-team-option-t1"));
    expect(screen.getByTestId("org-admin-invite-team")).toHaveTextContent("咨询一部");

    typeEmail("next-admin@example.com");
    submit();
    await screen.findByTestId("org-admin-invite-banner");

    // 提交参数确实带的是管理员 + t1（不是断言了个从没生效的选择）。
    expect(inviteOrgMember).toHaveBeenCalledWith({
      orgId: "org-1", email: "next-admin@example.com", orgRole: "admin", teamId: "t1",
    });

    // 复位：三个字段都回默认，连续邀请不会把上一位的「管理员」带给下一位。
    expect(screen.getByTestId("org-admin-invite-email")).toHaveValue("");
    expect(screen.getByTestId("org-admin-invite-role")).toHaveTextContent("顾问");
    expect(screen.getByTestId("org-admin-invite-team")).toHaveTextContent("不分团队");
  });
});

describe("顺手修复：「待复核」徽标是中性在途态，不得用 danger（红）", () => {
  it("awaiting-review 行的徽标用 neutral（bg-muted），send-failed 仍是 danger", async () => {
    listOrgInvites.mockResolvedValue({
      invites: [
        {
          inviteId: "inv-1", email: "review-me@example.com", status: "awaiting-review",
          invitedBy: "某管理员", expiresAt: "2099-01-01T00:00:00.000Z",
        },
        {
          inviteId: "inv-2", email: "failed@example.com", status: "send-failed",
          invitedBy: "某管理员", expiresAt: "2099-01-01T00:00:00.000Z",
        },
      ],
    });
    await renderInvitesTab();

    const row1 = await screen.findByTestId("org-admin-invite-inv-1");
    expect(row1.querySelector(".bg-muted")).toHaveTextContent("待复核");
    expect(row1.querySelector(".bg-destructive")).toBeNull();

    const row2 = screen.getByTestId("org-admin-invite-inv-2");
    expect(row2.querySelector(".bg-destructive")).toHaveTextContent("发送失败");
  });
});

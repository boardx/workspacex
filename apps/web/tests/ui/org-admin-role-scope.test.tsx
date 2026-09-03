/**
 * org-admin 视角切换器 & 后台可达门禁 —— PROTOTYPE-FIDELITY-AUDIT-2.md 「问题 1」复核
 * （2026-08-11）。
 *
 * 复核结论：问题仍然成立。`org-admin-app.tsx` 曾对全部七屏统一注入项目角色
 * （`引导师/组长/组员/观察者`）视角，`members-screen.tsx` 还用它近似判定「后台可达」。
 * `members` / `activate` / `boundary` 三屏是组织级（UC-1.6 / UC-1.4 载体三），原型里
 * 这一区通篇没有项目角色命中——继续显示这条「视角」预览行，会与顶栏
 * 「不在项目上下文中 · 项目角色不适用」同屏矛盾。
 *
 * 断言选的是「会错的那几件」：
 *   ① 组织级三屏（members/activate/boundary）不再渲染项目角色「视角」切换器；
 *   ② 项目级四屏（invites/roster/roles/grant）仍然渲染，说明不是简单粗暴地全砍；
 *   ③ `MembersScreen` 的后台可达（`canAdmin`）现在由组织角色（`orgRole === "admin"`）
 *      判定——传「顾问」组织角色时邀请按钮应禁用，传「管理员」组织角色时应可点。
 */
import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

// `/org-admin/preview` 不在 `resolveProjectContext` 的项目路由表里（这正是本测试要验证的
// 前提之一——见 `lib/project-context.ts`），所以顶栏 `usePathname()` 需要一个真实字符串。
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/org-admin/preview",
  useSearchParams: () => new URLSearchParams(),
}));

import { OrgAdminApp } from "@/components/org-admin/org-admin-app";
import { MembersScreen } from "@/components/org-admin/members-screen";
import { RolesScreen } from "@/components/org-admin/roles-screen";
import { ActivateScreen } from "@/components/org-admin/activate-screen";
import { mockIdentity } from "@/lib/identity";
import { ORG_ADMIN_ORG_LEVEL_SCREENS, ORG_ADMIN_SCREENS } from "@/lib/mock/org-admin";

describe("org-admin 组织级屏不再挂项目角色视角切换器", () => {
  it("① members / activate / boundary 三屏隐藏「视角」行，改显组织级说明", () => {
    for (const s of ORG_ADMIN_SCREENS.filter((x) => ORG_ADMIN_ORG_LEVEL_SCREENS.has(x))) {
      const identity = mockIdentity("org-yuanyang", "facilitator");
      const { unmount } = render(
        <OrgAdminApp identity={identity} previewRole="facilitator" uiState="default" screen={s} qs={{ as: "facilitator" }} />,
      );
      expect(screen.queryByTestId("org-admin-role-switch")).toBeNull();
      expect(screen.getByTestId("org-admin-role-row-na")).toHaveTextContent("组织级屏");
      unmount();
    }
  });

  it("② invites / roster / roles / grant 四个项目级屏仍然渲染项目角色「视角」行", () => {
    for (const s of ORG_ADMIN_SCREENS.filter((x) => !ORG_ADMIN_ORG_LEVEL_SCREENS.has(x))) {
      const identity = mockIdentity("org-yuanyang", "facilitator");
      const { unmount } = render(
        <OrgAdminApp identity={identity} previewRole="facilitator" uiState="default" screen={s} qs={{ as: "facilitator" }} />,
      );
      expect(screen.queryAllByTestId("org-admin-role-switch").length).toBeGreaterThan(0);
      expect(screen.queryByTestId("org-admin-role-row-na")).toBeNull();
      unmount();
    }
  });
});

describe("MembersScreen 后台可达由组织角色判定，不再由项目角色近似", () => {
  it("③ orgRole=consultant（顾问）时邀请按钮禁用；orgRole=admin 时可点", () => {
    const { unmount } = render(<MembersScreen state="default" orgRole="consultant" />);
    expect(screen.getByTestId("members-invite-open")).toBeDisabled();
    unmount();

    render(<MembersScreen state="default" orgRole="admin" />);
    expect(screen.getByTestId("members-invite-open")).not.toBeDisabled();
  });

  it("④ 客户方（外部）成员在成员表上带一个可见的「客户方 · 外部」标签", () => {
    render(<MembersScreen state="default" orgRole="admin" />);
    expect(screen.getAllByTestId("members-external-tag").length).toBeGreaterThan(0);
  });
});

/**
 * issue #2622 反证：`/org-admin/preview` 不再有任何组织级"团队"痕迹。
 *
 * 只靠 `tests/ui` 整体回归绿不足以证明——回归套件里没有任何用例专门断言这些元素
 * "不存在"，误把团队区块加回来也不会让既有测试变红。这里逐个钉住 PR #2623 声称
 * 删除的每一处：团队增删改区块本身、成员行/审批队列的团队展示、邀请弹层团队选择器、
 * 角色说明条的团队展示、激活上下文的团队展示。
 */
describe("issue #2622 反证：preview 三屏不再渲染任何团队相关元素", () => {
  it("① MembersScreen：团队增删改区块、成员行/审批队列团队展示、邀请弹层团队选择器均不存在", () => {
    render(<MembersScreen state="default" orgRole="admin" />);
    // 团队增删改区块（新建/改名/删除 + 占用校验弹层）整体不存在
    expect(screen.queryByTestId("members-teams")).toBeNull();
    expect(screen.queryByTestId("members-team-add")).toBeNull();
    expect(screen.queryAllByTestId("members-team-row").length).toBe(0);
    expect(screen.queryAllByTestId("members-team-rename").length).toBe(0);
    expect(screen.queryAllByTestId("members-team-delete").length).toBe(0);
    expect(screen.queryByTestId("members-team-delete-dialog")).toBeNull();
    // 成员表标题不再提"团队"，行内也不再渲染任何团队名（数据仍带 team 字段，只是不显示）
    const membersTable = screen.getByTestId("members-table");
    expect(membersTable).not.toHaveTextContent("团队");
    for (const teamName of ["能源组", "平台组", "供应链组"]) {
      expect(membersTable).not.toHaveTextContent(teamName);
    }
    // 审批队列行不再带团队展示（不再出现任何一个团队名）
    const approvalQueue = screen.getByTestId("members-approval-queue");
    for (const teamName of ["能源组", "平台组", "供应链组"]) {
      expect(approvalQueue).not.toHaveTextContent(teamName);
    }

    fireEvent.click(screen.getByTestId("members-invite-open"));
    // 邀请弹层没有团队选择器
    expect(screen.queryByTestId("members-invite-team")).toBeNull();
    expect(screen.queryAllByTestId("members-invite-team-option").length).toBe(0);
    expect(screen.getByTestId("members-invite-dialog")).not.toHaveTextContent("团队");
  });

  it("② RolesScreen：顶部角色说明条不再展示团队", () => {
    render(<RolesScreen state="default" previewRole="groupLead" href={() => "#"} />);
    expect(screen.getByTestId("roles-role-bar-text")).not.toHaveTextContent("团队");
  });

  it("③ ActivateScreen：激活上下文卡片不再展示团队", () => {
    render(<ActivateScreen state="default" />);
    expect(screen.getByTestId("activate-context")).not.toHaveTextContent("团队");
    expect(screen.getByTestId("activate-tamper-note")).not.toHaveTextContent("团队");
  });
});

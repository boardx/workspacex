/**
 * F10 的界面一半：**后台成员表上的待激活行**（UC-1.6）。
 *
 * 锚在**已建成**的那块屏（`/admin/members` 的 `admin-members-list`），
 * 不是 `/org-admin/preview` 下的 mock 原型。两者在这个仓库里并存，
 * 而 `contracts/org-admin/ui.md` 2.2 #17 把「待激活行 + [重发]」记为**未建**——
 * 本 feature 建的就是它。
 *
 * ## 断言选的是「会错的那几件」，不是「看得见的所有东西」
 *
 *   ① 待激活的人**已经带着角色与团队**（不是「等激活了再指派」）——这是
 *      `user_visible_behavior` 里「入场即带」在界面上的样子。
 *   ② 「计入名册、不计入活跃成员」两个数**同时**出现且不相等。只渲染一个数的话，
 *      「把待激活也算成活跃」这个错误在界面上完全看不出来。
 *   ③ `send-failed` / `expired` / `revoked` 三种也在表上。只列 `pending` 会让
 *      一条发送失败的邀请从界面消失，而它在库里还占着名额。
 *   ④ 每一条待激活行都有 `[重发]`，已激活的行没有。
 */
import { describe, it, expect } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { MembersScreen } from "@/components/admin/members-screen";
import { ORG_MEMBERS, ORG_MEMBER_ACTIVE, ORG_MEMBER_TOTAL, MEMBER_STATUS_LABEL } from "@/lib/mock/org-admin";
import { ORG_ROLE_LABEL } from "@/lib/identity";

const PENDING = ORG_MEMBERS.filter((m) => m.status !== "active");

function renderScreen() {
  render(<MembersScreen state="default" />);
  return screen.getByTestId("admin-members-list");
}

describe("成员表：待激活行 —— 入场即带组织角色 + 团队", () => {
  it("① 每一条待激活行都渲染了它被指派的角色与团队，并标着（待激活）", () => {
    const list = renderScreen();
    // 名单里确实有非 active 的人，否则下面的循环会在零次迭代下全绿。
    expect(PENDING.length).toBeGreaterThan(0);

    for (const m of PENDING) {
      const row = within(list).getByTestId(`admin-member-pending-${m.id}`);
      expect(row).toHaveTextContent(m.name);
      // 角色 + 「（待激活）」在同一行里同时可见：他已经被指派了，只是还没进场。
      expect(row).toHaveTextContent(`${ORG_ROLE_LABEL[m.role]}（待激活）`);
      expect(row).toHaveTextContent(m.team);
    }
  });

  it("② 名册数与活跃数同时出现且不相等（待激活计入名册、不计入活跃）", () => {
    const list = renderScreen();
    const counts = within(list).getByTestId("admin-members-roster-count");
    expect(counts).toHaveTextContent(String(ORG_MEMBER_TOTAL));
    expect(counts).toHaveTextContent(String(ORG_MEMBER_ACTIVE));
    // 两个数相等的那一天，这块屏就不再表达「待激活不计入活跃」这件事了。
    expect(ORG_MEMBER_ACTIVE).toBeLessThan(ORG_MEMBER_TOTAL);
  });

  it("③ 四种未进场状态都在表上，不只是 pending", () => {
    const list = renderScreen();
    for (const status of new Set(PENDING.map((m) => m.status))) {
      const badge = within(list).getAllByTestId(`admin-member-status-${status}`);
      expect(badge.length).toBeGreaterThan(0);
      expect(badge[0]).toHaveTextContent(MEMBER_STATUS_LABEL[status]);
    }
    // 「已发送 N 天」是 UC 里逐字要求的那一项。
    const withDays = PENDING.find((m) => m.status === "pending" && m.sentDays);
    expect(withDays).toBeDefined();
    expect(within(list).getByTestId(`admin-member-pending-${withDays!.id}`)).toHaveTextContent(
      `已发送 ${withDays!.sentDays} 天`,
    );
  });

  it("④ 待激活行有 [重发]；已激活的成员行没有", () => {
    const list = renderScreen();
    for (const m of PENDING) {
      expect(within(list).getByTestId(`admin-member-resend-${m.id}`)).toBeInTheDocument();
    }
    for (const m of ORG_MEMBERS.filter((x) => x.status === "active")) {
      expect(within(list).queryByTestId(`admin-member-resend-${m.id}`)).toBeNull();
      expect(within(list).queryByTestId(`admin-member-pending-${m.id}`)).toBeNull();
    }
  });
});

describe("[邀请成员] 入口：填邮箱 + 指派组织角色 + 团队", () => {
  it("入口在成员表上；点开后邮箱、角色三选、团队三样都在", () => {
    const list = renderScreen();

    const open = within(list).getByTestId("admin-members-invite-open");
    // 弹层是点开才有的：一上来就渲染，等于这个入口没有在做任何事。
    expect(screen.queryByTestId("admin-members-invite-dialog")).toBeNull();

    fireEvent.click(open);
    const dialog = screen.getByTestId("admin-members-invite-dialog");
    expect(within(dialog).getByTestId("admin-members-invite-email")).toBeInTheDocument();
    expect(within(dialog).getByTestId("admin-members-invite-role")).toBeInTheDocument();
    expect(within(dialog).getByTestId("admin-members-invite-team")).toBeInTheDocument();
  });

  it("选「管理员」时屏上出现双人复核的告知（O-28 ⑥），选顾问时没有", () => {
    const list = renderScreen();
    fireEvent.click(within(list).getByTestId("admin-members-invite-open"));

    const dialog = screen.getByTestId("admin-members-invite-dialog");
    expect(within(dialog).queryByTestId("admin-members-invite-admin-warn")).toBeNull();

    fireEvent.click(within(dialog).getByTestId("admin-members-invite-role-admin"));
    const warn = within(dialog).getByTestId("admin-members-invite-admin-warn");
    // 「不可自批」与「不退化为单人可批」是 O-28 ⑥ 的两句话，缺一句规则就形同虚设。
    expect(warn).toHaveTextContent("发起人不可自批");
    expect(warn).toHaveTextContent("不退化为单人可批");

    fireEvent.click(within(dialog).getByTestId("admin-members-invite-role-consultant"));
    expect(within(dialog).queryByTestId("admin-members-invite-admin-warn")).toBeNull();
  });
});

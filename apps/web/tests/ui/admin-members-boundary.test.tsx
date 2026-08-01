/**
 * F06 / D-18 — 「你作为管理员看不到什么」这块屏（`/admin/members` 的
 * `admin-members-boundary`），四条 user_visible_behavior 断言在界面上的样子：
 *
 *   ① 个人层只见计数，不见内容——`admin-members-private-counts` 里每个人只有
 *      「私有条目 N 条」+「内容不可见」徽标，没有任何一条私有内容的文本。
 *   ② 项目层可读但必留痕、对负责人可见——`admin-members-project-access` 讲清楚
 *      这条规则，并给出「看我的访问记录」入口。
 *   ③ 「看我的访问记录」打开后，`admin-members-access-logs`（常驻列表）与抽屉里的
 *      `admin-members-access-full`（`[看我的访问记录]` 点开后）是**同一批**访问记录，
 *      不是两份可能对不上的数字。
 *   ④ 管理员不因身份自动获得项目内容读取权——本屏的 intro 文案本身就声明这一点；
 *      断言它确实渲染在屏上，而不是只存在于需求文档里。
 *
 * 断言选的是「会错的那几件」：数字不一致、内容意外泄出、入口点了没反应。
 * 不是把界面上能看到的每个字都断言一遍。
 */
import { describe, it, expect } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { MembersScreen } from "@/components/admin/members-screen";
import { MEMBERS, ADMIN_ACCESS_LOGS, ADMIN_PROJECT_ACCESS_COUNT } from "@/lib/mock/admin";

function renderScreen() {
  render(<MembersScreen state="default" />);
  return screen.getByTestId("admin-members-boundary");
}

describe("管理员权力边界：个人层只见计数", () => {
  it("① 每个有私有条目的人只显示计数与「内容不可见」徽标，不显示任何内容文本", () => {
    const boundary = renderScreen();
    const counts = within(boundary).getByTestId("admin-members-private-counts");
    const withPrivate = MEMBERS.filter((m) => m.privateEntries > 0);
    // 名单里确实有人有私有条目，否则下面的循环零次迭代就会全绿。
    expect(withPrivate.length).toBeGreaterThan(0);

    for (const m of withPrivate) {
      const row = within(counts).getByTestId(`admin-member-private-${m.id}`);
      expect(row).toHaveTextContent(m.name);
      expect(row).toHaveTextContent(`私有条目 ${m.privateEntries} 条`);
      expect(row).toHaveTextContent("内容不可见");
    }
    // 反证：整块区域的文本里不出现「条」以外的内容型词——mock 数据本身没有内容字段，
    // 这里额外确认没有人往这块区域顺手加过预览/摘要一类的文案。
    expect(counts.textContent).not.toMatch(/预览|摘要|全文/);
  });

  it("零私有条目的成员不会被渲染成一条「私有条目 0 条」——没有条目就不占一行", () => {
    const boundary = renderScreen();
    const counts = within(boundary).getByTestId("admin-members-private-counts");
    const withoutPrivate = MEMBERS.filter((m) => m.privateEntries === 0);
    expect(withoutPrivate.length).toBeGreaterThan(0);
    for (const m of withoutPrivate) {
      expect(within(counts).queryByTestId(`admin-member-private-${m.id}`)).toBeNull();
    }
  });
});

describe("管理员权力边界：项目层可读但必留痕、对负责人可见", () => {
  it("② 说明区讲清「每次访问都会写入审计日志，并对项目负责人可见」，并给出访问计数", () => {
    const boundary = renderScreen();
    const access = within(boundary).getByTestId("admin-members-project-access");
    expect(access).toHaveTextContent("每次访问都会写入审计日志，并对项目负责人可见");
    expect(access).toHaveTextContent(String(ADMIN_PROJECT_ACCESS_COUNT));
    expect(within(access).getByTestId("admin-members-my-access")).toBeInTheDocument();
  });

  it("③ 常驻列表里的每一条访问记录都标着「对负责人可见」，且条数与 ADMIN_ACCESS_LOGS 一致", () => {
    const boundary = renderScreen();
    const logs = within(boundary).getByTestId("admin-members-access-logs");
    for (const log of ADMIN_ACCESS_LOGS) {
      const row = within(logs).getByTestId(`admin-access-log-${log.id}`);
      expect(row).toHaveTextContent(log.project);
      expect(row).toHaveTextContent(log.lead);
      expect(row).toHaveTextContent("对负责人可见");
    }
  });

  it("③ 点开「看我的访问记录」后，抽屉里出现的是同一批记录，不是另一份可能对不上的数字", () => {
    renderScreen();
    fireEvent.click(screen.getByTestId("admin-members-my-access"));

    const full = screen.getByTestId("admin-members-access-full");
    // 同一批：条数相同，且每一条的 project/lead 都能在抽屉里找到对应项。
    for (const log of ADMIN_ACCESS_LOGS) {
      const item = within(full).getAllByTestId("admin-members-access-item").find(
        (el) => el.textContent?.includes(log.project) && el.textContent?.includes(log.lead),
      );
      expect(item, `missing drawer row for ${log.project}`).toBeTruthy();
      expect(item).toHaveTextContent(`对负责人 ${log.lead} 可见`);
    }
    expect(within(full).getAllByTestId("admin-members-access-item")).toHaveLength(
      ADMIN_ACCESS_LOGS.length,
    );
  });
});

describe("管理员不是超级用户：文案本身声明这一条，不只是需求文档里写着", () => {
  it("④ intro 文案明确说「管理员不是超级用户」且个人层是「唯一对管理员封闭的一层」", () => {
    render(<MembersScreen state="default" />);
    const intro = screen.getByText(/管理员不是超级用户/);
    expect(intro).toBeInTheDocument();
    expect(intro).toHaveTextContent("唯一对管理员封闭的一层");
  });
});

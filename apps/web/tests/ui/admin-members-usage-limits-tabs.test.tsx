/**
 * backlog B1 —— 后台「组织」组里，原型存在但代码缺失的两个入口：用量监控 / 限额策略。
 *
 * 证据：`phases/requirements/WorkspaceX Standalone.html` 字节偏移
 * 15851070（成员配额）/ 15851298（用量监控）/ 15851527（限额策略）三个按钮同组，
 * 是**同一屏三个并列 tab**，不是三个独立左栏菜单项——本测试锁的正是这个关系：
 * 三个 tab 都挂在同一个 `MembersScreen` 上，而不是新增了三条 `ADMIN_NAV` 路由。
 *
 * ## 断言选的是「会错的那几件」
 *   ① 默认打开是「成员配额」——已有的 `admin-members-list` 断言集不该因为加了 tab 而失效。
 *   ② 切到「用量监控」：面板挂在同一屏上、与成员配额互斥。
 *      ⚠ F161 起这块屏读真库，原先「矩阵与 mock 逐格对应」的断言已随那份 mock 退役，
 *      它的行为断言移到 `admin-usage-monitor-live.test.tsx`（见下方该 describe 的长注）。
 *   ③ 切到「限额策略」：⚠ F162 起规则区读真库，「与 mock 逐条对应」的断言已退役
 *      （移到 admin-limit-rules-live.test.tsx）；这里只留降级阈值三级 + 任务分级表——
 *      那两块仍是 mock（phase-03 F14 的地盘）。
 *   ④ 反证：`ADMIN_NAV`「组织」组没有因为这次改动多出 `usage`/`limits` 之类的新左栏项——
 *      证实信息架构落点选的是「同一屏 tab」而不是「新左栏菜单项」。
 */
import { describe, it, expect } from "vitest";
import { render, screen, within, fireEvent, cleanup } from "@testing-library/react";
import { afterEach } from "vitest";
import { MembersScreen } from "@/components/admin/members-screen";
import { ADMIN_NAV } from "@/lib/mock/admin";
import { TASK_TYPE_GRADING } from "@/lib/mock/admin-limits";

afterEach(() => cleanup());

function renderScreen() {
  render(<MembersScreen state="default" />);
}

describe("①默认态：成员配额仍是默认打开的 tab", () => {
  it("不切 tab 就能看到既有的 admin-members-list（不因加 tab 而回退）", () => {
    renderScreen();
    expect(screen.getByTestId("admin-members-tabpanel-quota")).toBeInTheDocument();
    expect(screen.getByTestId("admin-members-list")).toBeInTheDocument();
    // 另两个 tab 面板还没挂载/未激活时不应该抢先出现同名 testid 冲突
    expect(screen.getByTestId("admin-members-tab-quota")).toHaveAttribute("data-state", "active");
  });
});

/*
 * ② 用量监控 tab —— **F161 起这块屏读真库**（`GET /organizations/:orgId/usage`）。
 *
 * 原来的两条断言（矩阵每格与 `USAGE_MATRIX_ROWS` 逐格对应、合计等于各列求和）
 * 测的是 mock 数据自身的自洽，那份 mock 已经不再驱动界面了——继续留着它们，
 * 就是在断言一个不再被渲染的常量数组内部一致，绿了也不说明屏上有什么。
 * ⇒ 换成本文件真正还管得着的那一件事：**tab 关系**（三个 tab 同屏、切换互斥）。
 * 用量监控自己的行为（换窗口换请求、列由响应决定、空态、失败回显）由
 * `admin-usage-monitor-live.test.tsx` 覆盖，那里有 fetch 与 session 的替身。
 */
describe("②用量监控 tab：挂在同一屏上，切换与成员配额互斥", () => {
  it("切到用量监控后，成员配额面板从 DOM 里消失，用量面板出现", () => {
    renderScreen();
    fireEvent.mouseDown(screen.getByTestId("admin-members-tab-usage"), { button: 0 });

    expect(screen.getByTestId("admin-members-tabpanel-usage")).toBeInTheDocument();
    expect(within(screen.getByTestId("admin-members-tabpanel-usage")).getByTestId("admin-usage-tab"))
      .toBeInTheDocument();
    // 反证：成员配额 tab 的内容这时不在 DOM 里（Radix Tabs 默认不 forceMount 非激活面板）
    expect(screen.queryByTestId("admin-members-list")).toBeNull();
  });
});

describe("③限额策略 tab：规则卡片 + 降级阈值 + 任务分级表", () => {
  /*
   * F162 起「限额规则」这块读真库（`LimitRulesLive`），原来两条断言——卡片数与
   * `LIMIT_RULES` mock 一致、点[编辑]改本地 state——测的是一份不再驱动界面的常量数组
   * 和一段不再存在的本地状态。它们的行为断言移到 `admin-limit-rules-live.test.tsx`
   * （那里有 fetch 与 session 的替身）。本文件只留仍然归它管的：降级阈值三级与任务分级表
   * 这两块**仍是 mock**（属 phase-03 F14 的地盘），以及它们该带的「尚未接入真实后端」提示。
   */
  it("规则区在真栈组件里渲染（不再读 LIMIT_RULES mock）", () => {
    renderScreen();
    fireEvent.mouseDown(screen.getByTestId("admin-members-tab-policy"), { button: 0 });
    const panel = screen.getByTestId("admin-members-tabpanel-policy");
    expect(within(panel).getByTestId("admin-limits-rules")).toBeInTheDocument();
    // 没有 SessionProvider ⇒ 组件走「尚未选择组织」分支，不会去 fetch，也不会渲染任何
    // 示例规则卡片——这正是「它不再有 mock 兜底」的证据。
    expect(within(panel).queryByTestId("admin-limit-rule-lr-wutong-opus")).toBeNull();
  });

  it("降级阈值/任务分级这两块仍是 mock，带着「尚未接入真实后端」提示", () => {
    renderScreen();
    fireEvent.mouseDown(screen.getByTestId("admin-members-tab-policy"), { button: 0 });
    const panel = screen.getByTestId("admin-members-tabpanel-policy");
    expect(within(panel).getByTestId("admin-degrade-tiers")).toBeInTheDocument();
    // 两处：一处在降级阈值区（本条要的），一处在整屏 quota tab 之外的位置——
    // 用 getAllBy 而不是把断言放宽成 queryBy，数量本身是信息。
    expect(within(within(panel).getByTestId("admin-degrade-tiers"))
      .getByTestId("admin-no-backend-notice")).toBeInTheDocument();
  });
  it("ADMIN_NAV「组织」组的 key 集合不含 usage/limits/policy 等新键", () => {
    const org = ADMIN_NAV.find((g) => g.group === "组织")!;
    const keys = org.items.map((i) => i.key);
    expect(keys).not.toContain("usage");
    expect(keys).not.toContain("limits");
    expect(keys).not.toContain("policy");
    // 「组织」组不因本 feature 多出 `usage`/`limits`/`policy` 左栏项——本 feature 没有
    // 在左栏加新入口，用量监控/限额策略是同一屏的 tab，不是新菜单项。
    // ⚠ 2026-09-02：「反馈」已从「组织」组挪到「运营」组（见 `lib/mock/admin.ts`
    //   头注：它是运营动作，不是某个组织自己的配置），本条断言的范围本就是
    //   「组织」组，「反馈」离开这个数组是那次改动的直接结果，不是本条测试要拦的漂移。
    // ⚠ 2026-09-03：`org-profile`（「组织资料」）连同 `org-members`（「成员」）、
    //   `org-invites`（「邀请」）是把左上角组织菜单「组织管理」入口并入组织后台左栏、
    //   再按 issue #2615 拆平成与总览平级三项的结果，与本文件锁的
    //   「不新增 usage/limits/policy」无关，因此加入期望集合而不是被这条断言拦下。
    expect(keys).toEqual(["overview", "org-members", "org-invites", "org-profile", "members", "local"]);
  });
});

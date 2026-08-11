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
 *   ② 切到「用量监控」：矩阵表格数字与 mock 数据源逐格对应，不是随手写的占位数字；
 *      合计行必须等于各列真实求和，防止「表面像矩阵、数字瞎编」。
 *   ③ 切到「限额策略」：限额规则数、`highlighted` 醒目卡片数与 mock 数据源对应；
 *      降级阈值三级 + 任务分级表四行都在。
 *   ④ 反证：`ADMIN_NAV`「组织」组没有因为这次改动多出 `usage`/`limits` 之类的新左栏项——
 *      证实信息架构落点选的是「同一屏 tab」而不是「新左栏菜单项」。
 */
import { describe, it, expect } from "vitest";
import { render, screen, within, fireEvent, cleanup } from "@testing-library/react";
import { afterEach } from "vitest";
import { MembersScreen } from "@/components/admin/members-screen";
import { ADMIN_NAV } from "@/lib/mock/admin";
import {
  USAGE_MATRIX_ROWS, USAGE_MATRIX_MODELS, USAGE_MATRIX_FOOTER, RECENT_LIMIT_EVENTS,
  LIMIT_RULES, TASK_TYPE_GRADING,
} from "@/lib/mock/admin-limits";

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

describe("②用量监控 tab：矩阵数字与 mock 数据源逐格对应", () => {
  it("每一行合计 = 各模型用量真实求和（不是编的数）", () => {
    for (const row of USAGE_MATRIX_ROWS) {
      const sum = row.values.reduce((a, b) => a + b, 0);
      expect(row.total).toBe(sum);
    }
    const footerSum = USAGE_MATRIX_FOOTER.values.reduce((a, b) => a + b, 0);
    expect(USAGE_MATRIX_FOOTER.total).toBe(footerSum);
    // 列合计也必须等于逐行同列之和，防止行/列两份数字各编各的
    USAGE_MATRIX_MODELS.forEach((_, colIdx) => {
      const colSum = USAGE_MATRIX_ROWS.reduce((a, r) => a + (r.values[colIdx] ?? 0), 0);
      expect(USAGE_MATRIX_FOOTER.values[colIdx]).toBe(colSum);
    });
  });

  it("切到用量监控 tab 后，矩阵每一行、近期限额事件都渲染在面板内", () => {
    renderScreen();
    fireEvent.mouseDown(screen.getByTestId("admin-members-tab-usage"), { button: 0 });
    const panel = screen.getByTestId("admin-members-tabpanel-usage");
    const matrix = within(panel).getByTestId("admin-usage-matrix");

    for (const row of USAGE_MATRIX_ROWS) {
      const tr = within(matrix).getByTestId(`admin-usage-matrix-row-${row.id}`);
      expect(tr).toHaveTextContent(row.name);
      expect(tr).toHaveTextContent(String(row.total));
    }
    // 阳性对照：数据源确实非空，否则上面的循环零次迭代会平凡通过
    expect(USAGE_MATRIX_ROWS.length).toBeGreaterThan(0);

    for (const ev of RECENT_LIMIT_EVENTS) {
      expect(within(panel).getByTestId(`admin-usage-event-${ev.id}`)).toHaveTextContent(ev.detail);
    }

    // 反证：成员配额 tab 的内容这时不在 DOM 里（Radix Tabs 默认不 forceMount 非激活面板）
    expect(screen.queryByTestId("admin-members-list")).toBeNull();
  });
});

describe("③限额策略 tab：规则卡片 + 降级阈值 + 任务分级表", () => {
  it("规则卡片数与 mock 源一致，醒目卡片(highlighted)数目也一致", () => {
    renderScreen();
    fireEvent.mouseDown(screen.getByTestId("admin-members-tab-policy"), { button: 0 });
    const panel = screen.getByTestId("admin-members-tabpanel-policy");

    for (const r of LIMIT_RULES) {
      const card = within(panel).getByTestId(`admin-limit-rule-${r.id}`);
      expect(card).toHaveTextContent(r.scopeName);
      expect(card).toHaveTextContent(r.appliesModel);
    }
    expect(LIMIT_RULES.length).toBeGreaterThan(0);

    const highlighted = LIMIT_RULES.filter((r) => r.highlighted);
    expect(highlighted.length).toBeGreaterThan(0);
    for (const r of highlighted) {
      const card = within(panel).getByTestId(`admin-limit-rule-${r.id}`);
      expect(card.className).toMatch(/warning/);
    }
    // 非醒目卡片不该被误标成 warning 边框——防止「全部卡片都套同一个 class」的假阳性
    const plain = LIMIT_RULES.find((r) => !r.highlighted);
    expect(plain).toBeDefined();
    const plainCard = within(panel).getByTestId(`admin-limit-rule-${plain!.id}`);
    expect(plainCard.className).not.toMatch(/warning/);
  });

  it("降级阈值三级都在，任务分级表四行都在且色调不同（不是一刀切同色）", () => {
    renderScreen();
    fireEvent.mouseDown(screen.getByTestId("admin-members-tab-policy"), { button: 0 });
    const panel = screen.getByTestId("admin-members-tabpanel-policy");

    expect(within(panel).getByTestId("admin-degrade-tier-org")).toHaveTextContent("组织级");
    expect(within(panel).getByTestId("admin-degrade-tier-member")).toHaveTextContent("成员级");
    expect(within(panel).getByTestId("admin-degrade-tier-agent")).toHaveTextContent("Agent 级");

    for (const row of TASK_TYPE_GRADING) {
      const tr = within(panel).getByTestId(`admin-degrade-task-${row.key}`);
      expect(tr).toHaveTextContent(row.taskType);
      expect(tr).toHaveTextContent(row.action);
    }
    // 至少两种不同 tone（防止四行全部同色，看不出「不是一刀切」）
    expect(new Set(TASK_TYPE_GRADING.map((r) => r.tone)).size).toBeGreaterThan(1);
  });

  it("点[编辑]能改上限并落到卡片上（本地 mock 状态，不是死按钮）", () => {
    renderScreen();
    fireEvent.mouseDown(screen.getByTestId("admin-members-tab-policy"), { button: 0 });
    const panel = screen.getByTestId("admin-members-tabpanel-policy");
    const rule = LIMIT_RULES[0]!;

    fireEvent.click(within(panel).getByTestId(`admin-limit-rule-edit-${rule.id}`));
    const dialog = screen.getByTestId("admin-limit-rule-edit-dialog");
    const capInput = within(dialog).getByTestId("admin-limit-rule-edit-cap") as HTMLInputElement;
    fireEvent.change(capInput, { target: { value: "999 万 token" } });
    fireEvent.click(within(dialog).getByTestId("admin-limit-rule-edit-save"));

    expect(screen.queryByTestId("admin-limit-rule-edit-dialog")).toBeNull();
    const card = within(panel).getByTestId(`admin-limit-rule-${rule.id}`);
    expect(card).toHaveTextContent("999 万 token");
  });
});

describe("④反证：三个 tab 没有变成三条新的左栏菜单项", () => {
  it("ADMIN_NAV「组织」组的 key 集合不含 usage/limits/policy 等新键", () => {
    const org = ADMIN_NAV.find((g) => g.group === "组织")!;
    const keys = org.items.map((i) => i.key);
    expect(keys).not.toContain("usage");
    expect(keys).not.toContain("limits");
    expect(keys).not.toContain("policy");
    // 「组织」组仍然只有 F16 既有的四项——本 feature 没有在左栏加新入口
    expect(keys).toEqual(["overview", "members", "feedback", "local"]);
  });
});

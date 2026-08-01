/**
 * F23 —— 新建项目向导（`/project/new`，`NewProjectFlow`）的界面（`uc-2-2` R3）。
 *
 * 本域的既有约束（`lib/mock/project.ts` 头注）：**只写前端 + mock，绝不接后端**——
 * 切环节不真推进、发布不真发布。因此本文件不断言任何网络请求，只断言两件在
 * 组件层面就能真实成立的事：
 *   ① 六类初始化一览与蓝本设计器共用同一份数据源（`INIT_CATEGORIES`），不是本组件
 *      另开一份清单（同 I-17「一览与实际写入必须同源」的界面侧落点）。
 *   ② 「创建项目」按钮在界面层面就防重复提交（V13 幂等在界面上的最起码表达）：
 *      多次点击只会让创建状态生效一次，按钮点击后置为禁用/文案改变。
 */
import * as React from "react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";

// `NewProjectFlow` renders inside `AppShell`, whose nav chrome (`icon-rail` / `top-bar` /
// `mobile-tabs`) calls `usePathname()` to highlight the active route. Outside of Next's own
// router context (i.e. under plain jsdom) that hook has nothing to read from — mock it the
// same way a real app would provide it, so this test exercises the wizard body, not the shell.
vi.mock("next/navigation", () => ({ usePathname: () => "/project/new" }));

import { NewProjectFlow } from "@/components/project/new-project-flow";
import { mockIdentity } from "@/lib/identity";
import { INIT_CATEGORIES } from "@/lib/mock/tpl";
import { BLUEPRINT_CATALOG } from "@/lib/mock/project";

function renderWizard() {
  render(<NewProjectFlow identity={mockIdentity("org-yuanyang", null)} state="default" />);
  return screen.getByTestId("project-new");
}

describe("步骤 1 · 选蓝本", () => {
  it("渲染出蓝本目录里的每一个蓝本，且默认选中第一个", () => {
    renderWizard();
    const grid = screen.getByTestId("project-new-blueprints");
    for (const bp of BLUEPRINT_CATALOG) {
      const btn = within(grid).getByTestId(`project-new-blueprint-${bp.id}`);
      expect(btn).toBeTruthy();
    }
    expect(screen.getByTestId(`project-new-blueprint-${BLUEPRINT_CATALOG[0]!.id}`).getAttribute("aria-pressed")).toBe(
      "true",
    );
  });

  it("点选另一个蓝本会切换选中态", () => {
    renderWizard();
    const second = BLUEPRINT_CATALOG[1]!;
    const btn = screen.getByTestId(`project-new-blueprint-${second.id}`);
    fireEvent.click(btn);
    expect(btn.getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByTestId(`project-new-blueprint-${BLUEPRINT_CATALOG[0]!.id}`).getAttribute("aria-pressed")).toBe(
      "false",
    );
  });
});

describe("六类初始化一览与蓝本设计器同源（AC2「逐项对得上」的界面侧落点，I-17）", () => {
  it("渲染出的类目集合 = INIT_CATEGORIES 的全部六类，不多不少", () => {
    renderWizard();
    const preview = screen.getByTestId("project-new-init-preview");
    const items = within(preview).getAllByTestId("project-new-init-item");
    expect(items.length).toBe(INIT_CATEGORIES.length);
    expect(INIT_CATEGORIES.length).toBeGreaterThan(0); // 非空前提，避免两边都空时平凡为真

    const renderedLabels = items.map((el) => el.textContent ?? "");
    for (const cat of INIT_CATEGORIES) {
      expect(renderedLabels.some((t) => t.includes(cat.label))).toBe(true);
    }
  });
});

describe("「创建项目」按钮的界面侧幂等（V13 的界面表达）", () => {
  it("点击一次后按钮禁用、文案变化，且出现已创建提示", () => {
    renderWizard();
    const btn = screen.getByTestId("project-new-create");
    expect(btn.hasAttribute("disabled")).toBe(false);
    expect(screen.queryByTestId("project-new-created")).toBeNull();

    fireEvent.click(btn);

    expect(btn.hasAttribute("disabled")).toBe(true);
    expect(btn.textContent).toContain("已创建");
    expect(screen.getByTestId("project-new-created")).toBeTruthy();
  });

  it("连续点击多次（双击 / 手误多点）只生效一次——不是防抖，是状态锁死", () => {
    renderWizard();
    const btn = screen.getByTestId("project-new-create");

    fireEvent.click(btn);
    fireEvent.click(btn);
    fireEvent.click(btn);

    // data-create-count 只应该从 0 走到 1，之后禁用态本身也会挡掉后续点击；
    // 这里直接读计数属性，确认「已提交」之后的点击确实没有再让计数往上走。
    expect(screen.getByTestId("project-new-create").getAttribute("data-create-count")).toBe("1");
  });
});

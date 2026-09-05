/**
 * F07（#2715）—— 计划确认卡片（`PlanConfirmationCard`,
 * `components/agent-kernel/agent-kernel-units.tsx`）。
 *
 * `requirements/03-plan-mode-permissions.md` R3 步骤 1-3 / R8，
 * `contracts/plan-permissions/ui.md` 的 data-testid 表：`agent-kernel-plan-confirmation-card`
 * 在这份原型里落地为 `plan-confirmation-card`（逐条 todo 为 `plan-todo-*`，确认/取消为
 * `plan-confirm`/`plan-cancel`），E2（编辑不合法内容——删除必要前置步骤）对应 `err-plan`。
 *
 * 组件本身在 UI 先行阶段已作为原型建成（`ui-preview/plan-permissions/
 * 01-plan-confirmation-card.png` 的落地，`design-signoff.md` 已签核），本次补的是把
 * feature_list.json F07 该条 notes 逐字列出的断言面固化成回归门控，与同 sprint 的
 * F10/F14/F04（`paused-state.test.tsx`/`error-card.test.tsx`）同一先例——只给已建原型
 * 补测试，组件不改动。
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PlanConfirmationCard } from "@/components/agent-kernel/agent-kernel-units";
import { MOCK_PLAN_TODOS } from "@/lib/mock/agent-kernel";

describe("PlanConfirmationCard：渲染结构化 todo 列表（带 L0/L1/L2 风险徽标）", () => {
  it("data-testid=plan-confirmation-card 存在，逐条 todo 与风险徽标一并渲染", () => {
    render(<PlanConfirmationCard />);
    expect(screen.getByTestId("plan-confirmation-card")).toBeInTheDocument();
    for (const todo of MOCK_PLAN_TODOS) {
      expect(screen.getByTestId(`plan-todo-${todo.id}`)).toBeInTheDocument();
      expect(screen.getByTestId(`plan-todo-input-${todo.id}`)).toHaveValue(todo.content);
    }
    // 至少覆盖 L0/L1/L2 三档（MOCK_PLAN_TODOS 本身混有三档，签核材料要求可见）。
    expect(screen.getAllByTestId(/^risk-(L0|L1|L2)$/).length).toBe(MOCK_PLAN_TODOS.length);
  });

  it("plan-cancel 按钮存在（R4 A1：取消入口）", () => {
    render(<PlanConfirmationCard />);
    const cancel = screen.getByTestId("plan-cancel");
    expect(cancel.tagName).toBe("BUTTON");
    expect(cancel).toBeEnabled();
  });
});

describe("PlanConfirmationCard：编辑某步骤内容", () => {
  it("plan-todo-input-t1 可编辑，输入框的值随编辑更新", () => {
    render(<PlanConfirmationCard />);
    const input = screen.getByTestId("plan-todo-input-t1");
    fireEvent.change(input, { target: { value: "改写后的第一步" } });
    expect(input).toHaveValue("改写后的第一步");
  });
});

describe("PlanConfirmationCard：删除步骤 + E2 依赖校验（删除被依赖的前置步骤）", () => {
  it("plan-todo-delete-t1 可删除对应步骤（t1 从列表中消失）", () => {
    render(<PlanConfirmationCard />);
    fireEvent.click(screen.getByTestId("plan-todo-delete-t1"));
    expect(screen.queryByTestId("plan-todo-t1")).not.toBeInTheDocument();
  });

  it("删除了被依赖的前置步骤（t1，t2 依赖它）后出现 err-plan 提示，且 plan-confirm 被禁用", () => {
    render(<PlanConfirmationCard />);
    expect(screen.queryByTestId("err-plan")).not.toBeInTheDocument();
    expect(screen.getByTestId("plan-confirm")).toBeEnabled();

    fireEvent.click(screen.getByTestId("plan-todo-delete-t1"));

    expect(screen.getByTestId("err-plan")).toBeInTheDocument();
    expect(screen.getByTestId("err-plan")).toHaveAttribute("role", "alert");
    expect(screen.getByTestId("plan-confirm")).toBeDisabled();
  });

  it("删除的不是任何步骤的前置（如叶子步骤 t6）时不触发 err-plan，plan-confirm 仍可用", () => {
    render(<PlanConfirmationCard />);
    fireEvent.click(screen.getByTestId("plan-todo-delete-t6"));
    expect(screen.queryByTestId("err-plan")).not.toBeInTheDocument();
    expect(screen.getByTestId("plan-confirm")).toBeEnabled();
  });
});

describe("PlanConfirmationCard：确认执行", () => {
  it("点击 plan-confirm 后显示 plan-confirmed 卡片与 saved 文案（『计划已确认，agent 开始执行』）", () => {
    render(<PlanConfirmationCard />);
    fireEvent.click(screen.getByTestId("plan-confirm"));

    expect(screen.getByTestId("plan-confirmed")).toBeInTheDocument();
    expect(screen.getByTestId("saved")).toHaveTextContent("计划已确认，agent 开始执行");
    // 确认后原卡片（连同其编辑/删除入口）不再展示，避免确认后仍可继续改计划。
    expect(screen.queryByTestId("plan-confirmation-card")).not.toBeInTheDocument();
  });

  it("CP 反证：计划存在未修复的依赖断裂时，plan-confirm 处于禁用态，点击不产生 plan-confirmed（未真正阻断则本条必红）", () => {
    render(<PlanConfirmationCard />);
    fireEvent.click(screen.getByTestId("plan-todo-delete-t1"));
    fireEvent.click(screen.getByTestId("plan-confirm"));
    expect(screen.queryByTestId("plan-confirmed")).not.toBeInTheDocument();
  });
});

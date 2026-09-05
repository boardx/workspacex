/**
 * F08（#2716）—— 工具权限确认弹层（`ToolPermissionCard`,
 * `components/agent-kernel/agent-kernel-units.tsx`）。
 *
 * `requirements/03-plan-mode-permissions.md` R8 / R12，`contracts/plan-permissions/
 * ui.md` 的 S2「工具权限确认弹层」：展示「agent 想做什么、为什么」+ 四档决策按钮
 * （四档语义对应契约 `ToolPermissionDecisionKind` 的 once/run/forever/deny——本组件
 * data-testid 用 `perm-always` 承载 forever，文案层命名，不是新的枚举）。
 *
 * 依据等级：[原型]（ui-prototyper 已在签核阶段建成，`ui-preview/plan-permissions/
 * 03-tool-permission-card.png`）。组件本身未改动，本次补的是把 feature_list.json
 * 该条 notes 逐字列出的断言面固化成回归门控，与同 sprint 的 F04/F10/F14 同一先例
 * （只给已建原型补测试）。
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ToolPermissionCard } from "@/components/agent-kernel/agent-kernel-units";
import { MOCK_PERMISSION_REQUEST } from "@/lib/mock/agent-kernel";

describe("ToolPermissionCard 主展示区：想做什么 / 为什么 / 完整命令", () => {
  it("渲染 tool-permission-card，展示 perm-intent/perm-rationale/perm-command", () => {
    render(<ToolPermissionCard />);
    expect(screen.getByTestId("tool-permission-card")).toBeInTheDocument();
    expect(screen.getByTestId("perm-intent")).toHaveTextContent(MOCK_PERMISSION_REQUEST.intent);
    expect(screen.getByTestId("perm-rationale")).toHaveTextContent(MOCK_PERMISSION_REQUEST.rationale);
    expect(screen.getByTestId("perm-command")).toHaveTextContent(MOCK_PERMISSION_REQUEST.command);
  });

  it("I-3：perm-command 是完整命令，未做长度截断", () => {
    render(<ToolPermissionCard />);
    // command 本身较长，若实现改成截断摘要（如追加省略号）这条断言会先红。
    expect(screen.getByTestId("perm-command").textContent).toBe(MOCK_PERMISSION_REQUEST.command);
    expect(MOCK_PERMISSION_REQUEST.command).not.toContain("…");
  });
});

describe("ToolPermissionCard 四档决策：仅本次 / 本 run 内 / 以后都允许 / 拒绝", () => {
  it.each([
    ["perm-once", "已允许本次执行"],
    ["perm-run", "本次 run 内同类操作将不再打断你"],
    ["perm-always", "已记为长期允许"],
    ["perm-deny", "已拒绝"],
  ] as const)("点击 %s 后，data-testid=saved 显示对应结果说明「%s」", (testId, expectedText) => {
    render(<ToolPermissionCard />);
    fireEvent.click(screen.getByTestId(testId));
    expect(screen.getByTestId("saved")).toHaveTextContent(expectedText);
  });

  it("四个决策按钮均可点击（未禁用），选择前不显示结果说明", () => {
    render(<ToolPermissionCard />);
    expect(screen.queryByTestId("saved")).not.toBeInTheDocument();
    for (const testId of ["perm-once", "perm-run", "perm-always", "perm-deny"] as const) {
      const btn = screen.getByTestId(testId);
      expect(btn.tagName).toBe("BUTTON");
      expect(btn).toBeEnabled();
    }
  });

  it("拒绝后仍展示原始命令/意图/理由（agent 据此调整计划，不清空上下文）", () => {
    render(<ToolPermissionCard />);
    fireEvent.click(screen.getByTestId("perm-deny"));
    expect(screen.getByTestId("saved")).toHaveTextContent("已拒绝");
    expect(screen.getByTestId("perm-intent")).toHaveTextContent(MOCK_PERMISSION_REQUEST.intent);
    expect(screen.getByTestId("perm-command")).toHaveTextContent(MOCK_PERMISSION_REQUEST.command);
  });

  it("影响范围有独立锚点 perm-affects（issue #2767，TW-P0-6② 记录过的差距）", () => {
    render(<ToolPermissionCard />);
    expect(screen.getByTestId("perm-affects")).toHaveTextContent(MOCK_PERMISSION_REQUEST.affects);
  });
});

describe("issue #2767 -- ToolPermissionCard 受控化：/chat 宿主接线所需的 request/decided/onDecide", () => {
  const REQUEST = {
    risk: "L2" as const,
    intent: "调用技能：pdf-create",
    rationale: "这个技能被判定为高风险操作，需要你确认后才会执行。",
    command: JSON.stringify({ skill_stable_name: "pdf-create", task: "生成 PDF" }, null, 2),
    affects: "具体影响范围由该技能自行决定；批准前不会执行任何操作。",
  };

  it("传入 request 时展示真实数据，不是 mock", () => {
    render(<ToolPermissionCard request={REQUEST} />);
    expect(screen.getByTestId("perm-intent")).toHaveTextContent(REQUEST.intent);
    expect(screen.getByTestId("perm-command")).toHaveTextContent("pdf-create");
  });

  it("点击决策按钮时调用 onDecide 而不是自己管理内部 state（宿主受控）", () => {
    const onDecide = vi.fn();
    render(<ToolPermissionCard request={REQUEST} decided={null} onDecide={onDecide} />);
    fireEvent.click(screen.getByTestId("perm-once"));
    expect(onDecide).toHaveBeenCalledTimes(1);
    expect(onDecide).toHaveBeenCalledWith("once");
    // 受控态：`decided` 仍是 null（宿主还没重渲染），组件自己不应该冒出 "saved" 文案。
    expect(screen.queryByTestId("saved")).not.toBeInTheDocument();
  });

  it("onDecide 里 always 按钮同样传 \"always\"（契约层面的 forever 由宿主自己翻译，不是组件的职责）", () => {
    const onDecide = vi.fn();
    render(<ToolPermissionCard request={REQUEST} decided={null} onDecide={onDecide} />);
    fireEvent.click(screen.getByTestId("perm-always"));
    expect(onDecide).toHaveBeenCalledTimes(1);
    expect(onDecide).toHaveBeenCalledWith("always");
  });

  it("decided 非 null 时按受控值展示收尾文案，即使用户还没点过按钮", () => {
    render(<ToolPermissionCard request={REQUEST} decided="run" />);
    expect(screen.getByTestId("saved")).toHaveTextContent("本次 run 内同类操作将不再打断你");
  });
});

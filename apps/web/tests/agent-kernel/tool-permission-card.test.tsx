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
 * 03-tool-permission-card.png`）。本次补的是把 feature_list.json 该条 notes 逐字列出
 * 的断言面固化成回归门控，与同 sprint 的 F04/F10/F14 同一先例（只给已建原型补测试）。
 *
 * issue #2774（`/chat` 接入本卡）—— 组件的 `request` 从"零参数、内部读 mock"改成
 * 必填 prop（原因见 `tool-permission-card.tsx` 文件头：本组件被搬进独立文件，不再
 * 自带 mock 导入）。本文件断言的 user_visible_behavior 逐字未变，只是显式传入同一份
 * `MOCK_PERMISSION_REQUEST`（`risk` 收窄成契约字面量 `"L2"`，同 `agent-kernel-units.tsx`
 * 那处调用点的同一条注记）。
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ToolPermissionCard } from "@/components/agent-kernel/agent-kernel-units";
import { MOCK_PERMISSION_REQUEST } from "@/lib/mock/agent-kernel";

const REQUEST = { ...MOCK_PERMISSION_REQUEST, risk: "L2" } as const;

describe("ToolPermissionCard 主展示区：想做什么 / 为什么 / 完整命令", () => {
  it("渲染 tool-permission-card，展示 perm-intent/perm-rationale/perm-command", () => {
    render(<ToolPermissionCard request={REQUEST} />);
    expect(screen.getByTestId("tool-permission-card")).toBeInTheDocument();
    expect(screen.getByTestId("perm-intent")).toHaveTextContent(MOCK_PERMISSION_REQUEST.intent);
    expect(screen.getByTestId("perm-rationale")).toHaveTextContent(MOCK_PERMISSION_REQUEST.rationale);
    expect(screen.getByTestId("perm-command")).toHaveTextContent(MOCK_PERMISSION_REQUEST.command);
  });

  it("I-3：perm-command 是完整命令，未做长度截断", () => {
    render(<ToolPermissionCard request={REQUEST} />);
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
    render(<ToolPermissionCard request={REQUEST} />);
    fireEvent.click(screen.getByTestId(testId));
    expect(screen.getByTestId("saved")).toHaveTextContent(expectedText);
  });

  it("四个决策按钮均可点击（未禁用），选择前不显示结果说明", () => {
    render(<ToolPermissionCard request={REQUEST} />);
    expect(screen.queryByTestId("saved")).not.toBeInTheDocument();
    for (const testId of ["perm-once", "perm-run", "perm-always", "perm-deny"] as const) {
      const btn = screen.getByTestId(testId);
      expect(btn.tagName).toBe("BUTTON");
      expect(btn).toBeEnabled();
    }
  });

  it("拒绝后仍展示原始命令/意图/理由（agent 据此调整计划，不清空上下文）", () => {
    render(<ToolPermissionCard request={REQUEST} />);
    fireEvent.click(screen.getByTestId("perm-deny"));
    expect(screen.getByTestId("saved")).toHaveTextContent("已拒绝");
    expect(screen.getByTestId("perm-intent")).toHaveTextContent(MOCK_PERMISSION_REQUEST.intent);
    expect(screen.getByTestId("perm-command")).toHaveTextContent(MOCK_PERMISSION_REQUEST.command);
  });
});

/**
 * issue #2774 —— `onDecide` 提供时（`/chat` 宿主的真实路径），点击不再是纯本地展示：
 * 在请求真正成功之前不假装决定生效（同 `copilotkit-v2-approval-dialog.tsx` 反复写过
 * 的既有纪律），失败时展示 `perm-error` 且保留原始上下文、按钮重新可点。
 */
describe("ToolPermissionCard · onDecide 提供时：不在网络往返完成前假装决定生效", () => {
  it("成功：按钮先禁用，onDecide 收到契约枚举值（always→forever），resolve 后才出现 saved", async () => {
    let resolveDecide: (() => void) | null = null;
    const onDecide = vi.fn(() => new Promise<void>((resolve) => { resolveDecide = resolve; }));
    render(<ToolPermissionCard request={REQUEST} onDecide={onDecide} />);

    fireEvent.click(screen.getByTestId("perm-always"));
    expect(onDecide).toHaveBeenCalledWith("forever");
    // 请求还没 resolve：不假装决定生效，四个按钮全部禁用防止重复提交。
    expect(screen.queryByTestId("saved")).not.toBeInTheDocument();
    for (const testId of ["perm-once", "perm-run", "perm-always", "perm-deny"] as const) {
      expect(screen.getByTestId(testId)).toBeDisabled();
    }

    resolveDecide!();
    expect(await screen.findByTestId("saved")).toHaveTextContent("已记为长期允许");
    expect(screen.getByTestId("perm-once")).toBeEnabled();
  });

  it("失败：展示 perm-error，不展示 saved，原始命令/意图仍保留展示，按钮重新可点以便重试", async () => {
    const onDecide = vi.fn(async () => { throw new Error("网络错误，请重试"); });
    render(<ToolPermissionCard request={REQUEST} onDecide={onDecide} />);

    fireEvent.click(screen.getByTestId("perm-deny"));
    expect(await screen.findByTestId("perm-error")).toHaveTextContent("网络错误，请重试");
    expect(screen.queryByTestId("saved")).not.toBeInTheDocument();
    expect(screen.getByTestId("perm-intent")).toHaveTextContent(MOCK_PERMISSION_REQUEST.intent);
    expect(screen.getByTestId("perm-deny")).toBeEnabled();
  });
});

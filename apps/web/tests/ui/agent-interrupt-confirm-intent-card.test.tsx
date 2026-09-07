/**
 * F213 —— 屏一：目标复述卡（`confirm_intent`）机械判据（`ui.md` 屏一 + `usecases.md`
 * UC-1 + `domain.md` I-1/I-2）。
 *
 * `ConfirmIntentCard` 与 mock 数据在 F212 前置的 UI 先行阶段已由 ui-prototyper 建成
 * （真实组件，`apps/web/components/agent-interrupts/confirm-intent-card.tsx`）。本文件
 * 是 F213 的机械判据：把 ui.md 逐字列出的七态 + 假设列表/编辑分支钉成会红的断言，仿
 * `research-detail-four-sections.test.tsx`（R12 判据同款套路：断言打在性质上，不写死
 * 与 mock 无关的数字）。
 */
import { describe, it, expect } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { ConfirmIntentCard } from "@/components/agent-interrupts/confirm-intent-card";
import { MOCK_CONFIRM_INTENT } from "@/lib/mock/agent-interrupts";

const TID = "agent-interrupt-confirm-intent";

describe("F213 · 默认态：理解 + ≥2 条假设只读展示（I-2）", () => {
  it("理解文本逐字渲染", () => {
    render(<ConfirmIntentCard args={MOCK_CONFIRM_INTENT} state="default" canWrite />);
    expect(screen.getByTestId(`${TID}-understanding`).textContent).toBe(MOCK_CONFIRM_INTENT.understanding);
  });

  it("反空转：mock 数据确实 ≥2 条假设，否则下面的断言无的放矢", () => {
    expect(MOCK_CONFIRM_INTENT.assumptions.length).toBeGreaterThanOrEqual(2);
  });

  it("每条假设按顺序逐字出现，条数与 mock 一致", () => {
    render(<ConfirmIntentCard args={MOCK_CONFIRM_INTENT} state="default" canWrite />);
    MOCK_CONFIRM_INTENT.assumptions.forEach((a, i) => {
      expect(screen.getByTestId(`${TID}-assumption-${i}`).textContent).toContain(a);
    });
    expect(screen.queryByTestId(`${TID}-assumption-${MOCK_CONFIRM_INTENT.assumptions.length}`)).toBeNull();
  });

  it("门控说明条常驻（I-1 的可视化）：未确认前后续步骤不会开始", () => {
    render(<ConfirmIntentCard args={MOCK_CONFIRM_INTENT} state="default" canWrite />);
    expect(screen.getByTestId(`${TID}-gated-notice`).textContent).toContain("不会开始");
  });

  it("两个动作入口都在：继续 / 改假设", () => {
    render(<ConfirmIntentCard args={MOCK_CONFIRM_INTENT} state="default" canWrite />);
    expect(screen.getByTestId(`${TID}-continue`)).toBeTruthy();
    expect(screen.getByTestId(`${TID}-edit-toggle`)).toBeTruthy();
  });
});

describe("F213 · 改假设分支：进入编辑态后每条假设变可编辑，可增删，提交=用完整新列表重新确认", () => {
  it("点「改假设」→ 每条假设变成可编辑文本框，初始值等于原假设", () => {
    render(<ConfirmIntentCard args={MOCK_CONFIRM_INTENT} state="default" canWrite />);
    fireEvent.click(screen.getByTestId(`${TID}-edit-toggle`));
    MOCK_CONFIRM_INTENT.assumptions.forEach((a, i) => {
      const input = screen.getByTestId(`${TID}-assumption-input-${i}`) as HTMLTextAreaElement;
      expect(input.value).toBe(a);
    });
  });

  it("加一条假设 → 出现一个新的空白输入框（数组变长）", () => {
    render(<ConfirmIntentCard args={MOCK_CONFIRM_INTENT} state="default" canWrite />);
    fireEvent.click(screen.getByTestId(`${TID}-edit-toggle`));
    const before = screen.getAllByTestId(new RegExp(`^${TID}-assumption-input-\\d+$`));
    fireEvent.click(screen.getByTestId(`${TID}-assumption-add`));
    const after = screen.getAllByTestId(new RegExp(`^${TID}-assumption-input-\\d+$`));
    expect(after.length).toBe(before.length + 1);
  });

  it("删除到一条真实假设仍可提交", () => {
    render(<ConfirmIntentCard args={MOCK_CONFIRM_INTENT} state="default" canWrite />);
    fireEvent.click(screen.getByTestId(`${TID}-edit-toggle`));
    // 删到只剩 1 条：逐一删除除第 0 条外的所有假设。
    MOCK_CONFIRM_INTENT.assumptions.slice(1).forEach(() => {
      fireEvent.click(screen.getByTestId(`${TID}-assumption-remove-1`));
    });
    expect(screen.getAllByTestId(new RegExp(`^${TID}-assumption-input-\\d+$`)).length).toBe(1);
    expect((screen.getByTestId(`${TID}-edit-submit`) as HTMLButtonElement).disabled).toBe(false);
  });

  it("取消编辑 → 回到只读态，假设内容不变", () => {
    render(<ConfirmIntentCard args={MOCK_CONFIRM_INTENT} state="default" canWrite />);
    fireEvent.click(screen.getByTestId(`${TID}-edit-toggle`));
    fireEvent.click(screen.getByTestId(`${TID}-edit-cancel`));
    expect(screen.queryByTestId(`${TID}-assumption-input-0`)).toBeNull();
    expect(screen.getByTestId(`${TID}-assumption-0`).textContent).toContain(MOCK_CONFIRM_INTENT.assumptions[0]);
  });
});

describe("F213 · 七态矩阵（ui.md 屏一）", () => {
  it("loading：骨架态，保留名 testid 可选中", () => {
    render(<ConfirmIntentCard args={MOCK_CONFIRM_INTENT} state="loading" canWrite />);
    expect(screen.getByTestId("loading")).toBeTruthy();
  });

  it("empty：说明当前没有待确认的中断", () => {
    render(<ConfirmIntentCard args={MOCK_CONFIRM_INTENT} state="empty" canWrite />);
    expect(screen.getByTestId("empty").textContent).toContain("没有待确认");
  });

  it("invalid：强制进入编辑态并给出「假设格式无效」的字段级错误", () => {
    render(<ConfirmIntentCard args={MOCK_CONFIRM_INTENT} state="invalid" canWrite />);
    expect(screen.getByTestId(`${TID}-assumption-input-0`)).toBeTruthy();
    expect(screen.getByTestId("err-assumptions").textContent).toContain("格式无效");
  });

  it("dep-failed：提示 AUDIT_SINK_UNAVAILABLE 语义（决策写不进审计）", () => {
    render(<ConfirmIntentCard args={MOCK_CONFIRM_INTENT} state="dep-failed" canWrite />);
    expect(screen.getByTestId("dep-failed").textContent).toContain("安全拦下");
  });

  it("denied：观察者（canWrite=false）即便 state=default 也被降级为 denied，且说明是项目层限制", () => {
    render(<ConfirmIntentCard args={MOCK_CONFIRM_INTENT} state="default" canWrite={false} />);
    expect(screen.getByTestId("denied")).toBeTruthy();
    expect(screen.getByTestId("denied-layer").textContent).toContain("项目层限制");
  });

  it("denied 态下，继续/改假设两个决策入口都不在 DOM 里（不是禁用态）", () => {
    const { container } = render(<ConfirmIntentCard args={MOCK_CONFIRM_INTENT} state="default" canWrite={false} />);
    expect(screen.queryByTestId(`${TID}-continue`)).toBeNull();
    expect(container.innerHTML).not.toContain(`${TID}-continue`);
  });

  it("success：已确认继续", () => {
    render(<ConfirmIntentCard args={MOCK_CONFIRM_INTENT} state="success" canWrite />);
    const banner = screen.getByTestId("saved");
    expect(banner.textContent).toContain("已按当前理解继续执行");
    // success 态仍渲染卡片本体（这是「确认后」的态，不是把卡片摘掉）。
    expect(within(screen.getByTestId(`${TID}-card`)).getByTestId(`${TID}-understanding`)).toBeTruthy();
  });
});

describe("F213 · canWrite=true 时决策按钮可用（无权限降级不会误伤有权限的人）", () => {
  it("继续/改假设按钮 disabled=false", () => {
    render(<ConfirmIntentCard args={MOCK_CONFIRM_INTENT} state="default" canWrite />);
    expect((screen.getByTestId(`${TID}-continue`) as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByTestId(`${TID}-edit-toggle`) as HTMLButtonElement).disabled).toBe(false);
  });
});


describe("WX-T011 真实假设", () => {
  it.each([0, 1])("允许提交 %i 条假设", (count) => {
    let submitted: string[] | undefined;
    const assumptions = MOCK_CONFIRM_INTENT.assumptions.slice(0, count);
    render(<ConfirmIntentCard args={{ ...MOCK_CONFIRM_INTENT, assumptions }} state="default" canWrite initialEditing onEditSubmit={(value) => { submitted = value; }} />);
    fireEvent.click(screen.getByTestId(`${TID}-edit-submit`));
    expect(submitted).toEqual(assumptions);
  });
});

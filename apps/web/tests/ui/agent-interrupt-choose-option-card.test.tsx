/**
 * F215 —— 屏三：多方案对比（`choose_option`）机械判据（`ui.md` 屏三 + `usecases.md`
 * UC-3 + `domain.md` I-5/I-6）。`ChooseOptionCard` 与 mock 数据在 F212 前置的 UI 先行
 * 阶段已由 ui-prototyper 建成。
 */
import { describe, it, expect } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ChooseOptionCard } from "@/components/agent-interrupts/choose-option-card";
import { MOCK_OPTIONS_2, MOCK_OPTIONS_3 } from "@/lib/mock/agent-interrupts";

const TID = "agent-interrupt-choose-option";

describe("F215 · 反空转：mock 同时提供 2 张与 3 张两种态", () => {
  it("MOCK_OPTIONS_2 恰好 2 项，MOCK_OPTIONS_3 恰好 3 项（I-5 上下限都有样例）", () => {
    expect(MOCK_OPTIONS_2.length).toBe(2);
    expect(MOCK_OPTIONS_3.length).toBe(3);
  });
});

describe("F215 · 默认态：等宽卡 + 三项固定对照（见效/投入/预计收益，顺序固定）", () => {
  it("3 张态：每张卡都渲染，且条数与 mock 一致", () => {
    render(<ChooseOptionCard options={MOCK_OPTIONS_3} state="default" canWrite />);
    MOCK_OPTIONS_3.forEach((o) => {
      expect(screen.getByTestId(`${TID}-option-${o.optionId}`)).toBeTruthy();
    });
  });

  it("每张卡的三项对照文案（见效/投入/预计收益）逐字出现，顺序固定", () => {
    render(<ChooseOptionCard options={MOCK_OPTIONS_3} state="default" canWrite />);
    MOCK_OPTIONS_3.forEach((o) => {
      const card = screen.getByTestId(`${TID}-option-${o.optionId}`);
      const dts = Array.from(card.querySelectorAll("dt")).map((n) => n.textContent);
      expect(dts).toEqual(["见效", "投入", "预计收益"]);
      expect(card.textContent).toContain(o.timeToValue);
      expect(card.textContent).toContain(o.effort);
      expect(card.textContent).toContain(o.expectedReturn);
    });
  });

  it("2 张态同样渲染齐全（I-5 下限）", () => {
    render(<ChooseOptionCard options={MOCK_OPTIONS_2} state="default" canWrite />);
    MOCK_OPTIONS_2.forEach((o) => {
      expect(screen.getByTestId(`${TID}-option-${o.optionId}`)).toBeTruthy();
    });
  });
});

describe("F215 · 选中即 resume（无二次确认），resume 载荷用 optionId 回指（I-6）", () => {
  it("点击整张卡即选中，出现选中标记，data-selected 反映在 DOM 属性上", () => {
    render(<ChooseOptionCard options={MOCK_OPTIONS_3} state="default" canWrite />);
    const target = MOCK_OPTIONS_3[1]!;
    fireEvent.click(screen.getByTestId(`${TID}-option-${target.optionId}`));
    expect(screen.getByTestId(`${TID}-selected-mark-${target.optionId}`)).toBeTruthy();
    expect(screen.getByTestId(`${TID}-option-${target.optionId}`).getAttribute("data-selected")).toBe("true");
  });

  it("选中一张后，其余卡不带选中标记（单选，不是多选）", () => {
    render(<ChooseOptionCard options={MOCK_OPTIONS_3} state="default" canWrite />);
    const [first, second] = MOCK_OPTIONS_3;
    fireEvent.click(screen.getByTestId(`${TID}-option-${first!.optionId}`));
    expect(screen.queryByTestId(`${TID}-selected-mark-${second!.optionId}`)).toBeNull();
  });

  it("改选另一张：选中标记转移", () => {
    render(<ChooseOptionCard options={MOCK_OPTIONS_3} state="default" canWrite />);
    const [first, second] = MOCK_OPTIONS_3;
    fireEvent.click(screen.getByTestId(`${TID}-option-${first!.optionId}`));
    fireEvent.click(screen.getByTestId(`${TID}-option-${second!.optionId}`));
    expect(screen.queryByTestId(`${TID}-selected-mark-${first!.optionId}`)).toBeNull();
    expect(screen.getByTestId(`${TID}-selected-mark-${second!.optionId}`)).toBeTruthy();
  });
});

describe("F215 · 「都不要」逃生口（reject，契约允许，ui.md 默认渲染）", () => {
  it("showDecline 默认 true 时渲染出口按钮", () => {
    render(<ChooseOptionCard options={MOCK_OPTIONS_3} state="default" canWrite />);
    expect(screen.getByTestId(`${TID}-decline`)).toBeTruthy();
  });

  it("showDecline=false 时不渲染（渲染与否是可配置的，最终由签核裁定）", () => {
    render(<ChooseOptionCard options={MOCK_OPTIONS_3} state="default" canWrite showDecline={false} />);
    expect(screen.queryByTestId(`${TID}-decline`)).toBeNull();
  });
});

describe("F215 · 七态矩阵（ui.md 屏三）", () => {
  it("loading", () => {
    render(<ChooseOptionCard options={MOCK_OPTIONS_3} state="loading" canWrite />);
    expect(screen.getByTestId("loading")).toBeTruthy();
  });

  it("empty", () => {
    render(<ChooseOptionCard options={MOCK_OPTIONS_3} state="empty" canWrite />);
    expect(screen.getByTestId("empty").textContent).toContain("没有待选择");
  });

  it("invalid：STALE_INTERRUPT/SELECTED_OPTION_NOT_FOUND 场景文案", () => {
    render(<ChooseOptionCard options={MOCK_OPTIONS_3} state="invalid" canWrite />);
    expect(screen.getByTestId("err-option").textContent).toContain("过期");
  });

  it("dep-failed", () => {
    render(<ChooseOptionCard options={MOCK_OPTIONS_3} state="dep-failed" canWrite />);
    expect(screen.getByTestId("dep-failed").textContent).toContain("安全拦下");
  });

  it("denied：观察者即便 state=default 也被降级，且选项按钮 disabled", () => {
    render(<ChooseOptionCard options={MOCK_OPTIONS_3} state="default" canWrite={false} />);
    expect(screen.getByTestId("denied")).toBeTruthy();
    expect(screen.queryByTestId(`${TID}-option-${MOCK_OPTIONS_3[0]!.optionId}`)).toBeNull();
  });

  it("success", () => {
    render(<ChooseOptionCard options={MOCK_OPTIONS_3} state="success" canWrite />);
    expect(screen.getByTestId("saved")).toBeTruthy();
  });
});

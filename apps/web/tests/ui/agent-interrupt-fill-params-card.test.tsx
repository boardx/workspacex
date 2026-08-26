/**
 * F214 —— 屏二：参数补全表单（`fill_params`）机械判据（`ui.md` 屏二 + `usecases.md`
 * UC-2 + `domain.md` I-3）。`FillParamsCard` 与 mock 数据在 F212 前置的 UI 先行阶段
 * 已由 ui-prototyper 建成。
 */
import { describe, it, expect } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { FillParamsCard } from "@/components/agent-interrupts/fill-params-card";
import { MOCK_FILL_PARAMS } from "@/lib/mock/agent-interrupts";

const TID = "agent-interrupt-fill-params";
const guessedFields = MOCK_FILL_PARAMS.filter((f) => f.aiGuess !== null);
const plainRequired = MOCK_FILL_PARAMS.filter((f) => f.aiGuess === null && f.required);

describe("F214 · 反空转：mock 里两类字段都真实存在", () => {
  it("既有 AI 猜测字段，也有纯人工必填字段——下面的分类断言才有意义", () => {
    expect(guessedFields.length).toBeGreaterThan(0);
    expect(plainRequired.length).toBeGreaterThan(0);
  });
});

describe("F214 · 默认态：AI 猜测字段高亮 + 徽标 + 依据文案（I-3）", () => {
  it("AI 猜测字段渲染「AI 建议」徽标与依据文案", () => {
    render(<FillParamsCard fields={MOCK_FILL_PARAMS} state="default" canWrite />);
    guessedFields.forEach((f) => {
      expect(screen.getByTestId(`${TID}-ai-badge-${f.name}`)).toBeTruthy();
      expect(screen.getByTestId(`${TID}-rationale-${f.name}`).textContent).toContain(f.rationale ?? "");
    });
  });

  it("纯人工必填字段（aiGuess===null）不带 AI 徽标、不带依据文案", () => {
    render(<FillParamsCard fields={MOCK_FILL_PARAMS} state="default" canWrite />);
    plainRequired.forEach((f) => {
      expect(screen.queryByTestId(`${TID}-ai-badge-${f.name}`)).toBeNull();
      expect(screen.queryByTestId(`${TID}-rationale-${f.name}`)).toBeNull();
    });
  });

  it("每个字段都渲染了对应的输入控件", () => {
    render(<FillParamsCard fields={MOCK_FILL_PARAMS} state="default" canWrite />);
    MOCK_FILL_PARAMS.forEach((f) => {
      expect(screen.getByTestId(`${TID}-input-${f.name}`)).toBeTruthy();
    });
  });
});

describe("F214 · 提交按钮文案随改动切换：未改→接受(approve)，有改动→应用(edit)", () => {
  it("初始未改动：按钮文案是「接受」", () => {
    render(<FillParamsCard fields={MOCK_FILL_PARAMS} state="default" canWrite />);
    expect(screen.getByTestId(`${TID}-submit`).textContent).toBe("接受");
  });

  it("改动任意一个字段后：按钮文案变成「应用」，且出现 appliedTo 二选一", () => {
    render(<FillParamsCard fields={MOCK_FILL_PARAMS} state="default" canWrite />);
    const textField = MOCK_FILL_PARAMS.find((f) => f.kind === "text")!;
    fireEvent.change(screen.getByTestId(`${TID}-input-${textField.name}`), { target: { value: "新值" } });
    expect(screen.getByTestId(`${TID}-submit`).textContent).toBe("应用");
    expect(screen.getByTestId(`${TID}-applied-full-rerun`)).toBeTruthy();
    expect(screen.getByTestId(`${TID}-applied-ledger-only`)).toBeTruthy();
  });

  it("选 ledger-only 后出现提示：本步骤执行中，改动将在完成后生效", () => {
    render(<FillParamsCard fields={MOCK_FILL_PARAMS} state="default" canWrite />);
    const textField = MOCK_FILL_PARAMS.find((f) => f.kind === "text")!;
    fireEvent.change(screen.getByTestId(`${TID}-input-${textField.name}`), { target: { value: "新值" } });
    fireEvent.click(screen.getByTestId(`${TID}-applied-ledger-only`));
    expect(screen.getByTestId(`${TID}-ledger-hint`).textContent).toContain("完成后生效");
  });

  it("appliedTo 二选一在未改动前不渲染（只有有改动才需要选应用方式）", () => {
    render(<FillParamsCard fields={MOCK_FILL_PARAMS} state="default" canWrite />);
    expect(screen.queryByTestId(`${TID}-applied-to`)).toBeNull();
  });
});

describe("F214 · 七态矩阵（ui.md 屏二）", () => {
  it("loading", () => {
    render(<FillParamsCard fields={MOCK_FILL_PARAMS} state="loading" canWrite />);
    expect(screen.getByTestId("loading")).toBeTruthy();
  });

  it("empty", () => {
    render(<FillParamsCard fields={MOCK_FILL_PARAMS} state="empty" canWrite />);
    expect(screen.getByTestId("empty").textContent).toContain("没有待补全");
  });

  it("invalid：必填未填字段报错，且字段本身带 aria-invalid", () => {
    render(<FillParamsCard fields={MOCK_FILL_PARAMS} state="invalid" canWrite />);
    expect(screen.getByTestId("err-cc_recipients").textContent).toContain("必填");
    const blankRequired = MOCK_FILL_PARAMS.find((f) => f.required && f.aiGuess === null)!;
    expect(screen.getByTestId(`${TID}-input-${blankRequired.name}`).getAttribute("aria-invalid")).toBe("true");
  });

  it("dep-failed", () => {
    render(<FillParamsCard fields={MOCK_FILL_PARAMS} state="dep-failed" canWrite />);
    expect(screen.getByTestId("dep-failed").textContent).toContain("安全拦下");
  });

  it("denied：观察者即便 state=default 也被降级", () => {
    render(<FillParamsCard fields={MOCK_FILL_PARAMS} state="default" canWrite={false} />);
    expect(screen.getByTestId("denied")).toBeTruthy();
    expect(screen.queryByTestId(`${TID}-submit`)).toBeNull();
  });

  it("success", () => {
    render(<FillParamsCard fields={MOCK_FILL_PARAMS} state="success" canWrite />);
    expect(screen.getByTestId("saved")).toBeTruthy();
  });
});

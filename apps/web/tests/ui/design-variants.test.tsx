/**
 * 对标 R9（#3954）—— 同一页的几个方案：并排渲染真实组件树，挑一个交回序号。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import * as React from "react";
import { VariantsPanel } from "@/components/design-loop/variants-panel";
import { DEVICE_PRESETS } from "@/components/design-loop/prototype-canvas";
import { designWorkbench } from "@repo/contracts";

afterEach(cleanup);

const variant = (t: string) => ({ summary: `方案${t}`, root: { type: "stack" as const, children: [{ type: "text" as const, props: { content: `会员 · ${t}` } }] } });
const base = {
  frameLabel: "商品详情", device: DEVICE_PRESETS[1]!, landscape: false, accent: "neutral" as const,
  tokens: designWorkbench.DEFAULT_DESIGN_TOKENS, theme: "light" as const, picking: false, onClose: vi.fn(), onRetry: vi.fn(),
};

describe("VariantsPanel", () => {
  it("每个方案画出真的树与取舍说明；点「用这个」交回它的序号", () => {
    const onPick = vi.fn();
    render(<VariantsPanel {...base} state={{ kind: "ready", items: ["甲", "乙", "丙"].map(variant) }} onPick={onPick} />);
    expect(screen.getByTestId("design-variant-0").textContent).toContain("会员 · 甲");
    expect(screen.getByTestId("design-variant-2").textContent).toContain("方案丙");
    // 缩略图不是「当前页」：不许挂 design-detail-phone（导出 PNG 与 e2e 都靠它找当前页）。
    expect(screen.queryAllByTestId("design-detail-phone")).toHaveLength(0);
    expect(screen.getAllByTestId("design-variant-canvas")).toHaveLength(3);
    fireEvent.click(screen.getByTestId("design-variant-pick-1"));
    expect(onPick).toHaveBeenCalledWith(1);
  });

  it("失败 ⇒ 说原因、给「再试一次」；挑选进行中 ⇒ 按钮禁用", () => {
    const onRetry = vi.fn();
    const { rerender } = render(<VariantsPanel {...base} onRetry={onRetry} state={{ kind: "error", message: "没能出方案（服务暂不可用）" }} onPick={vi.fn()} />);
    expect(screen.getByRole("alert").textContent).toContain("没能出方案");
    fireEvent.click(screen.getByText("再试一次"));
    expect(onRetry).toHaveBeenCalledOnce();
    rerender(<VariantsPanel {...base} picking state={{ kind: "ready", items: ["甲", "乙"].map(variant) }} onPick={vi.fn()} />);
    expect((screen.getByTestId("design-variant-pick-0") as HTMLButtonElement).disabled).toBe(true);
  });
});

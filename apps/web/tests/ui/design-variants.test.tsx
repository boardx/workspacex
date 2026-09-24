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
  tokens: designWorkbench.DEFAULT_DESIGN_TOKENS, theme: "light" as const, picking: false, onClose: vi.fn(), onRegenerate: vi.fn(), current: null,
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
    const onRegenerate = vi.fn();
    const { rerender } = render(<VariantsPanel {...base} onRegenerate={onRegenerate} state={{ kind: "error", message: "没能出方案（服务暂不可用）" }} onPick={vi.fn()} />);
    expect(screen.getByRole("alert").textContent).toContain("没能出方案");
    fireEvent.click(screen.getByText("再试一次"));
    expect(onRegenerate).toHaveBeenCalledWith({ count: designWorkbench.PROTOTYPE_VARIANTS_DEFAULT });
    rerender(<VariantsPanel {...base} picking state={{ kind: "ready", items: ["甲", "乙"].map(variant) }} onPick={vi.fn()} />);
    expect((screen.getByTestId("design-variant-pick-0") as HTMLButtonElement).disabled).toBe(true);
  });
});

describe("深度 S9（#3988）：对照、提要求、要几个", () => {
  it("方案旁边摆着「当前」这一页（没有「用这个」——它已经是了），出方案中也在", () => {
    // ⭐ 反证锚点：不传 / 不画 `current` ⇒ 这条红——挑方案只能凭记忆比。
    const current = variant("原样").root;
    const { rerender } = render(<VariantsPanel {...base} current={current} state={{ kind: "loading" }} onPick={vi.fn()} />);
    expect(screen.getByTestId("design-variant-current").textContent).toContain("会员 · 原样");
    rerender(<VariantsPanel {...base} current={current} state={{ kind: "ready", items: ["甲", "乙"].map(variant) }} onPick={vi.fn()} />);
    const cur = screen.getByTestId("design-variant-current");
    expect(cur.textContent).toContain("当前");
    expect(cur.querySelector("button")).toBeNull();
    expect(screen.getAllByTestId("design-variant-canvas")).toHaveLength(3);
  });

  it("写一句要求、选要几个，「再出一组」带着它们；空白要求不发；出方案中不能再点", () => {
    const onRegenerate = vi.fn();
    const { rerender } = render(<VariantsPanel {...base} onRegenerate={onRegenerate} state={{ kind: "ready", items: ["甲", "乙", "丙"].map(variant) }} onPick={vi.fn()} />);
    const count = screen.getByTestId("design-variants-count") as HTMLSelectElement;
    expect([...count.options].map((o) => Number(o.value))).toEqual([2, 3, 4]);
    expect(Number(count.value)).toBe(designWorkbench.PROTOTYPE_VARIANTS_DEFAULT);
    fireEvent.change(screen.getByTestId("design-variants-instruction"), { target: { value: "  " } });
    fireEvent.click(screen.getByTestId("design-variants-regenerate"));
    expect(onRegenerate).toHaveBeenLastCalledWith({ count: 3 });
    fireEvent.change(screen.getByTestId("design-variants-instruction"), { target: { value: " 更简洁 " } });
    fireEvent.change(count, { target: { value: "2" } });
    fireEvent.click(screen.getByTestId("design-variants-regenerate"));
    expect(onRegenerate).toHaveBeenLastCalledWith({ count: 2, instruction: "更简洁" });
    rerender(<VariantsPanel {...base} onRegenerate={onRegenerate} state={{ kind: "loading" }} onPick={vi.fn()} />);
    expect((screen.getByTestId("design-variants-regenerate") as HTMLButtonElement).disabled).toBe(true);
  });
});

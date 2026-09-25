/**
 * 对标 R6（#3933）—— 预览里控件是活的。
 *
 * 钉住：预览态下 tabs 能切、开关能拨、勾选能勾、chip 能选、单选能点、输入框能打字、下拉是原生 <select>；
 * 有跳转的项跳转优先；编辑态完全不变（点 = 选中节点，控件是画上去的，不抢节点的点击）；
 * 设计里的初值变了，预览状态跟着重置。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import * as React from "react";
import { PrototypeCanvas } from "@/components/design-loop/prototype-canvas";

afterEach(() => cleanup());

const page = {
  type: "stack" as const, id: "root", children: [
    { type: "tabs" as const, id: "tabs", props: { items: ["详情", "规格", "评价"], active: 0 } },
    { type: "switch" as const, id: "sw", props: { label: "自动续费", on: false } },
    { type: "checkbox" as const, id: "cb", props: { label: "同意协议" } },
    { type: "chip" as const, id: "chip", props: { label: "18:00" } },
    { type: "radio" as const, id: "ra", props: { options: ["男", "女"], selected: 0 } },
    { type: "input" as const, id: "in", props: { label: "优惠码", placeholder: "输入优惠码" } },
    { type: "select" as const, id: "se", props: { label: "城市", options: ["北京", "上海"], value: "北京" } },
  ],
};

describe("预览态：控件是活的", () => {
  it("tabs 切换、开关拨动、勾选、chip 选中、单选改选——都是真的角色 + aria 状态", () => {
    // ⭐ 反证锚点：预览里控件没有状态（画上去的）⇒ 这条红——演示时点「规格」不动、拨开关不动。
    render(<PrototypeCanvas label="x" root={page} mode="preview" />);
    const tab = screen.getByRole("tab", { name: "规格" });
    fireEvent.click(tab);
    expect(tab.getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("tab", { name: "详情" }).getAttribute("aria-selected")).toBe("false");

    const sw = screen.getByRole("switch", { name: "自动续费" });
    expect(sw.getAttribute("aria-checked")).toBe("false");
    fireEvent.click(sw);
    expect(sw.getAttribute("aria-checked")).toBe("true");
    fireEvent.keyDown(sw, { key: " " });
    expect(sw.getAttribute("aria-checked")).toBe("false");

    const cb = screen.getByRole("checkbox", { name: "同意协议" });
    fireEvent.click(cb);
    expect(cb.getAttribute("aria-checked")).toBe("true");

    const chip = screen.getByRole("button", { name: "18:00" });
    fireEvent.click(chip);
    expect(chip.getAttribute("aria-pressed")).toBe("true");

    fireEvent.click(screen.getByRole("radio", { name: "女" }));
    expect(screen.getByRole("radio", { name: "女" }).getAttribute("aria-checked")).toBe("true");
    expect(screen.getByRole("radio", { name: "男" }).getAttribute("aria-checked")).toBe("false");
  });

  it("输入框是真的 <input>，能打字；下拉是原生 <select>，当前值是设计里的值", () => {
    render(<PrototypeCanvas label="x" root={page} mode="preview" />);
    const input = screen.getByRole("textbox", { name: "优惠码" }) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "VIP30" } });
    expect(input.value).toBe("VIP30");
    const select = screen.getByRole("combobox", { name: "城市" }) as HTMLSelectElement;
    expect(select.value).toBe("北京");
  });

  it("有跳转的 tab：跳转优先（换页），不是只切选中", () => {
    const onNavigate = vi.fn();
    render(<PrototypeCanvas label="x" root={page} mode="preview" links={[{ from: "tabs", item: 2, to: 1 }]} onNavigate={onNavigate} />);
    fireEvent.click(screen.getByText("评价"));
    expect(onNavigate).toHaveBeenCalledWith(1);
  });

  it("设计里的初值变了（属性面板改了 on）⇒ 预览状态跟着重置", () => {
    const { rerender } = render(<PrototypeCanvas label="x" root={page} mode="preview" />);
    fireEvent.click(screen.getByRole("switch", { name: "自动续费" }));
    const on = { ...page, children: page.children.map((c) => (c.id === "sw" ? { ...c, props: { label: "自动续费", on: true } } : c)) };
    rerender(<PrototypeCanvas label="x" root={on as typeof page} mode="preview" />);
    expect(screen.getByRole("switch", { name: "自动续费" }).getAttribute("aria-checked")).toBe("true");
  });
});

describe("编辑态不变", () => {
  it("控件是画上去的：没有 switch / checkbox / tab / textbox 角色，点它 = 选中节点", () => {
    const onSelect = vi.fn();
    render(<PrototypeCanvas label="x" root={page} mode="edit" onSelect={onSelect} />);
    expect(screen.queryByRole("switch")).toBeNull();
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(screen.queryByRole("tab")).toBeNull();
    expect(screen.queryByRole("textbox")).toBeNull();
    fireEvent.click(screen.getByText("自动续费"));
    expect(onSelect).toHaveBeenCalledWith("sw");
  });
});

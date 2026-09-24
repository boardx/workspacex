/**
 * 对标 R4（#3933）—— 下拉、单选、叠层。
 *
 * 钉住：下拉显示当前值（没有值时显示占位、弱化）；单选是真的 radiogroup，选中项 aria-checked；
 * 叠层盖满整屏（遮罩 + 居中的对话框），轻提示不带遮罩（不打断操作）；底部弹层贴底。
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import * as React from "react";
import { PrototypeCanvas } from "@/components/design-loop/prototype-canvas";
import { describeNode } from "@/lib/design-doc-markdown";

afterEach(() => cleanup());

describe("下拉与单选", () => {
  it("下拉显示当前值；没有值时显示占位文字", () => {
    const { rerender } = render(<PrototypeCanvas label="x" root={{ type: "select", id: "s", props: { label: "城市", options: ["北京", "上海"], value: "上海" } }} />);
    expect(document.querySelector('[data-proto="select"]')!.textContent).toContain("上海");
    rerender(<PrototypeCanvas label="x" root={{ type: "select", id: "s", props: { options: ["北京", "上海"], placeholder: "请选择城市" } }} />);
    expect(document.querySelector('[data-proto="select"]')!.textContent).toContain("请选择城市");
  });

  it("单选是 radiogroup，选中项 aria-checked=true，其余 false", () => {
    // ⭐ 反证锚点：单选画成三个普通 span（没有 role/aria-checked）⇒ 这条红，读屏器分不出选中的是哪个。
    render(<PrototypeCanvas label="x" root={{ type: "radio", id: "r", props: { label: "性别", options: ["男", "女", "不透露"], selected: 2 } }} />);
    const radios = screen.getAllByRole("radio");
    expect(radios.map((r) => r.getAttribute("aria-checked"))).toEqual(["false", "false", "true"]);
    expect(screen.getByRole("radiogroup").getAttribute("aria-label")).toBe("性别");
  });
});

describe("叠层", () => {
  const page = (kind: "modal" | "sheet" | "toast") => ({
    type: "stack" as const, id: "root", children: [
      { type: "list" as const, id: "l", props: { items: ["个人资料"] } },
      { type: "overlay" as const, id: "o", props: { kind, title: "确定注销账号？" }, children: [{ type: "button" as const, id: "ok", props: { label: "确认注销", variant: "danger" as const } }] },
    ],
  });

  it("弹窗：有遮罩、有 dialog、标题与里面的内容都画出来；叠层以画布内容区为定位基准", () => {
    render(<PrototypeCanvas label="x" root={page("modal")} />);
    expect(document.querySelector("[data-overlay-scrim]")).not.toBeNull();
    expect(screen.getByRole("dialog").getAttribute("aria-label")).toBe("确定注销账号？");
    expect(screen.getByRole("dialog").textContent).toContain("确认注销");
    expect(screen.getByTestId("design-detail-phone-tree").className).toMatch(/\brelative\b/);
  });

  it("轻提示：不带遮罩（不打断操作），角色是 status", () => {
    render(<PrototypeCanvas label="x" root={page("toast")} />);
    expect(document.querySelector("[data-overlay-scrim]")).toBeNull();
    expect(screen.getByRole("status").textContent).toContain("确定注销账号？");
  });

  it("底部弹层贴底", () => {
    render(<PrototypeCanvas label="x" root={page("sheet")} />);
    expect(document.querySelector('[data-proto="overlay"]')!.className).toMatch(/\bitems-end\b/);
  });

  it("设计文档写出叠层类型与表单选项", () => {
    expect(describeNode({ type: "overlay", props: { kind: "sheet", title: "选择配送方式" }, children: [] })).toBe("底部弹层「选择配送方式」");
    expect(describeNode({ type: "radio", props: { label: "性别", options: ["男", "女"], selected: 1 } })).toBe("单选「性别」：男 / ●女");
  });
});

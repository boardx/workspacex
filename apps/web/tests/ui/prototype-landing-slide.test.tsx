/**
 * 对标 R5（#3933）—— 落地页的分区与页脚、16:9 幻灯片。
 *
 * 钉住：分区是通栏的 <section>，底色随 tone；主色区里的主按钮/头图按钮反色（主色上的主按钮等于隐形）；
 * 页脚写出品牌、链接、小字；幻灯片设备没有状态栏与 home 条，内容按一半尺寸排版再放大 2 倍。
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import * as React from "react";
import { PrototypeCanvas } from "@/components/design-loop/prototype-canvas";
import { presetById } from "@/lib/prototype-devices";

afterEach(() => cleanup());

const landing = {
  type: "stack" as const, id: "root", props: { padding: "none" as const, gap: "none" as const }, children: [
    { type: "section" as const, id: "s1", props: { tone: "primary" as const, align: "center" as const }, children: [
      { type: "hero" as const, id: "h", props: { title: "五分钟搞定一个月的账", subtitle: "自动对账", cta: "免费试用" } },
      { type: "button" as const, id: "b", props: { label: "预约演示" } },
    ] },
    { type: "section" as const, id: "s2", props: { tone: "muted" as const }, children: [{ type: "text" as const, id: "t", props: { content: "为什么选轻账" } }] },
    { type: "footer" as const, id: "f", props: { brand: "轻账", links: ["产品", "隐私政策"], note: "© 2026 轻账科技" } },
  ],
};

describe("落地页", () => {
  it("分区是 <section>，底色随 tone；页脚是 <footer>，写出品牌、链接与小字", () => {
    render(<PrototypeCanvas label="首页" root={landing} />);
    const sections = document.querySelectorAll('section[data-proto="section"]');
    expect([...sections].map((s) => s.getAttribute("data-tone"))).toEqual(["primary", "muted"]);
    expect(sections[1]!.className).toMatch(/\bbg-panel\b/);
    const footer = document.querySelector('footer[data-proto="footer"]')!;
    expect(footer.textContent).toContain("轻账");
    expect(footer.textContent).toContain("隐私政策");
    expect(footer.textContent).toContain("© 2026 轻账科技");
  });

  it("主色区里：主按钮与头图按钮反色（前景色做底），不跟底色融成一片", () => {
    // ⭐ 反证锚点：去掉 primary 区上那组 arbitrary variant ⇒ 这条红——主色上的主按钮等于隐形。
    render(<PrototypeCanvas label="首页" root={landing} />);
    const band = document.querySelector('[data-tone="primary"]')!.className;
    expect(band).toContain("[&_[data-variant=primary]]:bg-primary-foreground");
    expect(band).toContain("[&_[data-hero-cta]]:bg-primary-foreground");
    expect(document.querySelector('[data-node-id="b"]')!.getAttribute("data-variant")).toBe("primary");
  });
});

describe("幻灯片设备", () => {
  it("16:9、没有状态栏与 home 条；内容按一半尺寸排版再放大 2 倍", () => {
    const slide = presetById("slide");
    expect(slide.w / slide.h).toBeCloseTo(16 / 9, 2);
    render(<PrototypeCanvas label="封面" root={{ type: "text", id: "t", props: { content: "轻账", variant: "title" } }} device={slide} />);
    const phone = screen.getByTestId("design-detail-phone");
    expect(phone.getAttribute("data-chrome")).toBe("slide");
    expect(phone.textContent).not.toContain("9:41");
    const tree = screen.getByTestId("design-detail-phone-tree");
    expect(tree.getAttribute("data-slide-scale")).toBe("2");
    expect(tree.style.transform).toBe("scale(2)");
  });

  it("手机设备不受影响：没有放大", () => {
    render(<PrototypeCanvas label="首页" root={{ type: "text", id: "t", props: { content: "x" } }} device={presetById("iphone")} />);
    expect(screen.getByTestId("design-detail-phone-tree").style.transform).toBe("");
  });
});

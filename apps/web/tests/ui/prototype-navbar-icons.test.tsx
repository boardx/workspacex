/**
 * 2026-09-27 用户截图：导航栏上直接印着英文「back」「search」。真实生成的 79 页里左右两侧 23 次写的是图标名。
 * 规则只在 `lib/prototype-navbar.ts` 一处，画布与 React 导出共用。
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import * as React from "react";
import { PrototypeCanvas } from "@/components/design-loop/prototype-canvas";
import { navbarSide } from "@/lib/prototype-navbar";
import { buildPrototypeReactTsx } from "@/lib/prototype-react-export";
import type { PrototypeNode } from "@/lib/live-design-workbench";

afterEach(cleanup);
const nav = (left?: string, right?: string): PrototypeNode => ({ id: "nv", type: "navbar", props: { title: "白板空间", ...(left ? { left } : {}), ...(right ? { right } : {}) } });

describe("navbarSide", () => {
  it("图标名 ⇒ 图标（读屏名给中文）；中文 ⇒ 原样文字；空 ⇒ 没有", () => {
    expect(navbarSide("back")).toEqual({ icon: "back", label: "返回" });
    expect(navbarSide("search")).toEqual({ icon: "search", label: "搜索" });
    expect(navbarSide("返回")).toEqual({ text: "返回" });
    expect(navbarSide("")).toBeNull();
    expect(navbarSide(undefined)).toBeNull();
  });
});

describe("画布上的导航栏", () => {
  it("⭐ 反证锚点：left=back / right=search ⇒ 画成图标，导航栏上不再出现英文单词", () => {
    const { container } = render(<PrototypeCanvas label="页" root={nav("back", "search")} />);
    const bar = container.querySelector('[data-proto="navbar"]')!;
    expect(bar.textContent).not.toMatch(/back|search/);
    expect(bar.querySelector('[data-nav-icon="back"]')?.getAttribute("aria-label")).toBe("返回");
    expect(bar.querySelector('[data-nav-icon="search"]')?.getAttribute("aria-label")).toBe("搜索");
  });
  it("写的是字（「返回」「保存」）⇒ 照旧是字", () => {
    const { container } = render(<PrototypeCanvas label="页" root={nav("返回", "保存")} />);
    expect(container.querySelector('[data-proto="navbar"]')!.textContent).toContain("返回");
    expect(container.querySelector('[data-proto="navbar"] [data-nav-icon]')).toBeNull();
  });
});

describe("React 导出的导航栏（与画布同一条规则）", () => {
  it("left=back ⇒ 导出的是带读屏名的图标，不是字面 back", () => {
    const tsx = buildPrototypeReactTsx(
      { name: "白板", frames: ["首页"], prototype: [{ id: "r", type: "stack", children: [nav("back")] }], frameLinks: [[]], accent: "neutral", tokens: { brand: null, font: "sans", radius: "default", density: "default" }, theme: "light" } as never,
      { icons: { back: '<svg viewBox="0 0 24 24"><path d="M15 18l-6-6 6-6"/></svg>' } },
    );
    expect(tsx).toContain('aria-label={"返回"}');
    expect(tsx).not.toContain('{"back"}');
  });
});

/**
 * 侧栏默认宽度**不得与 tailwind 里那份分叉**。
 *
 * `PANEL_DEFAULT_WIDTH` 里的 272 / 316 就是 `tailwind.config.ts` 的
 * `width: { panel, "panel-alt" }`——让一条栏变得可拖拽时默认观感必须逐字不变。
 * 两处副本没法消除（一处给 CSS 类，一处给内联像素值），那就让它们分叉时会红。
 */
import { describe, expect, it } from "vitest";
import config from "../../tailwind.config";
import { PANEL_DEFAULT_WIDTH, defaultPanelWidth } from "@/lib/chat-workbench/panel-width";

const widths = (config.theme?.extend?.width ?? {}) as Record<string, string>;
const px = (token: string): number => Number.parseInt(widths[token] ?? "", 10);

describe("默认宽度与 tailwind 一致", () => {
  it("shell-left == w-panel", () => {
    expect(PANEL_DEFAULT_WIDTH["shell-left"]).toBe(px("panel"));
  });
  it("shell-right == w-panel-alt", () => {
    expect(PANEL_DEFAULT_WIDTH["shell-right"]).toBe(px("panel-alt"));
  });
  it("这两个 token 真的存在——读不到时上面两条会拿 NaN 比，反而恒绿", () => {
    expect(Number.isFinite(px("panel"))).toBe(true);
    expect(Number.isFinite(px("panel-alt"))).toBe(true);
  });
  it("没登记过的侧栏退回通用默认值", () => {
    expect(defaultPanelWidth("someone-else")).toBe(288);
  });
});

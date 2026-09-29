import * as React from "react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Metamorphosis } from "@/components/entry/metamorphosis";
import { BUTTERFLY_PATH } from "@/components/chat/run-progress-butterfly";

/**
 * 登录页品牌栏「蜕变」动画：三段文案是真实文本、图形纯装饰、蝴蝶复用既有 path、
 * 每个动画元素都有 reduced-motion 降级、keyframes 只在 tailwind.config.ts 定义一处。
 */
describe("auth metamorphosis animation", () => {
  it("renders the three transformation stages as readable text", () => {
    render(<Metamorphosis />);
    const root = screen.getByTestId("auth-metamorphosis");
    const items = within(root).getAllByRole("listitem");
    expect(items.map((li) => li.textContent)).toEqual([
      expect.stringContaining("结茧"),
      expect.stringContaining("破茧"),
      expect.stringContaining("展翅"),
    ]);
  });

  it("keeps the illustration decorative and reuses the shared butterfly path", () => {
    render(<Metamorphosis />);
    const svg = screen.getByTestId("auth-metamorphosis").querySelector("svg");
    expect(svg).toHaveAttribute("aria-hidden");
    expect(svg!.querySelector(`path[d="${BUTTERFLY_PATH}"]`)).not.toBeNull();
  });

  it("gives every animated element a reduced-motion fallback", () => {
    render(<Metamorphosis />);
    const animated = screen
      .getByTestId("auth-metamorphosis")
      .querySelectorAll('[class*="animate-"]');
    expect(animated.length).toBeGreaterThan(0);
    for (const el of animated) {
      expect(el.getAttribute("class")).toMatch(/motion-reduce:(animate-none|hidden)/);
    }
  });

  it("defines the meta-* keyframes only in tailwind.config.ts", () => {
    const config = readFileSync(resolve(__dirname, "../../tailwind.config.ts"), "utf8");
    const css = readFileSync(resolve(__dirname, "../../app/globals.css"), "utf8");
    for (const name of ["meta-chrysalis", "meta-burst", "meta-butterfly", "meta-step", "meta-step-bar"]) {
      expect(config).toContain(`"${name}": {`);
      expect(css).not.toContain(`@keyframes ${name}`);
    }
  });
});

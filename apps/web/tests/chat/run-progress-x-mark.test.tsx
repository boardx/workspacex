/**
 * issue #2769 —— /chat run 进度卡的 spinner 换成 X 图形标动画，钉住 issue 列出的硬约束：
 *   · 一个元素、一段 keyframes：标记就是一个 `<svg>`，里面一条 path（四瓣合成），
 *     动画类只挂在它身上；keyframes 只在 `tailwind.config.ts` 定义一处（不在 globals.css
 *     再抄一份——同一事实不得声明在两处）。
 *   · reduced-motion 降级静态：`motion-reduce:animate-none` 与 `animate-x-*` 同在。
 *   · 颜色/尺寸走 token：`fill="currentColor"` + `text-ai`，`h-3 w-3`；不出现色值字面量。
 *   · 面板 body 里那一行：`Loader2` 不再出现在 thinking 行，`RunProgressXMark` 顶上；
 *     阶段文案 / 计时 testid 一个没动（`copilotkit-v2-thinking-phase` / `-elapsed` /
 *     `-stage` 都还在——这三处 testid 被 e2e 当"跑完没有"的信号在用，见 body 那段注释）。
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { RunProgressXMark, X_MARK_PATH } from "@/components/chat/run-progress-x-mark";

const tailwindConfig = readFileSync(resolve(__dirname, "../../tailwind.config.ts"), "utf8");
const panelBody = readFileSync(
  resolve(__dirname, "../../components/chat/copilotkit-v2-panel-body.tsx"),
  "utf8",
);
const globalsCss = readFileSync(resolve(__dirname, "../../app/globals.css"), "utf8");

describe("RunProgressXMark（issue #2769）", () => {
  it("是一个 svg 元素 + 一条 path，path 由四瓣（四段 M…Z）合成", () => {
    render(<RunProgressXMark />);
    const mark = screen.getByTestId("copilotkit-v2-thinking-mark");
    expect(mark.tagName.toLowerCase()).toBe("svg");
    expect(mark).toHaveAttribute("aria-hidden");
    const paths = mark.querySelectorAll("path");
    expect(paths).toHaveLength(1);
    expect(paths[0]).toHaveAttribute("d", X_MARK_PATH);
    expect(X_MARK_PATH.match(/Z/g)).toHaveLength(4);
    expect(mark.querySelectorAll("*")).toHaveLength(1);
  });

  it("默认方案 A（breathe）：animate-x-breathe + motion-reduce:animate-none 同在", () => {
    render(<RunProgressXMark />);
    const mark = screen.getByTestId("copilotkit-v2-thinking-mark");
    expect(mark).toHaveAttribute("data-motion", "breathe");
    expect(mark).toHaveClass("animate-x-breathe", "motion-reduce:animate-none");
    expect(mark).not.toHaveClass("animate-spin");
  });

  it("方案 B（turn）只换动画类，reduced-motion 降级不变", () => {
    render(<RunProgressXMark motion="turn" />);
    const mark = screen.getByTestId("copilotkit-v2-thinking-mark");
    expect(mark).toHaveClass("animate-x-turn", "motion-reduce:animate-none");
    expect(mark).not.toHaveClass("animate-x-breathe");
  });

  it("颜色与尺寸走 token：currentColor + text-ai + h-3 w-3，无色值字面量", () => {
    render(<RunProgressXMark />);
    const mark = screen.getByTestId("copilotkit-v2-thinking-mark");
    expect(mark).toHaveAttribute("fill", "currentColor");
    expect(mark).toHaveClass("text-ai", "h-3", "w-3");
    expect(mark.outerHTML).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgb\(|hsl\(/);
  });

  it("keyframes 只在 tailwind.config.ts 定义一处（x-breathe / x-turn），globals.css 不重复", () => {
    expect(tailwindConfig.match(/"x-breathe":\s*\{/g)).toHaveLength(1);
    expect(tailwindConfig.match(/"x-turn":\s*\{/g)).toHaveLength(1);
    expect(tailwindConfig).toMatch(/"x-breathe":\s*"x-breathe [^"]*infinite"/);
    expect(tailwindConfig).toMatch(/"x-turn":\s*"x-turn [^"]*infinite"/);
    expect(globalsCss).not.toMatch(/@keyframes\s+x-(breathe|turn)/);
  });

  it("面板 body 的 thinking 行用 RunProgressXMark 顶替 Loader2；阶段/计时 testid 原样保留", () => {
    const thinkingRow = panelBody.slice(
      panelBody.indexOf('data-testid="copilotkit-v2-thinking"'),
      panelBody.indexOf('data-testid="copilotkit-v2-thinking-longrun-hint"'),
    );
    expect(thinkingRow).toContain("<RunProgressXMark />");
    expect(thinkingRow).not.toContain("<Loader2");
    expect(thinkingRow).toContain('data-testid="copilotkit-v2-thinking-phase"');
    expect(thinkingRow).toContain('data-testid="copilotkit-v2-thinking-elapsed"');
    expect(thinkingRow).toContain("· 已用 {runProgress.elapsedSeconds} 秒");
    expect(panelBody).toContain('data-testid="copilotkit-v2-thinking-stage"');
    expect(panelBody).toContain('key === runProgress.stage && "font-medium text-card-foreground"');
  });
});

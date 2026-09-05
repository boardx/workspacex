/**
 * issue #2785 —— /chat run 进度卡的 X 图形标换成蝴蝶主题动画，钉住 issue 列出的硬约束：
 *   · 一个元素、一段 keyframes：标记就是一个 `<svg>`，里面一条 path（5 段合成：身体 +
 *     上下两对翅膀），动画类只挂在它身上；keyframes 只在 `tailwind.config.ts` 定义一处
 *     （不在 globals.css 再抄一份——同一事实不得声明在两处）。
 *   · reduced-motion 降级静态：`motion-reduce:animate-none` 与 `animate-butterfly-*` 同在。
 *   · 颜色/尺寸走 token：`fill="currentColor"` + `text-ai`，`h-3 w-3`；不出现色值字面量。
 *   · 面板 body 里那一行：`RunProgressXMark`（issue #2769 的 X 图形标）不再出现在 thinking
 *     行，`RunProgressButterfly` 顶上；阶段文案 / 计时 testid 一个没动
 *     （`copilotkit-v2-thinking-phase` / `-elapsed` / `-stage` 都还在——这三处 testid
 *     被 e2e 当"跑完没有"的信号在用，见 body 那段注释）。
 *   · 旧的 X 图形标组件/测试/keyframes 已整体退役，不留死代码。
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { RunProgressButterfly, BUTTERFLY_PATH } from "@/components/chat/run-progress-butterfly";

const tailwindConfig = readFileSync(resolve(__dirname, "../../tailwind.config.ts"), "utf8");
const panelBody = readFileSync(
  resolve(__dirname, "../../components/chat/copilotkit-v2-panel-body.tsx"),
  "utf8",
);
const globalsCss = readFileSync(resolve(__dirname, "../../app/globals.css"), "utf8");

describe("RunProgressButterfly（issue #2785）", () => {
  it("是一个 svg 元素 + 一条 path，path 由 5 段（身体 + 两对翅膀）合成", () => {
    render(<RunProgressButterfly />);
    const mark = screen.getByTestId("copilotkit-v2-thinking-mark");
    expect(mark.tagName.toLowerCase()).toBe("svg");
    expect(mark).toHaveAttribute("aria-hidden");
    const paths = mark.querySelectorAll("path");
    expect(paths).toHaveLength(1);
    expect(paths[0]).toHaveAttribute("d", BUTTERFLY_PATH);
    expect(BUTTERFLY_PATH.match(/Z/g)).toHaveLength(5);
    expect(mark.querySelectorAll("*")).toHaveLength(1);
  });

  it("默认方案 A（flap）：animate-butterfly-flap + motion-reduce:animate-none 同在", () => {
    render(<RunProgressButterfly />);
    const mark = screen.getByTestId("copilotkit-v2-thinking-mark");
    expect(mark).toHaveAttribute("data-motion", "flap");
    expect(mark).toHaveClass("animate-butterfly-flap", "motion-reduce:animate-none");
    expect(mark).not.toHaveClass("animate-spin", "animate-x-breathe", "animate-x-turn");
  });

  it("方案 B（drift）只换动画类，reduced-motion 降级不变", () => {
    render(<RunProgressButterfly motion="drift" />);
    const mark = screen.getByTestId("copilotkit-v2-thinking-mark");
    expect(mark).toHaveClass("animate-butterfly-drift", "motion-reduce:animate-none");
    expect(mark).not.toHaveClass("animate-butterfly-flap");
  });

  it("颜色与尺寸走 token：currentColor + text-ai + h-3 w-3，无色值字面量", () => {
    render(<RunProgressButterfly />);
    const mark = screen.getByTestId("copilotkit-v2-thinking-mark");
    expect(mark).toHaveAttribute("fill", "currentColor");
    expect(mark).toHaveClass("text-ai", "h-3", "w-3");
    expect(mark.outerHTML).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgb\(|hsl\(/);
  });

  it("keyframes 只在 tailwind.config.ts 定义一处（butterfly-flap / butterfly-drift），globals.css 不重复；旧 X 标 keyframes 已退役", () => {
    expect(tailwindConfig.match(/"butterfly-flap":\s*\{/g)).toHaveLength(1);
    expect(tailwindConfig.match(/"butterfly-drift":\s*\{/g)).toHaveLength(1);
    expect(tailwindConfig).toMatch(/"butterfly-flap":\s*"butterfly-flap [^"]*infinite"/);
    expect(tailwindConfig).toMatch(/"butterfly-drift":\s*"butterfly-drift [^"]*infinite"/);
    expect(globalsCss).not.toMatch(/@keyframes\s+butterfly-(flap|drift)/);
    expect(tailwindConfig).not.toMatch(/"x-breathe"|"x-turn"/);
  });

  it("面板 body 的 thinking 行用 RunProgressButterfly 顶替 RunProgressXMark；阶段/计时 testid 原样保留", () => {
    const thinkingRow = panelBody.slice(
      panelBody.indexOf('data-testid="copilotkit-v2-thinking"'),
      panelBody.indexOf('data-testid="copilotkit-v2-thinking-longrun-hint"'),
    );
    expect(thinkingRow).toContain("<RunProgressButterfly />");
    expect(thinkingRow).not.toContain("<RunProgressXMark");
    expect(thinkingRow).not.toContain("<Loader2");
    expect(thinkingRow).toContain('data-testid="copilotkit-v2-thinking-phase"');
    expect(thinkingRow).toContain('data-testid="copilotkit-v2-thinking-elapsed"');
    expect(thinkingRow).toContain("· 已用 {runProgress.elapsedSeconds} 秒");
    expect(panelBody).toContain('data-testid="copilotkit-v2-thinking-stage"');
    expect(panelBody).toContain('key === runProgress.stage && "font-medium text-card-foreground"');
  });
});

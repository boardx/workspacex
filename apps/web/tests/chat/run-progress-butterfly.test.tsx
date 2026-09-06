/**
 * issue #2785 —— /chat run 进度卡的 X 图形标换成蝴蝶主题动画，钉住 issue 列出的硬约束：
 *   · 一个元素、一段 keyframes：标记就是一个 `<svg>`，里面一条 path（5 段合成：身体 +
 *     上下两对翅膀），动画类只挂在它身上；keyframes 只在 `tailwind.config.ts` 定义一处
 *     （不在 globals.css 再抄一份——同一事实不得声明在两处）。
 *   · reduced-motion 降级静态：`motion-reduce:animate-none` 与 `animate-butterfly-*` 同在。
 *   · 颜色/尺寸走 token：`fill="currentColor"` + `text-ai`，`h-7 w-7`；不出现色值字面量。
 *   · 面板 body 的进度卡：`RunProgressXMark`（issue #2769 的 X 图形标）不再出现，
 *     `RunProgressButterfly` 顶上；阶段文案 / 计时 testid 一个没动
 *     （`copilotkit-v2-thinking-phase` / `-elapsed` / `-stage` 都还在——这三处 testid
 *     被 e2e 当"跑完没有"的信号在用，见 body 那段注释）。
 *   · 旧的 X 图形标组件/测试/keyframes 已整体退役，不留死代码。
 *
 * issue #2837（2026-09-06 人类实测：太小、动效呆板）——默认方案改为 `fly`（flap + drift
 * 合成为同一段 `butterfly-fly` keyframes），默认尺寸 `h-3 w-3` → `h-7 w-7`；进度卡布局改成
 * 「左蝴蝶（竖向居中）+ 右两行文案」，蝴蝶因此移出 `copilotkit-v2-thinking` span、成为卡片
 * 的直接子节点；阶段行 `text-12`、思考/计时行 `text-13`，档位仍只取 `lib/font-scale.ts`。
 * PR #2839 review：卡片本体抽成 `run-progress-card.tsx`（panel body 超 2000 行 + 截图 harness
 * 不得抄第二份 className）——面板 body 与 harness 都只渲染这一个组件，本文件对它做 DOM 断言。
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { RunProgressButterfly, BUTTERFLY_PATH } from "@/components/chat/run-progress-butterfly";
import { RunProgressCard } from "@/components/chat/run-progress-card";

const tailwindConfig = readFileSync(resolve(__dirname, "../../tailwind.config.ts"), "utf8");
const panelBody = readFileSync(
  resolve(__dirname, "../../components/chat/copilotkit-v2-panel-body.tsx"),
  "utf8",
);
const globalsCss = readFileSync(resolve(__dirname, "../../app/globals.css"), "utf8");
const harness = readFileSync(
  resolve(__dirname, "../../.run-progress-butterfly-animation/harness.tsx"),
  "utf8",
);

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

  it("默认方案 C（fly，issue #2837）：animate-butterfly-fly + motion-reduce:animate-none 同在", () => {
    render(<RunProgressButterfly />);
    const mark = screen.getByTestId("copilotkit-v2-thinking-mark");
    expect(mark).toHaveAttribute("data-motion", "fly");
    expect(mark).toHaveClass("animate-butterfly-fly", "motion-reduce:animate-none");
    expect(mark).not.toHaveClass("animate-butterfly-flap", "animate-butterfly-drift");
    expect(mark).not.toHaveClass("animate-spin", "animate-x-breathe", "animate-x-turn");
  });

  it.each([
    ["flap", "animate-butterfly-flap"],
    ["drift", "animate-butterfly-drift"],
  ] as const)("方案 %s 只换动画类，reduced-motion 降级不变", (motion, cls) => {
    render(<RunProgressButterfly motion={motion} />);
    const mark = screen.getByTestId("copilotkit-v2-thinking-mark");
    expect(mark).toHaveAttribute("data-motion", motion);
    expect(mark).toHaveClass(cls, "motion-reduce:animate-none");
    expect(mark).not.toHaveClass("animate-butterfly-fly");
  });

  it("颜色与尺寸走 token：currentColor + text-ai + h-7 w-7（issue #2837 放大），无色值字面量", () => {
    render(<RunProgressButterfly />);
    const mark = screen.getByTestId("copilotkit-v2-thinking-mark");
    expect(mark).toHaveAttribute("fill", "currentColor");
    expect(mark).toHaveClass("text-ai", "h-7", "w-7");
    expect(mark).not.toHaveClass("h-3", "w-3");
    expect(mark.outerHTML).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgb\(|hsl\(/);
  });

  it("keyframes 只在 tailwind.config.ts 定义一处（butterfly-flap / -drift / -fly），globals.css 不重复；旧 X 标 keyframes 已退役", () => {
    for (const name of ["butterfly-flap", "butterfly-drift", "butterfly-fly"]) {
      expect(tailwindConfig.match(new RegExp(`"${name}":\\s*\\{`, "g")), name).toHaveLength(1);
      expect(tailwindConfig).toMatch(new RegExp(`"${name}":\\s*"${name} [^"]*infinite"`));
    }
    expect(globalsCss).not.toMatch(/@keyframes\s+butterfly-(flap|drift|fly)/);
    expect(tailwindConfig).not.toMatch(/"x-breathe"|"x-turn"/);
  });

  it("butterfly-fly 是 flap + drift 合成的一段 keyframes：一个周期上浮一次、扑翼两次（25%/75% 收翅）", () => {
    const fly = tailwindConfig.slice(
      tailwindConfig.indexOf('"butterfly-fly": {'),
      tailwindConfig.indexOf('animation: {'),
    );
    expect(fly).toMatch(/"25%":\s*\{\s*transform:\s*"translateY\([^)]+\)\s+rotate\([^)]+\)\s+scaleX\(0\.45\)"/);
    expect(fly).toMatch(/"75%":\s*\{\s*transform:\s*"translateY\([^)]+\)\s+rotate\([^)]+\)\s+scaleX\(0\.45\)"/);
    expect(fly).toMatch(/"50%":\s*\{\s*transform:\s*"translateY\(-0\.3rem\)[^"]*scaleX\(1\)"/);
    expect(fly).toMatch(/"0%, 100%":\s*\{\s*transform:\s*"translateY\(0\)[^"]*scaleX\(1\)"/);
  });

  it("RunProgressCard：左蝴蝶（卡片直接子节点）+ 右两行文案（issue #2837）；阶段/计时 testid 原样保留", () => {
    render(
      <RunProgressCard
        stage="acting"
        phaseLabel="正在执行技能脚本…"
        elapsedSeconds={7}
        isLongRun
        planStep={{ index: 2, total: 5, content: "读取材料" }}
      />,
    );
    const card = screen.getByTestId("copilotkit-v2-running-indicator");
    expect(card).toHaveAttribute("role", "status");
    expect(card).toHaveClass("items-center", "gap-3", "rounded-xl", "px-4", "py-3");
    expect(card).not.toHaveClass("rounded-lg", "px-3", "py-2");
    // 蝴蝶是卡片的直接子节点、在文案列之前（左侧竖向居中），不再嵌在 thinking 行里。
    const mark = screen.getByTestId("copilotkit-v2-thinking-mark");
    expect(mark.parentElement).toBe(card);
    expect(card.firstElementChild).toBe(mark);
    expect(mark).toHaveClass("h-7", "w-7", "animate-butterfly-fly");
    expect(screen.getByTestId("copilotkit-v2-thinking")).not.toContainElement(mark);
    const stage = screen.getByTestId("copilotkit-v2-thinking-stage");
    expect(stage).toHaveAttribute("data-stage", "acting");
    expect(stage).toHaveClass("text-12");
    expect(stage.textContent).toBe("准备→执行→回复");
    expect(stage.querySelector(".font-medium")?.textContent).toBe("执行");
    expect(screen.getByTestId("copilotkit-v2-thinking")).toHaveClass("text-13");
    expect(screen.getByTestId("copilotkit-v2-thinking-phase")).toHaveTextContent("正在执行技能脚本…");
    expect(screen.getByTestId("copilotkit-v2-thinking-elapsed")).toHaveTextContent("· 已用 7 秒");
    expect(screen.getByTestId("copilotkit-v2-thinking-longrun-hint")).toBeInTheDocument();
    expect(screen.getByTestId("copilotkit-v2-thinking-plan-step")).toHaveTextContent("第 2/5 步 · 读取材料");
  });

  it("RunProgressCard：stage 为 null 不编默认阶段；无计划 / 无计时 / 非长任务时对应行不渲染", () => {
    render(<RunProgressCard stage={null} phaseLabel="正在思考…" elapsedSeconds={null} isLongRun={false} planStep={null} />);
    expect(screen.queryByTestId("copilotkit-v2-thinking-stage")).toBeNull();
    expect(screen.queryByTestId("copilotkit-v2-thinking-elapsed")).toBeNull();
    expect(screen.queryByTestId("copilotkit-v2-thinking-longrun-hint")).toBeNull();
    expect(screen.queryByTestId("copilotkit-v2-thinking-plan-step")).toBeNull();
    expect(screen.getByTestId("copilotkit-v2-thinking-phase")).toHaveTextContent("正在思考…");
  });

  it("面板 body 与截图 harness 都只渲染 RunProgressCard，不再各抄一份卡片（同一事实只声明一处）", () => {
    for (const [name, src] of [["panelBody", panelBody], ["harness", harness]] as const) {
      expect(src, name).toContain("<RunProgressCard");
      expect(src, name).not.toContain('data-testid="copilotkit-v2-running-indicator"');
      expect(src, name).not.toContain('data-testid="copilotkit-v2-thinking-stage"');
      expect(src, name).not.toContain("<RunProgressXMark");
      expect(src, name).not.toContain("RUN_STAGE_ORDER");
    }
    // running 判据仍在调用方：在跑（或恢复核实窗口）才渲染，跑完不在——e2e 靠这个信号。
    const runningBlock = panelBody.match(
      /\(agent\.isRunning \|\| runRestore\.isRestoring\) \? \(\s*<RunProgressCard[\s\S]*?\/>\s*\) : null\}/,
    );
    expect(runningBlock).not.toBeNull();
    expect(runningBlock?.[0]).not.toContain("<Loader2");
    expect(runningBlock?.[0]).toContain("planStep={planStep}");
  });
});

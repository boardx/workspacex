import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * lint-run-status-view-single-source.test.ts —— **「这条 run 现在处于什么状态」
 * 只许有一份派生，且它必须在契约里。**
 *
 * ## 背景（issue #3365，人类 devapp 实测：一屏五处互相矛盾）
 *
 * 同一份权威读账本（`phase:"executing" / steps:[completed,completed] /
 * progress:{completed:2,total:2}`）在屏幕上同时说出：「执行中」「2/2 步已标记完成」
 * 「当前步骤 = 已完成的第 2 步」「进度条 50%」「阶段 = 执行」。五处各读各的量。
 *
 * 这是本仓第十三例「同一事实声明在两处」。#3321 收敛的是**显示/不显示**
 * （`derivePlanSurface`），本文件门控的是**显示什么状态文字与进度**
 * （`deriveRunStatusView`）——两件不同的事，不要合并。
 *
 * ⚠ 纯静态文本断言。它挡的是「有人又在展示层里长出第二份状态推导」这件结构性的事；
 * 判「那份推导对不对」是 `packages/contracts/tests/plan-control/run-status-view-single-source.test.ts`
 * 的全叉积真值表，两者分工不重叠。
 */

const ROOT = join(__dirname, "..", "..");
const HOST = join(ROOT, "apps", "web", "components", "chat", "copilotkit-v2-plan-control.tsx");
const CARD = join(ROOT, "apps", "web", "components", "plan-control", "plan-run-progress.tsx");
const CONTRACT = join(ROOT, "packages", "contracts", "src", "plan-control.ts");

/** 去掉块注释与行注释——本仓注释里大量逐字引用旧代码，按原文 grep 会假红。 */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}
const host = (): string => stripComments(readFileSync(HOST, "utf8"));
const card = (): string => stripComments(readFileSync(CARD, "utf8"));

describe("单一事实源：deriveRunStatusView（#3365）", () => {
  it("契约里确实定义了 deriveRunStatusView（派生住在契约里，不住在组件里）", () => {
    expect(readFileSync(CONTRACT, "utf8")).toContain("export function deriveRunStatusView(");
  });

  it("宿主组件从契约导入 deriveRunStatusView", () => {
    expect(host()).toMatch(/import\s*\{[^}]*deriveRunStatusView[^}]*\}\s*from\s*["']@repo\/contracts\/plan-control["']/);
  });

  it("宿主不再自己拼状态文案——七档三元已收进契约", () => {
    /*
     * 缺陷现场：折叠头一份 `stateLabel` 三元、run-controls 分支另一份三元，
     * 两处与进度卡各说各话。任何一句状态文案的字面量重新出现在宿主里，这里红。
     */
    for (const label of ["执行中", "本轮已结束", "任务已停止", "执行遇到问题", "等待审批", "等待确认", "待执行"]) {
      expect(host(), `宿主里不该再出现状态文案字面量「${label}」`).not.toContain(`"${label}"`);
    }
  });

  it("宿主不再用「第一个未完成」自己找当前步骤（全完成时会兜底成已完成的最后一条）", () => {
    /*
     * 这条正是人类截图第二行那句假话的来处：`findIndex(s => s.status !== "completed")`
     * 落空后取 `steps[length - 1]`。契约不变量 I3 已把它变成 `null`。
     */
    expect(host()).not.toMatch(/findIndex\([^)]*status\s*!==\s*["']completed["']/);
    expect(host()).not.toMatch(/steps\[[^\]]*length\s*-\s*1\]/);
  });

  it("进度条的分子只能是 view.progressValue，不许是「当前步号 - 1」", () => {
    /*
     * 缺陷现场：`<Progress value={stepIndex - 1} max={stepTotal} />` 与同一张卡上
     * `data-completed={progress.completed}` 是两个分子——真实链路实测产出
     * 「可见 label 写 2/2、aria-valuenow=1、条子填 50%」。
     */
    const src = card();
    expect(src).toMatch(/value=\{view\.progressValue\}/);
    expect(src).not.toMatch(/value=\{[^}]*stepIndex[^}]*\}/);
    expect(src, "进度卡不许再从 props 里接零散的状态量").not.toMatch(/\breadonly\s+(stepIndex|stepTotal|completedCount|hasRecentError)\b/);
  });

  it("进度卡不自己判状态文案，只读 view", () => {
    for (const label of ["执行中", "正在收尾", "执行结果未确认", "任务已暂停"]) {
      expect(card(), `进度卡里不该出现状态文案字面量「${label}」`).not.toContain(`"${label}"`);
    }
  });
});

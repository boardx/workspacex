import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * lint-plan-surface-single-source.test.ts —— **计划面板 / 阶段条「要不要出现在屏幕上」
 * 只许有一份判定，且它必须在契约里。**
 *
 * ## 背景（issue #3321，人类第二次提出同一诉求）
 *
 * 人类反馈原话：「只有在有需要的时候才显示，plan panel 平常时间，不在 plan execute
 * 的场景时，不要显示」。第一次（#3208/#3214/#3245）修过一轮，没修干净。
 *
 * 九状态真实链路矩阵实测（issue #3321 评论）证明这不是产品口味，是规则**在两个
 * 方向上都没被执行**：该显示的不显示（`approving` 违反契约明写的常驻四态），
 * 不该显示的常驻（`done` 且账本跑满）。根因是同一个：**判定被声明在两处**——
 * 阶段条那一半在 `packages/contracts/src/plan-control.ts`，面板整块那一半散在
 * `copilotkit-v2-plan-control.tsx` 的多处早退里，两半各自演化必然漂移。
 *
 * 这是本仓第十二例「同一事实声明在两处」。AGENTS.md 的处方是**收敛为单一事实源 +
 * 机械门控**，本文件是那个门控：它盯着宿主组件，不许它长出第二份判定。
 *
 * ⚠ 纯静态文本断言。它挡的是「有人又在宿主里加了一个可见性条件」这件结构性的事，
 * 判「那个条件对不对」是 `packages/contracts/tests/plan-control/plan-surface-single-source.test.ts`
 * 的全叉积真值表，两者分工不重叠。
 */

const HOST = join(__dirname, "..", "..", "apps", "web", "components", "chat", "copilotkit-v2-plan-control.tsx");
const CONTRACT = join(__dirname, "..", "..", "packages", "contracts", "src", "plan-control.ts");

function hostSource(): string { return readFileSync(HOST, "utf8"); }

/** 去掉块注释与行注释——本仓注释里大量逐字引用旧代码，按原文 grep 会假红。 */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

describe("单一事实源：derivePlanSurface", () => {
  it("契约里确实定义了 derivePlanSurface（判定住在契约里，不住在组件里）", () => {
    expect(readFileSync(CONTRACT, "utf8")).toContain("export function derivePlanSurface(");
  });

  it("宿主组件从契约导入 derivePlanSurface", () => {
    expect(stripComments(hostSource())).toMatch(/import\s*\{[^}]*derivePlanSurface[^}]*\}\s*from\s*["']@repo\/contracts\/plan-control["']/);
  });

  it("宿主不再自己算阶段条常驻与否——shouldSurfacePlanPhaseIndicator 已收进 derivePlanSurface", () => {
    /*
     * 这一条正是实测抓到的矛盾 1 的门：契约说 `cancelled` 常驻阶段条，宿主的终态
     * 卸载门却把父整块 return null，`pinIndicator` 根本没机会渲染。只要两处各判一次，
     * 这种连坐就会再次发生。
     */
    expect(stripComments(hostSource())).not.toContain("shouldSurfacePlanPhaseIndicator");
  });

  it("宿主里 gate.required 只有一种读法：必须与 phase === \"planning\" 同行", () => {
    /*
     * 矛盾 2 的门。`evaluatePlanGate` 只看 todoCount，离开 planning 之后
     * `gate.required` 恒为 true 且无意义。宿主此前一处裸读、一处带 phase 限定，
     * 于是终态卸载门永不触发——人类投诉的直接根因。
     */
    const bare = stripComments(hostSource()).split("\n")
      .map((line, i) => ({ line, no: i + 1 }))
      .filter(({ line }) => /\bgate\.required\b/.test(line))
      .filter(({ line }) => !/phase\s*===\s*"planning"/.test(line))
      /*
       * 唯一豁免：把**原始值**交给契约的那一行（`gateRequired: ledger.gate.required,`）。
       * 这正是单一事实源要求的形状——宿主原样上交、不做任何解释，怎么读由
       * `derivePlanSurface` 决定。豁免锚在 `derivePlanSurface` 的入参属性名上，
       * 宿主自己再想读一次仍然会红。
       */
      .filter(({ line }) => !/^gateRequired:\s*ledger\.gate\.required,$/.test(line.trim()));
    expect(bare.map(b => `${b.no}: ${b.line.trim()}`), "宿主里出现了不带 planning 限定的 gate.required 裸读").toEqual([]);
  });

  it("宿主不再持有那两个已被证明失效的本地卸载判据", () => {
    const src = stripComments(hostSource());
    for (const banned of ["nothingLeftToDo", "terminalAndSettled"]) {
      expect(src, `${banned} 已收进 derivePlanSurface，宿主里不许再有第二份`).not.toContain(banned);
    }
  });

  it("宿主里的可见性早退**恰好**是对 surface.kind 的分派，没有第四个 return null", () => {
    /*
     * 允许的早退只有三种，且每一种都必须由 `surface.kind` 决定：
     *   hidden / indicator-only / run-controls
     * 外加一条与可见性无关的守卫（threadId/ledger 还没到手，没有账本可读）。
     * 多出来的任何 `return null` 都是把判定重新声明到第二处。
     */
    const src = stripComments(hostSource());
    const returnNulls = src.match(/return\s+null\s*;/g) ?? [];
    expect(returnNulls.length, `宿主里有 ${returnNulls.length} 处 return null，允许的是 2 处（数据未就绪守卫 + surface.kind === "hidden"）`).toBe(2);
    expect(src).toMatch(/surface\.kind\s*===\s*"hidden"/);
    expect(src).toMatch(/surface\.kind\s*===\s*"indicator-only"/);
    expect(src).toMatch(/surface\.kind\s*===\s*"run-controls"/);
  });
});

/**
 * F113 —— 右栏五标签均带计数（chat 束 domain.md，uc-8-2 UC-11 / R7 / V9 / V14）。
 *
 * ⚠ **纯逻辑单测，不连数据库**（issue #74：本地不跑任何需要 Postgres 的测试）。
 *   被测的是 `domain/chat/right-tabs.ts` 这一处唯一的计算——与
 *   `team-panel-presence-tri-state.test.ts` 同一个纪律：先证明「五个标签互相能区分」，
 *   不只是断言数组长度。
 *
 * ## 这个文件最重要的几条断言
 *
 * 1. **恒五个，顺序固定**——V9「右栏接口返回恰好五个标签」的字面断言，且顺序与
 *    契约 `RightTab` 枚举声明顺序逐字一致，调用方按下标取用时不会取错。
 * 2. **空态不隐藏标签**（V14）：全部计数为 0 时仍是五个标签，`hidden` 与 `failed`
 *    都不因为计数是 0 而被置真——「没有内容」与「不该显示」「取不到」是三件不同的事。
 * 3. **研究阶段转录标签隐藏（E1）**，且**只隐藏这一个**——反证：其余四个标签的
 *    `hidden` 必须仍是 `false`，一个把整段判定写反的实现会把全部标签都隐藏。
 * 4. **每个标签的失败态互相独立**（UC-11 `err` 注释「各标签独立的依赖失败，不整体
 *    失败」）：单开一个标签失败，其余四个的 `failed` 必须仍是 `false`。
 * 5. **产出必须能过契约的 `safeParse`**——不是本文件自己觉得形状对。
 */
import { describe, expect, it } from "vitest";
import { chat as C } from "@repo/contracts";
import {
  computeRightTabs,
  RIGHT_TAB_ORDER,
  type RightTabCounts,
} from "../../src/domain/chat/right-tabs";

const COUNTS: RightTabCounts = {
  transcript: 0, // 转录本身不是「列表计数」的概念，契约里仍要求一个非负整数，取 0
  execution: 4,
  insight: 6,
  artifact: 3,
  material: 12,
};

describe("F113 右栏五标签", () => {
  it("恒五个，顺序与契约 RightTab 枚举一致", () => {
    const tabs = computeRightTabs({ counts: COUNTS, phase: "onsite" });
    expect(tabs).toHaveLength(5);
    expect(tabs.map((t) => t.tab)).toEqual(["transcript", "execution", "insight", "artifact", "material"]);
    expect(tabs.map((t) => t.tab)).toEqual([...RIGHT_TAB_ORDER]);
  });

  it("每个标签的计数与传入的计数逐一对应（示数：执行 4 · 洞察 6 · 产物 3 · 材料 12）", () => {
    const tabs = computeRightTabs({ counts: COUNTS, phase: "onsite" });
    const byTab = new Map(tabs.map((t) => [t.tab, t.count]));
    expect(byTab.get("execution")).toBe(4);
    expect(byTab.get("insight")).toBe(6);
    expect(byTab.get("artifact")).toBe(3);
    expect(byTab.get("material")).toBe(12);
  });

  it("V14 空态：全部计数为 0 时仍是五个标签，不隐藏任何一个（现场阶段）", () => {
    const zero: RightTabCounts = {
      transcript: 0, execution: 0, insight: 0, artifact: 0, material: 0,
    };
    const tabs = computeRightTabs({ counts: zero, phase: "onsite" });
    expect(tabs).toHaveLength(5);
    expect(tabs.every((t) => t.hidden === false)).toBe(true);
    expect(tabs.every((t) => t.failed === false)).toBe(true);
    expect(tabs.every((t) => t.count === 0)).toBe(true);
  });

  it("E1 研究阶段：只有转录标签 hidden，其余四个不受影响", () => {
    const tabs = computeRightTabs({ counts: COUNTS, phase: "research" });
    const byTab = new Map(tabs.map((t) => [t.tab, t.hidden]));
    expect(byTab.get("transcript")).toBe(true);
    // 反证：把「研究阶段」错写成「隐藏全部标签」的实现会让下面四条变红。
    expect(byTab.get("execution")).toBe(false);
    expect(byTab.get("insight")).toBe(false);
    expect(byTab.get("artifact")).toBe(false);
    expect(byTab.get("material")).toBe(false);
  });

  it("现场阶段：转录标签不隐藏", () => {
    const tabs = computeRightTabs({ counts: COUNTS, phase: "onsite" });
    expect(tabs.find((t) => t.tab === "transcript")!.hidden).toBe(false);
  });

  it("每个标签的依赖失败互相独立：单开 insight 失败，其余四个仍是 false", () => {
    const tabs = computeRightTabs({
      counts: COUNTS, phase: "onsite", failures: { insight: true },
    });
    const byTab = new Map(tabs.map((t) => [t.tab, t.failed]));
    expect(byTab.get("insight")).toBe(true);
    expect(byTab.get("transcript")).toBe(false);
    expect(byTab.get("execution")).toBe(false);
    expect(byTab.get("artifact")).toBe(false);
    expect(byTab.get("material")).toBe(false);
  });

  it("反证：多个标签同时失败时互不覆盖——不是「有一个失败就把 failed 广播给全部」", () => {
    const tabs = computeRightTabs({
      counts: COUNTS, phase: "onsite", failures: { execution: true, material: true },
    });
    const byTab = new Map(tabs.map((t) => [t.tab, t.failed]));
    expect(byTab.get("execution")).toBe(true);
    expect(byTab.get("material")).toBe(true);
    expect(byTab.get("transcript")).toBe(false);
    expect(byTab.get("insight")).toBe(false);
    expect(byTab.get("artifact")).toBe(false);
  });

  it("产出的每一项都能过契约的 safeParse", () => {
    const tabs = computeRightTabs({ counts: COUNTS, phase: "onsite" });
    for (const t of tabs) {
      const parsed = C.operations.getRightTabs.out.shape.tabs.element.safeParse(t);
      expect(parsed.success).toBe(true);
    }
  });

  it("非空转：五个标签的 tab 取值集合大小恰为 5（不是同一个值复制了五份）", () => {
    const tabs = computeRightTabs({ counts: COUNTS, phase: "onsite" });
    expect(new Set(tabs.map((t) => t.tab)).size).toBe(5);
  });
});

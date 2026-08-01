/**
 * F148 —— 现场三个冲突判定动作：无预选、无 autofocus、无倒计时（N-6）。
 * （`research` 束 domain.md N-6，`uc-24-5` R3.6，`packages/contracts/src/research.ts`
 * `ResearchConflict` 注释：「三个动作永远是三个平权的选项」）。
 *
 * `RsLiveScreen`（`apps/web/components/research-studio/rs-screens.tsx`）与它的
 * mock 数据源（`apps/web/lib/mock/research-studio.ts`）在 F144 之前就已由
 * ui-prototyper 建成（真实组件 + mock，签核第①件材料）。本文件是 F148 的机械判据：
 * 断言这三个动作按钮的**性质**——不是预选态、没有 autofocus、没有倒计时文案，
 * 而不是停在"看起来是三个按钮"。
 *
 * ## 断言打在性质上，不是数量上（纪律第 9 条 / coding-standards E-4）
 * 不写 `expect(buttons).toHaveLength(3)` 这类断言就完事——那种断言在
 * 「删一个加一个」时全绿。本文件断言的是**没有任何一个按钮带着"这是默认/已选"
 * 的标记**，且**恒等于契约的全集**。
 */
import { describe, it, expect } from "vitest";
import { render, within } from "@testing-library/react";
import { RsLiveScreen } from "@/components/research-studio/rs-screens";
import { RS_CONFLICTS, RS_CONFLICT_ACTIONS } from "@/lib/mock/research-studio";
import { research } from "@repo/contracts";

describe("F148 · 反空转：mock 里确实有冲突数据，下面的断言才有的放矢", () => {
  it("RS_CONFLICTS 非空，且每条的 actions 恰好是契约 ConflictAction 的全集", () => {
    expect(RS_CONFLICTS.length).toBeGreaterThan(0);
    for (const c of RS_CONFLICTS) {
      expect(new Set(c.actions)).toEqual(new Set(research.ConflictAction.options));
    }
  });

  it("RS_CONFLICT_ACTIONS 与契约 ConflictAction 全集一致（不是页面自己另起一份）", () => {
    expect(new Set(RS_CONFLICT_ACTIONS)).toEqual(new Set(research.ConflictAction.options));
  });
});

describe("F148 · N-6 三个判定动作不是预选态", () => {
  it("每个冲突项都渲染出三个动作按钮，且三个按钮的 variant/className 完全相同（没有谁被高亮成默认项）", () => {
    const { container } = render(<RsLiveScreen state="default" view="owner" />);
    for (const c of RS_CONFLICTS) {
      const zone = container.querySelector(`[data-testid="rs-conflict-${c.id}-actions"]`);
      expect(zone, `冲突 ${c.id} 找不到动作区`).not.toBeNull();
      const buttons = within(zone as HTMLElement).getAllByRole("button");
      expect(buttons).toHaveLength(research.ConflictAction.options.length);

      const classNames = buttons.map((b) => b.className);
      // 性质断言：没有任何一个按钮的 class 与其余不同——不存在"某一个被特殊样式化"的情况
      expect(new Set(classNames).size).toBe(1);
    }
  });

  it("没有任何一个动作按钮带 aria-pressed=\"true\" / aria-selected=\"true\" / data-selected=\"true\"（预选态的常见落点）", () => {
    const { container } = render(<RsLiveScreen state="default" view="owner" />);
    for (const c of RS_CONFLICTS) {
      const zone = container.querySelector(`[data-testid="rs-conflict-${c.id}-actions"]`)!;
      const buttons = within(zone as HTMLElement).getAllByRole("button");
      for (const b of buttons) {
        expect(b.getAttribute("aria-pressed")).not.toBe("true");
        expect(b.getAttribute("aria-selected")).not.toBe("true");
        expect(b.getAttribute("data-selected")).not.toBe("true");
        expect(b.hasAttribute("autofocus")).toBe(false);
      }
    }
  });

  it("挂载后没有任何一个动作按钮自动获得焦点（无 autofocus 行为）", () => {
    render(<RsLiveScreen state="default" view="owner" />);
    expect(document.activeElement === document.body || document.activeElement === null).toBe(true);
  });

  it("三个动作的原文逐字（以样本为准 / 再补一路检索 / 上台讨论）都出现，顺序不构成默认排位的依据", () => {
    const { container } = render(<RsLiveScreen state="default" view="owner" />);
    for (const c of RS_CONFLICTS) {
      const zone = container.querySelector(`[data-testid="rs-conflict-${c.id}-actions"]`)!;
      const text = (zone as HTMLElement).textContent ?? "";
      for (const action of research.ConflictAction.options) {
        expect(text, `冲突 ${c.id} 缺少动作「${action}」`).toContain(action);
      }
    }
  });

  it("agent 的建议是一段文字（agentSuggestion 对应的 suggestion 展示），且明确标注『建议 ≠ 默认执行』，不是一个可高亮的字段", () => {
    const { container } = render(<RsLiveScreen state="default" view="owner" />);
    const html = container.innerHTML;
    expect(html).toContain("建议 ≠ 默认执行");
  });
});

describe("F148 · N-6 没有倒计时（无出处，Q-20 未裁 ⇒ 不实现）", () => {
  it("DOM 里没有倒计时相关的文案或计时元素", () => {
    const { container } = render(<RsLiveScreen state="default" view="owner" />);
    const text = container.textContent ?? "";
    expect(text).not.toMatch(/倒计时|秒后自动|自动执行|\d+\s*s\s*后/);
    // 没有任何 <progress> / <time> 计时控件挂在冲突动作区里
    for (const c of RS_CONFLICTS) {
      const zone = container.querySelector(`[data-testid="rs-conflict-${c.id}-actions"]`)!;
      expect((zone as HTMLElement).querySelector("progress")).toBeNull();
    }
  });
});

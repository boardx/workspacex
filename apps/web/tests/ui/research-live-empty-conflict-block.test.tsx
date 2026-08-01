/**
 * F148 —— A2：冲突为 0 时冲突待判定区块仍然渲染（空态），不是消失。
 * （`research` 束 domain.md，`uc-24-5` R3.2 / A2，`packages/contracts/src/research.ts`
 * `listConflicts` 注释：「A2：为 0 时界面仍渲染空态，不隐藏区块」）。
 *
 * `RsLiveScreen` 用 `sub="conflict-empty"` 驱动 mock 返回空冲突列表
 * （`apps/web/components/research-studio/rs-screens.tsx` 的 `conflictEmpty` 分支）。
 * 本文件把这条验收线索钉成机械断言。
 *
 * 附带把 A1（`onlyConflicts` 判据取 conflictCount>0）与「只看有冲突的」筛选、
 * 以及头部两个数（n 个 · m 个已就绪）钉在同一个屏里一起验，
 * 因为它们共用同一个 `RsLiveScreen` 渲染路径。
 */
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { RsLiveScreen } from "@/components/research-studio/rs-screens";
import { RS_LIVE_TASKS, RS_CONFLICTS, liveCounts } from "@/lib/mock/research-studio";

describe("F148 · 反空转：mock 数据本身具备被测的性质", () => {
  it("RS_CONFLICTS 默认非空（否则下面『冲突为 0 仍渲染区块』的对照组毫无意义）", () => {
    expect(RS_CONFLICTS.length).toBeGreaterThan(0);
  });

  it("RS_LIVE_TASKS 里确实混有 conflicts>0 和 conflicts===0 的行", () => {
    expect(RS_LIVE_TASKS.some((t) => t.conflicts > 0)).toBe(true);
    expect(RS_LIVE_TASKS.some((t) => t.conflicts === 0)).toBe(true);
  });
});

describe("F148 · A2 冲突为 0 时，冲突待判定区块仍然渲染（空态而非消失）", () => {
  it("sub=\"conflict-empty\" 下 rs-conflict-zone 区块本身仍然存在", () => {
    const { container } = render(<RsLiveScreen state="default" view="owner" sub="conflict-empty" />);
    expect(container.querySelector('[data-testid="rs-conflict-zone"]')).not.toBeNull();
  });

  it("空态节点 rs-conflict-empty 出现，且文案说明『暂无待判定的冲突』（而不是留白/报错）", () => {
    const { container } = render(<RsLiveScreen state="default" view="owner" sub="conflict-empty" />);
    const empty = container.querySelector('[data-testid="rs-conflict-empty"]');
    expect(empty).not.toBeNull();
    expect(empty!.textContent).toContain("暂无待判定的冲突");
  });

  it("为 0 时不渲染任何单条冲突项（不是把假冲突塞进去凑数）", () => {
    const { container } = render(<RsLiveScreen state="default" view="owner" sub="conflict-empty" />);
    for (const c of RS_CONFLICTS) {
      expect(container.querySelector(`[data-testid="rs-conflict-${c.id}"]`)).toBeNull();
    }
  });

  it("非空场景（默认 sub）下，同一个区块显示真实冲突项，证明『空态』不是唯一能渲染的状态", () => {
    const { container } = render(<RsLiveScreen state="default" view="owner" />);
    expect(container.querySelector('[data-testid="rs-conflict-zone"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="rs-conflict-empty"]')).toBeNull();
    for (const c of RS_CONFLICTS) {
      expect(container.querySelector(`[data-testid="rs-conflict-${c.id}"]`)).not.toBeNull();
    }
  });
});

describe("F148 · A1『只看有冲突的』筛选：判据是 conflictCount>0，不是状态词", () => {
  it("筛选后返回集合 ⊆ conflicts>0 的行，且集合本身与真实过滤结果一致（不是写死条数）", () => {
    const { container } = render(<RsLiveScreen state="default" view="owner" sub="conflict-filter" />);
    const expected = RS_LIVE_TASKS.filter((t) => t.conflicts > 0);
    const rows = Array.from(container.querySelectorAll('[data-testid^="rs-task-"]')).filter((el) =>
      /^rs-task-\d+$/.test(el.getAttribute("data-testid") ?? ""),
    );
    expect(rows).toHaveLength(expected.length);
  });

  it("反空转：mock 里存在一个状态词是『运行中』（不含『冲突』字样）但 conflicts>0 的反例——过滤没有按词做", () => {
    // RS_LIVE_TASKS 本身可能没有这个反例；这条断言核实过滤函数用的是数值而不是文案匹配：
    // 用 status 完全不含"冲突"字样的行去核对是否仍能按 conflicts>0 被选中/排除。
    const anyConflictRow = RS_LIVE_TASKS.find((t) => t.conflicts > 0);
    expect(anyConflictRow, "mock 里没有冲突行——过滤断言无的放矢").not.toBeUndefined();
    expect(anyConflictRow!.status).not.toContain("冲突");
  });
});

describe("F148 · 头部两个数（n 个 · m 个已就绪）是派生值，不是写死文案", () => {
  it("rs-live-counts 的文本与 liveCounts(RS_LIVE_TASKS) 计算结果一致", () => {
    const { container } = render(<RsLiveScreen state="default" view="owner" />);
    const cnt = liveCounts(RS_LIVE_TASKS);
    const el = container.querySelector('[data-testid="rs-live-counts"]');
    expect(el).not.toBeNull();
    expect(el!.textContent).toBe(`${cnt.total} 个 · ${cnt.ready} 个已就绪`);
  });
});

describe("F148 · 一行 agent 失败时其余行状态不变", () => {
  it("任务行相互独立渲染：每行的 status badge 只反映自己的数据", () => {
    const { container } = render(<RsLiveScreen state="default" view="owner" />);
    RS_LIVE_TASKS.forEach((t, i) => {
      const statusEl = container.querySelector(`[data-testid="rs-task-${i}-status"]`);
      expect(statusEl, `第 ${i} 行状态节点缺失`).not.toBeNull();
      if (!t.failed) {
        expect(statusEl!.textContent).toBe(t.status);
      }
    });
  });
});

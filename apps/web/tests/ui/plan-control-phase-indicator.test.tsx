/**
 * F977 —— S1 六态指示器（`ui.md` 判据一）。
 *
 * 权威规格：contracts/plan-control/ui.md S1 + 判据一「当前态可读不靠颜色」。
 */
import * as React from "react";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { PLAN_PHASE_LABEL_ZH, PlanPhase } from "@repo/contracts/plan-control";
import { PLAN_PHASE_INDICATOR_TESTID, PlanPhaseIndicator } from "@/components/plan-control/plan-phase-indicator";

afterEach(cleanup);

const ALL_PHASES = PlanPhase.options;

describe("PlanPhaseIndicator：data-phase 恒来自 props.phase（getPlanLedger.phase 的直出，前端不重算）", () => {
  it.each(ALL_PHASES)("phase=%s -> data-phase 与之逐字相同", (phase) => {
    render(<PlanPhaseIndicator phase={phase} />);
    const el = screen.getByTestId(PLAN_PHASE_INDICATOR_TESTID);
    expect(el.getAttribute("data-phase")).toBe(phase);
  });
});

describe("判据一 ①：文本高亮——当前态与其余态在渲染文本层面可区分", () => {
  it("非 failed 态时六个文案节点都渲染，当前态节点带 aria-current", () => {
    render(<PlanPhaseIndicator phase="executing" />);
    for (const p of ["preparing", "planning", "executing", "approving", "done"] as const) {
      expect(screen.getByText(PLAN_PHASE_LABEL_ZH[p])).toBeTruthy();
    }
    const current = screen.getByText(PLAN_PHASE_LABEL_ZH.executing);
    expect(current.getAttribute("aria-current")).toBe("step");
    // 非当前态不带 aria-current。
    const notCurrent = screen.getByText(PLAN_PHASE_LABEL_ZH.planning);
    expect(notCurrent.getAttribute("aria-current")).toBeNull();
  });
});

describe("判据一 ②：aria-current='step' 精确指向当前态，且只有一个", () => {
  it.each(["preparing", "planning", "executing", "approving", "done"] as const)(
    "phase=%s 时恰好一个节点带 aria-current=step，且是那一态自己的文案", (phase) => {
      render(<PlanPhaseIndicator phase={phase} />);
      const marked = screen.getAllByText((_, el) => el?.getAttribute("aria-current") === "step");
      expect(marked).toHaveLength(1);
      expect(marked[0]!.textContent).toBe(PLAN_PHASE_LABEL_ZH[phase]);
    },
  );
});

describe("判据一 ③：role=status 播报当前态中文文案", () => {
  it("非 failed 态：屏幕阅读器可读的 status 文本包含当前态文案", () => {
    render(<PlanPhaseIndicator phase="approving" />);
    const status = screen.getByRole("status");
    expect(status.textContent).toContain(PLAN_PHASE_LABEL_ZH.approving);
  });

  it("failed 态：整条替换为独立的失败态，仍是 role=status 且文案是「失败」", () => {
    render(<PlanPhaseIndicator phase="failed" />);
    const status = screen.getByRole("status");
    expect(status.textContent).toContain(PLAN_PHASE_LABEL_ZH.failed);
    expect(screen.getByTestId(PLAN_PHASE_INDICATOR_TESTID).getAttribute("data-phase")).toBe("failed");
  });
});

describe("单一事实源：文案取自 @repo/contracts 的 PLAN_PHASE_LABEL_ZH，不在组件里另建映射表", () => {
  it("六态文案与契约常量逐字相等（防止漂移出第二份副本）", () => {
    render(<PlanPhaseIndicator phase="done" />);
    for (const p of ALL_PHASES) {
      if (p === "failed" || p === "cancelled") continue;
      expect(screen.queryByText(PLAN_PHASE_LABEL_ZH[p])).toBeTruthy();
    }
  });
});

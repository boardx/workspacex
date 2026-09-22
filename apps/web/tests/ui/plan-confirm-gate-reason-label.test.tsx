/**
 * issue #2486 —— 确认门不得把 `PlanGateReason` 判定码当文案渲染给用户。
 *
 * ## 这批断言反证的是什么
 *
 * `gate.reason` 的类型是契约 `PlanGateDecision.reason`（`PlanGateReason`），一个
 * 封闭枚举（`"multi-step"` 之类），是 UC-8 的**判定码，不是文案**。确认门上那句
 * "为什么要你确认" 必须取自契约的单一事实源 `PLAN_GATE_REASON_LABEL_ZH`——
 * 组件不得原样渲染枚举值，也不得在组件里现造第二份文案（同 `PLAN_PHASE_LABEL_ZH`
 * 一套纪律）。
 *
 * ⚠ 本文件是**反证**，不是回归描述：修复前它是红的。修复前 `PLAN_GATE_REASON_LABEL_ZH`
 * / `planGateReasonLabelZh` 根本不存在（import 即失败），确认门上也没有任何一句
 * 对应 `gate.reason` 的人话可断言。
 */
import * as React from "react";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import {
  PLAN_GATE_REASON_LABEL_ZH,
  PlanGateReason,
  planGateReasonLabelZh,
} from "@repo/contracts/plan-control";
import type { PlanStep } from "@repo/contracts/plan-control";
import {
  PLAN_CONFIRM_GATE_TESTID,
  PLAN_CONFIRM_REASON_TESTID,
  PlanConfirmGate,
  type PlanGateDecisionWithRisk,
} from "@/components/plan-control/plan-confirm-gate";

afterEach(cleanup);

const STEPS: readonly PlanStep[] = [
  { planStepId: "s1", content: "起草方案初稿", status: "pending", constraints: [] },
  { planStepId: "s2", content: "发送评审邮件", status: "pending", constraints: [] },
];

/** 全部判定码字面量——用户可见文本里一个都不许出现。 */
const ENUM_CODES: readonly string[] = PlanGateReason.options;

/** `gate.required===true` 的那些判定码：确认门只在这条分支入 DOM（UC-8 反证③）。 */
const REQUIRING_REASONS = ["multi-step", "user-forced", "multi-step-high-risk"] as const;

describe("issue #2486 · 确认门渲染的是人话，不是判定码", () => {
  it.each(REQUIRING_REASONS)("reason=%s：渲染出映射后的中文文案", (reason) => {
    const gate: PlanGateDecisionWithRisk = { required: true, reason };
    render(<PlanConfirmGate gate={gate} steps={STEPS} />);

    const line = screen.getByTestId(PLAN_CONFIRM_REASON_TESTID);
    expect(line.textContent).toBe(PLAN_GATE_REASON_LABEL_ZH[reason]);
  });

  it.each(REQUIRING_REASONS)(
    "reason=%s：整块确认门的用户可见文本里不出现任何裸枚举码",
    (reason) => {
      const gate: PlanGateDecisionWithRisk = { required: true, reason };
      render(<PlanConfirmGate gate={gate} steps={STEPS} />);

      // textContent 取的是用户实际读到的字，不含 data-* 属性——属性里出现
      // 判定码是正常的（那是给测试/样式用的），渲染给人看的文字里不行。
      const visible = screen.getByTestId(PLAN_CONFIRM_GATE_TESTID).textContent ?? "";
      expect(visible.length).toBeGreaterThan(0);
      for (const code of ENUM_CODES) {
        expect(visible).not.toContain(code);
      }
    },
  );

  it("文案随 reason 变化——不是一句写死的话冒充映射", () => {
    const rendered = REQUIRING_REASONS.map((reason) => {
      const { unmount } = render(
        <PlanConfirmGate gate={{ required: true, reason }} steps={STEPS} />,
      );
      const text = screen.getByTestId(PLAN_CONFIRM_REASON_TESTID).textContent ?? "";
      unmount();
      return text;
    });
    expect(new Set(rendered).size).toBe(rendered.length);
  });

  it("服务端给了前端没见过的判定码：兜底成人话，绝不把原始码渲染出去", () => {
    // 静态类型拦不住这个运行时场景（服务端先上线新枚举值、前端还没发版）。
    const gate = { required: true, reason: "some-future-reason" } as unknown as PlanGateDecisionWithRisk;
    render(<PlanConfirmGate gate={gate} steps={STEPS} />);

    const visible = screen.getByTestId(PLAN_CONFIRM_GATE_TESTID).textContent ?? "";
    expect(visible).not.toContain("some-future-reason");
    expect(visible).not.toContain("undefined");
    expect(screen.getByTestId(PLAN_CONFIRM_REASON_TESTID).textContent)
      .toBe(planGateReasonLabelZh("some-future-reason"));
  });

  it("单一事实源：组件渲染的每一句都能在契约映射表里找到，组件侧没有第二份文案", () => {
    for (const reason of REQUIRING_REASONS) {
      const { unmount } = render(
        <PlanConfirmGate gate={{ required: true, reason }} steps={STEPS} />,
      );
      const text = screen.getByTestId(PLAN_CONFIRM_REASON_TESTID).textContent ?? "";
      expect(Object.values(PLAN_GATE_REASON_LABEL_ZH)).toContain(text);
      unmount();
    }
  });
});

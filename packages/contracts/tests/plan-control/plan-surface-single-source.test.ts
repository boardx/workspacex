/**
 * issue #3321 —— `derivePlanSurface` 是「计划区要不要出现在屏幕上」的唯一判定处。
 *
 * ## 这份测试要挡住什么
 *
 * 本仓已十一次栽在「同一事实声明在两处」。#3321 是第十二例的现场：阶段条常驻与否
 * 写在契约里，计划面板整块显示与否散在宿主组件的五处早退里，两半各自演化，产出
 * 两处硬矛盾（见 `derivePlanSurface` 头注 1 / 2）。收敛之后，靠这份**全叉积**
 * 测试把两条不变量变成会红的东西——不是抽样，是把输入空间穷举一遍。
 *
 * ⚠ 这份测试不判"好不好看"，只判**结构性矛盾不可能存在**。具体每一格该显示什么，
 * 由下面的真值表逐格钉死。
 */
import { describe, expect, it } from "vitest";
import {
  derivePlanSurface,
  shouldSurfacePlanPhaseIndicator,
  PLAN_PHASE_INDICATOR_PINNED_PHASES,
  type PlanPhase,
  type PlanSurfaceInput,
} from "../../src/plan-control";

const PHASES: readonly PlanPhase[] = ["preparing", "planning", "approving", "executing", "done", "failed", "cancelled"];
const RUN_STATUSES = ["idle", "running", "interrupted", "succeeded", "failed", "cancelled"] as const;

/** 全叉积生成器。输入空间被穷举，不抽样——抽样会漏掉正是缺陷所在的那一格。 */
function* allInputs(): Generator<PlanSurfaceInput> {
  for (const phase of PHASES)
    for (const runStatus of RUN_STATUSES)
      for (const stepCount of [0, 3])
        for (const gateRequired of [false, true])
          for (const pendingApplyAtNextRun of [false, true])
            for (const orphanedConstraintCount of [0, 2])
              for (const paused of [false, true])
                for (const pauseRequested of [false, true])
                  for (const [progressCompleted, progressTotal] of [[0, 0], [1, 3], [3, 3]] as const)
                    for (const hasActionError of [false, true])
                      yield {
                        phase, runStatus, stepCount, gateRequired, pendingApplyAtNextRun,
                        orphanedConstraintCount, paused, pauseRequested,
                        progressCompleted, progressTotal, hasActionError,
                      };
}

function base(overrides: Partial<PlanSurfaceInput> = {}): PlanSurfaceInput {
  return {
    phase: "preparing", runStatus: "idle", stepCount: 0, gateRequired: false,
    pendingApplyAtNextRun: false, orphanedConstraintCount: 0, paused: false,
    pauseRequested: false, progressCompleted: 0, progressTotal: 0, hasActionError: false,
    ...overrides,
  };
}

describe("不变量 I1：契约说常驻阶段条的 phase，绝不可能被整块藏掉", () => {
  /*
   * 这一条正是 #3321 实测抓到的矛盾 1 的机械形态：契约把 `cancelled` 列进常驻四态，
   * 而宿主的终态卸载门把父整块 return null，阶段条被连坐卸载。收敛后
   * `pinIndicator === true` 与 `kind === "hidden"` 在**同一个函数里**被同时决定，
   * 这条断言让它们不可能再互相矛盾。
   */
  it("∀ 输入：pinIndicator ⇒ kind !== 'hidden'", () => {
    const violations: PlanSurfaceInput[] = [];
    for (const input of allInputs()) {
      const surface = derivePlanSurface(input);
      if (surface.pinIndicator && surface.kind === "hidden") violations.push(input);
    }
    expect(violations.slice(0, 5), `${violations.length} 个输入让常驻阶段条被整块吞掉`).toEqual([]);
  });

  it("∀ 输入：pinIndicator 与 shouldSurfacePlanPhaseIndicator(phase) 逐格相等（没有第二份判据）", () => {
    for (const input of allInputs()) {
      expect(derivePlanSurface(input).pinIndicator).toBe(shouldSurfacePlanPhaseIndicator(input.phase));
    }
  });

  it("常驻四态在「什么都没发生」的形状下拿到的是 indicator-only，不是 hidden", () => {
    for (const phase of PLAN_PHASE_INDICATOR_PINNED_PHASES) {
      const surface = derivePlanSurface(base({ phase, runStatus: "cancelled" }));
      expect(surface.kind, `phase=${phase}`).not.toBe("hidden");
    }
  });
});

describe("不变量 I2：gate.required 只有一种读法 —— phase === 'planning' 时才算数", () => {
  /*
   * 矛盾 2 的机械形态。`evaluatePlanGate` 只看 todoCount，离开 planning 之后
   * `gate.required` 恒为 true 且无意义。宿主此前裸读它，于是终态卸载门永不触发
   * ——人类两次反馈「plan panel 平常时间不要显示」的直接根因。
   */
  it("非 planning 态下，gateRequired 翻转不改变任何一格的结果", () => {
    const drift: string[] = [];
    for (const input of allInputs()) {
      if (input.phase === "planning") continue;
      const off = derivePlanSurface({ ...input, gateRequired: false });
      const on = derivePlanSurface({ ...input, gateRequired: true });
      if (off.kind !== on.kind || off.pinIndicator !== on.pinIndicator) {
        drift.push(`${input.phase}/${input.runStatus}/steps=${input.stepCount}: ${off.kind} vs ${on.kind}`);
      }
    }
    expect([...new Set(drift)].slice(0, 5), `${drift.length} 个输入仍在非 planning 态裸读 gate.required`).toEqual([]);
  });

  it("planning 态下 gateRequired 确实起作用（否则上一条会因为「哪儿都不读」而假绿）", () => {
    const withGate = derivePlanSurface(base({ phase: "planning", stepCount: 0, gateRequired: true }));
    const noGate = derivePlanSurface(base({ phase: "planning", stepCount: 0, gateRequired: false }));
    expect(withGate.kind).toBe("panel");
    // planning 属常驻四态，所以没有确认门时剩的是阶段条一行，不是整块消失。
    expect(noGate.kind).toBe("indicator-only");
  });
});

/*
 * ⚠ 取证史（如实登记，避免后人拿作废数据当依据）：#3321 第一版九格实测里
 * S8 / S9 两行的账本列读的是另一条空白线程、DOM 量的是画面上那条已完成线程，
 * 指针错位，取证方已公开作废；S3 / S4 一并降级为存疑。**下面这张真值表不是
 * 那份数据的誊抄**，它逐格声明的是「这一格应该长什么样」的设计判断，独立成立；
 * 其中 done-且跑满 那两格（S5 / S7b）另有指针自洽的实测与真实链路回归撑着。
 */
describe("真值表：计划区每一种账本形状该长什么样，逐格钉死", () => {
  it("S1 全新空白会话（preparing/idle、无步骤）：整块不显示", () => {
    expect(derivePlanSurface(base())).toEqual({ kind: "hidden", pinIndicator: false });
  });

  it("S8/S9 切回、刷新后（preparing/idle、无步骤）：与 S1 同为 hidden——同一账本状态只许有一种界面", () => {
    /*
     * ⚠ 这里**不能**写成 `expect(f(base())).toEqual(f(base()))`——那是恒真的，
     * 永远不会红（本仓已九次「全绿但空转」）。要钉的是具体取值：切回 / 刷新
     * 之后没有第二个隐藏输入能让同一份账本渲染出别的形态，所以答案必须逐字
     * 就是 S1 那一个。
     */
    expect(derivePlanSurface(base())).toEqual({ kind: "hidden", pinIndicator: false });
  });

  it("S3 有计划、执行中（executing/running）：显示完整面板", () => {
    expect(derivePlanSurface(base({ phase: "executing", runStatus: "running", stepCount: 3, progressCompleted: 1, progressTotal: 3 })).kind)
      .toBe("panel");
  });

  it("S3' 在跑但账本为空：只给运行级控制，不编造步骤进度", () => {
    expect(derivePlanSurface(base({ phase: "executing", runStatus: "running", stepCount: 0 })).kind)
      .toBe("run-controls");
  });

  it("S4 等待人类审批（approving/running）：面板显示，且阶段条常驻（契约的常驻四态之一）", () => {
    const surface = derivePlanSurface(base({ phase: "approving", runStatus: "running", stepCount: 3, progressCompleted: 0, progressTotal: 3 }));
    expect(surface.kind).toBe("panel");
    expect(surface.pinIndicator).toBe(true);
  });

  it("S4' approving 但账本为空：仍不许整块隐藏——阶段条常驻是契约明写的", () => {
    expect(derivePlanSurface(base({ phase: "approving", runStatus: "running", stepCount: 0 })).kind)
      .not.toBe("hidden");
  });

  it("S5/S7b run 成功结束、账本跑满、gate.required 仍恒为 true：整块不显示（这一格是用户投诉的直接来源）", () => {
    expect(derivePlanSurface(base({
      phase: "done", runStatus: "succeeded", stepCount: 3,
      gateRequired: true,            // ⚠ evaluatePlanGate 只看 todoCount，done 之后它恒为 true
      progressCompleted: 3, progressTotal: 3,
    }))).toEqual({ kind: "hidden", pinIndicator: false });
  });

  it("done 但账本没跑满：按 #3245 的有意设计保留面板（那一行是唯一说明账本滞后的出口）", () => {
    expect(derivePlanSurface(base({
      phase: "done", runStatus: "succeeded", stepCount: 3,
      progressCompleted: 1, progressTotal: 3,
    })).kind).toBe("panel");
  });

  it("S6 run 失败后：面板显示（失败一定要有可操作入口）且阶段条常驻", () => {
    const surface = derivePlanSurface(base({ phase: "failed", runStatus: "failed", stepCount: 3, progressCompleted: 3, progressTotal: 3 }));
    expect(surface.kind).toBe("panel");
    expect(surface.pinIndicator).toBe(true);
  });

  it("S6' 失败且从未产出计划：仍要有入口，不许 hidden", () => {
    expect(derivePlanSurface(base({ phase: "failed", runStatus: "failed", stepCount: 0 })).kind).toBe("panel");
  });

  it("S7 取消后、账本跑满：面板卸载，但阶段条常驻不被连坐（矛盾 1 的那一格）", () => {
    expect(derivePlanSurface(base({
      phase: "cancelled", runStatus: "cancelled", stepCount: 3,
      gateRequired: true, progressCompleted: 3, progressTotal: 3,
    }))).toEqual({ kind: "indicator-only", pinIndicator: true });
  });

  it("S7' 取消且从未产出计划（progress.total === 0）：同样只剩阶段条一行，不是完整面板", () => {
    expect(derivePlanSurface(base({ phase: "cancelled", runStatus: "cancelled", stepCount: 0 })))
      .toEqual({ kind: "indicator-only", pinIndicator: true });
  });

  it("终态但仍有待应用改动 / 孤儿约束 / 暂停 / 操作报错：面板留着，不许因为「看起来结束了」卸载", () => {
    for (const extra of [
      { pendingApplyAtNextRun: true }, { orphanedConstraintCount: 1 },
      { paused: true }, { pauseRequested: true }, { hasActionError: true },
    ]) {
      expect(derivePlanSurface(base({
        phase: "done", runStatus: "succeeded", stepCount: 3,
        progressCompleted: 3, progressTotal: 3, ...extra,
      })).kind, JSON.stringify(extra)).toBe("panel");
    }
  });
});

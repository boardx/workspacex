/**
 * issue #3132（B7）—— 计划确认门的**契约层**反证。
 *
 * 上下文：#3132 判定 `PlanConfirmGate` 「符号存在但永远不会被渲染」，根因是
 * `derivePlanPhase` 的 `planning` 分支在真实链路里**结构性不可达**（步骤存在 ⇒ run
 * 必然存在 ⇒ phase 恒为 executing/done/failed）。本文件守住修法的三个不变量：
 *
 * 1. `planning` 真的可达（新分支存在且判定正确）；
 * 2. 三个终态**仍然**优先于 `planning`（#2927 / #3079 不被这条新分支绕过）；
 * 3. 阈值不是第二份声明——它必须与 `evaluatePlanGate` 那张判定表一致。
 *
 * 每条断言下面都注明「撤掉什么会红」，避免它退化成一条恒真的装饰。
 */
import { describe, expect, it } from "vitest";
import {
  derivePlanPhase, evaluatePlanGate,
  PLAN_APPROVAL_TOOL_WHITELIST, PLAN_CONFIRMATION_TOOL_NAME,
  PLAN_CONFIRM_MIN_STEPS, PLAN_CONFIRM_MIN_STEPS_CONFIGURABLE_KEY,
  type RunStatusForPhase,
} from "../../src/plan-control";

const BASE = {
  ledgerEmpty: true,
  pendingToolCalls: [] as const,
  hasFailedStep: false,
  hasPendingPlanConfirmation: false,
};

describe("B7 · derivePlanPhase 的 planning 分支真的可达", () => {
  it("run 在跑 + 账本为空 + 停在计划确认中断 ⇒ planning（#3132 的核心修复点）", () => {
    // 撤掉 `if (input.hasPendingPlanConfirmation) return "planning";` ⇒ 这条落回
    // "preparing"（`ledgerEmpty` 先判），正是 #3132 描述的「确认门永不渲染」。
    expect(derivePlanPhase({
      ...BASE, runStatus: "running", hasPendingPlanConfirmation: true,
    })).toBe("planning");
  });

  it("没有计划确认中断时，既有判定逐字不变（本改动不放宽任何既有分支）", () => {
    expect(derivePlanPhase({ ...BASE, runStatus: "running" })).toBe("preparing");
    expect(derivePlanPhase({ ...BASE, runStatus: "running", ledgerEmpty: false })).toBe("executing");
    expect(derivePlanPhase({ ...BASE, runStatus: "idle", ledgerEmpty: false })).toBe("planning");
  });

  it.each(["cancelled", "succeeded", "failed"] as const)(
    "终态 %s 优先于 planning —— 新分支插在三个终态之后（#2927 / #3079 不可被绕过）",
    (runStatus: RunStatusForPhase) => {
      // 把新分支上移到终态之前 ⇒ 这三条全红。这正是设计里「插入位置是设计的一部分」
      // 那句话的机械门控：一条被取消/已结束的 run 即使数据库里还留着 pending_tool_name，
      // 也绝不能重新回到 planning 态、重新长出控制操作。
      expect(derivePlanPhase({
        ...BASE, runStatus, hasPendingPlanConfirmation: true,
      })).toBe(runStatus === "succeeded" ? "done" : runStatus);
    },
  );

  it("hasFailedStep 同样优先于 planning", () => {
    expect(derivePlanPhase({
      ...BASE, runStatus: "running", hasFailedStep: true, hasPendingPlanConfirmation: true,
    })).toBe("failed");
  });
});

describe("B7 · 单一事实源：工具名与阈值都不许有第二份声明", () => {
  it("计划确认的工具名不在 approving 白名单里——它有自己的 phase，不是「待审批」", () => {
    // 若哪天有人把 write_todos 加进 PLAN_APPROVAL_TOOL_WHITELIST，phase 会变成
    // approving、确认门（只认 planning）又一次永不渲染。这条守住 XC-59 的形状。
    expect(PLAN_APPROVAL_TOOL_WHITELIST).not.toContain(PLAN_CONFIRMATION_TOOL_NAME);
    expect(PLAN_CONFIRMATION_TOOL_NAME).toBe("write_todos");
  });

  it("阈值与 evaluatePlanGate 的判定表一致 —— 改一侧不改另一侧会红", () => {
    // 阈值 = 「evaluatePlanGate 开始要求确认」的最小 todoCount。这里不是复述一个 2，
    // 而是**从判定表推出来**再和常量比：改了表却忘了改常量，这条立刻红。
    let derived = 0;
    while (derived < 50 && !evaluatePlanGate({ todoCount: derived, userForced: false }).required) derived += 1;
    expect(PLAN_CONFIRM_MIN_STEPS).toBe(derived);
  });

  it("判据 (b)：简单问答不加门槛 —— 0 步 / 1 步一律不需要确认", () => {
    // 这是**正向**断言：把引擎侧谓词改成恒 True、或把阈值调成 1，都会让这条的语义
    // 与真实行为背离（阈值改 1 ⇒ 上一条红）。两条合起来锁住「不给简单问答加门」。
    expect(evaluatePlanGate({ todoCount: 0, userForced: false }).required).toBe(false);
    expect(evaluatePlanGate({ todoCount: 1, userForced: false }).required).toBe(false);
    expect(evaluatePlanGate({ todoCount: PLAN_CONFIRM_MIN_STEPS, userForced: false }).required).toBe(true);
  });

  it("投影键名是稳定字面量（跨语言 parity 测试比对的就是它）", () => {
    expect(PLAN_CONFIRM_MIN_STEPS_CONFIGURABLE_KEY).toBe("plan_confirm_min_steps");
  });
});

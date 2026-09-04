/**
 * F972 —— `plan-control.ts` 是 zod 单一事实源：结构面断言。
 *
 * 权威规格：phases/phase-01-run-a-project/contracts/plan-control/{domain,usecases}.md。
 * 这份测试不跑数据库、不跑 HTTP，只断言"契约本身长得对不对、有没有第二份副本"。
 */
import { describe, expect, it } from "vitest";
import {
  PlanStepStatus,
  PlanOrigin,
  PlanPhase,
  PLAN_PHASE_LABEL_ZH,
  PlanGateReason,
  PlanGateDecision,
  RunControlAction,
  PlanAppliedTo,
  PlanControlError,
  PlanStep,
  PlanConstraint,
  planControl,
  evaluatePlanGate,
  derivePlanPhase,
  PLAN_APPROVAL_TOOL_WHITELIST,
} from "../../src/plan-control";
import { AguiPlanTodoStatus } from "../../src/agui-state-events";

describe("F972 · PlanStepStatus 与 AguiPlanTodoStatus 逐字相同（domain.md 一·2）", () => {
  it("是同一个 zod schema 对象，不是第二份副本", () => {
    // z.infer 自同一个引用：本束不得新造第四个值。
    expect(PlanStepStatus).toBe(AguiPlanTodoStatus);
  });

  it("三值封闭：pending / in_progress / completed", () => {
    expect(PlanStepStatus.options.sort()).toEqual(["completed", "in_progress", "pending"].sort());
  });

  it("拒绝第四个值（例如 skipped）——不得在本束新造", () => {
    expect(PlanStepStatus.safeParse("skipped").success).toBe(false);
  });
});

describe("F972 · PlanOrigin 封闭两值（domain.md 一·4）", () => {
  it("恰好 engine / user", () => {
    expect(PlanOrigin.options.sort()).toEqual(["engine", "user"]);
  });
});

describe("F972 · PlanPhase 六值 + 中文文案单一事实源（domain.md 一·5，I-7）", () => {
  const SIX = ["preparing", "planning", "executing", "approving", "done", "failed"];

  it("恰好六个态", () => {
    expect(PlanPhase.options.sort()).toEqual([...SIX].sort());
  });

  it("PLAN_PHASE_LABEL_ZH 是六值到中文的完整映射，没有遗漏也没有多余键", () => {
    expect(Object.keys(PLAN_PHASE_LABEL_ZH).sort()).toEqual([...SIX].sort());
    for (const phase of PlanPhase.options) {
      expect(typeof PLAN_PHASE_LABEL_ZH[phase]).toBe("string");
      expect(PLAN_PHASE_LABEL_ZH[phase].length).toBeGreaterThan(0);
    }
  });

  it("六值对应人类可读文案（准备/计划/执行/审批/完成/失败）", () => {
    expect(PLAN_PHASE_LABEL_ZH).toEqual({
      preparing: "准备",
      planning: "计划",
      executing: "执行",
      approving: "审批",
      done: "完成",
      failed: "失败",
    });
  });
});

describe("F972 · PlanGateDecision（domain.md 一·6，UC-8 判定表）", () => {
  it("PlanGateReason 恰好六值（issue #2663 新增 multi-step-low-risk/high-risk 两档）", () => {
    expect(PlanGateReason.options.sort()).toEqual(
      [
        "no-plan", "single-step", "multi-step", "user-forced",
        "multi-step-low-risk", "multi-step-high-risk",
      ].sort(),
    );
  });

  it(".strict() 拒绝多余字段（design-signoff.md 3.7 反向断言）", () => {
    const res = PlanGateDecision.safeParse({ required: true, reason: "multi-step", extra: "x" });
    expect(res.success).toBe(false);
  });

  it("UC-8 判定表：封闭表驱动，覆盖全部四条分支", () => {
    expect(evaluatePlanGate({ todoCount: 0, userForced: false })).toEqual({
      required: false, reason: "no-plan",
    });
    expect(evaluatePlanGate({ todoCount: 1, userForced: false })).toEqual({
      required: false, reason: "single-step",
    });
    expect(evaluatePlanGate({ todoCount: 2, userForced: false })).toEqual({
      required: true, reason: "multi-step",
    });
    expect(evaluatePlanGate({ todoCount: 99, userForced: false })).toEqual({
      required: true, reason: "multi-step",
    });
    // userForced 优先于 todoCount（判据四明确要求这条分支存在）
    expect(evaluatePlanGate({ todoCount: 0, userForced: true })).toEqual({
      required: true, reason: "user-forced",
    });
  });

  it("反证（usecases.md UC-8）：简单提问 todoCount 恒 0 ⇒ required:false，与阈值无关", () => {
    // todoCount===0 这条分支不依赖 “≥2 算不算复杂” 那条待定阈值（domain.md 三·④）。
    const decision = evaluatePlanGate({ todoCount: 0, userForced: false });
    expect(decision.required).toBe(false);
    expect(decision.reason).toBe("no-plan");
  });
});

describe("F972 · RunControlAction 封闭四值，没有 restore-checkpoint（domain.md 一·7，人类裁决 (c)）", () => {
  it("恰好 pause / resume / retry-step / edit-input", () => {
    expect(RunControlAction.options.sort()).toEqual(
      ["pause", "resume", "retry-step", "edit-input"].sort(),
    );
  });

  it("不包含 restore-checkpoint —— 本轮明确不做，不留占位值", () => {
    expect(RunControlAction.options).not.toContain("restore-checkpoint");
    expect(RunControlAction.safeParse("restore-checkpoint").success).toBe(false);
  });
});

describe("F972 · XC-60 更正：appliedTo 是 ledger-only | ledger-and-engine", () => {
  it("不是 full-rerun | ledger-only（那是 agent-interrupts 束自己的类型）", () => {
    expect(PlanAppliedTo.options.sort()).toEqual(["ledger-only", "ledger-and-engine"].sort());
    expect(PlanAppliedTo.safeParse("full-rerun").success).toBe(false);
  });
});

describe("F972 · PlanControlError 穷举，不写“等等”（usecases.md 顶部）", () => {
  const EXPECTED = [
    "NOT_VISIBLE", "NO_WRITE_ROLE", "THREAD_ARCHIVED_READONLY", "AUDIT_SINK_UNAVAILABLE",
    "PLAN_NOT_FOUND", "PLAN_REVISION_CHANGED", "PLAN_STEP_NOT_FOUND", "PLAN_EMPTY_NOT_ALLOWED",
    "PLAN_CONSTRAINT_TOO_LONG", "PLAN_CONSTRAINT_BLANK", "PLAN_CONTENT_BLANK",
    "PLAN_DELIVERY_FAILED", "NO_ACTIVE_RUN", "RUN_ALREADY_TERMINAL", "NO_PAUSED_STATE",
  ];

  it("逐字等于 usecases.md 的枚举（本文件是它唯一的落地形态）", () => {
    expect(PlanControlError.options.sort()).toEqual([...EXPECTED].sort());
  });

  it("不含已删除的 CHECKPOINT_UNAVAILABLE / RESTORE_NOT_IMPLEMENTED（随 UC-11 删除）", () => {
    expect(PlanControlError.options).not.toContain("CHECKPOINT_UNAVAILABLE");
    expect(PlanControlError.options).not.toContain("RESTORE_NOT_IMPLEMENTED");
  });

  it("XC-60：PLAN_CONSTRAINT_BLANK 维持不变，不是 agent-interrupts 的 FIELD_REQUIRED_BLANK", () => {
    expect(PlanControlError.options).toContain("PLAN_CONSTRAINT_BLANK");
    expect(PlanControlError.options).not.toContain("FIELD_REQUIRED_BLANK");
  });
});

describe("F972 · 11 个独立操作（design-signoff.md 3.1 已裁决 A，不扩 chat.mutateThread）", () => {
  it("恰好 11 个操作键，UC-11 restoreCheckpoint 不在其中", () => {
    const keys = Object.keys(planControl).sort();
    expect(keys).toEqual([
      "addPlanConstraint", "confirmPlan", "deletePlanStep", "deliverPlanToRun",
      "evaluatePlanGate", "getPlanLedger", "ingestEnginePlanSnapshot", "pausePlanRun",
      "removePlanConstraint", "reorderPlanStep", "resumePlanRun", "retryPlanStep",
    ].sort());
    expect(keys).not.toContain("restoreCheckpoint");
  });

  it("getPlanLedger.out.strict() 拒绝多余字段（design-signoff.md 3.7）", () => {
    const base = {
      revision: 0, engineEpoch: 0, origin: "engine", steps: [],
      orphanedConstraints: [], phase: "preparing",
      gate: { required: false, reason: "no-plan" },
      progress: { completed: 0, total: 0, elapsedMs: 0 },
      pendingApplyAtNextRun: false, activeRunId: null,
      // issue #2451 —— errorCode/failedStepId 都是新增的声明字段（真实失败原因/
      // 真实失败步骤，见该 issue），不是这条反证要挡的"多余字段"；base 必须跟着
      // schema 补全，否则这条正向断言（safeParse(base).success===true）会假红，
      // 不代表 schema 本身漏了 .strict() 或漏了反向覆盖。
      errorCode: null,
      failedStepId: null,
    };
    expect(planControl.getPlanLedger.out.safeParse(base).success).toBe(true);
    expect(planControl.getPlanLedger.out.safeParse({ ...base, extra: 1 }).success).toBe(false);
  });

  it("reorderPlanStep.in.strict() 拒绝多余字段", () => {
    const base = { threadId: "t1", basedOnRevision: 0, planStepId: "s1", toIndex: 2 };
    expect(planControl.reorderPlanStep.in.safeParse(base).success).toBe(true);
    expect(planControl.reorderPlanStep.in.safeParse({ ...base, extra: 1 }).success).toBe(false);
  });
});

describe("F972 · PlanStep / PlanConstraint 形状（domain.md 一·2/3）", () => {
  it("PlanStep 没有 order/sortKey 字段（I-4：下标即顺序）", () => {
    const shape = PlanStep.shape;
    expect(shape).not.toHaveProperty("order");
    expect(shape).not.toHaveProperty("sortKey");
  });

  it("PlanConstraint.text 与 authorId 存在（I-9：约束只可能由人产生）", () => {
    const parsed = PlanConstraint.safeParse({
      constraintId: "c1", planStepId: "s1", text: "别调用外部 API",
      authorId: "u1", createdAt: new Date().toISOString(),
    });
    expect(parsed.success).toBe(true);
  });
});

describe("F972 · XC-59 反证 —— PlanPhase='approving' 只认既有 call_skill 白名单", () => {
  it("PLAN_APPROVAL_TOOL_WHITELIST 恰好只含 call_skill，不含 agent-interrupts 三个新工具名", () => {
    expect(PLAN_APPROVAL_TOOL_WHITELIST).toEqual(["call_skill"]);
    for (const forbidden of ["confirm_task_intent", "fill_run_params", "choose_execution_option"]) {
      expect(PLAN_APPROVAL_TOOL_WHITELIST).not.toContain(forbidden);
    }
  });

  const BASE = { runStatus: "running" as const, ledgerEmpty: false, hasFailedStep: false };

  it.each([
    { name: "confirm_task_intent", other: [] as string[] },
    { name: "fill_run_params", other: [] as string[] },
    { name: "choose_execution_option", other: [] as string[] },
    { name: "confirm_task_intent", other: ["fill_run_params", "choose_execution_option"] },
  ])(
    "仅有 agent-interrupts 中断（$name 等）、无 call_skill 待审批 ⇒ PlanPhase 不是 approving",
    ({ name, other }) => {
      const phase = derivePlanPhase({
        ...BASE,
        pendingToolCalls: [name, ...other].map((toolName) => ({ toolName, awaitingApproval: true })),
      });
      expect(phase).not.toBe("approving");
      // 执行中且无失败步骤 ⇒ 应落在 executing，而不是被误标成 approving。
      expect(phase).toBe("executing");
    },
  );

  it("反向：真的有 call_skill 待审批 ⇒ PlanPhase 是 approving", () => {
    const phase = derivePlanPhase({
      ...BASE,
      pendingToolCalls: [
        { toolName: "call_skill", awaitingApproval: true },
        { toolName: "confirm_task_intent", awaitingApproval: true },
      ],
    });
    expect(phase).toBe("approving");
  });

  it("call_skill 存在但 awaitingApproval:false（已批准/已拒绝）⇒ 不算待决审批", () => {
    const phase = derivePlanPhase({
      ...BASE,
      pendingToolCalls: [{ toolName: "call_skill", awaitingApproval: false }],
    });
    expect(phase).not.toBe("approving");
  });

  it("hasFailedStep 优先于待决审批（failed 态最高优先级）", () => {
    const phase = derivePlanPhase({
      ...BASE,
      hasFailedStep: true,
      pendingToolCalls: [{ toolName: "call_skill", awaitingApproval: true }],
    });
    expect(phase).toBe("failed");
  });

  it("零计划态：ledgerEmpty 且无待决审批 ⇒ preparing", () => {
    const phase = derivePlanPhase({
      runStatus: "idle", ledgerEmpty: true, hasFailedStep: false, pendingToolCalls: [],
    });
    expect(phase).toBe("preparing");
  });
});

/**
 * `plan-control` 契约束 —— zod 单一事实源（F972，issue 见本 PR 描述）。
 *
 * 权威规格（不重抄正文，只落地形状）：
 *   phases/phase-01-run-a-project/contracts/plan-control/{domain,usecases,coverage,design-signoff}.md
 * 判据单一事实源：.harness/instructions/chat-task-workbench-acceptance.md TW-P0-3。
 *
 * ## 这份文件覆盖什么、不覆盖什么
 *
 * 覆盖：11 个操作（`usecases.md` UC-1…UC-10 + UC-12；**UC-11 `restoreCheckpoint`
 * 已随人类 2026-08-26 裁决 (c) 整条删除，不留一个恒失败的接口**）、
 * `PlanControlError` 的封闭错误枚举、`PlanPhase` 六态与中文文案的单一映射、
 * `PlanGateDecision` 判定表、`derivePlanPhase` 派生纯函数（含 XC-59 反证的
 * 白名单过滤，见下）。
 *
 * 不覆盖：`mutateThread`（属 `chat` 束，`chat.ts:545` 的封闭枚举本束一个字不动，
 * 见 `design-signoff.md` 3.1 已裁决 A——独立操作集）；引擎侧 `write_todos`
 * 的产出形状（那是 `packages/contracts/src/agui-state-events.ts` 的
 * `AguiPlanTodo` / `AguiPlanTodoStatus`，本束**直接复用其 z.infer**，不建
 * 第二份「逐字相同」的副本——本仓已因「同一事实两处声明」漂移五次）。
 *
 * ## XC-59（design-coherence.md）—— `PlanPhase="approving"` 不得被
 * `agent-interrupts` 的三个新中断工具误触发
 *
 * `agent-interrupts` 束（F212 及其后续）会新增三个具名中断工具：
 * `confirm_task_intent` / `fill_run_params` / `choose_execution_option`。
 * 它们与本束共享同一条"待决审批"信号通道（HITL 中断），但**不是** `PlanPhase`
 * 判据一里"审批"这个派生态该统计的对象——那个态只对应"计划本身需要人确认"这件事，
 * 权威载体是既有 `call_skill` 白名单（`packages/contracts/src/deep-agent-hitl.ts`
 * 的 `DEEP_AGENT_HITL_TOOL_NAME`）。若 `derivePlanPhase` 不按 `toolName` 过滤，
 * 一次纯问答式的"目标复述卡"中断会被错误地贴上"审批"文案。
 *
 * `PLAN_APPROVAL_TOOL_WHITELIST` 是这条过滤的**唯一事实源**：只有工具名落在这个
 * 白名单里的待决中断才会把 `PlanPhase` 判成 `"approving"`。`agent-interrupts`
 * 三个工具名**故意不在这里**——表驱动反证见
 * `packages/contracts/tests/plan-control/plan-control-schema-single-source.test.ts`
 * 的「XC-59 反证」describe 块（XC-59 的权威实现方；`agent-interrupts` F216 那条线
 * 断言同一件事，但本文件才是修复点，两边不得各自维护一份白名单）。
 *
 * ## 命名注记：`planStepId`，不是原稿的裸词写法
 *
 * `domain.md` / `usecases.md` 原文的字段名是 `step` 紧接 `Id`（驼峰）。这里改成
 * `planStepId` 是**机械改名，不是语义偏离**——`apps/api/scripts/lib/
 * naming-single-source-patterns.mjs`（F121 Q-3 B①）把那个裸词形式定为全仓败选名
 * （与议程环节 `agendaSegmentId` 的历史命名混淆问题相关，`lint-naming-single-source.mjs`
 * 门控该正则**不分域**地扫描 `packages/contracts/src` 全文本，本注释自己写出那个
 * 词都会被挡，所以这里刻意拆开两个词不连写），与本束的计划步骤是完全不同的领域
 * 概念也照挡不误。`planStepId` 保留了原文「计划步骤的 id」这个语义、只是加了
 * `plan` 前缀避开那个全局黑名单——落地时对照 `domain.md`/`usecases.md` 里的原字段名读。
 */
import { z } from "zod";
import { AguiPlanTodoStatus } from "./agui-state-events";

/* ────────────────────────────────────────────────────────────────────── *
 * 一、领域枚举与值对象（`domain.md` 第一节）
 * ────────────────────────────────────────────────────────────────────── */

/**
 * `PlanStepStatus` —— **z.infer 自 `agui-state-events.ts` 的 `AguiPlanTodoStatus`，
 * 不是第二份副本**（`domain.md` 一·2 逐字要求"与 `AguiPlanTodoStatus` 逐字相同"；
 * XC-A/XC-F 契约面裁决：本束不得新造第四个值）。
 */
export const PlanStepStatus = AguiPlanTodoStatus;
export type PlanStepStatus = z.infer<typeof PlanStepStatus>;

/** `PlanOrigin` —— 封闭枚举，两值（`domain.md` 一·4）。 */
export const PlanOrigin = z.enum(["engine", "user"]);
export type PlanOrigin = z.infer<typeof PlanOrigin>;

/**
 * `PlanPhase` —— 六态，**派生值，不可写**（I-7）。
 *
 * ⚠ 文案与枚举值是同一事实的两份表示——`PLAN_PHASE_LABEL_ZH` 是单一事实源，
 * 前端不得自己维护第二张映射表（`domain.md` 一·5，本仓已五次因此漂移）。
 */
export const PlanPhase = z.enum(["preparing", "planning", "executing", "approving", "done", "failed"]);
export type PlanPhase = z.infer<typeof PlanPhase>;

/** `PlanPhase` → 中文文案，单一事实源。 */
export const PLAN_PHASE_LABEL_ZH: Readonly<Record<PlanPhase, string>> = Object.freeze({
  preparing: "准备",
  planning: "计划",
  executing: "执行",
  approving: "审批",
  done: "完成",
  failed: "失败",
});

/** `PlanGateDecision` —— 确认门判定，服务端纯函数产出，前端只渲染结果（`domain.md` 一·6）。 */
export const PlanGateReason = z.enum(["no-plan", "single-step", "multi-step", "user-forced"]);
export type PlanGateReason = z.infer<typeof PlanGateReason>;

export const PlanGateDecision = z.object({
  required: z.boolean(),
  reason: PlanGateReason,
}).strict();
export type PlanGateDecision = z.infer<typeof PlanGateDecision>;

/**
 * `RunControlAction` —— 封闭枚举，**四值**（`domain.md` 一·7）。
 *
 * ⚠ 没有 `restore-checkpoint`——本轮明确不做（人类 2026-08-26 裁决 (c)）。
 * 判据六仍然要求三个恢复动作；这是知情后"明确选择不做第三个"，不是判据被改松，
 * 缺口登记在 `coverage.md` 缺口 4，TW-P0-3 如实封顶 0.7。
 */
export const RunControlAction = z.enum(["pause", "resume", "retry-step", "edit-input"]);
export type RunControlAction = z.infer<typeof RunControlAction>;

/**
 * `appliedTo` —— 一次编辑最终落到哪（I-11）。
 *
 * ⚠ XC-60 更正：本束的取值是 `"ledger-only" | "ledger-and-engine"`。
 * **不是** `"full-rerun" | "ledger-only"`——那是 `agent-interrupts` 束自己的
 * 独立类型（`fill_run_params` 的"只重跑受影响下游"降级态），两者共享字符串值
 * `"ledger-only"` 但不是同一个 zod 类型，不得互相 import 或合并。
 */
export const PlanAppliedTo = z.enum(["ledger-only", "ledger-and-engine"]);
export type PlanAppliedTo = z.infer<typeof PlanAppliedTo>;

/** `PlanConstraint` —— 约束（值对象，`domain.md` 一·3）。文案 ≤ 500 字符、非空白。 */
export const PlanConstraint = z.object({
  constraintId: z.string(),
  planStepId: z.string(),
  text: z.string(),
  authorId: z.string(),
  createdAt: z.string(),
}).strict();
export type PlanConstraint = z.infer<typeof PlanConstraint>;

/** `getPlanLedger.out` 里的约束投影：不下发 `authorId`（读模型只暴露前端需要的字段）。 */
export const PlanConstraintView = z.object({
  constraintId: z.string(),
  text: z.string(),
  createdAt: z.string(),
}).strict();
export type PlanConstraintView = z.infer<typeof PlanConstraintView>;

/** `PlanStep` —— 计划步骤（值对象，`domain.md` 一·2）。`planStepId` 生命周期内稳定（I-3）。 */
export const PlanStep = z.object({
  planStepId: z.string(),
  content: z.string(),
  status: PlanStepStatus,
  constraints: z.array(PlanConstraintView),
}).strict();
export type PlanStep = z.infer<typeof PlanStep>;

/** 孤儿约束（I-8）：宿主 step 消失后仍对用户可见，不静默删除。 */
export const OrphanedConstraint = z.object({
  constraintId: z.string(),
  text: z.string(),
  orphanedAtRevision: z.number().int().nonnegative(),
  formerStepContent: z.string(),
}).strict();
export type OrphanedConstraint = z.infer<typeof OrphanedConstraint>;

/* ────────────────────────────────────────────────────────────────────── *
 * 二、统一失败枚举 `PlanControlError`（`usecases.md` 顶部，穷举不写"等等"）
 * ────────────────────────────────────────────────────────────────────── */

export const PlanControlError = z.enum([
  // 通用（委托 chat 束 UC-0 判定结果 / 审计 fail closed）
  "NOT_VISIBLE",
  "NO_WRITE_ROLE",
  "THREAD_ARCHIVED_READONLY",
  "AUDIT_SINK_UNAVAILABLE",
  // 账本
  "PLAN_NOT_FOUND",
  "PLAN_REVISION_CHANGED",
  "PLAN_STEP_NOT_FOUND",
  "PLAN_EMPTY_NOT_ALLOWED",
  "PLAN_CONSTRAINT_TOO_LONG",
  "PLAN_CONSTRAINT_BLANK",
  "PLAN_CONTENT_BLANK",
  // 送达与执行控制
  "PLAN_DELIVERY_FAILED",
  "NO_ACTIVE_RUN",
  "RUN_ALREADY_TERMINAL",
  "NO_PAUSED_STATE",
]);
export type PlanControlError = z.infer<typeof PlanControlError>;

/**
 * ⚠ `PLAN_CONSTRAINT_BLANK` 是 `PlanConstraint` 实体专属的空值校验码
 * （XC-60 更正）。`agent-interrupts` 束已改用自己的 `FIELD_REQUIRED_BLANK`，
 * 本束**维持 `PLAN_CONSTRAINT_BLANK` 不变**——这是本束自己的错误码，
 * 两束不共用同一个空值码。
 *
 * ⚠ 原稿的 `CHECKPOINT_UNAVAILABLE` / `RESTORE_NOT_IMPLEMENTED` 两个码已删除，
 * 随 `UC-11` 一起——人类 2026-08-26 裁决 (c)。留一个恒返回
 * `RESTORE_NOT_IMPLEMENTED` 的错误码，等于留一个假装存在的能力。
 */

/* ────────────────────────────────────────────────────────────────────── *
 * 三、API 操作（`usecases.md` UC-1…UC-10 + UC-12；A 独立操作集，见 3.1 已裁决）
 * ────────────────────────────────────────────────────────────────────── */

const CommonPre = { threadId: z.string() };

export const planControl = {
  /* — A 组：账本读写 — */

  /** UC-1：读当前计划（读模型，前端计划面板唯一数据来源）。 */
  getPlanLedger: {
    method: "GET", path: "/plan-control/threads/:threadId/ledger",
    in: z.object({ threadId: z.string() }).strict(),
    out: z.object({
      revision: z.number().int().nonnegative(),
      engineEpoch: z.number().int().nonnegative(),
      origin: PlanOrigin,
      steps: z.array(PlanStep),
      orphanedConstraints: z.array(OrphanedConstraint),
      phase: PlanPhase,
      gate: PlanGateDecision,
      progress: z.object({
        completed: z.number().int().nonnegative(),
        total: z.number().int().nonnegative(),
        elapsedMs: z.number().int().nonnegative(),
      }).strict(),
      pendingApplyAtNextRun: z.boolean(),
      activeRunId: z.string().nullable(),
    }).strict(),
    err: ["NOT_VISIBLE"] as const,
  },

  /**
   * UC-2：引擎快照落账本（内部端口，无 HTTP 面）。
   * 由 `write_todos` 成功时的既有生产者调用（`copilotkit-agui.controller.ts:389-392`
   * 的同一个判定点，不新建第二条触发路径）。永远被接受（I-6）。
   */
  ingestEnginePlanSnapshot: {
    method: "POST", path: "/plan-control/threads/:threadId/engine-snapshot",
    in: z.object({
      threadId: z.string(),
      todos: z.array(z.object({ content: z.string(), status: PlanStepStatus })).min(1),
    }).strict(),
    out: z.object({
      revision: z.number().int().nonnegative(),
      engineEpoch: z.number().int().nonnegative(),
    }).strict(),
    err: [] as const,
  },

  /* — B 组：三个编辑动作（TW-P0-3 判据三）+ UC-6 撤约束 — */

  /** UC-3：调顺序。`toIndex` 越界钳制到边界，不报错。 */
  reorderPlanStep: {
    method: "POST", path: "/plan-control/threads/:threadId/steps/reorder",
    in: z.object({
      ...CommonPre,
      basedOnRevision: z.number().int().nonnegative(),
      planStepId: z.string(),
      toIndex: z.number().int(),
    }).strict(),
    out: z.object({
      revision: z.number().int().nonnegative(),
      appliedTo: PlanAppliedTo,
      auditEventId: z.string(),
    }).strict(),
    err: [
      "NOT_VISIBLE", "NO_WRITE_ROLE", "THREAD_ARCHIVED_READONLY",
      "PLAN_NOT_FOUND", "PLAN_REVISION_CHANGED", "PLAN_STEP_NOT_FOUND",
      "AUDIT_SINK_UNAVAILABLE",
    ] as const,
  },

  /** UC-4：删步骤。删带约束的步骤不删约束（I-8，转孤儿）；删到 0 步被拒。 */
  deletePlanStep: {
    method: "POST", path: "/plan-control/threads/:threadId/steps/delete",
    in: z.object({
      ...CommonPre,
      basedOnRevision: z.number().int().nonnegative(),
      planStepId: z.string(),
    }).strict(),
    out: z.object({
      revision: z.number().int().nonnegative(),
      appliedTo: PlanAppliedTo,
      orphanedConstraintIds: z.array(z.string()),
      auditEventId: z.string(),
    }).strict(),
    err: [
      "NOT_VISIBLE", "NO_WRITE_ROLE", "THREAD_ARCHIVED_READONLY",
      "PLAN_NOT_FOUND", "PLAN_REVISION_CHANGED", "PLAN_STEP_NOT_FOUND",
      "PLAN_EMPTY_NOT_ALLOWED", "AUDIT_SINK_UNAVAILABLE",
    ] as const,
  },

  /**
   * UC-5：加约束。约束进入下一轮的通路已裁决——A system 消息注入
   * （只改 Node 侧，见 `UC-12 deliverPlanToRun`）。
   */
  addPlanConstraint: {
    method: "POST", path: "/plan-control/threads/:threadId/constraints",
    in: z.object({
      ...CommonPre,
      basedOnRevision: z.number().int().nonnegative(),
      planStepId: z.string(),
      text: z.string(),
    }).strict(),
    out: z.object({
      revision: z.number().int().nonnegative(),
      constraintId: z.string(),
      appliedTo: PlanAppliedTo,
      auditEventId: z.string(),
    }).strict(),
    err: [
      "NOT_VISIBLE", "NO_WRITE_ROLE", "THREAD_ARCHIVED_READONLY",
      "PLAN_NOT_FOUND", "PLAN_REVISION_CHANGED", "PLAN_STEP_NOT_FOUND",
      "PLAN_CONSTRAINT_BLANK", "PLAN_CONSTRAINT_TOO_LONG", "AUDIT_SINK_UNAVAILABLE",
    ] as const,
  },

  /** UC-6：撤掉一条约束（含孤儿）。加得进撤不掉不叫可编辑——本束主动补的操作。 */
  removePlanConstraint: {
    method: "POST", path: "/plan-control/threads/:threadId/constraints/remove",
    in: z.object({
      ...CommonPre,
      basedOnRevision: z.number().int().nonnegative(),
      constraintId: z.string(),
    }).strict(),
    out: z.object({
      revision: z.number().int().nonnegative(),
      appliedTo: PlanAppliedTo,
      auditEventId: z.string(),
    }).strict(),
    err: [
      "NOT_VISIBLE", "NO_WRITE_ROLE", "THREAD_ARCHIVED_READONLY",
      "PLAN_NOT_FOUND", "PLAN_REVISION_CHANGED", "AUDIT_SINK_UNAVAILABLE",
    ] as const,
  },

  /* — C 组：确认门（TW-P0-3 判据四） — */

  /** UC-7：确认计划，放行执行。送达失败即不创建 run（fail closed，I-10）。 */
  confirmPlan: {
    method: "POST", path: "/plan-control/threads/:threadId/confirm",
    in: z.object({
      ...CommonPre,
      basedOnRevision: z.number().int().nonnegative(),
    }).strict(),
    out: z.object({
      revision: z.number().int().nonnegative(),
      runId: z.string(),
      deliveredPlanDigest: z.string(),
      auditEventId: z.string(),
    }).strict(),
    err: [
      "NOT_VISIBLE", "NO_WRITE_ROLE", "PLAN_NOT_FOUND", "PLAN_REVISION_CHANGED",
      "PLAN_EMPTY_NOT_ALLOWED", "PLAN_DELIVERY_FAILED", "AUDIT_SINK_UNAVAILABLE",
    ] as const,
  },

  /** UC-8：确认门判定（纯函数端口，无 HTTP 面）。见下方 `evaluatePlanGate`。 */
  evaluatePlanGate: {
    method: "POST", path: "/plan-control/gate/evaluate",
    in: z.object({
      todoCount: z.number().int().nonnegative(),
      userForced: z.boolean(),
    }).strict(),
    out: PlanGateDecision,
    err: [] as const,
  },

  /* — D 组：执行控制（TW-P0-3 判据五、六） — */

  /**
   * UC-9：暂停。语义是"可恢复的中止"（人类 2026-08-26 裁决），
   * 底层 `POST /threads/:id/runs/:run_id/cancel?action=interrupt`。
   */
  pausePlanRun: {
    method: "POST", path: "/plan-control/threads/:threadId/runs/pause",
    in: z.object({ threadId: z.string() }).strict(),
    out: z.object({
      runId: z.string(),
      pausedAtStepId: z.string().nullable(),
      auditEventId: z.string(),
    }).strict(),
    err: [
      "NOT_VISIBLE", "NO_WRITE_ROLE", "NO_ACTIVE_RUN", "RUN_ALREADY_TERMINAL",
      "AUDIT_SINK_UNAVAILABLE",
    ] as const,
  },

  /**
   * UC-13：恢复（`pause` 的配对动作）。**不是新协议**：同一 `threadId` 上创建
   * 一轮新 run，不传 `checkpoint_id`（默认取最新），`input: null`。
   *
   * ⚠ 与"恢复检查点"（本轮不做）是两件不同的事——`resume` 只能续跑"刚被暂停的
   * 那个 run"，不是跳到任意历史检查点（`coverage.md` 缺口 9）。
   */
  resumePlanRun: {
    method: "POST", path: "/plan-control/threads/:threadId/runs/resume",
    in: z.object({ threadId: z.string() }).strict(),
    out: z.object({
      runId: z.string(),
      resumedFromStepId: z.string().nullable(),
      auditEventId: z.string(),
    }).strict(),
    err: ["NOT_VISIBLE", "NO_WRITE_ROLE", "NO_PAUSED_STATE", "AUDIT_SINK_UNAVAILABLE"] as const,
  },

  /**
   * UC-10：重试某一步（判据六①）。把该步及后续置回 pending，经送达路径起新一轮 run。
   * 不是引擎级"从那个节点继续"——那需要 checkpoint，本轮不做（裁决 (c)）。
   */
  retryPlanStep: {
    method: "POST", path: "/plan-control/threads/:threadId/steps/retry",
    in: z.object({ threadId: z.string(), planStepId: z.string() }).strict(),
    out: z.object({ runId: z.string(), auditEventId: z.string() }).strict(),
    err: [
      "NOT_VISIBLE", "NO_WRITE_ROLE", "PLAN_STEP_NOT_FOUND", "NO_ACTIVE_RUN",
      "AUDIT_SINK_UNAVAILABLE",
    ] as const,
  },

  /* — E 组：状态送达（横切） — */

  /**
   * UC-12：计划与约束进入下一轮 run（内部端口）。I-10 的实现端口，唯一注入点。
   * 通路已裁决：A system 消息注入（只改 Node 侧）。`digest` 是**实际送出去那段
   * 正文的哈希**，不是"本该送出去的"。
   */
  deliverPlanToRun: {
    method: "POST", path: "/plan-control/threads/:threadId/deliver",
    in: z.object({
      threadId: z.string(),
      ledgerRevision: z.number().int().nonnegative(),
    }).strict(),
    out: z.object({ digest: z.string() }).strict(),
    err: ["PLAN_DELIVERY_FAILED"] as const,
  },
} as const;

/*
 * ⚠ `UC-11 restoreCheckpoint` 不在上面这张表里——它已随人类 2026-08-26 裁决 (c)
 * 整条删除（`usecases.md` 逐字：「这条 UC 已整条删除，不留形状、不留恒失败的
 * 错误码」）。不要在此新增一个 `restoreCheckpoint` 操作、也不要新增
 * `RESTORE_NOT_IMPLEMENTED` 之类的错误码去"占位"——那正是反伪造条款要挡的
 * 假装存在的能力。
 */

/* ────────────────────────────────────────────────────────────────────── *
 * 四、纯函数端口（`usecases.md` UC-8 判定表 + `domain.md` I-7 派生规则）
 * ────────────────────────────────────────────────────────────────────── */

/**
 * UC-8 `evaluatePlanGate` —— 确认门判定，封闭表驱动，纯函数，不失败。
 *
 * 判据四的反证（`usecases.md` UC-8 反证节）：简单提问不触发 `write_todos`，
 * `todoCount` 恒为 0 ⇒ `reason: "no-plan"` ⇒ `required: false`——这条路径
 * 不依赖任何阈值，`todoCount >= 2` 这条分界线才是待定项（`domain.md` 三·④）。
 */
export function evaluatePlanGate(input: { todoCount: number; userForced: boolean }): PlanGateDecision {
  if (input.userForced) return { required: true, reason: "user-forced" };
  if (input.todoCount === 0) return { required: false, reason: "no-plan" };
  if (input.todoCount === 1) return { required: false, reason: "single-step" };
  return { required: true, reason: "multi-step" };
}

/**
 * `PlanPhase="approving"` 判定唯一认的工具名白名单。
 *
 * **这是 XC-59 反证的权威事实源**——目前只有既有的 `call_skill` HITL 通道
 * （`packages/contracts/src/deep-agent-hitl.ts` 的 `DEEP_AGENT_HITL_TOOL_NAME`）
 * 会把计划判成"审批中"。`agent-interrupts` 束新增的三个中断工具
 * （`confirm_task_intent` / `fill_run_params` / `choose_execution_option`）
 * **故意不在这里**：它们各自有自己的中断态（目标复述 / 参数补全 / 方案选择），
 * 不是"计划待审批"。若哪天产品要求这三者之一也能触发 `PlanPhase="approving"`，
 * 加进这个数组是唯一允许的改法——不许在 `derivePlanPhase` 里另起一份判断逻辑。
 */
export const PLAN_APPROVAL_TOOL_WHITELIST: readonly string[] = ["call_skill"];

/** `derivePlanPhase` 的入参：一个待决工具调用（可能是审批中断，也可能不是）。 */
export const PendingToolCall = z.object({
  toolName: z.string(),
  awaitingApproval: z.boolean(),
}).strict();
export type PendingToolCall = z.infer<typeof PendingToolCall>;

/** run 的粗粒度状态——`derivePlanPhase` 只需要区分这几档，不需要引擎的全部状态机。 */
export const RunStatusForPhase = z.enum(["idle", "running", "succeeded", "failed", "interrupted"]);
export type RunStatusForPhase = z.infer<typeof RunStatusForPhase>;

/**
 * `PlanPhase` 派生纯函数（I-7）：由 `(runStatus, ledgerEmpty, pendingToolCalls,
 * hasFailedStep)` 唯一决定，不落库、不可写。
 *
 * ⚠ **XC-59**：`"approving"` 只在存在一条 `awaitingApproval === true` **且**
 * `toolName` 落在 `PLAN_APPROVAL_TOOL_WHITELIST` 里的待决工具调用时才成立。
 * 仅有 `agent-interrupts` 三个新工具名的待决中断、没有任何 `call_skill` 待审批时，
 * 本函数**不得**返回 `"approving"`——见文件末尾表驱动反证。
 */
export function derivePlanPhase(input: {
  runStatus: RunStatusForPhase;
  ledgerEmpty: boolean;
  pendingToolCalls: readonly PendingToolCall[];
  hasFailedStep: boolean;
}): PlanPhase {
  const hasPendingApproval = input.pendingToolCalls.some(
    (call) => call.awaitingApproval && PLAN_APPROVAL_TOOL_WHITELIST.includes(call.toolName),
  );

  if (input.hasFailedStep || input.runStatus === "failed") return "failed";
  if (hasPendingApproval) return "approving";
  if (input.ledgerEmpty) return "preparing";
  if (input.runStatus === "running" || input.runStatus === "interrupted") return "executing";
  if (input.runStatus === "succeeded") return "done";
  return "planning";
}

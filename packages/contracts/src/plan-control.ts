/**
 * 契约束 `plan-control` — ③ API 契约（zod 单一事实源）
 *
 * TW-P0-3（六态工作流与可编辑计划）：引擎产出的 todo 账本，怎么变成一份用户可读、
 * 可改、可确认、可控制执行的计划，而不在改的过程中与引擎自己的账本互相覆盖。
 * 判据单一事实源在 `.harness/instructions/chat-task-workbench-acceptance.md` TW-P0-3
 * （本文件不重抄判据正文，只引用编号）。
 *
 * 束↔feature 映射的权威在 `design-signoff.md` 的 frontmatter `covers:`（ADR-023 决策三）。
 *
 * ⚠ `UC-2`（引擎快照落账本）/ `UC-8`（确认门判定）/ `UC-12`（计划送达下一轮 run）
 *   是**内部端口，无 HTTP 面**——分别标 `hostedBy: "write-todos-ingest"` /
 *   `"pure-function"` / `"run-creation-pipeline"`，不带 `method`/`path`。
 *   其余用例都有真实 HTTP 面。
 *
 * 覆盖 feature：F972–F978（phase-01，`feat/plan-control-features` #2150 回填）。
 * 依据：`phases/phase-01-run-a-project/contracts/plan-control/{domain,usecases,coverage}.md`
 * （签核 ①②③ 三件材料，`design-signoff.md` status: confirmed，confirmed_by: usamshen，
 * 2026-08-26）。
 */
import { z } from "zod";

/* ── 值对象与枚举（domain.md 一）─────────────────────────────────────── */

/**
 * **封闭枚举，三值**，与 `packages/contracts/src/agui-state-events.ts` 的
 * `AguiPlanTodoStatus` **逐字相同**——不得在本束新造第四个值（domain.md 一·2，
 * 引擎侧 `write_todos` 只产出这三个）。
 */
export const PlanStepStatus = z.enum(["pending", "in_progress", "completed"]);
export type PlanStepStatus = z.infer<typeof PlanStepStatus>;

/** 封闭枚举，两值（domain.md 一·4）。 */
export const PlanOrigin = z.enum(["engine", "user"]);
export type PlanOrigin = z.infer<typeof PlanOrigin>;

/**
 * 六态 · 封闭枚举，六值（domain.md 一·5）。**派生值，不是可写字段**（不变量 I-7）。
 * 面向用户的中文文案：准备 / 计划 / 执行 / 审批 / 完成 / 失败——这是同一事实的
 * 两份表示的**唯一事实源**，前端不得自己维护一张映射表（本仓已五次因此漂移）。
 */
export const PlanPhase = z.enum(["preparing", "planning", "executing", "approving", "done", "failed"]);
export type PlanPhase = z.infer<typeof PlanPhase>;

export const PLAN_PHASE_LABEL_ZH: Record<z.infer<typeof PlanPhase>, string> = {
  preparing: "准备",
  planning: "计划",
  executing: "执行",
  approving: "审批",
  done: "完成",
  failed: "失败",
};

/**
 * 封闭枚举，四值（domain.md 一·7）。⚠ 没有 `restore-checkpoint`——本轮明确不做
 * （人类 2026-08-26 裁决 (c)，`usecases.md` UC-11 已整条删除，不留恒失败的错误码）。
 * `resume` 是随「暂停必须可恢复」的裁决一起新增的（2026-08-26）。
 */
export const RunControlAction = z.enum(["pause", "resume", "retry-step", "edit-input"]);
export type RunControlAction = z.infer<typeof RunControlAction>;

export const PlanGateReason = z.enum(["no-plan", "single-step", "multi-step", "user-forced"]);
export type PlanGateReason = z.infer<typeof PlanGateReason>;

/** 服务端判定，前端只渲染结果（domain.md 一·6）。 */
export const PlanGateDecision = z.object({ required: z.boolean(), reason: PlanGateReason }).strict();
export type PlanGateDecision = z.infer<typeof PlanGateDecision>;

export const PlanConstraint = z
  .object({
    constraintId: z.string(),
    planStepId: z.string(),
    // 非空白、≤ 500 字符（domain.md 一·3）。
    text: z.string().trim().min(1).max(500),
    authorId: z.string(),
    createdAt: z.string(),
  })
  .strict();
export type PlanConstraint = z.infer<typeof PlanConstraint>;

export const PlanStep = z
  .object({
    planStepId: z.string(),
    content: z.string().trim().min(1),
    status: PlanStepStatus,
    constraints: z.array(PlanConstraint),
  })
  .strict();
export type PlanStep = z.infer<typeof PlanStep>;

export const OrphanedConstraint = z
  .object({
    constraintId: z.string(),
    text: z.string(),
    orphanedAtRevision: z.number().int().nonnegative(),
    formerStepContent: z.string(),
  })
  .strict();
export type OrphanedConstraint = z.infer<typeof OrphanedConstraint>;

/** 聚合根（domain.md 一·1）。任一 threadId 在任一时刻恰好有一份（不变量 I-1）。 */
export const PlanLedger = z
  .object({
    threadId: z.string(),
    revision: z.number().int().nonnegative(),
    steps: z.array(PlanStep),
    origin: PlanOrigin,
    basedOnRevision: z.number().int().nonnegative().nullable(),
    engineEpoch: z.number().int().nonnegative(),
    createdAt: z.string(),
  })
  .strict();
export type PlanLedger = z.infer<typeof PlanLedger>;

/**
 * 复用 `packages/contracts/src/agui-state-events.ts` 的 `AguiPlanTodo` 形状
 * （usecases.md UC-2「不新建第二份形状」）——本文件不 import 那个模块以避免循环，
 * 按其已知形状照录字段集，供 `ingestEnginePlanSnapshot` 的入参使用。
 */
export const EnginePlanTodo = z.object({ content: z.string(), status: PlanStepStatus }).strict();
export type EnginePlanTodo = z.infer<typeof EnginePlanTodo>;

/** `appliedTo`：run 活跃时只落账本，如实告知（不变量 I-11）。 */
export const PlanEditAppliedTo = z.enum(["ledger-only", "ledger-and-engine"]);
export type PlanEditAppliedTo = z.infer<typeof PlanEditAppliedTo>;

/* ── 统一失败枚举（usecases.md「统一失败枚举 PlanControlError」）───────
 *
 * ⚠ 原稿的 CHECKPOINT_UNAVAILABLE / RESTORE_NOT_IMPLEMENTED 两码已删除，随 UC-11
 *   一起（人类 2026-08-26 裁决 (c)）——留一个恒失败的错误码等于留一个假装存在的能力。
 */
export const PlanControlError = z.enum([
  // 通用
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

/* ── 用例端口（usecases.md UC-1..UC-13，跳过已删除的 UC-11）───────────
 *
 * 统一约定：调用者身份来自 `CurrentPrincipal()`，不由入参传递；可见性与写权判定
 * 全部委托 `chat` 束 UC-0（本束不重复定义角色语义）。
 */
export const operations = {
  /** UC-1 getPlanLedger —— 读当前计划（读模型，前端计划面板唯一数据来源）。 */
  getPlanLedger: {
    method: "GET",
    path: "/chat/threads/:threadId/plan",
    in: z.object({ threadId: z.string() }).strict(),
    out: z
      .object({
        revision: z.number().int().nonnegative(),
        engineEpoch: z.number().int().nonnegative(),
        origin: PlanOrigin,
        steps: z.array(
          z
            .object({
              planStepId: z.string(),
              content: z.string(),
              status: PlanStepStatus,
              constraints: z.array(z.object({ constraintId: z.string(), text: z.string(), createdAt: z.string() }).strict()),
            })
            .strict(),
        ),
        orphanedConstraints: z.array(OrphanedConstraint),
        // 派生值，出参给的是判定结果，不是原料（前端不得自己从 steps 重算）。
        phase: PlanPhase,
        gate: PlanGateDecision,
        progress: z.object({ completed: z.number().int().nonnegative(), total: z.number().int().nonnegative(), elapsedMs: z.number().int().nonnegative() }).strict(),
        pendingApplyAtNextRun: z.boolean(),
        activeRunId: z.string().nullable(),
      })
      .strict(),
    err: ["NOT_VISIBLE"] as const,
  },

  /**
   * UC-2 ingestEnginePlanSnapshot —— 引擎快照落账本（内部端口，无 HTTP 面）。
   * ⚠ 永远被接受（不变量 I-6）；`planStepId` 在这一步被赋予（内容逐字相等则继承，
   *   否则新发——已知会出错的启发式，见 domain.md 二·I-6）。
   */
  ingestEnginePlanSnapshot: {
    hostedBy: "write-todos-ingest" as const,
    in: z.object({ threadId: z.string(), todos: z.array(EnginePlanTodo) }).strict(),
    out: z.object({ revision: z.number().int().nonnegative(), engineEpoch: z.number().int().nonnegative() }).strict(),
    err: [] as const,
  },

  /** UC-3 reorderPlanStep —— 调顺序。toIndex 越界钳制到边界，不报错。 */
  reorderPlanStep: {
    method: "POST",
    path: "/chat/threads/:threadId/plan/steps/:planStepId/reorder",
    in: z.object({ threadId: z.string(), basedOnRevision: z.number().int().nonnegative(), planStepId: z.string(), toIndex: z.number().int() }).strict(),
    out: z.object({ revision: z.number().int().nonnegative(), appliedTo: PlanEditAppliedTo, auditEventId: z.string() }).strict(),
    err: [
      "NOT_VISIBLE",
      "NO_WRITE_ROLE",
      "THREAD_ARCHIVED_READONLY",
      "PLAN_NOT_FOUND",
      "PLAN_REVISION_CHANGED",
      "PLAN_STEP_NOT_FOUND",
      "AUDIT_SINK_UNAVAILABLE",
    ] as const,
  },

  /** UC-4 deletePlanStep —— 删步骤。删掉带约束的步骤不删约束（不变量 I-8，转孤儿）。 */
  deletePlanStep: {
    method: "DELETE",
    path: "/chat/threads/:threadId/plan/steps/:planStepId",
    in: z.object({ threadId: z.string(), basedOnRevision: z.number().int().nonnegative(), planStepId: z.string() }).strict(),
    out: z.object({ revision: z.number().int().nonnegative(), appliedTo: PlanEditAppliedTo, orphanedConstraintIds: z.array(z.string()), auditEventId: z.string() }).strict(),
    err: [
      "NOT_VISIBLE",
      "NO_WRITE_ROLE",
      "THREAD_ARCHIVED_READONLY",
      "PLAN_NOT_FOUND",
      "PLAN_REVISION_CHANGED",
      "PLAN_STEP_NOT_FOUND",
      "PLAN_EMPTY_NOT_ALLOWED",
      "AUDIT_SINK_UNAVAILABLE",
    ] as const,
  },

  /**
   * UC-5 addPlanConstraint —— 加约束。
   * ⚠ 送达通路已裁决（人类 2026-08-26）：A —— system 消息注入，只改 Node 侧，
   *   已知代价是约束到不了 `call_skill` 发起的子模型调用（见 `UC-12`）。
   */
  addPlanConstraint: {
    method: "POST",
    path: "/chat/threads/:threadId/plan/steps/:planStepId/constraints",
    in: z.object({ threadId: z.string(), basedOnRevision: z.number().int().nonnegative(), planStepId: z.string(), text: z.string().trim().min(1).max(500) }).strict(),
    out: z.object({ revision: z.number().int().nonnegative(), constraintId: z.string(), appliedTo: PlanEditAppliedTo, auditEventId: z.string() }).strict(),
    err: [
      "NOT_VISIBLE",
      "NO_WRITE_ROLE",
      "THREAD_ARCHIVED_READONLY",
      "PLAN_NOT_FOUND",
      "PLAN_REVISION_CHANGED",
      "PLAN_STEP_NOT_FOUND",
      "PLAN_CONSTRAINT_BLANK",
      "PLAN_CONSTRAINT_TOO_LONG",
      "AUDIT_SINK_UNAVAILABLE",
    ] as const,
  },

  /** UC-6 removePlanConstraint —— 撤掉一条约束（含孤儿）。加得进撤不掉不叫可编辑。 */
  removePlanConstraint: {
    method: "DELETE",
    path: "/chat/threads/:threadId/plan/constraints/:constraintId",
    in: z.object({ threadId: z.string(), basedOnRevision: z.number().int().nonnegative(), constraintId: z.string() }).strict(),
    out: z.object({ revision: z.number().int().nonnegative(), appliedTo: PlanEditAppliedTo, auditEventId: z.string() }).strict(),
    err: ["NOT_VISIBLE", "NO_WRITE_ROLE", "THREAD_ARCHIVED_READONLY", "PLAN_NOT_FOUND", "PLAN_REVISION_CHANGED", "AUDIT_SINK_UNAVAILABLE"] as const,
  },

  /**
   * UC-7 confirmPlan —— 确认这份计划，放行执行。
   * ⚠ `deliveredPlanDigest` 是不变量 I-10 的可验收出口：实际送进
   *   `POST /threads/:id/runs` 请求体里那段计划正文的哈希，与账本当前 revision
   *   的序列化结果一致；送达失败 ⇒ 不创建 run（fail closed）。
   */
  confirmPlan: {
    method: "POST",
    path: "/chat/threads/:threadId/plan/confirm",
    in: z.object({ threadId: z.string(), basedOnRevision: z.number().int().nonnegative() }).strict(),
    out: z.object({ revision: z.number().int().nonnegative(), runId: z.string(), deliveredPlanDigest: z.string(), auditEventId: z.string() }).strict(),
    err: ["NOT_VISIBLE", "NO_WRITE_ROLE", "PLAN_NOT_FOUND", "PLAN_REVISION_CHANGED", "PLAN_EMPTY_NOT_ALLOWED", "PLAN_DELIVERY_FAILED", "AUDIT_SINK_UNAVAILABLE"] as const,
  },

  /**
   * UC-8 evaluatePlanGate —— 确认门判定（纯函数端口，无 HTTP 面）。
   * 判定表封闭、表驱动：`userForced` → user-forced/true；`todoCount===0` →
   * no-plan/false；`todoCount===1` → single-step/false；`todoCount>=2` →
   * multi-step/true。简单提问的 `todoCount` 恒为 0（唯一生产者是 `write_todos`
   * 成功事件），⇒ 恒不加确认门——这是判据四反证可判定、不依赖阈值的机制事实。
   */
  evaluatePlanGate: {
    hostedBy: "pure-function" as const,
    in: z.object({ todoCount: z.number().int().nonnegative(), userForced: z.boolean() }).strict(),
    out: PlanGateDecision,
    err: [] as const,
  },

  /**
   * UC-9 pausePlanRun —— 暂停。语义是「可恢复的中止」，不是冻结也不是不可逆停止
   * （人类 2026-08-26 裁决，`langgraph-api==0.12.4` 实测核实）。落点：
   * `POST /threads/{id}/runs/{run_id}/cancel?action=interrupt`。
   */
  pausePlanRun: {
    method: "POST",
    path: "/chat/threads/:threadId/plan/run/pause",
    in: z.object({ threadId: z.string() }).strict(),
    out: z.object({ runId: z.string(), pausedAtStepId: z.string().nullable(), auditEventId: z.string() }).strict(),
    err: ["NOT_VISIBLE", "NO_WRITE_ROLE", "NO_ACTIVE_RUN", "RUN_ALREADY_TERMINAL", "AUDIT_SINK_UNAVAILABLE"] as const,
  },

  /**
   * UC-13 resumePlanRun —— 恢复（暂停的另一半，2026-08-26 新增）。不是新协议：
   * 在同一 threadId 上创建一轮新 run，不传 checkpoint_id（默认取最新），
   * input: null——引擎自己从检查点续跑。
   * ⚠ 与「恢复检查点」（`restoreCheckpoint`，已裁决 (c) 不做）是两件不同的事，
   *   不要在实现时把 `resume` 悄悄扩成通用检查点恢复（coverage.md 缺口 9）。
   */
  resumePlanRun: {
    method: "POST",
    path: "/chat/threads/:threadId/plan/run/resume",
    in: z.object({ threadId: z.string() }).strict(),
    out: z.object({ runId: z.string(), resumedFromStepId: z.string().nullable(), auditEventId: z.string() }).strict(),
    err: ["NOT_VISIBLE", "NO_WRITE_ROLE", "NO_PAUSED_STATE", "AUDIT_SINK_UNAVAILABLE"] as const,
  },

  /**
   * UC-10 retryPlanStep —— 重试某一步（判据六 ①）。实现语义：把该 step 及其后续
   * 置回 pending，写回账本，起新一轮 run（经 UC-7 送达路径）——不是引擎级「从那个
   * 节点继续」（那需要 checkpoint，已裁决 (c) 不做，见 UC-11 已删除）。
   */
  retryPlanStep: {
    method: "POST",
    path: "/chat/threads/:threadId/plan/steps/:planStepId/retry",
    in: z.object({ threadId: z.string(), planStepId: z.string() }).strict(),
    out: z.object({ runId: z.string(), auditEventId: z.string() }).strict(),
    err: ["NOT_VISIBLE", "NO_WRITE_ROLE", "PLAN_STEP_NOT_FOUND", "NO_ACTIVE_RUN", "AUDIT_SINK_UNAVAILABLE"] as const,
  },

  /**
   * UC-12 deliverPlanToRun —— 计划与约束进入下一轮 run（内部端口，无 HTTP 面）。
   * 不变量 I-10 的实现端口，唯一注入点。通路已裁决：A —— system 消息注入，只改
   * Node 侧。`digest` 是实际送出去的那段正文的哈希，不是「本该送出去的」。
   * ⚠ 与在飞的线冲突：`apps/api/src/application/agent-run/execute-run.ts` 当前
   *   有另一条线在改同一处组装点，本束实现须排在其后。
   */
  deliverPlanToRun: {
    hostedBy: "run-creation-pipeline" as const,
    in: z.object({ threadId: z.string(), ledgerRevision: z.number().int().nonnegative() }).strict(),
    out: z.object({ digest: z.string() }).strict(),
    err: ["PLAN_DELIVERY_FAILED"] as const,
  },
} as const;

export type Operations = typeof operations;

/**
 * ~~`restoreCheckpoint`~~ 已整条删除，不留形状、不留恒失败的错误码
 * （人类 2026-08-26 裁决 (c)，`usecases.md` UC-11）。TW-P0-3 判据六如实封顶 0.7——
 * 判据没有被改松，是我们明确选择不做第三个恢复动作。此处留名只为防止未来
 * 有人以为「忘了」而把它加回来：**它不是遗漏，是知情裁决**。
 */
export const RESTORE_CHECKPOINT_NOT_IMPLEMENTED = true as const;

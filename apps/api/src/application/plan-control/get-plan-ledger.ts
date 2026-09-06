/**
 * UC-1 `getPlanLedger` —— 读当前计划（读模型），前端计划面板**唯一**的数据来源。
 *
 * 权威规格：`usecases.md` UC-1 + `domain.md` I-7（phase 派生）/ I-1（单一最大 revision）。
 * `phase`/`gate`/`progress` 三个都是**派生值**——本文件只组装派生所需的原料
 * 并调用 `packages/contracts/src/plan-control.ts` 的 `derivePlanPhase`/`evaluatePlanGate`，
 * 不在这里重新实现一遍判定逻辑（前端也一样，见 domain.md 一·5 的警告）。
 *
 * ⚠ 可见性判定（`NOT_VISIBLE`）委托 `chat` 束 UC-0，本用例的调用方（controller）负责
 * 先做那次判定；这里只做「有没有账本」这一件事，不重复定义角色语义（usecases.md 统一约定）。
 *
 * ⚠ 零计划是正常态：新线程返回 `revision:0, steps:[], phase:'preparing',
 * gate:{required:false,reason:'no-plan'}`，不抛 `PLAN_NOT_FOUND`（那个码只出现在写操作里）。
 */
import {
  derivePlanPhase, evaluatePlanGate,
  type OrphanedConstraint, type PlanGateDecision, type PlanOrigin, type PlanPhase, type PlanStep,
} from "@repo/contracts/plan-control";
import type { OrgId } from "../../domain/org-id";
import type { PlanLedgerRepository, PlanRunStatusReader } from "./ports";

export interface GetPlanLedgerOutput {
  readonly pausedAt: string | null;
  readonly pauseRequestedAt: string | null;
  readonly cancelRequestedAt: string | null;
  readonly revision: number;
  readonly engineEpoch: number;
  readonly origin: PlanOrigin;
  readonly steps: PlanStep[];
  readonly orphanedConstraints: OrphanedConstraint[];
  readonly phase: PlanPhase;
  readonly gate: PlanGateDecision;
  readonly progress: { readonly completed: number; readonly total: number; readonly elapsedMs: number };
  readonly pendingApplyAtNextRun: boolean;
  readonly activeRunId: string | null;
  /** issue #2451 —— 真实失败原因（`agent_runs.error_code` 原样透传），终态非
   *  `failed` 时恒为 `null`。前端用它替换写死的失败占位文案（`describeAgentRunError`）。 */
  readonly errorCode: string | null;
  /** issue #2451 —— 哪一步失败：`steps` 里 `status==='in_progress'` 的那一步
   *  （run 死掉那一刻仍在跑的那一步），不是"第一个未完成的步骤"——见下方计算处注释。
   *  终态非 `failed` 时恒为 `null`。 */
  readonly failedStepId: string | null;
}

const ACTIVE_RUN_STATUSES = new Set(["running"]);
// ⚠ `RunStatusForPhase` 只有 "idle"|"running"|"succeeded"|"failed"|"interrupted" 五值
// （`PgPlanLedgerRepository.toRunStatusForPhase` 把 DB 的 queued/writeback_pending/
// awaiting_tool_permission 都折进 "running"）。`activeRunId` 只在这一档非空——"idle"/"succeeded"/
// "failed" 都不是「当前有一个正在跑或等待推进的 run」。

export async function getPlanLedger(
  repo: PlanLedgerRepository,
  runs: PlanRunStatusReader,
  input: { readonly orgId: OrgId; readonly threadId: string },
): Promise<GetPlanLedgerOutput> {
  const [ledger, orphans, run] = await Promise.all([
    repo.getLatest(input.orgId, input.threadId),
    repo.listOrphanedConstraints(input.orgId, input.threadId),
    runs.getLatestRun(input.orgId, input.threadId),
  ]);

  const steps = ledger?.steps ?? [];
  const total = steps.length;
  const completed = steps.filter((s) => s.status === "completed").length;

  const runStatus = run?.pausedAt ? "interrupted" : run?.status ?? "idle";
  const activeRunId = run !== null && ACTIVE_RUN_STATUSES.has(runStatus) ? run.runId : null;
  const elapsedMs = run !== null && activeRunId !== null
    ? Math.max(0, Date.now() - new Date(run.createdAt).getTime())
    : 0;

  const phase = derivePlanPhase({
    runStatus,
    ledgerEmpty: total === 0,
    pendingToolCalls: run?.pendingToolName !== null && run?.pendingToolName !== undefined
      ? [{ toolName: run.pendingToolName, awaitingApproval: true }]
      : [],
    hasFailedStep: false,
  });

  const gate = evaluatePlanGate({ todoCount: total, userForced: false });

  // I-11 的读面：一条 `origin='user'` 的最新账本行，若此刻恰好又有活跃 run，说明这版
  // 编辑是在 run 执行期间落的账（只落账本，未进引擎）——UC-3/4/5/6 会在写入时把这条
  // 语义如实标成 `appliedTo:'ledger-only'`；这里是 F974 编辑动作落地前就先能读出来的
  // 派生近似：`origin==='user' && activeRunId!==null`。F974 落地编辑动作后，这个近似
  // 与写入时记的真实值应当重合——若发现不重合，以写入时的真实标记为准（那才是 I-11 的
  // 权威来源），本字段是读模型的复算，不是另一份独立事实。
  const pendingApplyAtNextRun = ledger?.origin === "user" && activeRunId !== null;

  // issue #2451 —— `failedStepId`：只在 `phase==='failed'` 时算，别处恒 `null`
  // （与 `errorCode` 同一条纪律，见上面字段头注）。取最新账本快照里 `status===
  // 'in_progress'` 的那一步——这是 run 死掉那一刻唯一有真实信号支持"正是它"的一步，
  // 不是猜的。理论上正常写路径下至多一个 `in_progress`（`write_todos` 顺序推进）；
  // 万一 run 在第一步真正开始前就死了（`write_todos` 还没来得及把它标 `in_progress`），
  // 这里退回第一个 `pending` 步骤——即将要跑但没跑成的那一步，仍是有依据的选择，
  // 不是向"猜"倒退（比旧版前端"第一个未完成的步骤"窄：不会跳过一个正在跑的
  // `in_progress` 步骤去选后面的 `pending`）。两种情况都取不到时才是 `null`。
  const failedStepId = phase === "failed"
    ? (steps.find((s) => s.status === "in_progress") ?? steps.find((s) => s.status === "pending"))
      ?.planStepId ?? null
    : null;

  return {
    pausedAt: run?.pausedAt ?? null,
    pauseRequestedAt: run?.pauseRequestedAt ?? null,
    cancelRequestedAt: run?.cancelRequestedAt ?? null,
    revision: ledger?.revision ?? 0,
    engineEpoch: ledger?.engineEpoch ?? 0,
    origin: ledger?.origin ?? "engine",
    steps,
    orphanedConstraints: orphans.map((o) => ({
      constraintId: o.constraintId, text: o.text,
      orphanedAtRevision: o.orphanedAtRevision, formerStepContent: o.formerStepContent,
    })),
    phase,
    gate,
    progress: { completed, total, elapsedMs },
    pendingApplyAtNextRun,
    activeRunId,
    errorCode: run?.pausedAt ? null : run?.errorCode ?? null,
    failedStepId,
  };
}

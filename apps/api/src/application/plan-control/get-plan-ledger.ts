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
  derivePlanPhase, evaluatePlanGate, PLAN_CONFIRMATION_TOOL_NAME,
  type OrphanedConstraint, type PlanGateDecision, type PlanOrigin, type PlanPhase, type PlanStep,
  type RunStatusForPhase,
} from "@repo/contracts/plan-control";
import { wave2Runtime } from "@repo/contracts";
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
  /** issue #3099 —— 派生 `phase` 用的同一个 `runStatus`，原样下发给前端做运行级控制
   *  判定（`deriveRunControls`）。不是第二份事实：这里下发的就是下面喂给
   *  `derivePlanPhase` 的那一个值，不重算。 */
  readonly runStatus: RunStatusForPhase;
  readonly activeRunId: string | null;
  /** issue #2451 —— 真实失败原因（`agent_runs.error_code` 原样透传），终态非
   *  `failed` 时恒为 `null`。前端用它替换写死的失败占位文案（`describeAgentRunError`）。 */
  readonly errorCode: string | null;
  readonly failureReason: string | null;
  /** issue #2451 —— 哪一步失败：`steps` 里 `status==='in_progress'` 的那一步
   *  （run 死掉那一刻仍在跑的那一步），不是"第一个未完成的步骤"——见下方计算处注释。
   *  终态非 `failed` 时恒为 `null`。 */
  readonly failedStepId: string | null;
  /**
   * issue #3132（B7）—— `steps` 里装的是**提案**（尚未生效的计划）还是已生效账本。
   *
   * `true` 只出现在 `phase === "planning"`（run 停在 `write_todos` 确认中断上）：此刻
   * 引擎账本必然为空（`revision` 仍是 0），`steps` 来自待决工具调用的 args。前端据此
   * 把步骤标成「提案」，与已生效账本视觉可区分。
   *
   * 这个字段必须存在，不能让前端拿 `phase === "planning"` 自己推：读模型知道 `steps`
   * 的产地，前端不知道——让前端猜就是在第二个地方声明同一件事。
   */
  readonly stepsAreProposal: boolean;
  /**
   * issue #3132（B7）—— 确认门上「确认并执行」要提交到哪个待决裁决。
   *
   * 只在 `phase === "planning"`（`stepsAreProposal === true`）时非空。前端拿它 +
   * `activeRunId` 调既有的 `decidePermissionRequest(approve)`，**恢复停住的那条 run**
   * ——不是 `confirmPlan`（那条会 `createConfirmedRun` 新起一条 run，两者在 UI 上是
   * 不同入口，人类裁决 O-2 明确切开）。
   */
  readonly pendingPermissionRequestId: string | null;
}

/**
 * issue #3132 —— 从待决 `write_todos` 调用的 args 里取出**提案步骤**。
 *
 * 输入是 `agent_runs.pending_args_summary` 原样透传的那串 JSON。解析失败（被截断成
 * 非法 JSON、形状不对、todos 不是数组）一律返回 `null` ——调用方据此退回「没有提案」，
 * 也就不会进 `planning` 态。**这是刻意的 fail-closed**：读不出提案却仍然渲染一张空的
 * 确认门，是比不渲染更坏的形态（用户面对一张没有内容的卡片，无从判断该不该确认）。
 *
 * ⚠ 截断陷阱见 `PlanRunSnapshot.pendingArgsSummary` 的头注：`write_todos` 在
 * `deep-agent-model-provider.ts` 享有 4000 字符豁免，本函数依赖它。
 */
function parseProposedSteps(argsSummary: string | null): PlanStep[] | null {
  if (argsSummary === null || argsSummary === "") return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(argsSummary);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const todos = (parsed as { todos?: unknown }).todos;
  if (!Array.isArray(todos) || todos.length === 0) return null;
  const steps: PlanStep[] = [];
  for (const [index, todo] of todos.entries()) {
    if (typeof todo !== "object" || todo === null) return null;
    const content = (todo as { content?: unknown }).content;
    if (typeof content !== "string") return null;
    const status = (todo as { status?: unknown }).status;
    steps.push({
      // 提案还没进过数据库，没有真实 `planStepId`。用「提案 + 序号」这个确定性的合成
      // id：同一份提案重复读到的 id 稳定（前端列表 key 不抖），且带 `proposed-` 前缀，
      // 一眼能看出它不是账本行的主键——不会有人误拿它去 UPDATE 账本。
      planStepId: `proposed-${index}`,
      content,
      status: status === "in_progress" || status === "completed" ? status : "pending",
      constraints: [],
    });
  }
  return steps;
}

const ACTIVE_RUN_STATUSES = new Set(["running"]);
// `RunStatusForPhase` distinguishes idle/running/succeeded/failed/interrupted/cancelled.
// The repository folds queued/writeback_pending/awaiting_tool_permission into running.
// Only running has an activeRunId; terminal states never inherit live pause controls.

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

  // issue #3132（B7）—— 计划确认门：run 停在 `write_todos` 中断上时，账本还是空的
  // （提案未生效），要展示的步骤在待决调用的 args 里。两个条件必须**同时**成立才算
  // 「有提案」：待决工具名是契约钉死的那一个，且 args 真的解析得出步骤。
  const proposedSteps = run?.pendingToolName === PLAN_CONFIRMATION_TOOL_NAME
    ? parseProposedSteps(run.pendingArgsSummary)
    : null;

  const ledgerSteps = ledger?.steps ?? [];

  const terminal = run !== null && ["succeeded", "failed", "cancelled"].includes(run.status);
  // Stored pause timestamps remain audit history; terminal runs have no live pause control.
  const pausedAt = terminal ? null : run?.pausedAt ?? null;
  const runStatus = pausedAt ? "interrupted" : run?.status ?? "idle";
  const activeRunId = run !== null && ACTIVE_RUN_STATUSES.has(runStatus) ? run.runId : null;
  const elapsedMs = run !== null && activeRunId !== null
    ? Math.max(0, Date.now() - new Date(run.createdAt).getTime())
    : 0;

  const phase = derivePlanPhase({
    runStatus,
    // 账本是否为空，看的仍然是**账本**——提案不是账本。传 `total` 会让一份提案把
    // `ledgerEmpty` 说成 false，那是在第二个地方重新定义「什么算已生效的计划」。
    ledgerEmpty: ledgerSteps.length === 0,
    pendingToolCalls: run?.pendingToolName !== null && run?.pendingToolName !== undefined
      ? [{ toolName: run.pendingToolName, awaitingApproval: true }]
      : [],
    hasFailedStep: false,
    hasPendingPlanConfirmation: proposedSteps !== null,
  });
  // 终态（done/failed/cancelled）优先于 `planning`（见 `derivePlanPhase` 里那段插入位置
  // 的注释）。phase 已经不是 `planning` 时，提案也就不该再作为步骤下发——否则一条被取消
  // 的 run 会把一份从未生效的提案当成账本展示出来。
  const stepsAreProposal = proposedSteps !== null && phase === "planning";
  const effectiveSteps = stepsAreProposal && proposedSteps !== null ? proposedSteps : ledgerSteps;

  // 判定表逐字不变（UC-8 单一事实源）：`planning` 态下 `todoCount` 就是提案步骤数，
  // 于是「简单问答（0/1 步）不加门槛」这条判据在提案路径上原样成立——引擎侧的谓词
  // 用的是同一条分界（`PLAN_CONFIRM_MIN_STEPS`），两边不会给出矛盾的答案。
  const gate = evaluatePlanGate({ todoCount: effectiveSteps.length, userForced: false });

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
    ? (ledgerSteps.find((s) => s.status === "in_progress") ?? ledgerSteps.find((s) => s.status === "pending"))
      ?.planStepId ?? null
    : null;

  return {
    pausedAt,
    pauseRequestedAt: terminal ? null : run?.pauseRequestedAt ?? null,
    cancelRequestedAt: run?.cancelRequestedAt ?? null,
    revision: ledger?.revision ?? 0,
    engineEpoch: ledger?.engineEpoch ?? 0,
    origin: ledger?.origin ?? "engine",
    steps: effectiveSteps,
    orphanedConstraints: orphans.map((o) => ({
      constraintId: o.constraintId, text: o.text,
      orphanedAtRevision: o.orphanedAtRevision, formerStepContent: o.formerStepContent,
    })),
    phase,
    gate,
    progress: {
      // 进度按**实际展示的那份步骤**算：提案态下 0/N（一步都还没跑），账本态下沿用原语义。
      completed: effectiveSteps.filter((s) => s.status === "completed").length,
      total: effectiveSteps.length,
      elapsedMs,
    },
    pendingApplyAtNextRun,
    stepsAreProposal,
    pendingPermissionRequestId: stepsAreProposal ? run?.pendingPermissionRequestId ?? null : null,
    runStatus,
    activeRunId,
    errorCode: runStatus === "failed" ? run?.errorCode ?? null : null,
    // #3403 ④：与 errorCode 同一条件同一来源——只在真失败时下发，其余恒 null。
    failureReason: runStatus === "failed"
      ? wave2Runtime.AgentRunFailureReason.safeParse(run?.failureReason).data ?? null
      : null,
    failedStepId,
  };
}

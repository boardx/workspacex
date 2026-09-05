/**
 * decideToolPermission（Phase 14 F06，`plan-permissions` 契约束 UC-6）—— 四选一工具
 * 权限决策的落点：仅本次 / 本次 run 内都允许 / 以后都允许 / 拒绝。
 *
 * 与旧 DA-07b 单工具审批弹层的 `decideAgentRun` 是两条并行出口（迁移期共存，见
 * `ports.ts` `denyAndRequeue` 自己的文档）：
 *   once/run/forever → 都走 approveAndRequeue（同一条 `awaiting_tool_permission →
 *     queued` 边），差别只在要不要额外落一条授权记录（`run`/`forever` 才落，`once`
 *     不落——I-4：授权粒度互不越界，"单次"因此永远不在授权存储里留痕）；
 *   deny             → denyAndRequeue（同一条边，`pending_decision='deny'`），execute-run
 *     据此让 provider 发 `resume:{decision:"reject"}`，内核收到拒绝结果后自己调整
 *     后续计划继续跑，不是让 run 直接失败（R3 步骤 6）。
 *
 * 可见性/权限纪律逐字沿用 `decideAgentRun`（同目录）：locator → resolveVisibility →
 * observer/归档线程禁操作 → 条件 UPDATE 输了竞态按冲突报，不重试不覆盖。
 */
import type { ToolPermissionDecisionKind } from "@repo/contracts/plan-permissions";
import type { OrgId } from "../../domain/org-id";
import { discloseDecided, isDisclosed } from "../security/permission-filter";
import type { ResolveVisibilityDeps } from "../chat/resolve-visibility";
import { resolveVisibility } from "../chat/resolve-visibility";
import { AgentRunNotVisibleError } from "./read-run";
import { AgentRunRetryForbiddenError } from "./retry-run";
import type { AgentRunStore, RunProjection } from "./ports";
import type { ToolPermissionGrantStore } from "./tool-permission-grants";

export class RunNotAwaitingToolPermissionError extends Error {
  constructor(readonly status: string) {
    super(`run is in "${status}", not awaiting_tool_permission`);
  }
}

export interface DecideToolPermissionDeps extends ResolveVisibilityDeps {
  readonly runs: AgentRunStore;
  readonly grants: ToolPermissionGrantStore;
  readonly kick: (orgId: OrgId) => void;
}

export async function decideToolPermission(
  deps: DecideToolPermissionDeps,
  input: {
    readonly userId: string; readonly orgId: OrgId; readonly runId: string;
    /**
     * UC-6 的入参形状里有 `toolCallId`，但本仓当前的执行内核每次只可能有一个待批
     * 工具调用停在 `awaiting_tool_permission`（`AgentRunStore.findAwaitingToolPermissionRunId`
     * 自己的文档已经论证过这个不变量）——竞态/"已被裁决"因此已经由下面对 run 状态
     * 本身的条件 UPDATE 兜底，不需要这里再拿 `toolCallId` 去匹配一份并不存在的多值
     * 待批列表。字段仍然收下（契约形状忠实），只在错误信息里回显，不参与判定。
     */
    readonly toolCallId: string;
    readonly decision: ToolPermissionDecisionKind;
  },
): Promise<RunProjection> {
  const locator = await deps.runs.findLocator(input.orgId, input.runId);
  if (locator === null) throw new AgentRunNotVisibleError();

  const outcome = await resolveVisibility(deps, {
    userId: input.userId,
    orgId: input.orgId,
    projectId: locator.projectId,
    threadId: locator.threadId,
  });
  if (outcome.kind !== "allow") throw new AgentRunNotVisibleError();
  if (outcome.actor.projectRole === "observer") throw new AgentRunRetryForbiddenError();
  if (outcome.thread.archived) throw new AgentRunRetryForbiddenError();

  const before = await deps.runs.readRun(input.orgId, input.runId);
  if (before === null) throw new AgentRunNotVisibleError();
  const beforeDisclosed = discloseDecided(before, outcome.base);
  if (!isDisclosed(beforeDisclosed)) throw new AgentRunNotVisibleError();
  if (beforeDisclosed.payload.status !== "awaiting_tool_permission") {
    throw new RunNotAwaitingToolPermissionError(beforeDisclosed.payload.status);
  }
  const pendingToolName = beforeDisclosed.payload.pendingApproval?.toolName ?? null;

  if (input.decision === "deny") {
    const requeued = await deps.runs.denyAndRequeue(input.orgId, input.runId);
    if (!requeued) {
      const guarded = await deps.runs.readRun(input.orgId, input.runId);
      throw new RunNotAwaitingToolPermissionError(guarded === null ? "unknown" : "conflict");
    }
    deps.kick(input.orgId);
  } else {
    const requeued = await deps.runs.approveAndRequeue(input.orgId, input.runId);
    if (!requeued) {
      const guarded = await deps.runs.readRun(input.orgId, input.runId);
      throw new RunNotAwaitingToolPermissionError(guarded === null ? "unknown" : "conflict");
    }
    // I-4：授权粒度互不越界——"仅本次"不落任何授权记录，只把这一次放行。
    if (pendingToolName !== null) {
      if (input.decision === "run") {
        await deps.grants.grantForRun(input.orgId, input.runId, pendingToolName);
      } else if (input.decision === "forever") {
        await deps.grants.grantStanding(input.orgId, pendingToolName, input.userId);
      }
    }
    deps.kick(input.orgId);
  }

  const guarded = await deps.runs.readRun(input.orgId, input.runId);
  if (guarded === null) throw new AgentRunNotVisibleError();
  const disclosed = discloseDecided(guarded, outcome.base);
  if (!isDisclosed(disclosed)) throw new AgentRunNotVisibleError();
  return disclosed.payload;
}

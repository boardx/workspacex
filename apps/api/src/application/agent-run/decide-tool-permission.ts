import { AGENT_INTERRUPTS_TOOL_NAME_LIST } from "@repo/contracts/agent-interrupts";
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
  readonly grants?: ToolPermissionGrantStore;
  readonly kick: (orgId: OrgId) => void;
}

export async function decideToolPermission(
  deps: DecideToolPermissionDeps,
  input: {
    readonly userId: string; readonly orgId: OrgId; readonly runId: string;
    /** Legacy route parameter name; value is the durable permissionRequestId. */
    readonly toolCallId?: string;
    readonly permissionRequestId?: string;
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
  const permissionRequestId = beforeDisclosed.payload.pendingApproval?.permissionRequestId;
  if (!permissionRequestId || (input.permissionRequestId ?? input.toolCallId) !== permissionRequestId) {
    throw new RunNotAwaitingToolPermissionError("stale_permission_request");
  }
  if (beforeDisclosed.payload.pendingApproval?.interrupt || AGENT_INTERRUPTS_TOOL_NAME_LIST.some((name) => name === beforeDisclosed.payload.pendingApproval?.toolName)) {
    throw new RunNotAwaitingToolPermissionError("form_decision_required");
  }
  if (!deps.runs.decidePermissionRequest || !await deps.runs.decidePermissionRequest(
    input.orgId, input.runId, permissionRequestId, input.decision, input.userId,
  )) throw new RunNotAwaitingToolPermissionError("stale_permission_request");
  deps.kick(input.orgId);

  const guarded = await deps.runs.readRun(input.orgId, input.runId);
  if (guarded === null) throw new AgentRunNotVisibleError();
  const disclosed = discloseDecided(guarded, outcome.base);
  if (!isDisclosed(disclosed)) throw new AgentRunNotVisibleError();
  return disclosed.payload;
}

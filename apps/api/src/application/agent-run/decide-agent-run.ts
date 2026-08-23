/**
 * decideAgentRun（DA-07b，#1749，rubric D6）—— awaiting_approval 的唯一出口。
 *
 * run 停在敏感工具调用前（interrupt_on，见 deep-agent-service 的 harness.py），
 * 人在这里裁决：
 *   approve → run 重新入队（queued + pending_decision='approve'），executor 领走后
 *             execute-run 让 provider 以 command.resume 续跑既有远端 run，不重发输入。
 *   edit    → （UX-9 D4）人在线改参数后放行：与 approve 走同一条 awaiting_approval →
 *             queued 边，另把改后的完整参数对象落 pending_edited_args；resume 时
 *             provider 发 EditDecision（工具名沿用待批工具，不许换工具，见 contracts）。
 *   reject  → run 落 failed("HITL_REJECTED")。拒绝是终态：用户明确说了不，
 *             不提供「拒绝后自动改道」——那会把「不许做」偷换成「换个方式做」。
 *
 * 可见性/权限纪律逐字沿用 retryAgentRun（同一目录）：locator → resolveVisibility →
 * observer/归档线程禁操作 → 条件 UPDATE 输了竞态按冲突报，不重试不覆盖。
 */
import type { OrgId } from "../../domain/org-id";
import { discloseDecided, isDisclosed } from "../security/permission-filter";
import type { ResolveVisibilityDeps } from "../chat/resolve-visibility";
import { resolveVisibility } from "../chat/resolve-visibility";
import { AgentRunNotVisibleError } from "./read-run";
import { AgentRunRetryForbiddenError } from "./retry-run";
import type { AgentRunStore, RunProjection } from "./ports";

export class AgentRunNotAwaitingApprovalError extends Error {
  constructor(readonly status: string) {
    super(`run is in "${status}", not awaiting_approval`);
  }
}

export interface DecideAgentRunDeps extends ResolveVisibilityDeps {
  readonly runs: AgentRunStore;
  readonly kick: (orgId: OrgId) => void;
}

export async function decideAgentRun(
  deps: DecideAgentRunDeps,
  // decision 与 editedArgs 的绑定在类型上钉死（判别联合）：edit 必带改后参数、
  // approve/reject 不可能带——控制器把 400 挡在门外，这里不再需要运行时二次校验。
  input: {
    readonly userId: string; readonly orgId: OrgId; readonly runId: string;
  } & (
    | { readonly decision: "approve" | "reject" }
    | { readonly decision: "edit"; readonly editedArgs: Readonly<Record<string, unknown>> }
  ),
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

  // 先验状态：不在 awaiting_approval 的 run 一律冲突——否则 reject 分支会把一个
  // 正在 running 的 run 任意杀掉（decision 端点变成 kill 开关，谁都没授权过这件事）。
  // 这里的读与下面的条件 UPDATE 之间仍有竞态窗口，由 UPDATE 的 WHERE 状态条件兜底；
  // 本检查挡的是「压根不该发起」的调用，不是并发正确性的最后一道。
  const before = await deps.runs.readRun(input.orgId, input.runId);
  if (before === null) throw new AgentRunNotVisibleError();
  const beforeDisclosed = discloseDecided(before, outcome.base);
  if (!isDisclosed(beforeDisclosed)) throw new AgentRunNotVisibleError();
  if (beforeDisclosed.payload.status !== "awaiting_approval") {
    throw new AgentRunNotAwaitingApprovalError(beforeDisclosed.payload.status);
  }

  if (input.decision === "reject") {
    // failRun 自带「非终态才动」条件；已终态时下面的重读把真实状态报给冲突方。
    await deps.runs.failRun(input.orgId, input.runId, "HITL_REJECTED");
  } else {
    // approve 与 edit 共享同一条重新入队边与同一套竞态语义；差别只在 edit 多落
    // 一份改后参数（JSON 文本，provider 侧解析校验）。
    const requeued = input.decision === "edit"
      ? await deps.runs.editAndRequeue(input.orgId, input.runId, JSON.stringify(input.editedArgs))
      : await deps.runs.approveAndRequeue(input.orgId, input.runId);
    if (!requeued) {
      const guarded = await deps.runs.readRun(input.orgId, input.runId);
      const status = guarded === null ? "unknown" : "conflict";
      throw new AgentRunNotAwaitingApprovalError(status);
    }
    deps.kick(input.orgId);
  }

  const guarded = await deps.runs.readRun(input.orgId, input.runId);
  if (guarded === null) throw new AgentRunNotVisibleError();
  const disclosed = discloseDecided(guarded, outcome.base);
  if (!isDisclosed(disclosed)) throw new AgentRunNotVisibleError();
  if (input.decision === "reject" && disclosed.payload.error !== "HITL_REJECTED") {
    // reject 输了竞态（run 已终态成别的结果）——如实报冲突，不假装拒绝生效。
    throw new AgentRunNotAwaitingApprovalError(disclosed.payload.status);
  }
  return disclosed.payload;
}

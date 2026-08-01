/**
 * `decideApproval`（F112 · uc-8-2 · 批准闸门第二步：三出口之一）。
 *
 * ## 并发语义——本实现选的是哪一条，为什么
 *
 * `chat.ts` 的契约注释同时提到两件事：① I-29「并发两次 approve 只有一个生效，
 * 另一个收到状态已变化」；② "同一 (requestId, expectedStatus) 的重复 approve 应
 * 返回同一 taskId，不产生第二个任务"（幂等重放）。这两条在契约现有的输入形状下
 * **无法同时精确成立**——契约没有携带任何「这是第几次尝试同一个决定」的幂等键
 * （nonce/idempotency-key），单靠 `(requestId, expectedStatus="paused")` 无法区分
 * 「同一个调用方在重试」与「另一个调用方在竞争」。
 *
 * 本实现取 **①**（domain.md I-29 的"怎么断言"逐条写明的是这一种），即：
 * 任何一次 `decide` 若未能把请求从 `paused` 原子转移出去，一律返回
 * `APPROVAL_STATUS_CHANGED`，**不做重复识别**。这是一个已登记的简化，与契约注释里
 * "幂等重放"那句字面不完全一致——真正的行为选择应当在契约获得幂等键字段之后重新评估，
 * 而不是由本实现暗自决定"看起来像重试就当作重试"（那本身就是把安全边界押在一个
 * 启发式判断上）。
 */
import type { OrgId } from "../../domain/org-id";
import { modelPolicyViolation, type ApprovalDataScopeT } from "../../domain/chat/approval-gate";
import type { ApprovalRequestRow, ChatRepository } from "./ports";
import type { ApprovalModelRegistryReader } from "./approval-model-registry";
import type { ProvenanceWriter } from "../provenance/ports";
import type { IdFactory } from "../artifact/ports";
import type { Clock } from "../auth/ports";
import { DEFAULT_ETA_MINUTES, ModelPolicyViolationError, RegistryUnavailableError } from "./create-approval-request";

export class ApprovalNotFoundError extends Error {
  constructor() {
    super("approval_not_found");
  }
}

/** 见文件头：本实现下，"已经不是 paused" 一律走这个出口，不做重试识别。 */
export class ApprovalStatusChangedError extends Error {
  constructor() {
    super("approval_status_changed");
  }
}

export class ApprovalExpiredError extends Error {
  constructor() {
    super("approval_expired");
  }
}

export interface DecideApprovalDeps {
  readonly chat: ChatRepository;
  readonly registry: ApprovalModelRegistryReader;
  readonly provenance: ProvenanceWriter;
  readonly ids: IdFactory;
  readonly clock: Clock;
}

export interface DecideApprovalInput {
  readonly orgId: OrgId;
  readonly actorId: string;
  readonly requestId: string;
  readonly exit: "approve" | "reparam" | "decline";
  readonly newModels: readonly string[] | null;
  readonly newBudget: { readonly tokens: number; readonly amount: number; readonly currency: string } | null;
  readonly newDataScope: readonly ApprovalDataScopeT[] | null;
}

export interface DecideApprovalResult {
  readonly taskId: string | null;
  readonly etaMinutes: number | null;
  readonly newRequestId: string | null;
  readonly supersedesRequestId: string | null;
  readonly auditEventId: string;
}

async function expireIfDue(
  deps: DecideApprovalDeps,
  orgId: OrgId,
  row: ApprovalRequestRow,
): Promise<ApprovalRequestRow> {
  if (row.status !== "paused") return row;
  if (deps.clock.now().toISOString() < row.expiresAt) return row;
  const expired = await deps.chat.decideApprovalRequest(orgId, row.id, { kind: "expire" });
  return expired ?? row;
}

export async function decideApproval(
  deps: DecideApprovalDeps,
  input: DecideApprovalInput,
): Promise<DecideApprovalResult> {
  const existing = await deps.chat.findApprovalRequest(input.orgId, input.requestId);
  if (existing === null) throw new ApprovalNotFoundError();

  const current = await expireIfDue(deps, input.orgId, existing);
  if (current.status === "expired" && existing.status === "paused") {
    // 刚刚才被本次调用发现并转为 expired——这次 decide 本身对着一张已过期的卡。
    throw new ApprovalExpiredError();
  }
  if (current.status !== "paused") throw new ApprovalStatusChangedError();

  if (input.exit === "decline") {
    const updated = await deps.chat.decideApprovalRequest(input.orgId, input.requestId, {
      kind: "decline",
      decidedBy: input.actorId,
    });
    if (updated === null) throw new ApprovalStatusChangedError();
    const auditEventId = await deps.provenance.append({
      orgId: input.orgId,
      type: "approval-decided",
      actorId: input.actorId,
      target: { kind: "thread", id: findThreadIdPlaceholder(current) },
      detail: { requestId: input.requestId, exit: "decline" },
    });
    // decline：**动作永不执行**（契约注释逐字）——没有 taskId，没有 etaMinutes。
    return { taskId: null, etaMinutes: null, newRequestId: null, supersedesRequestId: null, auditEventId };
  }

  // approve / reparam 都要重新过一次模型策略校验：改参可能带来新的 models/dataScope，
  // 而 approve 也可能是在 dataScope 判定口径变化之后才被处理——不复用创建时的判定结果,
  // 现取现判（I-32 的服务端拦截不因"卡片已经生成过一次"而失效）。
  const effectiveModelIds = input.newModels ?? current.proposedModels;
  const effectiveDataScope = input.newDataScope ?? current.dataScope;
  const rows = await deps.registry.findModels(input.orgId, effectiveModelIds);
  const byId = new Map(rows.map((r) => [r.modelId, r] as const));
  for (const id of effectiveModelIds) {
    if (!byId.has(id)) throw new RegistryUnavailableError();
  }
  const violation = modelPolicyViolation(effectiveDataScope, rows);
  if (violation !== null) throw new ModelPolicyViolationError(violation);

  if (input.exit === "approve") {
    const taskId = deps.ids.next("task");
    const updated = await deps.chat.decideApprovalRequest(input.orgId, input.requestId, {
      kind: "approve",
      decidedBy: input.actorId,
      taskId,
    });
    if (updated === null) throw new ApprovalStatusChangedError();
    // ⚠ 11-task 队列未落地（见迁移文件头）——这里的"任务"是 F112 范围内的最小占位实现，
    //   不是真实编排系统。`TASK_QUEUE_UNAVAILABLE` 在当前实现下结构性不可达：这次写入
    //   与批准请求的状态转移共享同一个数据库事务边界之外的独立写，尚未接入真实队列。
    await deps.chat.createBackgroundTask(input.orgId, {
      taskId,
      approvalRequestId: input.requestId,
      etaMinutes: DEFAULT_ETA_MINUTES,
    });
    const auditEventId = await deps.provenance.append({
      orgId: input.orgId,
      type: "approval-decided",
      actorId: input.actorId,
      target: { kind: "thread", id: findThreadIdPlaceholder(current) },
      detail: { requestId: input.requestId, exit: "approve", taskId },
    });
    return {
      taskId,
      etaMinutes: DEFAULT_ETA_MINUTES,
      newRequestId: null,
      supersedesRequestId: null,
      auditEventId,
    };
  }

  // reparam：生成新请求，原请求存档为 reparamed，字节不变（I-30）。
  const newRequestId = deps.ids.next("appr");
  const now = deps.clock.now();
  const expiresAt = new Date(now.getTime() + 24 * 60 * 60_000).toISOString();
  const updated = await deps.chat.decideApprovalRequest(input.orgId, input.requestId, {
    kind: "reparam",
    decidedBy: input.actorId,
    newRequest: {
      id: newRequestId,
      threadId: current.threadId,
      agentId: current.agentId,
      action: current.action,
      callChain: current.callChain,
      proposedModels: effectiveModelIds,
      dataScope: effectiveDataScope,
      estimatedTokens: input.newBudget?.tokens ?? current.estimatedTokens,
      expiresAt,
    },
  });
  if (updated === null) throw new ApprovalStatusChangedError();
  const auditEventId = await deps.provenance.append({
    orgId: input.orgId,
    type: "approval-decided",
    actorId: input.actorId,
    target: { kind: "thread", id: findThreadIdPlaceholder(current) },
    detail: { requestId: input.requestId, exit: "reparam", newRequestId },
  });
  return {
    taskId: null,
    etaMinutes: null,
    newRequestId,
    supersedesRequestId: input.requestId,
    auditEventId,
  };
}

/** 小助手——只是为了让上面每个 `provenance.append` 调用点不必各自重复解构。 */
function findThreadIdPlaceholder(row: ApprovalRequestRow): string {
  return row.threadId;
}

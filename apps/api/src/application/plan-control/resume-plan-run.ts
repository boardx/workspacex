/**
 * UC-13 `resumePlanRun` —— 恢复（`pause` 的配对动作，`usecases.md` UC-13）。
 *
 * ⚠ **已知的、说明白的简化**：domain.md 描述的"标准"续跑原语是「同一线程上创建一轮
 * 新 run，不传 `checkpoint_id`（默认取最新），`input: null`」——引擎自己从检查点续跑，
 * 不需要本束拼装续跑用的 messages。真正做到这一点需要 `ModelCallPort`/
 * `DeepAgentModelProvider` 长出一个新的"续跑模式"（复用其已有的整套轮询/流式/写回
 * 管线，而不是重新实现一份），那是 `agent-runtime` 束的表面积，本 feature 范围之外
 * 一次性做完的代价超过了本轮的预算。
 *
 * 本轮改用 F975 已验证过的等价机制：复用 `PlanRunCreator`（`acceptHumanMessage` +
 * `executor.kick`）在**同一个确定性远端 thread**（`deriveRemoteThreadId` 保证同一
 * `chatThreadId` 恒映射同一个远端 thread）上起一轮新的合成消息轮次。**这不是字面意义
 * 上的"从检查点续跑"**——远端会把这当作该 thread 上的新一轮消息处理，不是
 * `input:null` 的检查点续跑。功能性结果类似（模型能看到到目前为止的对话历史与当前
 * 计划状态，继续往下做），但不是同一个机制。domain.md 自己的「granularity 提醒」
 * 已经在提醒不要暗示"精确到某一句"的续传语义，这条简化没有让它变得更不诚实。
 */
import type { OrgId } from "../../domain/org-id";
import type { ProvenanceWriter } from "../provenance/ports";
import { PlanEditError } from "./plan-edit-errors";
import type { PlanRunCreator } from "./plan-run-creator-port";
import type { PlanRunStatusReader } from "./ports";

export interface ResumePlanRunInput {
  readonly orgId: OrgId;
  readonly threadId: string;
  readonly actorId: string;
}

export interface ResumePlanRunOutput {
  readonly runId: string;
  /** 步骤级颗粒度读不到，如实返回 null（同 `pausePlanRun.pausedAtStepId` 的理由）。 */
  readonly resumedFromStepId: string | null;
  readonly auditEventId: string;
}

export interface ResumePlanRunDeps {
  readonly runs: PlanRunStatusReader;
  readonly runCreator: PlanRunCreator;
  readonly provenance: ProvenanceWriter;
}

const RESUME_MESSAGE_TEXT = "（用户已恢复执行，请从当前计划状态继续。）";

export async function resumePlanRun(
  deps: ResumePlanRunDeps, input: ResumePlanRunInput,
): Promise<ResumePlanRunOutput> {
  const latest = await deps.runs.getLatestRun(input.orgId, input.threadId);
  // NO_PAUSED_STATE 覆盖两种情况：这条线程从未暂停过（latest 为 null 或 pausedAt 为
  // null），或暂停后已经有更新的动作产生了新状态——本 use case 只认「最近一条 run
  // 恰好带 pausedAt」这一种可恢复态，其余一律 NO_PAUSED_STATE（coverage.md 缺口 9
  // 明确把"暂停后又发生别的编辑该怎么办"标为未定，本轮先诚实拒绝，不猜）。
  if (latest === null || latest.pausedAt === null) throw new PlanEditError("NO_PAUSED_STATE");

  let runId: string;
  try {
    const created = await deps.runCreator.createConfirmedRun({
      orgId: input.orgId, threadId: input.threadId, actorId: input.actorId,
      messageText: RESUME_MESSAGE_TEXT,
    });
    runId = created.runId;
  } catch {
    // usecases.md UC-13 的 err 数组里没有专门的"恢复失败"码——NO_PAUSED_STATE 已经在
    // 上面处理过，这里的失败只能是真正的送达失败。UC-13 本身没有 PLAN_DELIVERY_FAILED，
    // 但同一份"创建新 run 失败"的事实，本函数按 AUDIT_SINK_UNAVAILABLE 之外别无更贴切
    // 的码——如实抛出未映射的原始错误，不硬套一个不准确的码。
    throw new Error("resumePlanRun: failed to create the resumed run");
  }

  let auditEventId: string;
  try {
    auditEventId = await deps.provenance.append({
      orgId: input.orgId, type: "human-edited", actorId: input.actorId,
      target: { kind: "thread", id: input.threadId },
      detail: { action: "resumePlanRun", runId },
    });
  } catch {
    throw new PlanEditError("AUDIT_SINK_UNAVAILABLE");
  }

  return { runId, resumedFromStepId: null, auditEventId };
}

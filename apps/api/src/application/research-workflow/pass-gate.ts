/**
 * 过门 / 推进阶段 —— 需求文档那句「不得自动进入下一步」的**执行点**。
 *
 * ## 这个文件真正负责的一件事
 *
 * 把「拒绝」变成一个**有痕迹的事件**，而不是一次静默的 return。
 *
 * 静默拒绝和留痕拒绝，在用户那一刻看起来一样（都是没往下走）。区别在三个月后：
 * 测试 C 要回答「当时为什么是这个结论」，而"Agent 曾经 7 次试图跳过材料审核"
 * 这种事实，只有当时写下来才存在。所以本文件里**每一次判定都写审计**，
 * 允许的也写——只记拒绝会让"从没试过"和"试了都通过"看起来一样。
 *
 * ## 为什么门在这里而不在控制器里
 *
 * 控制器会有好几个（人点的、Agent 调的、将来可能还有批量脚本）。门若写在控制器，
 * 就有几个控制器几处门，漏掉一处没人知道。这里是唯一入口：所有阶段变更都必须
 * 经过 {@link passGate} 或 {@link advancePhase}，仓储不提供"直接设置阶段"的方法。
 */
import { researchWorkflow as C } from "@repo/contracts";
import {
  decideAdvance,
  decideGate,
  lineageAfterGate,
  type Decision,
} from "../../domain/research-workflow/state-machine";
import type { ResearchSessionRow, ResearchWorkflowRepository, UuidFactory } from "./ports";
import type { OrgId } from "../../domain/org-id";

export interface PassGateDeps {
  readonly repo: ResearchWorkflowRepository;
  readonly uuid: UuidFactory;
  /** 注入而非直接读时钟：`verifyDueAt` 的计算要可测。 */
  readonly now: () => Date;
}

/**
 * 越权被拒。
 *
 * 带上 `refusal` 原因码而不是一句中文：它要进审计表、要能被统计。
 * 一句自由文本统计不了「Agent 跳门多少次」。
 */
export class ResearchGateRefusedError extends Error {
  constructor(
    readonly refusal: C.ResearchRefusalName,
    readonly fromPhase: C.ResearchPhaseName,
  ) {
    super(C.REFUSAL_LABELS[refusal]);
  }
}

/** 发布后多久回来验证。活动图写的是"数月"，取 3 个月。 */
export const VERIFY_AFTER_MONTHS = 3;

function verifyDueAfterPublish(now: Date): string {
  const due = new Date(now);
  due.setMonth(due.getMonth() + VERIFY_AFTER_MONTHS);
  return due.toISOString();
}

/** 判定 → 留痕 → （允许时）写回。三步的顺序是固定的：先留痕，再改状态。 */
async function commit(
  deps: PassGateDeps,
  orgId: OrgId,
  session: ResearchSessionRow,
  actorKind: "human" | "agent",
  action: string,
  decision: Decision,
  nextLineage: ResearchSessionRow["lineage"],
  verifyDueAt: string | null,
): Promise<ResearchSessionRow> {
  await deps.repo.appendAudit({
    orgId,
    threadId: session.threadId,
    actorKind,
    action,
    fromPhase: session.phase,
    outcome: decision.ok ? "allowed" : "refused",
    refusal: decision.ok ? null : decision.refusal,
  });
  if (!decision.ok) throw new ResearchGateRefusedError(decision.refusal, session.phase);
  return deps.repo.applyTransition(orgId, session.threadId, decision.nextPhase, nextLineage, verifyDueAt);
}

/**
 * 人工过门。
 *
 * ⚠ `actorKind` 恒为 `"human"` 且**不接受调用方指定**——这是刻意的。
 * 如果它是个参数，Agent 侧的代码路径迟早会传一个 `"human"` 进来（无论是有意还是
 * 抄错），审计表从此再也分不清哪些门是人点的。门的全部意义就是"有人真的看过"，
 * 这个字段一旦可伪造，整张审计表就没有证据力了。
 */
export async function passGate(
  deps: PassGateDeps,
  orgId: OrgId,
  threadId: string,
  gate: C.ResearchGateName,
): Promise<ResearchSessionRow> {
  const session = await deps.repo.ensureSession(orgId, threadId);
  const decision = decideGate(session, gate);

  // 血缘只在放行时才算；被拒时原样带回，避免"拒绝了但版本号还是加了一"。
  const nextLineage = decision.ok
    ? lineageAfterGate(session.lineage, gate, deps.uuid.next())
    : session.lineage;

  // 门②/门③ 通过 = 发布了一版图谱 ⇒ 顺手登记 N 个月后的验证到期时间。
  // 这一步放在这里而不是让 Agent 自己记得调 wx_schedule_create：活动图里
  // 「等待数月」是流程的一部分，靠模型记得去登记等于没有。
  const publishes = decision.ok && (gate === "reasoning" || gate === "plan");
  const verifyDueAt = publishes ? verifyDueAfterPublish(deps.now()) : session.verifyDueAt;

  return commit(deps, orgId, session, "human", `gate:${gate}`, decision, nextLineage, verifyDueAt);
}

/**
 * Agent 侧推进阶段。
 *
 * 它到不了 `materials_approved` 与 `graph_published`——不是因为这里写了 if，
 * 而是因为领域状态机的 `AGENT_TRANSITIONS` 里**没有**通向它们的边。
 * 拒绝的是那张表，不是这段代码；这段代码只负责把拒绝写下来。
 */
export async function advancePhase(
  deps: PassGateDeps,
  orgId: OrgId,
  threadId: string,
  to: C.ResearchPhaseName,
): Promise<ResearchSessionRow> {
  const session = await deps.repo.ensureSession(orgId, threadId);
  const decision = decideAdvance(session, to);
  return commit(deps, orgId, session, "agent", `advance:${to}`, decision, session.lineage, session.verifyDueAt);
}

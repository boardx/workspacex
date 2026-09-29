/**
 * CT10 —— Board 只读运行卡投影（phase-20 work-content R8；domain I-C11 / I-C12）。
 *
 * 纯函数：输入是**调用方已按实例读权限过滤过**的运行摘要，输出契约
 * `BoardWorkflowRunCard`。本文件不查库、不判权限——I-C12「无权限者投影中不存在该卡 ID」
 * 是结构事实：没进来的实例不可能出现在输出里。运行卡是派生只读视图（R7），不写 tasks 表、
 * 不是第二事实源；`draggable` 恒为 false。
 */
import type { workContent, workflowRuntime } from "@repo/contracts";
import { board } from "@repo/contracts";
import type { z } from "zod";
import { assertNoCardLoss, type GlobalView, type ProjectView } from "./card-projection";
import type { TaskStatus } from "./task-status";

export type BoardWorkflowRunCard = z.infer<typeof workContent.BoardWorkflowRunCard>;
export type BoardRunBadge = z.infer<typeof workContent.BoardRunBadge>;
type InstanceStatus = z.infer<typeof workflowRuntime.WorkflowInstanceStatus>;
type RunColumn = BoardWorkflowRunCard["column"];

/** I-C11：实例状态 → (列, 徽标)。穷举 Record，新增实例状态时编译期即红。 */
const STATUS_MAP: Readonly<Record<InstanceStatus, { column: RunColumn; badge: BoardRunBadge }>> = {
  running: { column: "in_progress", badge: "in_progress" },
  cancelling: { column: "in_progress", badge: "in_progress" },
  awaiting_gate_decision: { column: "review", badge: "awaiting_review" },
  blocked_permission: { column: "review", badge: "awaiting_review" },
  succeeded: { column: "done", badge: "done" },
  rejected: { column: "done", badge: "rejected" },
  failed: { column: "done", badge: "failed" },
  cancelled: { column: "done", badge: "failed" },
  needs_attention: { column: "done", badge: "failed" },
};

export function mapRunStatus(status: InstanceStatus): { column: RunColumn; badge: BoardRunBadge } {
  return STATUS_MAP[status];
}

export interface RunCardAgent {
  readonly agentId: string;
  readonly digitalHumanId: string | null;
  readonly displayName: string;
  readonly avatarUrl: string | null;
}

/** 一条已通过读权限过滤的运行摘要（由 application 层组装）。 */
export interface VisibleRunSummary {
  readonly instanceId: string;
  readonly workflowName: string;
  /** 发起对象（例：线索名 / 问题标题）；缺省时标题只取 Workflow 名。 */
  readonly subjectLabel: string | null;
  readonly status: InstanceStatus;
  readonly initiatorUserId: string;
  /** 发起 Agent + 转交链，按参与顺序；A1（人直接发起）为空。 */
  readonly agents: readonly RunCardAgent[];
  readonly projectId: string | null;
}

export function runCardId(instanceId: string): string {
  return `${board.WORKFLOW_RUN_SOURCE_KIND}:${instanceId}`;
}

export function runInstanceHref(instanceId: string): string {
  return `/workflows/runs/${encodeURIComponent(instanceId)}`;
}

export function projectRunCard(run: VisibleRunSummary): BoardWorkflowRunCard {
  const { column, badge } = mapRunStatus(run.status);
  const seen = new Set<string>();
  const agents = run.agents.filter((a) => (seen.has(a.agentId) ? false : (seen.add(a.agentId), true)));
  return {
    id: runCardId(run.instanceId),
    sourceKind: board.WORKFLOW_RUN_SOURCE_KIND,
    instanceId: run.instanceId,
    title: run.subjectLabel ? `${run.workflowName} · ${run.subjectLabel}` : run.workflowName,
    instanceStatus: run.status,
    column,
    badge,
    initiatorUserId: run.initiatorUserId,
    agents: agents.map((a) => ({ ...a })),
    draggable: false,
    href: runInstanceHref(run.instanceId),
  };
}

export function projectRunCards(runs: readonly VisibleRunSummary[]): BoardWorkflowRunCard[] {
  return runs.map(projectRunCard);
}

/**
 * 与任务卡合并进 `card-projection` 两视图（UC-WC-7 第三步）。运行卡的列恒在
 * in_progress/review/done 之内，因此项目视图（四列）与全局视图（五列）可达 ID 集合相同。
 */
export function projectBoardWithRunCards(
  taskCards: readonly { readonly id: string; readonly status: TaskStatus }[],
  runCards: readonly BoardWorkflowRunCard[],
): { projectView: ProjectView; globalView: GlobalView; noCardLoss: boolean } {
  const merged = [...taskCards, ...runCards.map((c) => ({ id: c.id, status: c.column as TaskStatus }))];
  return assertNoCardLoss(merged);
}

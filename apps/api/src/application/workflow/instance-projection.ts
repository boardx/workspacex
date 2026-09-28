/**
 * WF03 / UC-WR-4 —— 实例 projection 与可见性（R5；domain I-8）。
 *
 * projection 只由业务行重建：workflow_instances + workflow_events + workflow_stage_outputs + 冻结的
 * Definition 版本。不读 checkpoint 的 channel_values。
 * 可见性：发起人本人或组织管理员；其他人（含他组织）一律 workflow_not_found（404，不是 403）。
 */
import {
  WORKFLOW_TERMINAL_STATUSES,
  type WorkflowDefinitionVersionView,
  type WorkflowInstanceProjection,
  type WorkflowInstanceStatus,
} from "@repo/contracts/workflow-runtime";
import { WorkflowUseCaseError } from "./workflow-errors";
import type { WorkflowActor, WorkflowDefinitionRepository } from "./workflow-ports";
import type {
  WorkflowAccessPort,
  WorkflowEventStore,
  WorkflowInstanceState,
  WorkflowStageOutputRow,
  WorkflowStoredEvent,
} from "./workflow-runtime-ports";

type StageView = WorkflowInstanceProjection["stages"][number];

export interface ProjectionDeps {
  definitions: WorkflowDefinitionRepository;
  events: WorkflowEventStore;
  access: WorkflowAccessPort;
}

export function isTerminal(status: WorkflowInstanceStatus): boolean {
  return WORKFLOW_TERMINAL_STATUSES.includes(status);
}

export function stageOutputHref(instanceId: string, outputId: string): string {
  return `/workflow-instances/${encodeURIComponent(instanceId)}/outputs/${encodeURIComponent(outputId)}`;
}

export function buildProjection(
  input: { instance: WorkflowInstanceState; events: WorkflowStoredEvent[]; outputs: WorkflowStageOutputRow[] },
  definition: WorkflowDefinitionVersionView,
  viewer: WorkflowActor,
): WorkflowInstanceProjection {
  const { instance, events, outputs } = input;
  const stages: StageView[] = definition.stages.map((d) => ({
    stageId: d.stageId,
    title: d.title,
    status: "pending",
    attempt: 1,
    pinnedSkills: instance.pinnedSkills.filter((p) => p.stageId === d.stageId).map((p) => ({ ...p })),
    outputs: [],
    reasonCode: null,
    startedAt: null,
    finishedAt: null,
  }));
  const byId = new Map(stages.map((s) => [s.stageId, s]));
  for (const e of events) {
    const stage = e.stageId ? byId.get(e.stageId) : undefined;
    if (!stage) continue;
    const attempt = typeof e.data.attempt === "number" ? e.data.attempt : stage.attempt;
    stage.attempt = Math.max(stage.attempt, attempt);
    if (e.type === "stage_started") {
      stage.status = "running";
      stage.startedAt ??= e.createdAt;
    } else if (e.type === "stage_succeeded") {
      stage.status = "succeeded";
      stage.finishedAt = e.createdAt;
    } else if (e.type === "stage_failed") {
      stage.status = "failed";
      stage.reasonCode = e.reasonCode;
      stage.finishedAt = e.createdAt;
    }
  }
  // 产出链接只取「已记事件」的行：快照里 seq ≤ lastSeq 的一致视图。
  const written = new Set(events.filter((e) => e.type === "stage_output_written").map((e) => String(e.data.outputId)));
  for (const o of outputs) {
    if (!written.has(o.outputId)) continue;
    byId.get(o.stageId)?.outputs.push({ outputId: o.outputId, label: o.label, href: stageOutputHref(instance.instanceId, o.outputId) });
  }
  const terminal = isTerminal(instance.status);
  const lastSeq = events.length > 0 ? events[events.length - 1]!.seq : 0;
  const mayControl = viewer.userId === instance.initiatorUserId || viewer.orgRole === "admin";
  return {
    instanceId: instance.instanceId,
    orgId: instance.orgId,
    workflowKey: instance.workflowKey,
    definitionVersion: instance.definitionVersion,
    agentId: instance.agentId,
    agentVersionId: instance.agentVersionId,
    initiatorUserId: instance.initiatorUserId,
    triggerKind: instance.triggerKind,
    status: instance.status,
    stateVersion: instance.stateVersion,
    reasonCode: instance.reasonCode,
    stages,
    openGate: null,
    effects: [],
    lastSeq,
    viewerCapabilities: {
      canCancel: mayControl && !terminal && instance.status !== "cancelling",
      canRetryStage: false,
      canResume: mayControl && !terminal,
    },
    createdAt: instance.createdAt,
    updatedAt: instance.updatedAt,
  };
}

/** 解析调用者的组织角色；非成员 → workflow_not_found。 */
export async function resolveActor(access: WorkflowAccessPort, orgId: string, userId: string): Promise<WorkflowActor> {
  const role = await access.orgRoleOf(orgId, userId);
  if (!role) throw new WorkflowUseCaseError("workflow_not_found", "workflow not found");
  return { userId, orgRole: role };
}

export function canView(instance: Pick<WorkflowInstanceState, "initiatorUserId">, actor: WorkflowActor): boolean {
  return actor.orgRole === "admin" || actor.userId === instance.initiatorUserId;
}

export async function getInstanceProjection(
  deps: ProjectionDeps,
  cmd: { orgId: string; userId: string; instanceId: string },
): Promise<WorkflowInstanceProjection> {
  const actor = await resolveActor(deps.access, cmd.orgId, cmd.userId);
  return loadVisibleProjection(deps, cmd.orgId, cmd.instanceId, actor);
}

export async function loadVisibleProjection(
  deps: Pick<ProjectionDeps, "definitions" | "events">,
  orgId: string,
  instanceId: string,
  actor: WorkflowActor,
): Promise<WorkflowInstanceProjection> {
  const snap = await deps.events.loadSnapshot(orgId, instanceId);
  if (!snap || !canView(snap.instance, actor)) throw new WorkflowUseCaseError("workflow_not_found", "workflow not found");
  const definition = await deps.definitions.findVersion(orgId, snap.instance.workflowKey, snap.instance.definitionVersion);
  if (!definition) throw new WorkflowUseCaseError("workflow_not_found", "pinned definition version missing");
  return buildProjection(snap, definition, actor);
}

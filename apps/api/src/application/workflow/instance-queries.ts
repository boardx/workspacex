/**
 * WF03 / WF05 / WF08 读侧用例：UC-WR-2 listRunnableWorkflows、UC-WR-5 listMyInstances、UC-WR-10 listMyApprovals，
 * 以及 UC-WR-9 retryStage 的准入判定。
 *
 * 可见性与 getInstance 同一套判据（instance-projection.ts `canView` / human-gate-state.ts `isDesignatedApprover`）：
 * - 我的运行：成员只列自己发起的，组织管理员列本组织全部（canView）；SQL 预筛之后仍逐行复核。
 * - 待我审批：只列本人是指定审批人（含发起人伪角色）的门；viewerCanDecide 仍由 gateEligibility 判（自批 = false）。
 * - 可运行 Workflow：Agent 对发起人可运行（E6，否则 404）且不在白名单外（CT06 E3）的最新 published 版本。
 */
import { workflowRuntime, type WorkflowInstanceProjection, type WorkflowInstanceStatus } from "@repo/contracts/workflow-runtime";
import { deriveGates, gateView, humanGateOf, isDesignatedApprover } from "./human-gate-state";
import { canView, isTerminal, loadVisibleProjection, resolveActor } from "./instance-projection";
import { WorkflowCommandShapeError } from "./instance-commands";
import { WorkflowUseCaseError } from "./workflow-errors";
import type { WorkflowDefinitionCatalogPort, WorkflowDefinitionRepository } from "./workflow-ports";
import type { WorkflowAccessPort, WorkflowEventStore, WorkflowInstanceQueryPort } from "./workflow-runtime-ports";

const C = workflowRuntime;

export interface InstanceQueryDeps {
  definitions: WorkflowDefinitionRepository;
  events: WorkflowEventStore;
  access: WorkflowAccessPort;
  queries: WorkflowInstanceQueryPort;
  catalog: WorkflowDefinitionCatalogPort;
}

export type InstanceSummary = Pick<
  WorkflowInstanceProjection,
  "instanceId" | "workflowKey" | "definitionVersion" | "agentId" | "status" | "stateVersion" | "reasonCode" | "createdAt" | "updatedAt"
>;
export interface ListInstancesResponse { items: InstanceSummary[]; nextCursor: string | null }
export interface ApprovalItem {
  instanceId: string;
  workflowKey: string;
  definitionVersion: number;
  agentId: string;
  initiatorUserId: string;
  gate: NonNullable<WorkflowInstanceProjection["openGate"]>;
}
export interface RunnableItem { key: string; version: number; title: string; inputSchema: Record<string, unknown> }

/** 待我审批一次最多检视的实例数（新近优先）。 */
const APPROVAL_SCAN_LIMIT = 200;

function encodeCursor(k: { updatedAt: string; instanceId: string }): string {
  return Buffer.from(JSON.stringify([k.updatedAt, k.instanceId]), "utf8").toString("base64url");
}

function decodeCursor(raw: string): { updatedAt: string; instanceId: string } {
  try {
    const v: unknown = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
    if (Array.isArray(v) && typeof v[0] === "string" && typeof v[1] === "string" && !Number.isNaN(Date.parse(v[0]))) {
      return { updatedAt: v[0], instanceId: v[1] };
    }
  } catch {
    // 落到下方统一的形状错误
  }
  throw new WorkflowCommandShapeError([{ path: ["cursor"], message: "invalid cursor" }]);
}

/** 查询串 → 契约 in（`status` 可为逗号串或重复参数；`limit` 为数字串）。 */
export function parseListInstancesQuery(raw: { status?: string | string[]; cursor?: string; limit?: string }) {
  const statuses = (Array.isArray(raw.status) ? raw.status : raw.status === undefined ? [] : [raw.status])
    .flatMap((s) => s.split(","))
    .map((s) => s.trim())
    .filter((s) => s !== "");
  const parsed = C.listMyInstances.in.safeParse({
    ...(statuses.length > 0 ? { status: statuses } : {}),
    ...(raw.cursor ? { cursor: raw.cursor } : {}),
    ...(raw.limit !== undefined && raw.limit !== "" ? { limit: Number(raw.limit) } : {}),
  });
  if (!parsed.success) throw new WorkflowCommandShapeError(parsed.error.issues);
  return parsed.data;
}

export function parseListApprovalsQuery(raw: { includeDecided?: string }) {
  const v = raw.includeDecided;
  if (v !== undefined && v !== "" && v !== "true" && v !== "false") {
    throw new WorkflowCommandShapeError([{ path: ["includeDecided"], message: "expected true|false" }]);
  }
  return C.listMyApprovals.in.parse({ includeDecided: v === "true" });
}

/** UC-WR-5：我的运行。空列表是合法结果。 */
export async function listMyInstances(
  deps: InstanceQueryDeps,
  cmd: { orgId: string; userId: string; query: { status?: WorkflowInstanceStatus[]; cursor?: string; limit: number } },
): Promise<ListInstancesResponse> {
  const actor = await resolveActor(deps.access, cmd.orgId, cmd.userId).catch((e: unknown) => {
    if (e instanceof WorkflowUseCaseError) return null; // 契约 err 为空：非成员看到的就是空列表
    throw e;
  });
  if (!actor) return { items: [], nextCursor: null };
  const { limit } = cmd.query;
  const rows = await deps.queries.listInstances(cmd.orgId, {
    initiatorUserId: actor.orgRole === "admin" ? null : actor.userId,
    statuses: cmd.query.status && cmd.query.status.length > 0 ? cmd.query.status : null,
    before: cmd.query.cursor ? decodeCursor(cmd.query.cursor) : null,
    limit: limit + 1,
  });
  const page = rows.slice(0, limit);
  const items = page.filter((r) => canView(r, actor)).map((r) => ({
    instanceId: r.instanceId,
    workflowKey: r.workflowKey,
    definitionVersion: r.definitionVersion,
    agentId: r.agentId,
    status: r.status,
    stateVersion: r.stateVersion,
    reasonCode: r.reasonCode,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  }));
  const last = page[page.length - 1];
  return { items, nextCursor: rows.length > limit && last ? encodeCursor({ updatedAt: last.updatedAt, instanceId: last.instanceId }) : null };
}

/** UC-WR-10：待我审批（本人是指定审批人的门；默认只列未决定的）。 */
export async function listMyApprovals(
  deps: InstanceQueryDeps,
  cmd: { orgId: string; userId: string; includeDecided: boolean },
): Promise<{ items: ApprovalItem[] }> {
  const actor = await resolveActor(deps.access, cmd.orgId, cmd.userId).catch((e: unknown) => {
    if (e instanceof WorkflowUseCaseError) return null;
    throw e;
  });
  if (!actor) return { items: [] };
  const ids = await deps.queries.listGateInstanceIds(cmd.orgId, { openOnly: !cmd.includeDecided, limit: APPROVAL_SCAN_LIMIT });
  const items: ApprovalItem[] = [];
  for (const instanceId of ids) {
    const snap = await deps.events.loadSnapshot(cmd.orgId, instanceId);
    if (!snap) continue;
    const { instance } = snap;
    const definition = await deps.definitions.findVersion(cmd.orgId, instance.workflowKey, instance.definitionVersion);
    if (!definition) continue;
    for (const g of deriveGates(snap.events).values()) {
      if (g.decision !== null && !cmd.includeDecided) continue;
      if (g.decision === null && instance.status !== "awaiting_gate_decision") continue;
      const def = humanGateOf(definition, g.stageId);
      if (!def || !isDesignatedApprover(def, actor, instance.initiatorUserId)) continue;
      items.push({
        instanceId: instance.instanceId,
        workflowKey: instance.workflowKey,
        definitionVersion: instance.definitionVersion,
        agentId: instance.agentId,
        initiatorUserId: instance.initiatorUserId,
        gate: gateView(g, definition, actor, instance),
      });
    }
  }
  return { items };
}

/** UC-WR-2：对某 Agent 可运行的 Workflow（E6：Agent 不可运行 → 404；白名单外的不出现）。 */
export async function listRunnableWorkflows(
  deps: InstanceQueryDeps,
  cmd: { orgId: string; userId: string; agentId: string },
): Promise<{ items: RunnableItem[] }> {
  await resolveActor(deps.access, cmd.orgId, cmd.userId);
  const defs = await deps.catalog.listLatestPublished(cmd.orgId);
  const items: RunnableItem[] = [];
  let agentChecked = false;
  for (const d of defs) {
    if (!agentChecked) {
      if (!(await deps.access.runnableAgentVersion(cmd.orgId, cmd.userId, cmd.agentId, d.key))) {
        throw new WorkflowUseCaseError("workflow_not_found", "agent not runnable");
      }
      agentChecked = true;
    }
    if (await deps.access.workflowAllowlistRefusal(cmd.orgId, cmd.userId, cmd.agentId, d.key)) continue;
    items.push({ key: d.key, version: d.version, title: d.title, inputSchema: { ...d.inputSchema } });
  }
  return { items };
}

/**
 * UC-WR-9：从阶段重试。运行时尚未提供「新 attempt 重跑某阶段」的执行路径，projection 对每个阶段都给
 * `viewerCapabilities.canRetryStage = false`；这里与之一致：可见性（404）/ 版本（409）/ 终态照常判，
 * 其余一律 `stage_not_retryable`，不假装已重试。
 */
export async function retryStage(
  deps: InstanceQueryDeps,
  cmd: { orgId: string; userId: string; instanceId: string; stageId: string; body: unknown },
): Promise<never> {
  const raw = cmd.body && typeof cmd.body === "object" ? (cmd.body as Record<string, unknown>) : {};
  const parsed = C.retryStage.in.safeParse({ ...raw, instanceId: cmd.instanceId, stageId: cmd.stageId });
  if (!parsed.success) throw new WorkflowCommandShapeError(parsed.error.issues);
  const actor = await resolveActor(deps.access, cmd.orgId, cmd.userId);
  const projection = await loadVisibleProjection(deps, cmd.orgId, cmd.instanceId, actor);
  const mayControl = actor.orgRole === "admin" || actor.userId === projection.initiatorUserId;
  if (!mayControl) throw new WorkflowUseCaseError("workflow_not_found", "workflow not found");
  if (!projection.stages.some((s) => s.stageId === parsed.data.stageId)) {
    throw new WorkflowUseCaseError("stage_not_retryable", "unknown stage");
  }
  if (parsed.data.expectedStateVersion !== projection.stateVersion) {
    throw new WorkflowUseCaseError("state_version_conflict", "state version is stale", { latestProjection: projection });
  }
  if (isTerminal(projection.status) && projection.status !== "failed") {
    throw new WorkflowUseCaseError("instance_terminal", "instance is terminal", { latestProjection: projection });
  }
  throw new WorkflowUseCaseError("stage_not_retryable", "stage retry is not supported by this runtime");
}

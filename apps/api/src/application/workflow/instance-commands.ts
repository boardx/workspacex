/**
 * WF03 —— UC-WR-3 start / UC-WR-7 cancel / UC-WR-8 resume（requirements 02 R3 第 2、10 步；R4 A1/E2/E3/E5/E6）。
 *
 * start：receipt.begin（同 requestId 同指纹 → 首次稳定响应，A1）→ 准入（E6）→ 输入校验 → 冻结版本建实例
 *   （实例与 seq=1 的 instance_started 事件同事务）→ lease(epoch=1) → receipt.finalize → 交给 worker。
 * cancel：可见性 → expectedStateVersion（过期 → 409 state_version_conflict + latestProjection，E3）→
 *   置 cancelling 并记 cancel_requested；worker 在下一个阶段边界把它落成 cancelled。
 * resume：可见性 → 版本校验 → lease epoch CAS（E2，lease_conflict）→ 交给 worker。
 */
import { createHash } from "node:crypto";
import { workflowRuntime, type WorkflowInstanceStatus, type PinnedSkillVersion } from "@repo/contracts/workflow-runtime";
import { validateTriggerInput } from "../../domain/workflow/trigger-input";
import { createPinnedInstance } from "./pin-workflow-instance";
import { isTerminal, loadVisibleProjection, resolveActor } from "./instance-projection";
import { WorkflowUseCaseError } from "./workflow-errors";
import type {
  SkillVersionResolverPort,
  WorkflowDefinitionRepository,
  WorkflowInstanceRepository,
  WorkflowLeaseStore,
  WorkflowReceiptKey,
  WorkflowReceiptStore,
} from "./workflow-ports";
import type { WorkflowAccessPort, WorkflowEventStore, WorkflowRunDispatcher } from "./workflow-runtime-ports";

export interface InstanceCommandDeps {
  definitions: WorkflowDefinitionRepository;
  instances: WorkflowInstanceRepository;
  skills: SkillVersionResolverPort;
  receipts: WorkflowReceiptStore;
  leases: WorkflowLeaseStore;
  events: WorkflowEventStore;
  access: WorkflowAccessPort;
  dispatcher: WorkflowRunDispatcher;
  newId(): string;
  /** 本进程 worker 的 lease 持有者标识。 */
  holder: string;
  leaseTtlMs: number;
  /** 并发同 requestId 时等待首个请求 finalize 的上限。 */
  inFlightWaitMs?: number;
}

export interface StartInstanceResponse {
  instanceId: string;
  status: WorkflowInstanceStatus;
  stateVersion: number;
  definitionVersion: number;
  pinnedSkills: PinnedSkillVersion[];
}

export interface StateResponse {
  instanceId: string;
  status: WorkflowInstanceStatus;
  stateVersion: number;
}

function fingerprint(value: unknown): string {
  return createHash("sha256").update(stableJson(value)).digest("hex");
}

function stableJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stableJson).join(",")}]`;
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o).sort().map((k) => `${JSON.stringify(k)}:${stableJson(o[k])}`).join(",")}}`;
  }
  return JSON.stringify(v ?? null);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** begin；若另一请求正持有同 key（in_flight），等它 finalize 后返回其稳定响应。 */
async function beginOrReplay(deps: InstanceCommandDeps, key: WorkflowReceiptKey): Promise<{ replay: unknown } | null> {
  const deadline = Date.now() + (deps.inFlightWaitMs ?? 10_000);
  for (;;) {
    const r = await deps.receipts.begin(key);
    if (r.kind === "begun") return null;
    if (r.kind === "replay") return { replay: r.stableResponse };
    if (Date.now() > deadline) throw new Error(`workflow command ${key.requestKey} is still in flight`);
    await sleep(50);
  }
}

export async function startInstance(
  deps: InstanceCommandDeps,
  cmd: { orgId: string; userId: string; pathKey: string; body: unknown },
): Promise<StartInstanceResponse> {
  const actor = await resolveActor(deps.access, cmd.orgId, cmd.userId);
  const raw = cmd.body && typeof cmd.body === "object" ? (cmd.body as Record<string, unknown>) : {};
  const parsed = workflowRuntime.startInstance.in.safeParse({ ...raw, key: cmd.pathKey });
  if (!parsed.success) {
    throw new WorkflowUseCaseError("trigger_input_invalid", "start request invalid", { issues: parsed.error.issues });
  }
  const body = parsed.data;
  const key: WorkflowReceiptKey = {
    orgId: cmd.orgId,
    scope: "command",
    requestKey: `start:${body.requestId}`,
    fingerprint: fingerprint({ op: "start", key: body.key, version: body.version ?? null, agentId: body.agentId, input: body.input, by: actor.userId }),
  };
  const prior = await beginOrReplay(deps, key);
  if (prior) return prior.replay as StartInstanceResponse;

  if (!(await deps.definitions.definitionExists(cmd.orgId, body.key))) {
    throw new WorkflowUseCaseError("workflow_not_found", "workflow not found");
  }
  const agentVersionId = await deps.access.runnableAgentVersion(cmd.orgId, actor.userId, body.agentId, body.key);
  if (!agentVersionId) throw new WorkflowUseCaseError("workflow_not_allowed", "agent not runnable for this workflow");

  const version = body.version ?? (await deps.definitions.latestPublishedVersion(cmd.orgId, body.key));
  const definition = version == null ? null : await deps.definitions.findVersion(cmd.orgId, body.key, version);
  if (!definition || definition.status !== "published") {
    throw new WorkflowUseCaseError("workflow_version_not_published", "workflow version not published");
  }
  const inputIssues = validateTriggerInput(definition.inputSchema, body.input);
  if (inputIssues.length > 0) throw new WorkflowUseCaseError("trigger_input_invalid", "trigger input invalid", { issues: inputIssues });

  const instance = await createPinnedInstance(
    { ...deps, instances: withTriggerInput(deps.instances, body.input) },
    {
      orgId: cmd.orgId,
      key: body.key,
      version: definition.version,
      agentId: body.agentId,
      agentVersionId,
      initiatorUserId: actor.userId,
      triggerKind: "manual",
    },
  );
  const lease = await deps.leases.acquire({ orgId: cmd.orgId, instanceId: instance.instanceId, holder: deps.holder, ttlMs: deps.leaseTtlMs });
  const response: StartInstanceResponse = {
    instanceId: instance.instanceId,
    status: instance.status,
    stateVersion: instance.stateVersion,
    definitionVersion: instance.definitionVersion,
    pinnedSkills: instance.pinnedSkills.map((p) => ({ ...p })),
  };
  const stable = (await deps.receipts.finalize(key, { stableResponse: response, checkpointId: null, instanceId: instance.instanceId })) as StartInstanceResponse;
  deps.dispatcher.dispatch(lease);
  return stable;
}

/** 实例仓库的 create 会同事务写 instance_started 事件；trigger 输入随事件落库（worker 从这里读回）。 */
function withTriggerInput(repo: WorkflowInstanceRepository, input: Record<string, unknown>): WorkflowInstanceRepository {
  return {
    create: (instance) => repo.create(instance, { triggerInput: input }),
    find: (orgId, id) => repo.find(orgId, id),
  };
}

async function guardedTransition(
  deps: InstanceCommandDeps,
  cmd: { orgId: string; userId: string; instanceId: string; expectedStateVersion: number },
) {
  const actor = await resolveActor(deps.access, cmd.orgId, cmd.userId);
  const projection = await loadVisibleProjection(deps, cmd.orgId, cmd.instanceId, actor);
  const conflict = async (code: "state_version_conflict" | "instance_terminal") => {
    const latestProjection = await loadVisibleProjection(deps, cmd.orgId, cmd.instanceId, actor);
    return new WorkflowUseCaseError(code, code === "instance_terminal" ? "instance is terminal" : "state version is stale", { latestProjection });
  };
  if (projection.stateVersion !== cmd.expectedStateVersion) throw await conflict("state_version_conflict");
  if (isTerminal(projection.status)) throw await conflict("instance_terminal");
  return { actor, projection, conflict };
}

function parseCommand(op: "cancelInstance" | "resumeInstance", instanceId: string, body: unknown) {
  const raw = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const parsed = workflowRuntime[op].in.safeParse({ ...raw, instanceId });
  // 契约 err 表不含 400 类码；形状错误按「看不到这个请求要找的东西」处理为 422 trigger_input_invalid 不合适，
  // 统一抛普通 Error 由 interface 层映射为 400。
  if (!parsed.success) throw new WorkflowCommandShapeError(parsed.error.issues);
  return parsed.data;
}

export class WorkflowCommandShapeError extends Error {
  constructor(readonly issues: unknown[]) {
    super("workflow command body invalid");
    this.name = "WorkflowCommandShapeError";
  }
}

export async function cancelInstance(
  deps: InstanceCommandDeps,
  cmd: { orgId: string; userId: string; instanceId: string; body: unknown },
): Promise<StateResponse> {
  const body = parseCommand("cancelInstance", cmd.instanceId, cmd.body);
  const key: WorkflowReceiptKey = {
    orgId: cmd.orgId,
    scope: "command",
    requestKey: `cancel:${body.instanceId}:${body.requestId}`,
    fingerprint: fingerprint({ op: "cancel", instanceId: body.instanceId, v: body.expectedStateVersion, by: cmd.userId }),
  };
  const r = await deps.receipts.begin(key);
  if (r.kind === "replay") return r.stableResponse as StateResponse;
  const { conflict } = await guardedTransition(deps, { ...cmd, expectedStateVersion: body.expectedStateVersion });
  const appended = await deps.events.append(
    cmd.orgId,
    cmd.instanceId,
    { type: "cancel_requested", stageId: null, reasonCode: "cancel_requested", data: { requestedBy: cmd.userId } },
    { expectedStateVersion: body.expectedStateVersion, status: "cancelling", reasonCode: "cancel_requested" },
  );
  if (!appended.ok) {
    if (appended.conflict === "workflow_not_found") throw new WorkflowUseCaseError("workflow_not_found", "workflow not found");
    throw await conflict(appended.conflict);
  }
  const response: StateResponse = { instanceId: cmd.instanceId, status: appended.status, stateVersion: appended.stateVersion };
  return (await deps.receipts.finalize(key, { stableResponse: response, checkpointId: null, instanceId: cmd.instanceId })) as StateResponse;
}

export async function resumeInstance(
  deps: InstanceCommandDeps,
  cmd: { orgId: string; userId: string; instanceId: string; body: unknown },
): Promise<StateResponse> {
  const body = parseCommand("resumeInstance", cmd.instanceId, cmd.body);
  const { projection } = await guardedTransition(deps, { ...cmd, expectedStateVersion: body.expectedStateVersion });
  const lease = await deps.leases.acquire({ orgId: cmd.orgId, instanceId: cmd.instanceId, holder: deps.holder, ttlMs: deps.leaseTtlMs });
  deps.dispatcher.dispatch(lease);
  return { instanceId: cmd.instanceId, status: projection.status, stateVersion: projection.stateVersion };
}
